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

  'Die Adresse 0/0/0 ist als Broadcast reserviert.': 'Address 0/0/0 is reserved for broadcast.',
  'passt zum DPT der Adresse': 'matches the address datapoint type',
  'weicht vom DPT der Adresse ab': 'differs from the address datapoint type',
  'K L S Ü A': 'C R W T U',
  'Keine Objekte angelegt.': 'No objects created.',

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

  /* ---------- Verlauf und Speichern ---------- */
  'Kein früherer Schritt': 'No earlier step',
  'Kein späterer Schritt': 'No later step',
  'Nichts rückgängig zu machen': 'Nothing to undo',
  'Nichts zu wiederholen': 'Nothing to redo',
  'Rückgängig — noch {0} Schritte': 'Undone — {0} steps left',
  'Wiederhergestellt': 'Redone',
  'Gespeichert': 'Saved',

  '{0} Schritt': '{0} step',
  '{0} Schritte': '{0} steps',
  'Rückgängig: {0} (Strg+Z)': 'Undo: {0} (Ctrl+Z)',
  'Wiederholen: {0} (Strg+Y)': 'Redo: {0} (Ctrl+Y)',
  'Zurück zur vorherigen Ansicht (Alt+←)': 'Back to the previous view (Alt+←)',
  'Vor zur nächsten Ansicht (Alt+→)': 'Forward to the next view (Alt+→)',

  /* ---------- Gebäudestruktur ---------- */
  'Liegenschaft': 'Site',
  /* „Gebäude“ steht schon oben bei den Ansichten — gleicher Text, gleiche Bedeutung. */
  'Gebäudeteil': 'Building part',
  'Geschoss': 'Floor',
  'Außenbereich': 'Outdoor area',
  'Raum': 'Room',
  'Flur': 'Corridor',
  'Verteiler': 'Cabinet',
  'Unter „{0}“ anlegen': 'Create under "{0}"',
  '{0} bearbeiten': 'Edit {0}',
  '{0} „{1}“ löschen?': 'Delete {0} "{1}"?',
  'z. B. Bad': 'e.g. Bathroom',
  '„{0}“ kann kein {1} enthalten — erlaubt: {2}.': '"{0}" cannot contain a {1} — allowed: {2}.',
  'Ein {0} kann kein {1} („{2}“) enthalten.': 'A {0} cannot contain a {1} ("{2}").',
  'Hier sind {0} Geräte verbaut — ein {1} kann keine Geräte aufnehmen.':
    '{0} devices are installed here — a {1} cannot hold devices.',
  'Das Element und alles, was darunter liegt, wird entfernt':
    'The element and everything below it will be removed',
  ', auch {0}. Deren Gruppenadressen bleiben erhalten': ', including {0}. Their group addresses are kept',
  'eine Funktion': 'one function',
  '{0} Funktionen': '{0} functions',
  '{0} Geräte verlieren ihre Raumzuordnung. Die Geräte selbst bleiben mit allen Objekten und Adressen in der Topologie erhalten.':
    '{0} devices lose their room assignment. The devices themselves are kept in the topology with all objects and addresses.',
  'Hier sind keine Geräte verbaut.': 'No devices are installed here.',
  'Vorhandenes in „{0}“ einordnen': 'Move existing items into "{0}"',
  'Angeboten wird, was ein {0} enthalten kann. Unterelemente wandern mit.':
    'Offered is what a {0} can contain. Sub-elements move along.',
  'Geräte in „{0}“ verbauen': 'Install devices in "{0}"',
  'Ein Gerät hat genau einen Einbauort — der bisherige wird ersetzt.':
    'A device has exactly one installation place — the previous one is replaced.',
  'Geräte lassen sich nur in Räumen, Fluren, Verteilern und Außenbereichen verbauen.':
    'Devices can only be installed in rooms, corridors, cabinets and outdoor areas.',
  'ohne Raum': 'no room',
  'Nichts Passendes vorhanden': 'Nothing suitable available',
  'Filtern …': 'Filter …',

  'Hier können <b>Geräte</b> verbaut werden.': '<b>Devices</b> can be installed here.',
  'Enthält: {0}.': 'Contains: {0}.',
  'Unterste Ebene — keine weitere Unterteilung.': 'Lowest level — no further subdivision.',

  /* ---------- Gruppenadressen ---------- */
  'Neue Gruppenadresse anlegen': 'Create a new group address',
  'Gruppenadresse bearbeiten': 'Edit group address',
  'Gruppenadresse löschen?': 'Delete group address?',
  'z. B. Licht Flur OG schalten': 'e.g. Light corridor upstairs switch',
  'Adresse ({0})': 'Address ({0})',
  'Datenpunkttyp': 'Datapoint type',
  'optional': 'optional',
  '3-stufig  HG/MG/UG': '3-level  main/middle/sub',
  '2-stufig  HG/UG': '2-level  main/sub',
  'frei  (0–65535)': 'free  (0–65535)',
  'Hauptgruppe': 'Main group',
  'Mittelgruppe': 'Middle group',
  'Untergruppe': 'Sub group',
  '<b>{0}</b> — „{1}“ wird dauerhaft entfernt.': '<b>{0}</b> — "{1}" will be removed permanently.',
  '{0} Kommunikationsobjekte verlieren diese Adresse.': '{0} communication objects lose this address.',
  '{0} Adressen löschen?': 'Delete {0} addresses?',
  'Die markierten Gruppenadressen werden dauerhaft entfernt.':
    'The selected group addresses will be removed permanently.',
  '{0} Objektzuordnungen gehen dabei verloren.': '{0} object assignments will be lost.',
  'Alle {0}n{1} sind belegt.': 'All {0}s{1} are taken.',
  'in {0}': 'in {0}',
  'Neue {0}{1}': 'New {0}{1}',
  'z. B. Beleuchtung': 'e.g. Lighting',
  'z. B. Erdgeschoss': 'e.g. Ground floor',
  '{0} muss zwischen 0 und {1} liegen.': '{0} must be between 0 and {1}.',
  '{0} {1} gibt es schon.': '{0} {1} already exists.',
  'Bitte einen Namen vergeben — eine leere Gruppe besteht über ihren Namen.':
    'Please enter a name — an empty group exists through its name.',
  '{0} {1} löschen?': 'Delete {0} {1}?',
  '<b>{0}</b>{1} wird entfernt{2}.': '<b>{0}</b>{1} will be removed{2}.',
  ', mit <b>{0}</b> Gruppenadressen': ', with <b>{0}</b> group addresses',
  'Sollen die Adressen erhalten bleiben, vorher markieren und verschieben.':
    'To keep the addresses, select and move them first.',
  '{0} Adresse nach {1} verschoben': '{0} address moved to {1}',
  '{0} Adressen nach {1} verschoben': '{0} addresses moved to {1}',
  '{0} Adresse passt nicht mehr in {1} — dort ist nichts mehr frei.':
    '{0} address no longer fits into {1} — nothing is free there.',
  '{0} Adressen passen nicht mehr in {1} — dort ist nichts mehr frei.':
    '{0} addresses no longer fit into {1} — nothing is free there.',
  'Die Adressen liegen bereits in {0}': 'The addresses are already in {0}',
  'Bei freier Adressierung gibt es keine Gruppen zum Verschieben.':
    'With free addressing there are no groups to move into.',
  'Adresse verschieben': 'Move address',
  '{0} Adressen verschieben': 'Move {0} addresses',
  'Vorhandene Gruppe': 'Existing group',
  'Zuordnung — {0} {1}': 'Assignment — {0} {1}',
  'Objekte markieren, die auf dieser Adresse senden oder hören. Das <b>erste</b> Objekt mit Ü-Flag ist das sendende.':
    'Select the objects that send or listen on this address. The <b>first</b> object with the transmit flag is the sending one.',
  'Geräte filtern …': 'Filter devices …',
  'Noch keine Geräte angelegt.': 'No devices created yet.',

  /* ---------- Dialoge ---------- */
  'Abbrechen': 'Cancel',
  'OK': 'OK'

});
