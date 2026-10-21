package de.sb.knx.http;

import de.sb.knx.json.Json;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Registry fuer laufende Busvorgaenge. Ein Busscan dauert Minuten - die Oberflaeche
 * bekommt sofort eine Auftragsnummer und verfolgt den Rest ueber die Ereignisleitung.
 */
public final class Jobs {

    private static final int KEEP = 50;

    private final Events events;
    private final AtomicLong seq = new AtomicLong();
    private final Map<String, Job> jobs = new LinkedHashMap<>() {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, Job> eldest) {
            return size() > KEEP && eldest.getValue().future.isDone();
        }
    };

    public Jobs(Events events) {
        this.events = events;
    }

    public String submit(String kind, ExecutorService executor, Callable<Object> body) {
        String id = kind + "-" + seq.incrementAndGet();
        Job job = new Job(kind);
        synchronized (jobs) {
            jobs.put(id, job);
        }
        publish(id, job, "gestartet");
        job.future = executor.submit(() -> {
            try {
                job.result = body.call();
                job.state = "fertig";
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                job.state = "abgebrochen";
            } catch (Exception e) {
                job.state = "fehler";
                job.error = describe(e);
                events.log("error", kind + ": " + job.error);
            } finally {
                job.finished = System.currentTimeMillis();
                publish(id, job, job.state);
            }
        });
        return id;
    }

    public void progress(String id, String message, Object detail) {
        Job job = get(id);
        if (job == null) return;
        job.message = message;
        Map<String, Object> m = Json.obj();
        m.put("id", id);
        m.put("kind", job.kind);
        m.put("state", job.state);
        m.put("message", message);
        m.put("detail", detail);
        events.publish("job", m);
    }

    public Map<String, Object> status(String id) {
        Job job = get(id);
        if (job == null) return null;
        Map<String, Object> m = Json.obj();
        m.put("id", id);
        m.put("kind", job.kind);
        m.put("state", job.state);
        m.put("message", job.message);
        m.put("started", job.started);
        m.put("finished", job.finished);
        m.put("error", job.error);
        m.put("result", job.result);
        return m;
    }

    /** Laeuft gerade ein Auftrag dieser Arten oder wartet einer? */
    public boolean active(Set<String> kinds) {
        synchronized (jobs) {
            for (Job j : jobs.values()) {
                if (kinds.contains(j.kind) && (j.future == null || !j.future.isDone())) return true;
            }
        }
        return false;
    }

    public boolean cancel(String id) {
        Job job = get(id);
        if (job == null || job.future == null) return false;
        return job.future.cancel(true);
    }

    private Job get(String id) {
        synchronized (jobs) {
            return jobs.get(id);
        }
    }

    private void publish(String id, Job job, String state) {
        job.state = state;
        Map<String, Object> m = Json.obj();
        m.put("id", id);
        m.put("kind", job.kind);
        m.put("state", state);
        m.put("error", job.error);
        events.publish("job", m);
    }

    public static String describe(Throwable e) {
        String msg = e.getMessage();
        return msg == null || msg.isBlank() ? e.getClass().getSimpleName() : msg;
    }

    private static final class Job {
        final String kind;
        final long started = System.currentTimeMillis();
        volatile Future<?> future;
        volatile String state = "wartet";
        volatile String message = "";
        volatile String error;
        volatile Object result;
        volatile long finished;

        Job(String kind) {
            this.kind = kind;
        }
    }
}
