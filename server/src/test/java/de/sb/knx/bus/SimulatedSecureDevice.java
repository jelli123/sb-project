package de.sb.knx.bus;

import tuwien.auto.calimero.DataUnitBuilder;
import tuwien.auto.calimero.IndividualAddress;
import tuwien.auto.calimero.KNXAddress;
import tuwien.auto.calimero.link.KNXNetworkLink;
import tuwien.auto.calimero.secure.SecureApplicationLayer;
import tuwien.auto.calimero.secure.Security;
import tuwien.auto.calimero.secure.SecurityControl;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Ein KNX-Secure-Geraet, dessen Secure Application Layer Calimero stellt (03/03/07 5.x): ab Werk
 * mit dem FDSK, das Security-Objekt mit Tool Key, Security Mode, Load State Machine und den
 * Tabellen 53, 54 und 61 (03/05/01 6.3). Im Security Mode beantwortet es nichts Unverschluesseltes.
 */
final class SimulatedSecureDevice extends SimulatedDevice {

    /** Objektliste: Index 5 ist das Security-Objekt (Typ 17). */
    static final int[] TYPES = {0, 1, 2, 9, 3, 17};
    static final int SECURITY = 5;

    /** Die TPCI gehoert in den MAC; fuer verbindungsorientierte Antworten setzt sie das Geraet selbst. */
    private static final class DeviceSal extends SecureApplicationLayer {
        volatile int nextTpci;

        DeviceSal(KNXNetworkLink link, Security security) {
            super(link, security);
            // Ein Geraet im Feld hat laengst eine eigene Sendenummer; ab 1 synchronisierte Calimero beim Antworten
            updateSequenceNumber(true, 100);
        }

        @Override
        protected int tpci(KNXAddress dst) {
            return nextTpci;
        }
    }

    private final DeviceSal sal;
    private final Security security = Security.newSecurity();
    final byte[] fdsk;
    volatile byte[] toolKey;
    volatile boolean securityMode;
    volatile int securityLoadState;
    final Map<Integer, List<byte[]>> tables = new HashMap<>();
    /** 03/03/07 NOTE 10: die Antwort auf PID_TOOL_KEY darf trotz Erfolg 0 Elemente tragen. */
    volatile boolean toolKeyAnswerEmpty = true;
    /** Verschluckt die naechste laengere Antwort nach dem Setzen des Tool Keys. */
    volatile boolean dropToolKeyAnswer;
    /** So viele Sync-Antworten kommen mit verfaelschtem MAC an - wie bei Calimero, wenn die Zufallszahl auf 00h endet. */
    volatile int garbleSyncAnswers;
    private boolean requestSecured;

    SimulatedSecureDevice(IndividualAddress address, IndividualAddress tool, FakeLink link, FakeLink toTool, byte[] fdsk) {
        super(address, tool, link);
        this.fdsk = fdsk.clone();
        security.deviceToolKeys().put(tool, this.fdsk);
        // Eigener Sendeweg: die S-AL soll nicht selbst am Link mithoeren und doppelt entschluesseln
        FakeLink out = FakeLink.sender(address, toTool);
        out.tamper = this::garble;
        sal = new DeviceSal(out, security);
    }

    /** Werkszustand am Geraet: der FDSK gilt wieder, Security Mode aus, Tabellen leer (03/05/01 6.1.4, 6.3.5.4). */
    void factoryReset() {
        toolKey = null;
        securityMode = false;
        securityLoadState = 0;
        tables.clear();
        security.deviceToolKeys().put(tool, fdsk);
    }

    private byte[] garble(byte[] tpdu) {
        boolean syncAnswer = tpdu.length > 2 && apci(tpdu) == SecureApplicationLayer.SecureService && (tpdu[2] & 0x07) == 3;
        if (syncAnswer && garbleSyncAnswers > 0) {
            garbleSyncAnswers--;
            tpdu[tpdu.length - 1] ^= 1;
            log.add("Sync-Antwort verfaelscht");
        }
        return tpdu;
    }

    @Override
    byte[] handle(byte[] tpdu, int tpci) {
        requestSecured = apci(tpdu) == SecureApplicationLayer.SecureService;
        byte[] apdu;
        if (requestSecured) {
            try {
                apdu = sal.decrypt(tool, address, tpci, DataUnitBuilder.extractASDU(tpdu)).apdu();
            } catch (RuntimeException e) {
                log.add("abgewiesen: " + e.getMessage());
                return null;
            }
            if (apdu.length == 0) {
                log.add("sync");                              // S-A_Sync beantwortet die S-AL selbst
                return null;
            }
        } else {
            if (securityMode) {
                log.add("unverschluesselt abgewiesen");
                return null;
            }
            apdu = tpdu;
        }
        return service(apdu);
    }

