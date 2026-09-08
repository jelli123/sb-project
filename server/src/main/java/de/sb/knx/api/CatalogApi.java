package de.sb.knx.api;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import de.sb.knx.http.Http;
import de.sb.knx.json.Json;
import de.sb.knx.store.CatalogStore;
import de.sb.knx.store.FileStore;

import java.io.IOException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/** Produktkatalog: ausgewertete Produktdaten als JSON, dazu optional die Originaldatei. */
public final class CatalogApi implements HttpHandler {

    private static final String BASE = "/api/catalog";

    private final CatalogStore store;
    private final int port;

    public CatalogApi(CatalogStore store, int port) {
        this.store = store;
        this.port = port;
    }

    @Override
    public void handle(HttpExchange ex) throws IOException {
        if (!Http.localOnly(ex, port)) return;
        try {
            String path = ex.getRequestURI().getPath();
            String method = ex.getRequestMethod();

            if (BASE.equals(path)) {
                if ("GET".equals(method)) {
                    Map<String, Object> body = Json.obj();
                    body.put("entries", store.list());
                    Http.json(ex, 200, body);
                } else {
                    Http.error(ex, 405, "Methode nicht erlaubt");
                }
                return;
            }

            String rest = path.substring(BASE.length() + 1);
            boolean fileRequest = rest.endsWith("/file");
            if (fileRequest) rest = rest.substring(0, rest.length() - "/file".length());
            String id = FileStore.safeId(URLDecoder.decode(rest, StandardCharsets.UTF_8));

            if (fileRequest) {
                switch (method) {
                    case "GET" -> {
                        byte[] data = store.readFile(id);
                        if (data == null) Http.error(ex, 404, "Keine Produktdatei zu " + id);
                        else Http.send(ex, 200, "application/octet-stream", data);
                    }
                    case "PUT" -> {
                        store.writeFile(id, Http.body(ex, CatalogStore.MAX_BYTES));
                        ok(ex);
                    }
                    default -> Http.error(ex, 405, "Methode nicht erlaubt");
                }
                return;
            }

            switch (method) {
                case "GET" -> {
                    byte[] data = store.read(id);
                    if (data == null) Http.error(ex, 404, "Katalogeintrag nicht gefunden: " + id);
                    else Http.rawJson(ex, 200, data);
                }
                case "PUT" -> {
                    store.write(id, Http.text(ex, CatalogStore.MAX_BYTES));
                    ok(ex);
                }
                case "DELETE" -> {
                    store.delete(id);
                    ok(ex);
                }
                default -> Http.error(ex, 405, "Methode nicht erlaubt");
            }
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
}
