package de.sb.knx.api;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import de.sb.knx.http.Http;
import de.sb.knx.json.Json;
import de.sb.knx.secure.Certificate;
import de.sb.knx.secure.KeyVault;

import java.io.IOException;
import java.util.Arrays;
import java.util.Map;

/**
 * Schluesselablage fuer KNX Secure: Zustand, Entsperren, Sperren, Passwort und Geraetezertifikate.
 * Schluessel gehen hier nur hinein, nie heraus - die Antworten sagen, ob etwas vorhanden ist.
 * Einzige Ausnahme ist der Projektexport: Er bekommt die Schluesseldatei, aber nur verschluesselt
 * und nur bei entsperrter Ablage.
 */
public final class SecureApi implements HttpHandler {

    private final KeyVault vault;
    private final int port;

    public SecureApi(KeyVault vault, int port) {
        this.vault = vault;
        this.port = port;
    }

    @Override
    public void handle(HttpExchange ex) throws IOException {
        if (!Http.localOnly(ex, port)) return;
        String path = ex.getRequestURI().getPath();
        String method = ex.getRequestMethod();
        try {
            switch (path) {
                case "/api/secure/status" -> Http.json(ex, 200, vault.status(required(Http.query(ex).get("project"), "project")));
                case "/api/secure/unlock" -> {
                    requirePost(method);
                    Map<String, Object> body = Http.jsonBody(ex);
                    String project = required(Json.str(body, "project", null), "project");
                    char[] password = chars(body, "password");
                    try {
                        vault.unlock(project, password, Json.bool(body, "create", false));
                    } finally {
                        Arrays.fill(password, '\0');
                    }
                    Http.json(ex, 200, vault.status(project));
                }
                case "/api/secure/lock" -> {
                    requirePost(method);
                    String project = required(Json.str(Http.jsonBody(ex), "project", null), "project");
                    vault.lock(project);
                    Http.json(ex, 200, vault.status(project));
                }
                case "/api/secure/password" -> {
                    requirePost(method);
                    Map<String, Object> body = Http.jsonBody(ex);
                    String project = required(Json.str(body, "project", null), "project");
                    char[] old = chars(body, "password");
                    char[] next = chars(body, "newPassword");
                    try {
                        vault.changePassword(project, old, next);
                    } finally {
                        Arrays.fill(old, '\0');
                        Arrays.fill(next, '\0');
                    }
                    Http.json(ex, 200, vault.status(project));
                }
                case "/api/secure/certificate" -> {
                    requirePost(method);
                    Map<String, Object> body = Http.jsonBody(ex);
                    String project = required(Json.str(body, "project", null), "project");
                    Certificate cert = Certificate.parse(Json.str(body, "certificate", null));
                    // Gehoert das Zertifikat zu einem anderen Geraet, ist das fast immer eine Verwechslung.
                    String expected = Json.str(body, "serial", null);
                    if (expected != null && !expected.replaceAll("[^0-9a-fA-F]", "").equalsIgnoreCase(cert.serial())) {
                        throw new IllegalArgumentException("Das Zertifikat gehoert zur Seriennummer " + cert.serial()
                                + ", das Geraet im Projekt hat " + expected + ".");
                    }
                    String serial = vault.putCertificate(project, cert);
                    Map<String, Object> m = Json.obj();
                    m.put("serial", serial);
                    m.put("status", vault.status(project));
                    Http.json(ex, 200, m);
                }
                case "/api/secure/certificate/remove" -> {
                    requirePost(method);
                    Map<String, Object> body = Http.jsonBody(ex);
                    String project = required(Json.str(body, "project", null), "project");
                    vault.removeCertificate(project, required(Json.str(body, "serial", null), "serial"));
                    Http.json(ex, 200, vault.status(project));
                }
                case "/api/secure/export" -> {
                    String project = required(Http.query(ex).get("project"), "project");
                    Map<String, Object> m = Json.obj();
                    m.put("file", vault.exportFile(project));
                    Http.json(ex, 200, m);
                }
                case "/api/secure/import" -> {
                    requirePost(method);
                    Map<String, Object> body = Json.parseObject(Http.text(ex, 6 << 20));
                    String project = required(Json.str(body, "project", null), "project");
                    Http.json(ex, 200, vault.importFile(project, required(Json.str(body, "file", null), "file")));
                }
                default -> Http.error(ex, 404, "Unbekannter Pfad");
            }
        } catch (IllegalArgumentException | IllegalStateException e) {
            Http.error(ex, 400, String.valueOf(e.getMessage()));
        } catch (IOException e) {
            Http.error(ex, 500, String.valueOf(e.getMessage()));
        } catch (Exception e) {
            Http.error(ex, 500, e.getClass().getSimpleName() + ": " + e.getMessage());
        }
    }

    private static char[] chars(Map<String, Object> body, String key) {
        Object v = body.get(key);
        if (!(v instanceof String s)) throw new IllegalArgumentException("Passwort fehlt");
        return s.toCharArray();
    }

    private static String required(String v, String name) {
        if (v == null || v.isBlank()) throw new IllegalArgumentException("Feld " + name + " fehlt");
        return v;
    }

    private static void requirePost(String method) {
        if (!"POST".equals(method)) throw new IllegalArgumentException("Diese Aktion braucht POST");
    }
}
