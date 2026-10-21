package de.sb.knx.mcp;

import com.sun.net.httpserver.HttpServer;
import de.sb.knx.api.McpUiApi;
import de.sb.knx.http.Events;
import de.sb.knx.json.Json;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Der ganze Weg einer KI-Anfrage: MCP-Endpunkt, Freigabe, Ereignis an ein Fenster, Antwort des
 * Fensters, Allowlist und Platzhalter. Das Fenster spielt hier ein Lesefaden an der Ereignisleitung.
 */
class McpEndToEndTest {

    private static final String WINDOW = "test-window-0001";
    private static final String PROJECT = "Haus Müller";

    @TempDir
    Path dir;
    HttpServer server;
    Events events;
    McpGate gate;
    String base;
    String token;
    final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    volatile Function<Map<String, Object>, Map<String, Object>> window = call -> Map.of("ok", false);
    CompletableFuture<Void> sse;

    @BeforeEach
    void start() throws Exception {
        server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
        server.setExecutor(java.util.concurrent.Executors.newCachedThreadPool());
        int port = server.getAddress().getPort();
        events = new Events();
        gate = new McpGate(dir, events);
        server.createContext("/api/events", ex -> {
            Map<String, String> q = de.sb.knx.http.Http.query(ex);
            events.subscribe(ex, q.get("window"), q.get("project"));
        });
        server.createContext("/mcp", new McpApi(gate, port, "test"));
        server.createContext("/api/mcp", new McpUiApi(gate, port));
        server.start();
        base = "http://127.0.0.1:" + port;
        token = Files.readString(dir.resolve("mcp").resolve("token")).strip();
        openWindow();
    }

    @AfterEach
    void stop() {
        if (sse != null) sse.cancel(true);
        gate.close();
        events.close();
        server.stop(0);
    }

    /** Ein Fenster, das jedes mcp-call-Ereignis mit {@link #window} beantwortet. */
    private void openWindow() throws Exception {
        CountDownLatch connected = new CountDownLatch(1);
        HttpRequest req = HttpRequest.newBuilder(URI.create(base + "/api/events?window=" + WINDOW
                + "&project=" + java.net.URLEncoder.encode(PROJECT, "UTF-8"))).GET().build();
        sse = http.sendAsync(req, HttpResponse.BodyHandlers.ofLines()).thenAccept(res -> {
            connected.countDown();
            String[] event = {null};
            try (Stream<String> lines = res.body()) {
                lines.forEach(line -> {
                    if (line.startsWith("event: ")) event[0] = line.substring(7);
                    else if (line.startsWith("data: ") && "mcp-call".equals(event[0])) answer(Json.parseObject(line.substring(6)));
                });
            }
        });
        assertTrue(connected.await(5, TimeUnit.SECONDS));
        for (int i = 0; i < 50 && events.windowsOf(PROJECT).isEmpty(); i++) Thread.sleep(20);
    }

