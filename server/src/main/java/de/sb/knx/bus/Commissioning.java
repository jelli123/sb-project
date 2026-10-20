package de.sb.knx.bus;

import de.sb.knx.json.Json;
import tuwien.auto.calimero.DeviceDescriptor;
import tuwien.auto.calimero.IndividualAddress;
import tuwien.auto.calimero.KNXException;
import tuwien.auto.calimero.KNXRemoteException;
import tuwien.auto.calimero.KNXTimeoutException;
import tuwien.auto.calimero.SerialNumber;
import tuwien.auto.calimero.mgmt.Destination;
import tuwien.auto.calimero.mgmt.ManagementClient.EraseCode;
import tuwien.auto.calimero.mgmt.PropertyAccess.PID;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.BiConsumer;

/** Stufe 2 und 3: physikalische Adresse vergeben sowie Neustart und Entladen. */
public final class Commissioning {

    /** Obergrenze fuer die Suche nach einem Interface-Objekt; kein Geraet fuehrt annaehernd so viele. */
    private static final int MAX_OBJECTS = 32;

    private final BusService bus;

    public Commissioning(BusService bus) {
        this.bus = bus;
    }

    /* ---------------- Busscan (Stufe 1) ---------------- */

    /**
     * Sucht alle Teilnehmer einer Linie.
     * <p>
     * Calimero meldet zwei getrennte Ereignisse: zuerst, dass sich unter einer
     * Adresse ueberhaupt etwas gemeldet hat, und spaeter - vielleicht - die
     * gelesene Geraetebeschreibung. Beides wird uebernommen, und zwar
     * unabhaengig voneinander: geht die Beschreibung auf dem Bus verloren,
     * bleibt der Teilnehmer trotzdem im Ergebnis, nur eben ohne Maske.
     * <p>
     * Frueher stand der Eintrag nur im zweiten Ereignis. Ein Geraet, das
     * geantwortet hat, dessen DeviceDescriptorRead aber unterging, blitzte
     * dann als "gefunden" in der Laufanzeige auf und fehlte anschliessend in
     * der Liste - genau der Fall, der bei einer ueberlasteten Schnittstelle
     * eintritt. Ein gefundener Teilnehmer ohne Maske ist immer noch die
     * Wahrheit; ein verschwundener ist es nicht.
     * <p>
     * Die Rueckmeldungen kommen aus Calimeros Zustellstrang, das Sammeln muss
     * darum nebenlaeufig sicher sein.
     */
    public List<Map<String, Object>> scanLine(int area, int line, BiConsumer<String, String> progress)
            throws KNXException, InterruptedException {
        Map<String, Map<String, Object>> found = new ConcurrentHashMap<>();
        // Der Scan fragt nur, wer antwortet. Gesichert muesste er sich mit jedem Secure-Geraet erst
        // synchronisieren - bei 256 Adressen im Takt von 115 ms waere das Zeit- und Buslast ohne Nutzen.
        // Ein Geraet im Security Mode meldet unverschluesselt den Device Descriptor FFFFh (AN193 2.2.4.5).
        SecureLayer secure = bus.secure();
        secure.plainOnly(true);
        try {
            scan(area, line, found, progress);
        } finally {
            secure.plainOnly(false);
        }
        // Nach Teilnehmernummer, nicht als Text: sonst stuende 1.1.10 vor 1.1.3.
        List<Map<String, Object>> out = new ArrayList<>(found.values());
        out.sort(Comparator.comparingInt(m -> deviceOf(String.valueOf(m.get("address")))));
        return out;
    }

    private void scan(int area, int line, Map<String, Map<String, Object>> found, BiConsumer<String, String> progress)
            throws KNXException, InterruptedException {
        bus.procedures().scanNetworkDevices(area, line,
                address -> {
                    entryFor(found, address);
                    progress.accept("gefunden", address.toString());
                },
                (address, descriptor) -> {
                    Map<String, Object> m = entryFor(found, address);
                    if (descriptor != null) {
                        synchronized (m) {
                            m.put("maskVersion", String.format("%04X", descriptor.maskVersion()));
                            m.put("profile", descriptor.deviceProfile());
                            m.put("mediumType", descriptor.mediumType());
                            if (descriptor.maskVersion() == 0xFFFF) m.put("secured", true);
                        }
                    }
                });
    }

    private static Map<String, Object> entryFor(Map<String, Map<String, Object>> found, IndividualAddress address) {
        return found.computeIfAbsent(address.toString(), a -> {
            Map<String, Object> m = Json.obj();
            m.put("address", a);
            return m;
        });
    }

    /** Der letzte Teil einer Adresse "1.1.3"; unbrauchbare Angaben wandern ans Ende. */
    private static int deviceOf(String address) {
        int dot = address.lastIndexOf('.');
        try {
            return Integer.parseInt(address.substring(dot + 1));
        } catch (RuntimeException e) {
            return Integer.MAX_VALUE;
        }
    }

