package de.sb.knx.mcp;

import de.sb.knx.json.Json;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static de.sb.knx.mcp.Shape.catalogText;
import static de.sb.knx.mcp.Shape.f;
import static de.sb.knx.mcp.Shape.id;
import static de.sb.knx.mcp.Shape.integer;
import static de.sb.knx.mcp.Shape.list;
import static de.sb.knx.mcp.Shape.obj;
import static de.sb.knx.mcp.Shape.opt;
import static de.sb.knx.mcp.Shape.pa;
import static de.sb.knx.mcp.Shape.req;
import static de.sb.knx.mcp.Shape.text;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ShapeTest {

    private final Shape.Obj device = obj(f("id", id()), f("name", text(50)), f("product", catalogText(50)),
            f("pa", pa()), f("objects", list(obj(f("num", integer(0, 99)), f("name", text(50))), 2)));

    private Shape.Out ctx(String... terms) {
        return new Shape.Out(new Privacy(), Privacy.compileTerms(List.of(terms)));
    }

    @Test
    void unknownFieldsAreDroppedAndCounted() {
        Map<String, Object> in = Json.parseObject("""
                {"id":"d1","name":"Aktor","note":"Schlüssel liegt unter der Matte","serial":"00FA12345678",
                 "pa":"1.1.3","objects":[{"num":1,"name":"Schalten","desc":"privat"}]}""");
        Shape.Out c = ctx();
        Map<?, ?> out = (Map<?, ?>) device.out(in, c, "");
        assertFalse(out.containsKey("note"));
        assertFalse(out.containsKey("serial"));
        assertFalse(Json.write(out).contains("privat"));
        assertEquals(3, c.dropped);
        assertTrue(c.droppedPaths.contains(".note"));
    }

    @Test
    void wrongTypesAreDroppedNotPassedThrough() {
        Map<String, Object> in = Json.parseObject("""
                {"id":"d1","pa":"192.168.1.10","objects":[{"num":500,"name":"x"}]}""");
        Shape.Out c = ctx();
        Map<?, ?> out = (Map<?, ?>) device.out(in, c, "");
        assertFalse(out.containsKey("pa"));
        assertFalse(((Map<?, ?>) ((List<?>) out.get("objects")).get(0)).containsKey("num"));
    }

    @Test
    void userTextIsMaskedCatalogTextIsNot() {
        Map<String, Object> in = Json.parseObject("""
                {"name":"Aktor Müller","product":"Müller Schaltaktor"}""");
        Map<?, ?> out = (Map<?, ?>) device.out(in, ctx("Müller"), "");
        assertEquals("Aktor «Name1»", out.get("name"));
        assertEquals("Müller Schaltaktor", out.get("product"));
    }

    @Test
    void listsAreCutAtTheirLimit() {
        Map<String, Object> in = Json.parseObject("""
                {"objects":[{"num":1},{"num":2},{"num":3}]}""");
        Shape.Out c = ctx();
        Map<?, ?> out = (Map<?, ?>) device.out(in, c, "");
        assertEquals(2, ((List<?>) out.get("objects")).size());
        assertTrue(c.truncated);
    }

    @Test
    void controlAndBidiCharactersAreRemoved() {
        Map<?, ?> out = (Map<?, ?>) device.out(Map.of("name", "Licht‮evil\u0007\nBad"), ctx(), "");
        assertEquals("Lichtevil Bad", out.get("name"));
    }

    @Test
    void argumentsAreStrict() {
        Shape.Obj args = obj(req("device", id(), null), opt("limit", integer(1, 10), null));
        assertThrows(IllegalArgumentException.class, () -> args.in(Map.of("device", "d1", "extra", 1), null, ""));
        assertThrows(IllegalArgumentException.class, () -> args.in(Map.of(), null, ""));
        assertThrows(IllegalArgumentException.class, () -> args.in(Map.of("device", "d1", "limit", 11L), null, ""));
        assertThrows(IllegalArgumentException.class, () -> args.in(Map.of("device", "../etc"), null, ""));
        assertEquals(Map.of("device", "d1", "limit", 5L), args.in(Map.of("device", "d1", "limit", 5L), null, ""));
    }

    @Test
    void schemaDescribesTheArguments() {
        Shape.Obj args = obj(req("device", id(), "Device id"), opt("limit", integer(1, 10), null));
        Map<String, Object> s = args.schema();
        assertEquals("object", s.get("type"));
        assertEquals(false, s.get("additionalProperties"));
        assertEquals(List.of("device"), s.get("required"));
        Map<?, ?> limit = (Map<?, ?>) ((Map<?, ?>) s.get("properties")).get("limit");
        assertEquals("integer", limit.get("type"));
        assertEquals(10L, limit.get("maximum"));
    }

    @Test
    void everyToolHasAValidSchema() {
        for (Tools.Tool t : Tools.ALL) {
            String json = Json.write(t.input().schema());
            assertTrue(Json.parseObject(json).get("type").equals("object"), t.name());
        }
        assertEquals(Tools.ALL.size(), Tools.listing().size());
    }
}
