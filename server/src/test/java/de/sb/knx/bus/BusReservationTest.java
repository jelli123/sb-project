package de.sb.knx.bus;

import com.sun.net.httpserver.HttpServer;
import de.sb.knx.api.BusApi;
import de.sb.knx.http.Events;
import de.sb.knx.http.Http;
import de.sb.knx.http.Jobs;
import de.sb.knx.json.Json;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import tuwien.auto.calimero.IndividualAddress;

import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Eine Busverbindung, zwei Fenster: Das zweite bekommt „belegt“, bis das erste weg ist. */
class BusReservationTest {

    private static final IndividualAddress TOOL = new IndividualAddress(1, 1, 250);
    private static final IndividualAddress DEV = new IndividualAddress(1, 1, 10);
    private static final String A = "window-a-0001";
    private static final String B = "window-b-0002";

    HttpServer server;
    Events events;
    BusService bus;
    FakeLink[] links;
    String base;
    final HttpClient http = HttpClient.newHttpClient();
    CompletableFuture<?> sse;

    @BeforeEach
    void start() throws Exception {
        server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
        server.setExecutor(Executors.newCachedThreadPool());
        int port = server.getAddress().getPort();
        events = new Events();
        bus = new BusService(events);
        links = FakeLink.pair(TOOL, DEV);
        bus.connectLink(links[0]);
        BusApi api = new BusApi(bus, new Jobs(events), events, port);
        server.createContext("/api/events", ex -> {
            Map<String, String> q = Http.query(ex);
            events.subscribe(ex, q.get("window"), q.get("project"));
        });
        server.createContext("/api/bus", api);
        server.start();
        base = "http://127.0.0.1:" + port;

        // Fenster A hat verbunden (ein echtes connect braeuchte eine Schnittstelle)
        set(api, "ownerWindow", A);
        set(api, "ownerProject", "Haus A");
        sse = http.sendAsync(HttpRequest.newBuilder(URI.create(base + "/api/events?window=" + A
                + "&project=" + URLEncoder.encode("Haus A", StandardCharsets.UTF_8))).build(),
                HttpResponse.BodyHandlers.ofLines());
        for (int i = 0; i < 100 && !events.connected(A); i++) Thread.sleep(20);
        assertTrue(events.connected(A));
    }

    @AfterEach
    void stop() {
        sse.cancel(true);
        bus.close();
        links[1].close();
        events.close();
        server.stop(0);
    }

    private static void set(Object o, String field, Object value) throws Exception {
        var f = o.getClass().getDeclaredField(field);
        f.setAccessible(true);
        f.set(o, value);
    }

    private HttpResponse<String> as(String window, String method, String path) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(base + path)).header("X-SB-Window", window);
        b = method.equals("POST") ? b.POST(HttpRequest.BodyPublishers.ofString("{}")) : b.GET();
        return http.send(b.build(), HttpResponse.BodyHandlers.ofString());
    }

    @Test
    void otherWindowIsRefused() throws Exception {
        HttpResponse<String> r = as(B, "POST", "/api/bus/jobs/scan-1/cancel");
        assertEquals(409, r.statusCode());
        assertEquals("Haus A", Json.parseObject(r.body()).get("busyProject"));
        assertEquals(200, as(A, "POST", "/api/bus/jobs/scan-1/cancel").statusCode());
    }

    @Test
    void statusSaysWhoHasTheBus() throws Exception {
        assertEquals("Haus A", Json.parseObject(as(B, "GET", "/api/bus/status").body()).get("busyProject"));
        assertNull(Json.parseObject(as(A, "GET", "/api/bus/status").body()).get("busyProject"));
    }

    @Test
    void reservationEndsWithTheWindow() throws Exception {
        events.bye(A);
        assertEquals(200, as(B, "POST", "/api/bus/jobs/scan-1/cancel").statusCode());
        assertNull(Json.parseObject(as(B, "GET", "/api/bus/status").body()).get("busyProject"));
    }

    @Test
    void lookingForInterfacesIsAlwaysAllowed() throws Exception {
        assertEquals(200, as(B, "GET", "/api/bus/interfaces").statusCode());
    }
}
