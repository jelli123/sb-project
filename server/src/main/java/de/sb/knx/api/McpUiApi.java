package de.sb.knx.api;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import de.sb.knx.http.Events;
import de.sb.knx.http.Http;
import de.sb.knx.json.Json;
import de.sb.knx.mcp.McpGate;
import de.sb.knx.store.FileStore;

import java.io.IOException;
import java.util.Map;

/**
 * Die Seite der Oberflaeche am KI-Zugang: Freigabe je Projekt, Zustand, Ergebnisse der Werkzeuge,
 * Vorschau und neuer Zugangsschluessel. Der Schluessel selbst geht hier nie hinaus.
 */
public final class McpUiApi implements HttpHandler {

    /** Ergebnisse koennen gross sein (Gebaeudestruktur, Geraetelisten); begrenzt wird trotzdem. */
    private static final int MAX_RESULT_BYTES = 8 << 20;

    private final McpGate gate;
    private final int port;

    public McpUiApi(McpGate gate, int port) {
        this.gate = gate;
        this.port = port;
    }

    @Override
    public void handle(HttpExchange ex) throws IOException {
        if (!Http.localOnly(ex, port)) return;
        String path = ex.getRequestURI().getPath();
        String method = ex.getRequestMethod();
        String window = Events.windowId(ex.getRequestHeaders().getFirst("X-SB-Window"));
        try {
            switch (path) {
                case "/api/mcp/status" -> Http.json(ex, 200, gate.status(project(Http.query(ex).get("project"))));
                case "/api/mcp/mode" -> {
                    requirePost(method);
                    Map<String, Object> body = Http.jsonBody(ex);
                    String project = project(Json.str(body, "project", null));
                    gate.setMode(project, window, Json.str(body, "mode", ""));
                    Http.json(ex, 200, gate.status(project));
                }
                case "/api/mcp/result" -> {
                    requirePost(method);
                    gate.result(window, Json.parseObject(Http.text(ex, MAX_RESULT_BYTES)));
                    ok(ex);
                }
                case "/api/mcp/preview" -> {
                    requirePost(method);
                    Map<String, Object> body = Json.parseObject(Http.text(ex, MAX_RESULT_BYTES));
                    Http.json(ex, 200, gate.preview(project(Json.str(body, "project", null)),
                            Json.str(body, "tool", ""), body));
                }
                case "/api/mcp/token" -> {
                    requirePost(method);
                    gate.rotateToken();
                    ok(ex);
                }
                default -> Http.error(ex, 404, "Unbekannter Pfad");
            }
        } catch (IllegalArgumentException | IllegalStateException e) {
            Http.error(ex, 400, String.valueOf(e.getMessage()));
        }
    }

    private static String project(String raw) {
        if (raw == null) throw new IllegalArgumentException("Feld project fehlt");
        return FileStore.safeId(raw);
    }

    private static void requirePost(String method) {
        if (!"POST".equals(method)) throw new IllegalArgumentException("POST erwartet");
    }

    private static void ok(HttpExchange ex) throws IOException {
        Map<String, Object> m = Json.obj();
        m.put("ok", true);
        Http.json(ex, 200, m);
    }
}
