package de.sb.knx.bus;

import de.sb.knx.json.Json;
import tuwien.auto.calimero.FrameEvent;
import tuwien.auto.calimero.GroupAddress;
import tuwien.auto.calimero.IndividualAddress;
import tuwien.auto.calimero.KNXAddress;
import tuwien.auto.calimero.KNXException;
import tuwien.auto.calimero.Priority;
import tuwien.auto.calimero.cemi.CEMI;
import tuwien.auto.calimero.cemi.CEMILData;
import tuwien.auto.calimero.link.KNXNetworkLink;
import tuwien.auto.calimero.link.NetworkLinkListener;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * Rohe Buszugriffe fuer die Fehlersuche (nur mit {@code --debug}): Speicher und Properties eines
 * Geraets lesen und schreiben, Gruppentelegramme senden und lesen, und ein Puffer der zuletzt
 * gesehenen Telegramme. Gedacht fuer eine KI-Sitzung, die der Nutzer ausdruecklich fuer den Bus
 * freigegeben hat; die Pruefung, welches Geraet sie anfassen darf, macht das Fenster.
 *
 * <p>Alles laeuft ueber den Busthread des {@link BusService}, also nie parallel zu einem Download.
 */
public final class RawAccess {

    /** Mehr nimmt ein Lese- oder Schreibauftrag nicht an. */
    public static final int MAX_BYTES = 1024;
    /** Je Telegramm: passt in einen Standardrahmen (A_Memory_Read/Write mit 12 Oktetten). */
    private static final int CHUNK = 12;
    private static final int MONITOR_SIZE = 500;

    private final BusService bus;
    private final Deque<Map<String, Object>> frames = new ArrayDeque<>();
    private long seq;
    private KNXNetworkLink watched;

    public RawAccess(BusService bus) {
        this.bus = bus;
    }

    /* ---------------- Speicher und Properties ---------------- */

    public Map<String, Object> readMemory(IndividualAddress addr, int start, int count)
            throws KNXException, InterruptedException {
        range(start, count);
        byte[] out = bus.withDestination(addr, d -> {
            byte[] all = new byte[count];
            for (int off = 0; off < count; off += CHUNK) {
                int n = Math.min(CHUNK, count - off);
                byte[] part = bus.client().readMemory(d, start + off, n);
                System.arraycopy(part, 0, all, off, Math.min(n, part.length));
            }
            return all;
        });
        Map<String, Object> m = Json.obj();
        m.put("address", addr.toString());
        m.put("start", start);
        m.put("data", HexFormat.of().formatHex(out));
        return m;
    }

    public Map<String, Object> writeMemory(IndividualAddress addr, int start, byte[] data, boolean verify)
            throws KNXException, InterruptedException {
        range(start, data.length);
        String mismatch = bus.withDestination(addr, d -> {
            for (int off = 0; off < data.length; off += CHUNK) {
                int n = Math.min(CHUNK, data.length - off);
                byte[] part = new byte[n];
                System.arraycopy(data, off, part, 0, n);
                bus.client().writeMemory(d, start + off, part);
                if (verify) {
                    byte[] back = bus.client().readMemory(d, start + off, n);
                    if (!java.util.Arrays.equals(back, part)) {
                        return String.format("%04X: geschrieben %s, gelesen %s", start + off,
                                HexFormat.of().formatHex(part), HexFormat.of().formatHex(back));
                    }
                }
            }
            return null;
        });
        Map<String, Object> m = Json.obj();
        m.put("address", addr.toString());
        m.put("start", start);
        m.put("written", data.length);
        m.put("verified", verify && mismatch == null);
        if (mismatch != null) m.put("mismatch", mismatch);
        return m;
    }

    public Map<String, Object> readProperty(IndividualAddress addr, int objIndex, int pid, int start, int count)
            throws KNXException, InterruptedException {
        property(objIndex, pid, start, count);
        byte[] out = bus.withDestination(addr, d -> bus.client().readProperty(d, objIndex, pid, start, count));
        Map<String, Object> m = Json.obj();
        m.put("address", addr.toString());
        m.put("objIndex", objIndex);
        m.put("pid", pid);
        m.put("start", start);
        m.put("count", count);
        m.put("data", HexFormat.of().formatHex(out));
        return m;
    }

