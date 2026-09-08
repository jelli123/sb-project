package de.sb.knx.json;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Minimaler JSON-Leser/Schreiber, damit der Dienst ohne Fremdbibliothek auskommt. */
public final class Json {

    private static final int MAX_DEPTH = 200;

    /** Bereits serialisiertes JSON, das unveraendert durchgereicht wird. */
    public record Raw(String json) {}

    private Json() {}

    public static Map<String, Object> obj() {
        return new LinkedHashMap<>();
    }

    public static List<Object> arr() {
        return new ArrayList<>();
    }

    /* ---------------- schreiben ---------------- */

    public static String write(Object value) {
        StringBuilder sb = new StringBuilder(256);
        write(value, sb, 0);
        return sb.toString();
    }

    private static void write(Object v, StringBuilder sb, int depth) {
        if (depth > MAX_DEPTH) throw new IllegalArgumentException("JSON zu tief verschachtelt");
        if (v == null) {
            sb.append("null");
        } else if (v instanceof Raw raw) {
            sb.append(raw.json());
        } else if (v instanceof String s) {
            escape(s, sb);
        } else if (v instanceof Boolean b) {
            sb.append(b ? "true" : "false");
        } else if (v instanceof Double || v instanceof Float) {
            double d = ((Number) v).doubleValue();
            if (Double.isNaN(d) || Double.isInfinite(d)) sb.append("null");
            else if (d == Math.rint(d) && Math.abs(d) < 1e15) sb.append((long) d);
            else sb.append(d);
        } else if (v instanceof Number n) {
            sb.append(n);
        } else if (v instanceof Map<?, ?> m) {
            sb.append('{');
            boolean first = true;
            for (Map.Entry<?, ?> e : m.entrySet()) {
                if (!first) sb.append(',');
                first = false;
                escape(String.valueOf(e.getKey()), sb);
                sb.append(':');
                write(e.getValue(), sb, depth + 1);
            }
            sb.append('}');
        } else if (v instanceof Iterable<?> it) {
            sb.append('[');
            boolean first = true;
            for (Object o : it) {
                if (!first) sb.append(',');
                first = false;
                write(o, sb, depth + 1);
            }
            sb.append(']');
        } else if (v instanceof Object[] a) {
            write(List.of(a), sb, depth);
        } else {
            escape(String.valueOf(v), sb);
        }
    }

