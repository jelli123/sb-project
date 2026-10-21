package de.sb.knx.chat;

import de.sb.knx.json.Json;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ChatHistoryTest {

    @TempDir
    Path dir;

    private static Map<String, Object> e(String k, String text) {
        Map<String, Object> m = Json.obj();
        m.put("k", k);
        m.put("text", text);
        return m;
    }

    @Test
    void keepsConversationsAcrossInstances() throws Exception {
        ChatHistory h = new ChatHistory(dir);
        String id = h.create("Haus", "Lege einen Hobbyraum an");
        h.append("Haus", id, e("me", "Lege einen Hobbyraum an"));
        h.append("Haus", id, e("ai", "Erledigt."));
        h.setSession("Haus", id, "0a1eeeb5-529f-4e81-b594-dc584dbcf711");

        ChatHistory again = new ChatHistory(dir);
        Map<String, Object> doc = again.read("Haus", id);
        assertEquals("0a1eeeb5-529f-4e81-b594-dc584dbcf711", doc.get("session"));
        assertEquals(2, ((List<?>) doc.get("entries")).size());
        assertEquals("Lege einen Hobbyraum an", ((Map<?, ?>) again.list("Haus").get(0)).get("title"));
        if (FileSystems.getDefault().supportedFileAttributeViews().contains("posix")) {
            Path f = dir.resolve("history").resolve("Haus").resolve(id + ".json");
            assertEquals("rw-------", PosixFilePermissions.toString(Files.getPosixFilePermissions(f)));
        }
    }

    @Test
    void keepsOnlyTheNewestConversations() throws Exception {
        ChatHistory h = new ChatHistory(dir);
        for (int i = 0; i < ChatHistory.MAX_CONVERSATIONS + 3; i++) {
            h.create("Haus", "Frage " + i);
            Thread.sleep(2);
        }
        List<Object> all = h.list("Haus");
        assertEquals(ChatHistory.MAX_CONVERSATIONS, all.size());
        assertTrue(String.valueOf(((Map<?, ?>) all.get(0)).get("title")).endsWith(String.valueOf(ChatHistory.MAX_CONVERSATIONS + 2)));
    }

    @Test
    void foreignIdsAreRefused() throws Exception {
        ChatHistory h = new ChatHistory(dir);
        assertThrows(IllegalArgumentException.class, () -> h.read("Haus", "../../etc/passwd"));
        assertNull(h.read("Haus", "abcdef0123"));
    }
}
