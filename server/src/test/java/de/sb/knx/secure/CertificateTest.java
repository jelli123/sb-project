package de.sb.knx.secure;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class CertificateTest {

    private static final byte[] SERIAL = {0x00, (byte) 0xFA, 0x12, 0x34, 0x56, 0x78};
    /** FDSK der Referenzimplementierung thelsing/knx: 00 01 02 ... 0F. */
    private static final byte[] FDSK = {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15};
    private static final String ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

    @Test
    void formatsSixBlocksOfSix() {
        String text = Certificate.format(SERIAL, FDSK);
        assertEquals("AD5BEN-CWPAAA-CAQDAQ-CQMBYI-BEFAWD-ANBYH6", text);
    }

    @Test
    void parsesWhatItFormats() {
        Certificate c = Certificate.parse(Certificate.format(SERIAL, FDSK));
        assertEquals("00FA12345678", c.serial());
        assertArrayEquals(FDSK, c.fdsk());
    }

    @Test
    void toleratesCaseSpacesAndDashes() {
        Certificate c = Certificate.parse("ad5ben cwpaaa\tcaqdaq-cqmbyi befawd\nanbyh6");
        assertEquals("00FA12345678", c.serial());
    }

    /** Die CRC-4 (x^4 + x + 1) findet jeden Ein-Bit-Fehler der 180 Bit, auch in der Pruefsumme selbst. */
    @Test
    void detectsEverySingleBitError() {
        String plain = Certificate.format(SERIAL, FDSK).replace("-", "");
        for (int i = 0; i < plain.length(); i++) {
            for (int bit = 0; bit < 5; bit++) {
                char wrong = ALPHABET.charAt(ALPHABET.indexOf(plain.charAt(i)) ^ (1 << bit));
                String typo = plain.substring(0, i) + wrong + plain.substring(i + 1);
                int at = i, b = bit;
                assertThrows(IllegalArgumentException.class, () -> Certificate.parse(typo),
                        "Bit " + b + " an Stelle " + at);
            }
        }
    }

    /**
     * Beliebige Ersetzungen eines Zeichens aendern bis zu 5 Bit; davon kann eine 4-Bit-Pruefsumme nicht
     * jede finden. Fuer dieses Zertifikat bleiben 36 von 1116 unerkannt - mehr als 5 % waere ein Fehler.
     */
    @Test
    void detectsAlmostEveryCharacterSubstitution() {
        String plain = Certificate.format(SERIAL, FDSK).replace("-", "");
        int tried = 0, caught = 0;
        for (int i = 0; i < plain.length(); i++) {
            for (int shift = 1; shift < 32; shift++) {
                char wrong = ALPHABET.charAt((ALPHABET.indexOf(plain.charAt(i)) + shift) % 32);
                tried++;
                try {
                    Certificate.parse(plain.substring(0, i) + wrong + plain.substring(i + 1));
                } catch (IllegalArgumentException e) {
                    caught++;
                }
            }
        }
        assertEquals(1116, tried);
        assertTrue(caught >= tried * 95 / 100, caught + " von " + tried);
    }

    @Test
    void rejectsCharactersOutsideBase32WithAHint() {
        String text = Certificate.format(SERIAL, FDSK).replaceFirst("A", "0");
        IllegalArgumentException e = assertThrows(IllegalArgumentException.class, () -> Certificate.parse(text));
        assertTrue(e.getMessage().contains("O"), e.getMessage());
    }

    @Test
    void rejectsWrongLength() {
        String text = Certificate.format(SERIAL, FDSK).replace("-", "");
        IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                () -> Certificate.parse(text.substring(1)));
        assertTrue(e.getMessage().contains("35"), e.getMessage());
        assertThrows(IllegalArgumentException.class, () -> Certificate.parse(null));
        assertThrows(IllegalArgumentException.class, () -> Certificate.parse("A".repeat(300)));
    }

    @Test
    void rejectsZeroSerial() {
        String text = Certificate.format(new byte[6], FDSK);
        assertThrows(IllegalArgumentException.class, () -> Certificate.parse(text));
    }
}
