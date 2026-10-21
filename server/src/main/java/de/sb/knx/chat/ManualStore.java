package de.sb.knx.chat;

import de.sb.knx.json.Json;

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
import java.util.HexFormat;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Handbuecher, die der Nutzer selbst hochgeladen hat - fuer alle Projekte gemeinsam. Die PDFs liegen
 * allein in einem eigenen Ordner, in dem der Chat arbeitet und lesen darf; das Verzeichnis dazu (Titel,
 * Seitenzahl, zugeordnete Produkte) liegt eine Ebene hoeher und ist fuer die KI nicht erreichbar.
 * Aus dem Internet wird nichts geladen.
 */
public final class ManualStore {

    public static final int MAX_BYTES = 50 << 20;
    static final int MAX_MANUALS = 500;
    static final int MAX_PRODUCTS = 50;
    static final Pattern ID = Pattern.compile("[a-f0-9]{16}");
    private static final Pattern PAGE = Pattern.compile("/Type\\s*/Page(?![A-Za-z])");
    private static final Pattern COUNT = Pattern.compile("/Type\\s*/Pages\\b[^>]*?/Count\\s+(\\d{1,6})|/Count\\s+(\\d{1,6})[^>]*?/Type\\s*/Pages\\b");

    private final Path root, files, index;
    private final SecureRandom random = new SecureRandom();

    public ManualStore(Path dataDir) throws IOException {
        this.root = dataDir.resolve("manuals");
        this.files = root.resolve("files");
        this.index = root.resolve("index.json");
        Files.createDirectories(files);
        if (posix()) {
            Files.setPosixFilePermissions(root, PosixFilePermissions.fromString("rwx------"));
            Files.setPosixFilePermissions(files, PosixFilePermissions.fromString("rwx------"));
        }
    }

    /** Der Ordner, in dem nur die PDFs liegen - Arbeitsverzeichnis des Chats. */
    public Path filesDir() {
        return files;
    }

    public synchronized List<Object> list() throws IOException {
        return new ArrayList<>(entries());
    }

    public synchronized Map<String, Object> add(byte[] pdf, String title) throws IOException {
        if (pdf.length < 8 || !new String(pdf, 0, 5, StandardCharsets.ISO_8859_1).equals("%PDF-")) {
            throw new IllegalArgumentException("Das ist keine PDF-Datei");
        }
        if (pdf.length > MAX_BYTES) throw new IllegalArgumentException("Handbuecher duerfen hoechstens " + (MAX_BYTES >> 20) + " MB gross sein");
        List<Map<String, Object>> all = entries();
        if (all.size() >= MAX_MANUALS) throw new IllegalArgumentException("Es sind schon " + MAX_MANUALS + " Handbuecher gespeichert");
        String id;
        do {
            byte[] b = new byte[8];
            random.nextBytes(b);
            id = HexFormat.of().formatHex(b);
        } while (Files.exists(file(id)));
        Path tmp = root.resolve(id + ".pdf.tmp");
        create(tmp);
        Files.write(tmp, pdf);
        Files.move(tmp, file(id), StandardCopyOption.REPLACE_EXISTING);

        Map<String, Object> m = Json.obj();
        m.put("id", id);
        m.put("file", id + ".pdf");
        m.put("title", title(title));
        m.put("bytes", pdf.length);
        m.put("pages", pages(pdf));
        m.put("products", Json.arr());
        m.put("added", System.currentTimeMillis());
        all.add(m);
        save(all);
        return m;
    }

    /** Titel und zugeordnete Produkte (Hersteller und Bestellnummer) aendern. */
    public synchronized Map<String, Object> update(String id, String title, Object products) throws IOException {
        List<Map<String, Object>> all = entries();
        Map<String, Object> m = find(all, id);
        if (title != null) m.put("title", title(title));
        if (products != null) {
            if (!(products instanceof List<?> l)) throw new IllegalArgumentException("products muss eine Liste sein");
            if (l.size() > MAX_PRODUCTS) throw new IllegalArgumentException("Hoechstens " + MAX_PRODUCTS + " Produkte je Handbuch");
            List<Object> out = Json.arr();
            Set<String> seen = new LinkedHashSet<>();
            for (Object o : l) {
                if (!(o instanceof Map<?, ?> p)) throw new IllegalArgumentException("Produkt muss ein Objekt sein");
                String manufacturer = clean(p.get("manufacturer"), 120), order = clean(p.get("order"), 120);
                String name = clean(p.get("name"), 200);
                if (order.isEmpty() && name.isEmpty()) throw new IllegalArgumentException("Produkt ohne Bestellnummer und Namen");
                if (!seen.add(manufacturer + '\u0000' + order + '\u0000' + name)) continue;
                Map<String, Object> pm = Json.obj();
                pm.put("manufacturer", manufacturer);
                pm.put("order", order);
                pm.put("name", name);
                out.add(pm);
            }
            m.put("products", out);
        }
        save(all);
        return m;
    }

