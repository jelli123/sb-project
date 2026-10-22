package de.sb.knx.bus;

import de.sb.knx.secure.Certificate;
import de.sb.knx.secure.KeyVault;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

import static de.sb.knx.bus.SecureCommissioningTest.DEV;
import static de.sb.knx.bus.SecureCommissioningTest.FDSK;
import static de.sb.knx.bus.SecureCommissioningTest.SERIAL;
import static de.sb.knx.bus.SecureCommissioningTest.TOOL;
import static de.sb.knx.bus.Steps.step;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Security Proxy (AN192) gegen ein simuliertes Secure-Geraet mit zwei Router-Objekten: die
 * Proxy-Gruppenschluesseltabelle (PID 81) und die Freigaben auf Zeit (PID 83, 84) waehrend
 * eines Downloads.
 */
class ProxyDownloadTest {

    @TempDir
    Path dir;
    KeyVault vault;
    String serial;
    FakeLink[] links;
    SimulatedSecureDevice device;
    BusService bus;

    @BeforeEach
    void setUp() throws Exception {
        vault = new KeyVault(dir);
        vault.unlock("P", "geheim1234".toCharArray(), true);
        serial = vault.putCertificate("P", Certificate.parse(Certificate.format(SERIAL, FDSK)));
        links = FakeLink.pair(TOOL, DEV);
        device = new SimulatedSecureDevice(DEV, TOOL, links[1], links[0], FDSK);
        bus = new BusService(null);
        bus.vault(vault);
        bus.connectLink(links[0]);
        bus.bindKeys("P", Map.of(DEV, serial));
    }

    @AfterEach
    void tearDown() {
        bus.close();
        links[1].close();
    }

    List<Map<String, Object>> plan() {
        List<Map<String, Object>> s = new ArrayList<>();
        s.add(step("op", "secureSync", "serial", serial, "label", "Zugang"));
        s.add(step("op", "secureToolKey", "serial", serial, "label", "Tool Key"));
        s.add(step("op", "secureMode", "on", true, "label", "Security Mode"));
        s.add(step("op", "proxyGroupKeys", "ot", 6, "occ", 0, "label", "Proxy-Gruppenschluessel",
                "entries", List.of(Map.of("ga", "g1", "raw", 0x0A03, "settings", 0x83),
                                   Map.of("ga", "g2", "raw", 0x0A05, "settings", 0x43))));
        return s;
    }

    @Test
    void writesTheProxyGroupKeyTableWithKeysFromTheVault() throws Exception {
        assertDoesNotThrow(() -> Steps.run(bus, DEV, plan(), links[0]),
                () -> "Geraet: " + device.log + "\nBus:\n" + String.join("\n", links[0].trace));
        List<byte[]> t = device.tables.get(81);
        assertEquals(2, t.size());
        assertEquals(19, t.get(0).length);
        assertEquals(0x0A, t.get(0)[0]);
        assertEquals(0x03, t.get(0)[1]);
        assertArrayEquals(vault.groupKey("P", "g1"), Arrays.copyOfRange(t.get(0), 2, 18));
        assertEquals((byte) 0x83, t.get(0)[18]);
        assertArrayEquals(vault.groupKey("P", "g2"), Arrays.copyOfRange(t.get(1), 2, 18));
        assertEquals((byte) 0x43, t.get(1)[18]);
    }

    @Test
    void opensTheProxyForTheDownloadAndClosesItAfterwards() throws Exception {
        Object gates = List.of(Map.of("proxy", DEV.toString(), "partners", List.of("1.1.9"), "ptp", true, "bc", true));
        Map<String, Object> result = assertDoesNotThrow(() -> Steps.run(bus, DEV, plan(), gates, links[0]),
                () -> "Geraet: " + device.log + "\nBus:\n" + String.join("\n", links[0].trace));
        // Oeffnen: White List 1.1.250 <-> 1.1.9, Broadcast und System Broadcast auf beiden Seiten
        assertEquals("6/83/0/11fa11090001", device.gateCalls.get(0));
        assertEquals(List.of("6/84/0/01", "6/84/1/01", "7/84/0/01", "7/84/1/01"), device.gateCalls.subList(1, 5));
        // Schliessen: White List widerrufen, beide Modi aus
        assertEquals("6/83/1/11fa", device.gateCalls.get(5));
        assertEquals(List.of("6/84/0/00", "6/84/1/00", "7/84/0/00", "7/84/1/00"), device.gateCalls.subList(6, 10));
        assertEquals(10, device.gateCalls.size());
        assertTrue(String.valueOf(result.get("notes")).contains("Security Proxy"), String.valueOf(result.get("notes")));
    }
}
