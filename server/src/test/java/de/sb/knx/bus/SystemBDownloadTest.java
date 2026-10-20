package de.sb.knx.bus;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import tuwien.auto.calimero.IndividualAddress;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutionException;

import static de.sb.knx.bus.Steps.allocate;
import static de.sb.knx.bus.Steps.hex;
import static de.sb.knx.bus.Steps.lsm;
import static de.sb.knx.bus.Steps.step;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Download in ein System-B-Geraet mit relativen Segmenten: Zuteilung ueber die Load State Machine,
 * Schreiben relativ zu PID_TABLE_REFERENCE, Programmkennung, Pruefsumme aus PID_MCB_TABLE und der
 * Teil-Download, der nur gilt, solange das Geraet den Block an derselben Stelle laesst.
 * Der Plan entspricht dem, den knx-download.js fuer den MDT Glastaster II bildet, mit eigenen Daten.
 */
class SystemBDownloadTest {

    static final IndividualAddress TOOL = new IndividualAddress(1, 1, 250);
    static final IndividualAddress DEV = new IndividualAddress(1, 1, 5);

    /** Objekttypen und -indizes von System B (knx_master.xml, MV-07B0). */
    static final int ADDR = 1, ASSOC = 2, GROUP_OBJECTS = 9, APP = 3;

    static final byte[] APPLICATION = new byte[498];
    static final byte[] ADDRESS_TABLE = {0x00, 0x03, 0x08, 0x01, 0x08, 0x02, 0x08, 0x03};
    static final byte[] ASSOCIATIONS = {0x00, 0x03, 0, 1, 0, 1, 0, 2, 0, 2, 0, 3, 0, 3};
    static final byte[] OBJECT_TABLE = {0x00, 0x03, 0x4F, 0x00, (byte) 0xD7, 0x00, 0x47, 0x00};
    static final String PROGRAM_VERSION = "008304C110";

    static {
        for (int i = 0; i < APPLICATION.length; i++) APPLICATION[i] = (byte) (i * 31 + 7);
    }

    FakeLink[] links;
    SimulatedSystemBDevice device;
    BusService bus;

    @BeforeEach
    void setUp() throws Exception {
        links = FakeLink.pair(TOOL, DEV);
        device = new SimulatedSystemBDevice(DEV, TOOL, links[1]);
        bus = new BusService(null);
        bus.connectLink(links[0]);
    }

    @AfterEach
    void tearDown() {
        bus.close();
        links[1].close();
    }

    static Map<String, Object> writeRel(int index, byte[] data, boolean verify) {
        return step("op", "writeRelMem", "oi", index, "offset", 0, "data", hex(data), "verify", verify,
                "label", data.length + " Byte schreiben");
    }

    static Map<String, Object> checksum(int index, byte[] data) {
        return step("op", "loadImageProp", "oi", index, "pid", 27, "start", 1, "count", 1,
                "expectSize", data.length, "expectCrc", SimulatedDevice.crc16(data), "label", "Property 27 lesen");
    }

    /** Vollstaendig: alles entladen, zuteilen, relativ schreiben, abschliessen, Pruefsummen lesen, Neustart. */
    static List<Map<String, Object>> full(boolean verifyApplication) {
        List<Map<String, Object>> s = new ArrayList<>();
        s.add(step("op", "checkMask", "masks", List.of(0x07B0), "label", "Maske"));
        s.add(step("op", "authorize", "key", "FFFFFFFF", "label", "Anmelden"));
        for (int ot : new int[] {APP, GROUP_OBJECTS, ASSOC, ADDR}) s.add(lsm(ot, 4, 0, "entladen"));
        s.add(lsm(APP, 1, 2, "Laden beginnen"));
        s.add(step("op", "compareProp", "oi", 0, "pid", 78, "start", 1, "count", 1, "data", "008300000428", "label", "Hardware"));
        // LdCtrlMapError: dieser Vergleich passt nicht, darf aber nicht abbrechen
        s.add(step("op", "compareProp", "oi", 0, "pid", 78, "start", 1, "count", 1, "data", "FFFF00000000",
                "tolerate", true, "label", "toleriert"));
        s.add(allocate(APP, APPLICATION.length, true));
        s.add(lsm(GROUP_OBJECTS, 1, 2, "Laden beginnen"));
        s.add(allocate(GROUP_OBJECTS, OBJECT_TABLE.length, false));
        s.add(lsm(ADDR, 1, 2, "Laden beginnen"));
        s.add(allocate(ADDR, ADDRESS_TABLE.length, false));
        s.add(lsm(ASSOC, 1, 2, "Laden beginnen"));
        s.add(allocate(ASSOC, ASSOCIATIONS.length, false));
        s.add(writeRel(4, APPLICATION, verifyApplication));
        s.add(writeRel(3, OBJECT_TABLE, true));
        s.add(writeRel(2, ASSOCIATIONS, true));
        s.add(writeRel(1, ADDRESS_TABLE, true));
        s.add(step("op", "writeProp", "oi", 4, "pid", 13, "start", 1, "count", 1, "data", PROGRAM_VERSION,
                "verify", true, "label", "Programmkennung"));
        for (int ot : new int[] {APP, GROUP_OBJECTS, ASSOC, ADDR}) s.add(lsm(ot, 2, 1, "Laden abschliessen"));
        s.add(checksum(1, ADDRESS_TABLE));
        s.add(checksum(2, ASSOCIATIONS));
        s.add(checksum(3, OBJECT_TABLE));
        s.add(checksum(4, APPLICATION));
        s.add(step("op", "restart", "label", "Neustart"));
        return s;
    }

