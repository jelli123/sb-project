package de.sb.knx.bus;

import de.sb.knx.json.Json;
import tuwien.auto.calimero.DeviceDescriptor;
import tuwien.auto.calimero.IndividualAddress;
import tuwien.auto.calimero.KNXException;
import tuwien.auto.calimero.ReturnCode;
import tuwien.auto.calimero.mgmt.Destination;
import tuwien.auto.calimero.mgmt.FuncPropResponse;
import tuwien.auto.calimero.mgmt.KNXDisconnectException;
import tuwien.auto.calimero.mgmt.PropertyAccess.PID;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

/**
 * Fuehrt einen Downloadplan aus, den die Oberflaeche aus der Produktdatei berechnet hat
 * (knx-download.js). Der Plan besteht aus einfachen Schritten - Speicher und Properties
 * schreiben, Load State Machines bedienen, neu starten. Wissen ueber Produkte steckt hier keines,
 * wohl aber die Regeln des Standards fuer das Warten auf Zustaende und das Pruefen.
 */
public final class Download {

    /** A_Memory_Write mit Standardrahmen: APDU 15 Oktett, davon 3 Kopf - 12 Datenoktette. */
    private static final int MEM_CHUNK = 12;

    /** Uebergaenge der Load State Machine duerfen bis zu 30 s dauern (03/05/01 4.23.2.1). */
    private static final long LSM_TIMEOUT_MS = 30_000;
    /** Nachlesen hoechstens alle 3 s, damit die Transportverbindung lebt (03/05/01 4.23.2.4.1). */
    private static final long LSM_POLL_MS = 1_000;

    private static final int PID_IO_LIST = 71;
    private static final int PID_ROUTETABLE_CONTROL = 56;

    public interface Progress {
        void step(int index, int total, String label);
    }

    private final BusService bus;

    private Destination dst;
    private IndividualAddress address;
    private List<Integer> objectTypes;
    private boolean filterCleared;
    private boolean memStateUnreadable;
    private boolean restarted;
    private long written;
    private final List<String> notes = new ArrayList<>();

    public Download(BusService bus) {
        this.bus = bus;
    }

    public Map<String, Object> run(IndividualAddress target, List<Map<String, Object>> steps, Progress progress)
            throws KNXException, InterruptedException {
        address = target;
        long started = System.currentTimeMillis();
        int i = 0;
        try {
            for (Map<String, Object> step : steps) {
                i++;
                String label = Json.str(step, "label", Json.str(step, "op", "?"));
                progress.step(i, steps.size(), label);
                try {
                    execute(step);
                } catch (KNXException e) {
                    throw new KNXException("Schritt " + i + " von " + steps.size() + " (" + label + "): "
                            + describe(e), e);
                } catch (IllegalStateException e) {
                    throw new IllegalStateException("Schritt " + i + " von " + steps.size() + " (" + label + "): "
                            + e.getMessage(), e);
                }
            }
        } finally {
            release();
        }
        Map<String, Object> m = Json.obj();
        m.put("ok", true);
        m.put("address", target.toString());
        m.put("steps", steps.size());
        m.put("bytes", written);
        m.put("restarted", restarted);
        m.put("seconds", (System.currentTimeMillis() - started) / 1000);
        m.put("notes", notes);
        return m;
    }

    public boolean restarted() {
        return restarted;
    }

    /* ---------------- Schritte ---------------- */

    private void execute(Map<String, Object> s) throws KNXException, InterruptedException {
        String op = Json.str(s, "op", "");
        switch (op) {
            case "checkMask" -> checkMask(s);
            case "authorize" -> authorize(s);
            case "compareProp" -> compareProp(s);
            case "lsm" -> lsm(s);
            case "writeMem" -> writeMem(s);
            case "writeProp" -> writeProp(s);
            case "clearFilterTable" -> clearFilterTable(s);
            case "clearObjectCache" -> objectTypes = null;
            case "delay" -> Thread.sleep(Math.max(0, Json.integer(s, "ms", 0)));
            case "restart" -> restart();
            default -> throw new IllegalStateException("Unbekannter Schritt: " + op);
        }
    }

