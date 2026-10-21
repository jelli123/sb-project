package de.sb.knx.mcp;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;

/**
 * Zugangsschluessel fuer den MCP-Endpunkt. Er liegt in einer Datei, die nur der Nutzer lesen darf,
 * und gelangt nie ueber die HTTP-Schnittstelle nach aussen - der Einrichtungsbefehl liest ihn
 * direkt aus der Datei. So kommt ein anderes Benutzerkonto auf demselben Rechner nicht an die KI-Tools.
 */
final class AccessToken {

    private final Path file;
    private volatile byte[] value;

    AccessToken(Path dir) throws IOException {
        Files.createDirectories(dir);
        this.file = dir.resolve("token");
        String existing = Files.isRegularFile(file) ? Files.readString(file, StandardCharsets.US_ASCII).strip() : "";
        if (existing.matches("[A-Za-z0-9_-]{32,128}")) value = existing.getBytes(StandardCharsets.US_ASCII);
        else rotate();
    }

    Path file() {
        return file;
    }

    /** Neuer Schluessel; der alte gilt ab sofort nicht mehr. */
    synchronized void rotate() throws IOException {
        byte[] raw = new byte[32];
        new SecureRandom().nextBytes(raw);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
        Path tmp = file.resolveSibling("token.tmp");
        Files.deleteIfExists(tmp);
        if (FileSystems.getDefault().supportedFileAttributeViews().contains("posix")) {
            Files.createFile(tmp, PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
        }
        Files.writeString(tmp, token + "\n", StandardCharsets.US_ASCII);
        Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING);
        value = token.getBytes(StandardCharsets.US_ASCII);
    }

    /** Prueft den Authorization-Kopf in konstanter Zeit. */
    boolean check(String authorization) {
        if (authorization == null || !authorization.regionMatches(true, 0, "Bearer ", 0, 7)) return false;
        byte[] given = authorization.substring(7).strip().getBytes(StandardCharsets.US_ASCII);
        return MessageDigest.isEqual(given, value);
    }
}
