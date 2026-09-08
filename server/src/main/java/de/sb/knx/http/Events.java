package de.sb.knx.http;

import com.sun.net.httpserver.HttpExchange;
import de.sb.knx.json.Json;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/** Server-Sent-Events: Fortschritt und Protokoll laufender Busvorgaenge zur Oberflaeche. */
public final class Events implements AutoCloseable {

    private final List<Client> clients = new CopyOnWriteArrayList<>();
    private final ScheduledExecutorService ticker = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "sse-ping");
        t.setDaemon(true);
        return t;
    });

    public Events() {
        // Ohne regelmaessigen Verkehr schliessen Zwischenschichten die Verbindung.
        ticker.scheduleAtFixedRate(() -> broadcast(":ping\n\n"), 20, 20, TimeUnit.SECONDS);
    }

    public void subscribe(HttpExchange ex) throws IOException {
        ex.getResponseHeaders().set("Content-Type", "text/event-stream; charset=utf-8");
        ex.getResponseHeaders().set("Cache-Control", "no-store");
        ex.getResponseHeaders().set("Connection", "keep-alive");
        ex.sendResponseHeaders(200, 0);
        Client c = new Client(ex, ex.getResponseBody());
        clients.add(c);
        c.write("retry: 2000\n\n");
    }

    public void publish(String event, Object data) {
        broadcast("event: " + event + "\ndata: " + Json.write(data) + "\n\n");
    }

    public void log(String level, String message) {
        Map<String, Object> m = Json.obj();
        m.put("level", level);
        m.put("message", message);
        m.put("at", System.currentTimeMillis());
        publish("log", m);
    }

    private void broadcast(String frame) {
        for (Client c : clients) {
            if (!c.write(frame)) {
                clients.remove(c);
                c.close();
            }
        }
    }

    @Override
    public void close() {
        ticker.shutdownNow();
        clients.forEach(Client::close);
        clients.clear();
    }

    private record Client(HttpExchange exchange, OutputStream out) {
        boolean write(String frame) {
            try {
                synchronized (out) {
                    out.write(frame.getBytes(StandardCharsets.UTF_8));
                    out.flush();
                }
                return true;
            } catch (IOException e) {
                return false;
            }
        }

        void close() {
            try {
                out.close();
            } catch (IOException ignored) {
                // Verbindung war ohnehin schon weg
            }
            exchange.close();
        }
    }
}
