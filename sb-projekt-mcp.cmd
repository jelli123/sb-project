@echo off
rem MCP-Starter fuer KI-Programme, die einen Server als Unterprozess starten (Claude Desktop).
rem Spricht ueber stdin/stdout und reicht alles an den laufenden SB-Projekt-Dienst weiter.
setlocal
set ROOT=%~dp0
set JAR=%ROOT%server\target\sb-server.jar

if not exist "%JAR%" (
  echo SB-Projekt ist nicht gebaut: %JAR% fehlt. 1>&2
  exit /b 1
)

java -jar "%JAR%" --mcp-stdio %*
