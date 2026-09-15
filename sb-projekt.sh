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

if [ ! -f "$JAR" ] || [ "$1" = "--build" ]; then
  [ "$1" = "--build" ] && shift
  echo "Baue den Dienst ..."
  on_host mvn -q -B -f "$ROOT/server/pom.xml" package -DskipTests
fi

on_host java -jar "$JAR" --web "$ROOT" "$@"
