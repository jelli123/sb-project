package de.sb.knx.bus;

import de.sb.knx.json.Json;
import tuwien.auto.calimero.DeviceDescriptor;
import tuwien.auto.calimero.IndividualAddress;
import tuwien.auto.calimero.KNXException;
import tuwien.auto.calimero.mgmt.Destination;
import tuwien.auto.calimero.mgmt.KNXDisconnectException;
import tuwien.auto.calimero.mgmt.PropertyAccess.PID;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Stufe 1: liest aus, was ein Geraet ueber sich preisgibt - ohne etwas zu veraendern.
 * Neuere Geraete antworten ueber Properties, Realisierungstyp 1 (BCU1) nur ueber Speicher.
 */
public final class DeviceInfoReader {

    private final BusService bus;

    public DeviceInfoReader(BusService bus) {
        this.bus = bus;
    }

    public Map<String, Object> read(IndividualAddress address) throws KNXException, InterruptedException {
        return bus.withDestination(address, d -> {
            Map<String, Object> out = Json.obj();
            out.put("address", address.toString());

            DeviceDescriptor.DD0 dd0 = null;
            byte[] raw = bus.client().readDeviceDesc(d, 0);
            if (raw != null && raw.length >= 2) {
                dd0 = DeviceDescriptor.DD0.from(raw);
                Map<String, Object> descriptor = Json.obj();
                descriptor.put("raw", Knx.hex(raw));
                descriptor.put("maskVersion", String.format("%04X", dd0.maskVersion()));
                descriptor.put("profile", dd0.deviceProfile());
                descriptor.put("mediumType", dd0.mediumType());
                descriptor.put("firmwareType", dd0.firmwareType());
                descriptor.put("firmwareVersion", dd0.firmwareVersion());
                descriptor.put("firmwareSubcode", dd0.firmwareSubcode());
                out.put("descriptor", descriptor);
            }

            List<Integer> objectTypes = interfaceObjects(d);
            out.put("interfaceObjects", describeObjects(objectTypes));

            boolean properties = readDeviceObject(d, out);
            out.put("propertyAccess", properties);

            int appIndex = indexOfType(objectTypes, Knx.OT_APPLICATION_PROGRAM);
            if (properties && appIndex >= 0) {
                out.put("applicationProgram", readApplicationObject(d, appIndex));
            }

            // Realisierungstyp 1 kennt keine Properties; die Kennung liegt fest im Systemspeicher.
            if (!properties && dd0 != null && dd0.maskVersion() < 0x0020) {
                out.put("legacy", readBcu1(d));
            }
            return out;
        });
    }

    private boolean readDeviceObject(Destination d, Map<String, Object> out)
            throws KNXDisconnectException {
        Map<String, Object> device = Json.obj();
        byte[] manufacturer = property(d, 0, PID.MANUFACTURER_ID);
        byte[] serial = property(d, 0, PID.SERIAL_NUMBER);
        byte[] order = property(d, 0, PID.ORDER_INFO);
        byte[] progVersion = property(d, 0, PID.PROGRAM_VERSION);
        byte[] apdu = property(d, 0, PID.MAX_APDULENGTH);
        byte[] progMode = property(d, 0, PID.PROGMODE);
        byte[] control = property(d, 0, PID.DEVICE_CONTROL);
        byte[] peiType = property(d, 0, PID.PEI_TYPE);
        byte[] firmware = property(d, 0, PID.FIRMWARE_REVISION);
        byte[] description = property(d, 0, PID.DESCRIPTION);

        if (manufacturer == null && serial == null && progVersion == null && apdu == null) return false;

        device.put("manufacturerId", manufacturer == null ? null : Knx.unsigned(manufacturer));
        device.put("serialNumber", Knx.hex(serial));
        device.put("orderInfo", Knx.ascii(order));
        device.put("orderInfoRaw", Knx.hex(order));
        device.put("maxApduLength", apdu == null ? null : Knx.unsigned(apdu));
        device.put("peiType", peiType == null ? null : Knx.unsigned(peiType));
        device.put("firmwareRevision", firmware == null ? null : Knx.unsigned(firmware));
        device.put("description", Knx.ascii(description));
        if (progMode != null) device.put("programmingMode", (Knx.unsigned(progMode) & 0x01) != 0);
        if (control != null) device.put("deviceControl", deviceControl(Knx.unsigned(control)));
        if (progVersion != null) device.put("programVersion", programVersion(progVersion));
        out.put("device", device);
        return true;
    }

