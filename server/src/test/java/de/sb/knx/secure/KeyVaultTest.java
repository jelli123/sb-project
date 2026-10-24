package de.sb.knx.secure;

import de.sb.knx.json.Json;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.StandardCharsets;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.Base64;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class KeyVaultTest {

    private static final char[] PASSWORD = "geheim1234".toCharArray();
    private static final byte[] SERIAL = {0x00, (byte) 0xFA, 0x12, 0x34, 0x56, 0x78};
    private static final byte[] FDSK = {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15};

    @TempDir
    Path dir;
    KeyVault vault;
    Certificate cert;

    @BeforeEach
    void setUp() throws Exception {
        vault = new KeyVault(dir);
        cert = Certificate.parse(Certificate.format(SERIAL, FDSK));
    }

    private Path file(String project) {
        return dir.resolve("secure").resolve(project + ".keys");
    }

    @Test
    void createsOnlyWhenAsked() {
        assertThrows(IllegalStateException.class, () -> vault.unlock("P", PASSWORD.clone(), false));
        assertFalse(Files.exists(file("P")));
    }

    /** Export nur entsperrt; der Import legt eine vorhandene Ablage beiseite und oeffnet mit dem alten Passwort. */
    @Test
    void exportAndImportCarryTheEncryptedFile() throws Exception {
        vault.unlock("P", PASSWORD.clone(), true);
        vault.putCertificate("P", cert);
        vault.lock("P");
        assertThrows(IllegalStateException.class, () -> vault.exportFile("P"));
        vault.unlock("P", PASSWORD.clone(), false);
        String text = vault.exportFile("P");

        vault.unlock("Q", "anderes1234".toCharArray(), true);
        Map<String, Object> st = vault.importFile("Q", text);
        assertEquals(Boolean.FALSE, st.get("unlocked"));
        try (var files = Files.list(dir.resolve("secure"))) {
            assertEquals(1, files.filter(f -> f.getFileName().toString().startsWith("Q.keys.replaced-")).count());
        }
        assertThrows(IllegalArgumentException.class, () -> vault.unlock("Q", "anderes1234".toCharArray(), false));
        vault.unlock("Q", PASSWORD.clone(), false);
        assertNotNull(vault.device("Q", "00FA12345678").fdsk());
    }

    @Test
    void importRejectsForeignFiles() {
        assertThrows(java.io.IOException.class, () -> vault.importFile("P", "kein json"));
        assertThrows(java.io.IOException.class, () -> vault.importFile("P", "{\"format\":\"sb-projekt-keys\",\"version\":1,"
                + "\"kdf\":\"PBKDF2WithHmacSHA256\",\"iterations\":1000,\"salt\":\"AAAAAAAAAAAAAAAAAAAAAA==\","
                + "\"iv\":\"AAAAAAAAAAAAAAAA\",\"data\":\"AAAAAAAAAAAAAAAAAAAAAA==\"}"));
        assertFalse(Files.exists(file("P")));
    }

    /** Zugaenge fuer KNX IP Secure: einmal erzeugt, bleiben sie ueber Sperren und Passwortwechsel gleich. */
    @Test
    void ipCredentialsArePersistentAndStable() throws Exception {
        vault.unlock("P", PASSWORD.clone(), true);
        KeyVault.IpCreds a = vault.ensureIpCreds("P", "00FA12345678", List.of(0x21F5, 0x21F6));
        assertEquals(2, a.tunnels().size());
        assertEquals(20, a.mgmt().length());
        byte[] bb = vault.backboneKey("P", "224.0.23.12", true);
        vault.lock("P");
        vault.changePassword("P", PASSWORD.clone(), "anderes1234".toCharArray());
        vault.lock("P");
        vault.unlock("P", "anderes1234".toCharArray(), false);
        KeyVault.IpCreds b = vault.ensureIpCreds("P", "00FA12345678", List.of(0x21F5, 0x21F6, 0x21F7));
        assertEquals(a.auth(), b.auth());
        assertEquals(a.mgmt(), b.mgmt());
        assertEquals(a.tunnels().get(0x21F5), b.tunnels().get(0x21F5));
        assertEquals(3, b.tunnels().size());
        assertArrayEquals(bb, vault.backboneKey("P", "224.0.23.12", false));
        assertNull(vault.backboneKey("P", "239.1.2.3", false));
        assertThrows(IllegalArgumentException.class, () -> vault.backboneKey("P", "10.0.0.1", true));
    }

    @Test
    void refusesShortPasswords() {
        assertThrows(IllegalArgumentException.class, () -> vault.unlock("P", "kurz".toCharArray(), true));
    }

    @Test
    void lockedVaultRefusesAccess() throws Exception {
        vault.unlock("P", PASSWORD.clone(), true);
        vault.putCertificate("P", cert);
        vault.lock("P");
        assertThrows(IllegalStateException.class, () -> vault.device("P", "00FA12345678"));
        assertFalse(vault.unlocked("P"));
    }

    @Test
    void wrongPasswordIsRejected() throws Exception {
        vault.unlock("P", PASSWORD.clone(), true);
        vault.lock("P");
        IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                () -> vault.unlock("P", "falsch12345".toCharArray(), false));
        assertTrue(e.getMessage().contains("Passwort falsch"), e.getMessage());
    }

    /** Der Tool Key ist vorgemerkt, bevor er das Geraet erreicht, und bleibt es ueber das Sperren hinweg. */
    @Test
    void pendingToolKeySurvivesReopenAndIsConfirmed() throws Exception {
        vault.unlock("P", PASSWORD.clone(), true);
        assertEquals("00FA12345678", vault.putCertificate("P", cert));
        byte[] pending = vault.newPendingToolKey("P", "00FA12345678");
        vault.lock("P");
        vault.unlock("P", PASSWORD.clone(), false);

        KeyVault.DeviceKeys k = vault.device("P", "00FA12345678");
        assertArrayEquals(FDSK, k.fdsk());
        assertArrayEquals(pending, k.pending());
        assertNull(k.toolKey());

        vault.confirmToolKey("P", "00FA12345678", pending);
        k = vault.device("P", "00FA12345678");
        assertArrayEquals(pending, k.toolKey());
        assertNull(k.pending());
    }

    @Test
    void newToolKeyDiffersFromFdskAndPredecessor() throws Exception {
        vault.unlock("P", PASSWORD.clone(), true);
        vault.putCertificate("P", cert);
        byte[] first = vault.newPendingToolKey("P", "00FA12345678");
        vault.confirmToolKey("P", "00FA12345678", first);
        byte[] second = vault.newPendingToolKey("P", "00FA12345678");
        assertFalse(java.util.Arrays.equals(first, second));
        assertFalse(java.util.Arrays.equals(FDSK, second));
    }

    @Test
    void groupKeyIsCreatedOnceAndKept() throws Exception {
        vault.unlock("P", PASSWORD.clone(), true);
        byte[] g = vault.groupKey("P", "g12");
        assertEquals(16, g.length);
        vault.lock("P");
        vault.unlock("P", PASSWORD.clone(), false);
        assertArrayEquals(g, vault.groupKey("P", "g12"));
        assertThrows(IllegalArgumentException.class, () -> vault.groupKey("P", "../x"));
    }

    @Test
    void removingTheCertificateKeepsTheToolKey() throws Exception {
        vault.unlock("P", PASSWORD.clone(), true);
        vault.putCertificate("P", cert);
        byte[] key = vault.newPendingToolKey("P", "00FA12345678");
        vault.confirmToolKey("P", "00FA12345678", key);
        vault.removeCertificate("P", "00FA12345678");
        KeyVault.DeviceKeys k = vault.device("P", "00FA12345678");
        assertNull(k.fdsk());
        assertArrayEquals(key, k.toolKey());
    }

    @Test
    void passwordChangeKeepsTheContent() throws Exception {
        vault.unlock("P", PASSWORD.clone(), true);
        vault.putCertificate("P", cert);
        vault.changePassword("P", PASSWORD.clone(), "neuesPasswort".toCharArray());
        vault.lock("P");
        assertThrows(IllegalArgumentException.class, () -> vault.unlock("P", PASSWORD.clone(), false));
        vault.unlock("P", "neuesPasswort".toCharArray(), false);
        assertArrayEquals(FDSK, vault.device("P", "00FA12345678").fdsk());
    }

    /** Weder FDSK noch Seriennummer duerfen im Klartext in der Datei stehen; lesbar nur fuer den Benutzer. */
    @Test
    void fileHoldsNoPlaintextAndIsPrivate() throws Exception {
        vault.unlock("P", PASSWORD.clone(), true);
        vault.putCertificate("P", cert);
        String text = Files.readString(file("P"), StandardCharsets.UTF_8);
        assertFalse(text.contains("000102030405060708090A0B0C0D0E0F"));
        assertFalse(text.contains("00FA12345678"));
        if (FileSystems.getDefault().supportedFileAttributeViews().contains("posix")) {
            assertEquals("rw-------", PosixFilePermissions.toString(Files.getPosixFilePermissions(file("P"))));
        }
    }

    @Test
    void statusTellsOnlyWhetherKeysExist() throws Exception {
        vault.unlock("P", PASSWORD.clone(), true);
        vault.putCertificate("P", cert);
        vault.groupKey("P", "g1");
        Map<String, Object> status = vault.status("P");
        String json = Json.write(status);
        assertFalse(json.contains("000102030405060708090A0B0C0D0E0F"), json);
        assertTrue(json.contains("\"fdsk\":true"), json);
        assertEquals(List.of("g1"), status.get("groups"));
    }

    @Test
    void tamperedFileIsRejected() throws Exception {
        vault.unlock("P", PASSWORD.clone(), true);
        vault.putCertificate("P", cert);
        vault.lock("P");
        Map<String, Object> env = Json.parseObject(Files.readString(file("P")));
        byte[] data = Base64.getDecoder().decode((String) env.get("data"));
        data[0] ^= 1;
        env.put("data", Base64.getEncoder().encodeToString(data));
        Files.writeString(file("P"), Json.write(env));
        assertThrows(IllegalArgumentException.class, () -> vault.unlock("P", PASSWORD.clone(), false));
    }

    /** Eine fremde Datei darf die Schluesselableitung weder abschwaechen noch den Dienst minutenlang beschaeftigen. */
    @Test
    void implausibleKeyDerivationIsRejected() throws Exception {
        vault.unlock("P", PASSWORD.clone(), true);
        vault.lock("P");
        Map<String, Object> env = Json.parseObject(Files.readString(file("P")));
        env.put("iterations", 10);
        Files.writeString(file("P"), Json.write(env));
        assertThrows(java.io.IOException.class, () -> vault.unlock("P", PASSWORD.clone(), false));
    }

    @Test
    void renameMovesAndRetireSetsAside() throws Exception {
        vault.unlock("P1", PASSWORD.clone(), true);
        vault.putCertificate("P1", cert);
        vault.rename("P1", "P2");
        assertFalse(Files.exists(file("P1")));
        assertTrue(Files.exists(file("P2")));
        assertNotNull(vault.device("P2", "00FA12345678"));

        vault.retire("P2");
        assertFalse(Files.exists(file("P2")));
        assertTrue(Files.exists(dir.resolve("secure").resolve("P2.keys.deleted")));
    }

    @Test
    void projectIdsCannotLeaveTheStore() throws Exception {
        vault.unlock("../../etc", PASSWORD.clone(), true);
        try (var files = Files.list(dir.resolve("secure"))) {
            assertTrue(files.anyMatch(p -> p.getFileName().toString().endsWith(".keys")));
        }
        assertFalse(Files.exists(dir.getParent().resolve("etc.keys")));
    }
}
