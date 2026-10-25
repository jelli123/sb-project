package de.sb.knx;

import com.sun.net.httpserver.HttpServer;
import de.sb.knx.api.BusApi;
import de.sb.knx.api.CatalogApi;
import de.sb.knx.api.ChatApi;
import de.sb.knx.api.ManualApi;
import de.sb.knx.api.McpUiApi;
import de.sb.knx.api.OnlineApi;
import de.sb.knx.api.ProjectApi;
import de.sb.knx.api.SecureApi;
import de.sb.knx.bus.BusService;
import de.sb.knx.chat.ChatService;
import de.sb.knx.chat.ManualStore;
import de.sb.knx.http.Events;
import de.sb.knx.http.Http;
import de.sb.knx.http.Jobs;
import de.sb.knx.http.StaticFiles;
import de.sb.knx.json.Json;
import de.sb.knx.mcp.McpApi;
import de.sb.knx.mcp.McpGate;
import de.sb.knx.mcp.StdioBridge;
import de.sb.knx.online.OnlineCatalog;
import de.sb.knx.store.FileStore;
import de.sb.knx.secure.KeyVault;
import de.sb.knx.store.CatalogStore;
import de.sb.knx.store.ProjectStore;

import java.awt.Desktop;
import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.Executors;

/** Startet den lokalen Dienst: Weboberflaeche, Projektablage, Produktkatalog und Busanbindung. */
public final class Main {

