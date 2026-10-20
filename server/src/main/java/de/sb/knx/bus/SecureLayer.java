package de.sb.knx.bus;

import tuwien.auto.calimero.IndividualAddress;
import tuwien.auto.calimero.KNXAddress;
import tuwien.auto.calimero.KNXException;
import tuwien.auto.calimero.SerialNumber;
import tuwien.auto.calimero.mgmt.SecureManagement;
import tuwien.auto.calimero.mgmt.TransportLayerImpl;
import tuwien.auto.calimero.secure.KnxSecureException;
import tuwien.auto.calimero.secure.SecureApplicationLayer.SalService;
import tuwien.auto.calimero.secure.SecurityControl;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;

/**
 * Secure Application Layer fuer den Werkzeugzugang (Tool Access) zu KNX-Secure-Geraeten.
 * <p>
 * Calimero sichert jeden Managementzugriff auf eine Adresse, fuer die ein Tool Key bekannt ist,
 * mit S-A_Data (Authentifizierung und Verschluesselung, 03/03/07 5.1.3, 5.5.5). Was hier dazukommt:
 * <ul>
 * <li>Je Geraet bis zu drei Schluessel: der Tool Key, ein geschriebener, aber noch unbestaetigter,
 *     und der FDSK. Welcher gilt, entscheidet die erste Synchronisation (DM_SecureSync_RCl,
 *     03/05/02 4.2): ein Geraet antwortet nur, wenn es den Schluessel kennt. Scheitert der eine,
 *     wird der naechste versucht (ebenda, NOTE 19) - so findet sich auch ein Geraet wieder, das
 *     von Hand in den Werkszustand gesetzt wurde und wieder den FDSK verwendet.</li>
 * <li>Synchronisiert wird vor dem ersten Zugriff auf jedes Geraet. Ein Sender hat nur eine
 *     Sequenznummer fuer alle gesicherten Telegramme (03/03/07 5.3.1); Calimero synchronisiert
 *     aber nur, solange sie noch beim Anfangswert steht - das zweite Geraet bekaeme sonst eine
 *     Nummer, die es womoeglich schon gesehen hat, und verwuerfe alles.</li>
 * <li>Der Wechsel des Tool Keys: das Schreiben von PID_TOOL_KEY geht noch mit dem alten Schluessel
 *     hinaus, die Antwort kommt bereits mit dem neuen (03/05/01 6.3.10.4).</li>
 * </ul>
 * Fuer Adressen ohne Eintrag bleibt alles unverschluesselt.
 */
final class SecureLayer extends SecureManagement {

    enum KeyKind { TOOL, PENDING, FDSK }

    /** Rueckmeldung, mit welchem Schluessel ein Geraet geantwortet hat. */
    interface Listener {
        void synced(IndividualAddress address, String serial, KeyKind kind, byte[] key);
    }

    /** Ein gebundenes Geraet: Seriennummer, Schluessel und was die Synchronisation ergeben hat. */
    static final class Entry {
        final String serial;
        final byte[] toolKey, pending, fdsk;
        volatile byte[] key;
        volatile KeyKind using;
        volatile boolean synced;
        volatile boolean preferFdsk;

        Entry(String serial, byte[] toolKey, byte[] pending, byte[] fdsk) {
            this.serial = serial;
            this.toolKey = toolKey;
            this.pending = pending;
            this.fdsk = fdsk;
        }

        boolean sameKeys(Entry o) {
            return serial.equals(o.serial) && Arrays.equals(toolKey, o.toolKey)
                    && Arrays.equals(pending, o.pending) && Arrays.equals(fdsk, o.fdsk);
        }

        List<Object[]> candidates() {
            List<Object[]> out = new ArrayList<>(3);
            if (preferFdsk && fdsk != null) out.add(new Object[] {KeyKind.FDSK, fdsk});
            if (toolKey != null) out.add(new Object[] {KeyKind.TOOL, toolKey});
            if (pending != null) out.add(new Object[] {KeyKind.PENDING, pending});
            if (!preferFdsk && fdsk != null) out.add(new Object[] {KeyKind.FDSK, fdsk});
            return out;
        }
    }

