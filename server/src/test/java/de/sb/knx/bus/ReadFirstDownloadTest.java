package de.sb.knx.bus;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import tuwien.auto.calimero.IndividualAddress;

import java.util.Arrays;
import java.util.List;
import java.util.Map;

import static de.sb.knx.bus.Steps.hex;
import static de.sb.knx.bus.Steps.step;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Speicher mit Pruefung: jeder Block wird vorab gelesen, und was das Geraet schon enthaelt, wird
 * weder geschrieben noch zurueckgelesen. Neuer oder geloeschter Speicher faellt nach wenigen
 * Bloecken ohne Treffer auf einfaches Schreiben zurueck.
 */
class ReadFirstDownloadTest {

    static final IndividualAddress TOOL = new IndividualAddress(1, 1, 250);
    static final IndividualAddress DEV = new IndividualAddress(1, 1, 5);
    static final int ADDR = 0x4400;
    /** 40 Bloecke zu 12 Oktetten. */
    static final byte[] DATA = new byte[480];

    static {
        for (int i = 0; i < DATA.length; i++) DATA[i] = (byte) (i * 7 + 3);
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

    Map<String, Object> run(boolean verify) throws Exception {
        List<Map<String, Object>> steps = List.of(step("op", "writeMem", "addr", ADDR, "data", hex(DATA),
                "verify", verify, "label", "Applikation schreiben"));
        return Steps.run(bus, DEV, steps, links[0]);
    }

    @Test
    void unchangedMemoryIsOnlyRead() throws Exception {
        System.arraycopy(DATA, 0, device.memory, ADDR, DATA.length);
        Map<String, Object> r = run(true);
        assertEquals(0, device.standardWrites);
        assertEquals(40, device.standardReads);
        assertEquals(0L, r.get("bytes"));
        assertEquals((long) DATA.length, r.get("unchanged"));
    }

    @Test
    void onlyChangedBlocksAreWritten() throws Exception {
        System.arraycopy(DATA, 0, device.memory, ADDR, DATA.length);
        device.memory[ADDR + 5] ^= 0x40;             // Block 0
        device.memory[ADDR + 12 * 17 + 11] ^= 0x01;  // Block 17
        Map<String, Object> r = run(true);
        assertEquals(2, device.standardWrites);
        assertEquals(40 + 2, device.standardReads);   // je Block vorab, dazu die Pruefung der beiden
        assertEquals(24L, r.get("bytes"));
        assertArrayEquals(DATA, Arrays.copyOfRange(device.memory, ADDR, ADDR + DATA.length));
    }

    @Test
    void freshMemoryStopsReadingAhead() throws Exception {
        Map<String, Object> r = run(true);
        assertEquals(40, device.standardWrites);
        assertEquals(8 + 40, device.standardReads);   // acht Bloecke ohne Treffer, dann nur noch die Pruefung
        assertEquals((long) DATA.length, r.get("bytes"));
        assertEquals(0L, r.get("unchanged"));
        assertArrayEquals(DATA, Arrays.copyOfRange(device.memory, ADDR, ADDR + DATA.length));
    }

    @Test
    void withoutVerifyNothingIsRead() throws Exception {
        System.arraycopy(DATA, 0, device.memory, ADDR, DATA.length);
        run(false);
        assertEquals(40, device.standardWrites);
        assertEquals(0, device.standardReads);
    }
}
