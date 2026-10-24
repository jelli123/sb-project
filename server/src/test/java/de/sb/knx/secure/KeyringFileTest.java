package de.sb.knx.secure;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Was wir schreiben, muss Calimeros Keyring-Leser (das Verfahren der ETS) verstehen - samt Signatur. */
class KeyringFileTest {

    @TempDir
    Path dir;

    private static byte[] key(int seed) {
        byte[] k = new byte[16];
        for (int i = 0; i < 16; i++) k[i] = (byte) (seed + i);
        return k;
    }

    @Test
    void roundTripThroughCalimero() throws Exception {
        int router = 0x2100, t1 = 0x21F5, t2 = 0x21F6;
        KeyringFile.Content c = new KeyringFile.Content("224.0.23.12", 2000, key(1),
                List.of(new KeyringFile.Device(router, key(2), "verwaltung-ÄÖ", "geraet-auth",
                        List.of(new KeyringFile.Tunnel(t1, 2, "tunnel1"), new KeyringFile.Tunnel(t2, 3, "ein-längeres-passwort-x")))),
                Map.of(0x0801, key(3), 0x1002, key(4)));
        String xml = KeyringFile.write("Test-Projekt", "Keyring123".toCharArray(), c);
        assertTrue(xml.contains("xmlns=\"http://knx.org/xml/keyring/1\""), xml);

        KeyringFile.Content r = KeyringFile.read(xml, "Keyring123".toCharArray(), dir);
        assertEquals("224.0.23.12", r.multicast());
        assertEquals(2000, r.latencyMs());
        assertArrayEquals(key(1), r.backboneKey());
        assertEquals(1, r.devices().size());
        KeyringFile.Device d = r.devices().get(0);
        assertEquals(router, d.address());
        assertArrayEquals(key(2), d.toolKey());
        assertEquals("verwaltung-ÄÖ", d.managementPassword());
        assertEquals("geraet-auth", d.authentication());
        assertEquals(2, d.tunnels().size());
        assertEquals(new KeyringFile.Tunnel(t2, 3, "ein-längeres-passwort-x"),
                d.tunnels().stream().filter(t -> t.address() == t2).findFirst().orElseThrow());
        assertArrayEquals(key(3), r.groups().get(0x0801));
        assertArrayEquals(key(4), r.groups().get(0x1002));
    }

    @Test
    void wrongPasswordFailsAtTheSignature() throws Exception {
        KeyringFile.Content c = new KeyringFile.Content(null, 0, null, List.of(), Map.of(0x0801, key(3)));
        String xml = KeyringFile.write("P", "richtig123".toCharArray(), c);
        assertThrows(IllegalArgumentException.class, () -> KeyringFile.read(xml, "falsch1234".toCharArray(), dir));
    }

    /** Eine veraenderte Datei faellt auf, auch wenn das Passwort stimmt. */
    @Test
    void tamperingFailsAtTheSignature() throws Exception {
        KeyringFile.Content c = new KeyringFile.Content(null, 0, null,
                List.of(new KeyringFile.Device(0x2100, key(2), null, null, List.of())), Map.of());
        String xml = KeyringFile.write("P", "richtig123".toCharArray(), c).replace("IndividualAddress=\"2.1.0\"", "IndividualAddress=\"2.1.9\"");
        assertThrows(IllegalArgumentException.class, () -> KeyringFile.read(xml, "richtig123".toCharArray(), dir));
    }
}