    /** Ein Geraet beantwortet innerhalb einer Sekunde nach seiner letzten Sync-Antwort keine weitere (03/05/02 4.2). */
    private static final long SYNC_GAP_MS = 1_100;
    /** Versuche je Schluessel, solange das Geraet zwar antwortet, die Antwort aber nicht zu pruefen ist. */
    private static final int SYNC_ATTEMPTS = 3;

    private final Map<IndividualAddress, Entry> entries = new ConcurrentHashMap<>();
    private final Map<IndividualAddress, Long> lastSync = new ConcurrentHashMap<>();
    private final Map<IndividualAddress, CompletableFuture<Void>> garbled = new ConcurrentHashMap<>();
    private final Map<IndividualAddress, byte[]> armed = new ConcurrentHashMap<>();
    private volatile Listener listener;
    private volatile boolean plainOnly;
    private volatile long toolSequence = 1;

    SecureLayer(TransportLayerImpl transportLayer) {
        super(transportLayer, SerialNumber.Zero, 0, Map.of());
    }

    void listener(Listener l) {
        listener = l;
    }

    /* ---------------- Bindung ---------------- */

    /**
     * Uebernimmt die Schluessel der Geraete des geoeffneten Projekts. Ein Geraet, dessen Schluessel
     * sich nicht geaendert haben, behaelt seinen Synchronisationsstand - die Oberflaeche bindet vor
     * jedem Vorgang neu, und jedes Mal neu zu synchronisieren kostete Zeit.
     */
    void bind(Map<IndividualAddress, Entry> next) {
        entries.keySet().removeIf(a -> !next.containsKey(a));
        next.forEach((a, e) -> {
            Entry old = entries.get(a);
            if (old == null || !old.sameKeys(e)) entries.put(a, e);
        });
    }

    /** Ersetzt den Eintrag einer Adresse, etwa nach dem Wechsel des Tool Keys. */
    void bindOne(IndividualAddress address, Entry e) {
        entries.put(address, e);
    }

    boolean bound(IndividualAddress address) {
        return entries.containsKey(address);
    }

    Entry entry(IndividualAddress address) {
        return entries.get(address);
    }

    /** Waehrend des Linienscans unverschluesselt: dort genuegt, wer antwortet. */
    void plainOnly(boolean on) {
        plainOnly = on;
    }

    /** Nach einem Ruecksetzen muss neu synchronisiert werden; nach dem Werkszustand gilt zuerst der FDSK. */
    void invalidate(IndividualAddress address, boolean factoryReset) {
        Entry e = entries.get(address);
        if (e == null) return;
        e.synced = false;
        e.preferFdsk = factoryReset;
    }

    /** Der naechste gesicherte Aufruf an diese Adresse geht noch mit dem alten Schluessel hinaus, danach gilt {@code next}. */
    void armToolKey(IndividualAddress address, byte[] next) {
        armed.put(address, next.clone());
    }

    void disarm(IndividualAddress address) {
        armed.remove(address);
    }

    /* ---------------- Calimero ---------------- */

    @Override
    protected byte[] toolKey(IndividualAddress device) {
        if (plainOnly) return null;
        Entry e = entries.get(device);
        return e == null ? null : e.key;
    }

    @Override
    public Optional<byte[]> secureData(IndividualAddress src, KNXAddress dst, byte[] apdu, SecurityControl ctrl)
            throws InterruptedException {
        Entry e = !plainOnly && ctrl.toolAccess() && dst instanceof IndividualAddress ia ? entries.get(ia) : null;
        if (e != null) ensureSynced((IndividualAddress) dst, e);
        Optional<byte[]> out = super.secureData(src, dst, apdu, ctrl);
        if (e != null && out.isPresent()) {
            byte[] next = armed.remove(dst);
            if (next != null) {
                e.key = next;
                e.using = KeyKind.PENDING;
            }
        }
        return out;
    }

    /**
     * Calimero 2.6 bildet die Zufallszahl einer Sync-Antwort (XOR mit der Challenge, 03/03/07 5.3.2)
     * ueber {@code BitSet.toByteArray()}, das Null-Oktette am Ende abschneidet: endet sie auf 00h,
     * stimmt der MAC nicht, und die Antwort wird stillschweigend verworfen - bei jeder 256. Antwort.
     * Ein Geraet antwortet aber nur auf eine Anfrage, deren Schluessel es kennt; eine solche
     * Antwort heisst also: Schluessel richtig, noch einmal synchronisieren.
     */
    @Override
    public SalService decrypt(IndividualAddress src, KNXAddress dst, int tpci, byte[] secureApdu) {
        try {
            return super.decrypt(src, dst, tpci, secureApdu);
        } catch (RuntimeException x) {
            CompletableFuture<Void> f = secureApdu.length > 0 && (secureApdu[0] & 0x07) == 3 ? garbled.get(src) : null;
            if (f != null) f.complete(null);
            throw x;
        }
    }