    public static void main(String[] args) throws Exception {
        int port = 8420;
        Path data = null;
        Path web = null;
        boolean openBrowser = true;
        boolean debug = false;
        boolean mcpStdio = false;
        Path claude = null;
        boolean chatApi = false;

        for (int i = 0; i < args.length; i++) {
            switch (args[i]) {
                case "--port" -> port = Integer.parseInt(args[++i]);
                case "--data" -> data = Paths.get(args[++i]);
                case "--web" -> web = Paths.get(args[++i]);
                case "--no-browser" -> openBrowser = false;
                case "--debug" -> debug = true;
                case "--mcp-stdio" -> mcpStdio = true;
                case "--claude" -> claude = Paths.get(args[++i]);
                case "--chat-api" -> chatApi = true;
                case "--help", "-h" -> {
                    printUsage();
                    return;
                }
                default -> {
                    System.err.println("Unbekannte Option: " + args[i]);
                    printUsage();
                    System.exit(2);
                }
            }
        }

        Path dataDir = data != null ? data.toAbsolutePath() : defaultDataDir();
        if (mcpStdio) {
            // Kein Dienst, kein Browser, keine Ausgabe auf stdout: nur die Bruecke zum laufenden Dienst
            StdioBridge.run(port, dataDir);
            return;
        }
        Path webDir = web != null ? web.toAbsolutePath() : findWebRoot();
        Files.createDirectories(dataDir);
        if (!Files.isRegularFile(webDir.resolve("index.html"))) {
            System.err.println("Keine index.html unter " + webDir + " gefunden. Bitte --web angeben.");
            System.exit(2);
        }

        ProjectStore projects = new ProjectStore(dataDir);
        CatalogStore catalog = new CatalogStore(dataDir);
        OnlineCatalog online = new OnlineCatalog(dataDir);
        Events events = new Events();
        Jobs jobs = new Jobs(events);
        BusService bus = new BusService(events);
        KeyVault vault = new KeyVault(dataDir);
        bus.vault(vault);
        McpGate mcp = new McpGate(dataDir, events);

        HttpServer http = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), port), 0);
        http.setExecutor(Executors.newCachedThreadPool(r -> {
            Thread t = new Thread(r, "http");
            t.setDaemon(true);
            return t;
        }));

        int boundPort = port;
        boolean debugUi = debug;
        http.createContext("/api/projects", new ProjectApi(projects, vault, events, boundPort));
        http.createContext("/api/settings", new ProjectApi(projects, vault, events, boundPort));
        http.createContext("/api/secure", new SecureApi(vault, boundPort));
        http.createContext("/api/catalog", new CatalogApi(catalog, boundPort));
        http.createContext("/api/online", new OnlineApi(online, jobs, events, boundPort));
        http.createContext("/api/bus", new BusApi(bus, jobs, events, boundPort));
        http.createContext("/api/events", ex -> {
            if (!Http.localOnly(ex, boundPort)) return;
            Map<String, String> q = Http.query(ex);
            if (ex.getRequestURI().getPath().equals("/api/events/bye")) {
                // Das Fenster schliesst sich - seine KI-Freigabe soll nicht erst beim naechsten Ping fallen
                events.bye(Events.windowId(q.get("window")));
                Http.send(ex, 204, "text/plain", new byte[0]);
                return;
            }
            String project = null;
            try {
                if (q.get("project") != null) project = FileStore.safeId(q.get("project"));
            } catch (IllegalArgumentException e) {
                project = null;
            }
            events.subscribe(ex, q.get("window"), project);
        });
        String version = Main.class.getPackage().getImplementationVersion();
        http.createContext("/mcp", new McpApi(mcp, boundPort, version));
        http.createContext("/api/mcp", new McpUiApi(mcp, boundPort));
        ManualStore manuals = new ManualStore(dataDir);
        http.createContext("/api/manuals", new ManualApi(manuals, boundPort));
        ChatService chat = new ChatService(dataDir, manuals.filesDir(), events, mcp, boundPort, claude, chatApi);
        http.createContext("/api/chat", new ChatApi(chat, boundPort));
        http.createContext("/api/info", ex -> {
            if (!Http.localOnly(ex, boundPort)) return;
            Map<String, Object> m = Json.obj();
            m.put("service", "sb-server");
            m.put("version", Main.class.getPackage().getImplementationVersion());
            m.put("dataDir", dataDir.toString());
            m.put("webDir", webDir.toString());
            // Blendet in der Oberflaeche das Inbetriebnahme-Fenster zum Testen und Debuggen ein
            m.put("debug", debugUi);
            // Starter fuer KI-Programme, die MCP-Server als Unterprozess starten (Claude Desktop)
            m.put("mcpStarter", mcpStarter(webDir));
            Http.json(ex, 200, m);
        });
        http.createContext("/", new StaticFiles(webDir, boundPort));

        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            chat.close();
            mcp.close();
            bus.close();
            events.close();
            http.stop(0);
        }, "shutdown"));

        http.start();
        String url = "http://127.0.0.1:" + boundPort + "/";
        System.out.println("SB-Project laeuft auf " + url);
        System.out.println("  Daten:  " + dataDir);
        System.out.println("  Web:    " + webDir);
        System.out.println("  KI:     " + url + "mcp (Zugang erst nach Freigabe im Fenster)");
        if (debug) System.out.println("  Debug:  Inbetriebnahme-Fenster eingeblendet");
        System.out.println("Beenden mit Strg+C.");

        if (openBrowser) openInBrowser(url);
    }

    private static void printUsage() {
        System.out.println("""
                Aufruf: sb-server [Optionen]
                  --port <n>      Port des lokalen Dienstes (Vorgabe 8420)
                  --data <pfad>   Verzeichnis fuer Projekte und Produktkatalog
                  --web <pfad>    Verzeichnis mit index.html und den JS-Dateien
                  --no-browser    Browser nicht automatisch oeffnen
                  --debug         Inbetriebnahme-Fenster zum Testen und Debuggen einblenden
                  --claude <pfad> Claude-Code-Kommandozeile fuer den KI-Chat (sonst wird sie gesucht)
                  --chat-api      KI-Chat auch mit API-Schluessel bzw. API-Anmeldung (wird abgerechnet);
                                  ohne bleibt ANTHROPIC_API_KEY beim Chat aussen vor
                  --mcp-stdio     MCP ueber stdin/stdout fuer KI-Programme wie Claude Desktop;
                                  reicht alles an den laufenden Dienst weiter (gleiche --port/--data)
                """);
    }

    /** sb-project-mcp.sh/.cmd liegt im Repo neben der Oberflaeche, im Paket eine Ebene darueber. */
    private static String mcpStarter(Path webDir) {
        boolean win = System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win");
        String name = win ? "sb-project-mcp.cmd" : "sb-project-mcp.sh";
        for (Path dir : new Path[] {webDir, webDir.getParent()}) {
            if (dir != null && Files.isRegularFile(dir.resolve(name))) return dir.resolve(name).toString();
        }
        return null;
    }

    private static Path defaultDataDir() {
        String os = System.getProperty("os.name", "").toLowerCase(Locale.ROOT);
        if (os.contains("win")) {
            String local = System.getenv("LOCALAPPDATA");
            if (local != null && !local.isBlank()) return adoptOldDataDir(Paths.get(local, "SB-Projekt"), Paths.get(local, "SB-Project"));
        }
        Path share = Paths.get(System.getProperty("user.home"), ".local", "share");
        return adoptOldDataDir(share.resolve("sb-projekt"), share.resolve("sb-project"));
    }

    /** Bis 0.2.1 hiess das Verzeichnis sb-projekt; es wird einmalig umbenannt, sonst weiter benutzt. */
    private static Path adoptOldDataDir(Path old, Path dir) {
        if (Files.exists(dir) || !Files.isDirectory(old)) return dir;
        try {
            Files.move(old, dir);
            System.out.println("Datenverzeichnis umbenannt: " + old + " -> " + dir);
            return dir;
        } catch (IOException e) {
            System.err.println("Altes Datenverzeichnis bleibt in Gebrauch (" + e.getMessage() + "): " + old);
            return old;
        }
    }

    /** Sucht die Weboberflaeche neben dem Arbeitsverzeichnis - im Projekt liegt sie eine Ebene ueber server/. */
    private static Path findWebRoot() {
        Path here = Paths.get("").toAbsolutePath();
        for (Path candidate : new Path[] {here, here.getParent(), here.resolve("web")}) {
            if (candidate != null && Files.isRegularFile(candidate.resolve("index.html"))) return candidate;
        }
        return here;
    }

    private static void openInBrowser(String url) {
        try {
            if (Desktop.isDesktopSupported() && Desktop.getDesktop().isSupported(Desktop.Action.BROWSE)) {
                Desktop.getDesktop().browse(URI.create(url));
            }
        } catch (IOException | RuntimeException e) {
            System.out.println("Browser konnte nicht geoeffnet werden: " + e.getMessage());
        }
    }
}
