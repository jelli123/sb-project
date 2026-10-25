package de.sb.knx.online;

import de.sb.knx.json.Json;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.BiConsumer;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * Der oeffentliche KNX-Onlinekatalog.
 * ------------------------------------------------------------------
 * Der Dienst unter onlinecatalog.knx.org antwortet ohne Anmeldung und ohne
 * Kennung; abgefragt wird er mit dem eigenen Namen im User-Agent, nicht als ETS.
 *
 * Endpunkte:
 *   GET  /Download/Manufacturers      Liste der Hersteller-Nummern als XML
 *   GET  /Download/Index/{id}         Produktindex eines Herstellers als JSON
 *   POST /Download/DownloadProduct    {"CatalogIds":[..],"LanguageIds":[..]} -> .knxprod
 * Die Klarnamen der Hersteller stehen nicht im Katalog, sondern in den
 * Stammdaten knx_master.xml, die auch in jeder .knxprod steckt.
 *
 * Sparsam bleiben: der Dienst liefert weder ETag noch Last-Modified und
 * beantwortet auch Accept-Encoding nicht mit gzip. Ein bedingtes Nachladen
 * gibt es also nicht, jede Abfrage kostet die volle Datenmenge - ein
 * Herstellerindex zwischen einem und fuenf Megabyte. Darum:
 *   - Indizes werden nur auf Verlangen geholt, nie alle auf Vorrat.
 *   - Gespeichert wird nur, was die Oberflaeche zeigt; das sind rund 10 %.
 *   - Produktdateien liegen dauerhaft im Cache: die Katalog-Id enthaelt die
 *     Version der Applikation, derselbe Schluessel meint also immer dasselbe.
 */
public final class OnlineCatalog {

    private static final String BASE = "https://onlinecatalog.knx.org";
    private static final String MASTER = "https://update.knx.org/data/XML/project-23/knx_master.xml";
    private static final String AGENT = "sb-project/0.1";

    /** Herstellerliste und Stammdaten aendern sich selten. */
    private static final long MANUFACTURERS_TTL = Duration.ofDays(30).toMillis();
    /** Ein Herstellerindex gilt eine Woche als frisch; danach nur ein Hinweis, kein Zwang. */
    private static final long INDEX_TTL = Duration.ofDays(7).toMillis();

    private static final int MAX_INDEX_BYTES = 64 << 20;
    private static final int MAX_PRODUCT_BYTES = 128 << 20;

    private static final Pattern MANUFACTURER_ID = Pattern.compile("<unsignedShort>(\\d+)</unsignedShort>");
    private static final Pattern MANUFACTURER_TAG = Pattern.compile("<Manufacturer\\b[^>]*>");
    private static final Pattern ATTR_KNX_ID = Pattern.compile("KnxManufacturerId=\"(\\d+)\"");
    private static final Pattern ATTR_NAME = Pattern.compile("Name=\"([^\"]*)\"");

    /**
     * Felder eines Katalogeintrags, die die Oberflaeche braucht - mit dem Typ, den
     * sie haben muessen. Der Katalog ist eine fremde Quelle: was nicht passt, wird
     * weggelassen und nicht blind weitergereicht. Ohne diese Pruefung landet jede
     * Struktur, die der Dienst liefert, im Cache und danach im Browser.
     */
    private enum Kind { TEXT, NUMBER, FLAG, TEXTS, NUMBERS }

    private static final Map<String, Kind> KEEP = Map.ofEntries(
            Map.entry("Id", Kind.TEXT),
            Map.entry("OrderNumber", Kind.TEXT),
            Map.entry("CatalogItemName", Kind.TEXT),
            Map.entry("ProductName", Kind.TEXT),
            Map.entry("ApplicationProgramName", Kind.TEXT),
            Map.entry("MediumTypeIds", Kind.TEXTS),
            Map.entry("ApplicationIdentifier", Kind.NUMBERS),
            Map.entry("FingerPrint", Kind.NUMBER),
            Map.entry("DownloadInfoIncomplete", Kind.FLAG),
            Map.entry("NoDownloadWithoutPlugin", Kind.FLAG),
            Map.entry("RequiresExternalSoftware", Kind.FLAG),
            Map.entry("IsRailMounted", Kind.FLAG),
            Map.entry("WidthInMillimeter", Kind.NUMBER),
            Map.entry("BusCurrent", Kind.NUMBER));

