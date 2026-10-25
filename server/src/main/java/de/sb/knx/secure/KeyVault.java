package de.sb.knx.secure;

import de.sb.knx.json.Json;
import de.sb.knx.store.FileStore;

import javax.crypto.AEADBadTagException;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.PosixFilePermission;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.regex.Pattern;

/**
 * Schluesselablage fuer KNX Secure, eine verschluesselte Datei je Projekt unter secure/.
 * <p>
 * Darin stehen je Geraet (nach Seriennummer) der FDSK aus dem Zertifikat und der Tool Key, den
 * dieses Werkzeug gesetzt hat, und je sicherer Gruppenadresse (nach ihrer Id im Projekt) der
 * Gruppenschluessel. Nichts davon gehoert ins Projekt-JSON: das liegt im Browserspeicher, im
 * Undo-Verlauf und in jedem Export. Die Oberflaeche erfaehrt nur, ob ein Schluessel vorhanden ist.
 * <p>
 * Verschluesselt wird mit AES-256-GCM; der Schluessel kommt per PBKDF2-HMAC-SHA256 aus dem
 * Projektpasswort. Entsperrt bleibt eine Ablage, bis der Dienst endet oder sie gesperrt wird.
 * Geht das Passwort verloren, sind die Schluessel verloren - ein Geraet mit Tool Key kommt dann
 * nur noch ueber den Werkszustand am Geraet und seinen FDSK zurueck (03/05/01 6.1.4, 6.3.10.4).
 */
public final class KeyVault {

    public static final int MIN_PASSWORD = 8;
    private static final int MAX_PASSWORD = 200;

    /** Alte Schreibweise bleibt: FORMAT und AAD stehen in jeder gespeicherten Datei, sonst waeren die Schluessel weg. */
    private static final String FORMAT = "sb-projekt-keys";
    private static final int VERSION = 1;
    private static final String KDF = "PBKDF2WithHmacSHA256";
    private static final int ITERATIONS = 600_000;
    /** Eine fremde Datei darf weder die Ableitung abschwaechen noch den Dienst minutenlang rechnen lassen. */
    private static final int MIN_ITERATIONS = 100_000, MAX_ITERATIONS = 5_000_000;
    private static final byte[] AAD = "sb-projekt-keys/1".getBytes(StandardCharsets.US_ASCII);
    private static final int MAX_FILE = 4 << 20;
    private static final int MAX_DEVICES = 10_000, MAX_GROUPS = 65_536;
    /** KNXnet/IP Secure: Passwoerter als Text (fuer Keyrings), hoechstens 126 Tunnelbenutzer je Geraet (03/08/09 2.3.1.4). */
    private static final int MAX_IP_PASSWORD = 64, MAX_TUNNELS = 126, MAX_BACKBONES = 16;
    private static final Pattern IP_PASSWORD = Pattern.compile("[\\x20-\\x7E\\u00A0-\\uFFFF]{0,64}");
    private static final Pattern MULTICAST = Pattern.compile("2(2[4-9]|3\\d)(\\.(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)){3}");
    private static final String PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

    private static final Pattern SERIAL = Pattern.compile("[0-9A-F]{12}");
    private static final Pattern GROUP_ID = Pattern.compile("[A-Za-z0-9_-]{1,40}");
    private static final Pattern KEY = Pattern.compile("[0-9A-F]{32}");

    private static final SecureRandom RNG = new SecureRandom();

    /** Schluessel eines Geraets. pending ist ein Tool Key, der geschrieben, aber noch nicht bestaetigt ist. */
    public record DeviceKeys(byte[] fdsk, byte[] toolKey, byte[] pending) {
        public boolean any() {
            return fdsk != null || toolKey != null || pending != null;
        }
    }

    /**
     * Zugang zu einem KNXnet/IP-Secure-Geraet: Device Authentication Password, Passwort der Verwaltung
     * (User 1) und je Tunneladresse das Passwort ihres Benutzers. Gespeichert wird der Text, nicht der
     * Hash - ein Keyring fuer andere Werkzeuge braucht ihn (03/08/09 2.3.1.3, 2.3.1.4).
     */
    public record IpCreds(String auth, String mgmt, Map<Integer, String> tunnels) {
        public IpCreds {
            tunnels = java.util.Collections.unmodifiableMap(new TreeMap<>(tunnels));
        }
    }

