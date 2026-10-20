package de.sb.knx.bus;

import tuwien.auto.calimero.IndividualAddress;
import tuwien.auto.calimero.SerialNumber;

import java.util.Map;

/** Konstanten und Umrechnungen aus dem KNX-Standard, an einer Stelle gebuendelt. */
public final class Knx {

    /** Interface-Objekttypen nach 03/05/01 "Resources". */
    public static final int OT_DEVICE = 0;
    public static final int OT_ADDRESS_TABLE = 1;
    public static final int OT_ASSOCIATION_TABLE = 2;
    public static final int OT_APPLICATION_PROGRAM = 3;
    public static final int OT_INTERFACE_PROGRAM = 4;
    public static final int OT_ROUTER = 6;
    public static final int OT_SECURITY = 17;

    /** Ereignisse der Load State Machine (03/05/01, Tabelle 93). Der Schreibwert ist immer 10 Oktett. */
    public static final int LOAD_EVENT_NOOP = 0x00;
    public static final int LOAD_EVENT_START_LOADING = 0x01;
    public static final int LOAD_EVENT_LOAD_COMPLETED = 0x02;
    public static final int LOAD_EVENT_ADDITIONAL = 0x03;
    public static final int LOAD_EVENT_UNLOAD = 0x04;

    /** Speicherlage der Geraetekennung bei Realisierungstyp 1 (BCU1, Masken 0010h-0013h, 09/04/01 3.1.10.3):
     *  0104h Hersteller, 0105h-0106h Geraetetyp, 0107h Version. */
    public static final int BCU1_PROGRAM_VERSION = 0x0104;
    public static final int BCU1_PEI_TYPE = 0x0109;
    public static final int BCU1_RUN_ERROR = 0x010D;
    public static final int BCU1_ADDRTAB_SIZE = 0x0116;

    /** Speicherabgebildete Load State Machines der Masken 0700h/0701h (03/05/02 3.31.2). */
    public static final int M112_LOAD_CONTROL = 0x0104;
    public static final int M112_LOAD_STATE_BASE = 0xB6E9;

    public static boolean isBcu1(int mask) {
        return mask >= 0x0010 && mask <= 0x0013;
    }

    /** BIM M112 mit Maske 0700h/0701h fuehrt die Load State Machines im Speicher, 0705h als Property. */
    public static boolean hasMemoryMappedLsm(int mask) {
        return mask == 0x0700 || mask == 0x0701;
    }

    private static final String[] LOAD_STATES =
            {"Unloaded", "Loaded", "Loading", "Error", "Unloading", "LoadCompleting"};
    private static final String[] RUN_STATES =
            {"Halted", "Running", "Ready", "Terminated", "Starting", "Shutting down"};

    private static final Map<Integer, String> OBJECT_TYPES = Map.ofEntries(
            Map.entry(0, "Geraet"),
            Map.entry(1, "Adresstabelle"),
            Map.entry(2, "Assoziationstabelle"),
            Map.entry(3, "Applikationsprogramm"),
            Map.entry(4, "Schnittstellenprogramm"),
            Map.entry(5, "EIB-Objektassoziationstabelle"),
            Map.entry(6, "Router"),
            Map.entry(7, "LTE-Adressroutingtabelle"),
            Map.entry(8, "cEMI-Server"),
            Map.entry(9, "Gruppenobjekttabelle"),
            Map.entry(10, "Polling-Master"),
            Map.entry(11, "KNXnet/IP-Parameter"),
            Map.entry(12, "Applikationssteuerung"),
            Map.entry(13, "Dateiserver"),
            Map.entry(17, "Security"),
            Map.entry(19, "RF-Medium"));

    private Knx() {}

    public static String loadState(int v) {
        return v >= 0 && v < LOAD_STATES.length ? LOAD_STATES[v] : "unbekannt (" + v + ")";
    }

    public static String runState(int v) {
        return v >= 0 && v < RUN_STATES.length ? RUN_STATES[v] : "unbekannt (" + v + ")";
    }

    public static String objectType(int v) {
        return OBJECT_TYPES.getOrDefault(v, "Typ " + v);
    }

    /** Der Schreibwert von PID_LOAD_STATE_CONTROL ist laut Standard immer 10 Oktett lang. */
    public static byte[] loadEvent(int event) {
        byte[] b = new byte[10];
        b[0] = (byte) event;
        return b;
    }

    public static IndividualAddress address(String text) {
        if (text == null) throw new IllegalArgumentException("Physikalische Adresse fehlt");
        String[] parts = text.trim().split("\\.");
        if (parts.length != 3) throw new IllegalArgumentException("Adresse muss Bereich.Linie.Teilnehmer sein: " + text);
        try {
            int area = Integer.parseInt(parts[0]);
            int line = Integer.parseInt(parts[1]);
            int device = Integer.parseInt(parts[2]);
            if (area < 0 || area > 15 || line < 0 || line > 15 || device < 0 || device > 255) {
                throw new IllegalArgumentException("Adresse ausserhalb 0.0.0 bis 15.15.255: " + text);
            }
            return new IndividualAddress(area, line, device);
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("Adresse nicht lesbar: " + text);
        }
    }

    public static SerialNumber serialNumber(String text) {
        if (text == null) throw new IllegalArgumentException("Seriennummer fehlt");
        String hex = text.replaceAll("[^0-9a-fA-F]", "");
        if (hex.length() != 12) throw new IllegalArgumentException("Seriennummer braucht 6 Byte: " + text);
        byte[] b = new byte[6];
        for (int i = 0; i < 6; i++) {
            b[i] = (byte) Integer.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
        }
        try {
            return SerialNumber.from(b);
        } catch (RuntimeException e) {
            throw new IllegalArgumentException("Seriennummer nicht lesbar: " + text);
        }
    }

    public static String hex(byte[] data) {
        if (data == null) return null;
        StringBuilder sb = new StringBuilder(data.length * 2);
        for (byte b : data) sb.append(String.format("%02X", b));
        return sb.toString();
    }

    public static int unsigned(byte[] data) {
        if (data == null) return -1;
        int v = 0;
        for (byte b : data) v = (v << 8) | (b & 0xFF);
        return v;
    }

    public static String ascii(byte[] data) {
        if (data == null) return null;
        StringBuilder sb = new StringBuilder(data.length);
        for (byte b : data) {
            int c = b & 0xFF;
            if (c == 0) break;
            sb.append(c >= 0x20 && c < 0x7F ? (char) c : '.');
        }
        return sb.toString().trim();
    }

    static IndividualAddress addressOrNull(String text) {
        try {
            return address(text);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    static String format(IndividualAddress a) {
        return a == null ? null : a.toString();
    }
}