    @Override
    byte[] seal(byte[] apdu, int tpci) {
        if (dropToolKeyAnswer && toolKey != null && apdu.length > 10) {
            dropToolKeyAnswer = false;
            log.add("Antwort verloren");
            return null;
        }
        if (!requestSecured) return super.seal(apdu, tpci);
        sal.nextTpci = tpci;
        try {
            return sal.secureData(address, tool, apdu, SecurityControl.of(SecurityControl.DataSecurity.AuthConf, true)).get();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return null;
        } finally {
            sal.nextTpci = 0;
        }
    }

    private byte[] service(byte[] a) {
        int apci = apci(a);
        if ((apci & 0x3C0) == 0x300) return apdu(0x340, (byte) 0x07, (byte) 0xB0);
        if (apci == 0x3D8) return propertyDescription(a);
        if (apci == 0x3D5 || apci == 0x3D7) {
            int obj = a[2] & 0xFF, pid = a[3] & 0xFF;
            int n = (a[4] & 0xFF) >> 4, start = ((a[4] & 0x0F) << 8) | (a[5] & 0xFF);
            return property(apci == 0x3D7, obj, pid, n, start, Arrays.copyOfRange(a, 6, a.length));
        }
        if (apci == 0x2C7 && (a[2] & 0xFF) == SECURITY && (a[3] & 0xFF) == 51 && a.length >= 7) {
            // PID_SECURITY_MODE, WriteServiceID 00h (03/05/01 6.3.5.1)
            securityMode = a[6] == 1;
            return apdu(0x2C9, a[2], a[3], (byte) 0, (byte) 0);
        }
        log.add("unbekannt " + Integer.toHexString(apci));
        return null;
    }

    private byte[] property(boolean write, int obj, int pid, int n, int start, byte[] data) {
        if (obj == 0 && pid == 56 && !write) return propertyResponse(obj, pid, n, start, new byte[] {0, (byte) 0xFE});
        if (obj == 0 && pid == 71 && !write) {
            if (start == 0) return propertyResponse(obj, pid, n, start, new byte[] {0, (byte) TYPES.length});
            byte[] r = new byte[2 * n];
            for (int i = 0; i < n; i++) r[2 * i + 1] = (byte) TYPES[start - 1 + i];
            return propertyResponse(obj, pid, n, start, r);
        }
        if (pid == 1 && !write && obj < TYPES.length) return propertyResponse(obj, pid, n, start, new byte[] {0, (byte) TYPES[obj]});
        if (obj != SECURITY) return propertyResponse(obj, pid, n, start, null);
        switch (pid) {
            case 5 -> {
                if (write) {
                    int ev = data[0] & 0xFF;
                    if (ev == 4) securityLoadState = 0;
                    else if (ev == 1) securityLoadState = 2;
                    else if (ev == 2 && securityLoadState == 2) securityLoadState = 1;
                }
                return propertyResponse(obj, pid, n, start, new byte[] {(byte) securityLoadState});
            }
            case 56 -> {
                if (!write) return propertyResponse(obj, pid, n, start, null);
                toolKey = data.clone();
                // Die Antwort ist schon mit dem neuen Schluessel gesichert (03/05/01 6.3.10.4)
                security.deviceToolKeys().put(tool, toolKey);
                return propertyResponse(obj, pid, n, start, toolKeyAnswerEmpty ? null : toolKey.clone());
            }
            case 53, 54, 61 -> {
                if (!write) return propertyResponse(obj, pid, n, start, null);
                List<byte[]> el = tables.computeIfAbsent(pid, k -> new ArrayList<>());
                if (start == 0) {
                    if ((data[0] | data[1]) == 0) el.clear();
                    return propertyResponse(obj, pid, n, start, new byte[] {0, (byte) el.size()});
                }
                int size = data.length / n;
                for (int i = 0; i < n; i++) {
                    int at = start - 1 + i;
                    while (el.size() <= at) el.add(new byte[size]);
                    el.set(at, Arrays.copyOfRange(data, i * size, (i + 1) * size));
                }
                return propertyResponse(obj, pid, n, start, data.clone());
            }
            default -> {
                return propertyResponse(obj, pid, n, start, null);
            }
        }
    }
}
