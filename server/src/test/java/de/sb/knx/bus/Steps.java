package de.sb.knx.bus;

import tuwien.auto.calimero.DataUnitBuilder;
import tuwien.auto.calimero.IndividualAddress;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicReference;

/** Schritte eines Downloadplans, wie knx-download.js sie erzeugt. */
final class Steps {

    private Steps() {}

    static Map<String, Object> step(Object... kv) {
        Map<String, Object> m = new HashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    /**
     * Fuehrt einen Plan aus wie die Oberflaeche. Haengt er, stehen alle Rahmen und die Stacks aller
     * Threads in der Meldung - aufgenommen kurz vor dem Abbruch, danach ist der Busthread schon fort.
     */
    static Map<String, Object> run(BusService bus, IndividualAddress device, List<Map<String, Object>> steps, FakeLink link)
            throws Exception {
        AtomicReference<String> stacks = new AtomicReference<>("");
        Thread watchdog = new Thread(() -> {
            try {
                Thread.sleep(25_000);
            } catch (InterruptedException e) {
                return;
            }
            StringBuilder b = new StringBuilder();
            Thread.getAllStackTraces().forEach((t, stack) -> {
                b.append("\n\n").append(t.getName()).append(' ').append(t.getState());
                for (StackTraceElement s : stack) b.append("\n    at ").append(s);
            });
            stacks.set(b.toString());
        }, "watchdog");
        watchdog.setDaemon(true);
        watchdog.start();
        try {
            return bus.call(() -> new Download(bus).run(device, steps, (i, n, label) -> {}), 30);
        } catch (TimeoutException e) {
            watchdog.join();
            throw new AssertionError("Download haengt\nBus:\n" + String.join("\n", link.trace) + stacks.get(), e);
        } finally {
            watchdog.interrupt();
        }
    }

    static String hex(byte[] b) {
        return DataUnitBuilder.toHex(b, "");
    }

    /** Ladeereignis an PID_LOAD_STATE_CONTROL eines Objekttyps: 10 Oktette, Ereignis vorn (03/05/02 3.31.3). */
    static Map<String, Object> lsm(int objectType, int event, int expect, String label) {
        byte[] b = new byte[10];
        b[0] = (byte) event;
        return step("op", "lsm", "mode", "prop", "ot", objectType, "occ", 0, "data", hex(b),
                "expect", List.of(expect), "label", label);
    }

    /** Data Relative Allocation: 03h 0Bh, Groesse (4 Oktette), Mode, Fill (03/05/02 3.31.3.4). */
    static Map<String, Object> allocate(int objectType, int size, boolean fill) {
        byte[] b = {0x03, 0x0B, (byte) (size >> 24), (byte) (size >> 16), (byte) (size >> 8), (byte) size,
                (byte) (fill ? 1 : 0), 0, 0, 0};
        return step("op", "lsm", "mode", "prop", "ot", objectType, "occ", 0, "data", hex(b),
                "expect", List.of(2), "label", size + " Byte zuteilen");
    }
}