    private void checkMask(Map<String, Object> s) throws KNXException, InterruptedException {
        byte[] raw = bus.client().readDeviceDesc(dst(), 0);
        int mask = DeviceDescriptor.DD0.from(raw).maskVersion();
        List<?> masks = list(s, "masks");
        for (int i = 0; i < masks.size(); i++) {
            if (!(masks.get(i) instanceof Number n) || n.intValue() != mask) continue;
            // Die erste Maske ist die der Applikation, die weiteren nennen sie als abwaertskompatibel.
            if (i > 0) notes.add(String.format("Geraet mit Maske %04X laedt eine Applikation fuer Maske %04X "
                    + "(laut Stammdaten kompatibel).", mask, ((Number) masks.get(0)).intValue()));
            return;
        }
        throw new IllegalStateException(String.format(
                "Das Geraet meldet Maske %04X, die Applikation ist fuer Maske %s geschrieben.",
                mask, maskList(s)));
    }

    /**
     * A_Authorize mit dem Standardschluessel. Geraete ohne Zugriffsschutz antworten mit
     * Stufe 0; wer den Dienst nicht kennt, bleibt stumm - dann geht es ohne weiter.
     */
    private void authorize(Map<String, Object> s) throws KNXException, InterruptedException {
        try {
            int level = bus.client().authorize(dst(), hex(Json.str(s, "key", "FFFFFFFF")));
            if (level > 2) notes.add("Zugriffsstufe " + level + " - geschuetzte Bereiche sind womoeglich gesperrt.");
        } catch (KNXDisconnectException e) {
            throw e;
        } catch (KNXException e) {
            notes.add("Anmeldung nicht beantwortet (" + describe(e) + ") - weiter ohne.");
            reconnectIfLost();
        }
    }

    private void compareProp(Map<String, Object> s) throws KNXException, InterruptedException {
        byte[] expected = hex(Json.str(s, "data", ""));
        int pid = Json.integer(s, "pid", 0);
        byte[] actual = bus.client().readProperty(dst(), objectIndex(s), pid,
                Json.integer(s, "start", 1), Json.integer(s, "count", 1));
        // Die Vorgabe kann laenger sein als der Wert; ueberzaehlige Oktette muessen 0 sein.
        boolean same = true;
        for (int i = 0; i < expected.length; i++) {
            int a = i < actual.length ? actual[i] & 0xFF : 0;
            if (a != (expected[i] & 0xFF)) same = false;
        }
        if (!same) {
            throw new IllegalStateException("Geraet passt nicht zur Applikation: Property " + pid
                    + " ist " + Knx.hex(actual) + ", erwartet " + Knx.hex(expected) + ".");
        }
    }

    /**
     * Ereignis an eine Load State Machine und Kontrolle des Folgezustands.
     * Speicherabgebildet (Masken 070xh): 11 Oktette an 0104h, Zustand ab B6EAh.
     * Property-basiert: 10 Oktette an PID_LOAD_STATE_CONTROL, Zustand ueber dieselbe Property.
     */
    private void lsm(Map<String, Object> s) throws KNXException, InterruptedException {
        byte[] data = hex(Json.str(s, "data", ""));
        List<Integer> expect = new ArrayList<>();
        for (Object o : list(s, "expect")) if (o instanceof Number n) expect.add(n.intValue());

        if ("mem".equals(Json.str(s, "mode", ""))) {
            int lsm = Json.integer(s, "lsm", 0);
            bus.client().writeMemory(dst(), Knx.M112_LOAD_CONTROL, data);
            waitForState(expect, () -> memState(lsm));
        } else {
            int index = objectIndex(s);
            bus.client().writeProperty(dst(), index, PID.LOAD_STATE_CONTROL, 1, 1, data);
            waitForState(expect, () -> {
                byte[] v = bus.client().readProperty(dst(), index, PID.LOAD_STATE_CONTROL, 1, 1);
                return v.length > 0 ? v[0] & 0xFF : -1;
            });
        }
    }

    private int memState(int lsm) throws KNXException, InterruptedException {
        if (memStateUnreadable) return -1;
        try {
            byte[] v = bus.client().readMemory(dst(), Knx.M112_LOAD_STATE_BASE + lsm, 1);
            return v.length > 0 ? v[0] & 0xFF : -1;
        } catch (KNXDisconnectException e) {
            throw e;
        } catch (KNXException e) {
            // Nicht jede Implementierung blendet den Zustand in den Speicher ein.
            memStateUnreadable = true;
            notes.add("Ladezustand im Speicher nicht lesbar (" + describe(e) + ") - Zustaende ungeprueft.");
            reconnectIfLost();
            return -1;
        }
    }

    interface StateReader {
        int read() throws KNXException, InterruptedException;
    }

