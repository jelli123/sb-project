package de.sb.knx.api;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import de.sb.knx.http.Http;
import de.sb.knx.json.Json;
import de.sb.knx.secure.Certificate;
import de.sb.knx.secure.KeyVault;
import de.sb.knx.secure.KeyringFile;
import tuwien.auto.calimero.IndividualAddress;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

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
                case "/api/secure/keyring/export" -> {
                    requirePost(method);
                    Http.json(ex, 200, exportKeyring(Json.parseObject(Http.text(ex, 4 << 20))));
                }
                case "/api/secure/keyring/import" -> {
                    requirePost(method);
                    Http.json(ex, 200, importKeyring(Json.parseObject(Http.text(ex, 10 << 20))));
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

    /* ---------------- Keyring (.knxkeys) ---------------- */

    /**
     * Keyring fuer andere Werkzeuge. Die Oberflaeche nennt, was zum Projekt gehoert (Geraete mit
     * Seriennummer und Adresse, Gruppen mit Id und Adresse, die Multicast-Adresse); die Schluessel
     * kommen aus der Ablage. Erzeugt wird dabei nichts - nur was schon in Geraeten steckt, geht mit.
     */
    private Map<String, Object> exportKeyring(Map<String, Object> body) throws Exception {
        String project = required(Json.str(body, "project", null), "project");
        char[] password = chars(body, "password");
        try {
            if (password.length < 8) throw new IllegalArgumentException("Das Keyring-Passwort braucht mindestens 8 Zeichen.");
            List<KeyringFile.Device> devices = new ArrayList<>();
            int tools = 0, ip = 0;
            for (Object o : list(body, "devices")) {
                if (!(o instanceof Map<?, ?> m) || !(m.get("serial") instanceof String serial) || !(m.get("address") instanceof Number a))
                    continue;
                KeyVault.DeviceKeys k = vault.device(project, serial);
                KeyVault.IpCreds c = vault.ipCreds(project, serial);
                byte[] tool = k == null ? null : k.toolKey();
                if (tool == null && c == null) continue;
                List<KeyringFile.Tunnel> tunnels = new ArrayList<>();
                if (c != null && m.get("tunnels") instanceof List<?> ts) {
                    int user = 2;
                    for (Object t : ts) {
                        if (t instanceof Number pa && c.tunnels().containsKey(pa.intValue()))
                            tunnels.add(new KeyringFile.Tunnel(pa.intValue(), user, c.tunnels().get(pa.intValue())));
                        user++;
                    }
                }
                devices.add(new KeyringFile.Device(a.intValue(), tool, c == null ? null : c.mgmt(), c == null ? null : c.auth(), tunnels));
                if (tool != null) tools++;
                if (c != null) ip++;
            }
            Map<Integer, byte[]> groups = new TreeMap<>();
            for (Object o : list(body, "groups")) {
                if (!(o instanceof Map<?, ?> m) || !(m.get("id") instanceof String id) || !(m.get("raw") instanceof Number raw)) continue;
                byte[] key = vault.groupKeyIfKnown(project, id);
                if (key != null) groups.put(raw.intValue(), key);
            }
            String multicast = Json.str(body, "multicast", null);
            byte[] backbone = multicast == null ? null : vault.backboneKey(project, multicast, false);
            KeyringFile.Content c = new KeyringFile.Content(multicast, Json.integer(body, "latency", 2000), backbone, devices, groups);
            Map<String, Object> m = Json.obj();
            m.put("file", KeyringFile.write(Json.str(body, "name", project), password, c));
            m.put("devices", tools);
            m.put("ip", ip);
            m.put("groups", groups.size());
            m.put("backbone", backbone != null);
            groups.values().forEach(k -> Arrays.fill(k, (byte) 0));
            return m;
        } finally {
            Arrays.fill(password, '\0');
        }
    }

    /**
     * Uebernimmt Schluessel aus einem Keyring (etwa der ETS) in die Ablage. Zugeordnet wird ueber
     * die Adressen des Projekts, die die Oberflaeche nennt; was dort nicht vorkommt, bleibt draussen.
     */
    private Map<String, Object> importKeyring(Map<String, Object> body) throws Exception {
        String project = required(Json.str(body, "project", null), "project");
        char[] password = chars(body, "password");
        KeyringFile.Content c;
        try {
            c = KeyringFile.read(required(Json.str(body, "file", null), "file"), password, null);
        } finally {
            Arrays.fill(password, '\0');
        }
        Map<Integer, String> serials = new HashMap<>();
        for (Object o : list(body, "devices"))
            if (o instanceof Map<?, ?> m && m.get("serial") instanceof String serial && m.get("address") instanceof Number a)
                serials.put(a.intValue(), serial);
        Map<Integer, String> groupIds = new HashMap<>();
        for (Object o : list(body, "groups"))
            if (o instanceof Map<?, ?> m && m.get("id") instanceof String id && m.get("raw") instanceof Number raw)
                groupIds.put(raw.intValue(), id);

        Map<String, byte[]> toolKeys = new TreeMap<>();
        Map<String, byte[]> groupKeys = new TreeMap<>();
        List<Object> unknown = Json.arr();
        int ip = 0;
        for (KeyringFile.Device d : c.devices()) {
            String serial = serials.get(d.address());
            if (serial == null) {
                unknown.add(new IndividualAddress(d.address()).toString());
                continue;
            }
            if (d.toolKey() != null) toolKeys.put(serial, d.toolKey());
            if (d.managementPassword() != null && d.authentication() != null) {
                Map<Integer, String> t = new TreeMap<>();
                d.tunnels().forEach(x -> { if (x.password() != null) t.put(x.address(), x.password()); });
                vault.putIpCreds(project, serial, new KeyVault.IpCreds(d.authentication(), d.managementPassword(), t));
                ip++;
            }
        }
        int skippedGroups = 0;
        for (Map.Entry<Integer, byte[]> g : c.groups().entrySet()) {
            String id = groupIds.get(g.getKey());
            if (id == null) skippedGroups++;
            else groupKeys.put(id, g.getValue());
        }
        vault.putImported(project, c.backboneKey() == null ? null : c.multicast(), c.backboneKey(), toolKeys, groupKeys);
        Map<String, Object> m = Json.obj();
        m.put("toolKeys", toolKeys.size());
        m.put("ip", ip);
        m.put("groups", groupKeys.size());
        m.put("skippedGroups", skippedGroups);
        m.put("backbone", c.backboneKey() != null);
        m.put("multicast", c.multicast());
        m.put("unknownDevices", unknown);
        m.put("status", vault.status(project));
        return m;
    }

    private static List<?> list(Map<String, Object> body, String key) {
        return body.get(key) instanceof List<?> l ? l : List.of();
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
