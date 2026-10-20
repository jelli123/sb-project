package de.sb.knx.bus;

import de.sb.knx.secure.Certificate;
import de.sb.knx.secure.KeyVault;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tuwien.auto.calimero.IndividualAddress;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutionException;

import static de.sb.knx.bus.Steps.lsm;
import static de.sb.knx.bus.Steps.step;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Secure-Inbetriebnahme gegen ein Geraet, dessen Secure Application Layer Calimero stellt:
 * FDSK ab Werk, Tool Key setzen, Security Mode, Tabellen des Security-Objekts (03/05/01 6.3),
 * Werkszustand am Geraet und eine verlorene Antwort beim Schluesselwechsel.
 */
class SecureCommissioningTest {

    static final IndividualAddress TOOL = new IndividualAddress(1, 1, 250);
    static final IndividualAddress DEV = new IndividualAddress(1, 1, 5);
    static final byte[] SERIAL = {0x00, (byte) 0xFA, 0x12, 0x34, 0x56, 0x78};
    static final byte[] FDSK = {(byte) 0xA0, (byte) 0xA1, (byte) 0xA2, (byte) 0xA3, (byte) 0xA4, (byte) 0xA5, (byte) 0xA6,
            (byte) 0xA7, (byte) 0xA8, (byte) 0xA9, (byte) 0xAA, (byte) 0xAB, (byte) 0xAC, (byte) 0xAD, (byte) 0xAE, (byte) 0xAF};

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

    /** Ablauf wie im Plan aus knx-download.js: Zugang, Tool Key, Security Mode, dann das Security-Objekt (AN209). */
    List<Map<String, Object>> plan() {
        List<Map<String, Object>> s = new ArrayList<>();
        s.add(step("op", "secureSync", "serial", serial, "label", "Zugang"));
        s.add(step("op", "secureToolKey", "serial", serial, "label", "Tool Key"));
        s.add(step("op", "secureMode", "on", true, "label", "Security Mode"));
        s.add(lsm(17, 4, 0, "entladen"));
        s.add(lsm(17, 1, 2, "Laden beginnen"));
        s.add(step("op", "writeProp", "ot", 17, "occ", 0, "pid", 54, "start", 0, "count", 1, "data", "0000",
                "loose", true, "label", "IA-Tabelle leeren"));
        s.add(step("op", "writeProp", "ot", 17, "occ", 0, "pid", 54, "start", 1, "count", 2,
                "data", "11060000000000001107000000000000", "loose", true, "label", "IA-Tabelle"));
        s.add(step("op", "secureGroupKeys", "entries", List.of(Map.of("tsap", 1, "ga", "g1"), Map.of("tsap", 3, "ga", "g7")),
                "label", "Gruppenschluessel"));
        s.add(step("op", "writeProp", "ot", 17, "occ", 0, "pid", 61, "start", 0, "count", 1, "data", "0000",
                "loose", true, "label", "GO-Flags leeren"));
        s.add(step("op", "writeProp", "ot", 17, "occ", 0, "pid", 61, "start", 1, "count", 12,
                "data", "030300000000000000000003", "loose", true, "label", "GO-Flags"));
        s.add(lsm(17, 2, 1, "Laden abschliessen"));
        return s;
    }

    Map<String, Object> download() throws Exception {
        return Steps.run(bus, DEV, plan(), links[0]);
    }

    /** Ein Lauf, der gelingen muss; scheitert er, stehen das Protokoll des Geraets und alle Rahmen in der Meldung. */
    Map<String, Object> commission() {
        return assertDoesNotThrow(this::download,
                () -> "Geraet: " + device.log + "\nBus:\n" + String.join("\n", links[0].trace));
    }

    @Test
    void firstCommissioningSetsToolKeySecurityModeAndTables() throws Exception {
        Map<String, Object> result = commission();
        KeyVault.DeviceKeys k = vault.device("P", serial);
        assertNotNull(k.toolKey());
        assertNull(k.pending());
        assertArrayEquals(k.toolKey(), device.toolKey, "Geraet und Ablage kennen denselben Tool Key");
        assertFalse(Arrays.equals(FDSK, device.toolKey));
        assertTrue(device.securityMode);
        assertEquals(1, device.securityLoadState);

        List<byte[]> keys = device.tables.get(53);
        assertEquals(2, keys.size());
        assertEquals(1, keys.get(0)[1]);
        assertEquals(3, keys.get(1)[1]);
        assertArrayEquals(vault.groupKey("P", "g1"), Arrays.copyOfRange(keys.get(0), 2, 18));
        assertEquals(2, device.tables.get(54).size());
        assertEquals(12, device.tables.get(61).size());
        assertTrue(String.valueOf(result.get("notes")).contains("Tool Key"), String.valueOf(result.get("notes")));
    }

    @Test
    void secondDownloadKeepsTheToolKey() throws Exception {
        commission();
        byte[] first = device.toolKey.clone();
        bus.bindKeys("P", Map.of(DEV, serial));
        commission();
        assertArrayEquals(first, device.toolKey);
    }

    @Test
    void refusesWithoutBoundKeys() {
        bus.bindKeys("P", Map.of());
        ExecutionException e = assertThrows(ExecutionException.class, this::download);
        assertTrue(e.getCause().getMessage().contains("keine Secure-Schluessel"), e.getCause().getMessage());
        assertNull(device.toolKey);
    }

    @Test
    void refusesWhileTheVaultIsLocked() {
        vault.lock("P");
        bus.bindKeys("P", Map.of(DEV, serial));
        assertThrows(ExecutionException.class, this::download);
        assertNull(device.toolKey);
    }

    /** Werkszustand am Geraet: der Tool Key passt nicht mehr, der FDSK schon (03/05/02 4.2, NOTE 19). */
    @Test
    void findsTheDeviceAgainAfterAFactoryReset() throws Exception {
        commission();
        byte[] first = device.toolKey.clone();
        device.factoryReset();
        bus.bindKeys("P", Map.of(DEV, serial));
        Map<String, Object> result = commission();
        assertNotNull(device.toolKey);
        assertFalse(Arrays.equals(first, device.toolKey), "neuer Tool Key, nie der alte (03/05/01 6.3.10.5)");
        assertArrayEquals(device.toolKey, vault.device("P", serial).toolKey());
        assertTrue(String.valueOf(result.get("notes")).contains("FDSK"), String.valueOf(result.get("notes")));
    }

    /** Eine Sync-Antwort, deren MAC nicht stimmt, heisst: das Geraet kennt den Schluessel - nochmal, nicht weiter zum naechsten. */
    @Test
    void synchronisesAgainAfterAnUnreadableAnswer() {
        device.garbleSyncAnswers = 1;
        long t0 = System.nanoTime();
        commission();
        assertEquals(2, device.log.stream().filter("sync"::equals).count(), String.valueOf(device.log));
        assertTrue(device.log.contains("Sync-Antwort verfaelscht"));
        assertTrue((System.nanoTime() - t0) / 1_000_000 < 5_000, "ohne die 6 s Wartezeit auf eine Antwort, die nicht kommt");
    }

    /** Die Antwort auf das Schreiben des Tool Keys geht verloren: die Synchronisation klaert, welcher gilt. */
    @Test
    void resolvesALostToolKeyAnswer() throws Exception {
        device.toolKeyAnswerEmpty = false;
        device.dropToolKeyAnswer = true;
        commission();
        assertTrue(device.log.contains("Antwort verloren"));
        KeyVault.DeviceKeys k = vault.device("P", serial);
        assertArrayEquals(device.toolKey, k.toolKey());
        assertNull(k.pending());
    }
}
