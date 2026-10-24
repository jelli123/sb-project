package de.sb.knx.secure;

import tuwien.auto.calimero.GroupAddress;
import tuwien.auto.calimero.IndividualAddress;
import tuwien.auto.calimero.secure.Keyring;

import javax.crypto.Cipher;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * Keyring im Format der ETS ({@code .knxkeys}), damit andere Werkzeuge - Visualisierungen, Home
 * Assistant, die ETS selbst - mit gesicherten Tunneln und Gruppenadressen arbeiten koennen.
 * <p>
 * Aufbau und Verschluesselung folgen dem, was Calimero liest ({@link Keyring}): Schluessel und
 * Passwoerter AES-128-CBC mit {@code PBKDF2-HMAC-SHA256(Passwort, "1.keyring.ets.knx.org", 65536)},
 * IV aus SHA-256 des Attributs {@code Created}; Passwoerter mit 8 Zufallsoktetten davor und
 * Fuellung nach PKCS#7. Die Signatur ist SHA-256 ueber die Elemente und ihre sortierten Attribute.
 */
public final class KeyringFile {

    private static final String NAMESPACE = "http://knx.org/xml/keyring/1";
    private static final byte[] SALT = "1.keyring.ets.knx.org".getBytes(StandardCharsets.US_ASCII);
    private static final SecureRandom RNG = new SecureRandom();

    private KeyringFile() {}

    /** Ein Tunnel einer IP-Schnittstelle: Adresse, Benutzer und dessen Passwort. */
    public record Tunnel(int address, int user, String password) {}

    /** Ein Geraet im Keyring. Fehlende Werte ({@code null}) bleiben weg. */
    public record Device(int address, byte[] toolKey, String managementPassword, String authentication,
                         List<Tunnel> tunnels) {}

    /** Inhalt eines Keyrings mit Schluesseln im Klartext - nur im Speicher des Dienstes. */
    public record Content(String multicast, int latencyMs, byte[] backboneKey, List<Device> devices,
                          Map<Integer, byte[]> groups) {}

    /* ---------------- Schreiben ---------------- */

    public static String write(String project, char[] password, Content c) throws GeneralSecurityException {
        String created = LocalDateTime.now().truncatedTo(ChronoUnit.SECONDS).format(DateTimeFormatter.ISO_LOCAL_DATE_TIME);
        byte[] pwdHash = pbkdf2(password, SALT);
        byte[] iv = sha256(created.getBytes(StandardCharsets.UTF_8));
        try {
            List<Element> body = new ArrayList<>();
            if (c.backboneKey() != null) {
                body.add(new Element("Backbone", attrs("MulticastAddress", c.multicast(),
                        "Latency", String.valueOf(c.latencyMs()), "Key", key(c.backboneKey(), pwdHash, iv))));
            }
            for (Device d : c.devices()) {
                for (Tunnel t : d.tunnels()) {
                    body.add(new Element("Interface", attrs("Type", "Tunneling", "Host", ia(d.address()),
                            "IndividualAddress", ia(t.address()), "UserID", String.valueOf(t.user()),
                            "Password", t.password() == null ? null : password(t.password(), pwdHash, iv),
                            "Authentication", d.authentication() == null ? null : password(d.authentication(), pwdHash, iv))));
                }
            }
            if (!c.groups().isEmpty()) {
                Element g = new Element("GroupAddresses", attrs());
                c.groups().forEach((raw, k) -> g.children.add(new Element("Group",
                        attrs("Address", String.valueOf(raw), "Key", sneaky(() -> key(k, pwdHash, iv))))));
                body.add(g);
            }
            if (!c.devices().isEmpty()) {
                Element devs = new Element("Devices", attrs());
                for (Device d : c.devices()) {
                    devs.children.add(new Element("Device", attrs("IndividualAddress", ia(d.address()),
                            "ToolKey", d.toolKey() == null ? null : key(d.toolKey(), pwdHash, iv),
                            "SequenceNumber", "0",
                            "ManagementPassword", d.managementPassword() == null ? null : password(d.managementPassword(), pwdHash, iv),
                            "Authentication", d.authentication() == null ? null : password(d.authentication(), pwdHash, iv))));
                }
                body.add(devs);
            }
            Element root = new Element("Keyring", attrs("Project", project, "CreatedBy", "sb-projekt", "Created", created));
            root.children.addAll(body);

            ByteArrayOutputStream sig = new ByteArrayOutputStream();
            root.sign(sig);
            appendString(Base64.getEncoder().encode(pwdHash), sig);
            String signature = Base64.getEncoder().encodeToString(sha256(sig.toByteArray()));

            StringBuilder xml = new StringBuilder("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n");
            root.attrs.put("Signature", signature);
            root.attrs.put("xmlns", NAMESPACE);
            root.xml(xml, "");
            return xml.toString();
        } finally {
            Arrays.fill(pwdHash, (byte) 0);
        }
    }

