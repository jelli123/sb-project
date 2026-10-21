package de.sb.knx.mcp;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PrivacyTest {

    private final Privacy p = new Privacy();

    private String mask(String text, String... terms) {
        return p.mask(text, Privacy.compileTerms(List.of(terms)));
    }

    @Test
    void projectNameWordsAreTermsButGenericWordsAreNot() {
        List<String> t = Privacy.termsOf("Haus Familie Müller, Neubau 2024");
        assertTrue(t.contains("Haus Familie Müller, Neubau 2024"));
        assertTrue(t.contains("Müller"));
        assertFalse(t.contains("Haus"));
        assertFalse(t.contains("Familie"));
        assertFalse(t.contains("2024"));
    }

    @Test
    void genericNamesAloneAreNoTerms() {
        assertTrue(Privacy.termsOf("Projekt").isEmpty());
        assertTrue(Privacy.termsOf("Haus 12").isEmpty());
        assertEquals("Darstellung des Projekts", mask("Darstellung des Projekts", Privacy.termsOf("Projekt").toArray(String[]::new)));
    }

    @Test
    void termsHideNamesEverywhereCaseInsensitive() {
        List<String> terms = new ArrayList<>(Privacy.termsOf("Familie Müller"));
        Pattern pt = Privacy.compileTerms(terms);
        assertEquals("Büro «Name1»", p.mask("Büro Müller", pt));
        assertEquals("Licht «Name1» Bad", p.mask("Licht MÜLLER Bad", pt));
    }

    @Test
    void streetsWithAndWithoutNumbers() {
        assertEquals("Haus «Adresse1»", mask("Haus Musterstraße 12"));
        // Als Sperrbegriff verschwindet der ganze Name
        assertEquals("«Name1»", mask("Haus Musterstraße 12", "Haus Musterstraße 12"));
        String s = mask("Zuleitung Hauptstraße 3a");
        assertFalse(s.contains("Hauptstraße"), s);
        assertFalse(mask("Garage Birkenweg 7").contains("Birkenweg"));
        assertFalse(mask("Am Lindenhof 4 Garten").contains("Lindenhof"));
        assertFalse(mask("Lange Straße 5").contains("Straße 5"));
        assertFalse(mask("An der Kirche 12").contains("Kirche"));
    }

    @Test
    void ambiguousEndingsNeedAHouseNumber() {
        assertEquals("Arbeitsplatz Licht", mask("Arbeitsplatz Licht"));
        assertEquals("Stellplatz Steckdose", mask("Stellplatz Steckdose"));
        assertEquals("Fluchtweg", mask("Fluchtweg"));
        assertEquals("Licht im OG 2", mask("Licht im OG 2"));
        assertEquals("Steckdose Arbeitsplatz 2", mask("Steckdose Arbeitsplatz 2"));
        assertEquals("Schaltaktor 8-fach", mask("Schaltaktor 8-fach"));
        assertEquals("Bedienfeld 1", mask("Bedienfeld 1"));
        assertEquals("Wintergarten 2 Licht", mask("Wintergarten 2 Licht"));
        assertFalse(mask("Lieferung Marktplatz 1").contains("Marktplatz"));
    }

    @Test
    void postcodeCityButNotUnits() {
        assertFalse(mask("Lager 90402 Nürnberg").contains("Nürnberg"));
        assertFalse(mask("Filiale D-80331 München").contains("München"));
        assertEquals("Helligkeit 1000 Lux", mask("Helligkeit 1000 Lux"));
        assertEquals("Farbtemperatur 2700 Kelvin", mask("Farbtemperatur 2700 Kelvin"));
    }

    @Test
    void contactDataAndIpAddresses() {
        assertEquals("Hausmeister «Tel1»", mask("Hausmeister 0911 1234567"));
        assertEquals("Notruf «Tel2»", mask("Notruf +49 911 76543210"));
        assertEquals("Kontakt «Mail1»", mask("Kontakt max.mustermann@example.org"));
        assertEquals("Router «IP1».", mask("Router 192.168.1.10."));
        // Physikalische Adressen, Gruppenadressen und DPT bleiben
        assertEquals("1.1.3 an 1/2/3, DPT 9.001", mask("1.1.3 an 1/2/3, DPT 9.001"));
    }

    @Test
    void samePlaceholderForSameTextAndRestoreRoundTrip() {
        String a = mask("Büro Müller", "Müller");
        String b = mask("Bad Müller", "Müller");
        assertEquals("Büro «Name1»", a);
        assertEquals("Bad «Name1»", b);
        assertEquals("Licht Büro Müller", p.restore("Licht Büro «Name1»"));
    }

    @Test
    void chatDisplayMarksRestoredText() {
        mask("Büro Müller", "Müller");
        String shown = p.restoreMarked("Bei mir heißt es nur «Name1», «Name9» kenne ich nicht.\uE000x");
        assertEquals("Bei mir heißt es nur \uE000«Name1»\uE001Müller\uE002, «Name9» kenne ich nicht.x", shown);
        assertEquals("Licht Müller", p.restoreLenient("Licht «Name1»"));
    }

    @Test
    void mappingSurvivesARestart(@org.junit.jupiter.api.io.TempDir java.nio.file.Path dir) throws Exception {
        java.nio.file.Path f = dir.resolve("P.json");
        mask("Büro Müller", "Müller");
        mask("Hauptstraße 3");
        p.saveIfChanged(f);
        Privacy again = Privacy.load(f);
        assertEquals("Licht Müller", again.restore("Licht «Name1»"));
        // Neue Platzhalter zaehlen weiter und treffen keine alten
        assertEquals("«Name2»", again.mask("Schmidt", Privacy.compileTerms(List.of("Schmidt"))));
        assertEquals("Büro «Name1»", again.mask("Büro Müller", Privacy.compileTerms(List.of("Müller"))));
        if (java.nio.file.FileSystems.getDefault().supportedFileAttributeViews().contains("posix")) {
            assertEquals("rw-------", java.nio.file.attribute.PosixFilePermissions.toString(
                    java.nio.file.Files.getPosixFilePermissions(f)));
        }
    }

    @Test
    void unknownPlaceholderIsRejected() {
        assertThrows(IllegalArgumentException.class, () -> p.restore("Licht «Name7»"));
    }

    @Test
    void dataCannotForgePlaceholders() {
        mask("Büro Müller", "Müller");
        String s = mask("Text «Name1» aus einer Produktdatei");
        assertFalse(s.contains("«Name1»"), s);
    }

    @Test
    void shortTermsAreIgnored() {
        assertNull(Privacy.compileTerms(List.of("ab", " ", "")));
        assertEquals("Raum ab", mask("Raum ab", "ab"));
    }

    @Test
    void longestTermWins() {
        String s = mask("Haus Müller-Lüdenscheidt", "Müller", "Müller-Lüdenscheidt");
        assertEquals("Haus «Name1»", s);
    }
}
