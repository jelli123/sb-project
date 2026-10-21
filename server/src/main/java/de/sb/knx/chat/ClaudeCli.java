package de.sb.knx.chat;

import java.io.File;
import java.io.IOException;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Findet die Claude-Code-Kommandozeile, mit der der Chat arbeitet. Reihenfolge: ausdruecklich
 * angegeben ({@code --claude}), dann der Suchpfad, dann die neueste Fassung, die die VS-Code-
 * Erweiterung oder Claude Desktop mitbringen - beide legen jede Version in einem eigenen Ordner ab.
 */
final class ClaudeCli {

    private static final Pattern VERSION = Pattern.compile("(\\d+(?:\\.\\d+)+)");

    private ClaudeCli() {}

    static Path find(Path override) {
        if (override != null) return Files.isExecutable(override) ? override : null;
        boolean win = System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win");
        String[] names = win ? new String[] {"claude.exe", "claude.cmd"} : new String[] {"claude"};
        String path = System.getenv("PATH");
        if (path != null) {
            for (String dir : path.split(File.pathSeparator)) {
                for (String n : names) {
                    Path p = Paths.get(dir, n);
                    if (Files.isExecutable(p) && !Files.isDirectory(p)) return p;
                }
            }
        }
        Path home = Paths.get(System.getProperty("user.home"));
        List<Path> found = new ArrayList<>();
        String bin = win ? "claude.exe" : "claude";
        collect(found, home.resolve(".var/app/com.visualstudio.code/data/vscode/extensions"), "anthropic.claude-code-*",
                "resources/native-binary/" + bin);
        collect(found, home.resolve(".vscode/extensions"), "anthropic.claude-code-*", "resources/native-binary/" + bin);
        Path desktop = win ? appData("Claude") : home.resolve(".config/Claude");
        if (desktop != null) collectDesktop(found, desktop.resolve("claude-code"), bin);
        Path best = null;
        String bestV = null;
        for (Path p : found) {
            String v = version(p.toString());
            if (v != null && (bestV == null || compare(v, bestV) > 0)) {
                best = p;
                bestV = v;
            }
        }
        return best;
    }

    private static Path appData(String name) {
        String a = System.getenv("APPDATA");
        return a == null ? null : Paths.get(a, name);
    }

    private static void collect(List<Path> out, Path dir, String glob, String rel) {
        if (!Files.isDirectory(dir)) return;
        try (DirectoryStream<Path> ds = Files.newDirectoryStream(dir, glob)) {
            for (Path p : ds) {
                Path bin = p.resolve(rel);
                if (Files.isExecutable(bin)) out.add(bin);
            }
        } catch (IOException ignored) {
            // nicht lesbar - dann eben nicht
        }
    }

    /** Claude Desktop: claude-code/&lt;version&gt;/&lt;pruefsumme&gt;/claude */
    private static void collectDesktop(List<Path> out, Path dir, String bin) {
        if (!Files.isDirectory(dir)) return;
        try (DirectoryStream<Path> versions = Files.newDirectoryStream(dir)) {
            for (Path v : versions) {
                if (!Files.isDirectory(v)) continue;
                try (DirectoryStream<Path> hashes = Files.newDirectoryStream(v)) {
                    for (Path h : hashes) {
                        Path p = h.resolve(bin);
                        if (Files.isExecutable(p)) out.add(p);
                    }
                }
            }
        } catch (IOException ignored) {
            // nicht lesbar - dann eben nicht
        }
    }

    static String version(String path) {
        Matcher m = VERSION.matcher(path.replace('\\', '/').replaceAll(".*(claude-code[-/])", ""));
        return m.find() ? m.group(1) : null;
    }

    static int compare(String a, String b) {
        String[] x = a.split("\\."), y = b.split("\\.");
        for (int i = 0; i < Math.max(x.length, y.length); i++) {
            int u = i < x.length ? Integer.parseInt(x[i]) : 0, v = i < y.length ? Integer.parseInt(y[i]) : 0;
            if (u != v) return Integer.compare(u, v);
        }
        return 0;
    }
}
