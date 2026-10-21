package de.sb.knx.mcp;

import de.sb.knx.json.Json;

import java.io.BufferedReader;
import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.net.ConnectException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpConnectTimeoutException;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * Bruecke fuer KI-Programme, die einen MCP-Server nur als Unterprozess kennen (Claude Desktop):
 * Jede Zeile auf stdin ist eine JSON-RPC-Nachricht. Sie geht per HTTP an den laufenden Dienst
 * ({@code /mcp}), dessen Antwort als eine Zeile auf stdout zurueck. Pruefen, Filtern und
 * Platzhalter bleiben Sache des Dienstes - die Bruecke selbst sieht keine Projektdaten.
 *
 * <p>Laeuft SB-Projekt (noch) nicht, beantwortet die Bruecke {@code initialize} und
 * {@code tools/list} selbst, und jeder Werkzeugaufruf meldet, dass der Dienst fehlt. So bleibt
 * der Server im KI-Programm nutzbar, sobald SB-Projekt gestartet wird. Nach einem Neustart des
 * Dienstes meldet sie sich still neu an; den Zugangsschluessel liest sie bei jeder Anfrage aus
 * der Datei, ein erneuerter Schluessel gilt also sofort.
 */
public final class StdioBridge {

    private static final int MAX_LINE = 256 << 10;

    private final URI endpoint;
    private final Path tokenFile;
    private final PrintStream out;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
    private final ExecutorService pool = Executors.newCachedThreadPool(r -> {
        Thread t = new Thread(r, "mcp-stdio");
        t.setDaemon(true);
        return t;
    });

    private final Object initLock = new Object();
    private volatile String initMessage;
    private volatile String protocol;
    private volatile String session;

    StdioBridge(int port, Path dataDir, PrintStream out) {
        this.endpoint = URI.create("http://127.0.0.1:" + port + "/mcp");
        this.tokenFile = dataDir.resolve("mcp").resolve("token");
        this.out = out;
    }

    /** Einstieg von Main ({@code --mcp-stdio}). stdout gehoert ab hier allein dem Protokoll. */
    public static void run(int port, Path dataDir) throws IOException, InterruptedException {
        PrintStream protocolOut = new PrintStream(new FileOutputStream(FileDescriptor.out), false, StandardCharsets.UTF_8);
        System.setOut(System.err);
        new StdioBridge(port, dataDir, protocolOut).loop(System.in);
    }

    void loop(InputStream in) throws IOException, InterruptedException {
        BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
        String line;
        while ((line = reader.readLine()) != null) {
            if (line.isBlank()) continue;
            if (line.length() > MAX_LINE) {
                write(McpApi.error(null, -32600, "Nachricht zu gross"));
                continue;
            }
            Map<String, Object> msg;
            try {
                msg = Json.parseObject(line);
            } catch (IllegalArgumentException e) {
                write(McpApi.error(null, -32700, "Kein gueltiges JSON: " + e.getMessage()));
                continue;
            }
            String raw = line;
            // initialize zuerst und allein: alles danach braucht die Sitzung
            if ("initialize".equals(msg.get("method"))) handle(raw, msg);
            else pool.execute(() -> handle(raw, msg));
        }
        pool.shutdown();
        pool.awaitTermination(5, TimeUnit.SECONDS);
        closeSession();
    }

