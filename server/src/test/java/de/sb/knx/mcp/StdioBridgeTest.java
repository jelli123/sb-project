package de.sb.knx.mcp;

import com.sun.net.httpserver.HttpServer;
import de.sb.knx.http.Events;
import de.sb.knx.json.Json;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.io.PipedInputStream;
import java.io.PipedOutputStream;
import java.io.PrintStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Die stdio-Bruecke fuer Claude Desktop: mit und ohne laufenden Dienst. */
class StdioBridgeTest {

    @TempDir
    Path dir;
    HttpServer server;
    Events events;
    McpGate gate;
    PipedOutputStream stdin;
    final BlockingQueue<String> stdout = new LinkedBlockingQueue<>();
    Thread loop;
    StdioBridge bridge;

    @AfterEach
    void stop() throws Exception {
        if (stdin != null) stdin.close();
        if (loop != null) loop.join(5000);
        if (gate != null) gate.close();
        if (events != null) events.close();
        if (server != null) server.stop(0);
    }

    private int startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
        int port = server.getAddress().getPort();
        events = new Events();
        gate = new McpGate(dir, events);
        server.createContext("/mcp", new McpApi(gate, port, "test"));
        server.start();
        return port;
    }

    private static int freePort() throws IOException {
        try (ServerSocket s = new ServerSocket(0, 1, InetAddress.getLoopbackAddress())) {
            return s.getLocalPort();
        }
    }

    /** Startet die Bruecke; jede Zeile auf ihrem stdout landet in {@link #stdout}. */
    private void startBridge(int port) throws IOException {
        PipedInputStream in = new PipedInputStream(1 << 16);
        stdin = new PipedOutputStream(in);
        OutputStream lines = new OutputStream() {
            final ByteArrayOutputStream buf = new ByteArrayOutputStream();

            @Override
            public synchronized void write(int b) {
                if (b == '\n') {
                    stdout.add(buf.toString(StandardCharsets.UTF_8));
                    buf.reset();
                } else {
                    buf.write(b);
                }
            }
        };
        bridge = new StdioBridge(port, dir, new PrintStream(lines, true, StandardCharsets.UTF_8));
        loop = new Thread(() -> {
            try {
                bridge.loop(in);
            } catch (Exception ignored) {
                // Testende
            }
        });
        loop.start();
    }

    private Map<String, Object> send(String json) throws Exception {
        stdin.write((json + "\n").getBytes(StandardCharsets.UTF_8));
        stdin.flush();
        String line = stdout.poll(10, TimeUnit.SECONDS);
        assertNotNull(line, "keine Antwort auf " + json);
        return Json.parseObject(line);
    }

    private static final String INIT = """
            {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},\
            "clientInfo":{"name":"claude-desktop","version":"1"}}}""";

    private static String call(int id, String tool) {
        return "{\"jsonrpc\":\"2.0\",\"id\":" + id + ",\"method\":\"tools/call\",\"params\":{\"name\":\"" + tool
                + "\",\"arguments\":{}}}";
    }

    @Test
    void withoutServiceToolsStayVisibleAndSayWhatIsMissing() throws Exception {
        new AccessToken(dir.resolve("mcp"));
        startBridge(freePort());
        Map<?, ?> init = (Map<?, ?>) send(INIT).get("result");
        assertEquals("2025-06-18", init.get("protocolVersion"));
        stdin.write("{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}\n".getBytes(StandardCharsets.UTF_8));

        Map<?, ?> list = (Map<?, ?>) send("{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\"}").get("result");
        assertEquals(Tools.ALL.size(), ((List<?>) list.get("tools")).size());

        Map<?, ?> res = (Map<?, ?>) send(call(3, "list_projects")).get("result");
        assertEquals(true, res.get("isError"));
        assertTrue(Json.write(res).contains("SB-Projekt laeuft nicht"));
    }

    @Test
    void forwardsToTheService() throws Exception {
        startBridge(startServer());
        send(INIT);
        stdin.write("{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}\n".getBytes(StandardCharsets.UTF_8));
        Map<?, ?> res = (Map<?, ?>) send(call(2, "list_projects")).get("result");
        assertEquals(false, res.get("isError"));
        assertTrue(Json.write(res).contains("No project is released"));
    }

    @Test
    void logsInAgainWhenTheServiceForgotTheSession() throws Exception {
        startBridge(startServer());
        send(INIT);
        var f = StdioBridge.class.getDeclaredField("session");
        f.setAccessible(true);
        String first = (String) f.get(bridge);
        assertTrue(gate.closeSession(first));   // wie nach einem Neustart des Dienstes

        Map<?, ?> res = (Map<?, ?>) send(call(2, "list_projects")).get("result");
        assertEquals(false, res.get("isError"));
        assertTrue(!first.equals(f.get(bridge)));
    }

    @Test
    void serviceStartedLaterIsPickedUp() throws Exception {
        new AccessToken(dir.resolve("mcp"));
        int port = freePort();
        startBridge(port);
        send(INIT);
        // Jetzt startet der Dienst auf dem erwarteten Port
        server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), port), 0);
        events = new Events();
        gate = new McpGate(dir, events);
        server.createContext("/mcp", new McpApi(gate, port, "test"));
        server.start();

        Map<?, ?> res = (Map<?, ?>) send(call(2, "list_projects")).get("result");
        assertEquals(false, res.get("isError"), Json.write(res));
    }
}
