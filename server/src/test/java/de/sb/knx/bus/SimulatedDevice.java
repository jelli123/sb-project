package de.sb.knx.bus;

import tuwien.auto.calimero.CloseEvent;
import tuwien.auto.calimero.FrameEvent;
import tuwien.auto.calimero.IndividualAddress;
import tuwien.auto.calimero.Priority;
import tuwien.auto.calimero.cemi.CEMILData;
import tuwien.auto.calimero.link.NetworkLinkListener;

import java.util.Arrays;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Gegenstelle mit verbindungsorientierter Transportschicht (03/03/04): T_Connect setzt die
 * Folgenummer zurueck, jedes T_Data_Connected wird quittiert und die Antwort traegt die eigene
 * Folgenummer. Zwischen Quittung und Antwort liegen einige Millisekunden wie auf dem TP-Bus -
 * ohne diese Pause sieht Calimero die Antwort mitunter noch vor seiner eigenen Quittung.
 */
abstract class SimulatedDevice implements NetworkLinkListener {

    final IndividualAddress address;
    final IndividualAddress tool;
    final FakeLink link;
    final List<String> log = new CopyOnWriteArrayList<>();
    private int seqSend;

    SimulatedDevice(IndividualAddress address, IndividualAddress tool, FakeLink link) {
        this.address = address;
        this.tool = tool;
        this.link = link;
        link.addLinkListener(this);
    }

    /** Liefert die Antwort-APDU (APCI in den ersten zwei Oktetten) oder null. */
    abstract byte[] handle(byte[] tpdu, int tpci);

    /** Setzt die TPCI ein; ein Secure-Geraet sichert hier. null heisst: nichts senden. */
    byte[] seal(byte[] apdu, int tpci) {
        byte[] out = apdu.clone();
        out[0] = (byte) ((out[0] & 0x03) | tpci);
        return out;
    }

    @Override
    public void indication(FrameEvent e) {
        CEMILData f = (CEMILData) e.getFrame();
        if (!f.getDestination().equals(address)) return;
        byte[] tpdu = f.getPayload();
        int tpci = tpdu[0] & 0xFF;
        if (tpci == 0x80) { seqSend = 0; return; }                    // T_Connect
        if (tpci == 0x81 || (tpci & 0xC3) == 0xC2) return;            // T_Disconnect, T_ACK
        boolean connected = (tpci & 0xC0) == 0x40;
        if (connected) send(new byte[] {(byte) (0xC2 | (((tpci >> 2) & 0x0F) << 2))});
        byte[] resp = handle(tpdu, tpci);
        if (resp == null) return;
        pause();
        byte[] out = seal(resp, connected ? 0x40 | (seqSend << 2) : 0);
        if (out == null) return;
        if (connected) seqSend = (seqSend + 1) & 0x0F;
        send(out);
    }

    void send(byte[] tpdu) {
        link.sendRequestWait(tool, Priority.SYSTEM, tpdu);
    }

    /**
     * Ein Neustart beendet die Transportverbindung (03/05/02 3.7.1.1). Wie auf dem Bus kommt das
     * T_Disconnect erst nach der Quittung: direkt dahinter landet es bei Calimero 2.6 mitunter in
     * der Warteschlange des Senders, der schon fertig ist - und restart() wartet ohne Ende.
     */
    void disconnect() {
        pause();
        send(new byte[] {(byte) 0x81});
    }

    private static void pause() {
        try {
            Thread.sleep(4);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    static int apci(byte[] apdu) {
        return ((apdu[0] & 0x03) << 8) | (apdu[1] & 0xFF);
    }

    static byte[] apdu(int apci, byte... asdu) {
        byte[] r = new byte[2 + asdu.length];
        r[0] = (byte) (apci >> 8);
        r[1] = (byte) apci;
        System.arraycopy(asdu, 0, r, 2, asdu.length);
        return r;
    }

    /** A_PropertyValue_Response: Objekt, PID, Anzahl/Start und Daten; ohne Daten heisst abgelehnt. */
    static byte[] propertyResponse(int obj, int pid, int n, int start, byte[] data) {
        if (data == null) return apdu(0x3D6, (byte) obj, (byte) pid, (byte) ((start >> 8) & 0x0F), (byte) start);
        byte[] head = apdu(0x3D6, (byte) obj, (byte) pid, (byte) ((Math.max(1, n) << 4) | ((start >> 8) & 0x0F)), (byte) start);
        byte[] out = Arrays.copyOf(head, head.length + data.length);
        System.arraycopy(data, 0, out, head.length, data.length);
        return out;
    }

    /** A_PropertyDescription_Response: PDT_UNSIGNED_INT, 32 Elemente - Calimero fragt vor Array-Lesezugriffen. */
    static byte[] propertyDescription(byte[] request) {
        return apdu(0x3D9, request[2], request[3], (byte) 0, (byte) 0x04, (byte) 0, (byte) 0x20, (byte) 0x33);
    }

    static int crc16(byte[] data) {
        int c = 0xFFFF;
        for (byte x : data) {
            c ^= (x & 0xFF) << 8;
            for (int i = 0; i < 8; i++) c = (c & 0x8000) != 0 ? ((c << 1) ^ 0x1021) & 0xFFFF : (c << 1) & 0xFFFF;
        }
        return c;
    }

    @Override
    public void linkClosed(CloseEvent e) {}
}
