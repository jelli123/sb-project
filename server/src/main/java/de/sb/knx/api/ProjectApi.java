package de.sb.knx.api;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import de.sb.knx.http.Http;
import de.sb.knx.json.Json;
import de.sb.knx.store.FileStore;
import de.sb.knx.store.ProjectStore;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/** Projektablage: Liste, Laden, Speichern, Umbenennen, Loeschen. */
public final class ProjectApi implements HttpHandler {

    private final ProjectStore store;
    private final int port;

    public ProjectApi(ProjectStore store, int port) {
        this.store = store;
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
                        if (data == null) Http.error(ex, 404, "Projekt nicht gefunden: " + id);
                        else Http.rawJson(ex, 200, data);
                    }
                    case "PUT" -> {
                        store.write(id, Http.text(ex, ProjectStore.MAX_BYTES));
                        ok(ex);
                    }
                    case "DELETE" -> {
                        store.delete(id);
                        ok(ex);
                    }
                    case "POST" -> {
                        String target = Json.str(Http.jsonBody(ex), "name", null);
                        if (target == null) {
                            Http.error(ex, 400, "Feld name fehlt");
                            return;
                        }
                        store.rename(id, FileStore.safeId(target));
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

    private static String decode(String s) {
        return java.net.URLDecoder.decode(s, StandardCharsets.UTF_8);
    }
}