    private Map<String, Object> readApplicationObject(Destination d, int index) throws KNXDisconnectException {
        Map<String, Object> app = Json.obj();
        app.put("objectIndex", index);
        byte[] version = property(d, index, PID.PROGRAM_VERSION);
        byte[] load = property(d, index, PID.LOAD_STATE_CONTROL);
        byte[] run = property(d, index, PID.RUN_STATE_CONTROL);
        if (version != null) app.put("programVersion", programVersion(version));
        if (load != null) {
            app.put("loadState", Knx.unsigned(load));
            app.put("loadStateName", Knx.loadState(Knx.unsigned(load)));
        }
        if (run != null) {
            app.put("runState", Knx.unsigned(run));
            app.put("runStateName", Knx.runState(Knx.unsigned(run)));
        }
        return app;
    }

    private Map<String, Object> readBcu1(Destination d) throws KNXDisconnectException {
        Map<String, Object> legacy = Json.obj();
        // 0103h..0107h hat dasselbe Format wie PID_PROGRAM_VERSION: Hersteller, Geraetetyp, Version.
        byte[] id = memory(d, Knx.BCU1_PROGRAM_VERSION, 5);
        byte[] pei = memory(d, Knx.BCU1_PEI_TYPE, 1);
        byte[] runError = memory(d, Knx.BCU1_RUN_ERROR, 1);
        byte[] addrTab = memory(d, Knx.BCU1_ADDRTAB_SIZE, 1);
        if (id != null) legacy.put("programVersion", programVersion(id));
        if (pei != null) legacy.put("peiType", Knx.unsigned(pei));
        if (runError != null) legacy.put("runError", String.format("%02X", Knx.unsigned(runError)));
        if (addrTab != null) legacy.put("addressTableEntries", Knx.unsigned(addrTab));
        legacy.put("note", "Realisierungstyp 1 (BCU1) - Angaben aus dem Systemspeicher gelesen");
        return legacy;
    }

    /** Objektliste ueber PID_IO_LIST; faellt auf Abtasten der ersten Indizes zurueck. */
    private List<Integer> interfaceObjects(Destination d) throws KNXDisconnectException {
        List<Integer> types = new ArrayList<>();
        byte[] count = property(d, 0, PID.IO_LIST, 0, 1);
        if (count != null) {
            int n = Knx.unsigned(count);
            if (n > 0 && n <= 64) {
                byte[] list = property(d, 0, PID.IO_LIST, 1, n);
                if (list != null && list.length >= n * 2) {
                    for (int i = 0; i < n; i++) {
                        types.add(((list[i * 2] & 0xFF) << 8) | (list[i * 2 + 1] & 0xFF));
                    }
                    return types;
                }
            }
        }
        for (int index = 0; index < 12; index++) {
            byte[] type = property(d, index, PID.OBJECT_TYPE);
            if (type == null) break;
            types.add(Knx.unsigned(type));
        }
        return types;
    }

    private static List<Map<String, Object>> describeObjects(List<Integer> types) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (int i = 0; i < types.size(); i++) {
            Map<String, Object> m = Json.obj();
            m.put("index", i);
            m.put("type", types.get(i));
            m.put("name", Knx.objectType(types.get(i)));
            out.add(m);
        }
        return out;
    }

    static int indexOfType(List<Integer> types, int objectType) {
        return types.indexOf(objectType);
    }

    private static Map<String, Object> programVersion(byte[] v) {
        Map<String, Object> m = new LinkedHashMap<>();
        if (v.length >= 5) {
            m.put("manufacturerId", ((v[0] & 0xFF) << 8) | (v[1] & 0xFF));
            m.put("deviceType", ((v[2] & 0xFF) << 8) | (v[3] & 0xFF));
            m.put("version", v[4] & 0xFF);
        }
        m.put("raw", Knx.hex(v));
        return m;
    }

    private static List<String> deviceControl(int bits) {
        List<String> flags = new ArrayList<>();
        if ((bits & 0x01) != 0) flags.add("Anwenderprogramm gestoppt");
        if ((bits & 0x02) != 0) flags.add("Adressdopplung erkannt");
        if ((bits & 0x04) != 0) flags.add("Verify-Modus aktiv");
        if ((bits & 0x08) != 0) flags.add("Safe State");
        return flags;
    }

    /* ---------------- Einzelzugriffe, die scheitern duerfen ---------------- */

    private byte[] property(Destination d, int objectIndex, int pid) throws KNXDisconnectException {
        return property(d, objectIndex, pid, 1, 1);
    }

    private byte[] property(Destination d, int objectIndex, int pid, int start, int elements)
            throws KNXDisconnectException {
        try {
            return bus.client().readProperty(d, objectIndex, pid, start, elements);
        } catch (KNXDisconnectException e) {
            throw e;
        } catch (KNXException e) {
            return null;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return null;
        }
    }

    private byte[] memory(Destination d, int address, int bytes) throws KNXDisconnectException {
        try {
            return bus.client().readMemory(d, address, bytes);
        } catch (KNXDisconnectException e) {
            throw e;
        } catch (KNXException e) {
            return null;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return null;
        }
    }
}
