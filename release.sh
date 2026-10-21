#!/bin/sh
# Schnuert ein ZIP zum Weitergeben: Dienst, Bibliotheken, Oberflaeche, Startskripte
# und Lizenzhinweise. Der Empfaenger braucht nur Java 17 oder neuer, weder Maven
# noch dieses Repo.
#
#   ./release.sh              Version aus server/pom.xml
#   ./release.sh 0.2.1-test   eigene Versionsbezeichnung
#
# Ergebnis: release/sb-projekt-<version>.zip
set -e

ROOT=$(cd "$(dirname "$0")" && pwd)
OUT=${OUT:-$ROOT/release}

# Aus einer Flatpak-Sandbox (VS Code) laufen Maven und Java auf dem Host.
# Nicht "host" nennen: exec und PATH-Suche treffen sonst /usr/bin/host.
on_host() {
  if [ -f /.flatpak-info ]; then flatpak-spawn --host --directory="$ROOT" "$@"; else "$@"; fi
}

VERSION=${1:-$(sed -n 's:.*<version>\(.*\)</version>.*:\1:p' "$ROOT/server/pom.xml" | head -1)}
[ -n "$VERSION" ] || { echo "Keine Version gefunden — bitte als Argument angeben." >&2; exit 1; }
NAME=sb-projekt-$VERSION
STAGE=$OUT/$NAME

COMMIT=$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo "unbekannt")
git -C "$ROOT" diff --quiet HEAD 2>/dev/null || COMMIT="$COMMIT + nicht eingecheckte Aenderungen"
DATE=$(date +%Y-%m-%d)

echo "Baue den Dienst ..."
on_host mvn -q -B -f "$ROOT/server/pom.xml" package -DskipTests

JAR=$ROOT/server/target/sb-server.jar
[ -f "$JAR" ] || { echo "Dienst wurde nicht gebaut: $JAR fehlt." >&2; exit 1; }

echo "Stelle $NAME zusammen ..."
rm -rf "$STAGE"
mkdir -p "$STAGE/server/lib" "$STAGE/web" "$STAGE/lizenzen" "$STAGE/beispiel"

