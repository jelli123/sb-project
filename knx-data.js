/* ============================================================
   KNX-Struktur — Datenmodell, DPT-Katalog, Seed, Speicher
   ============================================================ */
'use strict';

const KNX = (() => {

  /* ---------- DPT-Katalog ---------- *
   * Bezeichner nach KNX-Standard: Hauptnummer.Subnummer.
   * Auswahl der in Wohn-/Zweckbau gebräuchlichen Typen.                    */
  const DPT_MAIN = {
    1:   'Boolean — 1 Bit',
    2:   'Steuerung mit Priorität — 2 Bit',
    3:   'Relative Steuerung — 4 Bit',
    5:   'Vorzeichenlos — 1 Byte',
    6:   'Vorzeichenbehaftet — 1 Byte',
    7:   'Vorzeichenlos — 2 Byte',
    8:   'Vorzeichenbehaftet — 2 Byte',
    9:   'Gleitkomma — 2 Byte',
    10:  'Uhrzeit — 3 Byte',
    11:  'Datum — 3 Byte',
    12:  'Vorzeichenlos — 4 Byte',
    13:  'Vorzeichenbehaftet — 4 Byte',
    14:  'Gleitkomma — 4 Byte',
    16:  'Zeichenkette — 14 Byte',
    17:  'Szenennummer — 1 Byte',
    18:  'Szenensteuerung — 1 Byte',
    19:  'Datum/Zeit — 8 Byte',
    20:  'Aufzählung — 1 Byte',
    232: 'Farbe RGB — 3 Byte',
    251: 'Farbe RGBW — 6 Byte'
  };

  const DPT = [
    { id: '1.001', name: 'Schalten',              desc: 'EIN / AUS' },
    { id: '1.002', name: 'Boolean',               desc: 'wahr / falsch' },
    { id: '1.003', name: 'Freigabe',              desc: 'freigegeben / gesperrt' },
    { id: '1.008', name: 'Auf/Ab',                desc: 'Jalousie-Fahrbefehl' },
    { id: '1.009', name: 'Öffnen/Schließen',      desc: 'Ventil, Tür' },
    { id: '1.010', name: 'Start/Stopp',           desc: 'Jalousie-Stopp, Lamelle' },
    { id: '1.011', name: 'Status',                desc: 'inaktiv / aktiv' },
    { id: '1.019', name: 'Fenster/Tür',           desc: 'geschlossen / offen' },
    { id: '2.001', name: 'Schalten mit Priorität',desc: 'Zwangsführung 2 Bit' },
    { id: '3.007', name: 'Dimmen relativ',        desc: 'heller / dunkler, Schrittweite' },
    { id: '3.008', name: 'Jalousie relativ',      desc: 'Lamellenverstellung, Schrittweite' },
    { id: '5.001', name: 'Prozent (0–100 %)',     desc: 'Helligkeitswert, Position' },
    { id: '5.003', name: 'Winkel (0–360°)',       desc: 'Lamellenwinkel' },
    { id: '5.004', name: 'Prozent (0–255 %)',     desc: 'Stellwert' },
    { id: '5.010', name: 'Zählwert (0–255)',      desc: 'Impulse' },
    { id: '6.010', name: 'Zählwert (−128…127)',   desc: 'Impulse mit Vorzeichen' },
    { id: '7.001', name: 'Zählwert (0–65535)',    desc: 'Impulse' },
    { id: '7.600', name: 'Farbtemperatur (K)',    desc: 'Tunable White' },
    { id: '8.001', name: 'Zählwert (±32767)',     desc: 'Impulse mit Vorzeichen' },
    { id: '9.001', name: 'Temperatur (°C)',       desc: '−273 … +670 760' },
    { id: '9.004', name: 'Beleuchtungsstärke (lux)', desc: 'Helligkeitssensor' },
    { id: '9.005', name: 'Windgeschwindigkeit (m/s)', desc: 'Wetterstation' },
    { id: '9.007', name: 'Luftfeuchte (%)',       desc: 'relative Feuchte' },
    { id: '9.008', name: 'Luftqualität (ppm)',    desc: 'CO₂-Gehalt' },
    { id: '9.020', name: 'Spannung (mV)',         desc: 'Messwert' },
    { id: '9.021', name: 'Strom (mA)',            desc: 'Messwert' },
    { id: '9.024', name: 'Leistung (kW)',         desc: 'Messwert' },
    { id: '10.001', name: 'Uhrzeit',              desc: 'Wochentag, Stunde, Minute, Sekunde' },
    { id: '11.001', name: 'Datum',                desc: 'Tag, Monat, Jahr' },
    { id: '12.001', name: 'Zählwert (4 Byte)',    desc: 'vorzeichenlos' },
    { id: '13.010', name: 'Wirkarbeit (Wh)',      desc: 'Energiezähler' },
    { id: '13.013', name: 'Wirkarbeit (kWh)',     desc: 'Energiezähler' },
    { id: '14.056', name: 'Leistung (W)',         desc: 'Momentanleistung' },
    { id: '14.076', name: 'Volumen (m³)',         desc: 'Zählerstand' },
    { id: '16.000', name: 'Zeichenkette (ASCII)', desc: '14 Zeichen' },
    { id: '17.001', name: 'Szenennummer',         desc: 'Szene 1–64 aufrufen' },
    { id: '18.001', name: 'Szenensteuerung',      desc: 'Szene aufrufen oder speichern' },
    { id: '19.001', name: 'Datum/Zeit',           desc: 'vollständiger Zeitstempel' },
    { id: '20.102', name: 'HVAC-Betriebsart',     desc: 'Komfort/Standby/Nacht/Frostschutz' },
    { id: '20.105', name: 'HVAC-Regelmodus',      desc: 'Heizen/Kühlen/Auto' },
    { id: '232.600', name: 'Farbe RGB',           desc: '3 × 8 Bit' },
    { id: '251.600', name: 'Farbe RGBW',          desc: 'RGB + Weißanteil' }
  ];

  DPT.forEach(d => {
    d.main = +d.id.split('.')[0];
    d.group = DPT_MAIN[d.main] || ('Hauptnummer ' + d.main);
  });

  const DPT_INDEX = new Map(DPT.map(d => [d.id, d]));

  /* Nummern des alten, fachlich falschen Katalogs auf echte DPTs abbilden */
  const DPT_LEGACY = {
    '1': '1.001', '2': '1.001', '3': '3.008', '5': '5.001', '9': '9.001',
    '14': '13.013', '28': '1.011', '3002': '251.600', '3005': '2.001',
    '5001': '17.001', '5002': '18.001', '5003': '10.001'
  };

  const dptById = id => {
    const key = String(id);
    const hit = DPT_INDEX.get(key) || DPT_INDEX.get(DPT_LEGACY[key]);
    if (hit) return hit;
    // Produktdateien bringen DPTs mit, die der Katalog nicht kennt — die dürfen
    // nicht auf 1.001 zusammenfallen, sonst verfälscht der Import die Daten.
    const m = key.match(/^(\d{1,3})\.(\d{1,3})$/);
    if (!m) return DPT_INDEX.get('1.001');
    let d = DPT_EXTRA.get(key);
    if (!d) {
      const main = +m[1];
      d = { id: key, main, name: 'DPT ' + key, desc: 'nicht im Katalog',
            group: DPT_MAIN[main] || ('Hauptnummer ' + main), extra: true };
      DPT_EXTRA.set(key, d);
    }
    return d;
  };
  const DPT_EXTRA = new Map();

  /* DPT-Katalog nach Hauptnummer gruppiert — für <optgroup>. Im Projekt
     verwendete Fremd-DPTs kommen hinten dazu, damit sie wählbar bleiben.   */
  function dptGroups() {
    const out = [];
    let cur = null;
    DPT.forEach(d => {
      if (!cur || cur.label !== d.group) { cur = { label: d.group, items: [] }; out.push(cur); }
      cur.items.push(d);
    });
    if (project) {
      project.devices.forEach(dev => dev.objs.forEach(o => dptById(o.dpt)));
      project.groups.forEach(g => dptById(g.dpt));
    }
    if (DPT_EXTRA.size)
      out.push({ label: 'Aus Produktdateien', items: [...DPT_EXTRA.values()]
        .sort((a, b) => a.main - b.main || a.id.localeCompare(b.id)) });
    return out;
  }

  /* ---------- Gruppenadressen ---------- *
   * Intern ist eine GA immer ein 16-Bit-Rohwert. Die Stufigkeit ist eine
   * reine Darstellungsfrage und gilt projektweit (wie in der ETS).         */
  const GA_STYLES = {
    three: {
      key: 'three', label: '3-stufig  HG/MG/UG',
      parts: [
        { label: 'Hauptgruppe',  bits: 5, max: 31 },
        { label: 'Mittelgruppe', bits: 3, max: 7 },
        { label: 'Untergruppe',  bits: 8, max: 255 }
      ]
    },
    two: {
      key: 'two', label: '2-stufig  HG/UG',
      parts: [
        { label: 'Hauptgruppe', bits: 5,  max: 31 },
        { label: 'Untergruppe', bits: 11, max: 2047 }
      ]
    },
    free: {
      key: 'free', label: 'frei  (0–65535)',
      parts: [ { label: 'Adresse', bits: 16, max: 65535 } ]
    }
  };
  const GA_MAX = 0xFFFF;
  const gaStyle = () => GA_STYLES[project?.gaStyle] || GA_STYLES.three;

  function gaSplit(raw, style = gaStyle()) {
    const out = [];
    let shift = 16;
    for (const p of style.parts) { shift -= p.bits; out.push((raw >>> shift) & p.max); }
    return out;
  }
  function gaJoin(vals, style = gaStyle()) {
    let raw = 0, shift = 16;
    style.parts.forEach((p, i) => { shift -= p.bits; raw |= (vals[i] & p.max) << shift; });
    return raw >>> 0;
  }
  const gaStr = (raw, style = gaStyle()) => gaSplit(raw, style).join('/');
  const addrStr = ga => gaStr(ga.raw);

  /* 0/0/0 ist als Broadcast reserviert. */
  const gaValid = raw => Number.isInteger(raw) && raw > 0 && raw <= GA_MAX;

  /* ---------- Physikalische Adressen ---------- *
   * Bereich.Linie.Teilnehmer = 4/4/8 Bit. Teilnehmer 0 ist der Koppler.    */
  const PA_MAX = { area: 15, line: 15, device: 255 };
  const paJoin = (a, l, d) => (((a & 15) << 12) | ((l & 15) << 8) | (d & 255)) >>> 0;
  const paSplit = raw => [(raw >>> 12) & 15, (raw >>> 8) & 15, raw & 255];
  const paStr = raw => raw == null ? '—' : paSplit(raw).join('.');
  /* Drosseln, Netzteile und passives Zubehör haben keine physikalische Adresse
     (HasIndividualAddress="false"); sie hängen nur an ihrer Linie. */
  const hasPa = d => !!d && Number.isInteger(d.addr);
  const byPa = (x, y) => (hasPa(x) ? x.addr : 0x10000) - (hasPa(y) ? y.addr : 0x10000);

  /* ---------- Gebäudestruktur ---------- *
   * Wie in der ETS: keine feste Ebenenkette, sondern erlaubte Kindtypen.   */
  const NODE_KINDS = {
    site:     { de: 'Liegenschaft', holds: ['building', 'outdoor'] },
    building: { de: 'Gebäude',      holds: ['part', 'floor', 'room', 'corridor', 'cabinet'] },
    part:     { de: 'Gebäudeteil',  holds: ['part', 'floor', 'room', 'corridor', 'cabinet'] },
    floor:    { de: 'Geschoss',     holds: ['room', 'corridor', 'cabinet'] },
    outdoor:  { de: 'Außenbereich', holds: ['room', 'cabinet'] },
    room:     { de: 'Raum',         holds: ['cabinet'] },
    corridor: { de: 'Flur',         holds: ['cabinet'] },
    cabinet:  { de: 'Verteiler',    holds: [] }
  };
  /* Typen, in denen Geräte verbaut werden können. */
  const DEVICE_HOSTS = new Set(['room', 'corridor', 'cabinet', 'outdoor']);

  const LEGACY_KINDS = { object: 'site', zone: 'building', building: 'floor', room: 'room' };

  const kindDe = k => (NODE_KINDS[k] || NODE_KINDS.room).de;
  const kindHolds = k => (NODE_KINDS[k] || NODE_KINDS.room).holds;
  const isRoom = n => DEVICE_HOSTS.has(n.kind);

  /* ---------- Kommunikationsobjekte ---------- *
   * Flags nach ETS: K Kommunikation, L Lesen, S Schreiben, Ü Übertragen,
   * A Aktualisieren. Die erste zugewiesene GA eines KO ist die sendende.   */
  const KO_FLAGS = [
    { key: 'c', short: 'K', de: 'Kommunikation', desc: 'Objekt nimmt am Bus teil' },
    { key: 'r', short: 'L', de: 'Lesen',         desc: 'Wert darf ausgelesen werden' },
    { key: 'w', short: 'S', de: 'Schreiben',     desc: 'Objekt nimmt Werte vom Bus an' },
    { key: 't', short: 'Ü', de: 'Übertragen',    desc: 'Objekt sendet von sich aus' },
    { key: 'u', short: 'A', de: 'Aktualisieren', desc: 'Wert wird durch Lesen aktualisiert' }
  ];
  const flagStr = f => KO_FLAGS.map(x => f && f[x.key] ? x.short : '–').join('');

  const MEDIA = { tp: 'TP (Twisted Pair)', ip: 'IP', rf: 'RF (Funk)', pl: 'PL (Powerline)' };

  /* ---------- IP-Konfiguration ---------- *
   * KNXnet/IP-Geräte bekommen Adresse, Maske und Multicast nicht aus der
   * Produktdatei, sondern aus dem Eigenschaftsfenster der ETS. Das Schema
   * ist deshalb fest verdrahtet.                                           */
  const IP_MODES = [
    ['dhcp',   'Automatisch (DHCP / AutoIP)'],
    ['manual', 'Manuell']
  ];
  const IP_FIELDS = [
    { key: 'name',    label: 'Gerätename',        kind: 'text', max: 30 },
    { key: 'mode',    label: 'IP-Adresse beziehen', kind: 'enum', v: IP_MODES },
    { key: 'addr',    label: 'IP-Adresse',        kind: 'ip', manualOnly: true },
    { key: 'mask',    label: 'Subnetzmaske',      kind: 'ip', manualOnly: true },
    { key: 'gw',      label: 'Standardgateway',   kind: 'ip', manualOnly: true },
    { key: 'mcast',   label: 'Routing-Multicast', kind: 'ip' },
    { key: 'tunnels', label: 'Tunnelverbindungen', kind: 'num', min: 0, max: 8 }
  ];
  const IP_DEFAULTS = { name: '', mode: 'dhcp', addr: '', mask: '255.255.255.0',
                        gw: '', mcast: '224.0.23.12', tunnels: 4 };
  const isIpV4 = s => /^((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)$/.test(String(s));

  /* Gerät bringt IP mit — unabhängig davon, wo es hängt. */
  function deviceCanIp(dev) {
    if (!dev) return false;
    if (dev.ip) return true;
    const item = dev.catalogId && catalogById(dev.catalogId);
    return !!(item && item.ip);
  }

  /* Für die Darstellung zählt auch die Linie: Wer am IP-Strang hängt,
     bekommt die IP-Felder.                                                */
  function deviceIsIp(dev) {
    if (deviceCanIp(dev)) return true;
    const l = dev && lineById(dev.lineId);
    return !!l && l.medium === 'ip';
  }
  const ipConfig = dev => ({ ...IP_DEFAULTS, ...(dev.ip || {}) });

  /* ---------- Busstrom ---------- *
   * TP-Teilnehmer ziehen typisch 10 mA; die Produktdateien nennen den Wert
   * als BusCurrent. Einspeisungen tragen ihren Nennstrom als `supply`.     */
  const MA_DEFAULT = 10;
  const deviceMa = d => {
    if (Number.isInteger(d.ma) && d.ma >= 0) return d.ma;
    const item = d.catalogId && catalogById(d.catalogId);
    if (item && item.ma) return item.ma;
    // Eine reine Einspeisung zieht selbst nichts; programmierbare Netzteile
    // sind zugleich Teilnehmer und bekommen dann einen eigenen Wert.
    return (+d.supply > 0) ? 0 : MA_DEFAULT;
  };

  /* Bedarf und Deckung einer Linie. Ein Gerät kann beides sein: einspeisen
     und als Teilnehmer Strom ziehen.                                       */
  function powerBudget(lineId) {
    const line = lineById(lineId);
    if (!line || line.medium !== 'tp') return null;
    let need = 0, have = 0;
    const supplies = [], loads = [];
    devicesOnLine(lineId).forEach(d => {
      const s = +d.supply || 0;
      if (s > 0) { have += s; supplies.push(d); }
      const ma = deviceMa(d);
      if (ma > 0) { need += ma; loads.push(d); }
    });
    return { need, have, supplies, loads, reserve: have - need };
  }

  /* ---------- Projekt (persistiert) ---------- */
  const SCHEMA = 3;
  let project = null;
  const LS_KEY = 'knx-structure-v1';
  let dirty = false;

  function newProject(name) {
    const n = name || 'Mein Wohnobjekt';
    return {
      schema: SCHEMA,
      name: n,
      isSample: false,
      gaStyle: 'three',
      seq: 2,
      tree: { id: 'n1', kind: 'site', name: n, children: [] },
      areas: [ { id: 'a1', addr: 1, name: 'Bereich 1',
                 lines: [ { id: 'l1', addr: 1, name: 'Hauptlinie', medium: 'tp' } ] } ],
      devices: [],       // { id, name, product, lineId, addr, roomId, serial, note, objs[] }
      groups: [],        // { id, raw, name, dpt, note }
      gaNames: {},       // '1' / '1/2' → Name der Haupt- bzw. Mittelgruppe
      catalog: []        // aus .knxprod übernommene Produkte
    };
  }

  const nid = pfx => pfx + (project.seq++);

  /* ---------- Migration ---------- *
   * Fehlende oder unbrauchbare Felder werden ergänzt bzw. gekappt, niemals
   * wird ein Projekt deswegen verworfen. Jede stille Änderung an Nutzdaten
   * landet in `notes` und wird der Bedienung gemeldet.                     */
  let notes = [];
  const note = m => { if (notes.length < 40) notes.push(m); };

  function migrate(p) {
    if (!p || typeof p !== 'object' || !p.tree || !Array.isArray(p.groups)) return null;
    notes = [];
    const fromOldSchema = !(+p.schema >= 3);

    p.name     = String(p.name || 'Unbenanntes Projekt');
    p.gaStyle  = GA_STYLES[p.gaStyle] ? p.gaStyle : 'three';
    p.isSample = !!p.isSample;
    p.gaNames  = (p.gaNames && typeof p.gaNames === 'object') ? p.gaNames : {};

    let seq = Math.max(+p.seq || 0, +p.nextNodeId || 0, +p.nextGaId || 0, 1);
    const takeId = (cur, pfx, seen) => {
      let id = cur;
      if (!id || seen.has(id)) id = pfx + (++seq);
      seen.add(id);
      const num = +String(id).replace(/\D/g, '');
      if (num > seq) seq = num;
      return id;
    };

    // Gebäudestruktur: unbekannte Typen auf erlaubte Kindtypen kappen
    const seenNodes = new Set();
    const roomIds = new Set();
    const fixNode = (n, allowed) => {
      let k = n.kind || LEGACY_KINDS[n.level] || n.level;
      if (!NODE_KINDS[k] || (allowed && !allowed.includes(k))) k = allowed ? allowed[allowed.length - 1] : 'room';
      n.kind = k;
      delete n.level;
      n.name = String(n.name || kindDe(k));
      n.note = normNote(n.note);
      n.id = takeId(n.id, 'n', seenNodes);
      if (DEVICE_HOSTS.has(k)) roomIds.add(n.id);
      n.children = Array.isArray(n.children) ? n.children : [];
      const holds = kindHolds(k);
      if (!holds.length) n.children = [];
      else n.children.forEach(c => fixNode(c, holds));
    };
    fixNode(p.tree, null);
    p.tree.kind = 'site';

    // Topologie
    const seenTopo = new Set();
    p.areas = (Array.isArray(p.areas) ? p.areas : []).map(a => ({
      id: takeId(a.id, 'a', seenTopo),
      addr: clamp(a.addr, 0, PA_MAX.area, 1),
      name: String(a.name || 'Bereich'),
      note: normNote(a.note),
      lines: (Array.isArray(a.lines) ? a.lines : []).map(l => ({
        id: takeId(l.id, 'l', seenTopo),
        addr: clamp(l.addr, 0, PA_MAX.line, 1),
        name: String(l.name || 'Linie'),
        medium: MEDIA[l.medium] ? l.medium : 'tp',
        note: normNote(l.note)
      }))
    }));
    if (!p.areas.length) p.areas = newProject(p.name).areas;
    if (!p.areas.some(a => a.lines.length))
      p.areas[0].lines.push({ id: 'l' + (++seq), addr: 1, name: 'Hauptlinie', medium: 'tp' });
    const lineIds = new Set();
    p.areas.forEach(a => a.lines.forEach(l => lineIds.add(l.id)));
    const firstLine = p.areas.find(a => a.lines.length).lines[0].id;

    // Gruppenadressen: Adresse auf 16-Bit-Rohwert bringen, DPT umschlüsseln
    const seenGa = new Set();
    const usedRaw = new Set();
    const legacyRooms = new Map();       // GA-ID → Räume aus Schema ≤ 2
    const dptMoves = new Map();          // alte Nummer → { to, count }
    p.groups = p.groups.filter(g => g && typeof g === 'object').map(g => {
      let raw = 0;
      if (Number.isInteger(g.raw)) {
        raw = g.raw;
      } else {
        // Altbestand: getrennte Felder, damals ohne gültige Wertebereiche
        const v = [+g.area || 0, +g.member || 0, +g.sub || 0];
        const lim = GA_STYLES.three.parts;
        if (v.some((x, i) => x < 0 || x > lim[i].max))
          note(`Adresse ${v.join('/')} („${g.name || 'ohne Namen'}“) war ungültig — neu vergeben.`);
        else
          raw = gaJoin(v, GA_STYLES.three);
      }
      if (!gaValid(raw)) raw = 0;
      else if (usedRaw.has(raw)) {
        note(`Adresse ${gaStr(raw, GA_STYLES.three)} war doppelt vergeben — „${g.name || 'ohne Namen'}“ neu vergeben.`);
        raw = 0;
      }
      if (raw) usedRaw.add(raw);
      const id = takeId(g.id, 'g', seenGa);
      if (Array.isArray(g.rooms) && g.rooms.length)
        legacyRooms.set(id, g.rooms.filter(r => roomIds.has(r)));
      const dpt = dptById(g.dpt).id;
      // gleichartige Umschlüsselungen sammeln — einzeln gemeldet sind es Dutzende
      if (fromOldSchema && g.dpt && String(g.dpt) !== dpt) {
        const e = dptMoves.get(String(g.dpt));
        if (e) e.count++; else dptMoves.set(String(g.dpt), { to: dpt, count: 1 });
      }
      return {
        id, raw,
        name: String(g.name || 'Unbenannt'),
        dpt,
        note: String(g.note || '')
      };
    });
    dptMoves.forEach((v, k) => note(
      `Datenpunkttyp „${k}“ gibt es nicht — ` +
      `${v.count} ${v.count === 1 ? 'Adresse' : 'Adressen'} auf ${v.to} gesetzt.`));
    // entwertete Adressen bekommen die nächste freie Adresse statt verworfen zu werden
    let probe = 1;
    p.groups.filter(g => !g.raw).forEach(g => {
      while (probe <= GA_MAX && usedRaw.has(probe)) probe++;
      g.raw = probe <= GA_MAX ? probe : 0;
      if (g.raw) usedRaw.add(g.raw);
    });
    const gaIds = new Set(p.groups.map(g => g.id));

    // Geräte und Kommunikationsobjekte
    const seenDev = new Set(), usedPa = new Set();
    p.devices = (Array.isArray(p.devices) ? p.devices : []).map(d => {
      const seenObj = new Set();
      let pa = d.addr === null ? null : Number.isInteger(d.addr) ? d.addr : 0;
      if (pa === null) { /* Gerät ohne physikalische Adresse */ }
      else if (usedPa.has(pa)) pa = -1;                  // Dublette → neu vergeben
      else usedPa.add(pa);
      return {
        id: takeId(d.id, 'd', seenDev),
        name: String(d.name || 'Gerät'),
        product: String(d.product || ''),
        lineId: lineIds.has(d.lineId) ? d.lineId : firstLine,
        addr: pa,
        roomId: roomIds.has(d.roomId) ? d.roomId : null,
        catalogId: d.catalogId || null,
        note: normNote(d.note),
        serial: normSerial(d.serial),
        params: (d.params && typeof d.params === 'object') ? d.params : {},
        ip: (d.ip && typeof d.ip === 'object') ? d.ip : null,
        ma: Number.isInteger(d.ma) && d.ma >= 0 ? d.ma : null,
        supply: clamp(d.supply, 0, 5000, 0),
        objs: (Array.isArray(d.objs) ? d.objs : []).map((o, i) => ({
          id: takeId(o.id, 'o', seenObj),
          ref: o.ref || null,
          num: clamp(o.num, 0, 65535, i),
          name: String(o.name || 'Objekt'),
          dpt: dptById(o.dpt).id,
          flags: normFlags(o.flags),
          stale: !!o.stale,
          gas: (Array.isArray(o.gas) ? o.gas : []).filter(x => gaIds.has(x))
        }))
      };
    });
    p.devices.filter(d => d.addr < 0).forEach(d => { d.addr = freePaOn(p, d.lineId, usedPa); });

    // Produktkatalog
    const seenCat = new Set();
    p.catalog = (Array.isArray(p.catalog) ? p.catalog : []).map(c => {
      // Früher war objs eine Liste; jetzt sind es Referenzen mit Sichtbarkeit
      let objs = c.objs;
      if (Array.isArray(objs)) {
        const o = {};
        objs.forEach((x, i) => {
          o['O-' + i] = { num: clamp(x.num, 0, 65535, i), name: String(x.name || 'Objekt'),
                          dpt: dptById(x.dpt).id, f: flagStr2(x.flags) };
        });
        objs = o;
      }
      return {
        id: takeId(c.id, 'c', seenCat),
        name: String(c.name || 'Produkt'),
        order: String(c.order || ''),
        manufacturer: String(c.manufacturer || ''),
        appName: String(c.appName || ''),
        types: (c.types && typeof c.types === 'object') ? c.types : {},
        params: (c.params && typeof c.params === 'object') ? c.params : {},
        objs: (objs && typeof objs === 'object') ? objs : {},
        dyn: Array.isArray(c.dyn) ? c.dyn : [],
        // Programmierdaten aus der Produktdatei; alte Kataloge haben sie nicht.
        prog: (c.prog && typeof c.prog === 'object') ? c.prog : null,
        mask: String(c.mask || ''),
        ip: !!c.ip,
        medium: String(c.medium || ''),
        ma: clamp(c.ma, 0, 5000, 0),
        coupler: !!c.coupler,
        powerSupply: !!c.powerSupply,
        choke: !!c.choke,
        noAddress: !!c.noAddress,
        hwOnly: !!c.hwOnly
      };
    }).filter(c => Object.keys(c.objs).length || Object.keys(c.params).length || c.hwOnly);
    const catIds = new Set(p.catalog.map(c => c.id));
    p.devices.forEach(d => {
      if (!catIds.has(d.catalogId)) { d.catalogId = null; d.params = {}; }
    });

    // Schema ≤ 2: Raumzuordnungen in Planungsgeräte überführen — sonst ginge
    // die einzige Verknüpfungsinformation des Altprojekts verloren.
    if (legacyRooms.size) {
      const byRoom = new Map();
      legacyRooms.forEach((rooms, gid) => rooms.forEach(r => {
        if (!byRoom.has(r)) byRoom.set(r, []);
        byRoom.get(r).push(gid);
      }));
      byRoom.forEach((gids, roomId) => {
        const node = findNodeIn(p.tree, roomId);
        const dev = {          id: 'd' + (++seq),
          name: 'Planungsgerät ' + (node ? node.name : ''),
          product: 'aus Altprojekt übernommen',
          lineId: firstLine,
          addr: 0,
          roomId,
          placeholder: true,
          objs: gids.map((gid, i) => {
            const ga = p.groups.find(g => g.id === gid);
            return {
              id: 'o' + (++seq), num: i, name: ga ? ga.name : 'Objekt',
              dpt: ga ? ga.dpt : '1.001',
              flags: { c: true, r: false, w: true, t: true, u: false },
              gas: [gid]
            };
          })
        };
        dev.addr = freePaOn(p, firstLine, usedPa);
        p.devices.push(dev);
      });
      note(`${byRoom.size} ${byRoom.size === 1 ? 'Planungsgerät' : 'Planungsgeräte'} aus den ` +
           'früheren Raumzuordnungen erzeugt — Gruppenadressen hängen jetzt an Kommunikationsobjekten.');
    }

    p.seq = seq + 1;
    p.schema = SCHEMA;
    delete p.nextNodeId;
    delete p.nextGaId;
    return p;
  }

  function clamp(v, lo, hi, dflt) {
    const n = Number(v);
    return Number.isInteger(n) && n >= lo && n <= hi ? n : dflt;
  }
  /* Notizen sind frei, aber begrenzt — sie wandern in jede Projektdatei mit. */
  const NOTE_MAX = 2000;
  const normNote = v => String(v == null ? '' : v).slice(0, NOTE_MAX);
  /* Seriennummer: 6 Byte, in der Anzeige ohne Trenner und in Grossbuchstaben. */
  function normSerial(v) {
    const hex = String(v == null ? '' : v).replace(/[^0-9a-fA-F]/g, '').toUpperCase();
    return hex.length === 12 ? hex : '';
  }
  function normFlags(f) {
    const out = {};
    KO_FLAGS.forEach(x => { out[x.key] = !!(f && f[x.key]); });
    if (!f) { out.c = true; out.w = true; }
    return out;
  }
  const flagStr2 = f => KO_FLAGS.map(x => f && f[x.key] ? x.key : '').join('');
  function findNodeIn(node, id) {
    if (node.id === id) return node;
    for (const c of node.children || []) {
      const r = findNodeIn(c, id);
      if (r) return r;
    }
    return null;
  }
  /* Kleinste freie Teilnehmernummer auf einer Linie; 0 bleibt dem Koppler. */
  function freePaOn(p, lineId, used) {
    let area = 0, line = 0;
    p.areas.forEach(a => a.lines.forEach(l => { if (l.id === lineId) { area = a.addr; line = l.addr; } }));
    for (let d = 1; d <= PA_MAX.device; d++) {
      const raw = paJoin(area, line, d);
      if (!used.has(raw)) { used.add(raw); return raw; }
    }
    return paJoin(area, line, 0);
  }

  /* ---------- Musterprojekt (als Starthilfe, im UI als „Musterprojekt“ gekennzeichnet) ---------- */
  function seedProject() {
    const p = newProject('Haus Musterstraße 12');
    p.isSample = true;
    const uid = pfx => pfx + (p.seq++);

    /* --- Gebäudestruktur --- */
    const mk = (kind, name, kids = []) => ({ id: uid('n'), kind, name, children: kids });

    const rwd  = mk('room', 'Wohnzimmer');
    const rkw  = mk('room', 'Küche');
    const rhb  = mk('room', 'Hausbad');
    const rfg  = mk('corridor', 'Flur EG');
    const rhr  = mk('cabinet', 'Verteiler EG');
    const rflg = mk('corridor', 'Flur OG');
    const rsch = mk('room', 'Schlafen');
    const rk   = mk('room', 'Kind');
    const rbd  = mk('room', 'Badezimmer');
    const rvo  = mk('cabinet', 'Verteiler OG');
    const rsts = mk('room', 'Südterrasse');
    const rnts = mk('room', 'Nordseite');

    const eg = mk('floor', 'Erdgeschoss', [rfg, rwd, rkw, rhb, rhr]);
    const og = mk('floor', 'Obergeschoss', [rflg, rsch, rk, rbd, rvo]);
    const hh = mk('building', 'Haupthaus', [eg, og]);
    const aa = mk('outdoor', 'Außenanlagen', [rsts, rnts]);
    p.tree.children.push(hh, aa);

    /* --- Topologie --- *
     * Heute üblich: IP als Backbone, darunter TP-Linien. Der IP-Router sitzt
     * mit seiner physikalischen Adresse auf der TP-Seite.                  */
    const lHl  = { id: uid('l'), addr: 0, name: 'IP-Backbone', medium: 'ip' };
    const lEg  = { id: uid('l'), addr: 1, name: 'Linie EG',    medium: 'tp' };
    const lOg  = { id: uid('l'), addr: 2, name: 'Linie OG',    medium: 'tp' };
    const lAus = { id: uid('l'), addr: 3, name: 'Linie Außen', medium: 'tp' };
    p.areas = [ { id: uid('a'), addr: 1, name: 'Haupthaus', lines: [lHl, lEg, lOg, lAus] } ];

    /* --- Gruppenadress-Struktur --- */
    p.gaNames = {
      '0': 'Zentralfunktionen',   '0/0': 'Uhrzeit & Datum',
      '1': 'Beleuchtung',         '1/0': 'Zentral', '1/1': 'Erdgeschoss', '1/2': 'Obergeschoss', '1/3': 'Außen',
      '2': 'Beschattung',         '2/0': 'Zentral', '2/1': 'Erdgeschoss', '2/3': 'Außen',
      '3': 'Heizung / Klima',     '3/0': 'Zentral', '3/1': 'Erdgeschoss', '3/2': 'Obergeschoss',
      '4': 'Szenen',              '4/0': 'Zentral', '4/1': 'Erdgeschoss',
      '5': 'Messwerte',           '5/1': 'Energie', '5/3': 'Wetter'
    };

    // Hauptgruppe = Gewerk, Mittelgruppe = Geschoss, Untergruppe = Funktion.
    const ga = (hg, mg, ug, name, dpt, note = '') => {
      const g = { id: uid('g'), raw: gaJoin([hg, mg, ug], GA_STYLES.three), name, dpt, note };
      p.groups.push(g);
      return g.id;
    };

    const G = {
      liWzS:  ga(1, 1, 1,  'Licht Wohnzimmer schalten',    '1.001', 'Deckenlicht'),
      liWzD:  ga(1, 1, 2,  'Licht Wohnzimmer dimmen',      '3.007'),
      liWzW:  ga(1, 1, 3,  'Licht Wohnzimmer Helligkeit',  '5.001', 'Absolutwert'),
      liWzR:  ga(1, 1, 4,  'Licht Wohnzimmer Status',      '1.011'),
      liKuS:  ga(1, 1, 10, 'Licht Küche schalten',         '1.001'),
      liKuR:  ga(1, 1, 11, 'Licht Küche Status',           '1.011'),
      liFlS:  ga(1, 1, 20, 'Licht Flur EG schalten',       '1.001', 'Präsenzmelder'),
      liBaS:  ga(1, 1, 30, 'Licht Hausbad schalten',       '1.001'),
      liKiS:  ga(1, 2, 1,  'Licht Kinderzimmer schalten',  '1.001'),
      liScS:  ga(1, 2, 2,  'Nachttischlampe schalten',     '1.001'),
      liBdS:  ga(1, 2, 10, 'Licht Badezimmer schalten',    '1.001'),
      liTeS:  ga(1, 3, 1,  'Licht Südterrasse schalten',   '1.001'),
      liZeA:  ga(1, 0, 1,  'Licht ZENTRAL AUS',            '1.001', 'Zentralfunktion'),

      beWzF:  ga(2, 1, 1,  'Rollladen Wohnzimmer Auf/Ab',  '1.008'),
      beWzS:  ga(2, 1, 2,  'Rollladen Wohnzimmer Stopp',   '1.010', 'Lamellenverstellung'),
      beWzP:  ga(2, 1, 3,  'Rollladen Wohnzimmer Position','5.001'),
      beWzR:  ga(2, 1, 4,  'Rollladen Wohnzimmer Rückmeldung', '5.001'),
      beKuF:  ga(2, 1, 10, 'Rollladen Küche Auf/Ab',       '1.008'),
      beMaF:  ga(2, 3, 1,  'Markise Südterrasse Auf/Ab',   '1.008'),
      beZeF:  ga(2, 0, 1,  'Beschattung ZENTRAL Auf/Ab',   '1.008', 'Tagesprogramm'),

      hzWzI:  ga(3, 1, 1,  'Wohnzimmer Isttemperatur',     '9.001'),
      hzWzO:  ga(3, 1, 2,  'Wohnzimmer Solltemperatur',    '9.001'),
      hzWzY:  ga(3, 1, 3,  'Wohnzimmer Stellgröße',        '5.001', 'Ventilantrieb'),
      hzScI:  ga(3, 2, 1,  'Schlafen Isttemperatur',       '9.001'),
      hzScO:  ga(3, 2, 2,  'Schlafen Solltemperatur',      '9.001'),
      hzZeM:  ga(3, 0, 1,  'HVAC-Betriebsart ZENTRAL',     '20.102', 'Komfort/Nacht/Frost'),

      szWz:   ga(4, 1, 1,  'Szene Wohnzimmer',             '18.001', 'Szene 1–4'),
      szZe:   ga(4, 0, 1,  'Szene ZENTRAL',                '17.001', 'Anwesend/Abwesend'),

      meArb:  ga(5, 1, 1,  'Wärmezähler Arbeit',           '13.013'),
      meLei:  ga(5, 1, 2,  'Wärmezähler Leistung',         '14.056'),
      weTem:  ga(5, 3, 1,  'Außentemperatur',              '9.001', 'Wetterstation'),
      weWin:  ga(5, 3, 2,  'Windgeschwindigkeit',          '9.005', 'Wetterstation'),
      weHel:  ga(5, 3, 3,  'Helligkeit Süd',               '9.004', 'Wetterstation'),
      weFlu:  ga(5, 3, 4,  'Helligkeit Flur EG',           '9.004', 'Präsenzmelder'),

      syZeit: ga(0, 0, 1,  'Systemzeit',                   '10.001', 'Broadcast'),
      syDatum:ga(0, 0, 2,  'Systemdatum',                  '11.001', 'Broadcast')
    };

    /* --- Geräte und Kommunikationsobjekte --- *
     * S = sendend (K,Ü), E = empfangend (K,S), R = Rückmeldung (K,L,Ü)     */
    const S = { c: true, r: false, w: false, t: true,  u: false };
    const E = { c: true, r: false, w: true,  t: false, u: false };
    const R = { c: true, r: true,  w: false, t: true,  u: false };

    let objNum = 0;
    const dev = (line, addr, name, product, room, objs, extra) => {
      objNum = 0;
      const d = {
        id: uid('d'), name, product, lineId: line.id,
        addr: paJoin(1, line.addr, addr), roomId: room ? room.id : null,
        catalogId: null, params: {}, ip: null, ma: null, supply: 0,
        objs: objs.map(o => ({
          id: uid('o'), ref: null, num: objNum++, name: o[0], dpt: o[1], flags: o[2],
          gas: o.slice(3).filter(Boolean)
        }))
      };
      if (extra) Object.assign(d, extra);
      p.devices.push(d);
      return d;
    };

    // Teilnehmer 0 jeder TP-Linie ist ihr Koppler zum IP-Backbone. Die
    // Filtertabellen ergeben sich aus den Adressen über die Liniengrenze.
    const ipRouter = (line, name, room) => dev(line, 0, name, 'REG, KNXnet/IP', room, [], {
      ma: 10,
      ip: { name, mode: 'dhcp', addr: '', mask: '255.255.255.0', gw: '',
            mcast: '224.0.23.12', tunnels: 4 }
    });
    ipRouter(lEg,  'IP-Router EG',    rhr);
    ipRouter(lOg,  'IP-Router OG',    rvo);
    ipRouter(lAus, 'IP-Router Außen', rhr);

    // Einspeisungen brauchen am Bus keine Adresse; hier hinten einsortiert
    dev(lEg, 250, 'Spannungsversorgung 640 mA', 'REG, Drossel', rhr, [], { supply: 640, ma: 0 });
    dev(lOg, 250, 'Spannungsversorgung 320 mA', 'REG, Drossel', rvo, [], { supply: 320, ma: 0 });
    dev(lAus, 250, 'Spannungsversorgung 160 mA', 'REG, Drossel', rhr, [], { supply: 160, ma: 0 });
    dev(lEg, 2, 'Schaltaktor 8-fach', 'REG, 16 A', rhr, [
      ['A1 Schalten Küche',      '1.001', E, G.liKuS, G.liZeA],
      ['A1 Status',              '1.011', R, G.liKuR],
      ['A2 Schalten Flur EG',    '1.001', E, G.liFlS, G.liZeA],
      ['A3 Schalten Hausbad',    '1.001', E, G.liBaS, G.liZeA],
      ['A4 Schalten Terrasse',   '1.001', E, G.liTeS, G.liZeA]
    ]);
    dev(lEg, 3, 'Dimmaktor 2-fach', 'REG, 250 W', rhr, [
      ['A1 Schalten',   '1.001', E, G.liWzS],
      ['A1 Dimmen',     '3.007', E, G.liWzD],
      ['A1 Helligkeit', '5.001', E, G.liWzW],
      ['A1 Status',     '1.011', R, G.liWzR]
    ]);
    dev(lEg, 4, 'Jalousieaktor 4-fach', 'REG', rhr, [
      ['A1 Auf/Ab',         '1.008', E, G.beWzF, G.beZeF],
      ['A1 Stopp/Schritt',  '1.010', E, G.beWzS],
      ['A1 Position',       '5.001', E, G.beWzP],
      ['A1 Positionsrückm.','5.001', R, G.beWzR],
      ['A2 Auf/Ab',         '1.008', E, G.beKuF, G.beZeF],
      ['A3 Markise Auf/Ab', '1.008', E, G.beMaF, G.beZeF]
    ]);
    dev(lEg, 5, 'Heizungsaktor 6-fach', 'REG, Ventilantriebe', rhr, [
      ['A1 Stellgröße Wohnzimmer', '5.001', E, G.hzWzY]
    ]);
    dev(lEg, 10, 'Taster 4-fach Wohnzimmer', 'UP, Wippe', rwd, [
      ['T1 Schalten',   '1.001', S, G.liWzS],
      ['T1 Dimmen',     '3.007', S, G.liWzD],
      ['T2 Auf/Ab',     '1.008', S, G.beWzF],
      ['T2 Stopp',      '1.010', S, G.beWzS],
      ['T3 Szene',      '18.001', S, G.szWz],
      ['T4 Zentral AUS','1.001', S, G.liZeA]
    ]);
    dev(lEg, 11, 'Raumtemperaturregler Wohnzimmer', 'UP, Display', rwd, [
      ['Isttemperatur',  '9.001',  R, G.hzWzI],
      ['Solltemperatur', '9.001',  S, G.hzWzO],
      ['Stellgröße',     '5.001',  S, G.hzWzY],
      ['Betriebsart',    '20.102', E, G.hzZeM]
    ]);
    dev(lEg, 12, 'Taster 2-fach Küche', 'UP', rkw, [
      ['T1 Schalten', '1.001', S, G.liKuS],
      ['T1 Status',   '1.011', E, G.liKuR],
      ['T2 Auf/Ab',   '1.008', S, G.beKuF]
    ]);
    dev(lEg, 13, 'Präsenzmelder Flur EG', 'Decke, 360°', rfg, [
      ['Schalten',   '1.001', S, G.liFlS],
      ['Helligkeit', '9.004', R, G.weFlu]
    ]);
    dev(lEg, 14, 'Taster 1-fach Hausbad', 'UP', rhb, [
      ['T1 Schalten', '1.001', S, G.liBaS]
    ]);
    dev(lEg, 20, 'Wärmezähler M-Bus-Gateway', 'REG', rhr, [
      ['Zählerstand', '13.013', R, G.meArb],
      ['Leistung',    '14.056', R, G.meLei]
    ]);

    dev(lOg, 1, 'Schaltaktor 4-fach OG', 'REG, 16 A', rvo, [
      ['A1 Schalten Kind',      '1.001', E, G.liKiS, G.liZeA],
      ['A2 Schalten Schlafen',  '1.001', E, G.liScS, G.liZeA],
      ['A3 Schalten Badezimmer','1.001', E, G.liBdS, G.liZeA]
    ]);
    dev(lOg, 10, 'Taster 2-fach Schlafen', 'UP', rsch, [
      ['T1 Schalten', '1.001', S, G.liScS],
      ['T2 Solltemperatur', '9.001', S, G.hzScO]
    ]);
    dev(lOg, 11, 'Temperatursensor Schlafen', 'UP', rsch, [
      ['Isttemperatur', '9.001', R, G.hzScI]
    ]);
    dev(lOg, 12, 'Taster 1-fach Kind', 'UP', rk, [
      ['T1 Schalten', '1.001', S, G.liKiS]
    ]);
    dev(lOg, 13, 'Taster 1-fach Badezimmer', 'UP', rbd, [
      ['T1 Schalten', '1.001', S, G.liBdS]
    ]);

    dev(lAus, 1, 'Wetterstation', 'Mast, Süd', rnts, [
      ['Außentemperatur',   '9.001', R, G.weTem],
      ['Windgeschwindigkeit','9.005', R, G.weWin],
      ['Helligkeit Süd',    '9.004', R, G.weHel]
    ]);
    dev(lAus, 2, 'Zeitschaltuhr / Logikmodul', 'REG', rhr, [
      ['Systemzeit',           '10.001', S, G.syZeit],
      ['Systemdatum',          '11.001', S, G.syDatum],
      ['Beschattung Tagesprg.','1.008',  S, G.beZeF],
      ['Betriebsart',          '20.102', S, G.hzZeM],
      ['Szene Anwesenheit',    '17.001', S, G.szZe],
      ['Zentral AUS',          '1.001',  S, G.liZeA]
    ]);

    return p;
  }

  /* ---------- Persistenz ---------- */
  let lastSaveError = '';

  function save() {
    try {
      const json = JSON.stringify(project);
      const backend = window.KNXBackend;
      if (backend) {
        // Der Dienst schreibt gebuendelt im Hintergrund; Fehler kommen ueber saveError() zurueck.
        backend.saveProject(json);
        dirty = false;
        lastSaveError = backend.saveError();
        return !lastSaveError;
      }
      localStorage.setItem(LS_KEY, json);
      dirty = false;
      lastSaveError = '';
      return true;
    } catch (e) {
      lastSaveError = e && e.name === 'QuotaExceededError'
        ? 'Der Browserspeicher ist voll — das Projekt wurde NICHT gespeichert. '
          + 'Bitte exportieren oder den lokalen Dienst starten.'
        : 'Speichern fehlgeschlagen: ' + (e && e.message ? e.message : 'unbekannter Fehler');
      return false;
    }
  }

  function load() {
    // Im Dienstbetrieb liegt das Projekt schon vor, bevor diese Datei geladen wird.
    const boot = window.KNXBoot;
    if (boot && boot.project) {
      try {
        const p = migrate(boot.project);
        if (p) { project = p; return true; }
      } catch (e) { /* beschaedigte Datei — Musterprojekt laden */ }
    }
    if (!boot || boot.mode !== 'server') {
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) {
          const p = migrate(JSON.parse(raw));
          if (p) { project = p; return true; }
        }
      } catch (e) { /* beschaedigter Eintrag — Musterprojekt laden */ }
    }
    project = seedProject();
    save();
    return false;
  }

  /* ---------- Index ---------- *
   * Wird bei jeder Änderung verworfen und beim nächsten Zugriff neu gebaut.
   * Ohne ihn wäre jede Zeile der Tabelle eine Baumtraversierung.           */
  let idx = null;
  const invalidate = () => { idx = null; };
  const push = (map, key, val) => {
    const a = map.get(key);
    if (a) a.push(val); else map.set(key, [val]);
  };

  function index() {
    if (idx) return idx;
    const nodes = new Map(), parent = new Map(), trail = new Map(), roomList = [];
    (function scan(n, path) {
      nodes.set(n.id, n);
      trail.set(n.id, path);
      if (DEVICE_HOSTS.has(n.kind)) roomList.push(n);
      const next = path.concat(n.name);
      (n.children || []).forEach(c => { parent.set(c.id, n.id); scan(c, next); });
    })(project.tree, []);

    const ga = new Map(), gaByRaw = new Map();
    project.groups.forEach(g => { ga.set(g.id, g); gaByRaw.set(g.raw, g); });

    const lines = new Map(), areaOfLine = new Map();
    project.areas.forEach(a => a.lines.forEach(l => { lines.set(l.id, l); areaOfLine.set(l.id, a); }));

    const dev = new Map(), obj = new Map(), gaLinks = new Map();
    const devByRoom = new Map(), devByLine = new Map();
    project.devices.forEach(d => {
      dev.set(d.id, d);
      if (d.roomId) push(devByRoom, d.roomId, d);
      push(devByLine, d.lineId, d);
      d.objs.forEach(o => {
        obj.set(o.id, { dev: d, obj: o });
        o.gas.forEach((gid, i) => push(gaLinks, gid, { dev: d, obj: o, sending: i === 0 && !!o.flags.t }));
      });
    });

    idx = { nodes, parent, trail, roomList, ga, gaByRaw, lines, areaOfLine,
            dev, obj, gaLinks, devByRoom, devByLine };
    return idx;
  }

  /* ---------- Struktur-Utilities ---------- */
  function walk(node, fn, depth = 0) {
    fn(node, depth);
    (node.children || []).forEach(c => walk(c, fn, depth + 1));
  }

  const findNode = id => index().nodes.get(id) || null;
  const parentOf = id => index().nodes.get(index().parent.get(id)) || null;

  function nodePath(id) {
    const ix = index();
    const node = ix.nodes.get(id);
    if (!node) return null;
    const names = (ix.trail.get(id) || []).concat(node.name);
    return { node, names, trail: names.join(' › '), sub: names.slice(1).join(' › ') };
  }

  /* Alle geräteaufnehmenden Bereiche mit Pfad — für Zuordnungen und Filter. */
  function rooms() {
    const ix = index();
    return ix.roomList.map(n => ({
      node: n,
      trail: (ix.trail.get(n.id) || []).slice(1).concat(n.name).join(' › ')
    }));
  }

  /* IDs aller geräteaufnehmenden Bereiche unter `id` (inklusive). */
  function roomIdsUnder(id) {
    const node = findNode(id);
    if (!node) return [];
    const out = [];
    walk(node, n => { if (DEVICE_HOSTS.has(n.kind)) out.push(n.id); });
    return out;
  }

  /* ---------- Topologie / Geräte / Objekte ---------- */
  const lineById = id => index().lines.get(id) || null;
  const areaOfLine = id => index().areaOfLine.get(id) || null;
  const deviceById = id => index().dev.get(id) || null;
  const objById = id => index().obj.get(id) || null;
  const devicesInRoom = id => index().devByRoom.get(id) || [];
  const devicesOnLine = id => index().devByLine.get(id) || [];

  /* Alle Kommunikationsobjekte, die auf einer GA liegen. */
  const gaLinks = gaId => index().gaLinks.get(gaId) || [];

  /* Räume, in denen eine GA wirkt — ergibt sich aus den Geräten, nicht aus
     einer eigenen Zuordnung (ETS-Semantik).                                */
  function gaRooms(gaId) {
    const seen = new Set(), out = [];
    gaLinks(gaId).forEach(l => {
      if (l.dev.roomId && !seen.has(l.dev.roomId)) {
        seen.add(l.dev.roomId);
        const n = findNode(l.dev.roomId);
        if (n) out.push(n);
      }
    });
    return out;
  }

  function lineLabel(lineId) {
    const l = lineById(lineId), a = areaOfLine(lineId);
    if (!l || !a) return '—';
    return `${a.addr}.${l.addr}  ${l.name}`;
  }

  /* ---------- Koppler und Filtertabelle ---------- *
   * Teilnehmer 0 einer Linie ist der Koppler. Sitzt er auf der Hauptlinie
   * (Linie 0), koppelt er den ganzen Bereich, sonst nur seine Linie.       */
  function couplerScope(dev) {
    if (!hasPa(dev) || paSplit(dev.addr)[2] !== 0) return null;
    const line = lineById(dev.lineId), area = areaOfLine(dev.lineId);
    if (!line || !area) return null;
    return line.addr === 0
      ? { kind: 'area', area, line: null, de: 'Bereichskoppler',
          label: `Bereich ${area.addr}` }
      : { kind: 'line', area, line, de: 'Linienkoppler',
          label: `Linie ${area.addr}.${line.addr}` };
  }

  /* Linien-Ids, die hinter dem Koppler liegen. */
  function couplerInside(dev, scope) {
    const inside = new Set();
    if (!scope) return inside;
    if (scope.kind === 'line') inside.add(dev.lineId);
    else scope.area.lines.forEach(l => inside.add(l.id));
    return inside;
  }

  /* Die Filtertabelle enthält genau die Gruppenadressen, deren Teilnehmer auf
     beiden Seiten des Kopplers sitzen — alles andere bleibt im Segment.
     Die ETS berechnet sie beim Programmieren aus derselben Information.     */
  function filterTable(dev) {
    const scope = couplerScope(dev);
    if (!scope) return null;
    const inside = couplerInside(dev, scope);
    const pass = [], local = [];
    project.groups.forEach(g => {
      let hasIn = false, hasOut = false;
      gaLinks(g.id).forEach(l => {
        if (l.dev.id === dev.id) return;         // der Koppler selbst zählt nicht
        if (inside.has(l.dev.lineId)) hasIn = true; else hasOut = true;
      });
      if (hasIn && hasOut) pass.push(g);
      else if (hasIn) local.push(g);
    });
    pass.sort((a, b) => a.raw - b.raw);
    local.sort((a, b) => a.raw - b.raw);
    // Ältere Koppler führen nur Hauptgruppe 0–13 in der Tabelle
    const high = pass.filter(g => gaSplit(g.raw, GA_STYLES.three)[0] >= 14).length;
    return { scope, inside, pass, local, high };
  }

  /* ---------- Tunneladressen ---------- *
   * Ein KNXnet/IP-Gerät braucht je Tunnelverbindung eine eigene physikalische
   * Adresse auf seiner Linie (PID_ADDITIONAL_INDIVIDUAL_ADDRESSES, 03/08/03
   * 2.5.4). Wie viele, legt das Gerät fest — die Produktdatei nennt es als
   * AdditionalAddressesCount. Nur ohne Produktdatei gilt der eingetragene Wert. */
  function tunnelCount(dev) {
    const item = dev && dev.catalogId && catalogById(dev.catalogId);
    const n = item && item.prog && item.prog.dl && item.prog.dl.addAddr;
    if (n) return n;
    return dev && dev.ip ? Math.max(0, Math.min(8, parseInt(dev.ip.tunnels, 10) || 0)) : 0;
  }
  const tunnelCountFixed = dev => {
    const item = dev && dev.catalogId && catalogById(dev.catalogId);
    return !!(item && item.prog && item.prog.dl && item.prog.dl.addAddr);
  };
  const tunnelAddrs = dev =>
    (dev && dev.ip && Array.isArray(dev.ip.tunnelAddrs) ? dev.ip.tunnelAddrs : [])
      .filter(r => Number.isInteger(r) && r > 0 && r <= 0xFFFF);

  /* Alle belegten Adressen: Geräte und Tunnel, ohne das genannte Gerät selbst. */
  function usedPas(exceptDevId) {
    const used = new Set();
    project.devices.forEach(d => {
      if (d.id !== exceptDevId && hasPa(d)) used.add(d.addr);
      tunnelAddrs(d).forEach(r => used.add(r));
    });
    return used;
  }

  /* Hält die Tunneladressen eines Geräts vollständig: gültige bleiben stehen,
     fehlende kommen von oben aus der Linie (x.y.254 abwärts), damit sie sich
     nicht mit den Teilnehmern mischen. Liefert true, wenn sich etwas ändert. */
  function ensureTunnelAddrs(dev) {
    const n = tunnelCount(dev);
    const l = lineById(dev.lineId), a = areaOfLine(dev.lineId);
    if (!l || !a || (!n && !tunnelAddrs(dev).length)) return false;
    const others = new Set();
    project.devices.forEach(d => {
      if (hasPa(d)) others.add(d.addr);
      if (d.id !== dev.id) tunnelAddrs(d).forEach(r => others.add(r));
    });
    const onLine = r => paSplit(r)[0] === a.addr && paSplit(r)[1] === l.addr && paSplit(r)[2] > 0;
    const keep = [];
    tunnelAddrs(dev).forEach(r => {
      if (keep.length < n && onLine(r) && !others.has(r) && !keep.includes(r)) keep.push(r);
    });
    for (let d = 254; keep.length < n && d > 0; d--) {
      const raw = paJoin(a.addr, l.addr, d);
      if (!others.has(raw) && !keep.includes(raw)) keep.push(raw);
    }
    keep.sort((x, y) => x - y);
    const before = tunnelAddrs(dev);
    if (before.length === keep.length && before.every((r, i) => r === keep[i])) return false;
    dev.ip = { ...ipConfig(dev), tunnelAddrs: keep };
    invalidate();
    return true;
  }

  /* Kleinste freie Teilnehmernummer auf einer Linie (0 bleibt dem Koppler). */
  function freePa(lineId, exceptDevId) {
    const l = lineById(lineId), a = areaOfLine(lineId);
    if (!l || !a) return 0;
    const used = usedPas(exceptDevId);
    for (let d = 1; d <= PA_MAX.device; d++) {
      const raw = paJoin(a.addr, l.addr, d);
      if (!used.has(raw)) return raw;
    }
    return paJoin(a.addr, l.addr, 0);
  }
  const paFree = (raw, exceptDevId) => !usedPas(exceptDevId).has(raw);

  function addDevice(d) {
    project.devices.push(d);
    invalidate();
    return d;
  }  function deleteDevice(id) {
    const i = project.devices.findIndex(d => d.id === id);
    if (i < 0) return false;
    project.devices.splice(i, 1);
    invalidate();
    return true;
  }
  function deleteLine(lineId) {
    const a = areaOfLine(lineId);
    if (!a) return false;
    // Geräte werden nicht mitgelöscht, sondern auf eine verbleibende Linie gehoben
    const rest = [];
    project.areas.forEach(x => x.lines.forEach(l => { if (l.id !== lineId) rest.push(l); }));
    if (!rest.length) return false;
    project.devices.forEach(d => { if (d.lineId === lineId) d.lineId = rest[0].id; });
    a.lines = a.lines.filter(l => l.id !== lineId);
    invalidate();
    return true;
  }
  function deleteArea(areaId) {
    if (project.areas.length < 2) return false;
    const a = project.areas.find(x => x.id === areaId);
    if (!a) return false;
    const ids = new Set(a.lines.map(l => l.id));
    const rest = project.areas.find(x => x.id !== areaId && x.lines.length);
    if (!rest) return false;
    project.devices.forEach(d => { if (ids.has(d.lineId)) d.lineId = rest.lines[0].id; });
    project.areas = project.areas.filter(x => x.id !== areaId);
    invalidate();
    return true;
  }

  /* ---------- Produktkatalog ---------- */
  const catalogById = id => project.catalog.find(c => c.id === id) || null;

  /* Wirksamer Parameterwert: eingestellt, sonst der Vorgabewert des Produkts. */
  function paramValue(item, values, ref) {
    if (values && Object.prototype.hasOwnProperty.call(values, ref)) return String(values[ref]);
    const p = item.params && item.params[ref];
    return p && p.d != null ? String(p.d) : '';
  }

  /* `test` kann mehrere zulässige Werte durch Leerzeichen getrennt nennen. */
  const testHits = (test, val) =>
    String(test).trim().split(/\s+/).some(x => x === val);

  /* Löst auf, welche Parameter und Objekte bei der gegebenen Parametrierung
     sichtbar sind — dieselbe Mechanik wie die Produktansicht der ETS.      */
  function resolveProduct(item, values) {
    const groups = [];
    const byPath = new Map();
    const objs = [];
    const seenObj = new Set();
    const seenParam = new Set();

    const group = path => {
      const label = path.map(s => String(s || '').trim())
        .filter(s => s && s !== 'Generic').join(' · ') || 'Allgemein';
      let g = byPath.get(label);
      if (!g) { g = { label, params: [] }; byPath.set(label, g); groups.push(g); }
      return g;
    };

    const walk = (nodes, path) => {
      for (const n of nodes || []) {
        if (n.c !== undefined) {
          const val = paramValue(item, values, n.c);
          let hit = null;
          for (const w of n.w || []) {
            if (w.t != null && w.t !== '' && testHits(w.t, val)) { hit = w; break; }
          }
          if (!hit) hit = (n.w || []).find(w => w.d);
          if (hit) walk(hit.k, path);
        } else if (n.p) {
          if (seenParam.has(n.p)) continue;
          seenParam.add(n.p);
          const p = item.params[n.p];
          if (p) group(path).params.push(n.p);
        } else if (n.o) {
          if (!seenObj.has(n.o) && item.objs[n.o]) { seenObj.add(n.o); objs.push(n.o); }
        } else if (n.b !== undefined) {
          walk(n.k, path.concat(n.b));
        } else if (n.k) {
          walk(n.k, path);
        }
      }
    };

    if (item.dyn && item.dyn.length) {
      walk(item.dyn, []);
    } else {
      // Ohne Sichtbarkeitsangaben alles zeigen, aber je Objektnummer nur einmal
      const byNum = new Set();
      Object.keys(item.objs || {}).forEach(k => {
        const n = item.objs[k].num;
        if (byNum.has(n)) return;
        byNum.add(n);
        objs.push(k);
      });
      Object.keys(item.params || {}).forEach(k => group([]).params.push(k));
    }

    objs.sort((a, b) => item.objs[a].num - item.objs[b].num);

    /* Kanalblöcke heißen intern CHANNEL_1000 … und teilen sich oft denselben
       Überschriftsparameter („A: Funktion“). Der Buchstabe wird deshalb aus
       der Position des Blocks abgeleitet, sonst hießen alle Kanäle gleich.  */
    const isHead = ref => {
      const p = item.params[ref];
      return p && (item.types[p.pt] || {}).k === 'none' && p.t && p.t.trim();
    };
    let ch = 0;
    groups.forEach(g => {
      if (!/CHANNEL[_ ]?\d+/i.test(g.label)) return;
      ch++;
      const head = g.params.find(isHead);
      const text = head ? item.params[head].t.trim() : '';
      const m = text.match(/^([A-Za-z]):\s*(.+)$/);
      g.label = m ? `${ch <= 26 ? String.fromCharCode(64 + ch) : ch}: ${m[2]}`
        : text ? `${text} ${ch}` : `Kanal ${ch}`;
    });
    return { groups: groups.filter(g => g.params.length), objs };
  }

  /* Kommunikationsobjekte eines Geräts aus Produkt und Parametrierung neu
     ableiten. Bestehende Adresszuordnungen bleiben über die Referenz-Id
     erhalten; wegfallende Objekte mit Adressen werden nicht verworfen,
     sondern als überzählig zurückgemeldet.                                 */
  function applyProduct(dev) {
    const item = dev.catalogId && catalogById(dev.catalogId);
    if (!item) return null;
    const { objs } = resolveProduct(item, dev.params);
    const byRef = new Map();
    dev.objs.forEach(o => { if (o.ref) byRef.set(o.ref, o); });

    const next = objs.map(ref => {
      const src = item.objs[ref];
      const old = byRef.get(ref);
      byRef.delete(ref);
      return {
        id: old ? old.id : nid('o'),
        ref,
        num: src.num,
        name: src.name || ('Objekt ' + src.num),
        dpt: dptById(src.dpt).id,
        flags: flagsFrom(src.f),
        gas: old ? old.gas : []
      };
    });

    // Nicht mehr sichtbare Objekte: nur die ohne Adressen verschwinden
    const orphans = [...byRef.values()].filter(o => o.gas.length);
    orphans.forEach(o => { o.stale = true; next.push(o); });
    dev.objs.filter(o => !o.ref).forEach(o => next.push(o));

    dev.objs = next;
    invalidate();
    return { added: objs.length, orphans };
  }

  const flagsFrom = s => ({
    c: String(s || '').includes('c'), r: String(s || '').includes('r'),
    w: String(s || '').includes('w'), t: String(s || '').includes('t'),
    u: String(s || '').includes('u')
  });

  /* Produkte aus einer Produktdatei aufnehmen; gleiche Bestellnummer und
     gleicher Name gelten als dasselbe Produkt und werden aufgefrischt.     */
  function addCatalogItems(items) {
    const key = c => (c.order || '') + '\u0000' + c.name;
    const known = new Map(project.catalog.map(c => [key(c), c]));
    const added = [];
    items.forEach(it => {
      const c = {
        id: nid('c'),
        name: String(it.name || 'Produkt'),
        order: String(it.order || ''),
        manufacturer: String(it.manufacturer || ''),
        appName: String(it.appName || ''),
        types: it.types || {},
        params: it.params || {},
        objs: it.objs || {},
        dyn: it.dyn || [],
        prog: (it.prog && typeof it.prog === 'object') ? it.prog : null,
        mask: String(it.mask || ''),
        ip: !!it.ip,
        medium: String(it.medium || ''),
        ma: +it.ma || 0,
        coupler: !!it.coupler,
        powerSupply: !!it.powerSupply,
        choke: !!it.choke,
        noAddress: !!it.noAddress,
        hwOnly: !!it.hwOnly
      };
      const old = known.get(key(c));
      if (old) {
        c.id = old.id;
        Object.assign(old, c);
      } else {
        project.catalog.push(c);
        known.set(key(c), c);
      }
      added.push(c);
    });
    invalidate();
    return added;
  }

  function deleteCatalogItem(id) {
    const i = project.catalog.findIndex(c => c.id === id);
    if (i < 0) return false;
    project.catalog.splice(i, 1);
    project.devices.forEach(d => { if (d.catalogId === id) d.catalogId = null; });
    invalidate();
    return true;
  }

  /* ---------- Gruppenadress-Baum ---------- *
   * Haupt- und Mittelgruppen sind in der ETS benannte Ordner. Der Baum wird
   * aus den vorhandenen Adressen plus den benannten (auch leeren) Gruppen
   * aufgebaut.                                                             */
  function gaTree() {
    const style = gaStyle();
    const depth = style.parts.length - 1;
    const root = { key: '', level: -1, name: project.name, children: [], groups: [] };
    const byKey = new Map([['', root]]);

    const ensure = keys => {
      let node = root, key = '';
      keys.forEach((v, i) => {
        key = key ? key + '/' + v : String(v);
        let n = byKey.get(key);
        if (!n) {
          n = { key, level: i, addr: v, name: project.gaNames[key] || '',
                label: style.parts[i].label, children: [], groups: [] };
          byKey.set(key, n);
          node.children.push(n);
        }
        node = n;
      });
      return node;
    };

    Object.keys(project.gaNames).forEach(k => {
      const keys = k.split('/').map(Number);
      if (keys.length <= depth && keys.every(Number.isInteger)) ensure(keys);
    });
    project.groups.slice().sort((a, b) => a.raw - b.raw).forEach(g => {
      ensure(gaSplit(g.raw, style).slice(0, depth)).groups.push(g);
    });

    const sortRec = n => {
      n.children.sort((a, b) => a.addr - b.addr);
      n.children.forEach(sortRec);
    };
    sortRec(root);
    return root;
  }

  /* ---------- Konsistenzprüfung ---------- *
   * Das, was ein Planungswerkzeug von einer Adressliste unterscheidet.     */
  function issues() {
    const ix = index();
    const out = [];
    const add = (level, kind, id, msg) => out.push({ level, kind, id, msg });

    project.groups.forEach(g => {
      const links = gaLinks(g.id);
      if (!links.length) {
        add('warn', 'ga', g.id, 'Kein Kommunikationsobjekt zugeordnet — die Adresse hat keine Funktion.');
        return;
      }
      const senders = links.filter(l => l.sending);
      if (!senders.length)
        add('warn', 'ga', g.id, 'Kein sendendes Objekt — auf diese Adresse sendet niemand.');
      // Mehrere Sender sind bei Bedienstellen gewollt, bei Rückmeldungen ein Konflikt
      if (senders.length > 1 && senders.every(l => l.obj.flags.r))
        add('error', 'ga', g.id, 'Mehrere rückmeldende Objekte senden auf diese Adresse: ' +
          senders.map(l => paStr(l.dev.addr) + ' ' + l.obj.name).join(', ') +
          ' — die Werte überschreiben sich gegenseitig.');
      else if (senders.length > 1)
        add('info', 'ga', g.id, senders.length + ' sendende Objekte — bei Bedienstellen in Ordnung, ' +
          'bei Status- oder Messwerten ein Konflikt.');
      const wrong = links.filter(l => l.obj.dpt !== g.dpt);
      if (wrong.length)
        add('error', 'ga', g.id, `Typkonflikt — Adresse ist ${g.dpt}, abweichend: ` +
          [...new Set(wrong.map(l => l.obj.dpt))].join(', '));
      if (links.some(l => !l.obj.flags.c))
        add('warn', 'ga', g.id, 'Ein zugeordnetes Objekt hat kein Kommunikations-Flag (K).');
    });

    const paSeen = new Map();
    const ipSeen = new Map();
    // Tunneladressen belegen Adressen wie Geräte
    project.devices.forEach(d => {
      const l = ix.lines.get(d.lineId), a = ix.areaOfLine.get(d.lineId);
      tunnelAddrs(d).forEach(r => {
        const [ta, tl] = paSplit(r);
        if (l && a && (ta !== a.addr || tl !== l.addr))
          add('error', 'device', d.id, `Tunneladresse ${paStr(r)} liegt nicht auf der Linie des Geräts.`);
        const other = project.devices.find(x => x.addr === r)
          || project.devices.find(x => x !== d && tunnelAddrs(x).includes(r));
        if (other) add('error', 'device', d.id,
          `Tunneladresse ${paStr(r)} ist doppelt vergeben (auch: ${other.name}).`);
      });
    });
    project.devices.forEach(d => {
      if (!d.roomId)
        add('warn', 'device', d.id, 'Keinem Raum zugeordnet — die Gebäudesicht bleibt unvollständig.');
      const cat = d.catalogId && catalogById(d.catalogId);
      if (hasPa(d)) {
        const dup = paSeen.get(d.addr);
        if (dup) add('error', 'device', d.id,
          `Physikalische Adresse ${paStr(d.addr)} ist doppelt vergeben (auch: ${dup.name}).`);
        else paSeen.set(d.addr, d);

        const l = ix.lines.get(d.lineId), a = ix.areaOfLine.get(d.lineId);
        const [pa, pl, pd] = paSplit(d.addr);
        if (l && a && (pa !== a.addr || pl !== l.addr))
          add('error', 'device', d.id,
            `Adresse ${paStr(d.addr)} passt nicht zur Linie ${a.addr}.${l.addr}.`);
        // Teilnehmer 0 gehört dem Koppler — bei Geräten mit Objekten ist das ein Fehlgriff
        if (pd === 0 && d.objs.length)
          add('warn', 'device', d.id, 'Teilnehmernummer 0 ist dem Linienkoppler vorbehalten.');
      } else if (d.objs.length || (cat && !cat.noAddress)) {
        add('error', 'device', d.id, 'Ohne physikalische Adresse lässt sich das Gerät weder adressieren noch programmieren.');
      }
      // Produkte ohne Objekte (Koppler, IP-Schnittstellen) sind kein Mangel
      if (!d.objs.length && !d.catalogId && !couplerScope(d))
        add('info', 'device', d.id, 'Keine Kommunikationsobjekte — bei Netzteilen und Kopplern normal.');

      if (cat && (cat.choke || cat.powerSupply) && !(+d.supply > 0))
        add('warn', 'device', d.id, (cat.choke ? 'Drossel' : 'Netzteil') +
          ' ohne eingetragene Einspeisung — der Nennstrom steht nicht in der Produktdatei.');

      if (deviceIsIp(d)) {
        const c = ipConfig(d);
        if (c.mode === 'manual') {
          ['addr', 'mask'].forEach(k => {
            if (!isIpV4(c[k]))
              add('error', 'device', d.id,
                `IP-Konfiguration: ${k === 'addr' ? 'Adresse' : 'Subnetzmaske'} fehlt oder ist ungültig.`);
          });
          if (c.gw && !isIpV4(c.gw))
            add('error', 'device', d.id, 'IP-Konfiguration: Standardgateway ist ungültig.');
        }
        if (c.mcast && !isIpV4(c.mcast))
          add('error', 'device', d.id, 'IP-Konfiguration: Multicast-Adresse ist ungültig.');
        const dup = c.mode === 'manual' && isIpV4(c.addr) && ipSeen.get(c.addr);
        if (dup)
          add('error', 'device', d.id, `IP-Adresse ${c.addr} ist doppelt vergeben (auch: ${dup.name}).`);
        else if (c.mode === 'manual' && isIpV4(c.addr)) ipSeen.set(c.addr, d);
      }
      d.objs.forEach(o => {
        if (o.flags.t && !o.gas.length)
          add('warn', 'device', d.id, `Objekt „${o.name}“ sendet, hat aber keine Adresse.`);
        if (o.stale)
          add('warn', 'device', d.id, `Objekt „${o.name}“ ist durch die Parametrierung nicht mehr ` +
            'vorgesehen, trägt aber noch Adressen.');
      });
    });

    project.areas.forEach(a => a.lines.forEach(l => {
      const devs = devicesOnLine(l.id);
      if (l.medium === 'tp' && devs.length > 64)
        add('warn', 'line', l.id,
          `${devs.length} Teilnehmer auf ${a.addr}.${l.addr} — ein TP-Segment trägt 64; Linienverstärker einplanen.`);

      /* Auf einer IP-Linie hat nur IP-fähige Technik etwas verloren. Der
         umgekehrte Fall ist normal: Ein IP-Router sitzt mit seiner
         physikalischen Adresse auf der TP-Seite.                          */
      if (l.medium === 'ip')
        devs.filter(d => !deviceCanIp(d)).forEach(d =>
          add('warn', 'device', d.id,
            `Sitzt auf dem IP-Strang ${a.addr}.${l.addr}, ist aber nicht als IP-Gerät hinterlegt.`));

      /* Busstrom: Einspeisung muss den Bedarf tragen. */
      const p = powerBudget(l.id);
      if (!p || !p.loads.length) return;
      if (!p.supplies.length) {
        add('warn', 'line', l.id,
          `Keine Spannungsversorgung auf ${a.addr}.${l.addr} eingeplant — ` +
          `${p.loads.length} Teilnehmer brauchen ${p.need} mA.`);
      } else if (p.need > p.have) {
        add('error', 'line', l.id,
          `Busstrom reicht nicht: ${p.need} mA Bedarf, ${p.have} mA eingespeist ` +
          `(${p.supplies.length === 1 ? 'ein Netzteil' : p.supplies.length + ' Netzteile'}).`);
      } else if (p.have - p.need < p.have * 0.1) {
        add('warn', 'line', l.id,
          `Busstrom knapp: ${p.need} von ${p.have} mA belegt — unter 10 % Reserve.`);
      }
    }));

    /* Adressen, die Liniengrenzen überschreiten, brauchen dort einen Koppler —
       sonst kommt das Telegramm nie an. Die Filtertabelle des Kopplers
       entsteht aus genau dieser Information. */
    const couplerOn = new Set();
    project.devices.forEach(d => { if (couplerScope(d)) couplerOn.add(d.lineId); });
    if (couplerOn.size) {
      project.groups.forEach(g => {
        const lines = new Set();
        gaLinks(g.id).forEach(l => {
          if (paSplit(l.dev.addr)[2] !== 0) lines.add(l.dev.lineId);
        });
        if (lines.size < 2) return;
        const gaps = [...lines].filter(id => {
          const l = ix.lines.get(id);
          return l && l.addr !== 0 && !couplerOn.has(id);
        });
        if (gaps.length)
          add('warn', 'ga', g.id, 'Wirkt über mehrere Linien, aber ' +
            gaps.map(id => lineLabel(id)).join(', ') +
            ' hat keinen Koppler — Telegramme überschreiten die Liniengrenze nicht.');
      });
    }

    return out;
  }

  /* ---------- GA-Utilities ---------- */
  const gaById = id => index().ga.get(id) || null;

  function freeAddress(raw, exceptId) {
    if (!gaValid(raw)) return false;
    const g = index().gaByRaw.get(raw);
    return !g || g.id === exceptId;
  }

  /* Nächste freie Adresse — bevorzugt innerhalb der Gruppe von `prefRaw`. */
  function suggestAddress(prefRaw) {
    const used = index().gaByRaw;
    const style = gaStyle();
    if (gaValid(prefRaw)) {
      const last = style.parts[style.parts.length - 1];
      const base = prefRaw & ~last.max;
      for (let i = 1; i <= last.max; i++) {
        const raw = (base | i) >>> 0;
        if (!used.has(raw)) return raw;
      }
    }
    for (let raw = 1; raw <= GA_MAX; raw++) if (!used.has(raw)) return raw;
    return 0;
  }

  function addGa(g) { project.groups.push(g); invalidate(); return g; }

  /* Haupt- oder Mittelgruppe samt allen Adressen darin löschen — wie in der ETS.
     Die Namen der Gruppe und ihrer Untergruppen verschwinden mit.            */
  const inGroup = (g, key, style = gaStyle()) => {
    const pre = String(key).split('/').map(Number);
    const v = gaSplit(g.raw, style);
    return pre.every((x, i) => v[i] === x);
  };
  function gasInGroup(key) {
    return project.groups.filter(g => inGroup(g, key));
  }
  function deleteGaGroup(key) {
    const ids = new Set(gasInGroup(key).map(g => g.id));
    project.groups = project.groups.filter(g => !ids.has(g.id));
    project.devices.forEach(d => d.objs.forEach(o => { o.gas = o.gas.filter(x => !ids.has(x)); }));
    Object.keys(project.gaNames).forEach(k => {
      if (k === key || k.startsWith(key + '/')) delete project.gaNames[k];
    });
    invalidate();
    return ids.size;
  }

  /* Adressen in eine andere Gruppe der untersten Ordnerebene verschieben
     (Mittelgruppe bei drei Stufen, Hauptgruppe bei zwei). Die Untergruppe
     bleibt, wenn sie dort frei ist, sonst gibt es die nächste freie. Die
     Zuordnungen hängen an der Id und bleiben erhalten.                    */
  function moveGas(ids, key) {
    const style = gaStyle();
    const depth = style.parts.length - 1;
    const pre = String(key).split('/').map(Number);
    if (depth < 1 || pre.length !== depth || pre.some((v, i) => !(v >= 0 && v <= style.parts[i].max)))
      return { moved: 0, same: 0, failed: ids.length };
    const moving = project.groups.filter(g => ids.includes(g.id)).sort((a, b) => a.raw - b.raw);
    const used = new Set(project.groups.filter(g => !ids.includes(g.id)).map(g => g.raw));
    const last = style.parts[depth].max;
    const out = { moved: 0, same: 0, failed: 0 };
    moving.forEach(g => {
      if (inGroup(g, key, style)) { used.add(g.raw); out.same++; return; }
      const want = gaSplit(g.raw, style)[depth];
      const free = n => { const raw = gaJoin([...pre, n], style); return raw > 0 && !used.has(raw) ? raw : 0; };
      let raw = free(want);
      for (let n = 1; !raw && n <= last; n++) raw = free(n);
      if (!raw) { out.failed++; used.add(g.raw); return; }
      g.raw = raw;
      used.add(raw);
      out.moved++;
    });
    invalidate();
    return out;
  }

  function deleteGa(id) {
    const i = project.groups.findIndex(g => g.id === id);
    if (i < 0) return false;
    project.groups.splice(i, 1);
    project.devices.forEach(d => d.objs.forEach(o => {
      o.gas = o.gas.filter(x => x !== id);
    }));
    invalidate();
    return true;
  }

  function deleteNode(id) {
    const node = findNode(id);
    if (!node || node.id === project.tree.id) return false;
    const ids = new Set(roomIdsUnder(id));
    // Geräte verlieren nur die Raumzuordnung — sie bleiben in der Topologie
    project.devices.forEach(d => { if (ids.has(d.roomId)) d.roomId = null; });
    const parent = parentOf(id);
    if (!parent) return false;
    parent.children = parent.children.filter(c => c.id !== id);
    invalidate();
    return true;
  }

  return {
    DPT, dptById, dptGroups,
    GA_STYLES, GA_MAX, gaStyle, gaSplit, gaJoin, gaStr, addrStr,
    PA_MAX, paJoin, paSplit, paStr, paFree, freePa, hasPa, byPa,
    NOTE_MAX, normNote, normSerial,
    NODE_KINDS, DEVICE_HOSTS, KO_FLAGS, MEDIA, kindDe, kindHolds, flagStr,
    IP_FIELDS, IP_DEFAULTS, isIpV4, deviceIsIp, deviceCanIp, ipConfig,
    tunnelCount, tunnelCountFixed, tunnelAddrs, ensureTunnelAddrs,
    project: () => project,
    setProject: p => { project = p; dirty = true; invalidate(); },
    newProject, seedProject, migrate, save, load,
    saveError: () => lastSaveError,
    migrationNotes: () => notes.slice(),
    markDirty: () => { dirty = true; invalidate(); },
    touch: invalidate,
    walk, findNode, parentOf, nodePath, rooms, roomIdsUnder,
    lineById, areaOfLine, lineLabel, deviceById, objById,
    devicesInRoom, devicesOnLine, gaLinks, gaRooms,
    couplerScope, filterTable, powerBudget, deviceMa,
    addDevice, deleteDevice, deleteLine, deleteArea,
    catalogById, addCatalogItems, deleteCatalogItem,
    resolveProduct, applyProduct, paramValue,
    gaTree, issues,
    gaById, addGa, deleteGa, gasInGroup, deleteGaGroup, moveGas, freeAddress, suggestAddress,
    deleteNode, uid: nid
  };
})();

