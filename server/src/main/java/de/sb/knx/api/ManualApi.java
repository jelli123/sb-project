package de.sb.knx.api;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import de.sb.knx.chat.ManualStore;
import de.sb.knx.http.Http;
import de.sb.knx.json.Json;

import java.io.IOException;
import java.util.Map;

/** Handbuecher: auflisten, hochladen, Titel und Produkte zuordnen, loeschen, im Browser ansehen. */
public final class ManualApi implements HttpHandler {

    private final ManualStore store;
    private final int port;

    public ManualApi(ManualStore store, int port) {
        this.store = store;
        this.port = port;
    }

    @Override
    public void handle(HttpExchange ex) throws IOException {
        if (!Http.localOnly(ex, port)) return;
        String path = ex.getRequestURI().getPath();
        try {
            switch (path) {
                case "/api/manuals" -> {
                    Map<String, Object> m = Json.obj();
                    m.put("manuals", store.list());
                    m.put("maxBytes", ManualStore.MAX_BYTES);
                    Http.json(ex, 200, m);
                }
                case "/api/manuals/upload" -> {
                    requirePost(ex);
                    String title = Http.query(ex).getOrDefault("title", "");
                    byte[] pdf;
                    try {
                        pdf = Http.body(ex, ManualStore.MAX_BYTES);
                    } catch (IOException e) {
                        throw new IllegalArgumentException("Handbuecher duerfen hoechstens " + (ManualStore.MAX_BYTES >> 20) + " MB gross sein");
                    }
                    Http.json(ex, 200, store.add(pdf, title));
                }
                case "/api/manuals/update" -> {
                    requirePost(ex);
                    Map<String, Object> body = Http.jsonBody(ex);
                    Http.json(ex, 200, store.update(Json.str(body, "id", null),
                            body.get("title") instanceof String t ? t : null, body.get("products")));
                }
                case "/api/manuals/delete" -> {
                    requirePost(ex);
                    Map<String, Object> m = Json.obj();
                    m.put("deleted", store.delete(Json.str(Http.jsonBody(ex), "id", null)));
                    Http.json(ex, 200, m);
                }
                case "/api/manuals/file" -> {
                    byte[] pdf = store.read(Http.query(ex).get("id"));
                    if (pdf == null) {
                        Http.error(ex, 404, "Dieses Handbuch gibt es nicht mehr");
                    } else {
                        ex.getResponseHeaders().set("Content-Disposition", "inline");
                        ex.getResponseHeaders().set("Content-Security-Policy", "sandbox");
                        Http.send(ex, 200, "application/pdf", pdf);
                    }
                }
                default -> Http.error(ex, 404, "Unbekannter Pfad");
            }
        } catch (IllegalArgumentException | IllegalStateException e) {
            Http.error(ex, 400, String.valueOf(e.getMessage()));
        }
    }

    private static void requirePost(HttpExchange ex) {
        if (!"POST".equals(ex.getRequestMethod())) throw new IllegalArgumentException("POST erwartet");
    }
}
