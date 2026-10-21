package de.sb.knx.mcp;

import de.sb.knx.json.Json;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Beschreibt, was in einem Tool-Ergebnis stehen darf und was ein Tool als Argument annimmt.
 *
 * <p>Ergebnisse ({@link #out}) werden nach dem Allowlist-Prinzip kopiert: Nur beschriebene Felder
 * kommen mit, alles andere faellt weg und wird gezaehlt - auch Felder, die es heute noch gar nicht
 * gibt. Nutzertext bekommt dabei Platzhalter (siehe {@link Privacy}).
 *
 * <p>Argumente ({@link #in}) werden streng geprueft: Ein unbekanntes Feld oder ein falscher Typ ist
 * ein Fehler, kein stilles Verwerfen - die KI soll erfahren, was sie falsch gemacht hat.
 *
 * <p>Aus derselben Beschreibung entsteht das JSON-Schema fuer {@code tools/list}.
 */
public abstract class Shape {

    /** Markiert einen Wert, der nicht in die Kopie gehoert. */
    static final Object DROP = new Object();

    /** Laufende Pruefung eines Ergebnisses: Platzhalter und Buchfuehrung ueber Verworfenes. */
    static final class Out {
        final Privacy privacy;
        final Pattern terms;
        int dropped;
        boolean truncated;
        final List<String> droppedPaths = new ArrayList<>();

        Out(Privacy privacy, Pattern terms) {
            this.privacy = privacy;
            this.terms = terms;
        }

        Object drop(String path) {
            dropped++;
            if (droppedPaths.size() < 20) droppedPaths.add(path);
            return DROP;
        }
    }

    abstract Object out(Object v, Out ctx, String path);

    abstract Object in(Object v, Privacy privacy, String path);

    abstract Map<String, Object> schema();

    /* ================= Bausteine ================= */

    /** Nutzertext (Namen, Meldungen): begrenzt, ohne Steuerzeichen, mit Platzhaltern. */
    static Shape text(int max) {
        return new Text(max, true);
    }

    /** Text aus Produktdaten (Hersteller, Parametertexte): begrenzt und bereinigt, aber ohne Platzhalter. */
    static Shape catalogText(int max) {
        return new Text(max, false);
    }

    /** Interne Kennung aus dem Projekt (n12, d59, M-0083_A-…). */
    static Shape id() {
        return new Token("[A-Za-z0-9_.:#-]{1,120}", "Kennung");
    }

    /** Kennung eines freigegebenen Projekts, wie list_projects sie nennt. */
    static Shape handle() {
        return new Token("p\\d{1,3}", "Projektkennung wie p1 (siehe list_projects)");
    }

    /** Physikalische Adresse 1.1.3. */
    static Shape pa() {
        return new Token("\\d{1,2}\\.\\d{1,2}\\.\\d{1,3}", "physikalische Adresse");
    }

    /** Gruppenadresse oder Adressbereich: 1/2/3, 1/2, 1, 2305 (frei). */
    static Shape ga() {
        return new Token("\\d{1,5}(?:/\\d{1,5}){0,2}", "Gruppenadresse");
    }

    static Shape dpt() {
        return new Token("\\d{1,3}(?:\\.\\d{3,5})?", "Datenpunkttyp");
    }

    /** Nur fuer Antworten, die der Nutzer ausdruecklich freigegeben hat (IP-Konfiguration). */
    static Shape ipv4() {
        return new Token("(?:(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)", "IPv4-Adresse");
    }

    /** Kurzes Schluesselwort (Knotentyp, Funktionsart, Medium). */
    static Shape word() {
        return new Token("[a-zA-Z][a-zA-Z0-9-]{0,31}", "Schluesselwort");
    }

    static Shape integer(long min, long max) {
        return new Int(min, max);
    }

    static Shape bool() {
        return new Bool();
    }

    static Shape oneOf(String... values) {
        return new OneOf(List.of(values));
    }

    static Shape nullable(Shape s) {
        return new Nullable(s);
    }

    static Shape list(Shape item, int max) {
        return new ListOf(item, max);
    }

    static Obj obj(Field... fields) {
        return new Obj(Arrays.asList(fields));
    }

    record Field(String name, Shape shape, boolean required, String description) {}

    static Field req(String name, Shape shape, String description) {
        return new Field(name, shape, true, description);
    }

    static Field opt(String name, Shape shape, String description) {
        return new Field(name, shape, false, description);
    }

    static Field f(String name, Shape shape) {
        return new Field(name, shape, false, null);
    }

    /* ================= Umsetzung ================= */

    private static final class Text extends Shape {
        final int max;
        final boolean masked;

        Text(int max, boolean masked) {
            this.max = max;
            this.masked = masked;
        }

        @Override
        Object out(Object v, Out ctx, String path) {
            if (!(v instanceof String s)) return ctx.drop(path);
            String clean = clean(s, max);
            return masked ? ctx.privacy.mask(clean, ctx.terms) : clean;
        }

        @Override
        Object in(Object v, Privacy privacy, String path) {
            if (!(v instanceof String s)) throw bad(path, "Text erwartet");
            if (s.length() > max) throw bad(path, "hoechstens " + max + " Zeichen");
            String clean = clean(s, max);
            return privacy != null ? privacy.restore(clean) : clean;
        }

        @Override
        Map<String, Object> schema() {
            Map<String, Object> m = Json.obj();
            m.put("type", "string");
            m.put("maxLength", max);
            return m;
        }
    }

    /** Steuer- und Formatzeichen raus (auch Bidi-Umschalter), Laenge begrenzen. */
    static String clean(String s, int max) {
        StringBuilder sb = new StringBuilder(Math.min(s.length(), max));
        for (int i = 0; i < s.length() && sb.length() < max; i++) {
            char c = s.charAt(i);
            int type = Character.getType(c);
            if (type == Character.CONTROL || type == Character.FORMAT) {
                if (c == '\n' || c == '\t') sb.append(' ');
                continue;
            }
            if (Character.isHighSurrogate(c) && sb.length() + 1 >= max) break;
            sb.append(c);
        }
        return sb.toString().strip();
    }

    private static final class Token extends Shape {
        final Pattern pattern;
        final String what;

        Token(String regex, String what) {
            this.pattern = Pattern.compile(regex);
            this.what = what;
        }

        @Override
        Object out(Object v, Out ctx, String path) {
            return v instanceof String s && pattern.matcher(s).matches() ? s : ctx.drop(path);
        }

        @Override
        Object in(Object v, Privacy privacy, String path) {
            if (!(v instanceof String s) || !pattern.matcher(s).matches()) throw bad(path, what + " erwartet");
            return s;
        }

        @Override
        Map<String, Object> schema() {
            Map<String, Object> m = Json.obj();
            m.put("type", "string");
            m.put("pattern", "^" + pattern.pattern() + "$");
            return m;
        }
    }

    private static final class Int extends Shape {
        final long min, max;

        Int(long min, long max) {
            this.min = min;
            this.max = max;
        }

        private Long value(Object v) {
            if (v instanceof Long l) return l;
            if (v instanceof Integer i) return (long) i;
            if (v instanceof Double d && d == Math.rint(d) && Math.abs(d) < 1e15) return d.longValue();
            return null;
        }

        @Override
        Object out(Object v, Out ctx, String path) {
            Long l = value(v);
            return l != null && l >= min && l <= max ? l : ctx.drop(path);
        }

        @Override
        Object in(Object v, Privacy privacy, String path) {
            Long l = value(v);
            if (l == null) throw bad(path, "ganze Zahl erwartet");
            if (l < min || l > max) throw bad(path, "erlaubt ist " + min + " bis " + max);
            return l;
        }

        @Override
        Map<String, Object> schema() {
            Map<String, Object> m = Json.obj();
            m.put("type", "integer");
            m.put("minimum", min);
            m.put("maximum", max);
            return m;
        }
    }

    private static final class Bool extends Shape {
        @Override
        Object out(Object v, Out ctx, String path) {
            return v instanceof Boolean ? v : ctx.drop(path);
        }

        @Override
        Object in(Object v, Privacy privacy, String path) {
            if (!(v instanceof Boolean)) throw bad(path, "true oder false erwartet");
            return v;
        }

        @Override
        Map<String, Object> schema() {
            Map<String, Object> m = Json.obj();
            m.put("type", "boolean");
            return m;
        }
    }

    private static final class OneOf extends Shape {
        final List<String> values;

        OneOf(List<String> values) {
            this.values = values;
        }

        @Override
        Object out(Object v, Out ctx, String path) {
            return v instanceof String s && values.contains(s) ? s : ctx.drop(path);
        }

        @Override
        Object in(Object v, Privacy privacy, String path) {
            if (!(v instanceof String s) || !values.contains(s)) throw bad(path, "erlaubt ist " + String.join(", ", values));
            return s;
        }

        @Override
        Map<String, Object> schema() {
            Map<String, Object> m = Json.obj();
            m.put("type", "string");
            m.put("enum", values);
            return m;
        }
    }

    private static final class Nullable extends Shape {
        final Shape inner;

        Nullable(Shape inner) {
            this.inner = inner;
        }

        @Override
        Object out(Object v, Out ctx, String path) {
            return v == null ? null : inner.out(v, ctx, path);
        }

        @Override
        Object in(Object v, Privacy privacy, String path) {
            return v == null ? null : inner.in(v, privacy, path);
        }

        @Override
        Map<String, Object> schema() {
            Map<String, Object> m = new LinkedHashMap<>(inner.schema());
            m.put("type", List.of(String.valueOf(m.get("type")), "null"));
            return m;
        }
    }

    private static final class ListOf extends Shape {
        final Shape item;
        final int max;

        ListOf(Shape item, int max) {
            this.item = item;
            this.max = max;
        }

        @Override
        Object out(Object v, Out ctx, String path) {
            if (!(v instanceof List<?> l)) return ctx.drop(path);
            List<Object> copy = new ArrayList<>(Math.min(l.size(), max));
            for (int i = 0; i < l.size(); i++) {
                if (copy.size() >= max) {
                    ctx.truncated = true;
                    break;
                }
                Object x = item.out(l.get(i), ctx, path + "[" + i + "]");
                if (x != DROP) copy.add(x);
            }
            return copy;
        }

        @Override
        Object in(Object v, Privacy privacy, String path) {
            if (!(v instanceof List<?> l)) throw bad(path, "Liste erwartet");
            if (l.size() > max) throw bad(path, "hoechstens " + max + " Eintraege");
            List<Object> copy = new ArrayList<>(l.size());
            for (int i = 0; i < l.size(); i++) copy.add(item.in(l.get(i), privacy, path + "[" + i + "]"));
            return copy;
        }

        @Override
        Map<String, Object> schema() {
            Map<String, Object> m = Json.obj();
            m.put("type", "array");
            m.put("items", item.schema());
            m.put("maxItems", max);
            return m;
        }
    }

    static final class Obj extends Shape {
        final List<Field> fields;

        Obj(List<Field> fields) {
            this.fields = fields;
        }

        @Override
        Object out(Object v, Out ctx, String path) {
            if (!(v instanceof Map<?, ?> m)) return ctx.drop(path);
            Map<String, Object> copy = Json.obj();
            for (Field f : fields) {
                if (!m.containsKey(f.name)) continue;
                Object x = f.shape.out(m.get(f.name), ctx, path + "." + f.name);
                if (x != DROP) copy.put(f.name, x);
            }
            for (Object k : m.keySet()) {
                if (fields.stream().noneMatch(f -> f.name.equals(k))) ctx.drop(path + "." + k);
            }
            return copy;
        }

        @Override
        Map<String, Object> in(Object v, Privacy privacy, String path) {
            if (v == null) v = Map.of();
            if (!(v instanceof Map<?, ?> m)) throw bad(path, "Objekt erwartet");
            for (Object k : m.keySet()) {
                if (fields.stream().noneMatch(f -> f.name.equals(k))) throw bad(path + "." + k, "unbekanntes Feld");
            }
            Map<String, Object> copy = Json.obj();
            for (Field f : fields) {
                Object x = m.get(f.name);
                if (x == null) {
                    if (f.required) throw bad(path + "." + f.name, "fehlt");
                    continue;
                }
                copy.put(f.name, f.shape.in(x, privacy, path + "." + f.name));
            }
            return copy;
        }

        @Override
        Map<String, Object> schema() {
            Map<String, Object> m = Json.obj();
            m.put("type", "object");
            Map<String, Object> props = Json.obj();
            List<Object> required = Json.arr();
            for (Field f : fields) {
                Map<String, Object> s = new LinkedHashMap<>(f.shape.schema());
                if (f.description != null) s.put("description", f.description);
                props.put(f.name, s);
                if (f.required) required.add(f.name);
            }
            m.put("properties", props);
            if (!required.isEmpty()) m.put("required", required);
            m.put("additionalProperties", false);
            return m;
        }
    }

    private static IllegalArgumentException bad(String path, String msg) {
        String p = path.startsWith(".") ? path.substring(1) : path;
        return new IllegalArgumentException((p.isEmpty() ? "Argumente" : p) + ": " + msg);
    }
}
