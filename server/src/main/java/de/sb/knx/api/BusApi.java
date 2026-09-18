package de.sb.knx.api;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import de.sb.knx.bus.BusService;
import de.sb.knx.bus.Commissioning;
import de.sb.knx.bus.DeviceInfoReader;
import de.sb.knx.bus.Download;
import de.sb.knx.bus.Knx;
import de.sb.knx.http.Events;
import de.sb.knx.http.Http;
import de.sb.knx.http.Jobs;
import de.sb.knx.json.Json;
import tuwien.auto.calimero.IndividualAddress;
import tuwien.auto.calimero.mgmt.ManagementClient.EraseCode;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Buszugriff: Suche, Verbindung, Scan, Geraete-Info, Adressvergabe, Download, Neustart und Entladen. */
public final class BusApi implements HttpHandler {

    private final BusService bus;
    private final DeviceInfoReader info;
    private final Commissioning commissioning;
    private final Jobs jobs;
    private final Events events;
    private final int port;

    public BusApi(BusService bus, Jobs jobs, Events events, int port) {
        this.bus = bus;
        this.info = new DeviceInfoReader(bus);
        this.commissioning = new Commissioning(bus);
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
                case "/api/bus/status" -> Http.json(ex, 200, bus.status());
                case "/api/bus/discover" -> discover(ex);
                case "/api/bus/interfaces" -> {
                    Map<String, Object> m = Json.obj();
                    m.put("interfaces", BusService.networkInterfaces());
                    Http.json(ex, 200, m);
                }
                case "/api/bus/connect" -> connect(ex, method);
                case "/api/bus/disconnect" -> {
                    requirePost(method);
                    Http.json(ex, 200, bus.disconnect());
                }
                case "/api/bus/scan" -> scan(ex, method);
                case "/api/bus/routers" -> Http.json(ex, 200, wrap("routers", run(commissioning::scanRouters, 300)));
                case "/api/bus/device" -> device(ex);
                case "/api/bus/progmode" -> progMode(ex, method);
                case "/api/bus/address" -> address(ex, method);
                case "/api/bus/address/occupied" -> occupied(ex);
                case "/api/bus/download" -> download(ex, method);
                case "/api/bus/restart" -> restart(ex, method);
                case "/api/bus/unload" -> unload(ex, method);
                case "/api/bus/loadstate" -> loadState(ex);
                default -> {
                    if (path.startsWith("/api/bus/jobs/")) job(ex, method, path);
                    else Http.error(ex, 404, "Unbekannter Pfad");
                }
            }
        } catch (IllegalArgumentException | IllegalStateException e) {
            Http.error(ex, 400, String.valueOf(e.getMessage()));
        } catch (IOException e) {
            throw e;
        } catch (Exception e) {
            Http.error(ex, 500, Jobs.describe(e));
        }
    }

    /* ---------------- Suche und Verbindung ---------------- */

    private void discover(HttpExchange ex) throws Exception {
        int timeout = clamp(intParam(ex, "timeout", 3), 1, 15);
        Map<String, Object> m = Json.obj();
        m.put("servers", BusService.discover(timeout));
        Http.json(ex, 200, m);
    }

    private void connect(HttpExchange ex, String method) throws Exception {
        requirePost(method);
        Map<String, Object> body = Http.jsonBody(ex);
        String mode = Json.str(body, "mode", "tunneling").toLowerCase(Locale.ROOT);
        Map<String, Object> status;
        if ("routing".equals(mode)) {
            status = bus.connectRouting(
                    Json.str(body, "multicast", "224.0.23.12"),
                    Json.str(body, "networkInterface", null),
                    Json.str(body, "ownAddress", null));
        } else {
            String host = Json.str(body, "host", null);
            if (host == null) throw new IllegalArgumentException("Feld host fehlt");
            status = bus.connectTunneling(
                    host,
                    Json.integer(body, "port", 3671),
                    Json.bool(body, "nat", false),
                    Json.str(body, "localHost", null),
                    Json.str(body, "deviceAddress", null));
        }
        events.log("info", "Verbunden: " + Json.write(status.get("connection")));
        Http.json(ex, 200, status);
    }

    /* ---------------- Stufe 1 ---------------- */

    private void scan(HttpExchange ex, String method) throws Exception {
        requirePost(method);
        Map<String, Object> body = Http.jsonBody(ex);
        int area = clamp(Json.integer(body, "area", 0), 0, 15);
        int line = clamp(Json.integer(body, "line", 0), 0, 15);

        String[] holder = new String[1];
        holder[0] = jobs.submit("scan", bus.executor(), () -> {
            events.log("info", "Busscan " + area + "." + line + ".* gestartet");
            List<Map<String, Object>> found = commissioning.scanLine(area, line,
                    (kind, detail) -> jobs.progress(holder[0], "Teilnehmer " + detail + " antwortet", detail));
            events.log("info", "Busscan beendet: " + found.size() + " Teilnehmer");
            return found;
        });

        Map<String, Object> m = Json.obj();
        m.put("job", holder[0]);
        Http.json(ex, 202, m);
    }

    private void device(HttpExchange ex) throws Exception {
        IndividualAddress addr = Knx.address(requiredParam(ex, "address"));
        Http.json(ex, 200, run(() -> info.read(addr), 60));
    }

    private void job(HttpExchange ex, String method, String path) throws IOException {
        String rest = path.substring("/api/bus/jobs/".length());
        if (rest.endsWith("/cancel")) {
            requirePost(method);
            String id = rest.substring(0, rest.length() - "/cancel".length());
            Map<String, Object> m = Json.obj();
            m.put("cancelled", jobs.cancel(id));
            Http.json(ex, 200, m);
            return;
        }
        Map<String, Object> status = jobs.status(rest);
        if (status == null) Http.error(ex, 404, "Auftrag unbekannt: " + rest);
        else Http.json(ex, 200, status);
    }

    /* ---------------- Stufe 2 ---------------- */

    private void progMode(HttpExchange ex, String method) throws Exception {
        if ("GET".equals(method)) {
            Http.json(ex, 200, wrap("devices", run(commissioning::devicesInProgrammingMode, 30)));
            return;
        }
        requirePost(method);
        Map<String, Object> body = Http.jsonBody(ex);
        IndividualAddress addr = Knx.address(Json.str(body, "address", null));
        boolean on = Json.bool(body, "on", true);
        run(() -> {
            commissioning.setProgrammingMode(addr, on);
            return null;
        }, 30);
        events.log("info", "Programmiermodus " + (on ? "ein" : "aus") + " an " + addr);
        Map<String, Object> m = Json.obj();
        m.put("ok", true);
        m.put("address", addr.toString());
        m.put("on", on);
        Http.json(ex, 200, m);
    }

    private void address(HttpExchange ex, String method) throws Exception {
        requirePost(method);
        Map<String, Object> body = Http.jsonBody(ex);
        IndividualAddress addr = Knx.address(Json.str(body, "address", null));
        String serial = Json.str(body, "serial", null);

        String iface = bus.interfaceAddress();
        boolean wasConnected = bus.connected();

        Map<String, Object> result;
        try {
            result = serial == null
                    ? run(() -> commissioning.assignAddressViaProgrammingMode(addr), 120)
                    : run(() -> commissioning.assignAddressViaSerial(Knx.serialNumber(serial), addr), 120);
        } catch (IllegalStateException e) {
            // Reisst die Verbindung waehrend der Vergabe ab, war meist die Schnittstelle selbst
            // das programmierte Geraet: sie startet mit neuer Adresse neu, der Tunnel ist tot.
            if (!wasConnected || bus.connected()) throw e;
            result = Json.obj();
            result.put("ok", false);
            result.put("linkLost", true);
            result.put("address", addr.toString());
            result.put("interfaceProgrammed", iface != null && iface.equals(addr.toString()));
            result.put("message", "Die Verbindung zur Schnittstelle ist waehrend der Adressvergabe abgerissen. "
                    + (iface != null ? "Die Schnittstelle selbst hatte die Adresse " + iface + ". " : "")
                    + "War sie das programmierte Geraet, laeuft sie jetzt unter " + addr
                    + " - bitte neu suchen, neu verbinden und die Adresse pruefen.");
            events.log("warn", String.valueOf(result.get("message")));
            Http.json(ex, 200, result);
            return;
        }
        result.put("interfaceProgrammed", iface != null && iface.equals(addr.toString()));
        events.log(Boolean.TRUE.equals(result.get("ok")) ? "info" : "warn", String.valueOf(result.get("message")));
        Http.json(ex, 200, result);
    }

    private void occupied(HttpExchange ex) throws Exception {
        IndividualAddress addr = Knx.address(requiredParam(ex, "address"));
        Map<String, Object> m = Json.obj();
        m.put("address", addr.toString());
        m.put("occupied", run(() -> commissioning.isAddressOccupied(addr), 30));
        Http.json(ex, 200, m);
    }

    /* ---------------- Applikation laden ---------------- */

    /**
     * Nimmt einen fertigen Downloadplan entgegen und arbeitet ihn als Auftrag ab. Der Fortschritt
     * laeuft ueber die Ereignisleitung. Programmiert man die verbundene Schnittstelle selbst,
     * reisst der Tunnel beim Neustart ab - nach dem Neustartschritt gilt das nicht als Fehler.
     */
    @SuppressWarnings("unchecked")
    private void download(HttpExchange ex, String method) throws Exception {
        requirePost(method);
        Map<String, Object> body = Http.jsonBody(ex);
        IndividualAddress addr = Knx.address(Json.str(body, "address", null));
        String label = Json.str(body, "label", "Download " + addr);
        if (!(body.get("steps") instanceof List<?> raw)) throw new IllegalArgumentException("Feld steps fehlt");
        List<Map<String, Object>> steps = new ArrayList<>();
        for (Object o : raw) {
            if (!(o instanceof Map)) throw new IllegalArgumentException("Schritt ist kein Objekt");
            steps.add((Map<String, Object>) o);
        }
        Download.validate(steps);
        if (!bus.connected()) throw new IllegalStateException("Keine Busverbindung. Bitte zuerst eine Schnittstelle verbinden.");
        String iface = bus.interfaceAddress();

        String[] holder = new String[1];
        holder[0] = jobs.submit("download", bus.executor(), () -> {
            events.log("info", label + ": " + steps.size() + " Schritte");
            Download dl = new Download(bus);
            try {
                Map<String, Object> result = dl.run(addr, steps, (i, total, text) -> {
                    Map<String, Object> progress = Json.obj();
                    progress.put("step", i);
                    progress.put("total", total);
                    progress.put("label", text);
                    jobs.progress(holder[0], text, progress);
                });
                events.log("info", label + " abgeschlossen");
                return result;
            } catch (Exception e) {
                // Der Neustart ist der letzte Schritt jeder Ladeprozedur. Was danach an der Verbindung
                // scheitert, betrifft das Laden nicht mehr - das Geraet startet bereits neu.
                if (dl.restarted()) {
                    boolean lost = !bus.connected();
                    Map<String, Object> m = Json.obj();
                    m.put("ok", true);
                    m.put("linkLost", lost);
                    m.put("address", addr.toString());
                    m.put("message", !lost
                            ? label + " abgeschlossen, das Geraet startet neu."
                            : addr.toString().equals(iface)
                            ? "Geladen. Die Schnittstelle startet mit der neuen Konfiguration neu, "
                              + "die Verbindung ist dabei abgerissen. Bitte neu suchen und verbinden."
                            : "Geladen, das Geraet startet neu. Die Verbindung zur Schnittstelle ist dabei "
                              + "abgerissen. Bitte neu verbinden.");
                    events.log("warn", String.valueOf(m.get("message")));
                    return m;
                }
                throw e;
            }
        });

        Map<String, Object> m = Json.obj();
        m.put("job", holder[0]);
        Http.json(ex, 202, m);
    }

    /* ---------------- Stufe 3 ---------------- */

    private void restart(HttpExchange ex, String method) throws Exception {
        requirePost(method);
        Map<String, Object> body = Http.jsonBody(ex);
        IndividualAddress addr = Knx.address(Json.str(body, "address", null));
        String code = Json.str(body, "eraseCode", null);
        int channel = Json.integer(body, "channel", 0);

        EraseCode erase = code == null ? null : eraseCode(code);
        if (channel < 0 || channel > 255) throw new IllegalArgumentException("Kanal ist 0 bis 255");

        String iface = bus.interfaceAddress();
        boolean self = iface != null && iface.equals(addr.toString());
        boolean wasConnected = bus.connected();
        Map<String, Object> result;
        try {
            result = erase == null
                    ? run(() -> commissioning.restart(addr), 30)
                    : run(() -> commissioning.masterReset(addr, erase, channel), 120);
            if (self && bus.connected()) {
                // Die Schnittstelle startet neu und nimmt ihren Tunnel mit. Calimero merkte das erst
                // am ausbleibenden Heartbeat, bis dahin sahe die Verbindung gesund aus.
                bus.abandon("Die Schnittstelle " + addr + " startet neu");
                result.put("linkLost", true);
                result.put("message", result.get("message") + " Die Schnittstelle startet dabei neu - "
                        + "die Verbindung ist getrennt, bitte neu verbinden.");
            }
        } catch (IllegalStateException e) {
            // Setzt man die verbundene Schnittstelle selbst zurueck, stirbt mit ihrem Neustart der Tunnel.
            if (!wasConnected || bus.connected()) throw e;
            result = Json.obj();
            result.put("ok", false);
            result.put("linkLost", true);
            result.put("message", "Die Verbindung zur Schnittstelle ist dabei abgerissen"
                    + (self ? " - " + addr + " ist die Schnittstelle selbst und startet neu." : ".")
                    + " Bitte neu verbinden.");
        }
        events.log("warn", String.valueOf(result.get("message")));
        Http.json(ex, 200, result);
    }

    private void unload(HttpExchange ex, String method) throws Exception {
        requirePost(method);
        Map<String, Object> body = Http.jsonBody(ex);
        IndividualAddress addr = Knx.address(Json.str(body, "address", null));
        int type = objectType(Json.integer(body, "objectType", 3));
        Map<String, Object> result = run(() -> commissioning.unload(addr, type), 60);
        events.log("warn", String.valueOf(result.get("message")));
        Http.json(ex, 200, result);
    }

    private void loadState(HttpExchange ex) throws Exception {
        IndividualAddress addr = Knx.address(requiredParam(ex, "address"));
        int type = objectType(intParam(ex, "objectType", 3));
        Http.json(ex, 200, run(() -> commissioning.loadState(addr, type), 30));
    }

    /* ---------------- Hilfen ---------------- */

    private <T> T run(java.util.concurrent.Callable<T> task, long timeoutSeconds) throws Exception {
        try {
            return bus.call(task, timeoutSeconds);
        } catch (java.util.concurrent.ExecutionException e) {
            Throwable cause = e.getCause() == null ? e : e.getCause();
            if (cause instanceof IllegalStateException ise) throw ise;
            if (cause instanceof IllegalArgumentException iae) throw iae;
            throw new IllegalStateException(Jobs.describe(cause));
        } catch (java.util.concurrent.TimeoutException e) {
            // BusService hat die Verbindung bei der Zeitueberschreitung bereits aufgegeben.
            throw new IllegalStateException(bus.connected()
                    ? "Der Bus antwortet nicht innerhalb von " + timeoutSeconds + " s."
                    : "Keine Antwort innerhalb von " + timeoutSeconds + " s - die Verbindung zur Schnittstelle "
                            + "wurde aufgegeben. Bitte neu verbinden.");
        }
    }

    /** Nur Objekttypen mit Load State Machine: Adress-, Zuordnungstabelle, Programm, PEI, Router. */
    private static int objectType(int type) {
        if (type < 1 || type > 6 || type == 5)
            throw new IllegalArgumentException("Objekttyp ohne Load State Machine: " + type);
        return type;
    }

    private static EraseCode eraseCode(String name) {
        for (EraseCode c : EraseCode.values()) {
            if (c.name().equalsIgnoreCase(name)) return c;
        }
        throw new IllegalArgumentException("Unbekannter Loeschcode: " + name);
    }

    private static Map<String, Object> wrap(String key, Object value) {
        Map<String, Object> m = Json.obj();
        m.put(key, value);
        return m;
    }

    private static void requirePost(String method) {
        if (!"POST".equals(method)) throw new IllegalArgumentException("Diese Aktion braucht POST");
    }

    private static String requiredParam(HttpExchange ex, String name) {
        String v = Http.query(ex).get(name);
        if (v == null || v.isBlank()) throw new IllegalArgumentException("Parameter " + name + " fehlt");
        return v;
    }

    private static int intParam(HttpExchange ex, String name, int fallback) {
        String v = Http.query(ex).get(name);
        if (v == null || v.isBlank()) return fallback;
        try {
            return Integer.parseInt(v.trim());
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("Parameter " + name + " ist keine Zahl: " + v);
        }
    }

    private static int clamp(int v, int min, int max) {
        return Math.max(min, Math.min(max, v));
    }
}