    private static void escape(String s, StringBuilder sb) {
        sb.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                case '\b' -> sb.append("\\b");
                case '\f' -> sb.append("\\f");
                default -> {
                    if (c < 0x20 || c == 0x2028 || c == 0x2029) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
                }
            }
        }
        sb.append('"');
    }

    /* ---------------- lesen ---------------- */

    public static Object parse(String text) {
        Parser p = new Parser(text);
        p.ws();
        Object v = p.value(0);
        p.ws();
        if (p.pos < p.src.length()) throw new IllegalArgumentException("Zeichen nach dem JSON-Dokument");
        return v;
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> parseObject(String text) {
        Object v = parse(text);
        if (!(v instanceof Map)) throw new IllegalArgumentException("JSON-Objekt erwartet");
        return (Map<String, Object>) v;
    }

    /* ---------------- Zugriffshilfen ---------------- */

    public static String str(Map<String, Object> m, String key, String fallback) {
        Object v = m.get(key);
        return v instanceof String s && !s.isEmpty() ? s : fallback;
    }

    public static int integer(Map<String, Object> m, String key, int fallback) {
        Object v = m.get(key);
        if (v instanceof Number n) return n.intValue();
        if (v instanceof String s) {
            try {
                return Integer.parseInt(s.trim());
            } catch (NumberFormatException ignored) {
                return fallback;
            }
        }
        return fallback;
    }

    public static boolean bool(Map<String, Object> m, String key, boolean fallback) {
        Object v = m.get(key);
        if (v instanceof Boolean b) return b;
        if (v instanceof String s) return "true".equalsIgnoreCase(s) || "1".equals(s);
        return fallback;
    }

    private static final class Parser {
        private final String src;
        private int pos;

        Parser(String src) {
            this.src = src;
        }

        void ws() {
            while (pos < src.length()) {
                char c = src.charAt(pos);
                if (c == ' ' || c == '\t' || c == '\n' || c == '\r') pos++;
                else break;
            }
        }

        Object value(int depth) {
            if (depth > MAX_DEPTH) throw new IllegalArgumentException("JSON zu tief verschachtelt");
            if (pos >= src.length()) throw new IllegalArgumentException("JSON unerwartet zu Ende");
            char c = src.charAt(pos);
            return switch (c) {
                case '{' -> object(depth);
                case '[' -> array(depth);
                case '"' -> string();
                case 't' -> literal("true", Boolean.TRUE);
                case 'f' -> literal("false", Boolean.FALSE);
                case 'n' -> literal("null", null);
                default -> number();
            };
        }

        private Map<String, Object> object(int depth) {
            Map<String, Object> m = new LinkedHashMap<>();
            pos++;
            ws();
            if (peek() == '}') {
                pos++;
                return m;
            }
            while (true) {
                ws();
                if (peek() != '"') throw new IllegalArgumentException("Objektschluessel erwartet an Position " + pos);
                String key = string();
                ws();
                expect(':');
                ws();
                m.put(key, value(depth + 1));
                ws();
                char c = next();
                if (c == '}') return m;
                if (c != ',') throw new IllegalArgumentException("',' oder '}' erwartet an Position " + (pos - 1));
            }
        }

        private List<Object> array(int depth) {
            List<Object> l = new ArrayList<>();
            pos++;
            ws();
            if (peek() == ']') {
                pos++;
                return l;
            }
            while (true) {
                ws();
                l.add(value(depth + 1));
                ws();
                char c = next();
                if (c == ']') return l;
                if (c != ',') throw new IllegalArgumentException("',' oder ']' erwartet an Position " + (pos - 1));
            }
        }

        private String string() {
            expect('"');
            StringBuilder sb = new StringBuilder();
            while (true) {
                char c = next();
                if (c == '"') return sb.toString();
                if (c != '\\') {
                    sb.append(c);
                    continue;
                }
                char e = next();
                switch (e) {
                    case '"' -> sb.append('"');
                    case '\\' -> sb.append('\\');
                    case '/' -> sb.append('/');
                    case 'b' -> sb.append('\b');
                    case 'f' -> sb.append('\f');
                    case 'n' -> sb.append('\n');
                    case 'r' -> sb.append('\r');
                    case 't' -> sb.append('\t');
                    case 'u' -> {
                        if (pos + 4 > src.length()) throw new IllegalArgumentException("Unvollstaendige \\u-Sequenz");
                        sb.append((char) Integer.parseInt(src.substring(pos, pos + 4), 16));
                        pos += 4;
                    }
                    default -> throw new IllegalArgumentException("Unbekannte Escape-Sequenz \\" + e);
                }
            }
        }

        private Object number() {
            int start = pos;
            if (peek() == '-') pos++;
            while (pos < src.length()) {
                char c = src.charAt(pos);
                if ((c >= '0' && c <= '9') || c == '.' || c == 'e' || c == 'E' || c == '+' || c == '-') pos++;
                else break;
            }
            String s = src.substring(start, pos);
            if (s.isEmpty()) throw new IllegalArgumentException("Zahl erwartet an Position " + start);
            if (s.indexOf('.') < 0 && s.indexOf('e') < 0 && s.indexOf('E') < 0) {
                try {
                    return Long.parseLong(s);
                } catch (NumberFormatException ignored) {
                    // faellt auf double zurueck
                }
            }
            return Double.parseDouble(s);
        }

        private Object literal(String word, Object value) {
            if (!src.startsWith(word, pos)) throw new IllegalArgumentException("Unbekanntes Literal an Position " + pos);
            pos += word.length();
            return value;
        }

        private char peek() {
            return pos < src.length() ? src.charAt(pos) : '\0';
        }

        private char next() {
            if (pos >= src.length()) throw new IllegalArgumentException("JSON unerwartet zu Ende");
            return src.charAt(pos++);
        }

        private void expect(char c) {
            if (next() != c) throw new IllegalArgumentException("'" + c + "' erwartet an Position " + (pos - 1));
        }
    }
}
