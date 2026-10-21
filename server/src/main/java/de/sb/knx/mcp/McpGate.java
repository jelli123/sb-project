package de.sb.knx.mcp;

import de.sb.knx.http.Events;
import de.sb.knx.json.Json;

import java.io.IOException;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * Schaltstelle zwischen KI-Sitzungen und den Fenstern der Oberflaeche.
 *
 * <p>Ein Projekt ist fuer die KI nur erreichbar, solange es in einem Fenster offen ist und dort
 * freigegeben wurde. Nach jedem Start des Dienstes ist alles aus; schliesst das letzte Fenster
 * eines Projekts, faellt dessen Freigabe nach kurzer Schonfrist (fuers Neuladen) wieder auf Aus.
 *
 * <p>Ein Aufruf geht als Ereignis an das Fenster, das Fenster rechnet mit seinem Datenmodell und
 * schickt das Ergebnis zurueck. Bevor es die KI erreicht, schneidet {@link Shape} alles ab, was das
 * Werkzeug nicht ausdruecklich vorsieht, und {@link Privacy} setzt die Platzhalter ein.
 */
public final class McpGate implements AutoCloseable {

    public enum Mode {
        OFF("off"), READ("read"), PROPOSE("propose"), STEP("step"), AUTO("auto");

        public final String key;

        Mode(String key) {
            this.key = key;
        }

        static Mode of(String key) {
            for (Mode m : values()) if (m.key.equals(key)) return m;
            throw new IllegalArgumentException("Unbekannter Freigabemodus: " + key);
        }
    }

    /** Waehlbare Modi. */
    static final Set<Mode> AVAILABLE = EnumSet.allOf(Mode.class);

    /** Modi, in denen schreibende Werkzeuge wirken. */
    static final Set<Mode> WRITING = EnumSet.of(Mode.PROPOSE, Mode.STEP, Mode.AUTO);

    static final int MAX_SESSIONS = 8;
    static final long SESSION_IDLE_MS = TimeUnit.HOURS.toMillis(12);
    static final int MAX_PENDING_PER_SESSION = 4;
    static final long GRACE_MS = 10_000;
    static final int MAX_RESULT_CHARS = 1 << 20;
    static final int RECENT = 40;

    /** Ein Fehler, den die KI als Ergebnis des Werkzeugs zu sehen bekommt. */
    public static final class ToolError extends Exception {
        public ToolError(String message) {
            super(message);
        }
    }

    public static final class Session {
        final String id;
        final String label;
        final String client;
        final String protocol;
        final long created = System.currentTimeMillis();
        volatile long lastSeen = created;
        volatile int calls;
        volatile int pending;

        Session(String id, String label, String client, String protocol) {
            this.id = id;
            this.label = label;
            this.client = client;
            this.protocol = protocol;
        }

        public String id() {
            return id;
        }

        public String protocol() {
            return protocol;
        }
    }

    private static final class Release {
        final String project;
        Mode mode;
        String window;
        long since;

        Release(String project) {
            this.project = project;
        }
    }

    private record Pending(String window, String project, String session,
                           CompletableFuture<Map<String, Object>> future) {}

    private static final Tools.Tool SUMMARY = new Tools.Tool("summary", "Summary", "", Shape.obj(),
            Tools.SUMMARY, Tools.Level.READ, 10);