    /* Obergrenzen. Kein Eintrag im Katalog kommt ihnen nahe; sie begrenzen nur,
       was eine fehlerhafte oder boeswillige Antwort anrichten kann. */
    private static final int MAX_ENTRIES = 50_000;
    private static final int MAX_TEXT = 500;
    private static final int MAX_LIST = 32;

    /** Erlaubte Sprachkennung, z. B. de-DE. Geht unveraendert an den Katalog. */
    private static final Pattern LANGUAGE = Pattern.compile("[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8}){0,2}");
    /**
     * Katalog-Ids sehen aus wie M-0083_H-30-1_HP-0030-20-FCCB_CI-BE.2D16000.2E01-1:
     * Buchstaben, Ziffern, Punkt, Unterstrich, Bindestrich. Kein Schraegstrich und
     * kein ".." - beides gehoert nicht in eine Id und hat in einem Pfad nichts zu
     * suchen. Den Dateinamen entschaerft productFile ohnehin noch einmal.
     */
    private static final Pattern CATALOG_ID = Pattern.compile("[A-Za-z0-9._-]{1,400}");
    public static final int MAX_QUERY = 200;
    public static final int MAX_MANUFACTURER_ID = 0xFFFF;

    private final Path root;
    private final Path indexDir;
    private final Path productDir;
    private final HttpClient http;

    /** Verhindert, dass zwei Fenster denselben Index gleichzeitig holen. */
    private final Map<String, Object> locks = new ConcurrentHashMap<>();