    private void waitForState(List<Integer> expect, StateReader reader) throws KNXException, InterruptedException {
        if (expect.isEmpty()) return;
        long until = System.currentTimeMillis() + LSM_TIMEOUT_MS;
        int state;
        while (true) {
            state = reader.read();
            if (state < 0 || expect.contains(state)) return;
            if (state == 3) throw new IllegalStateException("Das Geraet meldet den Ladezustand Error.");
            // Unloading und LoadCompleting sind Zwischenzustaende; alles andere darf kurz nachlaufen.
            if (System.currentTimeMillis() > until) break;
            Thread.sleep(LSM_POLL_MS);
        }
        throw new IllegalStateException("Ladezustand " + Knx.loadState(state) + " statt "
                + expect.stream().map(Knx::loadState).toList() + ".");
    }

    private void writeMem(Map<String, Object> s) throws KNXException, InterruptedException {
        int addr = Json.integer(s, "addr", -1);
        byte[] data = hex(Json.str(s, "data", ""));
        boolean verify = Json.bool(s, "verify", false);
        if (addr < 0 || addr + data.length > 0x10000) throw new IllegalStateException("Speicheradresse ausserhalb 0000h-FFFFh");

        if (Json.bool(s, "skipZeros", false) && filterCleared) {
            // Nach dem Loeschen genuegen die belegten Bereiche; kurze Luecken werden mitgeschrieben.
            int i = 0;
            while (i < data.length) {
                if (data[i] == 0) { i++; continue; }
                int end = i;
                int zeros = 0;
                for (int j = i; j < data.length && zeros < 4; j++) {
                    if (data[j] == 0) zeros++;
                    else { zeros = 0; end = j + 1; }
                }
                writeRange(addr + i, Arrays.copyOfRange(data, i, end), verify);
                i = end;
            }
            return;
        }
        writeRange(addr, data, verify);
    }

    private void writeRange(int addr, byte[] data, boolean verify) throws KNXException, InterruptedException {
        for (int off = 0; off < data.length; off += MEM_CHUNK) {
            byte[] chunk = Arrays.copyOfRange(data, off, Math.min(data.length, off + MEM_CHUNK));
            bus.client().writeMemory(dst(), addr + off, chunk);
            if (verify) {
                byte[] back = bus.client().readMemory(dst(), addr + off, chunk.length);
                if (!Arrays.equals(back, chunk)) {
                    throw new IllegalStateException(String.format(
                            "Pruefung bei %04Xh fehlgeschlagen: geschrieben %s, gelesen %s",
                            addr + off, Knx.hex(chunk), Knx.hex(back)));
                }
            }
            written += chunk.length;
            if (Thread.interrupted()) throw new InterruptedException();
        }
    }

    private void writeProp(Map<String, Object> s) throws KNXException, InterruptedException {
        byte[] data = hex(Json.str(s, "data", ""));
        int index = objectIndex(s);
        int pid = Json.integer(s, "pid", 0);
        int start = Json.integer(s, "start", 1);
        int count = Json.integer(s, "count", 1);
        bus.client().writeProperty(dst(), index, pid, start, count, data);
        written += data.length;
        if (Json.bool(s, "verify", false)) {
            byte[] back = bus.client().readProperty(dst(), index, pid, start, count);
            if (!Arrays.equals(back, data)) {
                throw new IllegalStateException("Property " + pid + " liest " + Knx.hex(back)
                        + " statt " + Knx.hex(data) + ".");
            }
        }
    }

    /**
     * Filtertabelle ueber PID_ROUTETABLE_CONTROL, Dienst SRVID_CLEAR_FILTERTABLE (03/05/01 4.5.7.2).
     * Kennt das Geraet die Funktion nicht, wird die Tabelle danach vollstaendig geschrieben.
     */
    private void clearFilterTable(Map<String, Object> s) throws KNXException, InterruptedException {
        filterCleared = false;
        try {
            FuncPropResponse r = bus.client().callFunctionProperty(dst(), objectIndex(s), PID_ROUTETABLE_CONTROL,
                    (byte) 0x00, (byte) 0x01);
            filterCleared = r.returnCode() == ReturnCode.Success;
            if (!filterCleared) notes.add("Filtertabelle loeschen meldet " + r.returnCode() + " - sie wird vollstaendig geschrieben.");
        } catch (KNXDisconnectException e) {
            throw e;
        } catch (KNXException e) {
            notes.add("Filtertabelle loeschen nicht unterstuetzt (" + describe(e) + ") - sie wird vollstaendig geschrieben.");
            reconnectIfLost();
        }
    }