    private final Events events;
    private final AccessToken token;
    private final Audit audit;
    private final ScheduledExecutorService timer = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "mcp-timer");
        t.setDaemon(true);
        return t;
    });
    private final SecureRandom random = new SecureRandom();

    private final Map<String, Session> sessions = new LinkedHashMap<>();
    private int sessionSeq;
    private final Map<String, Release> releases = new HashMap<>();
    private final Map<String, String> handles = new HashMap<>();
    private final Map<String, String> byHandle = new HashMap<>();
    private final Map<String, Privacy> privacy = new HashMap<>();
    private final Map<String, Pending> pending = new ConcurrentHashMap<>();
    private final Deque<Map<String, Object>> recent = new ArrayDeque<>();

    public McpGate(Path dataDir, Events events) throws IOException {
        Path dir = dataDir.resolve("mcp");
        this.events = events;
        this.token = new AccessToken(dir);
        this.audit = new Audit(dir);
        events.onLeave(this::windowLeft);
    }

    public boolean authorized(String authorization) {
        return token.check(authorization);
    }

    public Path tokenFile() {
        return token.file();
    }

    /** Neuer Schluessel: alle verbundenen KI-Sitzungen muessen sich neu einrichten. */
    public void rotateToken() throws IOException {
        token.rotate();
        synchronized (this) {
            sessions.clear();
        }
        failPending(p -> true, "Der Zugangsschluessel wurde erneuert.");
        publishAll();
    }

    /* ================= Sitzungen ================= */

    public synchronized Session openSession(String client, String protocol) {
        expireSessions();
        while (sessions.size() >= MAX_SESSIONS) {
            Iterator<Session> it = sessions.values().iterator();
            Session oldest = it.next();
            it.remove();
            events.log("info", "KI-Sitzung " + oldest.label + " beendet (zu viele Sitzungen)");
        }
        String id = HexFormat.of().formatHex(randomBytes(16));
        Session s = new Session(id, "s" + (++sessionSeq), client, protocol);
        sessions.put(id, s);
        events.log("info", "KI-Sitzung " + s.label + " verbunden: " + client);
        publishAllLater();
        return s;
    }

    public synchronized Session session(String id) {
        expireSessions();
        Session s = id == null ? null : sessions.get(id);
        if (s != null) s.lastSeen = System.currentTimeMillis();
        return s;
    }

    public synchronized boolean closeSession(String id) {
        Session s = sessions.remove(id);
        if (s == null) return false;
        events.log("info", "KI-Sitzung " + s.label + " beendet");
        publishAllLater();
        return true;
    }

    private void expireSessions() {
        long now = System.currentTimeMillis();
        sessions.values().removeIf(s -> s.pending == 0 && now - s.lastSeen > SESSION_IDLE_MS);
    }

    /* ================= Freigabe aus dem Fenster ================= */

    public void setMode(String project, String window, String modeKey) {
        Mode mode = Mode.of(modeKey);
        if (!AVAILABLE.contains(mode)) {
            throw new IllegalArgumentException("Dieser Modus ist nicht verfuegbar");
        }
        if (window == null || !events.windowsOf(project).contains(window)) {
            throw new IllegalStateException("Das Fenster ist nicht an der Ereignisleitung angemeldet");
        }
        synchronized (this) {
            if (mode == Mode.OFF) {
                releases.remove(project);
            } else {
                Release r = releases.computeIfAbsent(project, Release::new);
                if (r.mode != mode) r.since = System.currentTimeMillis();
                r.mode = mode;
                r.window = window;
                handleOf(project);
            }
        }
        if (mode == Mode.OFF) failPending(p -> p.project.equals(project), "Der Nutzer hat den KI-Zugriff abgeschaltet.");
        events.log("info", "KI-Zugriff fuer " + project + ": " + mode.key);
        publish(project);
    }

    public synchronized Map<String, Object> status(String project) {
        Release r = releases.get(project);
        Map<String, Object> m = Json.obj();
        m.put("project", project);
        m.put("mode", r == null ? Mode.OFF.key : r.mode.key);
        m.put("since", r == null ? null : r.since);
        m.put("handle", handles.get(project));
        List<Object> modes = Json.arr();
        for (Mode x : AVAILABLE) modes.add(x.key);
        m.put("available", modes);
        List<Object> list = Json.arr();
        for (Session s : sessions.values()) {
            Map<String, Object> e = Json.obj();
            e.put("label", s.label);
            e.put("client", s.client);
            e.put("since", s.created);
            e.put("lastSeen", s.lastSeen);
            e.put("calls", s.calls);
            list.add(e);
        }
        m.put("sessions", list);
        List<Object> rec = Json.arr();
        for (Map<String, Object> e : recent) if (project.equals(e.get("projectId"))) rec.add(publicEntry(e));
        m.put("recent", rec);
        m.put("busy", pendingFor(project));
        m.put("tokenFile", token.file().toString());
        return m;
    }

    private void windowLeft(String window) {
        failPending(p -> p.window.equals(window), "Das Fenster mit dem Projekt wurde geschlossen.");
        List<String> affected = new ArrayList<>();
        synchronized (this) {
            for (Release r : releases.values()) if (window.equals(r.window)) affected.add(r.project);
        }
        if (affected.isEmpty()) return;
        // Schonfrist: Beim Neuladen meldet sich das Fenster gleich wieder an
        timer.schedule(() -> {
            for (String project : affected) {
                List<String> windows = events.windowsOf(project);
                boolean dropped;
                synchronized (this) {
                    Release r = releases.get(project);
                    if (r == null || !window.equals(r.window)) continue;
                    if (windows.isEmpty()) {
                        releases.remove(project);
                        dropped = true;
                    } else {
                        r.window = windows.get(0);
                        dropped = false;
                    }
                }
                if (dropped) events.log("info", "KI-Zugriff fuer " + project + " aus: kein Fenster mehr offen");
                publish(project);
            }
        }, GRACE_MS, TimeUnit.MILLISECONDS);
    }

    /** Ergebnis eines Aufrufs aus dem Fenster. */
    public void result(String window, Map<String, Object> body) {
        String call = Json.str(body, "call", null);
        Pending p = call == null ? null : pending.get(call);
        if (p == null) throw new IllegalArgumentException("Unbekannter oder abgelaufener Aufruf");
        if (!p.window.equals(window)) throw new IllegalStateException("Antwort aus einem anderen Fenster");
        p.future.complete(body);
    }

    /**
     * Zeigt dem Nutzer, was die KI von einem Ergebnis zu sehen bekaeme - derselbe Weg wie beim
     * echten Aufruf, nur ohne KI.
     */
    public Map<String, Object> preview(String project, String tool, Map<String, Object> body) {
        Tools.Tool t = Tools.byName(tool);
        if (t == null) throw new IllegalArgumentException("Unbekanntes Werkzeug: " + tool);
        Object data = body.get("data");
        if (!(data instanceof Map<?, ?>)) throw new IllegalArgumentException("Feld data fehlt");
        Shape.Out ctx = outContext(project, body);
        Map<String, Object> m = Json.obj();
        m.put("result", t.output().out(data, ctx, ""));
        m.put("dropped", ctx.dropped);
        m.put("droppedPaths", new ArrayList<>(ctx.droppedPaths));
        return m;
    }

    /* ================= Aufrufe der KI ================= */

    public Map<String, Object> call(Session s, Tools.Tool tool, Map<String, Object> rawArgs) throws ToolError {
        long t0 = System.currentTimeMillis();
        String project = null;
        Shape.Out ctx = null;
        String error = null;
        try {
            if (tool.name().equals("list_projects")) {
                if (!rawArgs.isEmpty()) throw new ToolError("list_projects erwartet keine Argumente");
                return listProjects(s);
            }
            project = resolve(rawArgs.get("project"));
            Map<String, Object> args;
            try {
                args = tool.input().in(rawArgs, privacyOf(project), "");
            } catch (IllegalArgumentException e) {
                throw new ToolError(e.getMessage());
            }
            args.remove("project");
            if (tool.level() == Tools.Level.WRITE && !WRITING.contains(modeOf(project))) {
                throw new ToolError("Der KI-Zugang dieses Projekts steht auf 'Lesen'. Aendern geht erst, wenn der "
                        + "Nutzer im Fenster Vorschlag, Einzelschritte oder Auto waehlt.");
            }
            Map<String, Object> body = dispatch(s, project, tool, args);
            ctx = outContext(project, body);
            Object clean = tool.output().out(body.get("data"), ctx, "");
            if (!(clean instanceof Map<?, ?> cm)) throw new ToolError("Das Fenster lieferte kein brauchbares Ergebnis");
            Map<String, Object> out = Json.obj();
            out.put("project", handleOf(project));
            for (Map.Entry<?, ?> e : cm.entrySet()) out.put(String.valueOf(e.getKey()), e.getValue());
            if (ctx.truncated) out.put("truncated", true);
            if (Json.write(out).length() > MAX_RESULT_CHARS) {
                throw new ToolError("Das Ergebnis ist zu gross - bitte mit Filtern oder limit eingrenzen");
            }
            return out;
        } catch (ToolError e) {
            error = e.getMessage();
            throw e;
        } finally {
            record(s, tool.name(), project, rawArgs, t0, error, ctx);
        }
    }

    /** Freigabe eines Projekts, wie der Chat sie braucht. */
    public Mode mode(String project) {
        return modeOf(project);
    }

    /**
     * Text des Nutzers fuer die KI: dieselben Platzhalter wie in den Werkzeugergebnissen, damit
     * „Familie Müller“ im Chat genauso verborgen bleibt wie im Projekt. Zeilenumbrueche bleiben.
     */
    public String maskInput(String project, String text, Map<String, Object> body) {
        Shape.Out ctx = outContext(project, body);
        StringBuilder sb = new StringBuilder(text.length());
        for (String line : text.split("\n", -1)) {
            if (!sb.isEmpty()) sb.append('\n');
            sb.append(ctx.privacy.mask(Shape.clean(line, 8000), ctx.terms));
        }
        return sb.toString();
    }

    /** Antwort der KI fuer die Anzeige im Fenster: Platzhalter zurueck in Klartext, kenntlich gemacht. */
    public String unmask(String project, String text) {
        return privacyOf(project).restoreMarked(text);
    }

    private synchronized Mode modeOf(String project) {
        Release r = releases.get(project);
        return r == null ? Mode.OFF : r.mode;
    }

    private Map<String, Object> listProjects(Session s) {
        List<String> released = new ArrayList<>();
        synchronized (this) {
            for (Release r : releases.values()) if (r.mode != Mode.OFF) released.add(r.project);
        }
        List<Object> list = Json.arr();
        for (String project : released) {
            Map<String, Object> e = Json.obj();
            e.put("project", handleOf(project));
            synchronized (this) {
                Release r = releases.get(project);
                e.put("mode", r == null ? Mode.OFF.key : r.mode.key);
            }
            try {
                Map<String, Object> body = dispatch(s, project, SUMMARY, Json.obj());
                Object clean = SUMMARY.output().out(body.get("data"), outContext(project, body), "");
                if (clean instanceof Map<?, ?> cm) {
                    for (Map.Entry<?, ?> x : cm.entrySet()) e.put(String.valueOf(x.getKey()), x.getValue());
                }
            } catch (ToolError err) {
                // Ohne Zusammenfassung bleibt wenigstens die Kennung
            }
            list.add(e);
        }
        Map<String, Object> out = Json.obj();
        out.put("projects", list);
        if (list.isEmpty()) {
            out.put("hint", "No project is released. Ask the user to open the project in SB-Projekt and "
                    + "switch AI access to 'Lesen' (read) in the top bar.");
        }
        return out;
    }

    private String resolve(Object handle) throws ToolError {
        synchronized (this) {
            if (handle == null) {
                List<String> live = new ArrayList<>();
                for (Release r : releases.values()) if (r.mode != Mode.OFF) live.add(r.project);
                if (live.size() == 1) return live.get(0);
                throw new ToolError(live.isEmpty()
                        ? "Kein Projekt freigegeben. Der Nutzer muss den KI-Zugriff im Fenster des Projekts einschalten."
                        : "Mehrere Projekte freigegeben - bitte project angeben (siehe list_projects).");
            }
            String project = handle instanceof String h ? byHandle.get(h) : null;
            Release r = project == null ? null : releases.get(project);
            if (r == null || r.mode == Mode.OFF) {
                throw new ToolError("Projekt " + handle + " ist nicht freigegeben (siehe list_projects).");
            }
            return project;
        }
    }

    private Map<String, Object> dispatch(Session s, String project, Tools.Tool tool, Map<String, Object> args)
            throws ToolError {
        String window;
        synchronized (this) {
            Release r = releases.get(project);
            if (r == null || r.mode == Mode.OFF) throw new ToolError("Das Projekt ist nicht mehr freigegeben.");
            window = events.connected(r.window) ? r.window : null;
            if (window == null) {
                List<String> ws = events.windowsOf(project);
                if (ws.isEmpty()) throw new ToolError("Das Projekt ist gerade in keinem Fenster offen.");
                window = ws.get(0);
            }
            if (s.pending >= MAX_PENDING_PER_SESSION) throw new ToolError("Zu viele gleichzeitige Aufrufe.");
            s.pending++;
        }
        String call = HexFormat.of().formatHex(randomBytes(12));
        Pending p = new Pending(window, project, s.id, new CompletableFuture<>());
        pending.put(call, p);
        try {
            Map<String, Object> ev = Json.obj();
            ev.put("call", call);
            ev.put("tool", tool.name());
            ev.put("args", args);
            ev.put("session", s.label);
            ev.put("client", s.client);
            // Der Modus zum Zeitpunkt des Aufrufs - das Fenster richtet sich danach, nicht nach seinem Stand
            ev.put("mode", modeOf(project).key);
            if (!events.send(window, "mcp-call", ev)) throw new ToolError("Das Fenster ist nicht erreichbar.");
            publish(project);
            Map<String, Object> body;
            try {
                body = p.future.get(tool.timeoutSeconds(), TimeUnit.SECONDS);
            } catch (TimeoutException e) {
                throw new ToolError("Keine Antwort aus dem Fenster innerhalb von " + tool.timeoutSeconds() + " s.");
            } catch (ExecutionException e) {
                throw new ToolError(e.getCause() != null ? e.getCause().getMessage() : "Aufruf abgebrochen");
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new ToolError("Aufruf abgebrochen");
            }
            if (!Json.bool(body, "ok", false)) {
                String msg = body.get("error") instanceof String m ? m : "Das Werkzeug ist im Fenster gescheitert.";
                Shape.Out ctx = outContext(project, body);
                throw new ToolError(ctx.privacy.mask(Shape.clean(msg, 400), ctx.terms));
            }
            return body;
        } finally {
            pending.remove(call);
            synchronized (this) {
                s.pending--;
            }
            publish(project);
        }
    }

    /**
     * Sperrbegriffe einer Antwort: die Projektkennung und die Namen, die als Ganzes nie hinausgehen
     * ({@code names}: Projekt, Liegenschaft - auch Wort fuer Wort), dazu die Sperrliste des Nutzers
     * und was sonst im Fenster als schutzwuerdig bekannt ist ({@code terms}, genau so).
     */
    private Shape.Out outContext(String project, Map<String, Object> body) {
        List<String> terms = new ArrayList<>(Privacy.termsOf(project));
        if (body.get("names") instanceof List<?> l) {
            for (Object o : l) if (o instanceof String n && n.length() <= 400) terms.addAll(Privacy.termsOf(n));
        }
        if (body.get("terms") instanceof List<?> l) {
            for (Object o : l) if (o instanceof String t && terms.size() < Privacy.MAX_TERMS) terms.add(t);
        }
        return new Shape.Out(privacyOf(project), Privacy.compileTerms(terms));
    }

    private synchronized Privacy privacyOf(String project) {
        return privacy.computeIfAbsent(project, k -> new Privacy());
    }

    private synchronized String handleOf(String project) {
        String h = handles.get(project);
        if (h == null) {
            h = "p" + (handles.size() + 1);
            handles.put(project, h);
            byHandle.put(h, project);
        }
        return h;
    }

    private int pendingFor(String project) {
        int n = 0;
        for (Pending p : pending.values()) if (p.project.equals(project)) n++;
        return n;
    }

    private void failPending(java.util.function.Predicate<Pending> which, String message) {
        for (Pending p : pending.values()) {
            if (which.test(p)) p.future.completeExceptionally(new ToolError(message));
        }
    }

    private void record(Session s, String tool, String project, Map<String, Object> args, long t0,
                        String error, Shape.Out ctx) {
        synchronized (this) {
            s.calls++;
        }
        Map<String, Object> e = Json.obj();
        e.put("at", t0);
        e.put("session", s.label);
        e.put("client", s.client);
        e.put("tool", tool);
        e.put("projectId", project);
        e.put("project", project == null ? null : handleOf(project));
        e.put("ok", error == null);
        e.put("ms", System.currentTimeMillis() - t0);
        String a = Json.write(args);
        e.put("args", a.length() > 300 ? a.substring(0, 300) + "…" : a);
        if (error != null) e.put("error", error);
        if (ctx != null && ctx.dropped > 0) {
            e.put("dropped", ctx.dropped);
            e.put("droppedPaths", new ArrayList<>(ctx.droppedPaths));
        }
        audit.write(e);
        synchronized (this) {
            recent.addFirst(e);
            while (recent.size() > RECENT) recent.removeLast();
        }
        if (project != null) publish(project);
    }

    private static Map<String, Object> publicEntry(Map<String, Object> e) {
        Map<String, Object> m = new LinkedHashMap<>(e);
        m.remove("projectId");
        m.remove("client");
        return m;
    }

    private void publish(String project) {
        Map<String, Object> m = Json.obj();
        synchronized (this) {
            Release r = releases.get(project);
            m.put("project", project);
            m.put("mode", r == null ? Mode.OFF.key : r.mode.key);
            m.put("handle", handles.get(project));
            m.put("sessions", sessions.size());
        }
        m.put("busy", pendingFor(project));
        events.publish("mcp", m);
    }

    private void publishAll() {
        List<String> projects;
        synchronized (this) {
            projects = new ArrayList<>(releases.keySet());
        }
        Map<String, Object> m = Json.obj();
        synchronized (this) {
            m.put("sessions", sessions.size());
        }
        events.publish("mcp", m);
        projects.forEach(this::publish);
    }

    /** Aus einem synchronisierten Abschnitt heraus: nicht unter der Sperre an die Fenster schreiben. */
    private void publishAllLater() {
        timer.execute(this::publishAll);
    }

    private byte[] randomBytes(int n) {
        byte[] b = new byte[n];
        random.nextBytes(b);
        return b;
    }

    @Override
    public void close() {
        failPending(p -> true, "Der Dienst wird beendet.");
        timer.shutdownNow();
    }
}
