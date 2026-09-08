package de.sb.knx.store;

import de.sb.knx.json.Json;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

/** Projektdateien auf dem PC - loest den Browserspeicher als Ablage ab. */
public final class ProjectStore extends FileStore {

    private static final String EXT = ".json";
    public static final int MAX_BYTES = 64 << 20;

    public ProjectStore(Path root) throws IOException {
        super(root.resolve("projects"));
    }

    public List<Map<String, Object>> list() throws IOException {
        List<Map<String, Object>> out = new ArrayList<>();
        try (Stream<Path> files = Files.list(dir)) {
            for (Path p : files.filter(p -> p.getFileName().toString().endsWith(EXT)).toList()) {
                String name = p.getFileName().toString();
                Map<String, Object> m = Json.obj();
                m.put("id", name.substring(0, name.length() - EXT.length()));
                m.put("bytes", Files.size(p));
                m.put("modified", Files.getLastModifiedTime(p).toMillis());
                out.add(m);
            }
        }
        out.sort(Comparator.comparing(m -> lower((String) m.get("id"))));
        return out;
    }

    public boolean exists(String id) {
        return Files.isRegularFile(file(id, EXT));
    }

    public byte[] read(String id) throws IOException {
        Path p = file(id, EXT);
        if (!Files.isRegularFile(p)) return null;
        return Files.readAllBytes(p);
    }

    public void write(String id, String json) throws IOException {
        validateJson(json);
        writeAtomic(file(id, EXT), utf8(json), true);
    }

    public void delete(String id) throws IOException {
        Files.deleteIfExists(file(id, EXT));
        Files.deleteIfExists(file(id, EXT + ".bak"));
    }

    public void rename(String id, String newId) throws IOException {
        Path from = file(id, EXT);
        Path to = file(newId, EXT);
        if (!Files.isRegularFile(from)) throw new IOException("Projekt nicht gefunden: " + id);
        if (Files.exists(to)) throw new IOException("Es gibt schon ein Projekt namens " + newId);
        Files.move(from, to, StandardCopyOption.ATOMIC_MOVE);
    }

    /** Zuletzt geoeffnetes Projekt und andere Kleinigkeiten, damit der Start ohne Auswahl auskommt. */
    public String readSettings() throws IOException {
        Path p = dir.getParent().resolve("settings.json");
        return Files.isRegularFile(p) ? Files.readString(p, StandardCharsets.UTF_8) : "{}";
    }

    public void writeSettings(String json) throws IOException {
        validateJson(json);
        writeAtomic(dir.getParent().resolve("settings.json"), utf8(json), false);
    }
}
