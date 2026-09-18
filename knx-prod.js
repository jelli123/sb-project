/* ============================================================
   KNX-Struktur — Produktdaten aus .knxprod
   ============================================================ *
 * Eine .knxprod-Datei ist ein ZIP mit den XML-Dateien der ETS-Produkt-
 * datenbank. Entpackt wird mit DecompressionStream statt einer Fremd-
 * bibliothek — das Projekt hat bewusst keine Abhängigkeiten und soll
 * offline funktionieren.                                                  */
'use strict';

const KNXProd = (() => {

/* Obergrenzen. Eine .knxprod kommt vom Hersteller oder aus dem Onlinekatalog —
   beides fremde Quellen. Die Größenangaben im Inhaltsverzeichnis macht die Datei
   über sich selbst und sind darum kein Schutz: geprüft wird zusätzlich, was beim
   Entpacken wirklich herauskommt.
   Gemessen an 21 echten Produktdateien (ABB, Bosch, Gira, Helios, Jung, MDT):
   höchstens 18 Einträge, 8 XML-Dateien, 8,6 MB im größten Eintrag, 23 MB
   entpackt, Namen bis 75 Zeichen. Die Grenzen lassen davon ein Mehrfaches zu. */
const MAX_FILE = 64 * 1024 * 1024;
const MAX_TOTAL = 256 * 1024 * 1024;
const MAX_ENTRIES = 2000;
const MAX_NAME = 512;
const MAX_XML_DOCS = 256;

/* ---------- ZIP ---------- */
const SIG_EOCD = 0x06054b50, SIG_CEN = 0x02014b50, SIG_LOC = 0x04034b50;

function findEocd(view) {
  // Das End-of-Central-Directory steht am Dateiende, dahinter höchstens ein Kommentar
  const min = Math.max(0, view.byteLength - 0xFFFF - 22);
  for (let i = view.byteLength - 22; i >= min; i--)
    if (view.getUint32(i, true) === SIG_EOCD) return i;
  return -1;
}

/* Liest das Inhaltsverzeichnis; die Nutzdaten bleiben vorerst komprimiert. */
function zipEntries(buf) {
  const view = new DataView(buf);
  const eocd = findEocd(view);
  if (eocd < 0) throw new Error('Keine ZIP-Struktur gefunden — ist das wirklich eine .knxprod-Datei?');

  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  if (view.getUint32(eocd + 12, true) === 0xFFFFFFFF || p === 0xFFFFFFFF)
    throw new Error('ZIP64-Archive werden nicht unterstützt.');
  if (count > MAX_ENTRIES)
    throw new Error(`Das Archiv nennt ${count} Einträge — mehr als ${MAX_ENTRIES}.`);

  const dec = new TextDecoder('utf-8');
  const out = [];
  let total = 0;
  for (let i = 0; i < count && p + 46 <= buf.byteLength; i++) {
    if (view.getUint32(p, true) !== SIG_CEN) break;
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const rawSize = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commLen = view.getUint16(p + 32, true);
    const localAt = view.getUint32(p + 42, true);
    // Alle Längen stammen aus der Datei — ohne diese Prüfung wirft die Sicht
    // darauf einen nackten RangeError statt einer lesbaren Meldung.
    if (nameLen > MAX_NAME) throw new Error('Ein Eintragsname im Archiv ist unerwartet lang.');
    if (p + 46 + nameLen > buf.byteLength) throw new Error('Das Inhaltsverzeichnis ist abgeschnitten.');
    const name = dec.decode(new Uint8Array(buf, p + 46, nameLen));

    if (flags & 0x01) throw new Error(`Eintrag „${name}“ ist verschlüsselt.`);
    if (rawSize > MAX_FILE) throw new Error(`Eintrag „${name}“ ist unerwartet groß.`);
    if (localAt + 30 > buf.byteLength) throw new Error(`Eintrag „${name}“ zeigt hinter das Dateiende.`);
    total += rawSize;
    if (total > MAX_TOTAL) throw new Error('Archivinhalt ist unerwartet groß.');

    out.push({ name, method, compSize, rawSize, localAt });
    p += 46 + nameLen + extraLen + commLen;
  }
  /* Die Schleife bricht bei einem kaputten Verzeichnis einfach ab. Ohne diese
     Prüfung sähe eine halb übertragene Datei wie eine leere aus und der Nutzer
     bekäme „enthält keine XML-Dateien“ statt eines Hinweises auf den Schaden. */
  if (out.length < count)
    throw new Error(`Das Archiv ist unvollständig — ${count} ${count === 1 ? 'Eintrag' : 'Einträge'} angekündigt, ${out.length} gefunden.`);
  return out;
}

/* Entpackt mit Obergrenze. Frueher las das hier den ganzen Strom über
   Response.arrayBuffer() ein — eine Deflate-Bombe konnte im Verzeichnis 1000
   Byte ankündigen und beim Entpacken Megabytes liefern. Jetzt wird stückweise
   gelesen und beim Überschreiten abgebrochen, bevor der Speicher volläuft. */
async function inflate(bytes, limit, name) {
  const reader = new Blob([bytes]).stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
    .getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new Error(`Eintrag „${name}“ entpackt sich auf mehr als ${limit} Byte.`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/**
 * Entpackt einen einzelnen Eintrag. `budget` zählt mit, wie viel über alle
 * Einträge zusammen schon herausgekommen ist — sonst ließe sich die Grenze je
 * Eintrag mit vielen kleinen Einträgen umgehen.
 */
async function zipRead(buf, e, budget) {
  const view = new DataView(buf);
  if (view.getUint32(e.localAt, true) !== SIG_LOC)
    throw new Error(`Beschädigter Eintrag „${e.name}“.`);
  const nameLen = view.getUint16(e.localAt + 26, true);
  const extraLen = view.getUint16(e.localAt + 28, true);
  const at = e.localAt + 30 + nameLen + extraLen;
  if (at + e.compSize > buf.byteLength)
    throw new Error(`Eintrag „${e.name}“ reicht über das Dateiende hinaus.`);

  const limit = Math.min(MAX_FILE, budget ? budget.left : MAX_FILE);
  let out;
  if (e.method === 0) out = new Uint8Array(buf, at, e.compSize);
  else if (e.method === 8) out = await inflate(new Uint8Array(buf, at, e.compSize), limit, e.name);
  else throw new Error(`Eintrag „${e.name}“ nutzt ein unbekanntes Kompressionsverfahren.`);

  if (out.length > limit) throw new Error(`Eintrag „${e.name}“ ist unerwartet groß.`);
  /* Ein heiles Archiv nennt im Inhaltsverzeichnis die richtige Größe. Weicht
     sie ab, ist die Datei beschädigt oder macht falsche Angaben. */
  if (out.length !== e.rawSize)
    throw new Error(`Eintrag „${e.name}“ ist anders groß als angekündigt.`);
  if (budget) budget.left -= out.length;
  return out;
}

/* ---------- XML-Hilfen ---------- *
 * Der Namensraum wechselt mit der ETS-Version, deshalb wird durchgängig
 * über den lokalen Namen gesucht.                                         */
const tags = (root, name) => [...root.getElementsByTagNameNS('*', name)];
const attr = (el, name) => (el && el.getAttribute(name)) || '';
const flagOn = (el, name, dflt) => {
  const v = attr(el, name);
  return v ? v === 'Enabled' : dflt;
};

/* "DPST-9-1" → "9.001", "DPT-1" → "1.001". Mehrere Angaben: die erste zählt. */
function toDpt(raw) {
  const first = String(raw || '').trim().split(/\s+/)[0];
  let m = first.match(/^DPST-(\d+)-(\d+)$/i);
  if (m) return m[1] + '.' + String(m[2]).padStart(3, '0');
  m = first.match(/^DPT-(\d+)$/i);
  if (m) return m[1] + '.001';
  m = first.match(/^(\d+)\.(\d+)$/);
  if (m) return m[1] + '.' + String(m[2]).padStart(3, '0');
  return '';
}

/* Fällt auf die Objektgröße zurück, wenn die Produktdatei keinen DPT nennt. */
function dptFromSize(size) {
  const s = String(size || '').toLowerCase();
  if (s.startsWith('1 bit')) return '1.001';
  if (s.startsWith('2 bit')) return '2.001';
  if (s.startsWith('4 bit')) return '3.007';
  if (s.startsWith('1 byte')) return '5.001';
  if (s.startsWith('2 byte')) return '9.001';
  if (s.startsWith('3 byte')) return '10.001';
  if (s.startsWith('4 byte')) return '14.056';
  if (s.startsWith('6 byte')) return '251.600';
  if (s.startsWith('8 byte')) return '19.001';
  if (s.startsWith('14 byte')) return '16.000';
  return '1.001';
}

/* Platzhalter der Hersteller: Objekte, deren Bedeutung erst die Parametrierung
   festlegt, heißen in der Tabelle „x“ oder „Dummy“. */
const PLACEHOLDER = /^(x+|-+|\.+|dummy|reserved|reserve|leer|empty)$/i;
const isPlaceholder = s => !s || PLACEHOLDER.test(String(s).trim());

function objectName(text, fn) {
  const t = isPlaceholder(text) ? '' : String(text).trim();
  const f = isPlaceholder(fn) ? '' : String(fn).trim();
  if (t && f && t !== f) return `${t} — ${f}`;
  return t || f || '';
}

/* ---------- Übersetzungen ---------- *
 * Die Texte im XML sind meist englisch; die Landessprachen stehen als
 * TranslationElement/RefId + AttributeName daneben. Die Sprachblöcke liegen
 * je nach Hersteller innerhalb oder neben dem Applikationsprogramm, deshalb
 * wird auf Dokumentebene gesammelt — die RefIds sind vollqualifiziert.    */
function buildTranslations(doc, prefer, strict) {
  const langs = new Map();
  tags(doc, 'Language').forEach(l => {
    const id = attr(l, 'Identifier');
    if (id && !langs.has(id)) langs.set(id, []);
    if (id) langs.get(id).push(l);
  });
  /* Streng heißt: nur die verlangte Sprache. Sonst käme beim Sammeln der
     zweiten Sprache wieder die erste heraus und beide Seiten wären gleich. */
  const pick = prefer.find(id => langs.has(id))
    || (strict ? null : [...langs.keys()].find(id => id.startsWith('de')))
    || null;
  const out = new Map();                       // "RefId|AttributeName" → Text
  if (!pick) return out;
  langs.get(pick).forEach(l => tags(l, 'TranslationElement').forEach(te => {
    const ref = attr(te, 'RefId');
    tags(te, 'Translation').forEach(t => {
      const a = attr(t, 'AttributeName');
      if (ref && a) out.set(ref + '|' + a, attr(t, 'Text'));
    });
  }));
  return out;
}

/* Sprachfamilien für die zweisprachige Ablage. Was in der Produktdatei fehlt,
   fällt weg — dann bleibt ein einfacher Text statt eines Paares. */
const LANG_DE = ['de-DE', 'de-AT', 'de-CH'];
const LANG_EN = ['en-US', 'en-GB', 'en-AU'];

/**
 * Baut aus zwei Fassungen einen Wert: sind beide da und verschieden, ein Paar
 * {de, en}; sonst der vorhandene Text. So wächst die Projektdatei nur dort,
 * wo die Sprachen sich wirklich unterscheiden.
 */
function pair(de, en) {
  const d = String(de == null ? '' : de).trim();
  const e = String(en == null ? '' : en).trim();
  if (d && e && d !== e) return { de: d, en: e };
  return d || e || '';
}

/** Der deutsche Text eines Paares — für Sortierung und Vergleiche. */
const plain = v => (v && typeof v === 'object') ? (v.de || v.en || '') : String(v || '');

/* ---------- Programmierdaten ---------- *
 * Was der Download braucht: Speicherlayout, Tabellen, die Lage jedes
 * Parameters und die Ladeprozeduren. Das Laden selbst übernimmt
 * knx-download.js zusammen mit dem lokalen Dienst.                         */

/* Die Ladeschritte, die der Download ausführen kann. Alles andere wird am
   Produkt vermerkt und sperrt den Download. */
const LDCTRL = new Set([
  'LdCtrlConnect', 'LdCtrlDisconnect', 'LdCtrlUnload', 'LdCtrlLoad', 'LdCtrlLoadCompleted',
  'LdCtrlAbsSegment', 'LdCtrlTaskSegment', 'LdCtrlTaskPtr', 'LdCtrlTaskCtrl1', 'LdCtrlTaskCtrl2',
  'LdCtrlMaxLength', 'LdCtrlWriteMem', 'LdCtrlLoadImageMem', 'LdCtrlWriteProp', 'LdCtrlLoadImageProp',
  'LdCtrlCompareProp', 'LdCtrlMerge', 'LdCtrlDelay', 'LdCtrlRestart', 'LdCtrlSetControlVariable',
  'LdCtrlClearLCFilterTable', 'LdCtrlClearCachedObjectTypes', 'LdCtrlDeclarePropDesc'
]);

const localName = el => el.localName || el.nodeName.split(':').pop();
const num = (el, name) => {
  const v = attr(el, name);
  if (!v) return 0;
  return /^0x/i.test(v) ? parseInt(v, 16) : parseInt(v, 10) || 0;
};

/* Größe eines Kommunikationsobjekts als Typ-Oktett der Objekttabelle
   (03/05/01, Group Object Table Realisation Type 1). */
const OBJECT_SIZE = {
  '1 bit': 0, '2 bit': 1, '3 bit': 2, '4 bit': 3, '5 bit': 4, '6 bit': 5, '7 bit': 6,
  '1 byte': 7, '2 bytes': 8, '3 bytes': 9, '4 bytes': 10, '6 bytes': 11, '8 bytes': 12,
  '10 bytes': 13, '14 bytes': 14
};
const sizeCode = s => {
  const k = String(s || '').trim().toLowerCase();
  return k in OBJECT_SIZE ? OBJECT_SIZE[k] : -1;
};
const PRIORITY = { Low: 'L', High: 'H', Alert: 'A' };

/* Ladeschritte werden wörtlich übernommen; Verzweigungen behalten ihre Kinder. */
function readSteps(el) {
  return [...el.children].map(c => {
    const a = {};
    [...c.attributes].forEach(x => { a[x.name] = x.value; });
    const step = { n: localName(c), a };
    if (c.children.length) step.k = readSteps(c);
    return step;
  });
}

/* Wo ein Parameter im Gerät landet: Speichersegment oder Property. Unions
   teilen sich einen Ort, jedes Mitglied liegt versetzt darin.              */
function paramLocation(p, cut) {
  const parent = p.parentElement;
  const inUnion = parent && localName(parent) === 'Union';
  const host = inUnion ? parent : p;
  const place = [...host.children].find(c => ['Memory', 'Property'].includes(localName(c)));
  if (!place) return null;
  const rel = inUnion ? num(p, 'Offset') * 8 + num(p, 'BitOffset') : 0;
  const at = num(place, 'Offset') * 8 + num(place, 'BitOffset') + rel;
  let where;
  if (localName(place) === 'Memory') {
    where = 's:' + cut(attr(place, 'CodeSegment'));
  } else {
    // Objektindex, wenn angegeben, sonst Objekttyp samt Vorkommen
    where = attr(place, 'ObjectIndex') !== ''
      ? `i:${num(place, 'ObjectIndex')}:${num(place, 'PropertyId')}`
      : `t:${num(place, 'ObjectType')}:${num(place, 'Occurrence')}:${num(place, 'PropertyId')}`;
  }
  const l = { w: where, o: at };
  if (inUnion) {
    l.u = 1;
    l.uk = where + '@' + (num(place, 'Offset') * 8 + num(place, 'BitOffset'));
    if (attr(p, 'DefaultUnionParameter') === 'true') l.du = 1;
  }
  return l;
}

function readProgramming(ap, cut) {
  /* Speichersegmente: absolute liegen an fester Adresse, relative im Ladebereich. */
  const segments = [];
  tags(ap, 'AbsoluteSegment').forEach(s => segments.push({
    k: 'abs', id: cut(attr(s, 'Id')),
    at: num(s, 'Address'), size: num(s, 'Size'),
    user: attr(s, 'UserMemory') === 'true'
  }));
  tags(ap, 'RelativeSegment').forEach(s => segments.push({
    k: 'rel', id: cut(attr(s, 'Id')),
    at: num(s, 'Offset'), size: num(s, 'Size')
  }));

  const table = name => {
    const t = tags(ap, name)[0];
    if (!t) return null;
    return {
      off: num(t, 'Offset'),
      max: num(t, 'MaxEntries'),
      seg: cut(attr(t, 'CodeSegment')) || ''
    };
  };

  /* Eigenschaften der Interface-Objekte — bei Kopplern und IP-Geräten steht
     hier, was nicht im Speicher, sondern über Properties geladen wird. */
  const properties = tags(ap, 'Property').map(p => ({
    ot: num(p, 'ObjectType'), oi: num(p, 'ObjectIndex'), pid: num(p, 'PropertyId'),
    name: attr(p, 'Name')
  })).filter(p => p.pid || p.ot);

  /* Ladeprozeduren: je Prozedur die Schrittfolge, damit sichtbar wird, ob sie
     mit den unterstützten Schritten auskommt. */
  const unsupported = new Set();
  const procedures = tags(ap, 'LoadProcedure').map(lp => {
    const steps = [...lp.getElementsByTagName('*')]
      .map(localName).filter(n => n.startsWith('LdCtrl'));
    steps.forEach(n => { if (!LDCTRL.has(n)) unsupported.add(n); });
    return {
      type: attr(lp, 'ProcedureType') || '',
      merge: attr(lp, 'MergeId') || '',
      count: steps.length,
      kinds: [...new Set(steps.map(n => n.slice(6)))]
    };
  });

  /* Herstellereigene Programme werden in der Produktdatei referenziert; ETS
     führt sie unter Windows aus. Hier werden sie nur vermerkt. */
  const plugin = tags(ap, 'Plugin').length > 0
    || [...ap.getElementsByTagName('*')].some(el =>
         [...el.attributes].some(a => /\.dll$/i.test(a.value)));

  /* Für den Download: Segmentinhalte, Ladeschritte und Optionen. */
  const segs = {};
  tags(ap, 'AbsoluteSegment').forEach(s => {
    const data = [...s.children].find(c => localName(c) === 'Data');
    const mask = [...s.children].find(c => localName(c) === 'Mask');
    segs[cut(attr(s, 'Id'))] = [num(s, 'Address'), num(s, 'Size'),
      data ? data.textContent.trim() : '', mask ? mask.textContent.trim() : ''];
  });
  const lp = tags(ap, 'LoadProcedure').map(el => ({
    m: attr(el, 'MergeId'), t: attr(el, 'ProcedureType'), s: attr(el, 'ProcedureSubType'),
    k: readSteps(el)
  }));
  const options = tags(ap, 'Options')[0];
  const manu = /^M-([0-9A-Fa-f]{4})/.exec(attr(ap, 'Id'));

  return {
    mask: attr(ap, 'MaskVersion'),
    appNumber: num(ap, 'ApplicationNumber'),
    appVersion: num(ap, 'ApplicationVersion'),
    style: attr(ap, 'LoadProcedureStyle') || '',
    pei: attr(ap, 'PeiType') || '',
    linkable: attr(ap, 'Linkable') === 'true',
    dynTable: attr(ap, 'DynamicTableManagement') === 'true',
    minEeprom: num(ap, 'MinEEPROMSize'),
    addrTab: table('AddressTable'),
    assocTab: table('AssociationTable'),
    comTab: table('ComObjectTable'),
    segments, properties, procedures,
    unsupported: [...unsupported],
    plugin,
    dl: {
      v: 1,
      manu: manu ? parseInt(manu[1], 16) : 0,
      addAddr: num(ap, 'AdditionalAddressesCount'),
      segs, lp,
      opt: {
        enc: attr(options, 'TextParameterEncoding') || 'iso-8859-1',
        zt: attr(options, 'TextParameterZeroTerminate') === 'true',
        lc912: attr(options, 'LineCoupler0912NewProgrammingStyle') === 'true'
      }
    }
  };
}

/* Die Maskendefinition aus knx_master.xml: Merkmale und die Standard-
   prozeduren, die bei DefaultProcedure und MergedProcedure gelten. Koppler
   091A kennen zwei Fassungen; LineCoupler0912NewProgrammingStyle wählt. */
function readMask(mv, opt) {
  if (!mv) return null;
  const hawks = [...mv.children].filter(c => localName(c) === 'HawkConfigurationData');
  // Die Fassungen sind nur per Kommentar benannt (LegacyVersion ist eine
  // Formatversion). Die neue erkennt man an den Einschubstellen der Applikation.
  const legacy = h => hawks.length > 1 && !tags(h, 'LdCtrlMerge').length;
  const hawk = hawks.find(h => (opt && opt.lc912) ? !legacy(h) : legacy(h))
    || hawks.find(h => !legacy(h)) || hawks[0];
  const feat = {};
  const procs = [];
  if (hawk) {
    tags(hawk, 'Feature').forEach(f => { feat[attr(f, 'Name')] = attr(f, 'Value'); });
    tags(hawk, 'Procedure').forEach(p => procs.push({
      t: attr(p, 'ProcedureType'), s: attr(p, 'ProcedureSubType'), k: readSteps(p)
    }));
  }
  return {
    v: num(mv, 'MaskVersion'),
    mm: attr(mv, 'ManagementModel'),
    compat: tags(mv, 'DownwardCompatibleMask').map(d => parseInt(attr(d, 'RefId').slice(3), 16)),
    feat, procs
  };
}

/* ---------- knxprod ---------- */

/* Liest ein Applikationsprogramm in ein kompaktes, speicherbares Modell.
   Ids werden um das Programmpräfix gekürzt — das spart rund die Hälfte.   */
function readApp(ap, lang, langs) {
  const appId = attr(ap, 'Id');
  const cut = s => String(s || '').startsWith(appId + '_') ? s.slice(appId.length + 1) : s;
  const tr = (el, name) => lang.get(attr(el, 'Id') + '|' + name) || attr(el, name);

  /* Parametertypen: Auswahlliste, Zahl, Text oder reine Überschrift.
     `n` ist die Breite im Gerät in Bit, `e` die Kodierung beim Download. */
  const types = {};
  tags(ap, 'ParameterType').forEach(pt => {
    const id = cut(attr(pt, 'Id'));
    let e = { k: 'text' };
    for (const k of pt.children) {
      const n = k.localName || k.nodeName.split(':').pop();
      const bits = num(k, 'SizeInBit');
      if (n === 'TypeNumber') {
        e = { k: 'num', min: +attr(k, 'minInclusive') || 0, max: +attr(k, 'maxInclusive') || 0,
              n: bits, e: attr(k, 'Type') === 'signedInt' ? 's' : 'u' };
      } else if (n === 'TypeRestriction') {
        const list = tags(k, 'Enumeration');
        e = { k: 'enum', v: list.map(x => [attr(x, 'Value'), tr(x, 'Text')]), n: bits, e: 'u' };
        if (attr(k, 'Base') === 'BinaryValue') {
          e.e = 'bin';
          e.b = {};
          list.forEach(x => { e.b[attr(x, 'Value')] = attr(x, 'BinaryValue'); });
        }
      } else if (n === 'TypeFloat') {
        const enc = attr(k, 'Encoding');
        e = { k: 'num', min: +attr(k, 'minInclusive') || 0, max: +attr(k, 'maxInclusive') || 0,
              n: enc === 'DPT 9' ? 16 : /Double/i.test(enc) ? 64 : 32,
              e: enc === 'DPT 9' ? 'f9' : /Double/i.test(enc) ? 'f64' : 'f32' };
      } else if (n === 'TypeText') {
        e = { k: 'text', max: bits / 8 || 0, n: bits, e: 'txt' };
      } else if (n === 'TypeIPAddress') {
        e = { k: 'ip', n: 32, e: 'ip' };
      } else if (n === 'TypeTime') {
        e = { k: 'time', n: bits, e: 'u' };
      } else if (n === 'TypeDate') {
        e = { k: 'date', n: 24, e: 'x' };
      } else if (n === 'TypeNone' || n === 'TypePicture') {
        e = { k: 'none', n: 0 };
      } else {
        e = { k: 'text', n: bits, e: 'x' };
      }
      break;
    }
    types[id] = e;
  });

  /* Parameterdefinitionen inklusive der in Unions verpackten. Die Lage im
     Gerät wird für alle Parameter gebraucht — auch für solche ohne Referenz,
     deren fester Wert trotzdem geschrieben werden muss.                    */
  const defs = {};
  const loc = {};
  tags(ap, 'Parameter').forEach(p => {
    const id = cut(attr(p, 'Id'));
    defs[id] = {
      t: tr(p, 'Text'),
      pt: cut(attr(p, 'ParameterType')),
      d: attr(p, 'Value'),
      ro: attr(p, 'Access') === 'Read' || attr(p, 'Access') === 'None'
    };
    const l = paramLocation(p, cut);
    if (l) loc[id] = { ...l, t: defs[id].pt, d: defs[id].d };
  });
  const params = {};
  tags(ap, 'ParameterRef').forEach(pr => {
    const pid = cut(attr(pr, 'RefId'));
    const base = defs[pid];
    if (!base) return;
    const text = lang.get(attr(pr, 'Id') + '|Text') || attr(pr, 'Text') || base.t;
    // Access am Ref schlaegt den des Parameters
    const acc = attr(pr, 'Access');
    params[cut(attr(pr, 'Id'))] = {
      t: text, pt: base.pt, p: pid,
      d: attr(pr, 'Value') || base.d,
      ro: acc ? (acc === 'Read' || acc === 'None') : base.ro
    };
  });

  /* Kommunikationsobjekte: die Referenzen tragen die eigentliche Bedeutung,
     fehlende Angaben erben sie von der Objekttabelle.                      */
  const base = new Map();
  const flagsOf = (o, dflt) => ({
    c: flagOn(o, 'CommunicationFlag', dflt.c), r: flagOn(o, 'ReadFlag', dflt.r),
    w: flagOn(o, 'WriteFlag', dflt.w), t: flagOn(o, 'TransmitFlag', dflt.t),
    u: flagOn(o, 'UpdateFlag', dflt.u)
  });
  const flagStr = f => (f.c ? 'c' : '') + (f.r ? 'r' : '') + (f.w ? 'w' : '') +
    (f.t ? 't' : '') + (f.u ? 'u' : '');
  tags(ap, 'ComObject').forEach(o => base.set(attr(o, 'Id'), {
    num: parseInt(attr(o, 'Number'), 10) || 0,
    text: tr(o, 'Text'), fn: tr(o, 'FunctionText'),
    dpt: attr(o, 'DatapointType'), size: attr(o, 'ObjectSize'),
    prio: PRIORITY[attr(o, 'Priority')] || 'L',
    flags: flagsOf(o, { c: true, r: false, w: false, t: false, u: false })
  }));

  /* Die Objekttabelle im Gerät kennt nur Nummern. Für Objekte, die die
     Parametrierung ausblendet, gelten die Angaben der Objektdefinition. */
  const co = {};
  base.forEach(b => { co[b.num] = { f: flagStr(b.flags), z: sizeCode(b.size), pr: b.prio }; });

  const objs = {};
  const addObj = (id, el, b) => {
    const text = el ? (tr(el, 'Text') || b.text) : b.text;
    const fn = el ? (tr(el, 'FunctionText') || b.fn) : b.fn;
    const dptRaw = (el && attr(el, 'DatapointType')) || b.dpt;
    const size = (el && attr(el, 'ObjectSize')) || b.size;
    // Flags und Größe an der Referenz schlagen die der Objektdefinition
    const flags = el ? flagsOf(el, b.flags) : b.flags;
    objs[id] = {
      num: b.num,
      name: objectName(text, fn),
      dpt: toDpt(dptRaw) || dptFromSize(size),
      f: flagStr(flags),
      z: sizeCode(size),
      pr: (el && PRIORITY[attr(el, 'Priority')]) || b.prio
    };
  };
  const covered = new Set();
  tags(ap, 'ComObjectRef').forEach(r => {
    const b = base.get(attr(r, 'RefId'));
    if (!b) return;
    covered.add(attr(r, 'RefId'));
    addObj(cut(attr(r, 'Id')), r, b);
  });
  // Nur Objekte ohne jede Referenz kommen über ihre eigene Id dazu
  base.forEach((b, id) => { if (!covered.has(id)) addObj(cut(id), null, b); });

  /* Sichtbarkeitsbaum: Blöcke, Bedingungen, Parameter- und Objektverweise. */
  const node = el => {
    const n = el.localName || el.nodeName.split(':').pop();
    const kids = () => [...el.children].map(node).filter(Boolean);
    switch (n) {
      case 'choose': return { c: cut(attr(el, 'ParamRefId')), w: kids() };
      case 'when':   return { t: attr(el, 'test'), d: attr(el, 'default') === 'true', k: kids() };
      case 'ParameterRefRef': return { p: cut(attr(el, 'RefId')) };
      case 'ComObjectRefRef': return { o: cut(attr(el, 'RefId')) };
      case 'ParameterBlock':
      case 'ChannelIndependentBlock':
      case 'Channel': {
        // Manche Hersteller füllen Text mit Leerzeichen — dann greift der nächste Kandidat
        const pref = params[cut(attr(el, 'ParamRefId'))];
        const label = [lang.get(attr(el, 'Id') + '|Text'), attr(el, 'Text'),
                       pref && pref.t, attr(el, 'Name')]
          .map(s => String(s || '').trim()).find(Boolean) || '';
        return { b: label, k: kids() };
      }
      case 'Dynamic': return { k: kids() };
      default: {
        const k = kids();
        return k.length ? { k } : null;
      }
    }
  };
  const dynEl = tags(ap, 'Dynamic')[0];
  const dyn = dynEl ? (node(dynEl).k || []) : [];

  /* Objekttyp 11 ist das IP-Parameterobjekt — solche Geräte haben in der ETS
     ein eigenes Eigenschaftsfenster für Adresse, Maske und Multicast, das
     nicht in der Produktdatei steht.                                       */
  const ip = tags(ap, 'Property').some(p => attr(p, 'ObjectType') === '11');

  const prog = readProgramming(ap, cut);
  prog.dl.loc = loc;
  prog.dl.co = co;
  return { name: pair(langs.de.get(appId + '|Name'),
                      langs.en.get(appId + '|Name') || attr(ap, 'Name')),
           mask: attr(ap, 'MaskVersion'),
           types, params, objs, dyn, ip, prog };
}

/* Sammelt Produkte über Katalog → Produkt → Hardware2Program → Programm.
   Fehlt der Katalog, wird direkt über die Hardware gegangen.              */
function collect(docs, prefer) {
  const apps = new Map();          // AppProgram-Id → Modell
  const h2p = new Map();           // Hardware2Program-Id → AppProgram-Id
  const hwOf = new Map();          // Hardware2Program-Id → Hardware-Daten
  const products = new Map();      // Product-Id → { text, order, hw }
  const manufacturers = new Map(); // M-xxxx → Name
  const media = new Map();         // MaskVersion-Id → 'tp' | 'ip' | 'rf' | 'pl'
  const masks = new Map();         // MaskVersion-Id → Element aus knx_master.xml

  const MEDIUM = { 'MT-0': 'tp', 'MT-1': 'pl', 'MT-2': 'rf', 'MT-5': 'ip' };
  const docLangs = new Map();      // Dokument → { de, en } Übersetzungskarten

  docs.forEach(doc => {
    tags(doc, 'Manufacturer').forEach(m => {
      const id = attr(m, 'Id') || attr(m, 'RefId');
      const name = attr(m, 'Name');
      if (id && name) manufacturers.set(id, name);
    });
    // Die Masken-Tabelle der Stammdaten sagt, auf welchem Medium ein Gerät läuft
    tags(doc, 'MaskVersion').forEach(mv => {
      const id = attr(mv, 'Id'), mt = attr(mv, 'MediumTypeRefId');
      if (id && MEDIUM[mt]) media.set(id, MEDIUM[mt]);
      if (id && !masks.has(id)) masks.set(id, mv);
    });

    const lang = buildTranslations(doc, prefer);
    // Zusätzlich beide Sprachen einzeln, für die Namen im Katalog
    const langs = {
      de: buildTranslations(doc, LANG_DE, true),
      en: buildTranslations(doc, LANG_EN, true)
    };
    docLangs.set(doc, langs);
    tags(doc, 'ApplicationProgram').forEach(ap => {
      const id = attr(ap, 'Id');
      if (!id || apps.has(id)) return;
      apps.set(id, readApp(ap, lang, langs));
    });

    /* Die Hardware trägt Busstrom und Kopplerfähigkeit. */
    tags(doc, 'Hardware').forEach(hw => {
      if (!attr(hw, 'SerialNumber') && !attr(hw, 'Name')) return;
      const info = {
        ma: parseInt(attr(hw, 'BusCurrent'), 10) || 0,
        coupler: attr(hw, 'IsCoupler') === 'true',
        ipEnabled: attr(hw, 'IsIPEnabled') === 'true',
        powerSupply: attr(hw, 'IsPowerSupply') === 'true',
        choke: attr(hw, 'IsChoke') === 'true',
        noAddress: attr(hw, 'HasIndividualAddress') === 'false',
        noApp: attr(hw, 'HasApplicationProgram') === 'false'
      };
      tags(hw, 'Product').forEach(pr => {
        const id = attr(pr, 'Id');
        if (!id) return;
        const lg = docLangs.get(doc);
        products.set(id, {
          text: pair(lg.de.get(id + '|Text'), lg.en.get(id + '|Text') || attr(pr, 'Text')),
          order: attr(pr, 'OrderNumber'), hw: info
        });
      });
      tags(hw, 'Hardware2Program').forEach(h => {
        if (attr(h, 'Id')) hwOf.set(attr(h, 'Id'), info);
      });
    });

    tags(doc, 'Hardware2Program').forEach(h => {
      const ref = tags(h, 'ApplicationProgramRef')[0];
      const appId = attr(ref, 'RefId');
      if (attr(h, 'Id') && appId) h2p.set(attr(h, 'Id'), appId);
    });

    tags(doc, 'Product').forEach(pr => {
      const id = attr(pr, 'Id');
      if (id && !products.has(id)) {
        const lg = docLangs.get(doc);
        products.set(id, {
          text: pair(lg.de.get(id + '|Text'), lg.en.get(id + '|Text') || attr(pr, 'Text')),
          order: attr(pr, 'OrderNumber'), hw: null
        });
      }
    });
  });

  // Die Stammdaten können im Archiv vor oder nach den Programmen stehen
  apps.forEach(app => {
    const mk = readMask(masks.get(app.mask), app.prog.dl.opt);
    if (mk) {
      // Geräte, deren Maske die der Applikation als abwärtskompatibel nennt, dürfen sie auch laden
      mk.hosts = [mk.v];
      masks.forEach(mv => {
        if (tags(mv, 'DownwardCompatibleMask').some(d => attr(d, 'RefId') === app.mask))
          mk.hosts.push(num(mv, 'MaskVersion'));
      });
    }
    app.prog.dl.mk = mk;
  });

  const out = [];
  const seen = new Set();
  const manuOf = id => {
    const m = String(id).match(/^(M-[0-9A-Fa-f]+)/);
    return m ? (manufacturers.get(m[1]) || m[1]) : '';
  };
  const entry = (key, name, order, app, hw) => ({
    key, name, order, manufacturer: manuOf(key), appName: app.name,
    types: app.types, params: app.params, objs: app.objs, dyn: app.dyn,
    prog: app.prog,
    mask: app.mask,
    medium: media.get(app.mask) || '',
    ma: (hw && hw.ma) || 0,
    coupler: !!(hw && hw.coupler),
    ip: app.ip || !!(hw && hw.ipEnabled),
    powerSupply: !!(hw && hw.powerSupply),
    choke: !!(hw && hw.choke),
    noAddress: !!(hw && hw.noAddress),
    hwOnly: app === NO_APP,
    objCount: Object.keys(app.objs).length,
    paramCount: Object.keys(app.params).length
  });

  /* Drosseln, Netzteile und passives Zubehör haben keine Applikation, gehören
     aber für Busstrom und Topologie trotzdem in den Katalog. */
  const NO_APP = { name: '', types: {}, params: {}, objs: {}, dyn: [], prog: null, mask: '', ip: false };

  docs.forEach(doc => tags(doc, 'CatalogItem').forEach(ci => {
    const h2pId = attr(ci, 'Hardware2ProgramRefId');
    const appId = h2p.get(h2pId);
    const prod = products.get(attr(ci, 'ProductRefId')) || {};
    const hw = hwOf.get(h2pId) || prod.hw;
    const app = (appId && apps.get(appId)) || (!appId && hw && hw.noApp ? NO_APP : null);
    if (!app) return;
    const key = attr(ci, 'Id');
    if (seen.has(key)) return;
    seen.add(key);
    const lg = docLangs.get(doc);
    /* Manche Hersteller (etwa MDT) übersetzen nur den Produkttext, nicht den
       Katalognamen. Die deutsche Seite kommt dann vom Produkt — derselbe Text,
       den auch der Online-Katalog zeigt. */
    const ciDe = lg.de.get(key + '|Name')
      || (prod.text && typeof prod.text === 'object' ? prod.text.de : '');
    const ciName = pair(ciDe, lg.en.get(key + '|Name') || attr(ci, 'Name'));
    out.push(entry(key, plain(ciName) ? ciName : (plain(prod.text) ? prod.text : app.name),
      attr(ci, 'OrderNumber') || prod.order || '', app, hwOf.get(h2pId) || prod.hw));
  }));

  // Ohne Katalogeinträge bleibt der Weg über die Programme selbst
  if (!out.length)
    apps.forEach((app, id) => out.push(entry(id, app.name, '', app, null)));

  // Koppler und IP-Schnittstellen haben oft keine Objekte, aber Einstellungen
  return out.filter(p => p.objCount || p.paramCount || p.hwOnly)
            .sort((a, b) => plain(a.name).localeCompare(plain(b.name), 'de'));
}

/* Herstellereigene Programme im Archiv. ETS ruft sie beim Parametrieren und
   Laden auf; sie sind Windows-Binärdateien und laufen hier ohnehin nicht.
   Sie werden gemeldet und übergangen, die XML-Produktdaten bleiben nutzbar. */
const BINARY = /\.(dll|exe|ocx|msi|so|dylib|jar|pyd|bin|com|bat|cmd|ps1)$/i;

/* Liest eine .knxprod-Datei und liefert die enthaltenen Produkte samt
   Fundstellen der übergangenen Dateien. */
async function read(file, prefer) {
  if (typeof DecompressionStream === 'undefined')
    throw new Error('Dieser Browser kann ZIP-Inhalte nicht entpacken.');

  const buf = await file.arrayBuffer();
  const all = zipEntries(buf);
  const entries = all.filter(e => /\.xml$/i.test(e.name));
  if (entries.length > MAX_XML_DOCS)
    throw new Error(`Das Archiv enthält ${entries.length} XML-Dateien — mehr als ${MAX_XML_DOCS}.`);
  const binaries = all.filter(e => BINARY.test(e.name))
    .map(e => ({ name: e.name, bytes: e.rawSize }));
  const extras = all.filter(e => !/\.xml$/i.test(e.name) && !BINARY.test(e.name) && e.rawSize > 0)
    .map(e => ({ name: e.name, bytes: e.rawSize }));
  if (!entries.length) throw new Error('Das Archiv enthält keine XML-Dateien.');

  const parser = new DOMParser();
  const dec = new TextDecoder('utf-8');
  const docs = [];
  /* Gemeinsames Restbudget: die Grenze je Eintrag allein liesse sich mit
     vielen kleinen Einträgen umgehen. */
  const budget = { left: MAX_TOTAL };
  for (const e of entries) {
    const doc = parser.parseFromString(dec.decode(await zipRead(buf, e, budget)), 'application/xml');
    if (!doc.getElementsByTagName('parsererror').length) docs.push(doc);
  }
  if (!docs.length) throw new Error('Keine lesbaren XML-Daten gefunden.');

  const products = collect(docs, prefer || ['de-DE', 'de-AT', 'de-CH', 'en-US', 'en-GB']);
  if (!products.length)
    throw new Error('Keine Produkte gefunden.');
  return { products, binaries, extras };
}

return { read, BINARY };
})();