    private static final class Open {
        final SecretKey key;
        final byte[] salt;
        final int iterations;
        final Map<String, DeviceKeys> devices = new TreeMap<>();
        final Map<String, byte[]> groups = new TreeMap<>();
        final Map<String, IpCreds> ip = new TreeMap<>();
        /** Backbone Key je Routing-Multicast-Adresse (03/08/09 2.3.1.2.4). */
        final Map<String, byte[]> backbones = new TreeMap<>();

        Open(SecretKey key, byte[] salt, int iterations) {
            this.key = key;
            this.salt = salt;
            this.iterations = iterations;
        }
    }

    private final Path dir;
    private final Map<String, Open> open = new HashMap<>();

    public KeyVault(Path dataDir) throws IOException {
        this.dir = dataDir.resolve("secure");
        Files.createDirectories(dir);
        restrict(dir, true);
    }

    /* ---------------- Zustand ---------------- */

    public synchronized Map<String, Object> status(String project) throws IOException {
        String id = FileStore.safeId(project);
        Map<String, Object> m = Json.obj();
        m.put("project", id);
        m.put("exists", Files.isRegularFile(file(id)));
        m.put("unlocked", open.containsKey(id));
        m.put("file", file(id).toString());
        Open o = open.get(id);
        if (o != null) {
            Map<String, Object> devices = Json.obj();
            o.devices.forEach((serial, k) -> {
                Map<String, Object> d = Json.obj();
                d.put("fdsk", k.fdsk() != null);
                d.put("toolKey", k.toolKey() != null);
                d.put("pending", k.pending() != null);
                devices.put(serial, d);
            });
            m.put("devices", devices);
            java.util.List<Object> groups = Json.arr();
            groups.addAll(o.groups.keySet());
            m.put("groups", groups);
            Map<String, Object> ip = Json.obj();
            o.ip.forEach((serial, c) -> {
                Map<String, Object> d = Json.obj();
                d.put("tunnels", c.tunnels().size());
                ip.put(serial, d);
            });
            m.put("ip", ip);
            java.util.List<Object> backbones = Json.arr();
            backbones.addAll(o.backbones.keySet());
            m.put("backbones", backbones);
        }
        return m;
    }

    public synchronized boolean unlocked(String project) {
        return open.containsKey(FileStore.safeId(project));
    }

    /**
     * Entsperrt die Ablage eines Projekts. Gibt es noch keine, legt {@code create} sie mit diesem
     * Passwort an - getrennt, damit ein Tippfehler im Passwort nie still eine zweite Ablage erzeugt.
     */
    public synchronized void unlock(String project, char[] password, boolean create)
            throws IOException, GeneralSecurityException {
        String id = FileStore.safeId(project);
        checkPassword(password);
        Path f = file(id);
        if (!Files.isRegularFile(f)) {
            if (!create) throw new IllegalStateException("Fuer dieses Projekt gibt es noch keine Schluesselablage.");
            byte[] salt = random(16);
            Open o = new Open(derive(password, salt, ITERATIONS), salt, ITERATIONS);
            open.put(id, o);
            persist(id, o);
            return;
        }
        if (create) throw new IllegalStateException("Die Schluesselablage dieses Projekts gibt es schon.");
        Open was = open.put(id, read(f, password));
        if (was != null) wipe(was);
    }

    public synchronized void lock(String project) {
        Open o = open.remove(FileStore.safeId(project));
        if (o != null) wipe(o);
    }

    /** Neues Passwort; der Inhalt bleibt, Salz und Ableitung werden neu erzeugt. */
    public synchronized void changePassword(String project, char[] oldPassword, char[] newPassword)
            throws IOException, GeneralSecurityException {
        String id = FileStore.safeId(project);
        checkPassword(newPassword);
        Open current = read(file(id), oldPassword);
        byte[] salt = random(16);
        Open next = new Open(derive(newPassword, salt, ITERATIONS), salt, ITERATIONS);
        next.devices.putAll(current.devices);
        next.groups.putAll(current.groups);
        next.ip.putAll(current.ip);
        next.backbones.putAll(current.backbones);
        persist(id, next);
        Open was = open.put(id, next);
        if (was != null && was != current) wipe(was);
    }

    /* ---------------- Geraete ---------------- */