# Dienst samt Bibliotheken; das Manifest sucht sie in lib/ neben dem Jar.
cp "$JAR" "$STAGE/server/"
cp "$ROOT"/server/target/lib/*.jar "$STAGE/server/lib/"

# Oberflaeche: index.html, alle Skripte, Stylesheet und Logo aus dem Hauptordner.
cp "$ROOT/index.html" "$ROOT/styles.css" "$ROOT/selfbus-logo.png" "$STAGE/web/"
for f in "$ROOT"/*.js; do cp "$f" "$STAGE/web/"; done

# Musterprojekt zum Importieren; ohne Umlaute im Namen, damit es auf jedem
# Betriebssystem heil aus dem ZIP kommt.
for f in "$ROOT"/*.knx.json; do
  [ -e "$f" ] || continue
  cp "$f" "$STAGE/beispiel/haus-musterstrasse-12.knx.json"
done

# ---------- Startskripte des Pakets: starten nur, bauen nicht ----------
cat > "$STAGE/sb-projekt.sh" <<'EOF'
#!/bin/sh
# Startet SB-Projekt und oeffnet die Oberflaeche im Browser.
set -e
ROOT=$(cd "$(dirname "$0")" && pwd)

if ! command -v java >/dev/null 2>&1; then
  echo "Java wurde nicht gefunden. Bitte Java 17 oder neuer installieren."
  exit 1
fi

exec java -jar "$ROOT/server/sb-server.jar" --web "$ROOT/web" "$@"
EOF
chmod +x "$STAGE/sb-projekt.sh"

cat > "$STAGE/sb-projekt.cmd" <<'EOF'
@echo off
rem Startet SB-Projekt und oeffnet die Oberflaeche im Browser.
setlocal
set ROOT=%~dp0

where java >nul 2>nul
if errorlevel 1 (
  echo Java wurde nicht gefunden. Bitte Java 17 oder neuer installieren.
  pause
  exit /b 1
)

java -jar "%ROOT%server\sb-server.jar" --web "%ROOT%web" %*
EOF

# MCP-Starter fuer KI-Programme wie Claude Desktop: stdout gehoert dem Protokoll,
# deshalb gehen Meldungen nach stderr.
cat > "$STAGE/sb-projekt-mcp.sh" <<'EOF'
#!/bin/sh
# MCP-Starter fuer KI-Programme, die einen Server als Unterprozess starten (Claude Desktop).
# Reicht alles an den laufenden SB-Projekt-Dienst weiter.
ROOT=$(cd "$(dirname "$0")" && pwd)

if ! command -v java >/dev/null 2>&1; then
  echo "Java wurde nicht gefunden. Bitte Java 17 oder neuer installieren." >&2
  exit 1
fi

exec java -jar "$ROOT/server/sb-server.jar" --mcp-stdio "$@"
EOF
chmod +x "$STAGE/sb-projekt-mcp.sh"

cat > "$STAGE/sb-projekt-mcp.cmd" <<'EOF'
@echo off
rem MCP-Starter fuer KI-Programme, die einen Server als Unterprozess starten (Claude Desktop).
setlocal
set ROOT=%~dp0
java -jar "%ROOT%server\sb-server.jar" --mcp-stdio %*
EOF

# ---------- Lizenzhinweise ----------
unzip -p "$STAGE/server/lib"/calimero-core-*.jar META-INF/LICENSE.txt > "$STAGE/lizenzen/calimero-LICENSE.txt"
unzip -p "$STAGE/server/lib"/slf4j-api-*.jar META-INF/LICENSE.txt > "$STAGE/lizenzen/slf4j-LICENSE.txt"
# Die Lucide-Hinweise stehen im Kopf der Icon-Datei — von dort uebernommen.
sed -n '1,/^ \*\//p' "$ROOT/knx-icons.js" > "$STAGE/lizenzen/lucide-LICENSE.txt"

cat > "$STAGE/lizenzen/HINWEISE.txt" <<EOF
Fremde Bestandteile in diesem Paket
===================================

Calimero (server/lib/calimero-core-*.jar)
  GNU General Public License Version 2 mit Classpath Exception.
  Lizenztext: calimero-LICENSE.txt
  Quellcode:  https://github.com/calimero-project/calimero-core

SLF4J (server/lib/slf4j-api-*.jar, server/lib/slf4j-simple-*.jar)
  MIT-Lizenz. Lizenztext: slf4j-LICENSE.txt
  Quellcode:  https://github.com/qos-ch/slf4j

Lucide-Symbole (web/knx-icons.js)
  ISC-Lizenz, einzelne Symbole MIT (Feather).
  Lizenztext: lucide-LICENSE.txt
  Quellcode:  https://github.com/lucide-icons/lucide

SB-Projekt selbst hat noch keine Lizenz. Bis eine gewaehlt ist, ist dieses
Paket nur zum Testen gedacht und nicht zur Weiterverbreitung.
EOF

# ---------- Beschreibung ----------
cat > "$STAGE/README.txt" <<EOF
SB-Projekt $VERSION
Stand: $DATE, Quellstand: $COMMIT

Was das ist
-----------
Ein Editor fuer KNX-Projekte: Gebaeude, Topologie, Gruppenadressen und
Funktionen, dazu Programmieren ueber eine KNXnet/IP-Schnittstelle: Der
Knopf "Programmieren" zeigt, was in welchem Geraet neu zu laden ist, und
laedt es in einem Durchgang.
Testversion — bitte nichts an einer Anlage tun, das nicht rueckgaengig
zu machen ist.

Voraussetzung
-------------
Java 17 oder neuer. Pruefen mit:  java -version

Starten
-------
Linux, macOS:  ./sb-projekt.sh
Windows:       sb-projekt.cmd  (Doppelklick)

Der Dienst laeuft danach auf http://127.0.0.1:8420/ und ist nur von diesem
Rechner erreichbar. Der Browser oeffnet sich von selbst. Beenden mit Strg+C
im Fenster des Dienstes.

Optionen:  --port <n>   anderer Port
           --data <pfad> anderes Verzeichnis fuer Projekte und Katalog
           --no-browser  Browser nicht oeffnen
           --debug       Inbetriebnahme-Fenster zum Testen und Debuggen
                         einblenden (Scan, Geraeteinfo, Einzelschritte)

Wo die Daten liegen
-------------------
Linux, macOS:  ~/.local/share/sb-projekt
Windows:       %LOCALAPPDATA%\\SB-Projekt

Dort liegen die Projekte und der aus .knxprod-Dateien eingelesene
Produktkatalog. Das Paket selbst enthaelt keine Herstellerdaten; Produkte
werden in der Oberflaeche ueber "Import" aus eigenen .knxprod-Dateien geladen.

KI-Zugang (MCP)
---------------
Eine KI wie Claude Code kann Projekte lesen und bei der Planung helfen.
Der Zugang ist nach jedem Start aus. Er gilt nur fuer Projekte, die in
einem Fenster offen und dort ueber den Schalter "KI" freigegeben sind.
Der Modus am Schalter bestimmt, was die KI darf: "Lesen", oder Gruppen-
adressen, Verknuepfungen, Gebaeudestruktur und Funktionen aendern - als
"Vorschlag", in "Einzelschritten" mit Bestaetigung oder "Auto". Loeschen
wartet immer auf eine Bestaetigung, jede KI-Aenderung ist ein Schritt fuer
"Rueckgaengig". Geraete, Parameter und Programmieren bleiben beim Nutzer.
Den Befehl zum Einrichten zeigt "KI" > "KI-Zugang einrichten".
Nie an den KI-Anbieter gehen Notizen, Objektbeschreibungen, Seriennummern,
KNX-Secure-Daten, Einstellungen und Dateipfade, IP-Adressen nur nach
Rueckfrage. Projekt- und Liegenschaftsname, erkannte Anschriften,
Telefonnummern und E-Mail-Adressen ersetzt der Dienst durch Platzhalter.
Auf den Bus schreibt eine KI nie. Jeder Aufruf steht in mcp/audit.log
im Datenverzeichnis.

Ohne externes Programm geht es ueber den Reiter "KI-Chat" rechts: Der
Dienst startet dafuer die Claude-Code-Kommandozeile (aus der VS-Code-
Erweiterung, Claude Desktop oder mit --claude <pfad>) mit der Anmeldung des
Nutzers - nur mit den Werkzeugen von SB-Projekt. Auch die eigene Nachricht
bekommt die Platzhalter, bevor sie hinausgeht. Der Chat arbeitet nur mit
einer Claude-Abo-Anmeldung (Pro/Max, kein Abrechnen je Nachricht); ein
gesetzter ANTHROPIC_API_KEY bleibt aussen vor. Wer bewusst ueber die API
abrechnen will, startet den Dienst mit --chat-api.
Gespraeche werden je Projekt in chat/history im Datenverzeichnis gespeichert
(nur fuer den Nutzer lesbar) und lassen sich nach einem Neustart fortsetzen;
die Zuordnung der Platzhalter liegt dafuer in mcp/privacy.

Handbuecher (PDF) laedt man selbst hoch - im Chat ueber das Buchsymbol oder
im Produktkatalog - und ordnet sie Produkten zu; aus dem Internet wird nichts
geladen. Sie liegen in manuals/files im Datenverzeichnis. Der Chat laeuft in
diesem Ordner und darf nur dort lesen: erst das Inhaltsverzeichnis, dann die
passenden Seiten. Mehr als 20 Seiten fuer eine Frage liest er nur nach
Rueckfrage. Gelesene Seiten gehen an den KI-Anbieter - deshalb nur
Herstellerunterlagen hochladen.

Programme, die einen MCP-Server als Unterprozess starten (Claude Desktop),
bekommen als Befehl sb-projekt-mcp.sh bzw. sb-projekt-mcp.cmd. Der Starter
reicht alles an den laufenden Dienst weiter; laeuft er nicht, melden die
Werkzeuge das.

Zum Ausprobieren
----------------
beispiel/haus-musterstrasse-12.knx.json laesst sich ueber "Import" laden.
Ohne Import startet das Programm ohnehin mit einem Musterprojekt.

Inhalt
------
sb-projekt.sh, sb-projekt.cmd  Startskripte
sb-projekt-mcp.sh, .cmd        MCP-Starter fuer KI-Programme (Claude Desktop)
server/                        Dienst (Java) samt Bibliotheken
web/                           Oberflaeche
beispiel/                      Musterprojekt zum Importieren
lizenzen/                      Lizenzen der fremden Bestandteile

Lizenz
------
Siehe lizenzen/HINWEISE.txt. SB-Projekt selbst ist noch nicht lizenziert
und daher nur zum Testen ueberlassen.
EOF

# ---------- ZIP ----------
rm -f "$OUT/$NAME.zip"
(cd "$OUT" && zip -qr "$NAME.zip" "$NAME")
rm -rf "$STAGE"

echo "Fertig: $OUT/$NAME.zip ($(du -h "$OUT/$NAME.zip" | cut -f1))"
