package de.sb.knx.store;

import de.sb.knx.json.Json;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Locale;

/** Gemeinsame Grundlage der Ablagen: sichere Namen und ein atomares Schreiben mit Sicherung. */
public abstract class FileStore {

    protected final Path dir;

    protected FileStore(Path dir) throws IOException {
        this.dir = dir;
        Files.createDirectories(dir);
    }

    /**
     * Macht aus einem beliebigen Namen einen Dateinamen ohne Pfadanteile.
     * Nur so bleibt ein von der Oberflaeche gelieferter Bezeichner unschaedlich.
     */
    public static String safeId(String raw) {
        if (raw == null) throw new IllegalArgumentException("Bezeichner fehlt");
        String s = raw.trim().replace('\\', '_').replace('/', '_');
        StringBuilder sb = new StringBuilder(s.length());
        for (int i = 0; i < s.length() && sb.length() < 80; i++) {
            char c = s.charAt(i);
            boolean ok = Character.isLetterOrDigit(c) || c == ' ' || c == '-' || c == '_' || c == '.'
                    || c == '(' || c == ')' || c == '+';
            sb.append(ok ? c : '_');
        }
        String out = sb.toString().trim();
        while (out.startsWith(".")) out = out.substring(1);
        if (out.isEmpty() || out.equalsIgnoreCase("con") || out.equalsIgnoreCase("nul")) {
            throw new IllegalArgumentException("Unbrauchbarer Bezeichner: " + raw);
        }
        return out;
    }

    protected Path file(String id, String suffix) {
        Path p = dir.resolve(safeId(id) + suffix).normalize();
        if (!p.startsWith(dir)) throw new IllegalArgumentException("Pfad ausserhalb der Ablage");
        return p;
    }

    /** Erst in eine Nebendatei schreiben, dann tauschen - ein Absturz laesst nie eine halbe Datei zurueck. */
    protected void writeAtomic(Path target, byte[] content, boolean keepBackup) throws IOException {
        Path tmp = target.resolveSibling(target.getFileName() + ".tmp");
        Files.write(tmp, content);
        if (keepBackup && Files.exists(target)) {
            Files.move(target, target.resolveSibling(target.getFileName() + ".bak"),
                    StandardCopyOption.REPLACE_EXISTING);
        }
        try {
            Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException e) {
            Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    protected static void validateJson(String text) {
        Json.parse(text);
    }

    protected static byte[] utf8(String s) {
        return s.getBytes(StandardCharsets.UTF_8);
    }

    protected static String lower(String s) {
        return s == null ? "" : s.toLowerCase(Locale.ROOT);
    }
}