    private void handle(String raw, Map<String, Object> msg) {
        Object id = msg.get("id");
        String method = msg.get("method") instanceof String m ? m : null;
        try {
            if ("initialize".equals(method)) {
                initialize(raw, id, msg);
                return;
            }
            ensureSession();
            HttpResponse<String> r = post(raw);
            if (r.statusCode() == 404 && initMessage != null) {
                // Der Dienst wurde neu gestartet und kennt die Sitzung nicht mehr
                session = null;
                ensureSession();
                r = post(raw);
            }
            relay(r, id);
        } catch (ConnectException | HttpConnectTimeoutException e) {
            offline(id, method, msg);
        } catch (IOException e) {
            if (id != null) write(McpApi.error(id, -32000, "SB-Projekt antwortet nicht: " + e.getMessage()));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private void initialize(String raw, Object id, Map<String, Object> msg) throws InterruptedException {
        initMessage = raw;
        Map<String, Object> params = msg.get("params") instanceof Map<?, ?> p ? cast(p) : Json.obj();
        protocol = McpApi.negotiate(params);
        synchronized (initLock) {
            session = null;
            try {
                HttpResponse<String> r = post(raw);
                r.headers().firstValue("Mcp-Session-Id").ifPresent(s -> session = s);
                relay(r, id);
                return;
            } catch (IOException e) {
                String why = e instanceof ConnectException || e.getMessage() == null ? "keine Verbindung" : e.getMessage();
                System.err.println("SB-Projekt nicht erreichbar (" + endpoint + "): " + why
                        + " - die Werkzeuge melden das, bis der Dienst laeuft.");
            }
        }
        // Ohne Dienst: selbst antworten, angemeldet wird beim ersten Aufruf, der ihn erreicht
        write(McpApi.result(id, McpApi.initializeResult(protocol, StdioBridge.class.getPackage().getImplementationVersion())));
    }

    /** Meldet die Bruecke beim Dienst an, wenn sie es (nach dessen Start oder Neustart) noch nicht ist. */
    private void ensureSession() throws IOException, InterruptedException {
        if (session != null || initMessage == null) return;
        synchronized (initLock) {
            if (session != null) return;
            HttpResponse<String> r = post(initMessage);
            String sid = r.headers().firstValue("Mcp-Session-Id").orElse(null);
            if (r.statusCode() != 200 || sid == null) {
                throw new IOException("Anmeldung beim Dienst gescheitert (HTTP " + r.statusCode() + ")");
            }
            session = sid;
            post("{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}");
        }
    }

    /** Antwort des Dienstes weitergeben; Fehler ohne JSON-RPC-Huelle bekommen eine. */
    private void relay(HttpResponse<String> r, Object id) {
        String body = r.body() == null ? "" : r.body().strip();
        if (r.statusCode() == 202 || body.isEmpty()) return;
        if (body.contains("\"jsonrpc\"")) {
            writeRaw(body);
            return;
        }
        if (id == null) return;
        String detail = body;
        try {
            detail = Json.str(Json.parseObject(body), "error", body);
        } catch (IllegalArgumentException ignored) {
            // kein JSON - dann eben der Text
        }
        String msg = r.statusCode() == 401
                ? "Zugangsschluessel abgelehnt - ist " + tokenFile + " lesbar und vom laufenden Dienst?"
                : "SB-Projekt meldet HTTP " + r.statusCode() + ": " + detail;
        write(McpApi.error(id, -32000, msg));
    }

    /** Der Dienst ist nicht erreichbar: so antworten, dass die KI es dem Nutzer sagen kann. */
    private void offline(Object id, String method, Map<String, Object> msg) {
        if (id == null) return;
        String hint = "SB-Projekt laeuft nicht (" + endpoint + "). Bitte SB-Projekt starten, das Projekt "
                + "oeffnen und den KI-Zugang im Fenster auf 'Lesen' stellen.";
        switch (method == null ? "" : method) {
            case "ping" -> write(McpApi.result(id, Json.obj()));
            case "tools/list" -> {
                Map<String, Object> r = Json.obj();
                r.put("tools", Tools.listing());
                write(McpApi.result(id, r));
            }
            case "tools/call" -> write(McpApi.toolResult(id, hint, true));
            default -> write(McpApi.error(id, -32000, hint));
        }
    }

    private HttpResponse<String> post(String body) throws IOException, InterruptedException {
        HttpRequest.Builder b = HttpRequest.newBuilder(endpoint)
                .timeout(Duration.ofSeconds(180))
                .header("Content-Type", "application/json")
                .header("Accept", "application/json, text/event-stream")
                .header("Authorization", "Bearer " + token())
                .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8));
        String sid = session;
        if (sid != null) b.header("Mcp-Session-Id", sid);
        if (sid != null && protocol != null) b.header("MCP-Protocol-Version", protocol);
        return http.send(b.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    }

    private String token() throws IOException {
        try {
            return Files.readString(tokenFile, StandardCharsets.US_ASCII).strip();
        } catch (IOException e) {
            throw new IOException("Zugangsschluessel nicht lesbar: " + tokenFile, e);
        }
    }

    private void closeSession() {
        String sid = session;
        if (sid == null) return;
        try {
            http.send(HttpRequest.newBuilder(endpoint).timeout(Duration.ofSeconds(3))
                    .header("Authorization", "Bearer " + token()).header("Mcp-Session-Id", sid)
                    .DELETE().build(), HttpResponse.BodyHandlers.discarding());
        } catch (IOException | InterruptedException ignored) {
            // Beim Beenden egal - die Sitzung laeuft im Dienst ohnehin ab
        }
    }

    private void write(Map<String, Object> message) {
        writeRaw(Json.write(message));
    }

    private void writeRaw(String line) {
        synchronized (out) {
            out.print(line.replace("\n", " ").replace("\r", " "));
            out.print('\n');
            out.flush();
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> cast(Map<?, ?> m) {
        return (Map<String, Object>) m;
    }
}