    /** Traegt den FDSK aus einem Zertifikat ein und liefert dessen Seriennummer. */
    public synchronized String putCertificate(String project, Certificate cert) throws IOException, GeneralSecurityException {
        String id = FileStore.safeId(project);
        Open o = require(id);
        String serial = cert.serial();
        DeviceKeys k = o.devices.get(serial);
        if (k == null && o.devices.size() >= MAX_DEVICES) throw new IllegalStateException("Zu viele Geraete in der Ablage.");
        o.devices.put(serial, new DeviceKeys(cert.fdsk(), k == null ? null : k.toolKey(), k == null ? null : k.pending()));
        persist(id, o);
        return serial;
    }

    /** Entfernt nur den FDSK. Ein gesetzter Tool Key bleibt - ohne ihn kaeme man nicht mehr an das Geraet. */
    public synchronized void removeCertificate(String project, String serial) throws IOException, GeneralSecurityException {
        String id = FileStore.safeId(project);
        Open o = require(id);
        String s = serial(serial);
        DeviceKeys k = o.devices.get(s);
        if (k == null) return;
        DeviceKeys next = new DeviceKeys(null, k.toolKey(), k.pending());
        if (next.any()) o.devices.put(s, next);
        else o.devices.remove(s);
        persist(id, o);
    }

    public synchronized DeviceKeys device(String project, String serial) {
        Open o = require(FileStore.safeId(project));
        DeviceKeys k = o.devices.get(serial(serial));
        return k == null ? null : copy(k);
    }

    /**
     * Merkt einen neuen Tool Key vor, bevor er ins Geraet geht. Erst danach wird geschrieben -
     * stuerzt etwas dazwischen ab, ist der Schluessel trotzdem gesichert und wird beim naechsten
     * Mal mit ausprobiert.
     */
    public synchronized byte[] newPendingToolKey(String project, String serial) throws IOException, GeneralSecurityException {
        String id = FileStore.safeId(project);
        Open o = require(id);
        String s = serial(serial);
        DeviceKeys k = o.devices.get(s);
        if (k == null) throw new IllegalStateException("Fuer " + s + " ist kein Schluessel hinterlegt.");
        // Jeder Tool Key ist neu und zufaellig (03/05/01 6.3.10.5), nie gleich FDSK oder Vorgaenger
        byte[] key;
        do {
            key = random(16);
        } while (Arrays.equals(key, k.fdsk()) || Arrays.equals(key, k.toolKey()));
        o.devices.put(s, new DeviceKeys(k.fdsk(), k.toolKey(), key));
        persist(id, o);
        return key.clone();
    }

    /** Das Geraet arbeitet mit diesem Schluessel - er wird der Tool Key, ein vorgemerkter faellt weg. */
    public synchronized void confirmToolKey(String project, String serial, byte[] key) throws IOException, GeneralSecurityException {
        String id = FileStore.safeId(project);
        Open o = require(id);
        String s = serial(serial);
        DeviceKeys k = o.devices.get(s);
        if (k == null) return;
        if (Arrays.equals(k.toolKey(), key) && k.pending() == null) return;
        o.devices.put(s, new DeviceKeys(k.fdsk(), key.clone(), null));
        persist(id, o);
    }

    /** Der vorgemerkte Schluessel ist nicht im Geraet angekommen. */
    public synchronized void dropPending(String project, String serial) throws IOException, GeneralSecurityException {
        String id = FileStore.safeId(project);
        Open o = require(id);
        String s = serial(serial);
        DeviceKeys k = o.devices.get(s);
        if (k == null || k.pending() == null) return;
        o.devices.put(s, new DeviceKeys(k.fdsk(), k.toolKey(), null));
        persist(id, o);
    }

    /* ---------------- Gruppen ---------------- */

    /** Gruppenschluessel einer sicheren Adresse; fehlt er, wird er erzeugt und gespeichert, bevor er ein Geraet erreicht. */
    public synchronized byte[] groupKey(String project, String groupId) throws IOException, GeneralSecurityException {
        String id = FileStore.safeId(project);
        Open o = require(id);
        if (groupId == null || !GROUP_ID.matcher(groupId).matches())
            throw new IllegalArgumentException("Unbrauchbare Gruppen-Id: " + groupId);
        byte[] key = o.groups.get(groupId);
        if (key == null) {
            if (o.groups.size() >= MAX_GROUPS) throw new IllegalStateException("Zu viele Gruppenschluessel in der Ablage.");
            key = random(16);
            o.groups.put(groupId, key);
            persist(id, o);
        }
        return key.clone();
    }

    /* ---------------- KNXnet/IP Secure ---------------- */

