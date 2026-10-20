package de.sb.knx.bus;

import tuwien.auto.calimero.CloseEvent;
import tuwien.auto.calimero.DataUnitBuilder;
import tuwien.auto.calimero.FrameEvent;
import tuwien.auto.calimero.IndividualAddress;
import tuwien.auto.calimero.KNXAddress;
import tuwien.auto.calimero.Priority;
import tuwien.auto.calimero.cemi.CEMILData;
import tuwien.auto.calimero.cemi.CEMILDataEx;
import tuwien.auto.calimero.link.KNXNetworkLink;
import tuwien.auto.calimero.link.NetworkLinkListener;
import tuwien.auto.calimero.link.medium.KNXMediumSettings;
import tuwien.auto.calimero.link.medium.TPSettings;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.UnaryOperator;

/**
 * Ein Ende eines simulierten Busses. Was gesendet wird, kommt beim Gegenueber als L_Data.ind an,
 * zugestellt in einem eigenen Strang wie bei einer echten Schnittstelle. Rahmen ueber 16 Oktette
 * gehen als Extended Frame - KNX Secure braucht sie.
 */
final class FakeLink implements KNXNetworkLink {

    private final KNXMediumSettings medium;
    private final List<NetworkLinkListener> listeners = new CopyOnWriteArrayList<>();
    private final ExecutorService deliver = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "fake-link");
        t.setDaemon(true);
        return t;
    });
    private volatile FakeLink peer;
    private volatile boolean open = true;
    /** Veraendert einen gesendeten Rahmen, bevor er auf den Bus geht; null laesst ihn, wie er ist. */
    volatile UnaryOperator<byte[]> tamper;
    /** Alle Rahmen auf diesem Bus, fuer die Meldung eines fehlgeschlagenen Tests. */
    final List<String> trace;
    private final long t0;

    private FakeLink(IndividualAddress own, List<String> trace, long t0) {
        medium = new TPSettings(own);
        this.trace = trace;
        this.t0 = t0;
    }

    /** Zwei verbundene Enden: Werkzeug und Geraet. */
    static FakeLink[] pair(IndividualAddress a, IndividualAddress b) {
        List<String> trace = new CopyOnWriteArrayList<>();
        long t0 = System.nanoTime();
        FakeLink x = new FakeLink(a, trace, t0), y = new FakeLink(b, trace, t0);
        x.peer = y;
        y.peer = x;
        return new FakeLink[] {x, y};
    }

    /** Ein weiteres Ende, das nur sendet - fuer eine S-AL, die nicht selbst mithoeren soll. */
    static FakeLink sender(IndividualAddress own, FakeLink to) {
        FakeLink l = new FakeLink(own, to.trace, to.t0);
        l.peer = to;
        return l;
    }

    @Override public void setKNXMedium(KNXMediumSettings settings) {}
    @Override public KNXMediumSettings getKNXMedium() { return medium; }
    @Override public void addLinkListener(NetworkLinkListener l) { listeners.add(l); }
    @Override public void removeLinkListener(NetworkLinkListener l) { listeners.remove(l); }
    @Override public void setHopCount(int count) {}
    @Override public int getHopCount() { return 6; }

    @Override
    public void sendRequest(KNXAddress dst, Priority p, byte[] nsdu) {
        sendRequestWait(dst, p, nsdu);
    }

    @Override
    public void sendRequestWait(KNXAddress dst, Priority p, byte[] nsdu) {
        UnaryOperator<byte[]> t = tamper;
        byte[] copy = t == null ? nsdu.clone() : t.apply(nsdu.clone());
        IndividualAddress src = medium.getDeviceAddress();
        FakeLink to = peer;
        trace.add(String.format("%6d ms %s->%s %s%s", (System.nanoTime() - t0) / 1_000_000, src, dst,
                DataUnitBuilder.toHex(copy, ""), to.open ? "" : " (verworfen)"));
        if (!to.open) return;                         // das Gegenueber ist schon abgebaut
        to.deliver.submit(() -> to.indicate(src, dst, copy));
    }

    @Override
    public void send(CEMILData frame, boolean waitForCon) {
        sendRequestWait(frame.getDestination(), frame.getPriority(), frame.getPayload());
    }

    private void indicate(IndividualAddress src, KNXAddress dst, byte[] tpdu) {
        CEMILData f = tpdu.length > 16
                ? new CEMILDataEx(CEMILData.MC_LDATA_IND, src, dst, tpdu, Priority.SYSTEM)
                : new CEMILData(CEMILData.MC_LDATA_IND, src, dst, tpdu, Priority.SYSTEM);
        FrameEvent e = new FrameEvent(this, f);
        for (NetworkLinkListener l : listeners) l.indication(e);
    }

    @Override public String getName() { return "simulierter Bus " + medium.getDeviceAddress(); }
    @Override public boolean isOpen() { return open; }

    @Override
    public void close() {
        if (!open) return;
        open = false;
        for (NetworkLinkListener l : listeners) l.linkClosed(new CloseEvent(this, CloseEvent.USER_REQUEST, "Test beendet"));
        deliver.shutdownNow();
    }
}