    public List<String> scanRouters() throws KNXException, InterruptedException {
        List<String> out = new ArrayList<>();
        for (IndividualAddress a : bus.procedures().scanNetworkRouters()) out.add(a.toString());
        return out;
    }

    public boolean isAddressOccupied(IndividualAddress address) throws KNXException, InterruptedException {
        return bus.procedures().isAddressOccupied(address);
    }

    /* ---------------- Programmiermodus ---------------- */

    /** Liefert alle Geraete, die gerade im Programmiermodus sind (Broadcast A_IndividualAddress_Read). */
    public List<String> devicesInProgrammingMode() throws KNXException, InterruptedException {
        List<String> out = new ArrayList<>();
        for (IndividualAddress a : bus.procedures().readAddress()) out.add(a.toString());
        return out;
    }

    public void setProgrammingMode(IndividualAddress address, boolean on)
            throws KNXException, InterruptedException {
        bus.procedures().setProgrammingMode(address, on);
    }

    /* ---------------- Stufe 2: Adresse vergeben ---------------- */

    /**
     * Vergibt die Adresse an das eine Geraet, das im Programmiermodus ist.
     * Calimero fuehrt die vollstaendige Prozedur nach 03/05/02 aus: pruefen, dass genau ein
     * Geraet antwortet, dass die Zieladresse frei ist, schreiben, Neustart und Nachkontrolle.
     */
    public Map<String, Object> assignAddressViaProgrammingMode(IndividualAddress newAddress)
            throws KNXException, InterruptedException {
        boolean ok = bus.procedures().writeAddress(newAddress);
        Map<String, Object> m = Json.obj();
        m.put("ok", ok);
        m.put("address", newAddress.toString());
        // Die Prozedur hat vorher gefragt, wer im Programmiermodus ist - das ist die alte Adresse.
        IndividualAddress[] before = bus.client().lastInProgrammingMode();
        if (ok && before.length == 1) m.put("previousAddress", before[0].toString());
        m.put("message", ok
                ? "Adresse " + newAddress + " vergeben."
                : "Adresse nicht vergeben - kein oder mehr als ein Geraet im Programmiermodus, "
                        + "oder die Adresse ist bereits belegt.");
        return m;
    }

    /**
     * Vergibt die Adresse anhand der Seriennummer - ohne Programmiertaster am Geraet.
     * <p>
     * Anders als beim Weg ueber den Programmiermodus endet Calimeros Prozedur hier
     * nach Schreiben und Zuruecklesen; der Neustart, den die ETS anschliessend
     * ausloest, fehlt. Er wird darum hier nachgeholt, an die neue Adresse. Scheitert
     * er, bleibt die Vergabe trotzdem gueltig - die Adresse steht im Geraet und ist
     * zurueckgelesen - und die Meldung sagt, dass von Hand neu zu starten ist.
     */
    public Map<String, Object> assignAddressViaSerial(SerialNumber serial, IndividualAddress newAddress)
            throws KNXException, InterruptedException {
        boolean ok = bus.procedures().writeAddress(serial, newAddress);
        Map<String, Object> m = Json.obj();
        m.put("ok", ok);
        m.put("address", newAddress.toString());
        m.put("serial", serial.toString());
        if (!ok) {
            m.put("message", "Adresse nicht vergeben - Geraet mit dieser Seriennummer antwortet nicht.");
            return m;
        }
        String restartProblem = null;
        try {
            bus.withDestination(newAddress, d -> {
                bus.client().restart(d);
                return null;
            });
        } catch (KNXException e) {
            restartProblem = e.getMessage();
        }
        m.put("restarted", restartProblem == null);
        m.put("message", restartProblem == null
                ? "Adresse " + newAddress + " an Seriennummer " + serial + " vergeben, Geraet neu gestartet."
                : "Adresse " + newAddress + " an Seriennummer " + serial + " vergeben, der Neustart schlug aber fehl ("
                        + restartProblem + ") - bitte das Geraet neu starten.");
        return m;
    }

    /* ---------------- Stufe 3: Neustart und Entladen ---------------- */

    public Map<String, Object> restart(IndividualAddress address) throws KNXException, InterruptedException {
        return bus.withDestination(address, d -> {
            bus.client().restart(d);
            Map<String, Object> m = Json.obj();
            m.put("ok", true);
            m.put("message", "Neustart an " + address + " gesendet.");
            return m;
        });
    }

