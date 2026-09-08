@echo off
rem Startet den lokalen Dienst und oeffnet die Oberflaeche im Browser.
setlocal
set ROOT=%~dp0
set JAR=%ROOT%server\target\sb-server.jar

if not exist "%JAR%" (
  echo Baue den Dienst ...
  pushd "%ROOT%server"
  call mvn -q -B package -DskipTests || goto :fail
  popd
)

java -jar "%JAR%" --web "%ROOT%." %*
goto :eof

:fail
popd
echo Bauen fehlgeschlagen.
exit /b 1
