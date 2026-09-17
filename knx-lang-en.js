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

  /* ---------- Detailspalte, Baum und Kontextmenü ---------- */
  '(ohne Namen)': '(unnamed)',
  'Neue {0}': 'New {0}',
  'Unter dem gewählten Element anlegen': 'Create under the selected element',
  '{0} Adressen ohne Objekt': '{0} addresses without an object',
  'alle Adressen sind belegt': 'all addresses are in use',
  '{0} Fehler · {1} Hinweise': '{0} errors · {1} warnings',
  '{0} Hinweise': '{0} warnings',
  '{0} Anmerkungen': '{0} notes',
  'Alle Auffälligkeiten anzeigen': 'Show everything worth noting',
  'Für Mehrfachlöschung markieren': 'Select for bulk delete',
  'kein sendendes Objekt': 'no sending object',
  'Keine Adresse passt zur Suche.': 'No address matches the search.',
  'Keine Adressen in diesem Bereich.': 'No addresses in this scope.',
  'Noch keine Gruppenadressen. Oben rechts auf <b>+ Adresse</b> klicken.':
    'No group addresses yet. Click <b>+ Address</b> at the top right.',
  'Kein Gerät passt zur Suche.': 'No device matches the search.',
  'Keine Geräte in diesem Bereich.': 'No devices in this scope.',
  'Noch keine Geräte. Oben rechts auf <b>+ Gerät</b> klicken.':
    'No devices yet. Click <b>+ Device</b> at the top right.',
  'Löschen ({0})': 'Delete ({0})',
  'Gerät {0}': 'Device {0}',
  'Gruppe': 'Group',
  'Willkommen': 'Welcome',
  'Der Editor arbeitet mit den drei Sichten der ETS:': 'The editor works with the three ETS views:',
  '<b>Gebäude</b> — wo etwas verbaut ist: Gebäude, Geschosse, Räume, Verteiler.':
    '<b>Building</b> — where something is installed: buildings, floors, rooms, cabinets.',
  '<b>Topologie</b> — wie es am Bus hängt: Bereich, Linie, Teilnehmer mit physikalischer Adresse und Kommunikationsobjekten.':
    '<b>Topology</b> — how it hangs on the bus: area, line, device with an individual address and communication objects.',
  '<b>Gruppen</b> — was es tut: Haupt- und Mittelgruppen mit den Gruppenadressen.':
    '<b>Groups</b> — what it does: main and middle groups with the group addresses.',
  'Eine Gruppenadresse wirkt nicht auf einen Raum, sondern auf <b>Kommunikationsobjekte</b> von Geräten. Der Raumbezug ergibt sich daraus, wo das Gerät verbaut ist. Deshalb prüft die Statusleiste laufend, ob jede Adresse genau ein sendendes Objekt und einen einheitlichen Datenpunkttyp hat.':
    'A group address does not act on a room but on the <b>communication objects</b> of devices. The room follows from where the device is installed. That is why the status bar keeps checking that every address has exactly one sending object and a consistent datapoint type.',
  'Das Projekt liegt als Datei auf diesem Rechner — der lokale Dienst speichert jede Änderung.':
    'The project is a file on this computer — the local service saves every change.',
  'Alles wird lokal im Browser gespeichert.': 'Everything is stored locally in the browser.',
  'Doppelklick auf einen Baumeintrag öffnet den Bearbeiten-Dialog, Strg+Z macht Änderungen rückgängig.':
    'Double-clicking a tree entry opens the edit dialog, Ctrl+Z undoes changes.',
  'Offset {0}': 'Offset {0}',
  'max. {0} Einträge': 'max. {0} entries',
  'nicht beschrieben': 'not described',
  'Maskenversion': 'Mask version',
  'Applikation': 'Application',
  'Nr. {0}, Version {1}': 'No. {0}, version {1}',
  'Ladeverfahren': 'Load procedure style',
  'Adresstabelle': 'Address table',
  'Assoziationstabelle': 'Association table',
  'Objekttabelle': 'Object table',
  'Speichersegmente': 'Memory segments',
  '{0} · zusammen {1} Byte': '{0} · {1} bytes in total',
  'Eigenschaften': 'Properties',
  '{0} Einträge': '{0} entries',
  'Ladeprozeduren': 'Load procedures',
  '{0} · {1} Schritte': '{0} · {1} steps',
  'Die Produktdatei verweist auf ein herstellereigenes Programm. Solche Programme laufen nur unter Windows in der ETS und werden hier übergangen.':
    'The product file refers to a manufacturer plug-in. Such programs only run under Windows inside ETS and are skipped here.',
  'Unbekannte Ladeschritte: {0}.': 'Unknown load steps: {0}.',
  'Das Produkt wurde mit einer älteren Version eingelesen. Für den Download die .knxprod bitte erneut in den Katalog laden.':
    'The product was read with an older version. Please load the .knxprod into the catalogue again for downloading.',
  'Weder Produktdatei noch Maskendefinition enthalten eine Ladeprozedur.':
    'Neither the product file nor the mask definition contains a load procedure.',
  'Programmierdaten': 'Programming data',
  'Die Applikation lässt sich über die Inbetriebnahme laden.':
    'The application can be loaded via commissioning.',
  'Prüfung': 'Check',
  'Geräte darunter': 'devices below',
  'Adressen wirksam': 'addresses in effect',
  'Bearbeiten': 'Edit',
  'Liegt in': 'Located in',
  'Übergeordnetes Element wählen — oder im Baum ziehen':
    'Choose the parent element — or drag it in the tree',
  '+ Neu': '+ New',
  'Vorhandene …': 'Existing …',
  'Noch nichts darunter.': 'Nothing below yet.',
  'Keine Funktion hier.': 'No function here.',
  'Hier ist noch kein Gerät verbaut.': 'No device is installed here yet.',
  'Aus der Funktion lösen': 'Detach from the function',
  'Einer Rolle zuweisen': 'Assign to a role',
  'Rolle …': 'Role …',
  'Gebäudeteil wählen — oder im Baum ziehen': 'Choose the building part — or drag it in the tree',
  'Weitere Adressen': 'Further addresses',
  'Noch keine Adressen — zuordnen oder aus der Tabelle auf die Funktion im Baum ziehen.':
    'No addresses yet — assign them or drag them from the table onto the function in the tree.',
  'Zugeordnete Objekte': 'Assigned objects',
  'sendendes Objekt': 'sending object',
  'hörendes Objekt': 'listening object',
  'Kein Objekt zugeordnet — die Adresse ist wirkungslos.':
    'No object assigned — the address has no effect.',
  'Wirksam in': 'In effect in',
  'durchgelassen': 'passed',
  'gesperrt': 'blocked',
  'Jede Adresse dieses Segments überschreitet die Grenze.':
    'Every address of this segment crosses the boundary.',
  'Keine Adresse überschreitet diese Grenze — es gibt nichts weiterzuleiten.':
    'No address crosses this boundary — there is nothing to forward.',
  'Busstrom': 'Bus current',
  '<b>{0} mA</b> Bedarf von {1} Teilnehmern · <b>{2} mA</b> eingespeist':
    '<b>{0} mA</b> needed by {1} devices · <b>{2} mA</b> supplied',
  'keine Spannungsversorgung eingeplant': 'no power supply planned',
  'Reserve {0} mA': '{0} mA spare',
  'ohne Produktangabe': 'no product stated',
  'kein Raum': 'no room',
  'Produktdatei vorhanden — Objekte und Parameter stammen daraus':
    'Product file present — objects and parameters come from it',
  'Frei angelegt — dient der Dokumentation und den Filtertabellen':
    'Created by hand — serves documentation and the filter tables',
  'aus .knxprod': 'from .knxprod',
  'frei definiert': 'hand-made',
  'Applikation, Parameter und Gruppenadressen ins Gerät laden':
    'Load application, parameters and group addresses into the device',
  'Programmieren …': 'Program …',
  'Einbauort wählen — oder in der Gebäudeansicht auf einen Raum ziehen':
    'Choose the installation place — or drag it onto a room in the building view',
  '— kein Raum —': '— no room —',
  'IP-Konfiguration': 'IP configuration',
  'Adressvergabe': 'Address assignment',
  'manuell': 'manual',
  'IP-Adresse': 'IP address',
  'Subnetzmaske': 'Subnet mask',
  'Standardgateway': 'Default gateway',
  'Routing-Multicast (Backbone)': 'Routing multicast (backbone)',
  'Tunnelverbindungen': 'Tunnel connections',
  '(laut Produktdatei)': '(per product file)',
  'Tunneladressen': 'Tunnel addresses',
  'Seriennummer': 'Serial number',
  '6 Byte, für die Adressvergabe ohne Programmiertaste':
    '6 bytes, for addressing without the programming button',
  'Kommunikationsobjekte': 'Communication objects',
  'Durch die aktuelle Parametrierung nicht mehr vorgesehen':
    'No longer provided for by the current parameters',
  'Dieses Gerät arbeitet ohne Kommunikationsobjekte — es wird allein über seine Eigenschaften eingestellt.':
    'This device works without communication objects — it is configured through its properties alone.',
  'Koppler arbeiten ohne Kommunikationsobjekte — sie leiten nach ihrer Filtertabelle weiter.':
    'Couplers work without communication objects — they forward according to their filter table.',
  'Noch keine Objekte angelegt.': 'No objects created yet.',
  'Objekt {0} von {1}': 'Object {0} of {1}',
  'Diese Adresse zur sendenden machen': 'Make this the sending address',
  'Die oberste Adresse ist die sendende.': 'The topmost address is the sending one.',
  'Ohne Ü-Flag sendet dieses Objekt nicht.': 'Without the transmit flag this object does not send.',
  'Keine Adresse zugeordnet.': 'No address assigned.',
  'Backbone': 'Backbone',
  'Multicast {0}': 'Multicast {0}',
  'Bereiche': 'Areas',
  'Teilnehmer': 'Devices',
  '+ Gerät': '+ Device',
  '+ Bereich': '+ Area',
  '+ Segment': '+ Segment',
  'Der Backbone verbindet die Bereiche über ihre Bereichskoppler (x.0.0).':
    'The backbone connects the areas through their area couplers (x.0.0).',
  'Die Multicast-Adresse gilt für alle KNXnet/IP-Router des Projekts.':
    'The multicast address applies to every KNXnet/IP router in the project.',
  'Ein Segment teilt sich den Adressraum der Linie, hat aber eigene Teilnehmer, eigenen Busstrom und ein eigenes Medium.':
    'A segment shares the line\'s address space but has its own devices, its own bus current and its own medium.',
  'Segment 0 ist die Linie selbst; sein Medium ist das der Linie.':
    'Segment 0 is the line itself; its medium is the line\'s.',
  'Hauptlinie des Bereichs': 'Main line of area',
  'Linie in Bereich': 'Line in area',
  'Noch keine Geräte auf dieser Linie.': 'No devices on this line yet.',
  '+ Linie': '+ Line',
  '{0} Adressen': '{0} addresses',
  'Benennen': 'Rename',
  'Diese Gruppe ist noch leer.': 'This group is still empty.',
  'Bearbeiten …': 'Edit …',
  'Löschen …': 'Delete …',
  'Untergeordnetes anlegen …': 'Create a child …',
  'Vorhandene übernehmen …': 'Take existing ones …',
  'Funktion anlegen …': 'Create a function …',
  'Funktionen übernehmen …': 'Take existing functions …',
  'Gerät anlegen …': 'Create a device …',
  'Geräte übernehmen …': 'Take existing devices …',
  'Adressen zuordnen …': 'Assign addresses …',
  'Zuordnen …': 'Assign …',
  'Verschieben …': 'Move …',
  '{0} markierte verschieben …': 'Move {0} selected …',
  '{0} markierte löschen …': 'Delete {0} selected …',
  'Adresse anlegen …': 'Create an address …',
  'Untergruppe anlegen …': 'Create a sub group …',
  'Adressen verschieben …': 'Move addresses …',
  'Umbenennen …': 'Rename …',
  'Gruppe löschen …': 'Delete group …',
  'Parameter …': 'Parameters …',
  'Objekt anlegen …': 'Create an object …',
  'Adresse zuordnen …': 'Assign an address …',
  'Segment anlegen …': 'Create a segment …',
  'Bereich anlegen …': 'Create an area …',
  'Linie anlegen …': 'Create a line …',
  'Gerät hier verbauen': 'Install a device here',
  'Funktion löschen': 'Delete function',
  'Adressen zuordnen': 'Assign addresses',
  'Gerät auf dem Backbone': 'Device on the backbone',
  'Neuer Bereich': 'New area',
  'Bereich löschen': 'Delete area',
  'Neue Linie': 'New line',
  'Linie löschen': 'Delete line',
  'Neues Gerät': 'New device',
  'Segment löschen': 'Delete segment',
  'Gerät löschen': 'Delete device',
  'Parameter': 'Parameters',
  'Neues Kommunikationsobjekt': 'New communication object',
  'Objekt löschen': 'Delete object',
  'Gruppe mit allen Adressen löschen': 'Delete the group with all its addresses',
  'Neue Gruppenadresse': 'New group address',
  'Objekte zuordnen': 'Assign objects',
  'Untergeordnet': 'Children',
  'Funktionen': 'Functions',
  '+ Objekt': '+ Object',
  'Neue Funktion': 'New function',
  'Untergeordnetes Element': 'Child element',
  'Keine Unterteilung möglich': 'No subdivision possible',

  /* ---------- Medien ---------- */
  'TP (Twisted Pair)': 'TP (twisted pair)',
  'IP': 'IP',
  'RF (Funk)': 'RF (radio)',
  'PL (Powerline)': 'PL (powerline)',

  /* ---------- Dialoge ---------- */
  'Abbrechen': 'Cancel',
  'OK': 'OK'

});
