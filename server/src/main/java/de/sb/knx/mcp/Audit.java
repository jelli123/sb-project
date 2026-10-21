package de.sb.knx.mcp;

import de.sb.knx.json.Json;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.Map;

/**
 * Protokoll aller KI-Aufrufe, eine JSON-Zeile je Aufruf, im Datenverzeichnis. Argumente stehen so
 * darin, wie die KI sie geschickt hat - also mit Platzhaltern, nie im Klartext.
 */
final class Audit {

    private static final long MAX_BYTES = 1 << 20;

    private final Path file;
    private boolean warned;

    Audit(Path dir) {
        this.file = dir.resolve("audit.log");
    }

    synchronized void write(Map<String, Object> entry) {
        try {
            if (Files.isRegularFile(file) && Files.size(file) > MAX_BYTES) {
                Files.move(file, file.resolveSibling("audit.log.1"), StandardCopyOption.REPLACE_EXISTING);
            }
            Files.writeString(file, Json.write(entry) + "\n", StandardCharsets.UTF_8,
                    StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        } catch (IOException e) {
            if (!warned) System.err.println("KI-Protokoll nicht schreibbar: " + e.getMessage());
            warned = true;
        }
    }
}
