#!/bin/sh
# Startet den lokalen Dienst und oeffnet die Oberflaeche im Browser.
# Aus einer Flatpak-Sandbox (z. B. VS Code als Flatpak) laeuft alles auf dem Host.
set -e
ROOT=$(cd "$(dirname "$0")" && pwd)
JAR="$ROOT/server/target/sb-server.jar"

# Nicht "host" nennen: exec und PATH-Suche treffen sonst /usr/bin/host (DNS-Werkzeug).
on_host() {
  if [ -f /.flatpak-info ]; then flatpak-spawn --host --directory="$ROOT" "$@"; else "$@"; fi
}

# Neu gebaut wird, wenn der Jar fehlt, --build verlangt ist oder Quellen bzw. pom.xml neuer
# sind als er. Immer mit clean: inkrementelle Builds hinterliessen schon Klassen, die nicht
# zusammenpassten (NoClassDefFoundError beim Start, unsinnige Compilerfehler).
BUILD=
if [ "$1" = "--build" ]; then BUILD=1; shift; fi
if [ ! -f "$JAR" ] || [ -n "$(find "$ROOT/server/src/main" "$ROOT/server/pom.xml" -newer "$JAR" -print -quit)" ]; then
  BUILD=1
fi
if [ -n "$BUILD" ]; then
  echo "Baue den Dienst ..."
  # Maven mit dem JDK von javac starten: ist ein neueres reines JRE der Standard-java (z. B.
  # openjdk-25-jre neben openjdk-21-jdk), fehlt ihm ct.sym und "--release 17" schlaegt fehl.
  on_host sh -c 'if [ -z "$JAVA_HOME" ] && j=$(command -v javac); then
      JAVA_HOME=$(dirname "$(dirname "$(readlink -f "$j")")"); export JAVA_HOME
    fi
    exec mvn -q -B -f "$1" clean package -DskipTests' sh "$ROOT/server/pom.xml"
fi

on_host java -jar "$JAR" --web "$ROOT" "$@"
