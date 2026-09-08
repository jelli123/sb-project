package de.sb.knx.bus;

import de.sb.knx.json.Json;
import tuwien.auto.calimero.IndividualAddress;
import tuwien.auto.calimero.KNXException;
import tuwien.auto.calimero.SerialNumber;
import tuwien.auto.calimero.mgmt.ManagementClient.EraseCode;
import tuwien.auto.calimero.mgmt.PropertyAccess.PID;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.BiConsumer;

/** Stufe 2 und 3: physikalische Adresse vergeben sowie Neustart und Entladen. */
public final class Commissioning {

    private final BusService bus;

    public Commissioning(BusService bus) {
        this.bus = bus;
    }

    /* ---------------- Busscan (Stufe 1) ---------------- */

    /**
     * Sucht alle Teilnehmer einer Linie. Calimero fragt dabei die Geraetebeschreibung ab,
     * das ist der einzige Dienst, den jedes Geraet unabhaengig vom Profil beantwortet.
     */
    public List<Map<String, Object>> scanLine(int area, int line, BiConsumer<String, String> progress)
            throws KNXException, InterruptedException {
        List<Map<String, Object>> found = new ArrayList<>();
        bus.procedures().scanNetworkDevices(area, line,
                address -> progress.accept("gefunden", address.toString()),
                (address, descriptor) -> {
                    Map<String, Object> m = Json.obj();
                    m.put("address", address.toString());
                    if (descriptor != null) {
                        m.put("maskVersion", String.format("%04X", descriptor.maskVersion()));
                        m.put("profile", descriptor.deviceProfile());
                        m.put("mediumType", descriptor.mediumType());
                    }
                    found.add(m);
                });
        return found;
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
        m.put("message", ok
                ? "Adresse " + newAddress + " vergeben."
                : "Adresse nicht vergeben - kein oder mehr als ein Geraet im Programmiermodus, "
                        + "oder die Adresse ist bereits belegt.");
        return m;
    }

    /** Vergibt die Adresse anhand der Seriennummer - ohne Programmiertaster am Geraet. */
    public Map<String, Object> assignAddressViaSerial(SerialNumber serial, IndividualAddress newAddress)
            throws KNXException, InterruptedException {
        boolean ok = bus.procedures().writeAddress(serial, newAddress);
        Map<String, Object> m = Json.obj();
        m.put("ok", ok);
        m.put("address", newAddress.toString());
        m.put("serial", serial.toString());
        m.put("message", ok
                ? "Adresse " + newAddress + " an Seriennummer " + serial + " vergeben."
                : "Adresse nicht vergeben - Geraet mit dieser Seriennummer antwortet nicht.");
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
     */
    public Map<String, Object> masterReset(IndividualAddress address, EraseCode code, int channel)
            throws KNXException, InterruptedException {
        return bus.withDestination(address, d -> {
            Duration processTime = bus.client().restart(d, code, channel);
            Map<String, Object> m = Json.obj();
            m.put("ok", true);
            m.put("eraseCode", code.name());
            m.put("channel", channel);
            m.put("processTimeSeconds", processTime == null ? null : processTime.toSeconds());
            m.put("message", "Master-Reset " + code.name() + " an " + address + " ausgefuehrt.");
            return m;
        });
    }

    /**
     * Entlaedt einen ladbaren Teil ueber die Load State Machine.
     * Das Ereignis Unload ist 04h und der Schreibwert immer 10 Oktett lang (03/05/01, Tabelle 93).
     */
    public Map<String, Object> unload(IndividualAddress address, int objectIndex)
            throws KNXException, InterruptedException {
        return bus.withDestination(address, d -> {
            bus.client().writeProperty(d, objectIndex, PID.LOAD_STATE_CONTROL, 1, 1,
                    Knx.loadEvent(Knx.LOAD_EVENT_UNLOAD));
            byte[] state = bus.client().readProperty(d, objectIndex, PID.LOAD_STATE_CONTROL, 1, 1);
            int value = Knx.unsigned(state);
            Map<String, Object> m = Json.obj();
            m.put("ok", value == 0);
            m.put("objectIndex", objectIndex);
            m.put("loadState", value);
            m.put("loadStateName", Knx.loadState(value));
            m.put("message", value == 0
                    ? "Objekt " + objectIndex + " an " + address + " ist entladen."
                    : "Objekt " + objectIndex + " meldet nach dem Entladen den Zustand " + Knx.loadState(value) + ".");
            return m;
        });
    }

    public Map<String, Object> loadState(IndividualAddress address, int objectIndex)
            throws KNXException, InterruptedException {
        return bus.withDestination(address, d -> {
            byte[] load = bus.client().readProperty(d, objectIndex, PID.LOAD_STATE_CONTROL, 1, 1);
            int value = Knx.unsigned(load);
            Map<String, Object> m = Json.obj();
            m.put("objectIndex", objectIndex);
            m.put("loadState", value);
            m.put("loadStateName", Knx.loadState(value));
            return m;
        });
    }
}
