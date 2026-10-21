package de.sb.knx.store;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class ProjectStoreTest {

    @TempDir
    Path dir;

    @Test
    void staleRevisionIsRefused() throws Exception {
        ProjectStore store = new ProjectStore(dir);
        String r1 = store.write("P", "{\"a\":1}", null);
        assertEquals(r1, ProjectStore.revision(store.read("P")));

        // Fenster A speichert auf r1, danach versucht Fenster B es ebenfalls auf r1
        String r2 = store.write("P", "{\"a\":2}", r1);
        assertNotEquals(r1, r2);
        ProjectStore.Conflict c = assertThrows(ProjectStore.Conflict.class, () -> store.write("P", "{\"a\":3}", r1));
        assertEquals(r2, c.current);
        assertEquals("{\"a\":2}", new String(store.read("P")));

        // Wer den aktuellen Stand kennt, darf ueberschreiben
        store.write("P", "{\"a\":3}", c.current);
        assertEquals("{\"a\":3}", new String(store.read("P")));
    }

    @Test
    void writingWithoutRevisionStaysUnconditional() throws Exception {
        ProjectStore store = new ProjectStore(dir);
        store.write("P", "{\"a\":1}");
        store.write("P", "{\"a\":2}");
        assertEquals("{\"a\":2}", new String(store.read("P")));
    }

    @Test
    void newProjectNeedsNoRevision() throws Exception {
        ProjectStore store = new ProjectStore(dir);
        store.write("Neu", "{}", "0123456789abcdef0123");
        assertEquals("{}", new String(store.read("Neu")));
    }
}
