# SB-Project

Planungs- und Programmierwerkzeug für KNX-Anlagen, entstanden rund um
[Selfbus](https://selfbus.org). Läuft lokal: ein kleiner Java-Dienst plus
Oberfläche im Browser.

> **Testversion:** An einer echten Anlage bitte nichts tun, das sich nicht
> rückgängig machen lässt.

## Funktionsumfang

- **Projekt planen:** Gebäudestruktur, Topologie (Bereiche, Linien, Koppler),
  Gruppenadressen, Funktionen (Licht, Jalousie, Heizung …) und Verknüpfungen;
  Konsistenzprüfung, Rückgängig, Import/Export als `.knx.json`.
- **Produktkatalog:** Import eigener `.knxprod`-Dateien der Hersteller, Parameter
  und Kommunikationsobjekte wie in der Produktdatenbank.
- **Programmieren über KNXnet/IP:** Der Knopf „Programmieren“ zeigt, was in
  welchem Gerät neu zu laden ist, und lädt es in einem Durchgang
  (physikalische Adresse, Applikation, Parameter, Gruppenadressen).
- **KNX Secure:** KNX Data Secure, System B, KNX IP Secure (sichere Tunnel),
  verschlüsselter Schlüsselspeicher, Export/Import von ETS-Keyrings.
- **KI-Unterstützung (optional):** MCP-Server für Claude Code / Claude Desktop
  und ein eingebauter KI-Chat. Zugang nur für ausdrücklich freigegebene
  Projekte; persönliche Daten werden durch Platzhalter ersetzt, auf den Bus
  schreibt die KI nie.
- **Sprachen:** Oberfläche auf Deutsch und Englisch.

## Voraussetzungen

- Java 17 oder neuer
- Maven 3.8 oder neuer (nur zum Bauen aus dem Quellcode)
- ein aktueller Browser

## Starten

```sh
./sb-project.sh          # Linux, macOS
sb-project.cmd           # Windows
```

Das Skript baut den Dienst bei Bedarf (`server/target/sb-server.jar`), startet
ihn und öffnet <http://127.0.0.1:8420/>. Der Dienst ist nur vom eigenen Rechner
aus erreichbar. Beenden mit Strg+C.

| Option | Wirkung |
|---|---|
| `--port <n>` | anderer Port (Vorgabe 8420) |
| `--data <pfad>` | anderes Datenverzeichnis |
| `--no-browser` | Browser nicht öffnen |
| `--debug` | Inbetriebnahme-Fenster (Scan, Geräteinfo, Einzelschritte) |
| `--build` | Neubau erzwingen (nur `sb-project.sh`) |

Projekte, Katalog und Schlüssel liegen in `~/.local/share/sb-project`
bzw. `%LOCALAPPDATA%\SB-Project`.

Ein Musterprojekt zum Ausprobieren liegt bei: `haus-musterstraße-12.knx.json`
über „Import“ laden.

## Bauen, Testen, Paket

```sh
mvn -f server/pom.xml clean package      # Dienst bauen und Java-Tests ausführen
node test/knx-proxy.test.js              # JS-Tests, ohne Abhängigkeiten
./release.sh                             # ZIP zum Weitergeben in release/
```

Das ZIP aus `release.sh` braucht beim Empfänger nur Java, kein Maven.

## Fremde Bestandteile

- [Calimero](https://github.com/calimero-project/calimero-core) – GPL-2.0 mit Classpath Exception
- [SLF4J](https://github.com/qos-ch/slf4j) – MIT
- [Lucide](https://github.com/lucide-icons/lucide) – ISC/MIT