    public OnlineCatalog(Path dataDir) throws IOException {
        this.root = dataDir.resolve("catalog").resolve("online");
        this.indexDir = root.resolve("index");
        this.productDir = root.resolve("products");
        Files.createDirectories(indexDir);
        Files.createDirectories(productDir);
        this.http = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(20))
                .followRedirects(HttpClient.Redirect.NORMAL)
                .build();
    }

    /* ---------------- Pruefung der Eingaben ---------------- *
     * Alles, was von der Oberflaeche kommt, wird hier geprueft, bevor es in eine
     * URL, einen Rumpf oder einen Dateinamen geraet.                          */

    public static int checkManufacturerId(int id) {
        if (id < 0 || id > MAX_MANUFACTURER_ID) {
            throw new IllegalArgumentException("Hersteller-Nummer ausserhalb 0.." + MAX_MANUFACTURER_ID);
        }
        return id;
    }

    public static String checkLanguage(String lang) {
        if (lang == null || !LANGUAGE.matcher(lang).matches()) {
            throw new IllegalArgumentException("Unbrauchbare Sprachkennung: " + shorten(lang));
        }
        return lang;
    }

    public static String checkCatalogId(String id) {
        if (id == null || !CATALOG_ID.matcher(id).matches() || id.contains("..")) {
            throw new IllegalArgumentException("Unbrauchbare Katalog-Id");
        }
        return id;
    }

    /** Haelt Fehlermeldungen kurz - die Eingabe kann beliebig lang sein. */
    private static String shorten(String s) {
        if (s == null) return "(fehlt)";
        return s.length() <= 40 ? s : s.substring(0, 40) + "…";
    }

    public static String checkQuery(String q) {
        String s = q == null ? "" : q.strip();
        return s.length() > MAX_QUERY ? s.substring(0, MAX_QUERY) : s;
    }

    /* ---------------- Hersteller ---------------- */

    /** Nummern aus dem Katalog, Klarnamen aus den Stammdaten, zusammengefuehrt und gecacht. */
    public Map<String, Object> manufacturers(boolean refresh) throws IOException {
        Path cache = root.resolve("manufacturers.json");
        synchronized (lock("manufacturers")) {
            Map<String, Object> cached = readJson(cache);
            if (!refresh && cached != null && age(cached) < MANUFACTURERS_TTL) return cached;

            List<Integer> ids;
            Map<Integer, String> names;
            try {
                ids = parseManufacturerIds(getText(URI.create(BASE + "/Download/Manufacturers"), 1 << 20));
                names = parseManufacturerNames(getText(URI.create(MASTER), 16 << 20));
            } catch (IOException e) {
                // Lieber ein alter Stand als gar keiner - offline bleibt die Liste brauchbar.
                if (cached != null) return cached;
                throw e;
            }

            List<Object> entries = Json.arr();
            for (int id : ids) {
                Map<String, Object> m = Json.obj();
                m.put("id", id);
                m.put("name", names.getOrDefault(id, "Hersteller " + id));
                m.put("cached", Files.isRegularFile(indexFile(id)));
                entries.add(m);
            }
            entries.sort(Comparator.comparing(o -> nameOf(o).toLowerCase(Locale.ROOT)));

            Map<String, Object> doc = Json.obj();
            doc.put("fetchedAt", System.currentTimeMillis());
            doc.put("entries", entries);
            writeJson(cache, doc);
            return doc;
        }
    }

    static List<Integer> parseManufacturerIds(String xml) {
        List<Integer> out = new ArrayList<>();
        Matcher m = MANUFACTURER_ID.matcher(xml);
        while (m.find()) out.add(Integer.parseInt(m.group(1)));
        if (out.isEmpty()) throw new IllegalStateException("Herstellerliste enthaelt keine Nummern");
        return out;
    }

    /**
     * Zieht die Klarnamen aus knx_master.xml. Gelesen wird Element fuer Element
     * mit einem Ausdruck statt mit einem XML-Parser - gebraucht werden nur zwei
     * Attribute aus einer Datei mit festem Aufbau.
     */
    static Map<Integer, String> parseManufacturerNames(String xml) {
        Map<Integer, String> out = new LinkedHashMap<>();
        Matcher tag = MANUFACTURER_TAG.matcher(xml);
        while (tag.find()) {
            String el = tag.group();
            Matcher id = ATTR_KNX_ID.matcher(el);
            Matcher name = ATTR_NAME.matcher(el);
            if (id.find() && name.find()) out.put(Integer.parseInt(id.group(1)), unescapeXml(name.group(1)));
        }
        return out;
    }

    /* ---------------- Produktindex eines Herstellers ---------------- */

    /**
     * Der Index eines Herstellers, eingedampft auf die angezeigten Felder und in
     * der gewuenschten Sprache. Ohne `refresh` wird geliefert, was im Cache liegt.
     */
    public Map<String, Object> index(int manufacturerId, String language, boolean refresh) throws IOException {
        checkManufacturerId(manufacturerId);
        checkLanguage(language);
        Path cache = indexFile(manufacturerId);
        synchronized (lock("index-" + manufacturerId)) {
            Map<String, Object> cached = readJson(cache);
            if (!refresh && cached != null && language.equals(Json.str(cached, "language", ""))) {
                cached.put("stale", age(cached) > INDEX_TTL);
                return cached;
            }
            Map<String, Object> doc = fetchIndex(manufacturerId, language);
            writeJson(cache, doc);
            doc.put("stale", false);
            return doc;
        }
    }

    private Map<String, Object> fetchIndex(int manufacturerId, String language) throws IOException {
        byte[] body = getBytes(URI.create(BASE + "/Download/Index/" + manufacturerId), MAX_INDEX_BYTES);
        Map<String, Object> raw = Json.parseObject(stripBom(new String(body, StandardCharsets.UTF_8)));
        Map<String, Object> doc = slim(raw, manufacturerId, language);
        doc.put("sourceBytes", body.length);   // was der Abruf gekostet hat
        return doc;
    }

    /**
     * Aus der Antwort des Katalogs wird das, was die Liste zeigt - der Rest faellt
     * weg. Jedes uebernommene Feld muss den erwarteten Typ haben und die Laengen-
     * grenzen einhalten, sonst wird es ausgelassen. Ein Eintrag ohne brauchbare
     * Katalog-Id ist wertlos, weil sich dazu nichts herunterladen laesst.
     */
    @SuppressWarnings("unchecked")
    static Map<String, Object> slim(Map<String, Object> raw, int manufacturerId, String language) {
        List<Object> entries = Json.arr();
        int dropped = 0;
        if (raw.get("Entries") instanceof List<?> list) {
            for (Object o : list) {
                if (entries.size() >= MAX_ENTRIES) { dropped += 1; continue; }
                if (!(o instanceof Map)) { dropped++; continue; }
                Map<String, Object> e = (Map<String, Object>) o;
                Map<String, Object> slim = Json.obj();
                KEEP.forEach((key, kind) -> {
                    Object v = check(e.get(key), kind);
                    if (v != null) slim.put(key, v);
                });
                if (!(slim.get("Id") instanceof String id)
                        || !CATALOG_ID.matcher(id).matches() || id.contains("..")) {
                    dropped++;
                    continue;
                }
                applyTranslation(e, slim, language);
                // Ohne irgendeine Bezeichnung ist der Eintrag in der Liste nicht wiederzuerkennen.
                if (!slim.containsKey("ProductName") && !slim.containsKey("CatalogItemName")
                        && !slim.containsKey("OrderNumber")) {
                    dropped++;
                    continue;
                }
                entries.add(slim);
            }
        }
        Map<String, Object> doc = Json.obj();
        doc.put("manufacturerId", manufacturerId);
        doc.put("manufacturerName",
                text(Json.str(raw, "ManufacturerName", null), "Hersteller " + manufacturerId));
        doc.put("version", Json.integer(raw, "Version", 0));
        doc.put("language", language);
        doc.put("fetchedAt", System.currentTimeMillis());
        doc.put("dropped", dropped);
        doc.put("entries", entries);
        return doc;
    }

    /** Liefert den Wert, wenn er dem erwarteten Typ und den Grenzen entspricht, sonst null. */
    private static Object check(Object v, Kind kind) {
        if (v == null) return null;
        switch (kind) {
            case TEXT:
                return v instanceof String s && !s.isBlank() ? cut(s) : null;
            case NUMBER:
                return v instanceof Number n && !(n instanceof Double d && (d.isNaN() || d.isInfinite()))
                        ? n : null;
            case FLAG:
                return v instanceof Boolean b ? b : null;
            case TEXTS:
            case NUMBERS: {
                if (!(v instanceof List<?> list)) return null;
                List<Object> out = Json.arr();
                for (Object x : list) {
                    if (out.size() >= MAX_LIST) break;
                    if (kind == Kind.TEXTS && x instanceof String s && !s.isBlank()) out.add(cut(s));
                    else if (kind == Kind.NUMBERS && x instanceof Number n) out.add(n);
                }
                return out.isEmpty() ? null : out;
            }
            default:
                return null;
        }
    }

    private static String cut(String s) {
        String t = s.strip();
        return t.length() > MAX_TEXT ? t.substring(0, MAX_TEXT) : t;
    }

    private static String text(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : cut(value);
    }

    /**
     * Uebersetzungen machen den Loewenanteil der Antwort aus. Behalten wird nur
     * die gewuenschte Sprache, und zwar gleich als Name des Eintrags.
     */
    @SuppressWarnings("unchecked")
    private static void applyTranslation(Map<String, Object> entry, Map<String, Object> slim, String language) {
        Object list = entry.get("Translations");
        if (!(list instanceof List<?> items)) return;
        for (Object o : items) {
            if (!(o instanceof Map)) continue;
            Map<String, Object> t = (Map<String, Object>) o;
            if (!language.equalsIgnoreCase(Json.str(t, "Language", ""))) continue;
            if (!(t.get("Translation") instanceof Map)) return;
            Map<String, Object> v = (Map<String, Object>) t.get("Translation");
            put(slim, "CatalogItemName", Json.str(v, "CatalogItemName", null));
            put(slim, "ProductName", Json.str(v, "ProductText", null));
            put(slim, "ApplicationProgramName", Json.str(v, "ApplicationProgramName", null));
            return;
        }
    }

    private static void put(Map<String, Object> m, String key, String value) {
        if (value != null && !value.isBlank()) m.put(key, cut(value));
    }

    /* ---------------- Suche ueber das, was schon im Cache liegt ---------------- */

    /**
     * Durchsucht die bereits geholten Herstellerindizes. Fuehrt bewusst zu keiner
     * einzigen Netzabfrage - gesucht wird in dem, was der Rechner schon hat.
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> search(String query, int limit) throws IOException {
        String q = checkQuery(query).toLowerCase(Locale.ROOT);
        List<Object> hits = Json.arr();
        int scanned = 0;
        if (q.isEmpty()) return result(hits, 0, false);

        try (Stream<Path> files = Files.list(indexDir)) {
            for (Path p : files.filter(f -> f.getFileName().toString().endsWith(".json")).toList()) {
                Map<String, Object> doc = readJson(p);
                if (doc == null || !(doc.get("entries") instanceof List<?> entries)) continue;
                scanned++;
                String maker = Json.str(doc, "manufacturerName", "");
                for (Object o : entries) {
                    if (!(o instanceof Map)) continue;
                    Map<String, Object> e = (Map<String, Object>) o;
                    if (!matches(e, maker, q)) continue;
                    if (hits.size() >= limit) return result(hits, scanned, true);
                    Map<String, Object> hit = new LinkedHashMap<>(e);
                    hit.put("manufacturerId", Json.integer(doc, "manufacturerId", 0));
                    hit.put("manufacturerName", maker);
                    hits.add(hit);
                }
            }
        }
        return result(hits, scanned, false);
    }

    private static Map<String, Object> result(List<Object> hits, int scanned, boolean truncated) {
        Map<String, Object> m = Json.obj();
        m.put("entries", hits);
        m.put("manufacturersSearched", scanned);
        m.put("truncated", truncated);
        return m;
    }

    private static boolean matches(Map<String, Object> e, String maker, String q) {
        return contains(Json.str(e, "CatalogItemName", ""), q)
                || contains(Json.str(e, "ProductName", ""), q)
                || contains(Json.str(e, "OrderNumber", ""), q)
                || contains(Json.str(e, "ApplicationProgramName", ""), q)
                || contains(maker, q);
    }

    private static boolean contains(String haystack, String needle) {
        return haystack.toLowerCase(Locale.ROOT).contains(needle);
    }

    /* ---------------- Produktdatei ---------------- */

    /**
     * Die .knxprod zu einer Katalog-Id. Der Schluessel enthaelt die Version der
     * Applikation, darum wird eine einmal geholte Datei nie wieder angefragt.
     */
    public byte[] product(String catalogId, String language) throws IOException {
        checkCatalogId(catalogId);
        checkLanguage(language);
        Path cache = productFile(catalogId, language);
        synchronized (lock("product-" + cache.getFileName())) {
            if (Files.isRegularFile(cache)) return Files.readAllBytes(cache);

            Map<String, Object> body = Json.obj();
            body.put("CatalogIds", List.of(catalogId));
            body.put("LanguageIds", List.of(language));
            byte[] data = post(URI.create(BASE + "/Download/DownloadProduct"), Json.write(body));

            // Der Dienst meldet Fehler mit Status 200 nicht, wohl aber mit JSON statt ZIP.
            if (data.length < 4 || data[0] != 'P' || data[1] != 'K') {
                throw new IOException("Der Katalog liefert keine Produktdatei: " + describe(data));
            }
            Files.write(cache, data);
            return data;
        }
    }

    private static String describe(byte[] data) {
        String text = new String(data, 0, Math.min(data.length, 400), StandardCharsets.UTF_8).trim();
        try {
            Map<String, Object> m = Json.parseObject(text);
            String id = Json.str(m, "Id", "");
            if ("NotInAnyMarket".equals(id)) return "Das Produkt wird in keinem Markt mehr angeboten";
            if (!id.isEmpty()) return id;
        } catch (RuntimeException ignored) {
            // dann eben der Rohtext
        }
        return text.isEmpty() ? "leere Antwort" : text;
    }

    /* ---------------- Alle Hersteller auf Vorrat ---------------- */

    /**
     * Holt die noch fehlenden Herstellerindizes. Gemessen sind das fuer alle 252
     * Hersteller rund 61 MB Uebertragung in etwa einer Viertelminute, aus denen
     * gut 5 MB Cache werden. Bereits vorhandene Hersteller werden uebersprungen,
     * ein Abbruch verliert also nichts.
     */
    public Map<String, Object> syncAll(String language, boolean force, BiConsumer<String, Object> progress)
            throws IOException, InterruptedException {
        checkLanguage(language);
        List<Object> all = entriesOf(manufacturers(false));
        int done = 0, fetched = 0, failed = 0;
        long bytes = 0, sourceBytes = 0;
        List<Object> problems = Json.arr();

        for (Object o : all) {
            if (Thread.currentThread().isInterrupted()) throw new InterruptedException("abgebrochen");
            done++;
            int id = idOf(o);
            if (!force && Files.isRegularFile(indexFile(id))) continue;
            try {
                Map<String, Object> doc = fetchIndex(id, language);
                writeJson(indexFile(id), doc);
                fetched++;
                bytes += Files.size(indexFile(id));
                sourceBytes += Json.integer(doc, "sourceBytes", 0);
            } catch (IOException e) {
                failed++;
                Map<String, Object> p = Json.obj();
                p.put("id", id);
                p.put("name", nameOf(o));
                p.put("error", e.getMessage());
                problems.add(p);
            }
            if (progress != null) {
                Map<String, Object> detail = Json.obj();
                detail.put("done", done);
                detail.put("total", all.size());
                detail.put("fetched", fetched);
                detail.put("failed", failed);
                progress.accept(nameOf(o), detail);
            }
        }
        // Die Herstellerliste merkt sich, wer nun im Cache liegt.
        refreshCachedFlags();

        Map<String, Object> m = Json.obj();
        m.put("total", all.size());
        m.put("fetched", fetched);
        m.put("failed", failed);
        m.put("bytes", bytes);
        m.put("sourceBytes", sourceBytes);
        m.put("problems", problems);
        return m;
    }

    /* ---------------- Cache ---------------- */

    public Map<String, Object> status() throws IOException {
        Map<String, Object> m = Json.obj();
        m.put("indexes", count(indexDir, ".json"));
        m.put("indexBytes", size(indexDir));
        m.put("products", count(productDir, ".knxprod"));
        m.put("productBytes", size(productDir));
        Map<String, Object> mans = readJson(root.resolve("manufacturers.json"));
        m.put("manufacturers", mans == null ? 0 : entriesOf(mans).size());
        m.put("manufacturersFetchedAt", mans == null ? null : mans.get("fetchedAt"));
        m.put("dir", root.toString());
        return m;
    }

    /** Leert den Cache; `what` ist "index", "products" oder "all". */
    public Map<String, Object> clear(String what) throws IOException {
        int removed = 0;
        if (!"products".equals(what)) removed += deleteIn(indexDir);
        if (!"index".equals(what)) removed += deleteIn(productDir);
        if ("all".equals(what)) {
            Files.deleteIfExists(root.resolve("manufacturers.json"));
            removed++;
        } else {
            refreshCachedFlags();
        }
        Map<String, Object> m = Json.obj();
        m.put("removed", removed);
        return m;
    }

    /** Haelt das Merkmal "liegt im Cache" in der Herstellerliste aktuell. */
    private void refreshCachedFlags() throws IOException {
        Path cache = root.resolve("manufacturers.json");
        Map<String, Object> doc = readJson(cache);
        if (doc == null) return;
        for (Object o : entriesOf(doc)) {
            if (o instanceof Map<?, ?> m) {
                @SuppressWarnings("unchecked")
                Map<String, Object> e = (Map<String, Object>) m;
                e.put("cached", Files.isRegularFile(indexFile(idOf(o))));
            }
        }
        writeJson(cache, doc);
    }

    /* ---------------- HTTP ---------------- */

    private String getText(URI uri, int maxBytes) throws IOException {
        return stripBom(new String(getBytes(uri, maxBytes), StandardCharsets.UTF_8));
    }

    private byte[] getBytes(URI uri, int maxBytes) throws IOException {
        HttpRequest req = HttpRequest.newBuilder(uri)
                .header("User-Agent", AGENT)
                .header("Accept", "*/*")
                .timeout(Duration.ofSeconds(120))
                .GET()
                .build();
        return send(req, maxBytes);
    }

    private byte[] post(URI uri, String json) throws IOException {
        HttpRequest req = HttpRequest.newBuilder(uri)
                .header("User-Agent", AGENT)
                .header("Content-Type", "application/json")
                .header("Accept", "*/*")
                .timeout(Duration.ofSeconds(180))
                .POST(HttpRequest.BodyPublishers.ofString(json, StandardCharsets.UTF_8))
                .build();
        return send(req, MAX_PRODUCT_BYTES);
    }

    private byte[] send(HttpRequest req, int maxBytes) throws IOException {
        HttpResponse<byte[]> res;
        try {
            res = http.send(req, HttpResponse.BodyHandlers.ofByteArray());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("Abfrage abgebrochen");
        }
        byte[] data = res.body() == null ? new byte[0] : res.body();
        if (res.statusCode() == 404) throw new IOException("Im Onlinekatalog nicht vorhanden (404)");
        if (res.statusCode() >= 400) {
            throw new IOException("Onlinekatalog antwortet mit " + res.statusCode() + ": " + describe(data));
        }
        if (data.length > maxBytes) throw new IOException("Antwort groesser als " + maxBytes + " Byte");
        return data;
    }

    /* ---------------- Ablage ---------------- */

    private Path indexFile(int manufacturerId) {
        return indexDir.resolve(manufacturerId + ".json");
    }

    /** Katalog-Ids enthalten Zeichen, die kein Dateiname sein duerfen - darum ein Streuwert. */
    private Path productFile(String catalogId, String language) {
        String key = Integer.toHexString((catalogId + '|' + language).hashCode());
        String head = catalogId.replaceAll("[^A-Za-z0-9._-]", "").toLowerCase(Locale.ROOT);
        if (head.length() > 48) head = head.substring(0, 48);
        return productDir.resolve(head + "-" + key + ".knxprod");
    }

    private Map<String, Object> readJson(Path p) throws IOException {
        if (!Files.isRegularFile(p)) return null;
        try {
            return Json.parseObject(Files.readString(p, StandardCharsets.UTF_8));
        } catch (RuntimeException e) {
            Files.deleteIfExists(p);   // beschaedigt - beim naechsten Zugriff neu holen
            return null;
        }
    }

    private void writeJson(Path p, Map<String, Object> doc) throws IOException {
        Path tmp = p.resolveSibling(p.getFileName() + ".tmp");
        Files.writeString(tmp, Json.write(doc), StandardCharsets.UTF_8);
        try {
            Files.move(tmp, p, java.nio.file.StandardCopyOption.REPLACE_EXISTING,
                    java.nio.file.StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException e) {
            Files.move(tmp, p, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        }
    }

    private static int deleteIn(Path dir) throws IOException {
        int n = 0;
        try (Stream<Path> files = Files.list(dir)) {
            for (Path p : files.filter(Files::isRegularFile).toList()) {
                Files.deleteIfExists(p);
                n++;
            }
        }
        return n;
    }

    private static int count(Path dir, String suffix) throws IOException {
        try (Stream<Path> files = Files.list(dir)) {
            return (int) files.filter(p -> p.getFileName().toString().endsWith(suffix)).count();
        }
    }

    private static long size(Path dir) throws IOException {
        try (Stream<Path> files = Files.list(dir)) {
            long total = 0;
            for (Path p : files.filter(Files::isRegularFile).toList()) total += Files.size(p);
            return total;
        }
    }

    /* ---------------- Kleinkram ---------------- */

    private Object lock(String key) {
        return locks.computeIfAbsent(key, k -> new Object());
    }

    private static long age(Map<String, Object> doc) {
        Object at = doc.get("fetchedAt");
        return at instanceof Number n ? System.currentTimeMillis() - n.longValue() : Long.MAX_VALUE;
    }

    @SuppressWarnings("unchecked")
    private static List<Object> entriesOf(Map<String, Object> doc) {
        return doc.get("entries") instanceof List ? (List<Object>) doc.get("entries") : List.of();
    }

    @SuppressWarnings("unchecked")
    private static String nameOf(Object entry) {
        return entry instanceof Map ? Json.str((Map<String, Object>) entry, "name", "") : "";
    }

    @SuppressWarnings("unchecked")
    private static int idOf(Object entry) {
        return entry instanceof Map ? Json.integer((Map<String, Object>) entry, "id", 0) : 0;
    }

    private static String stripBom(String s) {
        return !s.isEmpty() && s.charAt(0) == '﻿' ? s.substring(1) : s;
    }

    private static String unescapeXml(String s) {
        return s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"")
                .replace("&apos;", "'").replace("&amp;", "&");
    }
}
