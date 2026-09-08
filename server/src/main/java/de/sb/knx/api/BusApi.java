package de.sb.knx.api;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import de.sb.knx.bus.BusService;
import de.sb.knx.bus.Commissioning;
import de.sb.knx.bus.DeviceInfoReader;
import de.sb.knx.bus.Knx;
import de.sb.knx.http.Events;
import de.sb.knx.http.Http;
import de.sb.knx.http.Jobs;
import de.sb.knx.json.Json;
import tuwien.auto.calimero.IndividualAddress;
import tuwien.auto.calimero.mgmt.ManagementClient.EraseCode;

import java.io.IOException;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Buszugriff: Suche, Verbindung, Scan, Geraete-Info, Adressvergabe, Neustart und Entladen. */
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
                    Json.str(body, "localHost", null));
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

        Map<String, Object> result = serial == null
                ? run(() -> commissioning.assignAddressViaProgrammingMode(addr), 120)
                : run(() -> commissioning.assignAddressViaSerial(Knx.serialNumber(serial), addr), 120);
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

    /* ---------------- Stufe 3 ---------------- */

    private void restart(HttpExchange ex, String method) throws Exception {
        requirePost(method);
        Map<String, Object> body = Http.jsonBody(ex);
        IndividualAddress addr = Knx.address(Json.str(body, "address", null));
        String code = Json.str(body, "eraseCode", null);
        int channel = Json.integer(body, "channel", 0);

        Map<String, Object> result = code == null
                ? run(() -> commissioning.restart(addr), 30)
                : run(() -> commissioning.masterReset(addr, eraseCode(code), channel), 120);
        events.log("warn", String.valueOf(result.get("message")));
        Http.json(ex, 200, result);
    }

    private void unload(HttpExchange ex, String method) throws Exception {
        requirePost(method);
        Map<String, Object> body = Http.jsonBody(ex);
        IndividualAddress addr = Knx.address(Json.str(body, "address", null));
        int index = Json.integer(body, "objectIndex", 3);
        Map<String, Object> result = run(() -> commissioning.unload(addr, index), 60);
        events.log("warn", String.valueOf(result.get("message")));
        Http.json(ex, 200, result);
    }

    private void loadState(HttpExchange ex) throws Exception {
        IndividualAddress addr = Knx.address(requiredParam(ex, "address"));
        int index = clamp(intParam(ex, "objectIndex", 3), 0, 63);
        Http.json(ex, 200, run(() -> commissioning.loadState(addr, index), 30));
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
            throw new IllegalStateException("Der Bus antwortet nicht innerhalb von " + timeoutSeconds + " s.");
        }
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