    /** Zugang eines IP-Secure-Geraets oder null, wenn die Ablage keinen kennt. */
    public synchronized IpCreds ipCreds(String project, String serial) {
        return require(FileStore.safeId(project)).ip.get(serial(serial));
    }

    /**
     * Zugang fuer ein Geraet, das gleich mit diesen Tunneladressen gesichert wird. Was fehlt, wird
     * zufaellig erzeugt und gespeichert, bevor es das Geraet erreicht - wie beim Tool Key. Vorhandene
     * Passwoerter bleiben, damit andere Werkzeuge nach einem erneuten Download weiter verbinden.
     */
    public synchronized IpCreds ensureIpCreds(String project, String serial, java.util.List<Integer> tunnels)
            throws IOException, GeneralSecurityException {
        String id = FileStore.safeId(project);
        Open o = require(id);
        String s = serial(serial);
        if (tunnels.size() > MAX_TUNNELS) throw new IllegalArgumentException("Zu viele Tunneladressen: " + tunnels.size());
        IpCreds c = o.ip.get(s);
        if (c == null && o.ip.size() >= MAX_DEVICES) throw new IllegalStateException("Zu viele Geraete in der Ablage.");
        Map<Integer, String> t = new TreeMap<>(c == null ? Map.of() : c.tunnels());
        boolean changed = c == null;
        for (int pa : tunnels) {
            if (pa <= 0 || pa > 0xFFFF) throw new IllegalArgumentException("Unbrauchbare Tunneladresse: " + pa);
            if (!t.containsKey(pa)) {
                t.put(pa, newPassword());
                changed = true;
            }
        }
        IpCreds next = new IpCreds(c == null ? newPassword() : c.auth(), c == null ? newPassword() : c.mgmt(), t);
        if (changed) {
            o.ip.put(s, next);
            persist(id, o);
        }
        return next;
    }

    /** Uebernimmt einen Zugang, etwa aus einem Keyring der ETS; Tunnelpasswoerter werden ergaenzt. */
    public synchronized void putIpCreds(String project, String serial, IpCreds creds) throws IOException, GeneralSecurityException {
        String id = FileStore.safeId(project);
        Open o = require(id);
        String s = serial(serial);
        checkIp(creds);
        IpCreds c = o.ip.get(s);
        Map<Integer, String> t = new TreeMap<>(c == null ? Map.of() : c.tunnels());
        t.putAll(creds.tunnels());
        if (t.size() > MAX_TUNNELS) throw new IllegalArgumentException("Zu viele Tunneladressen");
        o.ip.put(s, new IpCreds(creds.auth(), creds.mgmt(), t));
        persist(id, o);
    }

    /** Backbone Key einer Routing-Multicast-Adresse; fehlt er, wird er erzeugt und gespeichert. */
    public synchronized byte[] backboneKey(String project, String multicast, boolean create)
            throws IOException, GeneralSecurityException {
        String id = FileStore.safeId(project);
        Open o = require(id);
        if (multicast == null || !MULTICAST.matcher(multicast).matches())
            throw new IllegalArgumentException("Unbrauchbare Multicast-Adresse: " + multicast);
        byte[] key = o.backbones.get(multicast);
        if (key == null && create) {
            if (o.backbones.size() >= MAX_BACKBONES) throw new IllegalStateException("Zu viele Backbone Keys in der Ablage.");
            key = random(16);
            o.backbones.put(multicast, key);
            persist(id, o);
        }
        return key == null ? null : key.clone();
    }

