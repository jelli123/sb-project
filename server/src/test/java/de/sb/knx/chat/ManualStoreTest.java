package de.sb.knx.chat;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ManualStoreTest {

    @TempDir
    Path dir;

    private static byte[] pdf(int pages) {
        StringBuilder s = new StringBuilder("%PDF-1.4\n1 0 obj << /Type /Pages /Count ").append(pages).append(" >> endobj\n");
        for (int i = 0; i < pages; i++) s.append(i + 2).append(" 0 obj << /Type /Page /Parent 1 0 R >> endobj\n");
        return s.append("%%EOF\n").toString().getBytes(StandardCharsets.ISO_8859_1);
    }

    private static List<String> names(Path d) throws Exception {
        try (Stream<Path> s = Files.list(d)) {
            return s.map(p -> p.getFileName().toString()).sorted().toList();
        }
    }

    @Test
    void storesPdfsAloneInTheReadableFolder() throws Exception {
        ManualStore store = new ManualStore(dir);
        Map<String, Object> m = store.add(pdf(3), "Shelly Pro Dimmer.pdf");
        assertEquals("Shelly Pro Dimmer", m.get("title"));
        assertEquals(3, m.get("pages"));
        assertEquals(m.get("id") + ".pdf", m.get("file"));
        // Im Arbeitsverzeichnis des Chats liegt nur die PDF, das Verzeichnis eine Ebene hoeher
        assertEquals(List.of(m.get("file")), names(store.filesDir()));
        assertFalse(Files.exists(store.filesDir().resolve("index.json")));
        assertArrayEquals(pdf(3), store.read((String) m.get("id")));

        ManualStore again = new ManualStore(dir);
        assertEquals(1, again.list().size());
    }

    @Test
    void rejectsWhatIsNoPdf() throws Exception {
        ManualStore store = new ManualStore(dir);
        assertThrows(IllegalArgumentException.class, () -> store.add("#!/bin/sh\nrm -rf /".getBytes(StandardCharsets.UTF_8), "x.pdf"));
        assertThrows(IllegalArgumentException.class, () -> store.read("../index"));
        assertThrows(IllegalArgumentException.class, () -> store.delete("../../mcp/token"));
        assertTrue(names(store.filesDir()).isEmpty());
    }

    @Test
    void assignsProductsAndCleansText() throws Exception {
        ManualStore store = new ManualStore(dir);
        String id = (String) store.add(pdf(1), "\u0007Handbuch‮").get("id");
        Map<String, Object> p = Map.of("manufacturer", "Shelly", "order", "S3PM-0A2", "name", "Pro Dimmer 2PM");
        Map<String, Object> m = store.update(id, " Neuer  Titel ", List.of(p, p));
        assertEquals("Neuer Titel", m.get("title"));
        assertEquals(1, ((List<?>) m.get("products")).size());
        assertThrows(IllegalArgumentException.class, () -> store.update(id, null, List.of(Map.of("manufacturer", "x"))));
        assertThrows(IllegalArgumentException.class, () -> store.update(id, null, "nope"));
    }

    @Test
    void deleteRemovesFileAndStrayFiles() throws Exception {
        ManualStore store = new ManualStore(dir);
        String keep = (String) store.add(pdf(2), "a").get("id");
        String gone = (String) store.add(pdf(2), "b").get("id");
        Files.writeString(store.filesDir().resolve("fremd.txt"), "nicht von uns");
        assertTrue(store.delete(gone));
        assertEquals(List.of(keep + ".pdf"), names(store.filesDir()));
        assertNull(store.read(gone));
    }

    @Test
    void pageCountFallsBackToPageTree() {
        byte[] compact = "%PDF-1.7\n<< /Type /Pages /Kids [3 0 R] /Count 42 >>\n".getBytes(StandardCharsets.ISO_8859_1);
        assertEquals(42, ManualStore.pages(compact));
        assertNull(ManualStore.pages("%PDF-1.7\n<< /Type /ObjStm >>".getBytes(StandardCharsets.ISO_8859_1)));
    }
}