    /** Neustart ueber die Verbindung; danach ist sie abgebaut und wird bei Bedarf neu geoeffnet. */
    private void restart() throws KNXException, InterruptedException {
        bus.client().restart(dst());
        restarted = true;
        release();
        objectTypes = null;
    }

    /* ---------------- Verbindung und Objekte ---------------- */

    private Destination dst() throws KNXException, InterruptedException {
        if (dst == null || dst.getState() == Destination.State.Destroyed) {
            if (restarted) Thread.sleep(2_000);                 // Geraet nach dem Neustart hochfahren lassen
            dst = bus.client().createDestination(address, true, true, false);
        }
        return dst;
    }

    private void reconnectIfLost() {
        if (dst != null && dst.getState() == Destination.State.Disconnected) release();
    }

    private void release() {
        if (dst != null) {
            try {
                dst.destroy();
            } catch (RuntimeException ignored) {
                // war bereits abgebaut
            }
            dst = null;
        }
    }

    /** Objektindex direkt oder ueber Objekttyp und Vorkommen aus der Objektliste des Geraets. */
    private int objectIndex(Map<String, Object> s) throws KNXException, InterruptedException {
        if (s.get("oi") instanceof Number n) return n.intValue();
        int type = Json.integer(s, "ot", -1);
        int occurrence = Json.integer(s, "occ", 0);
        if (objectTypes == null) objectTypes = readObjectTypes();
        int seen = 0;
        for (int i = 0; i < objectTypes.size(); i++) {
            if (objectTypes.get(i) == type && seen++ == occurrence) return i;
        }
        throw new IllegalStateException("Das Geraet hat kein Interface-Objekt vom Typ " + type
                + " (" + Knx.objectType(type) + ").");
    }

    private List<Integer> readObjectTypes() throws KNXException, InterruptedException {
        List<Integer> types = new ArrayList<>();
        try {
            byte[] count = bus.client().readProperty(dst(), 0, PID_IO_LIST, 0, 1);
            int n = Knx.unsigned(count);
            if (n > 0 && n <= 64) {
                byte[] list = bus.client().readProperty(dst(), 0, PID_IO_LIST, 1, n);
                if (list.length >= n * 2) {
                    for (int i = 0; i < n; i++) types.add(((list[i * 2] & 0xFF) << 8) | (list[i * 2 + 1] & 0xFF));
                    return types;
                }
            }
        } catch (KNXDisconnectException e) {
            throw e;
        } catch (KNXException e) {
            reconnectIfLost();
            // PID_IO_LIST ist optional - dann die Objekte einzeln abfragen.
        }
        for (int index = 0; index < 32; index++) {
            try {
                types.add(Knx.unsigned(bus.client().readProperty(dst(), index, PID.OBJECT_TYPE, 1, 1)));
            } catch (KNXDisconnectException e) {
                throw e;
            } catch (KNXException e) {
                reconnectIfLost();
                break;
            }
        }
        return types;
    }

    /* ---------------- Hilfen ---------------- */

    private static List<?> list(Map<String, Object> s, String key) {
        return s.get(key) instanceof List<?> l ? l : List.of();
    }

    private static String maskList(Map<String, Object> s) {
        List<String> out = new ArrayList<>();
        for (Object o : list(s, "masks")) if (o instanceof Number n) out.add(String.format("%04X", n.intValue()));
        return String.join(", ", out);
    }

    static byte[] hex(String text) {
        String h = text.replaceAll("[^0-9A-Fa-f]", "");
        if (h.length() % 2 != 0) throw new IllegalStateException("Hexdaten mit ungerader Laenge");
        byte[] b = new byte[h.length() / 2];
        for (int i = 0; i < b.length; i++) b[i] = (byte) Integer.parseInt(h.substring(i * 2, i * 2 + 2), 16);
        return b;
    }

    private static String describe(Throwable e) {
        String msg = e.getMessage();
        return msg == null || msg.isBlank() ? e.getClass().getSimpleName() : msg;
    }

    public static void validate(List<Map<String, Object>> steps) {
        if (steps.isEmpty()) throw new IllegalArgumentException("Der Plan enthaelt keine Schritte");
        for (Map<String, Object> s : steps) {
            if (Json.str(s, "op", null) == null) throw new IllegalArgumentException("Schritt ohne op");
            Object data = s.get("data");
            if (data != null && !(data instanceof String)) throw new IllegalArgumentException("data muss Hex-Text sein");
        }
    }

}
