package de.sb.knx.bus;

import de.sb.knx.json.Json;
import tuwien.auto.calimero.DeviceDescriptor;
import tuwien.auto.calimero.IndividualAddress;
import tuwien.auto.calimero.KNXException;
import tuwien.auto.calimero.KNXRemoteException;
import tuwien.auto.calimero.ReturnCode;
import tuwien.auto.calimero.mgmt.Destination;
import tuwien.auto.calimero.mgmt.FuncPropResponse;
import tuwien.auto.calimero.mgmt.KNXDisconnectException;
import tuwien.auto.calimero.mgmt.PropertyAccess.PID;
import tuwien.auto.calimero.secure.KnxSecureException;

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
    /** A_MemoryExtended_Write oberhalb 64 KiB: 3 Oktette Adresse und 1 Oktett Anzahl - 10 Datenoktette. */
    private static final int EXT_MEM_CHUNK = 10;
    private static final int PID_TABLE_REFERENCE = 7;
    private static final int PID_MCB_TABLE = 27;
    /**
     * A_PropertyValue_Write mit Standardrahmen: 15 Oktette nach dem TPCI, davon 5 Kopf
     * (APCI, Objekt, PID, Anzahl und Start) - 10 Datenoktette. Laengere Bloecke braeuchten
     * einen Extended Frame, und den reicht nicht jede Schnittstelle auf den TP weiter.
     */
    private static final int PROP_CHUNK = 10;

    /** Uebergaenge der Load State Machine duerfen bis zu 30 s dauern (03/05/01 4.23.2.1). */
    private static final long LSM_TIMEOUT_MS = 30_000;
    /** Nachlesen hoechstens alle 3 s, damit die Transportverbindung lebt (03/05/01 4.23.2.4.1). */
    private static final long LSM_POLL_MS = 1_000;

    /** Anzahl der Elemente je A_PropertyValue_Write: 4 Bit (03/03/07). */
    private static final int MAX_ELEMENTS = 15;

    private static final int PID_IO_LIST = 71;
    private static final int PID_ROUTETABLE_CONTROL = 56;

    /** Security Interface Object (03/05/01 6.3): Objekttyp 17 und seine Properties. */
    static final int OT_SECURITY = 17;
    static final int PID_SECURITY_MODE = 51;
    static final int PID_GRP_KEY_TABLE = 53;
    static final int PID_TOOL_KEY = 56;
    /** Security Proxy Group Key Table im ersten Router-Objekt (AN192 2.3.1.5). */
    static final int PID_SECURITY_PROXY_GRP_KEY_TABLE = 81;
    private static final Map<String, Object> SECURITY_OBJECT = Map.<String, Object>of("ot", OT_SECURITY, "occ", 0);

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
    private SecureLayer.KeyKind secureKind;
    private long written;
    private final List<String> notes = new ArrayList<>();
    /** Aus dem Geraet gelesene Werte (LdCtrlLoadImageProp), gegen die spaeter verglichen wird. */
    private final Map<String, byte[]> images = new java.util.HashMap<>();

    public Download(BusService bus) {
        this.bus = bus;
    }

    public Map<String, Object> run(IndividualAddress target, List<Map<String, Object>> steps, Progress progress)
            throws KNXException, InterruptedException {
        return run(target, steps, null, progress);
    }

    /**
     * @param gates Freigaben an Security Proxys auf dem Weg zum Geraet (siehe ProxyGates) oder null
     */
    public Map<String, Object> run(IndividualAddress target, List<Map<String, Object>> steps, Object gates,
                                   Progress progress) throws KNXException, InterruptedException {
        address = target;
        long started = System.currentTimeMillis();
        int i = 0;
        ProxyGates proxies = new ProxyGates(bus, ProxyGates.parse(gates), notes);
        try {
            proxies.open();
            for (Map<String, Object> step : steps) {
                i++;
                String label = Json.str(step, "label", Json.str(step, "op", "?"));
                progress.step(i, steps.size(), label);
                proxies.keepAlive();
                try {
                    execute(step);
                } catch (KNXException | IllegalStateException | KnxSecureException e) {
                    // LdCtrlMapError: die Ladeprozedur erklaert diesen Fehler fuer unerheblich
                    if (Json.bool(step, "tolerate", false) && !(e instanceof KNXDisconnectException)) {
                        notes.add("Schritt " + i + " (" + label + ") uebergangen: " + describe(e));
                        reconnectIfLost();
                        continue;
                    }
                    if (e instanceof KNXException ke)
                        throw new KNXException("Schritt " + i + " von " + steps.size() + " (" + label + "): "
                                + describe(ke), ke);
                    throw new IllegalStateException("Schritt " + i + " von " + steps.size() + " (" + label + "): "
                            + e.getMessage(), e);
                }
            }
        } finally {
            release();
            proxies.close();
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
            case "secureSync" -> secureSync(s);
            case "secureToolKey" -> secureToolKey(s);
            case "secureMode" -> secureMode(s);
            case "secureGroupKeys" -> secureGroupKeys(s);
            case "proxyGroupKeys" -> proxyGroupKeys(s);
            case "writeRelMem" -> writeRelMem(s);
            case "loadImageProp" -> loadImageProp(s);
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
        // Vorher ins Abbild gelesen: dann ist die Vorgabe nur Platzhalter, verglichen wird mit dem Abbild
        byte[] image = Json.bool(s, "image", false) ? images.get(imageKey(s)) : null;
        if (image != null) expected = image;
        byte[] actual = bus.client().readProperty(dst(), objectIndex(s), pid,
                Json.integer(s, "start", 1), Json.integer(s, "count", 1));
        if (image != null && pid == PID_TABLE_REFERENCE && !Arrays.equals(image, actual)) {
            throw new IllegalStateException("Das Geraet hat den Speicher neu zugeteilt (Lage " + Knx.hex(image) + " -> "
                    + Knx.hex(actual) + ") - ein Teil-Download geht so nicht, bitte vollstaendig laden.");
        }
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
            // Die Antwort traegt bereits den neuen Zustand; nachgelesen wird nur bei Zwischenzustaenden.
            byte[] res = bus.client().writeControlProperty(dst(), index, PID.LOAD_STATE_CONTROL, 1, 1, data);
            int[] first = {res.length > 0 ? res[0] & 0xFF : -1};
            waitForState(expect, () -> {
                if (first[0] >= 0) {
                    int v = first[0];
                    first[0] = -1;
                    return v;
                }
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
        for (int off = 0, n; off < data.length; off += n) {
            // Ueber 64 KiB nimmt Calimero A_MemoryExtended_Write; ein Block teilt sich an der Grenze
            int at = addr + off;
            n = at > 0xFFFF ? EXT_MEM_CHUNK : Math.min(MEM_CHUNK, 0x10000 - at);
            n = Math.min(n, data.length - off);
            byte[] chunk = Arrays.copyOfRange(data, off, off + n);
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
        String maskText = Json.str(s, "mask", null);
        if (maskText != null) {
            // Nur die Bits der Parameter gehoeren dem Download, der Rest bleibt wie im Geraet.
            byte[] mask = hex(maskText);
            byte[] current = bus.client().readProperty(dst(), index, pid, start, count);
            if (current.length == data.length) {
                for (int i = 0; i < data.length; i++) {
                    data[i] = (byte) ((current[i] & ~mask[i]) | (data[i] & mask[i]));
                }
            } else {
                notes.add("Property " + pid + " liefert " + current.length + " statt " + data.length
                        + " Oktette - wird ohne Abgleich geschrieben.");
            }
        }
        // Die Elementanzahl im A_PropertyValue_Write hat 4 Bit, und ein Standardrahmen traegt
        // nur PROP_CHUNK Datenoktette - laengere Felder wie der Geraetename (30 Elemente)
        // gehen deshalb in Bloecken. Ein einzelnes Element ueber PROP_CHUNK bleibt ungeteilt.
        int size = count > 0 && data.length % count == 0 ? data.length / count : 0;
        int step = size > 0 ? Math.min(count, Math.max(1, Math.min(MAX_ELEMENTS, PROP_CHUNK / size))) : count;
        boolean verify = Json.bool(s, "verify", false);
        boolean loose = Json.bool(s, "loose", false);
        for (int done = 0; done < count; done += step) {
            int n = Math.min(step, count - done);
            byte[] part = step == count ? data : Arrays.copyOfRange(data, done * size, (done + n) * size);
            try {
                if (loose) bus.client().writePropertyUnchecked(dst(), index, pid, start + done, n, part);
                else bus.client().writeProperty(dst(), index, pid, start + done, n, part);
            } catch (KNXRemoteException e) {
                throw new IllegalStateException("Das Geraet lehnt das Schreiben von Property " + pid + " (Objekt "
                        + index + ", Wert " + Knx.hex(part) + ") ab. Ist sie in der Firmware beschreibbar?", e);
            }
            written += part.length;
            if (verify) {
                byte[] back = bus.client().readProperty(dst(), index, pid, start + done, n);
                if (!Arrays.equals(back, part)) {
                    throw new IllegalStateException("Property " + pid + " liest " + Knx.hex(back)
                            + " statt " + Knx.hex(part) + ".");
                }
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
        // Vor dem Senden merken: Startet die verbundene Schnittstelle selbst neu, reisst der Tunnel
        // noch waehrend dieses Aufrufs ab und der Auftrag wird unterbrochen.
        restarted = true;
        bus.client().restart(dst());
        release();
        objectTypes = null;
    }

    /* ---------------- System B: relativer Speicher ---------------- */

    /**
     * Schreibt in den Block, den das Geraet einem Objekt bei der relativen Zuteilung gegeben hat
     * (LdCtrlWriteRelMem). Wo er liegt, sagt PID_TABLE_REFERENCE (03/05/01 4.2.7): ein 4-Oktett-Zeiger,
     * nach dem Entladen 0. Ist er 0, ist die Zuteilung gescheitert - geschrieben wird dann nichts.
     */
    private void writeRelMem(Map<String, Object> s) throws KNXException, InterruptedException {
        int oi = Json.integer(s, "oi", -1);
        if (oi < 0 || oi > 255) throw new IllegalStateException("Objektindex fehlt");
        int offset = Json.integer(s, "offset", 0);
        byte[] data = hex(Json.str(s, "data", ""));
        if (offset < 0 || data.length == 0) throw new IllegalStateException("Nichts zu schreiben");
        long base = Knx.unsigned(bus.client().readProperty(dst(), oi, PID_TABLE_REFERENCE, 1, 1)) & 0xFFFFFFFFL;
        if (base == 0) {
            throw new IllegalStateException("Objekt " + oi + " hat keinen Speicher zugeteilt (PID_TABLE_REFERENCE = 0).");
        }
        long end = base + offset + data.length;
        // Der Zeiger reicht laut Standard ueber 20 Bit; Calimero adressiert bis 24 Bit
        if (end > 0x1000000L) throw new IllegalStateException(String.format("Speicherlage %Xh ausserhalb des Adressraums", base));
        writeRange((int) (base + offset), data, Json.bool(s, "verify", false));
    }

    /**
     * Liest eine Property ins Abbild (LdCtrlLoadImageProp): PID_TABLE_REFERENCE vor einem Teil-Download,
     * damit danach feststeht, ob der Block an derselben Stelle blieb; PID_MCB_TABLE am Ende mit
     * Segmentgroesse und CRC16-CCITT, die der Plan gegen das Geschriebene haelt (03/05/01 4.2.27).
     * Eine abweichende Pruefsumme ist ein Hinweis, kein Abbruch: ob ein Geraet sie ueber genau diesen
     * Block bildet, sagt der Standard nicht fuer jede Realisierung.
     */
    private void loadImageProp(Map<String, Object> s) throws KNXException, InterruptedException {
        int index = objectIndex(s);
        int pid = Json.integer(s, "pid", 0);
        byte[] v;
        try {
            v = bus.client().readProperty(dst(), index, pid, Json.integer(s, "start", 1), Json.integer(s, "count", 1));
        } catch (KNXRemoteException e) {
            notes.add("Property " + pid + " von Objekt " + index + " nicht lesbar (" + describe(e) + ").");
            return;
        }
        images.put(imageKey(s), v);
        if (pid == PID_MCB_TABLE && s.get("expectCrc") instanceof Number crc && v.length >= 8) {
            long size = Knx.unsigned(Arrays.copyOfRange(v, 0, 4)) & 0xFFFFFFFFL;
            int got = Knx.unsigned(Arrays.copyOfRange(v, 6, 8));
            long expectSize = Json.integer(s, "expectSize", -1);
            if (size != expectSize) {
                notes.add(String.format("Objekt %d meldet %d Byte Segmentgroesse, zugeteilt waren %d.", index, size, expectSize));
            } else if (got != crc.intValue()) {
                notes.add(String.format("Pruefsumme von Objekt %d: Geraet %04X, erwartet %04X - der Inhalt weicht ab.",
                        index, got, crc.intValue()));
            }
        }
    }

    /** Schluessel eines Abbilds wie im Plan: Index und PID, sonst Typ, Vorkommen und PID. */
    private static String imageKey(Map<String, Object> s) {
        if (s.get("oi") instanceof Number oi) return "i:" + oi.intValue() + ":" + Json.integer(s, "pid", 0);
        return "t:" + Json.integer(s, "ot", -1) + ":" + Json.integer(s, "occ", 0) + ":" + Json.integer(s, "pid", 0);
    }

    /* ---------------- KNX Secure ---------------- */

    /**
     * Stellt den gesicherten Werkzeugzugang her: synchronisiert mit dem Geraet und stellt dabei fest,
     * ob es schon mit dem Tool Key arbeitet oder noch mit dem FDSK (03/05/02 4.2). Ohne gebundene
     * Schluessel bricht der Plan hier ab - unverschluesselt kaeme an ein Geraet im Security Mode
     * ohnehin nichts an (AN193 2.2.4.5).
     */
    private void secureSync(Map<String, Object> s) throws KNXException, InterruptedException {
        SecureLayer.Entry e = secureEntry(s);
        dst();
        secureKind = bus.secure().resync(address);
        if (secureKind == SecureLayer.KeyKind.FDSK && e.toolKey != null) {
            notes.add(address + " arbeitet wieder mit dem FDSK - es war offenbar im Werkszustand. Ein neuer Tool Key wird gesetzt.");
        }
    }

    /**
     * Setzt den Tool Key, solange das Geraet noch mit dem FDSK arbeitet (03/05/01 6.1.5 und 6.3.10.5:
     * nach der Adressvergabe und vor jedem weiteren Zugriff). Der Schluessel ist zufaellig und neu und
     * steht in der Ablage, bevor er das Geraet erreicht. Die Antwort des Geraets ist bereits mit dem
     * neuen Schluessel gesichert (6.3.10.4) - kommt sie an, ist er gesetzt.
     */
    private void secureToolKey(Map<String, Object> s) throws KNXException, InterruptedException {
        SecureLayer.Entry e = secureEntry(s);
        if (secureKind == null) secureKind = bus.secure().resync(address);
        if (secureKind != SecureLayer.KeyKind.FDSK) return;          // Tool Key ist schon gesetzt

        String project = bus.keyProject();
        byte[] key;
        try {
            key = bus.keyVault().newPendingToolKey(project, e.serial);
        } catch (java.io.IOException | java.security.GeneralSecurityException x) {
            throw new IllegalStateException("Tool Key nicht in der Ablage gesichert - es wird nichts geschrieben: " + x.getMessage(), x);
        }
        int index = objectIndex(SECURITY_OBJECT);
        SecureLayer sl = bus.secure();
        sl.armToolKey(address, key);
        try {
            bus.client().writeToolKey(dst(), index, PID_TOOL_KEY, key);
            // Gegenprobe: diese Anfrage geht schon mit dem neuen Schluessel hinaus. Antwortet das Geraet,
            // arbeitet es damit - auch wenn es die Antwort auf das Schreiben selbst unverschluesselt gab.
            bus.client().readProperty(dst(), index, PID.OBJECT_TYPE, 1, 1);
        } catch (KNXException | KnxSecureException x) {
            sl.disarm(address);
            // Ausgang offen: die Anfrage kann angekommen und nur die Antwort verloren sein.
            // Die Synchronisation mit allen bekannten Schluesseln klaert, welcher jetzt gilt.
            sl.bindOne(address, new SecureLayer.Entry(e.serial, e.toolKey, key, e.fdsk));
            reconnectIfLost();
            SecureLayer.KeyKind now = sl.resync(address);
            if (now != SecureLayer.KeyKind.PENDING) {
                throw new IllegalStateException("Tool Key nicht gesetzt (" + describe(x) + "). Das Geraet arbeitet weiter mit dem "
                        + (now == SecureLayer.KeyKind.FDSK ? "FDSK" : "bisherigen Tool Key") + ".", x);
            }
        }
        try {
            bus.keyVault().confirmToolKey(project, e.serial, key);
        } catch (java.io.IOException | java.security.GeneralSecurityException x) {
            throw new IllegalStateException("Der Tool Key ist im Geraet gesetzt, aber nicht als bestaetigt gespeichert. "
                    + "Er bleibt vorgemerkt und wird beim naechsten Zugriff erkannt: " + x.getMessage(), x);
        }
        sl.bindOne(address, confirmed(e, key));
        secureKind = SecureLayer.KeyKind.TOOL;
        notes.add("Tool Key fuer " + address + " gesetzt; der FDSK ist damit inaktiv (03/05/01 6.1.4).");
    }

    private static SecureLayer.Entry confirmed(SecureLayer.Entry e, byte[] key) {
        SecureLayer.Entry n = new SecureLayer.Entry(e.serial, key, null, e.fdsk);
        n.key = key;
        n.using = SecureLayer.KeyKind.TOOL;
        n.synced = true;
        return n;
    }

    /** Security Mode ueber die Function Property PID_SECURITY_MODE: 00h reserviert, 00h Write, 00h/01h (03/05/01 6.3.5.1). */
    private void secureMode(Map<String, Object> s) throws KNXException, InterruptedException {
        boolean on = Json.bool(s, "on", true);
        int index = objectIndex(SECURITY_OBJECT);
        FuncPropResponse r = bus.client().callFunctionProperty(dst(), index, PID_SECURITY_MODE,
                (byte) 0x00, (byte) 0x00, (byte) (on ? 1 : 0));
        if (r.returnCode() != ReturnCode.Success) {
            throw new IllegalStateException("Security Mode " + (on ? "ein" : "aus") + ": das Geraet meldet " + r.returnCode() + ".");
        }
    }

    /**
     * Gruppenschluesseltabelle (03/05/01 6.3.7): je Eintrag 2 Oktette GA_Index (die TSAP in der
     * Adresstabelle) und 16 Oktette Schluessel, aufsteigend nach GA_Index. Erst wird die Laenge auf 0
     * gesetzt, dann folgt ein Eintrag je Telegramm - wie in der Pruefvorschrift (AN209). Die Schluessel
     * kommen aus der Ablage, die Oberflaeche nennt nur die Gruppen.
     */
    private void secureGroupKeys(Map<String, Object> s) throws KNXException, InterruptedException {
        int index = objectIndex(SECURITY_OBJECT);
        String project = bus.keyProject();
        List<Integer> tsaps = new ArrayList<>();
        List<String> groups = new ArrayList<>();
        for (Object o : list(s, "entries")) {
            if (!(o instanceof Map<?, ?> m) || !(m.get("tsap") instanceof Number t) || !(m.get("ga") instanceof String ga))
                throw new IllegalStateException("Eintrag der Gruppenschluesseltabelle unbrauchbar");
            int tsap = t.intValue();
            int last = tsaps.isEmpty() ? 0 : tsaps.get(tsaps.size() - 1);
            if (tsap <= last || tsap > 0xFFFF) throw new IllegalStateException("GA_Index muss aufsteigen: " + tsap);
            tsaps.add(tsap);
            groups.add(ga);
        }
        bus.client().writePropertyUnchecked(dst(), index, PID_GRP_KEY_TABLE, 0, 1, new byte[] {0, 0});
        for (int i = 0; i < tsaps.size(); i++) {
            byte[] key;
            try {
                key = bus.keyVault().groupKey(project, groups.get(i));
            } catch (java.io.IOException | java.security.GeneralSecurityException x) {
                throw new IllegalStateException("Gruppenschluessel nicht in der Ablage gesichert: " + x.getMessage(), x);
            }
            byte[] entry = new byte[18];
            entry[0] = (byte) (tsaps.get(i) >> 8);
            entry[1] = (byte) (int) tsaps.get(i);
            System.arraycopy(key, 0, entry, 2, 16);
            Arrays.fill(key, (byte) 0);
            try {
                bus.client().writePropertyUnchecked(dst(), index, PID_GRP_KEY_TABLE, i + 1, 1, entry);
            } finally {
                Arrays.fill(entry, (byte) 0);
            }
            if (Thread.interrupted()) throw new InterruptedException();
        }
    }

    /**
     * Security Proxy Group Key Table (AN192 2.3.1.5): je Eintrag 2 Oktette Gruppenadresse,
     * 16 Oktette ihr Gruppenschluessel und 1 Oktett Security Settings (Sec@Prim, Sec@Sec, conf,
     * auth), aufsteigend nach Gruppenadresse. Wie bei der Gruppenschluesseltabelle erst die Laenge 0,
     * dann ein Eintrag je Telegramm; die Schluessel kommen aus der Ablage.
     */
    private void proxyGroupKeys(Map<String, Object> s) throws KNXException, InterruptedException {
        int index = objectIndex(s);
        String project = bus.keyProject();
        List<Integer> raws = new ArrayList<>();
        List<Integer> settings = new ArrayList<>();
        List<String> groups = new ArrayList<>();
        for (Object o : list(s, "entries")) {
            if (!(o instanceof Map<?, ?> m) || !(m.get("raw") instanceof Number r) || !(m.get("ga") instanceof String ga)
                    || !(m.get("settings") instanceof Number st))
                throw new IllegalStateException("Eintrag der Proxy-Gruppenschluesseltabelle unbrauchbar");
            int raw = r.intValue();
            int last = raws.isEmpty() ? 0 : raws.get(raws.size() - 1);
            if (raw <= last || raw > 0xFFFF) throw new IllegalStateException("Gruppenadressen muessen aufsteigen: " + raw);
            raws.add(raw);
            settings.add(st.intValue() & 0xFF);
            groups.add(ga);
        }
        bus.client().writePropertyUnchecked(dst(), index, PID_SECURITY_PROXY_GRP_KEY_TABLE, 0, 1, new byte[] {0, 0});
        for (int i = 0; i < raws.size(); i++) {
            byte[] key;
            try {
                key = bus.keyVault().groupKey(project, groups.get(i));
            } catch (java.io.IOException | java.security.GeneralSecurityException x) {
                throw new IllegalStateException("Gruppenschluessel nicht in der Ablage gesichert: " + x.getMessage(), x);
            }
            byte[] entry = new byte[19];
            entry[0] = (byte) (raws.get(i) >> 8);
            entry[1] = (byte) (int) raws.get(i);
            System.arraycopy(key, 0, entry, 2, 16);
            entry[18] = (byte) (int) settings.get(i);
            Arrays.fill(key, (byte) 0);
            try {
                bus.client().writePropertyUnchecked(dst(), index, PID_SECURITY_PROXY_GRP_KEY_TABLE, i + 1, 1, entry);
            } finally {
                Arrays.fill(entry, (byte) 0);
            }
            if (Thread.interrupted()) throw new InterruptedException();
        }
    }

    private SecureLayer.Entry secureEntry(Map<String, Object> s) {
        String serial = Json.str(s, "serial", "");
        SecureLayer.Entry e = bus.secure().entry(address);
        if (e == null) {
            throw new IllegalStateException("Fuer " + address + " sind keine Secure-Schluessel gebunden. "
                    + "Ist die Schluesselablage entsperrt und das Geraetezertifikat (FDSK) eingetragen?");
        }
        if (!e.serial.equalsIgnoreCase(serial)) {
            throw new IllegalStateException("Unter " + address + " sind die Schluessel der Seriennummer " + e.serial
                    + " gebunden, der Plan nennt " + serial + ".");
        }
        return e;
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
