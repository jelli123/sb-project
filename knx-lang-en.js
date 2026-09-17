/* ============================================================
   KNX-Struktur — englische Sprachtabelle
   ------------------------------------------------------------
   Schlüssel ist der deutsche Text, genau so wie er im Quelltext oder im
   Markup steht. Wird dort etwas geändert, muss der Schlüssel hier mit
   geändert werden — sonst erscheint wieder der deutsche Text. Was gefehlt
   hat, verrät `KNXI18n.missing()` in der Konsole.

   Fachbegriffe bleiben, wo die KNX-Welt sie auch im Englischen so benutzt:
   group address, datapoint type, line, area, individual address.
   ============================================================ */
'use strict';

KNXI18n.add('en', {

  /* ---------- Marke und Kopfzeile ---------- */
  'KNX Struktur': 'KNX Structure',
  'Wohnobjekt- & Gruppenadress-Editor': 'Building and group address editor',
  'Projektname': 'Project name',
  'Musterprojekt': 'Sample project',
  'Typ des geladenen Projekts': 'Type of the loaded project',
  'Verlauf': 'History',
  'Zurück': 'Back',
  'Vor': 'Forward',
  'Rückgängig': 'Undo',
  'Wiederholen': 'Redo',

  /* ---------- Adressstil und Sprache ---------- */
  'Adressen': 'Addresses',
  'Adressstil': 'Address style',
  'Darstellung der Gruppenadressen (projektweit)': 'Group address format (project-wide)',
  '3-stufig': '3-level',
  '2-stufig': '2-level',
  'frei': 'free',
  'Sprache': 'Language',
  'Sprache der Oberfläche': 'Interface language',

  /* ---------- Knöpfe der Kopfzeile ---------- */
  'Export': 'Export',
  'Import': 'Import',
  'Projekt als JSON-Datei speichern': 'Save the project as a JSON file',
  'Projekt aus JSON-Datei laden': 'Load a project from a JSON file',
  'Projekte': 'Projects',
  'Projekte auf diesem Rechner verwalten': 'Manage the projects on this computer',
  'Inbetriebnahme': 'Commissioning',
  'Geräte am Bus suchen, auslesen und adressieren': 'Find, read and address devices on the bus',
  'Neues Projekt': 'New project',
  'Leeres Projekt starten': 'Start an empty project',

  /* ---------- Ansichten ---------- */
  'Ansicht': 'View',
  'Projektstruktur': 'Project structure',
  'Gebäude': 'Building',
  'Wo ist etwas verbaut': 'Where something is installed',
  'Topologie': 'Topology',
  'Bereiche, Linien und Teilnehmer': 'Areas, lines and devices',
  'Gruppen': 'Groups',
  'Haupt- und Mittelgruppen': 'Main and middle groups',

  /* ---------- Tabelle ---------- */
  'Tabelle': 'Table',
  'Adressen und Geräte': 'Addresses and devices',
  'Gruppenadressen': 'Group addresses',
  'Geräte': 'Devices',
  'Gerät': 'Device',
  'Suchen': 'Search',
  'Suchen …': 'Search …',
  'Alle Adressen markieren': 'Select all addresses',
  'Adresse': 'Address',
  'Name': 'Name',
  'DPT': 'DPT',
  'Objekte': 'Objects',
  'Räume': 'Rooms',
  'Linie': 'Line',
  'Verbaut in': 'Installed in',
  'Nach Adresse sortieren': 'Sort by address',
  'Nach Name sortieren': 'Sort by name',
  'Nach Datenpunkttyp sortieren': 'Sort by datapoint type',
  '+ Adresse': '+ Address',
  'Löschen': 'Delete',
  'Markierte Adressen löschen': 'Delete the selected addresses',
  'Verschieben': 'Move',
  'Markierte Adressen in eine andere Gruppe verschieben — oder auf eine Gruppe im Baum ziehen':
    'Move the selected addresses to another group — or drag them onto a group in the tree',
  '✕ Filter': '✕ Filter',
  'Filter entfernen': 'Clear the filter',

  /* ---------- Spalten und Statusleiste ---------- */
  'Details': 'Details',
  'Breite der Strukturspalte': 'Width of the structure column',
  'Breite der Detailspalte': 'Width of the detail column',
  'Räume:': 'Rooms:',
  'Geräte:': 'Devices:',
  'Adressen:': 'Addresses:',
  'Zuordnungen:': 'Assignments:',

  /* ---------- Darstellung ---------- */
  'Automatisch': 'Automatic',
  'Hell': 'Light',
  'Dunkel': 'Dark',
  'Darstellung: {0}': 'Appearance: {0}',
  '(gerade {0})': '(currently {0})',
  '— klicken für {0}': '— click for {0}',

  /* ---------- Produktkatalog ---------- */
  'Produkt': 'Product',
  '{0} Kommunikationsobjekte aus „{1}“ übernommen': '{0} communication objects taken from "{1}"',
  '„{0}“ aus dem Katalog entfernt': '"{0}" removed from the catalogue',

  /* ---------- Projekt, Import und Export ---------- */
  'Projekt angepasst': 'Project adjusted',
  'Beim Laden wurden Daten an das aktuelle Modell angeglichen:':
    'While loading, data was brought in line with the current model:',
  'Die Änderungen sind bereits gespeichert. Bei Bedarf die alte Datei aufbewahren und die betroffenen Adressen nachziehen.':
    'The changes are already saved. Keep the old file if you need it and adjust the affected addresses.',
  'Projekt exportiert.': 'Project exported.',
  'Projekt importiert.': 'Project imported.',
  'Datei konnte nicht gelesen werden (unerwartetes Format).':
    'The file could not be read (unexpected format).',
  'Neues Projekt starten': 'Start a new project',
  'Das aktuelle Projekt („<b>{0}</b>“) wird ersetzt. Vorher per <b>Export</b> sichern?':
    'The current project ("<b>{0}</b>") will be replaced. Save it with <b>Export</b> first?',
  'Name des neuen Objekts': 'Name of the new building',
  'z. B. Haus Bergstraße 4': 'e.g. 4 Hill Street',
  'Adressdarstellung: {0}': 'Address format: {0}',
  'Spaltenbreite zurückgesetzt': 'Column width reset',

  /* ---------- Prüfergebnis ---------- */
  'Prüfergebnis — {0} Fehler, {1} Hinweise, {2} Anmerkungen':
    'Check result — {0} errors, {1} warnings, {2} notes',
  'Keine Auffälligkeiten.': 'Nothing to report.',

  /* ---------- Funktionen ---------- */
  'Neue Funktion in „{0}“': 'New function in "{0}"',
  'Typ': 'Type',
  'Symbol': 'Icon',
  'Notiz': 'Note',
  'Freitext zur Dokumentation': 'Free text for documentation',
  'Gruppenadressen dazu anlegen': 'Create group addresses for it',
  'in Gruppe': 'in group',
  'Bitte einen Namen vergeben.': 'Please enter a name.',
  'nächste freie Adressen': 'next free addresses',
  '(wird angelegt)': '(will be created)',
  'keine Adressen anlegen': 'do not create addresses',
  'Die Adressen heißen wie die Funktion plus Rolle und liegen dort auf den nächsten freien Nummern.':
    'The addresses are named after the function plus its role and take the next free numbers there.',
  'Benutzerdefinierte Funktionen haben keine festen Rollen — Adressen danach zuordnen oder auf die Funktion ziehen.':
    'Custom functions have no fixed roles — assign addresses afterwards or drag them onto the function.',
  'Beim Typwechsel behalten Adressen ihre Rolle, wenn der neue Typ sie kennt — sonst laufen sie als weitere Adressen mit.':
    'On a type change addresses keep their role if the new type knows it — otherwise they carry on as further addresses.',
  'Funktion „{0}“ löschen?': 'Delete function "{0}"?',
  'Die Funktion wird entfernt.': 'The function will be removed.',
  'auch ihre Gruppenadresse löschen': 'delete its group address as well',
  'auch ihre {0} Gruppenadressen löschen': 'delete its {0} group addresses as well',
  '{0} davon sind Kommunikationsobjekten zugeordnet.': '{0} of them are assigned to communication objects.',
  'Adressen, die auch andere Funktionen nutzen, bleiben in jedem Fall erhalten.':
    'Addresses used by other functions as well are kept in any case.',
  '{0} Adresse mitgelöscht': '{0} address deleted with it',
  '{0} Adressen mitgelöscht': '{0} addresses deleted with it',
  '{0} Adresse fand in der Gruppe keinen Platz mehr.': '{0} address did not fit into the group.',
  '{0} Adressen fanden in der Gruppe keinen Platz mehr.': '{0} addresses did not fit into the group.',
  'In der Gruppe ist keine Adresse mehr frei.': 'No address is free in that group any more.',
  '{0} Adresse zu „{1}“ hinzugefügt': '{0} address added to "{1}"',
  '{0} Adressen zu „{1}“ hinzugefügt': '{0} addresses added to "{1}"',
  'Die Adressen gehören schon zu „{0}“': 'The addresses already belong to "{0}"',

  'Funktion bearbeiten': 'Edit function',
  'Adressen — {0}': 'Addresses — {0}',
  'Adressen mit passendem DPT übernehmen die nächste freie Rolle. Schneller geht es, Adressen aus Tabelle oder Baum auf die Funktion zu ziehen.':
    'Addresses with a matching DPT take the next free role. Dragging addresses from the table or tree onto the function is quicker.',
  'Adressen filtern …': 'Filter addresses …',
  'Noch keine Gruppenadressen angelegt.': 'No group addresses created yet.',
  'Linie {0}': 'Line {0}',
  'Bereich {0}': 'Area {0}',
  'Funktion {0}': 'Function {0}',

  /* ---------- Funktionstypen, Rollen und Kategorien ----------
     Schlüssel sind die deutschen Bezeichnungen aus FN_TYPES in knx-data.js;
     übersetzt wird beim Anzeigen, die Tabelle dort bleibt unberührt. */
  'Schaltbares Licht': 'Switchable light',
  'Dimmbares Licht': 'Dimmable light',
  'Tunable White': 'Tunable white',
  'Farbiges Licht': 'Colour light',
  'Jalousie': 'Venetian blind',
  'Rollladen': 'Roller shutter',
  'Markise': 'Awning',
  'Heizen stetig': 'Heating, continuous',
  'Heizen schaltend': 'Heating, switching',
  'Steckdose': 'Socket',
  'Fensterkontakt': 'Window contact',
  'Präsenz': 'Presence',
  'Szene': 'Scene',
  'Energiezähler': 'Energy meter',
  'Wetter': 'Weather',
  'Benutzerdefiniert': 'Custom',

  'Licht': 'Light',
  'Heizung': 'Heating',
  'Fenster': 'Window',
  'Zähler': 'Meter',
  'Funktion': 'Function',

  'schalten': 'switch',
  'Status': 'status',
  'dimmen': 'dim',
  'Helligkeit': 'brightness',
  'Status Helligkeit': 'status brightness',
  'Farbtemperatur': 'colour temperature',
  'Status Farbtemperatur': 'status colour temperature',
  'Farbe': 'colour',
  'Status Farbe': 'status colour',
  'Auf/Ab': 'up/down',
  'Stopp/Lamelle': 'stop/slat',
  'Position': 'position',
  'Lamelle': 'slat',
  'Status Position': 'status position',
  'Status Lamelle': 'status slat',
  'Stopp': 'stop',
  'Isttemperatur': 'actual temperature',
  'Solltemperatur': 'setpoint temperature',
  'Betriebsart': 'operating mode',
  'Stellgröße': 'control value',
  'Zustand': 'state',
  'Leistung': 'power',
  'Arbeit': 'energy',
  'Außentemperatur': 'outside temperature',
  'Wind': 'wind',

  'Beleuchtung': 'Lighting',
  'Beschattung': 'Shading',
  'Heizung / Klima': 'Heating / climate',
  'Steckdosen': 'Sockets',
  'Meldungen': 'Signals',
  'Szenen': 'Scenes',
  'Messwerte': 'Measurements',

  'bisher {0}': 'currently {0}',
  'anlegen': 'create',
  'Neue Adresse für diese Rolle': 'New address for this role',
  'Filtertabelle': 'Filter table',

  /* ---------- Dialoge ---------- */
  'Abbrechen': 'Cancel',
  'OK': 'OK'

});
