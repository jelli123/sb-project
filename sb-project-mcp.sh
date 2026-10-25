#!/bin/sh
# MCP-Starter fuer KI-Programme, die einen Server als Unterprozess starten (Claude Desktop).
# Spricht ueber stdin/stdout und reicht alles an den laufenden SB-Project-Dienst weiter.
# stdout gehoert dem Protokoll - alle anderen Meldungen gehen nach stderr.
ROOT=$(cd "$(dirname "$0")" && pwd)
JAR="$ROOT/server/target/sb-server.jar"

# Nicht "host" nennen: exec und PATH-Suche treffen sonst /usr/bin/host (DNS-Werkzeug).
on_host() {
  if [ -f /.flatpak-info ]; then flatpak-spawn --host --directory="$ROOT" "$@"; else "$@"; fi
}

if [ ! -f "$JAR" ]; then
  echo "Baue den Dienst ..." >&2
  on_host mvn -q -B -f "$ROOT/server/pom.xml" package -DskipTests >&2 || exit 1
fi

on_host java -jar "$JAR" --mcp-stdio "$@"
