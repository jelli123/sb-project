package de.sb.knx;

import com.sun.net.httpserver.HttpServer;
import de.sb.knx.api.BusApi;
import de.sb.knx.api.CatalogApi;
import de.sb.knx.api.ProjectApi;
import de.sb.knx.bus.BusService;
import de.sb.knx.http.Events;
import de.sb.knx.http.Http;
import de.sb.knx.http.Jobs;
import de.sb.knx.http.StaticFiles;
import de.sb.knx.json.Json;
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

        for (int i = 0; i < args.length; i++) {
            switch (args[i]) {
                case "--port" -> port = Integer.parseInt(args[++i]);
                case "--data" -> data = Paths.get(args[++i]);
                case "--web" -> web = Paths.get(args[++i]);
                case "--no-browser" -> openBrowser = false;
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
        Path webDir = web != null ? web.toAbsolutePath() : findWebRoot();
        Files.createDirectories(dataDir);
        if (!Files.isRegularFile(webDir.resolve("index.html"))) {
            System.err.println("Keine index.html unter " + webDir + " gefunden. Bitte --web angeben.");
            System.exit(2);
        }

        ProjectStore projects = new ProjectStore(dataDir);
        CatalogStore catalog = new CatalogStore(dataDir);
        Events events = new Events();
        Jobs jobs = new Jobs(events);
        BusService bus = new BusService();

        HttpServer http = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), port), 0);
        http.setExecutor(Executors.newCachedThreadPool(r -> {
            Thread t = new Thread(r, "http");
            t.setDaemon(true);
            return t;
        }));

        int boundPort = port;
        http.createContext("/api/projects", new ProjectApi(projects, boundPort));
        http.createContext("/api/settings", new ProjectApi(projects, boundPort));
        http.createContext("/api/catalog", new CatalogApi(catalog, boundPort));
        http.createContext("/api/bus", new BusApi(bus, jobs, events, boundPort));
        http.createContext("/api/events", ex -> {
            if (!Http.localOnly(ex, boundPort)) return;
            events.subscribe(ex);
        });
        http.createContext("/api/info", ex -> {
            if (!Http.localOnly(ex, boundPort)) return;
            Map<String, Object> m = Json.obj();
            m.put("service", "sb-server");
            m.put("version", Main.class.getPackage().getImplementationVersion());
            m.put("dataDir", dataDir.toString());
            m.put("webDir", webDir.toString());
            Http.json(ex, 200, m);
        });
        http.createContext("/", new StaticFiles(webDir, boundPort));

        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            bus.close();
            events.close();
            http.stop(0);
        }, "shutdown"));

        http.start();
        String url = "http://127.0.0.1:" + boundPort + "/";
        System.out.println("SB-Projekt laeuft auf " + url);
        System.out.println("  Daten:  " + dataDir);
        System.out.println("  Web:    " + webDir);
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
                """);
    }

    private static Path defaultDataDir() {
        String os = System.getProperty("os.name", "").toLowerCase(Locale.ROOT);
        if (os.contains("win")) {
            String local = System.getenv("LOCALAPPDATA");
            if (local != null && !local.isBlank()) return Paths.get(local, "SB-Projekt");
        }
        return Paths.get(System.getProperty("user.home"), ".local", "share", "sb-projekt");
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
