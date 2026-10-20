package de.sb.knx.secure;

import java.util.Arrays;
import java.util.Locale;

/**
 * Geraetezertifikat eines KNX-Secure-Geraets: KNX-Seriennummer und FDSK (Factory Default Setup Key),
 * wie sie als Text oder QR-Code auf dem Geraet bzw. seinem Beipackzettel stehen.
 * <p>
 * Aufbau: 6 Oktette Seriennummer, 16 Oktette FDSK und eine 4-Bit-Pruefsumme CRC-4 (x^4 + x + 1)
 * ueber diese 22 Oktette - zusammen 180 Bit, also 36 Zeichen Base32 (RFC 4648, Alphabet A-Z 2-7),
 * ueblich in sechs Bloecken zu sechs Zeichen. Die Festlegung steht in AN158 "KNX Data Security",
 * das in docs/ nicht vorliegt; der Aufbau folgt der Referenzimplementierung, mit der die ETS
 * die Zertifikate annimmt (thelsing/knx, examples/knx-linux/fdsk.cpp). 03/05/01 6.1 sagt nur,
 * dass der FDSK beim Geraet beiliegt und ueber den Bus nie lesbar ist.
 */
public final class Certificate {

    public static final int CHARS = 36;

    private static final String ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    private static final int[] CRC4 = {0x0, 0x3, 0x6, 0x5, 0xC, 0xF, 0xA, 0x9, 0xB, 0x8, 0xD, 0xE, 0x7, 0x4, 0x1, 0x2};

    private final byte[] serial;
    private final byte[] fdsk;

    private Certificate(byte[] serial, byte[] fdsk) {
        this.serial = serial;
        this.fdsk = fdsk;
    }

    /** Seriennummer als 12 Hexzeichen in Grossbuchstaben, wie sie das Projekt fuehrt. */
    public String serial() {
        return hex(serial);
    }

    public byte[] fdsk() {
        return fdsk.clone();
    }

    /**
     * Liest ein Zertifikat. Trenner, Leerzeichen und Kleinschreibung werden toleriert, sonst nichts:
     * 0, 1, 8 und 9 kommen in Base32 nicht vor, und eine falsche Pruefsumme heisst Tippfehler.
     */
    public static Certificate parse(String text) {
        if (text == null) throw new IllegalArgumentException("Zertifikat fehlt");
        if (text.length() > 200) throw new IllegalArgumentException("Zertifikat ist zu lang");
        StringBuilder sb = new StringBuilder(CHARS);
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c == '-' || c == ' ' || c == '\t' || c == '\n' || c == '\r') continue;
            char u = Character.toUpperCase(c);
            if (ALPHABET.indexOf(u) < 0) {
                throw new IllegalArgumentException("Zeichen „" + c + "“ kommt im Zertifikat nicht vor"
                        + (c == '0' || c == '1' || c == '8' ? " - gemeint ist vermutlich O, I/L bzw. B" : "") + ".");
            }
            sb.append(u);
        }
        if (sb.length() != CHARS) {
            throw new IllegalArgumentException("Das Zertifikat hat " + CHARS + " Zeichen (6 Bloecke zu 6), eingegeben "
                    + sb.length() + ".");
        }
        // 36 Zeichen zu 5 Bit = 180 Bit: 176 Bit Nutzdaten, 4 Bit Pruefsumme
        byte[] bits = new byte[23];
        int acc = 0, n = 0, out = 0;
        for (int i = 0; i < CHARS; i++) {
            acc = (acc << 5) | ALPHABET.indexOf(sb.charAt(i));
            n += 5;
            if (n >= 8) {
                bits[out++] = (byte) (acc >> (n - 8));
                n -= 8;
            }
        }
        bits[out] = (byte) (acc << (8 - n));                // die letzten 4 Bit, linksbuendig
        byte[] payload = Arrays.copyOf(bits, 22);
        int crc = (bits[22] >> 4) & 0x0F;
        if (crc != crc4(payload)) {
            throw new IllegalArgumentException("Pruefsumme des Zertifikats stimmt nicht - bitte auf Tippfehler pruefen.");
        }
        byte[] serial = Arrays.copyOfRange(payload, 0, 6);
        byte[] fdsk = Arrays.copyOfRange(payload, 6, 22);
        if (allZero(serial)) throw new IllegalArgumentException("Das Zertifikat nennt keine Seriennummer.");
        return new Certificate(serial, fdsk);
    }

    /** Gegenstueck zu {@link #parse}, mit Bindestrichen nach je sechs Zeichen. */
    public static String format(byte[] serial, byte[] fdsk) {
        if (serial.length != 6 || fdsk.length != 16) throw new IllegalArgumentException("6 + 16 Oktette erwartet");
        byte[] data = new byte[23];
        System.arraycopy(serial, 0, data, 0, 6);
        System.arraycopy(fdsk, 0, data, 6, 16);
        data[22] = (byte) (crc4(Arrays.copyOf(data, 22)) << 4);
        StringBuilder sb = new StringBuilder();
        int acc = 0, n = 0;
        for (byte b : data) {
            acc = (acc << 8) | (b & 0xFF);
            n += 8;
            while (n >= 5 && sb.length() < CHARS) {
                sb.append(ALPHABET.charAt((acc >> (n - 5)) & 0x1F));
                n -= 5;
            }
        }
        StringBuilder grouped = new StringBuilder();
        for (int i = 0; i < CHARS; i++) {
            if (i > 0 && i % 6 == 0) grouped.append('-');
            grouped.append(sb.charAt(i));
        }
        return grouped.toString();
    }

    static int crc4(byte[] data) {
        int c = 0;
        for (byte b : data) {
            c = CRC4[c ^ ((b >> 4) & 0x0F)];
            c = CRC4[c ^ (b & 0x0F)];
        }
        return c;
    }

    private static boolean allZero(byte[] b) {
        for (byte x : b) if (x != 0) return false;
        return true;
    }

    static String hex(byte[] data) {
        StringBuilder sb = new StringBuilder(data.length * 2);
        for (byte b : data) sb.append(String.format(Locale.ROOT, "%02X", b));
        return sb.toString();
    }
}