    @Override
    protected void updateSequenceNumber(boolean toolAccess, long seqNo) {
        super.updateSequenceNumber(toolAccess, seqNo);
        if (toolAccess) toolSequence = seqNo;
    }

    /** Synchronisiert mit dem ersten Schluessel, auf den das Geraet antwortet. */
    void ensureSynced(IndividualAddress address, Entry e) throws InterruptedException {
        synchronized (e) {
            if (e.synced) return;
            List<Object[]> candidates = e.candidates();
            if (candidates.isEmpty()) throw new KnxSecureException("Fuer " + address + " ist kein Schluessel hinterlegt.");
            for (Object[] c : candidates) {
                KeyKind kind = (KeyKind) c[0];
                byte[] key = (byte[]) c[1];
                e.key = key;
                e.using = kind;
                if (!sync(address, e)) continue;    // Schluessel passt nicht - das Geraet schweigt
                // Ein Geraet ab Werk erwartet als naechstes womoeglich 1, unser Anfangswert. Calimero
                // synchronisierte dann gleich noch einmal - und ein Geraet beantwortet innerhalb einer
                // Sekunde keine zweite Anfrage (03/05/02 4.2). Ueber dem Anfangswert ist beides erledigt.
                if (toolSequence <= 1) updateSequenceNumber(true, 2);
                e.synced = true;
                e.preferFdsk = false;
                Listener l = listener;
                if (l != null) l.synced(address, e.serial, kind, key);
                return;
            }
            e.key = null;
            e.using = null;
            throw new KnxSecureException("Das Secure-Geraet " + address + " antwortet weder auf den gespeicherten Tool Key "
                    + "noch auf den FDSK. Ist es mit einem anderen Werkzeug in Betrieb genommen worden, hilft nur der "
                    + "Werkszustand am Geraet; danach gilt wieder der FDSK vom Zertifikat.");
        }
    }

    /** Eine Synchronisation mit dem Schluessel in {@code e.key}; false, wenn das Geraet nicht antwortet. */
    private boolean sync(IndividualAddress address, Entry e) throws InterruptedException {
        for (int attempt = 0; attempt < SYNC_ATTEMPTS; attempt++) {
            // Sonst schwiege das Geraet und der passende Schluessel saehe aus wie ein falscher
            Long last = lastSync.get(address);
            long wait = last == null ? 0 : SYNC_GAP_MS - (System.nanoTime() - last) / 1_000_000;
            if (wait > 0) Thread.sleep(wait);
            CompletableFuture<Void> unreadable = new CompletableFuture<>();
            garbled.put(address, unreadable);
            CompletableFuture<Void> answer;
            try {
                answer = sendSyncRequest(address, true);
                CompletableFuture.anyOf(answer, unreadable).get();
            } catch (ExecutionException timeout) {
                return false;
            } catch (KNXException x) {
                e.key = null;
                e.using = null;
                throw new KnxSecureException("Synchronisation mit " + address + " nicht gesendet: " + x.getMessage(), x);
            } finally {
                garbled.remove(address, unreadable);
            }
            lastSync.put(address, System.nanoTime());
            if (answer.isDone() && !answer.isCompletedExceptionally()) return true;
            // Calimero gaebe die offene Anfrage erst nach 6 s frei - und dann womoeglich die naechste mit
            answer.cancel(false);
        }
        return false;
    }

    /** Erzwingt eine neue Synchronisation und liefert, mit welchem Schluessel das Geraet arbeitet. */
    KeyKind resync(IndividualAddress address) throws InterruptedException {
        Entry e = entries.get(address);
        if (e == null) throw new KnxSecureException("Fuer " + address + " ist kein Schluessel gebunden.");
        e.synced = false;
        ensureSynced(address, e);
        return e.using;
    }

    void detachTransport() {
        transportLayer().detach();
    }
}