    /**
     * Master-Reset mit Loeschcode. Nur System B und neuer beantworten das; aeltere Geraete
     * melden einen Fehler, dann bleibt nur der einfache Neustart oder das Entladen.
     * <p>
     * Manche Geraete starten neu, bevor ihre Antwort den Bus erreicht - so der KNX-Stack von
     * thelsing, der die Antwort nur einreiht und sofort neu startet. Bleibt die Antwort aus, ist
     * der Befehl also nicht unbedingt gescheitert; die Meldung sagt dann genau das.
     */
    public Map<String, Object> masterReset(IndividualAddress address, EraseCode code, int channel)
            throws KNXException, InterruptedException {
        return bus.withDestination(address, d -> {
            Map<String, Object> m = Json.obj();
            m.put("eraseCode", code.name());
            m.put("channel", channel);
            Duration processTime;
            // Ruecksetzen in den Werkszustand macht den FDSK wieder gueltig und hebt die Sequenznummer
            // fuer den Werkzeugzugang an (03/05/01 6.1.4, 6.2) - beim naechsten Zugriff wird neu
            // synchronisiert, zuerst mit dem FDSK. Die Antwort selbst kommt noch mit dem Tool Key (6.3.10.4).
            boolean toDefault = code == EraseCode.FactoryReset || code == EraseCode.FactoryResetWithoutIndividualAddress;
            try {
                processTime = bus.client().restart(d, code, channel);
            } catch (KNXTimeoutException e) {
                bus.secure().invalidate(address, toDefault);
                m.put("ok", false);
                m.put("confirmed", false);
                m.put("message", "Master-Reset " + code.name() + " an " + address + " gesendet, aber nicht bestaetigt. "
                        + "Das Geraet kann trotzdem neu gestartet sein - ob der Loeschcode umgesetzt wurde, "
                        + "zeigt erst der Ladezustand.");
                return m;
            }
            bus.secure().invalidate(address, toDefault);
            m.put("ok", true);
            m.put("confirmed", true);
            m.put("processTimeSeconds", processTime == null ? null : processTime.toSeconds());
            m.put("message", "Master-Reset " + code.name() + " an " + address + " vom Geraet bestaetigt.");
            return m;
        });
    }

    /**
     * Entlaedt einen ladbaren Teil. Wie, haengt vom Geraetemodell ab (Maske aus dem Device Descriptor):
     * <ul>
     * <li>BCU1 (0010h-0013h) kennt keine Load State Machine. Entladen heisst dort wie in der Maskendefinition:
     *     Laufzeitfehler-Flags 010Dh = 00h und Adresstabellenlaenge 0116h = 01h.</li>
     * <li>BIM M112 mit 0700h/0701h fuehrt die Load State Machines im Speicher: 11 Oktette an 0104h,
     *     erstes Oktett LSM-Nummer und Ereignis, Zustand ab B6EAh (03/05/02 3.31.2).</li>
     * <li>Alle anderen ueber PID_LOAD_STATE_CONTROL mit 10 Oktetten (03/05/02 3.31.3).</li>
     * </ul>
     * Unloading ist ein Zwischenzustand; bis zu 30 s wird nachgelesen (03/05/01 4.23.2).
     */
    public Map<String, Object> unload(IndividualAddress address, int objectType)
            throws KNXException, InterruptedException {
        return bus.withDestination(address, d -> {
            int mask = mask(d);
            Map<String, Object> m = Json.obj();
            m.put("objectType", objectType);
            m.put("maskVersion", String.format("%04X", mask));
            if (Knx.isBcu1(mask)) {
                bus.client().writeMemory(d, Knx.BCU1_RUN_ERROR, new byte[] {0});
                bus.client().writeMemory(d, Knx.BCU1_ADDRTAB_SIZE, new byte[] {1});
                m.put("ok", true);
                m.put("message", address + " (BCU1): Applikation angehalten und Adresstabelle geleert. "
                        + "Realisierungstyp 1 hat keine Load State Machine; die Objektwahl spielt keine Rolle.");
                return m;
            }
            String what = Knx.objectType(objectType);
            int value;
            if (Knx.hasMemoryMappedLsm(mask)) {
                value = memoryLsm(d, memoryLsmNumber(objectType), Knx.LOAD_EVENT_UNLOAD);
            } else {
                int index = objectIndex(d, objectType);
                m.put("objectIndex", index);
                what += " (Objekt " + index + ")";
                value = propertyLsm(d, index, Knx.LOAD_EVENT_UNLOAD);
            }
            m.put("ok", value == 0);
            m.put("loadState", value);
            m.put("loadStateName", Knx.loadState(value));
            m.put("message", value == 0
                    ? what + " an " + address + " ist entladen."
                    : what + " an " + address + " meldet nach dem Entladen den Zustand " + Knx.loadState(value) + ".");
            return m;
        });
    }