    public synchronized boolean delete(String id) throws IOException {
        List<Map<String, Object>> all = entries();
        boolean gone = all.removeIf(m -> id.equals(m.get("id")));
        Files.deleteIfExists(file(checked(id)));
        if (gone) save(all);
        return gone;
    }

    /** Die PDF zum Ansehen im Browser, oder null. */
    public synchronized byte[] read(String id) throws IOException {
        Path f = file(checked(id));
        return Files.isRegularFile(f) ? Files.readAllBytes(f) : null;
    }

    /* ---------------- intern ---------------- */

    private List<Map<String, Object>> entries() throws IOException {
        List<Map<String, Object>> out = new ArrayList<>();
        if (!Files.isRegularFile(index)) return out;
        Map<String, Object> doc;
        try {
            doc = Json.parseObject(Files.readString(index, StandardCharsets.UTF_8));
        } catch (IllegalArgumentException e) {
            return out;
        }
        if (doc.get("manuals") instanceof List<?> l) {
            for (Object o : l) {
                if (o instanceof Map<?, ?> raw && raw.get("id") instanceof String id && ID.matcher(id).matches()
                        && Files.isRegularFile(file(id))) {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> m = (Map<String, Object>) raw;
                    out.add(m);
                }
            }
        }
        return out;
    }

    private void save(List<Map<String, Object>> all) throws IOException {
        Map<String, Object> doc = Json.obj();
        doc.put("manuals", new ArrayList<Object>(all));
        Path tmp = root.resolve("index.json.tmp");
        create(tmp);
        Files.writeString(tmp, Json.write(doc), StandardCharsets.UTF_8);
        Files.move(tmp, index, StandardCopyOption.REPLACE_EXISTING);
        // Was nicht mehr im Verzeichnis steht, faellt weg - so bleiben im Ordner nur bekannte PDFs
        Set<String> known = new LinkedHashSet<>();
        all.forEach(m -> known.add(m.get("id") + ".pdf"));
        try (DirectoryStream<Path> ds = Files.newDirectoryStream(files)) {
            for (Path f : ds) {
                String n = f.getFileName().toString();
                if (!known.contains(n)) Files.deleteIfExists(f);
            }
        }
    }

    private Map<String, Object> find(List<Map<String, Object>> all, String id) {
        checked(id);
        return all.stream().filter(m -> id.equals(m.get("id"))).findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Dieses Handbuch gibt es nicht mehr"));
    }

    private Path file(String id) {
        return files.resolve(id + ".pdf");
    }

    private static String checked(String id) {
        if (id == null || !ID.matcher(id).matches()) throw new IllegalArgumentException("Unbekanntes Handbuch");
        return id;
    }

    private static String title(String raw) {
        String t = clean(raw, 200).replaceFirst("(?i)\\.pdf$", "").strip();
        return t.isEmpty() ? "Handbuch" : t;
    }

    static String clean(Object raw, int max) {
        String s = raw == null ? "" : String.valueOf(raw);
        s = s.replaceAll("[\\p{Cc}\\p{Cf}\\u2028\\u2029]+", " ").replaceAll("\\s+", " ").strip();
        return s.length() > max ? s.substring(0, max) : s;
    }

    /**
     * Seitenzahl, so gut sie sich ohne PDF-Bibliothek bestimmen laesst: die Seitenobjekte zaehlen, sonst der
     * Seitenbaum. Stecken beide in komprimierten Objektstroemen, bleibt sie unbekannt (null).
     */
    static Integer pages(byte[] pdf) {
        String s = new String(pdf, StandardCharsets.ISO_8859_1);
        int n = 0;
        Matcher m = PAGE.matcher(s);
        while (m.find()) n++;
        if (n > 0) return n;
        int best = 0;
        Matcher c = COUNT.matcher(s);
        while (c.find()) best = Math.max(best, Integer.parseInt(c.group(1) != null ? c.group(1) : c.group(2)));
        return best > 0 ? best : null;
    }

    private static void create(Path f) throws IOException {
        Files.deleteIfExists(f);
        if (posix()) Files.createFile(f, PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
    }

    private static boolean posix() {
        return FileSystems.getDefault().supportedFileAttributeViews().contains("posix");
    }
}
