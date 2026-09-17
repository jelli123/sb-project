package de.sb.knx.api;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import de.sb.knx.http.Events;
import de.sb.knx.http.Http;
import de.sb.knx.http.Jobs;
import de.sb.knx.json.Json;
import de.sb.knx.online.OnlineCatalog;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Onlinekatalog: Hersteller, Produktindex, Suche und Produktdatei.
 * Der Dienst nach aussen spricht nur diese Klasse an; die Oberflaeche sieht
 * immer den lokalen Cache und merkt vom Netz nur die Wartezeit.
 */
public final class OnlineApi implements HttpHandler {

    private static final String BASE = "/api/online";
    private static final String DEFAULT_LANGUAGE = "de-DE";
    private static final int SEARCH_LIMIT = 400;

    private final OnlineCatalog catalog;
    private final Jobs jobs;
    private final Events events;
    private final int port;

    /** Ein Strang genuegt: mehr gleichzeitige Abfragen belasten den Katalog nur unnoetig. */
    private final ExecutorService worker = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "online-katalog");
        t.setDaemon(true);
        return t;
    });

    public OnlineApi(OnlineCatalog catalog, Jobs jobs, Events events, int port) {
        this.catalog = catalog;
        this.jobs = jobs;
        this.events = events;
        this.port = port;
    }

    @Override
    public void handle(HttpExchange ex) throws IOException {
        if (!Http.localOnly(ex, port)) return;
        String path = ex.getRequestURI().getPath();
        String method = ex.getRequestMethod();
        try {
            switch (path) {
                case BASE + "/status" -> Http.json(ex, 200, catalog.status());
                case BASE + "/manufacturers" -> manufacturers(ex);
                case BASE + "/index" -> index(ex);
                case BASE + "/search" -> search(ex);
                case BASE + "/product" -> product(ex);
                case BASE + "/sync" -> sync(ex, method);
                case BASE + "/cache" -> cache(ex, method);
                default -> {
                    if (path.startsWith(BASE + "/jobs/")) job(ex, path, method);
                    else Http.error(ex, 404, "Unbekannter Pfad: " + path);
                }
            }
        } catch (IllegalArgumentException e) {
            Http.error(ex, 400, String.valueOf(e.getMessage()));
        } catch (IOException e) {
            Http.error(ex, 502, String.valueOf(e.getMessage()));
        }
    }

    private void manufacturers(HttpExchange ex) throws IOException {
        Http.json(ex, 200, catalog.manufacturers(flag(ex, "refresh")));
    }

    private void index(HttpExchange ex) throws IOException {
        Map<String, String> q = Http.query(ex);
        int id = number(q.get("manufacturer"), "Hersteller-Nummer");
        Http.json(ex, 200, catalog.index(id, language(q), flag(ex, "refresh")));
    }

    private void search(HttpExchange ex) throws IOException {
        Map<String, String> q = Http.query(ex);
        Http.json(ex, 200, catalog.search(q.getOrDefault("q", ""), SEARCH_LIMIT));
    }

    private void product(HttpExchange ex) throws IOException {
        Map<String, String> q = Http.query(ex);
        String id = q.get("id");
        if (id == null || id.isBlank()) throw new IllegalArgumentException("Katalog-Id fehlt");
        byte[] data = catalog.product(id, language(q));
        Http.send(ex, 200, "application/octet-stream", data);
    }

    /**
     * Holt alle noch fehlenden Herstellerindizes im Hintergrund - fuer einen leeren
     * Cache rund 61 MB. Laeuft nur auf Knopfdruck und laesst sich jederzeit
     * abbrechen, ohne das Erreichte zu verlieren.
     */
    private void sync(HttpExchange ex, String method) throws IOException {
        if (!"POST".equals(method)) {
            Http.error(ex, 405, "Methode nicht erlaubt");
            return;
        }
        Map<String, Object> body = Http.jsonBody(ex);
        String language = Json.str(body, "language", DEFAULT_LANGUAGE);
        boolean force = Json.bool(body, "force", false);

        String[] holder = new String[1];
        holder[0] = jobs.submit("katalog", worker, () -> {
            events.log("info", "Onlinekatalog wird vollstaendig geholt");
            Map<String, Object> result = catalog.syncAll(language, force,
                    (name, detail) -> jobs.progress(holder[0], name, detail));
            events.log("info", "Onlinekatalog: " + Json.integer(result, "fetched", 0) + " Hersteller geholt");
            return result;
        });

        Map<String, Object> m = Json.obj();
        m.put("job", holder[0]);
        Http.json(ex, 202, m);
    }

    private void job(HttpExchange ex, String path, String method) throws IOException {
        String rest = path.substring((BASE + "/jobs/").length());
        boolean cancel = rest.endsWith("/cancel");
        String id = cancel ? rest.substring(0, rest.length() - "/cancel".length()) : rest;

        if (cancel) {
            if (!"POST".equals(method)) {
                Http.error(ex, 405, "Methode nicht erlaubt");
                return;
            }
            Map<String, Object> m = Json.obj();
            m.put("cancelled", jobs.cancel(id));
            Http.json(ex, 200, m);
            return;
        }
        Map<String, Object> status = jobs.status(id);
        if (status == null) Http.error(ex, 404, "Auftrag nicht gefunden: " + id);
        else Http.json(ex, 200, status);
    }

    private void cache(HttpExchange ex, String method) throws IOException {
        if (!"DELETE".equals(method)) {
            Http.error(ex, 405, "Methode nicht erlaubt");
            return;
        }
        String what = Http.query(ex).getOrDefault("what", "all");
        Http.json(ex, 200, catalog.clear(what));
    }

    private static String language(Map<String, String> q) {
        String lang = q.get("lang");
        return lang == null || lang.isBlank() ? DEFAULT_LANGUAGE : lang;
    }

    private static boolean flag(HttpExchange ex, String name) {
        String v = Http.query(ex).get(name);
        return "1".equals(v) || "true".equalsIgnoreCase(v);
    }

    private static int number(String raw, String what) {
        try {
            return Integer.parseInt(String.valueOf(raw).trim());
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException(what + " fehlt oder ist keine Zahl");
        }
    }
}
