package de.sb.knx.store;

import de.sb.knx.json.Json;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

/**
 * Produktkatalog: je Eintrag die im Browser ausgewerteten Produktdaten als JSON und
 * daneben die Originaldatei. Der Dienst legt nur ab - die .knxprod-Auswertung bleibt
 * in knx-prod.js, damit es die Zerlegung nur einmal im Projekt gibt.
 */
public final class CatalogStore extends FileStore {

    public static final int MAX_BYTES = 128 << 20;

    private final Path files;

    public CatalogStore(Path root) throws IOException {
        super(root.resolve("catalog").resolve("products"));
        this.files = root.resolve("catalog").resolve("files");
        Files.createDirectories(files);
    }

    public List<Map<String, Object>> list() throws IOException {
        List<Map<String, Object>> out = new ArrayList<>();
        try (Stream<Path> stream = Files.list(dir)) {
            for (Path p : stream.filter(p -> p.getFileName().toString().endsWith(".json")).toList()) {
                String name = p.getFileName().toString();
                String id = name.substring(0, name.length() - 5);
                Map<String, Object> m = Json.obj();
                m.put("id", id);
                m.put("bytes", Files.size(p));
                m.put("modified", Files.getLastModifiedTime(p).toMillis());
                m.put("hasFile", Files.isRegularFile(blob(id)));
                m.put("meta", meta(p));
                out.add(m);
            }
        }
        out.sort(Comparator.comparing(m -> lower((String) m.get("id"))));
        return out;
    }

    public byte[] read(String id) throws IOException {
        Path p = file(id, ".json");
        return Files.isRegularFile(p) ? Files.readAllBytes(p) : null;
    }

    public void write(String id, String json) throws IOException {
        validateJson(json);
        writeAtomic(file(id, ".json"), utf8(json), false);
    }

    public void delete(String id) throws IOException {
        Files.deleteIfExists(file(id, ".json"));
        Files.deleteIfExists(blob(id));
    }

    public byte[] readFile(String id) throws IOException {
        Path p = blob(id);
        return Files.isRegularFile(p) ? Files.readAllBytes(p) : null;
    }

    public void writeFile(String id, byte[] content) throws IOException {
        writeAtomic(blob(id), content, false);
    }

    private Path blob(String id) {
        Path p = files.resolve(safeId(id) + ".knxprod").normalize();
        if (!p.startsWith(files)) throw new IllegalArgumentException("Pfad ausserhalb der Ablage");
        return p;
    }

    /** Nur der meta-Zweig wandert in die Liste; der Rest kann viele Megabyte gross sein. */
    private static Object meta(Path p) {
        try {
            Object doc = Json.parse(Files.readString(p));
            if (doc instanceof Map<?, ?> m && m.get("meta") != null) return m.get("meta");
        } catch (IOException | RuntimeException e) {
            return Map.of("error", "Eintrag nicht lesbar");
        }
        return null;
    }
}
