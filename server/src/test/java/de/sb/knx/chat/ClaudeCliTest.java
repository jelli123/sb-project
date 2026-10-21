package de.sb.knx.chat;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ClaudeCliTest {

    @Test
    void readsVersionsFromBundledPaths() {
        assertEquals("2.1.304", ClaudeCli.version(
                "/home/u/.var/app/com.visualstudio.code/data/vscode/extensions/anthropic.claude-code-2.1.304-linux-x64/resources/native-binary/claude"));
        assertEquals("2.1.299", ClaudeCli.version("/home/u/.config/Claude/claude-code/2.1.299/20ca25213130/claude"));
    }

    @Test
    void comparesNumerically() {
        assertTrue(ClaudeCli.compare("2.1.304", "2.1.299") > 0);
        assertTrue(ClaudeCli.compare("2.10.0", "2.9.9") > 0);
        assertEquals(0, ClaudeCli.compare("2.1", "2.1.0"));
    }
}
