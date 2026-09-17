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

  /* ---------- Dialoge ---------- */
  'Abbrechen': 'Cancel',
  'OK': 'OK'

});
