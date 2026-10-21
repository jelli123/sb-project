package de.sb.knx.http;

import com.sun.net.httpserver.HttpExchange;
import de.sb.knx.json.Json;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import java.util.regex.Pattern;

/**
 * Server-Sent-Events: Fortschritt und Protokoll laufender Busvorgaenge zur Oberflaeche.
 * Jedes Fenster meldet sich mit einer eigenen Kennung und dem Projekt an, das es zeigt -
 * so lassen sich Nachrichten auch an genau ein Fenster richten (KI-Aufrufe, Rueckfragen).
 */
public final class Events implements AutoCloseable {

    /** Kennung eines Fensters: von der Oberflaeche zufaellig gewaehlt, beim Neuladen neu. */
    private static final Pattern WINDOW = Pattern.compile("[A-Za-z0-9-]{8,40}");

    private final List<Client> clients = new CopyOnWriteArrayList<>();
    private final List<Consumer<String>> leaveListeners = new CopyOnWriteArrayList<>();
    private final ScheduledExecutorService ticker = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "sse-ping");
        t.setDaemon(true);
        return t;
    });

    public Events() {
        // Ohne regelmaessigen Verkehr schliessen Zwischenschichten die Verbindung.
        ticker.scheduleAtFixedRate(() -> broadcast(":ping\n\n"), 20, 20, TimeUnit.SECONDS);
    }

    /** Liefert die Fensterkennung oder null, wenn sie fehlt oder nicht die erwartete Form hat. */
    public static String windowId(String raw) {
        return raw != null && WINDOW.matcher(raw).matches() ? raw : null;
    }

    public void subscribe(HttpExchange ex, String window, String project) throws IOException {
        ex.getResponseHeaders().set("Content-Type", "text/event-stream; charset=utf-8");
        ex.getResponseHeaders().set("Cache-Control", "no-store");
        ex.getResponseHeaders().set("Connection", "keep-alive");
        ex.sendResponseHeaders(200, 0);
        Client c = new Client(ex, ex.getResponseBody(), windowId(window), project);
        clients.add(c);
        c.write("retry: 2000\n\n");
    }

    /** Wird gerufen, wenn ein Fenster seine Ereignisleitung verliert oder sich abmeldet. */
    public void onLeave(Consumer<String> listener) {
        leaveListeners.add(listener);
    }

    public void publish(String event, Object data) {
        broadcast(frame(event, data));
    }

    /** Schickt ein Ereignis nur an ein Fenster. false, wenn es nicht (mehr) verbunden ist. */
    public boolean send(String window, String event, Object data) {
        if (window == null) return false;
        String f = frame(event, data);
        boolean sent = false;
        for (Client c : clients) {
            if (!window.equals(c.window)) continue;
            if (c.write(f)) sent = true;
            else drop(c);
        }
        return sent;
    }

    /** Fenster, die gerade dieses Projekt zeigen - das zuletzt verbundene zuerst. */
    public List<String> windowsOf(String project) {
        List<String> out = new ArrayList<>();
        for (int i = clients.size() - 1; i >= 0; i--) {
            Client c = clients.get(i);
            if (c.window != null && project.equals(c.project) && !out.contains(c.window)) out.add(c.window);
        }
        return out;
    }

    public boolean connected(String window) {
        if (window == null) return false;
        for (Client c : clients) if (window.equals(c.window)) return true;
        return false;
    }

    /** Das Fenster schliesst sich (pagehide) - nicht erst beim naechsten Ping bemerken. */
    public void bye(String window) {
        if (window == null) return;
        for (Client c : clients) if (window.equals(c.window)) drop(c);
    }

    public void log(String level, String message) {
        Map<String, Object> m = Json.obj();
        m.put("level", level);
        m.put("message", message);
        m.put("at", System.currentTimeMillis());
        publish("log", m);
    }

    private static String frame(String event, Object data) {
        return "event: " + event + "\ndata: " + Json.write(data) + "\n\n";
    }

    private void broadcast(String frame) {
        for (Client c : clients) {
            if (!c.write(frame)) drop(c);
        }
    }

    private void drop(Client c) {
        if (!clients.remove(c)) return;
        c.close();
        if (c.window != null && !connected(c.window)) {
            for (Consumer<String> l : leaveListeners) {
                try {
                    l.accept(c.window);
                } catch (RuntimeException ignored) {
                    // Ein fehlerhafter Zuhoerer darf die Ereignisleitung nicht anhalten
                }
            }
        }
    }

    @Override
    public void close() {
        ticker.shutdownNow();
        clients.forEach(Client::close);
        clients.clear();
    }

    private record Client(HttpExchange exchange, OutputStream out, String window, String project) {
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
