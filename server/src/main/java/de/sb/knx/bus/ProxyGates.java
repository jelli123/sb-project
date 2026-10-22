package de.sb.knx.bus;

import tuwien.auto.calimero.IndividualAddress;
import tuwien.auto.calimero.KNXException;
import tuwien.auto.calimero.KnxNegativeReturnCodeException;
import tuwien.auto.calimero.ReturnCode;
import tuwien.auto.calimero.mgmt.Destination;
import tuwien.auto.calimero.mgmt.FuncPropResponse;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Freigaben an Security Proxys (AN192) fuer die Dauer eines Zugriffs.
 * <p>
 * Sperrt ein Proxy Punkt-zu-Punkt oder Broadcast auf eine Seite, kommt das Werkzeug nur hindurch,
 * wenn es sich den Weg oeffnet: eine Temporary Unicast White List (PID 83) fuer die eigene
 * Tunneladresse und die Ziele, die Broadcast-Freigabe auf Zeit (PID 84) auf beiden Seiten. Beides
 * laeuft nach 60 s ab; zwischen den Schritten eines Downloads wird nachgetriggert, am Ende widerrufen.
 * <p>
 * Welche Proxys auf dem Weg liegen, rechnet die Oberflaeche aus der Topologie (knx-proxy.js) und
 * schickt sie in Wegreihenfolge mit: der naechste zuerst, denn erst seine Freigabe laesst die
 * Anfrage an den folgenden durch.
 */
public final class ProxyGates {

    /** Router Interface Object und die Function Properties des Proxys (AN192 2.3.1.3, 2.3.1.4). */
    private static final int OT_ROUTER = 6;
    private static final int PID_PTP_ROUTING_TEMP = 83;
    private static final int PID_BC_ROUTING_TEMP = 84;
    private static final int PID_IO_LIST = 71;

    /** Freigaben gelten 60 s; nachgetriggert wird deutlich vorher, auch wenn ein Schritt 30 s dauert. */
    private static final long RETRIGGER_MS = 20_000;

    public record Gate(IndividualAddress proxy, List<IndividualAddress> partners, boolean ptp, boolean bc) {}

    private enum Mode { OPEN, RETRIGGER, CLOSE }

    private final BusService bus;
    private final List<Gate> gates;
    private final List<String> notes;
    private final List<Gate> opened = new ArrayList<>();
    private IndividualAddress user;
    private long lastOpen;

    public ProxyGates(BusService bus, List<Gate> gates, List<String> notes) {
        this.bus = bus;
        this.gates = List.copyOf(gates);
        this.notes = notes;
    }

    /** Liest die Freigaben aus dem Auftrag: [{ proxy, partners: [...], ptp, bc }]. */
    public static List<Gate> parse(Object raw) {
        List<Gate> out = new ArrayList<>();
        if (!(raw instanceof List<?> list)) return out;
        for (Object o : list) {
            if (!(o instanceof Map<?, ?> m) || !(m.get("proxy") instanceof String proxy))
                throw new IllegalArgumentException("Freigabe ohne Proxy-Adresse");
            List<IndividualAddress> partners = new ArrayList<>();
            if (m.get("partners") instanceof List<?> p) {
                for (Object x : p) {
                    if (!(x instanceof String a)) throw new IllegalArgumentException("Partneradresse muss Text sein");
                    partners.add(Knx.address(a));
                }
            }
            out.add(new Gate(Knx.address(proxy), partners, Boolean.TRUE.equals(m.get("ptp")),
                    Boolean.TRUE.equals(m.get("bc"))));
        }
        return out;
    }

    boolean isEmpty() {
        return gates.isEmpty();
    }

    public void open() throws KNXException, InterruptedException {
        if (gates.isEmpty()) return;
        user = bus.linkAddress();
        if (user == null) throw new IllegalStateException("Die eigene Adresse der Schnittstelle ist unbekannt - "
                + "ohne sie laesst sich kein Security Proxy oeffnen.");
        for (Gate g : gates) {
            sync(g.proxy());
            send(g, Mode.OPEN);
            opened.add(g);
            notes.add("Security Proxy " + g.proxy() + " fuer diesen Zugriff geoeffnet"
                    + (g.ptp() ? " (Punkt-zu-Punkt)" : "") + (g.bc() ? " (Broadcast)" : "") + ".");
        }
        lastOpen = System.currentTimeMillis();
    }

    /** Zwischen zwei Schritten: vor Ablauf der 60 s erneuern. */
    void keepAlive() throws KNXException, InterruptedException {
        if (opened.isEmpty() || System.currentTimeMillis() - lastOpen < RETRIGGER_MS) return;
        for (Gate g : opened) send(g, Mode.RETRIGGER);
        lastOpen = System.currentTimeMillis();
    }

