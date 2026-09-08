package de.sb.knx.http;

import com.sun.net.httpserver.HttpExchange;
import de.sb.knx.json.Json;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/** Kleine Helfer fuer die HTTP-Schicht: Antworten, Rumpf lesen, lokale Herkunft pruefen. */
public final class Http {

    /** Nur diese Hostnamen sind zulaessig - schuetzt gegen DNS-Rebinding aus dem Browser. */
    private static final Set<String> LOCAL_HOSTS = Set.of("127.0.0.1", "localhost", "[::1]", "::1");

    private Http() {}

    public static void json(HttpExchange ex, int status, Object body) throws IOException {
        send(ex, status, "application/json; charset=utf-8", Json.write(body).getBytes(StandardCharsets.UTF_8));
    }

    public static void rawJson(HttpExchange ex, int status, byte[] body) throws IOException {
        send(ex, status, "application/json; charset=utf-8", body);
    }

    public static void error(HttpExchange ex, int status, String message) throws IOException {
        Map<String, Object> m = Json.obj();
        m.put("error", message);
        json(ex, status, m);
    }

    public static void send(HttpExchange ex, int status, String contentType, byte[] body) throws IOException {
        ex.getResponseHeaders().set("Content-Type", contentType);
        ex.getResponseHeaders().set("Cache-Control", "no-store");
        ex.getResponseHeaders().set("X-Content-Type-Options", "nosniff");
        boolean head = "HEAD".equalsIgnoreCase(ex.getRequestMethod());
        ex.sendResponseHeaders(status, head ? -1 : body.length);
        if (!head && body.length > 0) {
            try (OutputStream out = ex.getResponseBody()) {
                out.write(body);
            }
        } else {
            ex.close();
        }
    }

    public static byte[] body(HttpExchange ex, int maxBytes) throws IOException {
        try (InputStream in = ex.getRequestBody()) {
            byte[] data = in.readNBytes(maxBytes + 1);
            if (data.length > maxBytes) throw new IOException("Rumpf groesser als " + maxBytes + " Byte");
            return data;
        }
    }

    public static String text(HttpExchange ex, int maxBytes) throws IOException {
        return new String(body(ex, maxBytes), StandardCharsets.UTF_8);
    }

    public static Map<String, Object> jsonBody(HttpExchange ex) throws IOException {
        String raw = text(ex, 1 << 20).trim();
        if (raw.isEmpty()) return Json.obj();
        return Json.parseObject(raw);
    }

    public static Map<String, String> query(HttpExchange ex) {
        Map<String, String> out = new HashMap<>();
        String q = ex.getRequestURI().getRawQuery();
        if (q == null || q.isEmpty()) return out;
        for (String pair : q.split("&")) {
            int i = pair.indexOf('=');
            String k = i < 0 ? pair : pair.substring(0, i);
            String v = i < 0 ? "" : pair.substring(i + 1);
            out.put(decode(k), decode(v));
        }
        return out;
    }

    private static String decode(String s) {
        return URLDecoder.decode(s, StandardCharsets.UTF_8);
    }

    /**
     * Laesst nur Anfragen durch, die tatsaechlich von der lokalen Oberflaeche stammen.
     * Der Dienst lauscht ohnehin nur auf 127.0.0.1; Host- und Origin-Pruefung verhindern,
     * dass eine beliebige Webseite im Browser den Bus fernsteuert.
     */
    public static boolean localOnly(HttpExchange ex, int port) throws IOException {
        String host = header(ex, "Host");
        if (host != null && !LOCAL_HOSTS.contains(hostOnly(host))) {
            error(ex, 403, "Unerlaubter Host-Kopf: " + host);
            return false;
        }
        String origin = header(ex, "Origin");
        if (origin != null && !origin.equals("null")) {
            String expectedA = "http://127.0.0.1:" + port;
            String expectedB = "http://localhost:" + port;
            if (!origin.equals(expectedA) && !origin.equals(expectedB)) {
                error(ex, 403, "Unerlaubte Herkunft: " + origin);
                return false;
            }
        }
        return true;
    }

    private static String hostOnly(String host) {
        String h = host.toLowerCase(Locale.ROOT);
        if (h.startsWith("[")) {
            int close = h.indexOf(']');
            return close < 0 ? h : h.substring(0, close + 1);
        }
        int colon = h.indexOf(':');
        return colon < 0 ? h : h.substring(0, colon);
    }

    private static String header(HttpExchange ex, String name) {
        var values = ex.getRequestHeaders().get(name);
        return values == null || values.isEmpty() ? null : values.get(0);
    }
}