    private void answer(Map<String, Object> call) {
        new Thread(() -> {
            Map<String, Object> body = new java.util.LinkedHashMap<>(window.apply(call));
            body.put("call", call.get("call"));
            try {
                post("/api/mcp/result", body, Map.of("X-SB-Window", WINDOW));
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        }).start();
    }

    private HttpResponse<String> post(String path, Object body, Map<String, String> headers) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(base + path))
                .POST(HttpRequest.BodyPublishers.ofString(Json.write(body)))
                .header("Content-Type", "application/json");
        headers.forEach(b::header);
        return http.send(b.build(), HttpResponse.BodyHandlers.ofString());
    }

    private String session;
    private long rpcId;

    private HttpResponse<String> rpc(String method, Map<String, Object> params, boolean withToken) throws Exception {
        Map<String, Object> m = Json.obj();
        m.put("jsonrpc", "2.0");
        m.put("id", ++rpcId);
        m.put("method", method);
        m.put("params", params);
        Map<String, String> h = new java.util.HashMap<>();
        if (withToken) h.put("Authorization", "Bearer " + token);
        if (session != null) h.put("Mcp-Session-Id", session);
        return post("/mcp", m, h);
    }

    private void initialize() throws Exception {
        HttpResponse<String> r = rpc("initialize", Map.of("protocolVersion", "2025-06-18",
                "capabilities", Map.of(), "clientInfo", Map.of("name", "junit", "version", "1")), true);
        assertEquals(200, r.statusCode());
        session = r.headers().firstValue("Mcp-Session-Id").orElse(null);
        assertNotNull(session);
        Map<?, ?> result = (Map<?, ?>) Json.parseObject(r.body()).get("result");
        assertEquals("2025-06-18", result.get("protocolVersion"));
    }

    private Map<?, ?> callTool(String name, Map<String, Object> args) throws Exception {
        HttpResponse<String> r = rpc("tools/call", Map.of("name", name, "arguments", args), true);
        assertEquals(200, r.statusCode(), r.body());
        return (Map<?, ?>) Json.parseObject(r.body()).get("result");
    }

    private static String text(Map<?, ?> result) {
        return (String) ((Map<?, ?>) ((List<?>) result.get("content")).get(0)).get("text");
    }

    private void release(String mode) throws Exception {
        HttpResponse<String> r = post("/api/mcp/mode", Map.of("project", PROJECT, "mode", mode), Map.of("X-SB-Window", WINDOW));
        assertEquals(200, r.statusCode(), r.body());
    }

    @Test
    void refusesWithoutToken() throws Exception {
        HttpResponse<String> r = rpc("initialize", Map.of(), false);
        assertEquals(401, r.statusCode());
    }

    @Test
    void refusesForeignOrigin() throws Exception {
        HttpRequest req = HttpRequest.newBuilder(URI.create(base + "/mcp"))
                .POST(HttpRequest.BodyPublishers.ofString("{}"))
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + token)
                .header("Origin", "http://evil.example").build();
        assertEquals(403, http.send(req, HttpResponse.BodyHandlers.ofString()).statusCode());
    }

    @Test
    void needsASession() throws Exception {
        HttpResponse<String> r = rpc("tools/list", Map.of(), true);
        assertEquals(400, r.statusCode());
        session = "0123456789abcdef0123456789abcdef";
        assertEquals(404, rpc("tools/list", Map.of(), true).statusCode());
    }

    @Test
    void listsTools() throws Exception {
        initialize();
        HttpResponse<String> r = rpc("tools/list", Map.of(), true);
        String body = r.body();
        assertTrue(body.contains("get_overview"));
        assertTrue(body.contains("readOnlyHint"));
    }

    @Test
    void nothingIsReachableUntilReleased() throws Exception {
        initialize();
        Map<?, ?> res = callTool("get_overview", Map.of());
        assertEquals(true, res.get("isError"));
        assertTrue(text(res).contains("Kein Projekt freigegeben"));
        assertTrue(text(callTool("list_projects", Map.of())).contains("No project is released"));
    }

    @Test
    void writeModesAreNotAvailableYet() throws Exception {
        HttpResponse<String> r = post("/api/mcp/mode", Map.of("project", PROJECT, "mode", "auto"), Map.of("X-SB-Window", WINDOW));
        assertEquals(400, r.statusCode());
    }

    @Test
    void releaseNeedsTheWindowShowingTheProject() throws Exception {
        HttpResponse<String> r = post("/api/mcp/mode", Map.of("project", "Anderes", "mode", "read"),
                Map.of("X-SB-Window", WINDOW));
        assertEquals(400, r.statusCode());
    }

    @Test
    void resultIsFilteredAndMasked() throws Exception {
        release("read");
        initialize();
        window = call -> {
            assertEquals("get_overview", call.get("tool"));
            return Json.parseObject("""
                    {"ok":true,"names":["Familie Schmidt"],"terms":["Lisa"],
                     "data":{"name":"Familie Schmidt","gaStyle":"three","note":"Alarmcode 1234",
                       "counts":{"rooms":1,"devices":1,"groups":0,"functions":0,"pendingDevices":0,"catalog":0},
                       "structure":[{"id":"n1","parent":null,"kind":"site","name":"Haus Müller","devices":0,
                                     "note":"Schlüssel beim Nachbarn"},
                                    {"id":"n2","parent":"n1","kind":"room","name":"Büro Müller","devices":1},
                                    {"id":"n4","parent":"n1","kind":"room","name":"Kinderzimmer Lisa","devices":0},
                                    {"id":"n5","parent":"n1","kind":"room","name":"Gästezimmer Schmidt","devices":0},
                                    {"id":"n3","parent":"n1","kind":"room","name":"Zuleitung Lindenweg 4","devices":0}],
                       "topology":[{"id":"a1","addr":1,"name":"Bereich","backbone":false,"lines":[
                         {"id":"l1","addr":1,"name":"Linie","medium":"tp","devices":1,"mcast":"224.0.23.12","segments":[]}]}],
                       "gaRanges":[]}}""");
        };
        Map<?, ?> res = callTool("get_overview", Map.of());
        assertEquals(false, res.get("isError"), text(res));
        String out = text(res);
        assertFalse(out.contains("Müller"), out);
        assertFalse(out.contains("Schmidt"), out);
        assertFalse(out.contains("Lisa"), out);
        assertTrue(out.contains("Kinderzimmer «Name"), out);
        assertFalse(out.contains("Lindenweg"), out);
        assertFalse(out.contains("Alarmcode"), out);
        assertFalse(out.contains("Nachbarn"), out);
        assertFalse(out.contains("224.0.23.12"), out);
        assertTrue(out.contains("«Name"), out);
        assertTrue(out.contains("\"project\":\"p1\""), out);
        String log = Files.readString(dir.resolve("mcp").resolve("audit.log"));
        assertTrue(log.contains("\"tool\":\"get_overview\""));
        assertTrue(log.contains("\"dropped\":3"), log);
    }

    @Test
    void placeholdersInArgumentsAreRestoredForTheWindow() throws Exception {
        release("read");
        initialize();
        window = call -> Json.parseObject("""
                {"ok":true,"terms":["Haus Müller"],"data":{"total":1,"offset":0,"devices":[
                  {"id":"d1","name":"Aktor Müller","product":"Schaltaktor","pa":"1.1.1","line":"l1","room":null,
                   "catalog":null,"objectCount":0,"linkedObjects":0,"pending":[],"secure":false,"ip":false}]}}""");
        String first = text(callTool("list_devices", Map.of()));
        assertTrue(first.contains("Aktor «Name1»"), first);

        String[] seen = {null};
        window = call -> {
            seen[0] = String.valueOf(((Map<?, ?>) call.get("args")).get("query"));
            return Json.parseObject("""
                    {"ok":true,"data":{"total":0,"offset":0,"devices":[]}}""");
        };
        callTool("list_devices", Map.of("query", "«Name1»"));
        assertEquals("Müller", seen[0]);

        Map<?, ?> bad = callTool("list_devices", Map.of("query", "«Name9»"));
        assertEquals(true, bad.get("isError"));
    }

    @Test
    void invalidArgumentsComeBackAsToolErrors() throws Exception {
        release("read");
        initialize();
        Map<?, ?> res = callTool("get_device", Map.of("device", "d1", "unexpected", true));
        assertEquals(true, res.get("isError"));
        assertTrue(text(res).contains("unexpected"));
    }

    @Test
    void windowErrorsAreMaskedToo() throws Exception {
        release("read");
        initialize();
        window = call -> Json.parseObject("""
                {"ok":false,"error":"Gerät von Müller nicht gefunden","terms":["Müller"]}""");
        Map<?, ?> res = callTool("get_device", Map.of("device", "d9"));
        assertEquals(true, res.get("isError"));
        assertFalse(text(res).contains("Müller"), text(res));
    }

    @Test
    void ipConfigOnlyThroughItsOwnTool() throws Exception {
        release("read");
        initialize();
        window = call -> Json.parseObject("""
                {"ok":true,"data":{"backbone":{"medium":"ip","multicast":"224.0.23.12"},
                  "devices":[{"id":"d1","name":"IP-Router","pa":"1.0.0","mode":"manual","address":"192.168.1.20",
                  "mask":"255.255.255.0","gateway":"192.168.1.1","tunnels":4,"tunnelAddresses":["1.0.250"],"parameters":[]}]}}""");
        String out = text(callTool("get_ip_config", Map.of()));
        assertTrue(out.contains("192.168.1.20"), out);
        assertTrue(out.contains("224.0.23.12"), out);
    }

    @Test
    void switchingOffCutsAccess() throws Exception {
        release("read");
        initialize();
        release("off");
        Map<?, ?> res = callTool("get_overview", Map.of());
        assertEquals(true, res.get("isError"));
    }

    @Test
    void resultsFromAnotherWindowAreRejected() throws Exception {
        release("read");
        initialize();
        String[] call = {null};
        CountDownLatch got = new CountDownLatch(1);
        window = c -> {
            call[0] = (String) c.get("call");
            got.countDown();
            try {
                Thread.sleep(400);
            } catch (InterruptedException ignored) {
                // Testende
            }
            return Json.parseObject("""
                    {"ok":true,"data":{"total":0,"offset":0,"devices":[]}}""");
        };
        CompletableFuture<Map<?, ?>> pendingCall = CompletableFuture.supplyAsync(() -> {
            try {
                return callTool("list_devices", Map.of());
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        });
        assertTrue(got.await(5, TimeUnit.SECONDS));
        HttpResponse<String> forged = post("/api/mcp/result", Map.of("call", call[0], "ok", true,
                "data", Map.of("total", 1)), Map.of("X-SB-Window", "other-window-0002"));
        assertEquals(400, forged.statusCode());
        assertEquals(false, pendingCall.get(5, TimeUnit.SECONDS).get("isError"));
    }
}