    /** Uebernimmt Schluessel aus einem Keyring: Backbone, Tool Keys, Gruppenschluessel. */
    public synchronized void putImported(String project, String multicast, byte[] backbone, Map<String, byte[]> toolKeys,
                                         Map<String, byte[]> groupKeys) throws IOException, GeneralSecurityException {
        String id = FileStore.safeId(project);
        Open o = require(id);
        if (backbone != null) {
            if (multicast == null || !MULTICAST.matcher(multicast).matches() || backbone.length != 16)
                throw new IllegalArgumentException("Backbone Key unbrauchbar");
            o.backbones.put(multicast, backbone.clone());
        }
        for (Map.Entry<String, byte[]> e : toolKeys.entrySet()) {
            String s = serial(e.getKey());
            if (e.getValue() == null || e.getValue().length != 16) throw new IllegalArgumentException("Tool Key unbrauchbar");
            DeviceKeys k = o.devices.get(s);
            if (k == null && o.devices.size() >= MAX_DEVICES) throw new IllegalStateException("Zu viele Geraete in der Ablage.");
            // Der importierte Schluessel gilt im Geraet; ein eigener bleibt vorgemerkt, falls er es doch ist
            byte[] own = k == null ? null : k.toolKey();
            byte[] pending = own != null && !Arrays.equals(own, e.getValue()) ? own : (k == null ? null : k.pending());
            o.devices.put(s, new DeviceKeys(k == null ? null : k.fdsk(), e.getValue().clone(), pending));
        }
        for (Map.Entry<String, byte[]> e : groupKeys.entrySet()) {
            if (!GROUP_ID.matcher(e.getKey()).matches() || e.getValue() == null || e.getValue().length != 16)
                throw new IllegalArgumentException("Gruppenschluessel unbrauchbar");
            if (!o.groups.containsKey(e.getKey()) && o.groups.size() >= MAX_GROUPS)
                throw new IllegalStateException("Zu viele Gruppenschluessel in der Ablage.");
            o.groups.put(e.getKey(), e.getValue().clone());
        }
        persist(id, o);
    }

    /** Vorhandener Gruppenschluessel ohne Erzeugen - fuer den Keyring-Export. */
    public synchronized byte[] groupKeyIfKnown(String project, String groupId) {
        byte[] key = require(FileStore.safeId(project)).groups.get(groupId);
        return key == null ? null : key.clone();
    }

    private static String newPassword() {
        StringBuilder b = new StringBuilder(20);
        for (int i = 0; i < 20; i++) b.append(PASSWORD_ALPHABET.charAt(RNG.nextInt(PASSWORD_ALPHABET.length())));
        return b.toString();
    }

    private static void checkIp(IpCreds c) {
        if (c == null || !validIpPassword(c.auth()) || !validIpPassword(c.mgmt()))
            throw new IllegalArgumentException("Passwort fuer KNX IP Secure unbrauchbar");
        c.tunnels().forEach((pa, pw) -> {
            if (pa == null || pa <= 0 || pa > 0xFFFF || !validIpPassword(pw))
                throw new IllegalArgumentException("Tunnelzugang unbrauchbar");
        });
    }

    private static boolean validIpPassword(String s) {
        return s != null && s.length() <= MAX_IP_PASSWORD && IP_PASSWORD.matcher(s).matches();
    }

    /* ---------------- Projektverwaltung ---------------- */

    /**
     * Die Schluesseldatei, so wie sie verschluesselt auf der Platte liegt - fuer den Projektexport.
     * Nur entsperrt: Wer sie mitnimmt, soll zeigen, dass er das Passwort kennt; ohne es waere die
     * Kopie wertlos, und kein anderer Prozess bekommt die Datei fuer einen Rateangriff ausgehaendigt.
     */
    public synchronized String exportFile(String project) throws IOException {
        String id = FileStore.safeId(project);
        require(id);
        Path f = file(id);
        if (!Files.isRegularFile(f)) throw new IllegalStateException("Fuer dieses Projekt gibt es keine Schluesselablage.");
        if (Files.size(f) > MAX_FILE) throw new IOException("Schluesseldatei ist unplausibel gross.");
        return Files.readString(f, StandardCharsets.UTF_8);
    }

