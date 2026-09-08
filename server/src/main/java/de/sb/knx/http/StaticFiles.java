package de.sb.knx.http;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;
import java.util.Map;

/** Liefert die Weboberflaeche aus einem Verzeichnis aus. */
public final class StaticFiles implements HttpHandler {

    private static final Map<String, String> TYPES = Map.of(
            "html", "text/html; charset=utf-8",
            "js", "text/javascript; charset=utf-8",
            "css", "text/css; charset=utf-8",
            "json", "application/json; charset=utf-8",
            "svg", "image/svg+xml",
            "png", "image/png",
            "ico", "image/x-icon",
            "woff2", "font/woff2");

    private final Path root;
    private final int port;

    public StaticFiles(Path root, int port) {
        this.root = root.toAbsolutePath().normalize();
        this.port = port;
    }

    @Override
    public void handle(HttpExchange ex) throws IOException {
        try {
            if (!Http.localOnly(ex, port)) return;
            String method = ex.getRequestMethod();
            if (!"GET".equals(method) && !"HEAD".equals(method)) {
                Http.error(ex, 405, "Methode nicht erlaubt");
                return;
            }
            String path = ex.getRequestURI().getPath();
            if (path.isEmpty() || "/".equals(path)) path = "/index.html";

            Path file = root.resolve(path.substring(1)).normalize();
            if (!file.startsWith(root) || !Files.isRegularFile(file)) {
                Http.send(ex, 404, "text/plain; charset=utf-8",
                        ("Nicht gefunden: " + path).getBytes(StandardCharsets.UTF_8));
                return;
            }
            Http.send(ex, 200, contentType(file), Files.readAllBytes(file));
        } catch (RuntimeException e) {
            Http.error(ex, 500, String.valueOf(e.getMessage()));
        }
    }

    private static String contentType(Path file) {
        String name = file.getFileName().toString().toLowerCase(Locale.ROOT);
        int dot = name.lastIndexOf('.');
        String ext = dot < 0 ? "" : name.substring(dot + 1);
        return TYPES.getOrDefault(ext, "application/octet-stream");
    }
}