    public Map<String, Object> writeProperty(IndividualAddress addr, int objIndex, int pid, int start, int count,
                                             byte[] data) throws KNXException, InterruptedException {
        property(objIndex, pid, start, count);
        if (data.length == 0 || data.length > 255) throw new IllegalArgumentException("1 bis 255 Datenoktette");
        bus.withDestination(addr, d -> {
            bus.client().writeProperty(d, objIndex, pid, start, count, data);
            return null;
        });
        Map<String, Object> m = Json.obj();
        m.put("address", addr.toString());
        m.put("objIndex", objIndex);
        m.put("pid", pid);
        m.put("written", data.length);
        return m;
    }

    private static void range(int start, int count) {
        if (start < 0 || start > 0xFFFF) throw new IllegalArgumentException("Startadresse 0 bis FFFFh");
        if (count < 1 || count > MAX_BYTES) throw new IllegalArgumentException("1 bis " + MAX_BYTES + " Oktette");
        if (start + count > 0x10000) throw new IllegalArgumentException("Bereich geht ueber FFFFh hinaus");
    }

    private static void property(int objIndex, int pid, int start, int count) {
        if (objIndex < 0 || objIndex > 255) throw new IllegalArgumentException("Objektindex 0 bis 255");
        if (pid < 1 || pid > 255) throw new IllegalArgumentException("PID 1 bis 255");
        if (start < 0 || start > 4095) throw new IllegalArgumentException("Startindex 0 bis 4095");
        if (count < 1 || count > 15) throw new IllegalArgumentException("Anzahl 1 bis 15");
    }

    /* ---------------- Gruppentelegramme ---------------- */

    /**
     * A_GroupValue_Write. {@code small}: Wert bis 6 Bit im APCI-Oktett (DPT 1, 2, 3), sonst die
     * Datenoktette dahinter.
     */
    public Map<String, Object> groupWrite(GroupAddress ga, Integer small, byte[] data) throws KNXException, InterruptedException {
        byte[] tpdu;
        if (small != null) {
            if (small < 0 || small > 0x3F) throw new IllegalArgumentException("Kleiner Wert 0 bis 63");
            tpdu = new byte[] { 0x00, (byte) (0x80 | small) };
        } else {
            if (data == null || data.length < 1 || data.length > 14) throw new IllegalArgumentException("1 bis 14 Datenoktette");
            tpdu = new byte[2 + data.length];
            tpdu[1] = (byte) 0x80;
            System.arraycopy(data, 0, tpdu, 2, data.length);
        }
        bus.link().sendRequestWait(ga, Priority.LOW, tpdu);
        Map<String, Object> m = Json.obj();
        m.put("group", ga.toString());
        m.put("sent", HexFormat.of().formatHex(tpdu));
        return m;
    }

    /** A_GroupValue_Read und die erste Antwort darauf, hoechstens {@code timeoutMs}. */
    public Map<String, Object> groupRead(GroupAddress ga, int timeoutMs) throws KNXException, InterruptedException {
        KNXNetworkLink link = bus.link();
        CompletableFuture<CEMILData> answer = new CompletableFuture<>();
        NetworkLinkListener l = new NetworkLinkListener() {
            @Override
            public void indication(FrameEvent e) {
                if (e.getFrame() instanceof CEMILData f && ga.equals(f.getDestination())) {
                    byte[] p = f.getPayload();
                    if (p.length >= 2 && apci(p) == 1) answer.complete(f);
                }
            }
        };
        link.addLinkListener(l);
        Map<String, Object> m = Json.obj();
        m.put("group", ga.toString());
        try {
            link.sendRequestWait(ga, Priority.LOW, new byte[] { 0x00, 0x00 });
            CEMILData f = answer.get(Math.max(200, Math.min(timeoutMs, 10_000)), TimeUnit.MILLISECONDS);
            byte[] p = f.getPayload();
            m.put("answered", true);
            m.put("from", f.getSource().toString());
            if (p.length == 2) m.put("value", p[1] & 0x3F);
            else m.put("data", HexFormat.of().formatHex(p, 2, p.length));
        } catch (TimeoutException e) {
            m.put("answered", false);
        } catch (ExecutionException e) {
            throw new IllegalStateException(String.valueOf(e.getCause()));
        } finally {
            link.removeLinkListener(l);
        }
        return m;
    }

    /* ---------------- Telegrammpuffer ---------------- */