    /**
     * Uebernimmt eine Schluesseldatei aus einem Projektexport. Geprueft wird die Huelle; entschluesselt
     * wird erst beim Entsperren mit dem Passwort des exportierten Projekts. Eine vorhandene Ablage wird
     * nicht ueberschrieben, sondern beiseitegelegt (.replaced-Zeitstempel) - sie koennte die einzigen
     * Tool Keys von Geraeten enthalten.
     */
    public synchronized Map<String, Object> importFile(String project, String text) throws IOException {
        String id = FileStore.safeId(project);
        envelope(text);
        Path f = file(id);
        Open o = open.remove(id);
        if (o != null) wipe(o);
        if (Files.isRegularFile(f)) {
            String stamp = java.time.LocalDateTime.now().format(java.time.format.DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss"));
            Files.move(f, f.resolveSibling(f.getFileName() + ".replaced-" + stamp), StandardCopyOption.REPLACE_EXISTING);
        }
        Path tmp = f.resolveSibling(f.getFileName() + ".tmp");
        Files.writeString(tmp, text, StandardCharsets.UTF_8);
        restrict(tmp, false);
        Files.move(tmp, f, StandardCopyOption.REPLACE_EXISTING);
        return status(project);
    }

    /** Wird ein Projekt umbenannt, wandert seine Ablage mit. */
    public synchronized void rename(String project, String newProject) throws IOException {
        String from = FileStore.safeId(project), to = FileStore.safeId(newProject);
        Path a = file(from), b = file(to);
        if (!Files.isRegularFile(a)) return;
        if (Files.exists(b)) throw new IOException("Es gibt schon eine Schluesselablage namens " + to);
        Files.move(a, b, StandardCopyOption.ATOMIC_MOVE);
        Path bak = a.resolveSibling(a.getFileName() + ".bak");
        if (Files.exists(bak)) Files.move(bak, b.resolveSibling(b.getFileName() + ".bak"), StandardCopyOption.REPLACE_EXISTING);
        Open o = open.remove(from);
        if (o != null) open.put(to, o);
    }

    /**
     * Ein geloeschtes Projekt nimmt seine Schluessel nicht mit: die Datei wird nur beiseitegelegt.
     * Ohne sie waeren die Geraete mit Tool Key nur noch per Werkszustand erreichbar.
     */
    public synchronized void retire(String project) throws IOException {
        String id = FileStore.safeId(project);
        Path f = file(id);
        Open o = open.remove(id);
        if (o != null) wipe(o);
        if (!Files.isRegularFile(f)) return;
        Files.move(f, f.resolveSibling(f.getFileName() + ".deleted"), StandardCopyOption.REPLACE_EXISTING);
    }

    /* ---------------- Datei und Kryptografie ---------------- */

    private Path file(String id) {
        Path p = dir.resolve(id + ".keys").normalize();
        if (!p.startsWith(dir)) throw new IllegalArgumentException("Pfad ausserhalb der Ablage");
        return p;
    }

    private Open require(String id) {
        Open o = open.get(id);
        if (o == null) throw new IllegalStateException("Die Schluesselablage ist gesperrt - bitte mit dem Projektpasswort entsperren.");
        return o;
    }

    /** Die verschluesselte Huelle einer Schluesseldatei, gelesen und auf Plausibilitaet geprueft. */
    private record Envelope(int iterations, byte[] salt, byte[] iv, byte[] data) {}

    private static Envelope envelope(String text) throws IOException {
        if (text.length() > MAX_FILE) throw new IOException("Schluesseldatei ist unplausibel gross.");
        Map<String, Object> env;
        try {
            env = Json.parseObject(text);
        } catch (RuntimeException e) {
            throw new IOException("Unbekanntes Format der Schluesseldatei.");
        }
        if (!FORMAT.equals(Json.str(env, "format", null)) || Json.integer(env, "version", 0) != VERSION
                || !KDF.equals(Json.str(env, "kdf", null))) {
            throw new IOException("Unbekanntes Format der Schluesseldatei.");
        }
        int iterations = Json.integer(env, "iterations", 0);
        if (iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) throw new IOException("Schluesseldatei mit unplausibler Ableitung.");
        return new Envelope(iterations, b64(env, "salt", 16, 64), b64(env, "iv", 12, 12), b64(env, "data", 16, MAX_FILE));
    }

    private Open read(Path f, char[] password) throws IOException, GeneralSecurityException {
        if (!Files.isRegularFile(f)) throw new IllegalStateException("Fuer dieses Projekt gibt es keine Schluesselablage.");
        if (Files.size(f) > MAX_FILE) throw new IOException("Schluesseldatei ist unplausibel gross.");
        Envelope env = envelope(Files.readString(f, StandardCharsets.UTF_8));
        int iterations = env.iterations();
        byte[] salt = env.salt(), iv = env.iv(), data = env.data();

        SecretKey key = derive(password, salt, iterations);
        byte[] plain;
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, iv));
            c.updateAAD(AAD);
            plain = c.doFinal(data);
        } catch (AEADBadTagException e) {
            throw new IllegalArgumentException("Passwort falsch - oder die Schluesseldatei ist beschaedigt.");
        }
        Open o = new Open(key, salt, iterations);
        try {
            load(o, Json.parseObject(new String(plain, StandardCharsets.UTF_8)));
        } finally {
            Arrays.fill(plain, (byte) 0);
        }
        return o;
    }

    /** Die entschluesselte Datei ist immer noch fremde Eingabe: jedes Feld wird geprueft, Unpassendes faellt weg. */
    private static void load(Open o, Map<String, Object> doc) {
        if (doc.get("devices") instanceof Map<?, ?> devices) {
            devices.forEach((k, v) -> {
                if (!(k instanceof String serial) || !SERIAL.matcher(serial).matches() || !(v instanceof Map<?, ?> d)) return;
                if (o.devices.size() >= MAX_DEVICES) return;
                DeviceKeys keys = new DeviceKeys(key(d.get("fdsk")), key(d.get("toolKey")), key(d.get("pending")));
                if (keys.any()) o.devices.put(serial, keys);
            });
        }
        if (doc.get("ip") instanceof Map<?, ?> ip) {
            ip.forEach((k, v) -> {
                if (!(k instanceof String serial) || !SERIAL.matcher(serial).matches() || !(v instanceof Map<?, ?> d)) return;
                if (o.ip.size() >= MAX_DEVICES) return;
                if (!(d.get("auth") instanceof String auth) || !(d.get("mgmt") instanceof String mgmt)) return;
                Map<Integer, String> tunnels = new TreeMap<>();
                if (d.get("tunnels") instanceof Map<?, ?> t) {
                    t.forEach((pa, pw) -> {
                        if (tunnels.size() >= MAX_TUNNELS || !(pa instanceof String p) || !p.matches("\\d{1,5}")
                                || !(pw instanceof String w) || !validIpPassword(w)) return;
                        int n = Integer.parseInt(p);
                        if (n > 0 && n <= 0xFFFF) tunnels.put(n, w);
                    });
                }
                if (validIpPassword(auth) && validIpPassword(mgmt)) o.ip.put(serial, new IpCreds(auth, mgmt, tunnels));
            });
        }
        if (doc.get("backbones") instanceof Map<?, ?> bb) {
            bb.forEach((k, v) -> {
                if (!(k instanceof String mc) || !MULTICAST.matcher(mc).matches() || o.backbones.size() >= MAX_BACKBONES) return;
                byte[] key = key(v);
                if (key != null) o.backbones.put(mc, key);
            });
        }
        if (doc.get("groups") instanceof Map<?, ?> groups) {
            groups.forEach((k, v) -> {
                if (!(k instanceof String gid) || !GROUP_ID.matcher(gid).matches()) return;
                if (o.groups.size() >= MAX_GROUPS) return;
                byte[] key = key(v);
                if (key != null) o.groups.put(gid, key);
            });
        }
    }

    private void persist(String id, Open o) throws IOException, GeneralSecurityException {
        Map<String, Object> doc = Json.obj();
        Map<String, Object> devices = Json.obj();
        o.devices.forEach((serial, k) -> {
            Map<String, Object> d = Json.obj();
            if (k.fdsk() != null) d.put("fdsk", Certificate.hex(k.fdsk()));
            if (k.toolKey() != null) d.put("toolKey", Certificate.hex(k.toolKey()));
            if (k.pending() != null) d.put("pending", Certificate.hex(k.pending()));
            devices.put(serial, d);
        });
        Map<String, Object> groups = Json.obj();
        o.groups.forEach((gid, key) -> groups.put(gid, Certificate.hex(key)));
        doc.put("devices", devices);
        doc.put("groups", groups);
        Map<String, Object> ip = Json.obj();
        o.ip.forEach((serial, c) -> {
            Map<String, Object> d = Json.obj();
            d.put("auth", c.auth());
            d.put("mgmt", c.mgmt());
            Map<String, Object> t = Json.obj();
            c.tunnels().forEach((pa, pw) -> t.put(String.valueOf(pa), pw));
            d.put("tunnels", t);
            ip.put(serial, d);
        });
        doc.put("ip", ip);
        Map<String, Object> bb = Json.obj();
        o.backbones.forEach((mc, key) -> bb.put(mc, Certificate.hex(key)));
        doc.put("backbones", bb);

        byte[] plain = Json.write(doc).getBytes(StandardCharsets.UTF_8);
        byte[] iv = random(12);
        byte[] data;
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, o.key, new GCMParameterSpec(128, iv));
            c.updateAAD(AAD);
            data = c.doFinal(plain);
        } finally {
            Arrays.fill(plain, (byte) 0);
        }
        Map<String, Object> env = Json.obj();
        env.put("format", FORMAT);
        env.put("version", VERSION);
        env.put("kdf", KDF);
        env.put("iterations", o.iterations);
        env.put("salt", Base64.getEncoder().encodeToString(o.salt));
        env.put("iv", Base64.getEncoder().encodeToString(iv));
        env.put("data", Base64.getEncoder().encodeToString(data));

        Path target = file(id);
        Path tmp = target.resolveSibling(target.getFileName() + ".tmp");
        Files.writeString(tmp, Json.write(env), StandardCharsets.UTF_8);
        restrict(tmp, false);
        if (Files.exists(target)) {
            Path bak = target.resolveSibling(target.getFileName() + ".bak");
            Files.copy(target, bak, StandardCopyOption.REPLACE_EXISTING);
            restrict(bak, false);
        }
        try {
            Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException e) {
            Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    private static SecretKey derive(char[] password, byte[] salt, int iterations) throws GeneralSecurityException {
        PBEKeySpec spec = new PBEKeySpec(password, salt, iterations, 256);
        try {
            byte[] raw = SecretKeyFactory.getInstance(KDF).generateSecret(spec).getEncoded();
            try {
                return new SecretKeySpec(raw, "AES");
            } finally {
                Arrays.fill(raw, (byte) 0);
            }
        } finally {
            spec.clearPassword();
        }
    }

    private static void checkPassword(char[] password) {
        if (password == null || password.length < MIN_PASSWORD)
            throw new IllegalArgumentException("Das Projektpasswort braucht mindestens " + MIN_PASSWORD + " Zeichen.");
        if (password.length > MAX_PASSWORD) throw new IllegalArgumentException("Das Projektpasswort ist zu lang.");
    }

    /** Nur der Benutzer selbst darf lesen - auf Systemen ohne POSIX-Rechte bleibt es bei den Vorgaben. */
    private static void restrict(Path p, boolean directory) {
        try {
            Set<PosixFilePermission> perms = PosixFilePermissions.fromString(directory ? "rwx------" : "rw-------");
            Files.setPosixFilePermissions(p, perms);
        } catch (UnsupportedOperationException | IOException ignored) {
            // Windows: das Benutzerprofil ist ohnehin nur fuer den Benutzer lesbar.
        }
    }

    private static byte[] b64(Map<String, Object> env, String field, int min, int max) throws IOException {
        String s = Json.str(env, field, null);
        if (s == null || s.length() > max * 2) throw new IOException("Schluesseldatei unvollstaendig (" + field + ").");
        byte[] b;
        try {
            b = Base64.getDecoder().decode(s);
        } catch (IllegalArgumentException e) {
            throw new IOException("Schluesseldatei beschaedigt (" + field + ").");
        }
        if (b.length < min || b.length > max) throw new IOException("Schluesseldatei beschaedigt (" + field + ").");
        return b;
    }

    private static byte[] key(Object v) {
        if (!(v instanceof String s) || !KEY.matcher(s).matches()) return null;
        byte[] b = new byte[16];
        for (int i = 0; i < 16; i++) b[i] = (byte) Integer.parseInt(s.substring(i * 2, i * 2 + 2), 16);
        return b;
    }

    private static String serial(String s) {
        String hex = s == null ? "" : s.replaceAll("[^0-9a-fA-F]", "").toUpperCase(java.util.Locale.ROOT);
        if (!SERIAL.matcher(hex).matches()) throw new IllegalArgumentException("Seriennummer braucht 6 Byte: " + s);
        return hex;
    }

    private static DeviceKeys copy(DeviceKeys k) {
        return new DeviceKeys(clone(k.fdsk()), clone(k.toolKey()), clone(k.pending()));
    }

    private static byte[] clone(byte[] b) {
        return b == null ? null : b.clone();
    }

    private static byte[] random(int n) {
        byte[] b = new byte[n];
        RNG.nextBytes(b);
        return b;
    }

    private static void wipe(Open o) {
        o.devices.values().forEach(k -> {
            if (k.fdsk() != null) Arrays.fill(k.fdsk(), (byte) 0);
            if (k.toolKey() != null) Arrays.fill(k.toolKey(), (byte) 0);
            if (k.pending() != null) Arrays.fill(k.pending(), (byte) 0);
        });
        o.groups.values().forEach(k -> Arrays.fill(k, (byte) 0));
        o.backbones.values().forEach(k -> Arrays.fill(k, (byte) 0));
        o.ip.clear();
        o.backbones.clear();
        o.devices.clear();
        o.groups.clear();
    }
}