    /** Am Ende wieder schliessen. Scheitert das, laeuft die Freigabe nach 60 s von selbst ab. */
    public void close() {
        for (int i = opened.size() - 1; i >= 0; i--) {
            Gate g = opened.get(i);
            try {
                send(g, Mode.CLOSE);
            } catch (KNXException | RuntimeException e) {
                notes.add("Security Proxy " + g.proxy() + " nicht geschlossen (" + e.getMessage()
                        + ") - die Freigabe endet nach 60 s von selbst.");
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
        }
        opened.clear();
    }

    /* Mit einem gesicherten Proxy erst synchronisieren, wenn die Ablage seine Schluessel kennt. */
    private void sync(IndividualAddress proxy) throws InterruptedException {
        SecureLayer s = bus.secure();
        if (s != null && s.entry(proxy) != null) s.resync(proxy);
    }

    private void send(Gate g, Mode mode) throws KNXException, InterruptedException {
        boolean on = mode != Mode.CLOSE;
        bus.withDestination(g.proxy(), d -> {
            List<Integer> routers = routerObjects(d);
            if (routers.isEmpty()) throw new IllegalStateException(g.proxy() + " hat kein Router-Objekt - kein Security Proxy?");
            if (g.ptp()) {
                // WriteServiceID 00h Hinzufuegen [00, 00, User, Start, Anzahl], 01h Widerrufen und
                // 02h Nachtriggern [00, ID, User] (AN192 2.3.1.3.5) - beides fuer die ganze Liste des Users
                if (mode == Mode.OPEN) {
                    for (IndividualAddress partner : g.partners()) {
                        check(g, "Punkt-zu-Punkt", () -> call(d, routers.get(0), PID_PTP_ROUTING_TEMP,
                                new byte[] {0, 0, hi(user), lo(user), hi(partner), lo(partner), 0, 1}));
                    }
                } else {
                    byte id = (byte) (mode == Mode.RETRIGGER ? 2 : 1);
                    check(g, "Punkt-zu-Punkt", () -> call(d, routers.get(0), PID_PTP_ROUTING_TEMP,
                            new byte[] {0, id, hi(user), lo(user)}));
                }
            }
            if (g.bc()) {
                for (int i = 0; i < Math.min(2, routers.size()); i++) {
                    int router = routers.get(i);
                    check(g, "Broadcast", () -> call(d, router, PID_BC_ROUTING_TEMP, new byte[] {0, 0, (byte) (on ? 1 : 0)}));
                    // System Broadcast kennt nicht jede Seite (nicht TP1, AN192 2.7.2.1) - Ablehnung ist dort normal
                    try {
                        call(d, router, PID_BC_ROUTING_TEMP, new byte[] {0, 1, (byte) (on ? 1 : 0)});
                    } catch (KnxNegativeReturnCodeException ignored) {
                        // E_COMMAND_INVALID auf einer TP1-Seite
                    }
                }
            }
            return null;
        });
    }

    private FuncPropResponse call(Destination d, int index, int pid, byte[] data) throws KNXException, InterruptedException {
        return bus.client().callFunctionProperty(d, index, pid, data);
    }

    private static void check(Gate g, String what, FuncPropResponse r) {
        if (r.returnCode() != ReturnCode.Success)
            throw new IllegalStateException("Security Proxy " + g.proxy() + " lehnt die " + what + "-Freigabe ab ("
                    + r.returnCode() + ").");
    }

    /* Calimero meldet einen negativen Rueckgabecode als Ausnahme - hier mit Proxy und Zweck. */
    private interface Call {
        FuncPropResponse run() throws KNXException, InterruptedException;
    }

    private static void check(Gate g, String what, Call call) throws KNXException, InterruptedException {
        try {
            check(g, what, call.run());
        } catch (KnxNegativeReturnCodeException e) {
            throw new IllegalStateException("Security Proxy " + g.proxy() + " lehnt die " + what + "-Freigabe ab ("
                    + e.getMessage() + ").", e);
        }
    }

    /* Indizes der Router-Objekte in der Objektliste des Proxys: das erste ist die Primaer-, das zweite die Sekundaerseite. */
    private List<Integer> routerObjects(Destination d) throws KNXException, InterruptedException {
        List<Integer> out = new ArrayList<>();
        int n = Knx.unsigned(bus.client().readProperty(d, 0, PID_IO_LIST, 0, 1));
        if (n <= 0 || n > 64) return out;
        byte[] list = bus.client().readProperty(d, 0, PID_IO_LIST, 1, n);
        for (int i = 0; i * 2 + 1 < list.length; i++) {
            if ((((list[i * 2] & 0xFF) << 8) | (list[i * 2 + 1] & 0xFF)) == OT_ROUTER) out.add(i);
        }
        return out;
    }

    private static byte hi(IndividualAddress a) {
        return (byte) (a.getRawAddress() >> 8);
    }

    private static byte lo(IndividualAddress a) {
        return (byte) a.getRawAddress();
    }
}