    public Map<String, Object> loadState(IndividualAddress address, int objectType)
            throws KNXException, InterruptedException {
        return bus.withDestination(address, d -> {
            int mask = mask(d);
            Map<String, Object> m = Json.obj();
            m.put("objectType", objectType);
            m.put("objectTypeName", Knx.objectType(objectType));
            m.put("maskVersion", String.format("%04X", mask));
            if (Knx.isBcu1(mask)) {
                // Ersatzweise: laeuft die Applikation und ist die Adresstabelle belegt?
                int runError = Knx.unsigned(bus.client().readMemory(d, Knx.BCU1_RUN_ERROR, 1));
                int entries = Knx.unsigned(bus.client().readMemory(d, Knx.BCU1_ADDRTAB_SIZE, 1));
                m.put("loadState", -1);
                m.put("loadStateName", "BCU1 ohne Load State Machine - Laufzeitfehler "
                        + String.format("%02X", runError) + "h, Adresstabelle " + entries + " Eintraege");
                return m;
            }
            int value;
            if (Knx.hasMemoryMappedLsm(mask)) {
                value = Knx.unsigned(bus.client().readMemory(d,
                        Knx.M112_LOAD_STATE_BASE + memoryLsmNumber(objectType), 1));
            } else {
                int index = objectIndex(d, objectType);
                m.put("objectIndex", index);
                value = Knx.unsigned(bus.client().readProperty(d, index, PID.LOAD_STATE_CONTROL, 1, 1));
            }
            m.put("loadState", value);
            m.put("loadStateName", Knx.loadState(value));
            return m;
        });
    }

    /**
     * Sucht das Interface-Objekt eines Typs. Die Reihenfolge der Objekte legt das Geraet fest:
     * bei einem gewoehnlichen System-B-Geraet ist Index 3 das Applikationsprogramm, bei einem
     * KNXnet/IP-Router (Maske 091Ah) dagegen der IP-Parameter, das Programm steht dort auf 2.
     */
    private int objectIndex(Destination d, int objectType) throws KNXException, InterruptedException {
        for (int index = 0; index < MAX_OBJECTS; index++) {
            byte[] type;
            try {
                type = bus.client().readProperty(d, index, PID.OBJECT_TYPE, 1, 1);
            } catch (KNXRemoteException e) {
                break; // Das Geraet kennt keinen weiteren Index.
            }
            if (Knx.unsigned(type) == objectType) return index;
        }
        throw new IllegalArgumentException("Das Geraet hat kein Objekt vom Typ " + Knx.objectType(objectType) + ".");
    }

    /** BIM M112 nummeriert die Load State Machines wie die Objekttypen: 1 Adress-, 2 Zuordnungstabelle, 3 Programm, 4 PEI. */
    private static int memoryLsmNumber(int objectType) {
        if (objectType < 1 || objectType > 4)
            throw new IllegalArgumentException("Dieses Geraet fuehrt fuer " + Knx.objectType(objectType)
                    + " keine Load State Machine.");
        return objectType;
    }

    private int mask(Destination d) throws KNXException, InterruptedException {
        return DeviceDescriptor.DD0.from(bus.client().readDeviceDesc(d, 0)).maskVersion();
    }

    private int memoryLsm(Destination d, int lsm, int event) throws KNXException, InterruptedException {
        if (lsm < 1 || lsm > 15) throw new IllegalArgumentException("Speicherabgebildete LSM-Nummer ist 1 bis 15");
        byte[] data = new byte[11];
        data[0] = (byte) ((lsm << 4) | event);
        bus.client().writeMemory(d, Knx.M112_LOAD_CONTROL, data);
        return pollState(() -> Knx.unsigned(bus.client().readMemory(d, Knx.M112_LOAD_STATE_BASE + lsm, 1)));
    }

    private int propertyLsm(Destination d, int objectIndex, int event) throws KNXException, InterruptedException {
        byte[] res = bus.client().writeControlProperty(d, objectIndex, PID.LOAD_STATE_CONTROL, 1, 1,
                Knx.loadEvent(event));
        int state = res.length > 0 ? res[0] & 0xFF : -1;
        if (state >= 0 && state != 4 && state != 5) return state;
        return pollState(() -> Knx.unsigned(bus.client().readProperty(d, objectIndex, PID.LOAD_STATE_CONTROL, 1, 1)));
    }

    interface StateReader {
        int read() throws KNXException, InterruptedException;
    }

    /** Zwischenzustaende Unloading (4) und LoadCompleting (5) abwarten, hoechstens 30 s. */
    private static int pollState(StateReader reader) throws KNXException, InterruptedException {
        long until = System.currentTimeMillis() + 30_000;
        int value = reader.read();
        while ((value == 4 || value == 5) && System.currentTimeMillis() < until) {
            Thread.sleep(1_000);
            value = reader.read();
        }
        return value;
    }
}
