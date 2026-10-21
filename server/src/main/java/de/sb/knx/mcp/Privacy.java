package de.sb.knx.mcp;

import de.sb.knx.json.Json;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.PosixFilePermissions;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Platzhalter fuer alles, was nicht zum KI-Anbieter darf: Begriffe, die der Nutzer sperrt oder die
 * im Projektnamen stehen, dazu erkannte Anschriften, Telefonnummern, E-Mail- und IP-Adressen.
 * Aus „Licht Büro Müller“ wird „Licht Büro «Name1»“. Die Zuordnung bleibt hier im Dienst; was die KI
 * mit Platzhaltern zurueckschreibt, setzt {@link #restore} wieder in Klartext um.
 *
 * Lieber zu viel ersetzt als zu wenig: Ein Platzhalter zu viel kostet Lesbarkeit, einer zu wenig
 * gibt eine Anschrift preis. Die Muster sind deshalb bewusst grob.
 */
public final class Privacy {

    /** Ab hier bekommt neuer Text nur noch einen Platzhalter ohne Rueckweg. */
    static final int MAX_ENTRIES = 5000;
    /** Kuerzere Sperrbegriffe wuerden halbe Woerter treffen und jeden Namen zerstueckeln. */
    public static final int MIN_TERM = 3;
    static final int MAX_TERM = 200;
    static final int MAX_TERMS = 2000;

    public enum Kind {
        NAME("Name"), ADDRESS("Adresse"), PHONE("Tel"), MAIL("Mail"), IP("IP");

        final String tag;

        Kind(String tag) {
            this.tag = tag;
        }
    }

    private static final String NOT_WORD_BEFORE = "(?<![\\p{L}\\p{N}])";
    private static final String NOT_WORD_AFTER = "(?![\\p{L}\\p{N}])";
    private static final String UNITS = "(?:Lux|Kelvin|Watt|Volt|Ampere|Hertz|Sekunden|Millisekunden|Minuten"
            + "|Stunden|Tage|Prozent|Grad|Meter|Liter|Pascal|Schritte|Impulse|Byte|Bit|Seconds|Minutes|Hours"
            + "|Days|Percent|Steps|Pulses)";
    private static final String HOUSE_NO = "\\s*\\d{1,4}(?:\\s?[a-zA-Z])?" + NOT_WORD_AFTER;

    private record Rule(Kind kind, Pattern pattern) {}

    private static final List<Rule> RULES = List.of(
            new Rule(Kind.MAIL, Pattern.compile(
                    "[\\p{L}\\p{N}._%+-]{1,64}@[\\p{L}\\p{N}-]{1,63}(?:\\.[\\p{L}\\p{N}-]{1,63})+")),
            new Rule(Kind.IP, Pattern.compile(
                    "(?<!\\d)(?<!\\d\\.)(?:(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)(?!\\d|\\.\\d)")),
            new Rule(Kind.PHONE, Pattern.compile(
                    NOT_WORD_BEFORE + "(?:\\+\\d{1,3}|00\\d{1,3}|0\\d{2,5})(?:[\\s/()-]{0,3}\\d){5,}(?!\\d)")),
            // Eindeutige Strassennamen, mit oder ohne Hausnummer: Hauptstraße, Lindenallee 4, Hauptstr. 3
            new Rule(Kind.ADDRESS, Pattern.compile(
                    NOT_WORD_BEFORE + "\\p{L}[\\p{L}'.-]*(?iu:straße|strasse|str\\.|gasse|allee|chaussee)"
                            + "(?:" + HOUSE_NO + ")?")),
            // Mehrdeutige Endungen nur mit Hausnummer: Birkenweg 7, Marktplatz 1 - nicht Arbeitsplatz 2 (s. NOT_STREETS)
            new Rule(Kind.ADDRESS, Pattern.compile(
                    NOT_WORD_BEFORE + "(\\p{L}[\\p{L}'-]*(?iu:weg|platz|ring|damm|ufer|steig|pfad|stieg|markt|berg"
                            + "|hof|garten|park|kamp|graben))" + HOUSE_NO)),
            // Getrennt geschrieben: Lange Straße 5, Am Weg 3, An der Kirche 12
            new Rule(Kind.ADDRESS, Pattern.compile(
                    NOT_WORD_BEFORE + "(?:\\p{L}[\\p{L}'-]*\\s+)?(?iu:straße|strasse|gasse|allee|weg|platz|ring)"
                            + HOUSE_NO)),
            new Rule(Kind.ADDRESS, Pattern.compile(
                    NOT_WORD_BEFORE + "(?iu:am|an der|an den|auf dem|auf der|im|in der|zum|zur|unter den"
                            + "|hinter der|vor dem)\\s+\\p{Lu}\\p{Ll}[\\p{L}-]*" + HOUSE_NO)),
            // Postleitzahl mit Ort: 90402 Nürnberg, D-90402 Nürnberg, 1010 Wien - nicht 1000 Lux
            new Rule(Kind.ADDRESS, Pattern.compile(
                    "(?<![\\p{N}.,/])(?:(?:D|A|CH)-)?\\d{4,5}\\s+(?!" + UNITS + NOT_WORD_AFTER + ")"
                            + "\\p{Lu}\\p{Ll}{2,}[\\p{L}-]*")));

    /**
     * Woerter mit Strassen-Endung, die in Gebaeuden fuer etwas anderes stehen. Mit Nummer
     * („Arbeitsplatz 2“) sind sie eine Raumangabe, keine Anschrift.
     */
    private static final Set<String> NOT_STREETS = Set.of(
            "arbeitsplatz", "stellplatz", "parkplatz", "sitzplatz", "spielplatz", "abstellplatz", "waschplatz",
            "lagerplatz", "standplatz", "schreibplatz", "liegeplatz", "einstellplatz", "wintergarten", "vorgarten",
            "dachgarten", "innenhof", "hinterhof", "lichthof", "fluchtweg", "rundweg", "gehweg", "zugangsweg",
            "laufweg", "kabelweg", "rettungsweg", "fahrweg");

    /** Woerter, die in Projektnamen ueblich sind und fuer sich nichts verraten. */
    private static final Set<String> GENERIC = Set.of(
            "haus", "häuser", "wohnung", "whg", "gebäude", "gebaeude", "objekt", "projekt", "neubau", "altbau",
            "umbau", "anbau", "sanierung", "modernisierung", "familie", "fam", "efh", "mfh", "zfh", "dhh",
            "einfamilienhaus", "mehrfamilienhaus", "zweifamilienhaus", "doppelhaus", "doppelhaushälfte",
            "reihenhaus", "villa", "bungalow", "büro", "buero", "praxis", "halle", "lager", "werk", "firma",
            "gmbh", "und", "der", "die", "das", "den", "dem", "von", "vom", "bei", "für", "fuer", "test",
            "beispiel", "muster", "demo", "knx", "home", "house", "project", "building", "office", "the",
            "and", "new", "old", "liegenschaft", "anlage", "kopie", "copy", "stand", "version", "entwurf");

    private static final Pattern PLACEHOLDER = Pattern.compile("«(Name|Adresse|Tel|Mail|IP)(\\d{1,5})»");

    private final Map<String, String> byText = new HashMap<>();
    private final Map<String, String> byTag = new HashMap<>();
    private final Map<Kind, Integer> counters = new EnumMap<>(Kind.class);
    private boolean dirty;

    /*
     * Die Zuordnung bleibt ueber einen Neustart erhalten, damit «Name1» in einem gespeicherten Gespraech
     * auch morgen noch dasselbe meint. Sie enthaelt den Klartext und liegt deshalb wie die Schluessel
     * nur fuer den Nutzer lesbar im Datenverzeichnis.
     */

    /** Liest eine gespeicherte Zuordnung; eine fehlende oder kaputte Datei ergibt eine leere. */
    public static Privacy load(Path file) {
        Privacy p = new Privacy();
        if (file == null || !Files.isRegularFile(file)) return p;
        try {
            Map<String, Object> doc = Json.parseObject(Files.readString(file, StandardCharsets.UTF_8));
            if (doc.get("tags") instanceof Map<?, ?> tags) {
                for (Map.Entry<?, ?> e : tags.entrySet()) {
                    if (!(e.getKey() instanceof String tag) || !(e.getValue() instanceof String original)) continue;
                    Matcher m = PLACEHOLDER.matcher(tag);
                    if (!m.matches() || original.length() > MAX_TERM * 4 || p.byText.size() >= MAX_ENTRIES) continue;
                    Kind kind = null;
                    for (Kind k : Kind.values()) if (k.tag.equals(m.group(1))) kind = k;
                    int n = Integer.parseInt(m.group(2));
                    p.byTag.put(tag, original);
                    p.byText.put(original.replaceAll("\\s+", " ").toLowerCase(Locale.ROOT), tag);
                    p.counters.merge(kind, n, Math::max);
                }
            }
        } catch (IOException | IllegalArgumentException e) {
            return new Privacy();
        }
        return p;
    }

    /** Schreibt die Zuordnung, wenn seit dem letzten Mal etwas dazukam. */
    public synchronized void saveIfChanged(Path file) throws IOException {
        if (!dirty || file == null) return;
        Files.createDirectories(file.getParent());
        Map<String, Object> tags = Json.obj();
        byTag.forEach(tags::put);
        Map<String, Object> doc = Json.obj();
        doc.put("tags", tags);
        Path tmp = file.resolveSibling(file.getFileName() + ".tmp");
        Files.deleteIfExists(tmp);
        if (FileSystems.getDefault().supportedFileAttributeViews().contains("posix")) {
            Files.createFile(tmp, PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
        }
        Files.writeString(tmp, Json.write(doc), StandardCharsets.UTF_8);
        Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING);
        dirty = false;
    }

    /**
     * Sperrbegriffe fuer einen Namen, der als Ganzes nie hinausgeht (Projekt, Liegenschaft): der Name
     * selbst und jedes Wort darin, das nicht nur allgemein ist - so bleibt „Familie Müller“ auch als
     * „Büro Müller“ verborgen.
     */
    public static List<String> termsOf(String name) {
        List<String> out = new ArrayList<>();
        if (name == null) return out;
        String n = name.strip();
        for (String w : n.split("[\\s,;:/()|·•_+&\"]+")) {
            String word = w.replaceAll("^[\\p{P}]+|[\\p{P}]+$", "");
            if (word.length() < MIN_TERM || word.chars().allMatch(Character::isDigit)) continue;
            if (GENERIC.contains(word.toLowerCase(Locale.ROOT))) continue;
            out.add(word);
        }
        // Der ganze Name nur, wenn er etwas verraet - „Projekt“ oder „Haus 12“ allein tun das nicht
        if (!out.isEmpty() && n.length() >= MIN_TERM) out.add(0, n);
        return out;
    }

    /** Bereitet die Sperrbegriffe einer Antwort vor: begrenzt, ohne Dubletten, laengste zuerst. */
    public static Pattern compileTerms(Collection<String> terms) {
        Set<String> seen = new LinkedHashSet<>();
        for (String t : terms) {
            if (t == null) continue;
            String s = Normalizer.normalize(t.strip(), Normalizer.Form.NFC);
            if (s.length() < MIN_TERM || s.length() > MAX_TERM) continue;
            seen.add(s);
            if (seen.size() >= MAX_TERMS) break;
        }
        if (seen.isEmpty()) return null;
        List<String> list = new ArrayList<>(seen);
        list.sort(Comparator.comparingInt(String::length).reversed());
        StringBuilder sb = new StringBuilder();
        for (String s : list) {
            if (!sb.isEmpty()) sb.append('|');
            sb.append(Pattern.quote(s));
        }
        return Pattern.compile(sb.toString(), Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
    }

    private record Span(int start, int end, Kind kind) {}

    /** Ersetzt alles Schutzwuerdige in einem Text durch Platzhalter. */
    public synchronized String mask(String text, Pattern terms) {
        if (text == null || text.isEmpty()) return text;
        // Wer schon Platzhalterzeichen in seinen Daten hat, soll keine falschen Platzhalter bauen koennen
        String s = Normalizer.normalize(text, Normalizer.Form.NFC).replace('«', '‹').replace('»', '›');

        List<Span> spans = new ArrayList<>();
        if (terms != null) collect(spans, terms.matcher(s), Kind.NAME);
        for (Rule r : RULES) collect(spans, r.pattern.matcher(s), r.kind);
        if (spans.isEmpty()) return s;

        // Frueher Beginn gewinnt, bei gleichem Beginn der laengere Treffer; Ueberlappendes faellt weg
        spans.sort(Comparator.comparingInt(Span::start).thenComparing(Comparator.comparingInt(Span::end).reversed()));
        StringBuilder out = new StringBuilder(s.length());
        int at = 0;
        for (Span sp : spans) {
            if (sp.start < at) continue;
            out.append(s, at, sp.start);
            out.append(placeholder(sp.kind, s.substring(sp.start, sp.end)));
            at = sp.end;
        }
        out.append(s, at, s.length());
        return out.toString();
    }

    private static void collect(List<Span> spans, Matcher m, Kind kind) {
        while (m.find()) {
            if (m.end() <= m.start()) continue;
            // Regeln mit Gruppe nennen das Wort vor der Hausnummer - manches davon ist keine Strasse
            if (m.groupCount() >= 1 && m.group(1) != null
                    && NOT_STREETS.contains(m.group(1).toLowerCase(Locale.ROOT))) continue;
            spans.add(new Span(m.start(), m.end(), kind));
        }
    }

    private String placeholder(Kind kind, String original) {
        String key = original.strip().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
        String known = byText.get(key);
        if (known != null) return known;
        if (byText.size() >= MAX_ENTRIES) return "«" + kind.tag + "»";
        int n = counters.merge(kind, 1, Integer::sum);
        String tag = "«" + kind.tag + n + "»";
        byText.put(key, tag);
        byTag.put(tag, original.strip());
        dirty = true;
        return tag;
    }

    /**
     * Setzt die Platzhalter in einer Eingabe der KI wieder in Klartext um. Einen unbekannten
     * Platzhalter lehnt das ab - er stammt aus einer frueheren Sitzung oder ist erfunden.
     */
    public synchronized String restore(String text) {
        if (text == null || text.indexOf('«') < 0) return text;
        Matcher m = PLACEHOLDER.matcher(text);
        StringBuilder out = new StringBuilder(text.length());
        while (m.find()) {
            String original = byTag.get(m.group());
            if (original == null) throw new IllegalArgumentException("Unbekannter Platzhalter " + m.group());
            m.appendReplacement(out, Matcher.quoteReplacement(original));
        }
        m.appendTail(out);
        return out.toString();
    }

    /** Wie {@link #restore}, aber fuer die Anzeige: Unbekannte Platzhalter bleiben einfach stehen. */
    public synchronized String restoreLenient(String text) {
        return restoreForDisplay(text, false);
    }

    /* Markiert eingesetzten Klartext fuer die Anzeige: MARK_A Platzhalter MARK_B Klartext MARK_C.
       Zeichen aus dem privaten Bereich, die in Projekttexten nicht vorkommen. */
    public static final char MARK_A = '\uE000', MARK_B = '\uE001', MARK_C = '\uE002';

    /**
     * Fuer den Chat: Klartext einsetzen und kenntlich machen, damit ein Satz wie „bei mir heisst es nur
     * «Name1»“ nicht zu Unsinn wird. Was die KI selbst an Markierungszeichen liefert, faellt weg.
     */
    public synchronized String restoreMarked(String text) {
        return restoreForDisplay(text, true);
    }

    private String restoreForDisplay(String text, boolean mark) {
        if (text == null) return null;
        if (mark) text = text.replace(String.valueOf(MARK_A), "").replace(String.valueOf(MARK_B), "").replace(String.valueOf(MARK_C), "");
        if (text.indexOf('«') < 0) return text;
        Matcher m = PLACEHOLDER.matcher(text);
        StringBuilder out = new StringBuilder(text.length());
        while (m.find()) {
            String original = byTag.get(m.group());
            String rep = original == null ? m.group() : mark ? MARK_A + m.group() + MARK_B + original + MARK_C : original;
            m.appendReplacement(out, Matcher.quoteReplacement(rep));
        }
        m.appendTail(out);
        return out.toString();
    }

    synchronized int size() {
        return byText.size();
    }
}