    /** Haengt den Puffer an den aktuellen Link - nach jedem Verbinden aufzurufen; doppelt schadet nicht. */
    public synchronized void watch() {
        KNXNetworkLink link;
        try {
            link = bus.link();
        } catch (IllegalStateException e) {
            return;
        }
        if (link == watched) return;
        watched = link;
        link.addLinkListener(new NetworkLinkListener() {
            @Override
            public void indication(FrameEvent e) {
                record("in", e.getFrame());
            }

            @Override
            public void confirmation(FrameEvent e) {
                record("out", e.getFrame());
            }
        });
    }

    private synchronized void record(String dir, CEMI frame) {
        if (!(frame instanceof CEMILData f)) return;
        Map<String, Object> m = Json.obj();
        m.put("seq", ++seq);
        m.put("at", System.currentTimeMillis());
        m.put("dir", dir);
        m.put("from", f.getSource().toString());
        KNXAddress dst = f.getDestination();
        m.put("to", dst.toString());
        m.put("group", dst instanceof GroupAddress);
        byte[] p = f.getPayload();
        m.put("service", service(p, dst instanceof GroupAddress));
        m.put("tpdu", HexFormat.of().formatHex(p));
        frames.addLast(m);
        while (frames.size() > MONITOR_SIZE) frames.removeFirst();
    }

    /** Telegramme nach {@code after} (fortlaufende Nummer), hoechstens {@code limit}, die neuesten. */
    public synchronized Map<String, Object> monitor(long after, int limit, String address) {
        List<Object> out = new ArrayList<>();
        for (Map<String, Object> f : frames) {
            if ((long) f.get("seq") <= after) continue;
            if (address != null && !address.equals(f.get("from")) && !address.equals(f.get("to"))) continue;
            out.add(f);
        }
        int n = Math.max(1, Math.min(limit, MONITOR_SIZE));
        if (out.size() > n) out = new ArrayList<>(out.subList(out.size() - n, out.size()));
        Map<String, Object> m = Json.obj();
        m.put("last", seq);
        m.put("frames", out);
        return m;
    }

    static int apci(byte[] tpdu) {
        return ((tpdu[0] & 0x03) << 2) | ((tpdu[1] & 0xC0) >> 6);
    }

    /** Kurzname des Dienstes - genug, um einen Mitschnitt zu lesen. */
    static String service(byte[] p, boolean group) {
        if (p.length == 0) return "?";
        int tpci = p[0] & 0xFF;
        if (p.length == 1) {
            return switch (tpci & 0xC3) {
                case 0x80 -> "T_Connect";
                case 0x81 -> "T_Disconnect";
                case 0xC2 -> "T_Ack";
                case 0xC3 -> "T_Nak";
                default -> String.format("TPCI %02X", tpci);
            };
        }
        int a = apci(p);
        if (group) return switch (a) {
            case 0 -> "GroupValueRead";
            case 1 -> "GroupValueResponse";
            case 2 -> "GroupValueWrite";
            default -> "APCI " + a;
        };
        int ext = ((a << 6) | (p[1] & 0x3F)) & 0x3FF;
        return switch (a) {
            case 3 -> "IndividualAddressWrite";
            case 4 -> "IndividualAddressRead";
            case 5 -> "IndividualAddressResponse";
            case 6 -> "ADC_Read";
            case 7 -> "ADC_Response";
            case 8 -> "Memory_Read";
            case 9 -> "Memory_Response";
            case 10 -> "Memory_Write";
            case 12 -> "DeviceDescriptor_Read";
            case 13 -> "DeviceDescriptor_Response";
            case 14 -> "Restart";
            case 15 -> switch (ext) {
                case 0x3D5 -> "PropertyValue_Read";
                case 0x3D6 -> "PropertyValue_Response";
                case 0x3D7 -> "PropertyValue_Write";
                case 0x3D8 -> "PropertyDescription_Read";
                case 0x3D9 -> "PropertyDescription_Response";
                case 0x3D1 -> "Authorize_Request";
                case 0x3D2 -> "Authorize_Response";
                case 0x3DC -> "IndividualAddressSerialNumber_Read";
                case 0x3DD -> "IndividualAddressSerialNumber_Response";
                case 0x3DE -> "IndividualAddressSerialNumber_Write";
                case 0x3F1 -> "SecureService";
                default -> String.format("APCI %03X", ext);
            };
            default -> "APCI " + a;
        };
    }
}