    private static final class Element {
        final String name;
        final Map<String, String> attrs;
        final List<Element> children = new ArrayList<>();

        Element(String name, Map<String, String> attrs) {
            this.name = name;
            this.attrs = attrs;
        }

        /** Wie Calimero liest: 01, Name, sortierte Attribute ohne xmlns und Signature, Kinder, 02. */
        void sign(ByteArrayOutputStream out) {
            out.write(1);
            appendString(utf8(name), out);
            new TreeMap<>(attrs).forEach((k, v) -> {
                if (k.equals("xmlns") || k.equals("Signature")) return;
                appendString(utf8(k), out);
                appendString(utf8(v), out);
            });
            children.forEach(c -> c.sign(out));
            out.write(2);
        }

        void xml(StringBuilder b, String indent) {
            b.append(indent).append('<').append(name);
            attrs.forEach((k, v) -> b.append(' ').append(k).append("=\"").append(escape(v)).append('"'));
            if (children.isEmpty()) {
                b.append(" />\n");
                return;
            }
            b.append(">\n");
            children.forEach(c -> c.xml(b, indent + "  "));
            b.append(indent).append("</").append(name).append(">\n");
        }
    }

    /** Attribute in Reihenfolge; Paare mit Wert null fallen weg. */
    private static Map<String, String> attrs(String... kv) {
        Map<String, String> m = new LinkedHashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) if (kv[i + 1] != null) m.put(kv[i], kv[i + 1]);
        return m;
    }

    private static String key(byte[] key, byte[] pwdHash, byte[] iv) throws GeneralSecurityException {
        if (key.length != 16) throw new IllegalArgumentException("Schluessel braucht 16 Oktette");
        return Base64.getEncoder().encodeToString(aes(Cipher.ENCRYPT_MODE, key, pwdHash, iv));
    }

    private static String password(String password, byte[] pwdHash, byte[] iv) throws GeneralSecurityException {
        byte[] text = utf8(password);
        int pad = 16 - (8 + text.length) % 16;
        byte[] plain = new byte[8 + text.length + pad];
        byte[] prefix = new byte[8];
        RNG.nextBytes(prefix);
        System.arraycopy(prefix, 0, plain, 0, 8);
        System.arraycopy(text, 0, plain, 8, text.length);
        Arrays.fill(plain, 8 + text.length, plain.length, (byte) pad);
        try {
            return Base64.getEncoder().encodeToString(aes(Cipher.ENCRYPT_MODE, plain, pwdHash, iv));
        } finally {
            Arrays.fill(plain, (byte) 0);
            Arrays.fill(text, (byte) 0);
        }
    }

    /* ---------------- Lesen ---------------- */

    /**
     * Liest einen Keyring der ETS (oder einen eigenen) und entschluesselt ihn. Ein falsches Passwort
     * faellt an der Signatur auf. Adressen bleiben roh; die Zuordnung zu Geraeten und Gruppen des
     * Projekts macht der Aufrufer.
     */
    public static Content read(String xml, char[] password, Path tempDir) throws IOException {
        if (xml.length() > 8 << 20) throw new IOException("Keyring ist unplausibel gross.");
        Path tmp = tempDir == null ? Files.createTempFile("keyring", ".knxkeys") : Files.createTempFile(tempDir, "keyring", ".knxkeys");
        try {
            Files.writeString(tmp, xml, StandardCharsets.UTF_8);
            Keyring k;
            try {
                k = Keyring.load(tmp.toString());
            } catch (RuntimeException e) {
                throw new IOException("Kein lesbarer Keyring: " + e.getMessage(), e);
            }
            if (!k.verifySignature(password)) throw new IllegalArgumentException("Keyring-Passwort falsch - oder die Datei ist veraendert.");

            String multicast = null;
            int latency = 0;
            byte[] backbone = null;
            var bb = k.backbone();
            if (bb.isPresent()) {
                multicast = bb.get().multicastGroup().getHostAddress();
                latency = (int) bb.get().latencyTolerance().toMillis();
                backbone = bb.get().groupKey().map(e -> k.decryptKey(e, password)).orElse(null);
            }
            Map<Integer, List<Tunnel>> tunnels = new TreeMap<>();
            Map<Integer, String> hostAuth = new TreeMap<>();
            for (var e : k.interfaces().entrySet()) {
                int host = e.getKey().getRawAddress();
                for (Keyring.Interface i : e.getValue()) {
                    if (i.type() != Keyring.Interface.Type.Tunneling || i.address() == null) continue;
                    String pw = i.password().map(p -> text(k.decryptPassword(p, password))).orElse(null);
                    tunnels.computeIfAbsent(host, h -> new ArrayList<>()).add(new Tunnel(i.address().getRawAddress(), i.user(), pw));
                    i.authentication().ifPresent(a -> hostAuth.put(host, text(k.decryptPassword(a, password))));
                }
            }
            List<Device> devices = new ArrayList<>();
            Map<Integer, Keyring.Device> devs = new TreeMap<>();
            k.devices().forEach((ia, d) -> devs.put(ia.getRawAddress(), d));
            for (int host : tunnels.keySet()) devs.putIfAbsent(host, null);
            for (var e : devs.entrySet()) {
                Keyring.Device d = e.getValue();
                byte[] tool = d == null ? null : d.toolKey().map(t -> k.decryptKey(t, password)).orElse(null);
                String mgmt = d == null ? null : d.password().map(p -> text(k.decryptPassword(p, password))).orElse(null);
                String auth = d == null ? null : d.authentication().map(a -> text(k.decryptPassword(a, password))).orElse(null);
                if (auth == null) auth = hostAuth.get(e.getKey());
                devices.add(new Device(e.getKey(), tool, mgmt, auth, tunnels.getOrDefault(e.getKey(), List.of())));
            }
            Map<Integer, byte[]> groups = new TreeMap<>();
            for (Map.Entry<GroupAddress, byte[]> g : k.groups().entrySet())
                groups.put(g.getKey().getRawAddress(), k.decryptKey(g.getValue(), password));
            return new Content(multicast, latency, backbone, devices, groups);
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    /* ---------------- Hilfen ---------------- */

    private static byte[] aes(int mode, byte[] data, byte[] key, byte[] iv) throws GeneralSecurityException {
        Cipher c = Cipher.getInstance("AES/CBC/NoPadding");
        c.init(mode, new SecretKeySpec(key, "AES"), new IvParameterSpec(iv));
        return c.doFinal(data);
    }

    private static byte[] pbkdf2(char[] password, byte[] salt) throws GeneralSecurityException {
        PBEKeySpec spec = new PBEKeySpec(password, salt, 65_536, 128);
        try {
            return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();
        } finally {
            spec.clearPassword();
        }
    }

    private static byte[] sha256(byte[] data) throws GeneralSecurityException {
        return Arrays.copyOf(MessageDigest.getInstance("SHA-256").digest(data), 16);
    }

    private static void appendString(byte[] s, ByteArrayOutputStream out) {
        out.write(s.length);
        out.write(s, 0, s.length);
    }

    /** Calimero gibt jedes Oktett des Passworts als ein Zeichen zurueck; der Text ist UTF-8. */
    private static String text(char[] octets) {
        byte[] b = new byte[octets.length];
        for (int i = 0; i < b.length; i++) b[i] = (byte) octets[i];
        Arrays.fill(octets, '\0');
        return new String(b, StandardCharsets.UTF_8);
    }

    private static byte[] utf8(String s) {
        return s.getBytes(StandardCharsets.UTF_8);
    }

    private static String ia(int raw) {
        return new IndividualAddress(raw).toString();
    }

    private static String escape(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }

    private interface Fn<T> {
        T get() throws GeneralSecurityException;
    }

    private static <T> T sneaky(Fn<T> f) {
        try {
            return f.get();
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }
}
