package de.sb.knx.chat;

import de.sb.knx.json.Json;
import de.sb.knx.store.FileStore;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Gespeicherte Gespraeche des KI-Chats, je Projekt eine Datei pro Gespraech. Darin steht, was das
 * Fenster angezeigt hat - also Klartext - und die Sitzung von Claude Code, an die ein Gespraech nach
 * einem Neustart wieder anknuepft. Ordner und Dateien sind nur fuer den Nutzer lesbar.
 */
final class ChatHistory {

    static final int MAX_CONVERSATIONS = 50;
    static final int MAX_ENTRIES = 1000;
    static final Pattern ID = Pattern.compile("[a-z0-9]{8,40}");
    private static final int TITLE = 80;

    private final Path root;
    private final SecureRandom random = new SecureRandom();

    ChatHistory(Path chatDir) {
        this.root = chatDir.resolve("history");
    }

    synchronized String create(String project, String firstMessage) throws IOException {
        String id = Long.toString(System.currentTimeMillis(), 36) + HexFormat.of().formatHex(bytes(4));
        Map<String, Object> doc = Json.obj();
        doc.put("id", id);
        long now = System.currentTimeMillis();
        doc.put("created", now);
        doc.put("updated", now);
        String t = firstMessage.strip().replaceAll("\\s+", " ");
        doc.put("title", t.length() > TITLE ? t.substring(0, TITLE) + "…" : t);
        doc.put("session", null);
        doc.put("entries", Json.arr());
        write(project, id, doc);
        prune(project);
        return id;
    }

    synchronized void append(String project, String id, Map<String, Object> entry) throws IOException {
        Map<String, Object> doc = read(project, id);
        if (doc == null) return;
        @SuppressWarnings("unchecked")
        List<Object> entries = doc.get("entries") instanceof List<?> l ? (List<Object>) l : Json.arr();
        entry.put("at", System.currentTimeMillis());
        entries.add(entry);
        while (entries.size() > MAX_ENTRIES) entries.remove(0);
        doc.put("entries", entries);
        doc.put("updated", System.currentTimeMillis());
        write(project, id, doc);
    }

    synchronized void setSession(String project, String id, String session) throws IOException {
        Map<String, Object> doc = read(project, id);
        if (doc == null || session.equals(doc.get("session"))) return;
        doc.put("session", session);
        write(project, id, doc);
    }

    synchronized Map<String, Object> read(String project, String id) throws IOException {
        Path f = file(project, id);
        if (!Files.isRegularFile(f)) return null;
        try {
            return Json.parseObject(Files.readString(f, StandardCharsets.UTF_8));
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    /** Uebersicht fuer die Auswahl, das juengste Gespraech zuerst. */
    synchronized List<Object> list(String project) throws IOException {
        List<Map<String, Object>> out = new ArrayList<>();
        Path dir = dir(project);
        if (!Files.isDirectory(dir)) return Json.arr();
        try (DirectoryStream<Path> ds = Files.newDirectoryStream(dir, "*.json")) {
            for (Path f : ds) {
                String id = f.getFileName().toString().replaceFirst("\\.json$", "");
                if (!ID.matcher(id).matches()) continue;
                Map<String, Object> doc = read(project, id);
                if (doc == null) continue;
                Map<String, Object> m = Json.obj();
                m.put("id", id);
                m.put("title", doc.get("title"));
                m.put("updated", doc.get("updated"));
                m.put("entries", doc.get("entries") instanceof List<?> l ? l.size() : 0);
                out.add(m);
            }
        }
        out.sort(Comparator.comparingLong((Map<String, Object> m) -> m.get("updated") instanceof Number n ? n.longValue() : 0).reversed());
        return new ArrayList<>(out);
    }

    synchronized boolean delete(String project, String id) throws IOException {
        return Files.deleteIfExists(file(project, id));
    }

    private void prune(String project) throws IOException {
        List<Object> all = list(project);
        for (int i = MAX_CONVERSATIONS; i < all.size(); i++) {
            if (all.get(i) instanceof Map<?, ?> m) Files.deleteIfExists(file(project, String.valueOf(m.get("id"))));
        }
    }

    private Path dir(String project) {
        return root.resolve(FileStore.safeId(project));
    }

    private Path file(String project, String id) {
        if (id == null || !ID.matcher(id).matches()) throw new IllegalArgumentException("Unbekanntes Gespraech");
        return dir(project).resolve(id + ".json");
    }

    private void write(String project, String id, Map<String, Object> doc) throws IOException {
        Path dir = dir(project);
        if (!Files.isDirectory(dir)) {
            Files.createDirectories(dir);
            if (posix()) {
                Files.setPosixFilePermissions(root, PosixFilePermissions.fromString("rwx------"));
                Files.setPosixFilePermissions(dir, PosixFilePermissions.fromString("rwx------"));
            }
        }
        Path f = file(project, id), tmp = dir.resolve(id + ".json.tmp");
        Files.deleteIfExists(tmp);
        if (posix()) Files.createFile(tmp, PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
        Files.writeString(tmp, Json.write(doc), StandardCharsets.UTF_8);
        Files.move(tmp, f, StandardCopyOption.REPLACE_EXISTING);
    }

    private static boolean posix() {
        return FileSystems.getDefault().supportedFileAttributeViews().contains("posix");
    }

    private byte[] bytes(int n) {
        byte[] b = new byte[n];
        random.nextBytes(b);
        return b;
    }
}