    /** Nur Parameter: PID 7 vorher ins Abbild, nach dem Neuzuteilen gegen das Abbild vergleichen (MV-07B0 "par"). */
    static List<Map<String, Object>> partial() {
        List<Map<String, Object>> s = new ArrayList<>();
        s.add(step("op", "loadImageProp", "oi", 4, "pid", 7, "start", 1, "count", 1, "label", "Property 7 lesen"));
        s.add(lsm(APP, 4, 0, "entladen"));
        s.add(lsm(APP, 1, 2, "Laden beginnen"));
        s.add(allocate(APP, APPLICATION.length, false));
        s.add(step("op", "compareProp", "oi", 4, "pid", 7, "start", 1, "count", 1, "data", "00000000", "image", true,
                "label", "Lage pruefen"));
        s.add(writeRel(4, APPLICATION, true));
        s.add(lsm(APP, 2, 1, "Laden abschliessen"));
        s.add(checksum(4, APPLICATION));
        s.add(step("op", "restart", "label", "Neustart"));
        return s;
    }

    Map<String, Object> run(List<Map<String, Object>> steps) throws Exception {
        return Steps.run(bus, DEV, steps, links[0]);
    }

    byte[] block(int index, int length) {
        SimulatedSystemBDevice.Obj o = device.objects[index];
        return Arrays.copyOfRange(device.memory, o.ref, o.ref + length);
    }

    @Test
    void fullDownloadWritesEveryBlockWhereTheDeviceAllocatedIt() throws Exception {
        Map<String, Object> result = run(full(true));
        assertArrayEquals(APPLICATION, block(4, APPLICATION.length));
        assertArrayEquals(OBJECT_TABLE, block(3, OBJECT_TABLE.length));
        assertArrayEquals(ASSOCIATIONS, block(2, ASSOCIATIONS.length));
        assertArrayEquals(ADDRESS_TABLE, block(1, ADDRESS_TABLE.length));
        for (int i = 1; i <= 4; i++) assertEquals(1, device.objects[i].state, "Objekt " + i + " geladen");
        assertEquals(PROGRAM_VERSION, hex(device.objects[4].version).toUpperCase());
        assertTrue(device.restarted);

        String notes = String.valueOf(result.get("notes"));
        assertTrue(notes.contains("toleriert") && notes.contains("uebergangen"), notes);
        assertTrue(!notes.contains("Pruefsumme") && !notes.contains("Segmentgroesse"), notes);
    }

    /** Die Applikation beginnt bei FFF0h: unterhalb schreibt Calimero A_Memory_Write, darueber die erweiterten Dienste. */
    @Test
    void writesAcrossThe64KiBBoundary() throws Exception {
        run(full(true));
        assertTrue(device.standardWrites > 0, "A_Memory_Write");
        assertTrue(device.extendedWrites > 0, "A_MemoryExtended_Write");
    }

    @Test
    void reportsAChecksumThatDoesNotMatch() throws Exception {
        device.faultyAddress = 0xFFF0 + 100;
        Map<String, Object> result = run(full(false));
        assertTrue(String.valueOf(result.get("notes")).contains("Pruefsumme von Objekt 4"), String.valueOf(result.get("notes")));
    }

    @Test
    void verifyCatchesAWrongByte() {
        device.faultyAddress = 0xFFF0 + 100;
        ExecutionException e = assertThrows(ExecutionException.class, () -> run(full(true)));
        assertTrue(e.getCause().getMessage().contains("Pruefung"), e.getCause().getMessage());
    }

    @Test
    void partialDownloadReloadsTheApplicationInPlace() throws Exception {
        run(full(true));
        Arrays.fill(device.memory, 0xFFF0, 0xFFF0 + APPLICATION.length, (byte) 0);
        run(partial());
        assertArrayEquals(APPLICATION, block(4, APPLICATION.length));
        assertEquals(1, device.objects[4].state);
    }

    @Test
    void partialDownloadAbortsWhenTheDeviceMovesTheBlock() throws Exception {
        run(full(true));
        device.objects[4].base = 0x8000;
        ExecutionException e = assertThrows(ExecutionException.class, () -> run(partial()));
        assertTrue(e.getCause().getMessage().contains("neu zugeteilt"), e.getCause().getMessage());
    }

    @Test
    void refusesToWriteWithoutAllocation() {
        List<Map<String, Object>> s = List.of(lsm(APP, 4, 0, "entladen"), lsm(APP, 1, 2, "Laden beginnen"),
                writeRel(4, APPLICATION, false));
        ExecutionException e = assertThrows(ExecutionException.class, () -> run(s));
        assertTrue(e.getCause().getMessage().contains("keinen Speicher zugeteilt"), e.getCause().getMessage());
    }

    @Test
    void unloadLeavesEveryObjectUnloaded() throws Exception {
        run(full(true));
        List<Map<String, Object>> s = new ArrayList<>();
        for (int ot : new int[] {ADDR, ASSOC, GROUP_OBJECTS, APP}) s.add(lsm(ot, 4, 0, "entladen"));
        run(s);
        for (int i = 1; i <= 4; i++) {
            assertEquals(0, device.objects[i].state);
            assertEquals(0, device.objects[i].ref, "PID_TABLE_REFERENCE nach dem Entladen 0 (03/05/01 4.2.7)");
        }
    }
}
