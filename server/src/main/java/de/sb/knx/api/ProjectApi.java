package de.sb.knx.api;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import de.sb.knx.http.Events;
import de.sb.knx.http.Http;
import de.sb.knx.json.Json;
import de.sb.knx.secure.KeyVault;
import de.sb.knx.store.FileStore;
import de.sb.knx.store.ProjectStore;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/**
 * Projektablage: Liste, Laden, Speichern, Umbenennen, Loeschen.
 * Gespeichert wird mit Revisionspruefung: Wer auf einem veralteten Stand speichert (If-Match),
 * bekommt 409 statt die Aenderung eines anderen Fensters zu ueberschreiben.
 */
public final class ProjectApi implements HttpHandler {

    private final ProjectStore store;
    private final KeyVault vault;
    private final Events events;
    private final int port;

    public ProjectApi(ProjectStore store, KeyVault vault, Events events, int port) {
        this.store = store;
        this.vault = vault;
        this.events = events;
        this.port = port;
    }

    @Override
    public void handle(HttpExchange ex) throws IOException {
        if (!Http.localOnly(ex, port)) return;
        try {
            String path = ex.getRequestURI().getPath();
            String method = ex.getRequestMethod();

            if ("/api/projects".equals(path)) {
                if ("GET".equals(method)) {
                    Map<String, Object> body = Json.obj();
                    body.put("projects", store.list());
                    Http.json(ex, 200, body);
                } else {
                    Http.error(ex, 405, "Methode nicht erlaubt");
                }
                return;
            }
            if ("/api/settings".equals(path)) {
                switch (method) {
                    case "GET" -> Http.rawJson(ex, 200, store.readSettings().getBytes(StandardCharsets.UTF_8));
                    case "PUT" -> {
                        store.writeSettings(Http.text(ex, 1 << 20));
                        ok(ex);
                    }
                    default -> Http.error(ex, 405, "Methode nicht erlaubt");
                }
                return;
            }
            if (path.startsWith("/api/projects/")) {
                String id = FileStore.safeId(decode(path.substring("/api/projects/".length())));
                switch (method) {
                    case "GET" -> {
                        byte[] data = store.read(id);
                        if (data == null) {
                            Http.error(ex, 404, "Projekt nicht gefunden: " + id);
                        } else {
                            ex.getResponseHeaders().set("ETag", quote(ProjectStore.revision(data)));
                            Http.rawJson(ex, 200, data);
                        }
                    }
                    case "PUT" -> {
                        String expected = unquote(ex.getRequestHeaders().getFirst("If-Match"));
                        String rev;
                        try {
                            rev = store.write(id, Http.text(ex, ProjectStore.MAX_BYTES), expected);
                        } catch (ProjectStore.Conflict c) {
                            Map<String, Object> m = Json.obj();
                            m.put("error", c.getMessage());
                            m.put("rev", c.current);
                            Http.json(ex, 409, m);
                            return;
                        }
                        Map<String, Object> ev = Json.obj();
                        ev.put("id", id);
                        ev.put("rev", rev);
                        ev.put("by", Events.windowId(ex.getRequestHeaders().getFirst("X-SB-Window")));
                        events.publish("project", ev);
                        Map<String, Object> m = Json.obj();
                        m.put("ok", true);
                        m.put("rev", rev);
                        Http.json(ex, 200, m);
                    }
                    case "DELETE" -> {
                        store.delete(id);
                        // Die Schluessel bleiben beiseitegelegt - ohne sie kaeme man an Geraete mit Tool Key nicht mehr heran.
                        vault.retire(id);
                        ok(ex);
                    }
                    case "POST" -> {
                        String target = Json.str(Http.jsonBody(ex), "name", null);
                        if (target == null) {
                            Http.error(ex, 400, "Feld name fehlt");
                            return;
                        }
                        String newId = FileStore.safeId(target);
                        store.rename(id, newId);
                        vault.rename(id, newId);
                        ok(ex);
                    }
                    default -> Http.error(ex, 405, "Methode nicht erlaubt");
                }
                return;
            }
            Http.error(ex, 404, "Unbekannter Pfad");
        } catch (IllegalArgumentException e) {
            Http.error(ex, 400, String.valueOf(e.getMessage()));
        } catch (IOException e) {
            Http.error(ex, 500, String.valueOf(e.getMessage()));
        }
    }

    private static void ok(HttpExchange ex) throws IOException {
        Map<String, Object> m = Json.obj();
        m.put("ok", true);
        Http.json(ex, 200, m);
    }

    private static String quote(String rev) {
        return "\"" + rev + "\"";
    }

    /** If-Match kommt mit oder ohne Anfuehrungszeichen. Fehlt er, wird bedingungslos geschrieben. */
    private static String unquote(String raw) {
        if (raw == null) return null;
        String s = raw.trim();
        if (s.length() >= 2 && s.startsWith("\"") && s.endsWith("\"")) s = s.substring(1, s.length() - 1);
        if (!s.matches("[0-9a-f]{20}")) throw new IllegalArgumentException("If-Match ist keine Projektrevision");
        return s;
    }

    private static String decode(String s) {
        return java.net.URLDecoder.decode(s, StandardCharsets.UTF_8);
    }
}
