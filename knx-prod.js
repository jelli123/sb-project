/* ============================================================
   KNX-Struktur — Produktdaten aus .knxprod
   ============================================================ *
 * Eine .knxprod-Datei ist ein ZIP mit den XML-Dateien der ETS-Produkt-
 * datenbank. Entpackt wird mit DecompressionStream statt einer Fremd-
 * bibliothek — das Projekt hat bewusst keine Abhängigkeiten und soll
 * offline funktionieren.                                                  */
'use strict';

const KNXProd = (() => {

const MAX_FILE = 64 * 1024 * 1024;      // Schutz gegen aufgeblähte Archive
const MAX_TOTAL = 256 * 1024 * 1024;

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
    const name = dec.decode(new Uint8Array(buf, p + 46, nameLen));

    if (flags & 0x01) throw new Error(`Eintrag „${name}“ ist verschlüsselt.`);
    if (rawSize > MAX_FILE) throw new Error(`Eintrag „${name}“ ist unerwartet groß.`);
    total += rawSize;
    if (total > MAX_TOTAL) throw new Error('Archivinhalt ist unerwartet groß.');

    out.push({ name, method, compSize, rawSize, localAt });
    p += 46 + nameLen + extraLen + commLen;
  }
  return out;
}

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* Entpackt einen einzelnen Eintrag. */
async function zipRead(buf, e) {
  const view = new DataView(buf);
  if (view.getUint32(e.localAt, true) !== SIG_LOC)
    throw new Error(`Beschädigter Eintrag „${e.name}“.`);
  const nameLen = view.getUint16(e.localAt + 26, true);
  const extraLen = view.getUint16(e.localAt + 28, true);
  const at = e.localAt + 30 + nameLen + extraLen;
  const raw = new Uint8Array(buf, at, e.compSize);
  if (e.method === 0) return raw;
  if (e.method === 8) return inflate(raw);
  throw new Error(`Eintrag „${e.name}“ nutzt ein unbekanntes Kompressionsverfahren.`);
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
function buildTranslations(doc, prefer) {
  const langs = new Map();
  tags(doc, 'Language').forEach(l => {
    const id = attr(l, 'Identifier');
    if (id && !langs.has(id)) langs.set(id, []);
    if (id) langs.get(id).push(l);
  });
  const pick = prefer.find(id => langs.has(id))
    || [...langs.keys()].find(id => id.startsWith('de'))
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

/* ---------- knxprod ---------- */

/* Liest ein Applikationsprogramm in ein kompaktes, speicherbares Modell.
   Ids werden um das Programmpräfix gekürzt — das spart rund die Hälfte.   */
function readApp(ap, lang) {
  const appId = attr(ap, 'Id');
  const cut = s => String(s || '').startsWith(appId + '_') ? s.slice(appId.length + 1) : s;
  const tr = (el, name) => lang.get(attr(el, 'Id') + '|' + name) || attr(el, name);

  /* Parametertypen: Auswahlliste, Zahl, Text oder reine Überschrift. */
  const types = {};
  tags(ap, 'ParameterType').forEach(pt => {
    const id = cut(attr(pt, 'Id'));
    let e = { k: 'text' };
    for (const k of pt.children) {
      const n = k.localName || k.nodeName.split(':').pop();
      if (n === 'TypeNumber') {
        e = { k: 'num', min: +attr(k, 'minInclusive') || 0, max: +attr(k, 'maxInclusive') || 0 };
      } else if (n === 'TypeRestriction') {
        e = { k: 'enum', v: tags(k, 'Enumeration')
          .map(x => [attr(x, 'Value'), tr(x, 'Text')])
          .sort((a, b) => (+attr(pt, '_') || 0) - 0) };
      } else if (n === 'TypeFloat') {
        e = { k: 'num', min: +attr(k, 'minInclusive') || 0, max: +attr(k, 'maxInclusive') || 0 };
      } else if (n === 'TypeText') {
        e = { k: 'text', max: +attr(k, 'SizeInBit') / 8 || 0 };
      } else if (n === 'TypeIPAddress') {
        e = { k: 'ip' };
      } else if (n === 'TypeTime') {
        e = { k: 'time' };
      } else if (n === 'TypeDate') {
        e = { k: 'date' };
      } else if (n === 'TypeNone' || n === 'TypePicture') {
        e = { k: 'none' };
      }
      break;
    }
    types[id] = e;
  });

  /* Parameterdefinitionen inklusive der in Unions verpackten. */
  const defs = {};
  tags(ap, 'Parameter').forEach(p => {
    defs[cut(attr(p, 'Id'))] = {
      t: tr(p, 'Text'),
      pt: cut(attr(p, 'ParameterType')),
      d: attr(p, 'Value'),
      ro: attr(p, 'Access') === 'Read' || attr(p, 'Access') === 'None'
    };
  });
  const params = {};
  tags(ap, 'ParameterRef').forEach(pr => {
    const base = defs[cut(attr(pr, 'RefId'))];
    if (!base) return;
    const text = lang.get(attr(pr, 'Id') + '|Text') || attr(pr, 'Text') || base.t;
    // Access am Ref schlaegt den des Parameters
    const acc = attr(pr, 'Access');
    params[cut(attr(pr, 'Id'))] = {
      t: text, pt: base.pt,
      d: attr(pr, 'Value') || base.d,
      ro: acc ? (acc === 'Read' || acc === 'None') : base.ro
    };
  });

  /* Kommunikationsobjekte: die Referenzen tragen die eigentliche Bedeutung,
     fehlende Angaben erben sie von der Objekttabelle.                      */
  const base = new Map();
  tags(ap, 'ComObject').forEach(o => base.set(attr(o, 'Id'), {
    num: parseInt(attr(o, 'Number'), 10) || 0,
    text: tr(o, 'Text'), fn: tr(o, 'FunctionText'),
    dpt: attr(o, 'DatapointType'), size: attr(o, 'ObjectSize'),
    flags: {
      c: flagOn(o, 'CommunicationFlag', true), r: flagOn(o, 'ReadFlag', false),
      w: flagOn(o, 'WriteFlag', false), t: flagOn(o, 'TransmitFlag', false),
      u: flagOn(o, 'UpdateFlag', false)
    }
  }));

  const objs = {};
  const addObj = (id, el, b) => {
    const text = el ? (tr(el, 'Text') || b.text) : b.text;
    const fn = el ? (tr(el, 'FunctionText') || b.fn) : b.fn;
    const dptRaw = (el && attr(el, 'DatapointType')) || b.dpt;
    const flags = b.flags;
    objs[id] = {
      num: b.num,
      name: objectName(text, fn),
      dpt: toDpt(dptRaw) || dptFromSize(b.size),
      f: (flags.c ? 'c' : '') + (flags.r ? 'r' : '') + (flags.w ? 'w' : '') +
         (flags.t ? 't' : '') + (flags.u ? 'u' : '')
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

  return { name: lang.get(appId + '|Name') || attr(ap, 'Name'),
           types, params, objs, dyn, ip };
}

/* Sammelt Produkte über Katalog → Produkt → Hardware2Program → Programm.
   Fehlt der Katalog, wird direkt über die Hardware gegangen.              */
function collect(docs, prefer) {
  const apps = new Map();          // AppProgram-Id → Modell
  const h2p = new Map();           // Hardware2Program-Id → AppProgram-Id
  const products = new Map();      // Product-Id → { text, order }
  const manufacturers = new Map(); // M-xxxx → Name

  docs.forEach(doc => {
    tags(doc, 'Manufacturer').forEach(m => {
      const id = attr(m, 'Id') || attr(m, 'RefId');
      const name = attr(m, 'Name');
      if (id && name) manufacturers.set(id, name);
    });

    const lang = buildTranslations(doc, prefer);
    tags(doc, 'ApplicationProgram').forEach(ap => {
      const id = attr(ap, 'Id');
      if (!id || apps.has(id)) return;
      apps.set(id, readApp(ap, lang));
    });

    tags(doc, 'Hardware2Program').forEach(h => {
      const ref = tags(h, 'ApplicationProgramRef')[0];
      const appId = attr(ref, 'RefId');
      if (attr(h, 'Id') && appId) h2p.set(attr(h, 'Id'), appId);
    });

    tags(doc, 'Product').forEach(pr => {
      const id = attr(pr, 'Id');
      if (id) products.set(id, { text: attr(pr, 'Text'), order: attr(pr, 'OrderNumber') });
    });
  });

  const out = [];
  const seen = new Set();
  const manuOf = id => {
    const m = String(id).match(/^(M-[0-9A-Fa-f]+)/);
    return m ? (manufacturers.get(m[1]) || m[1]) : '';
  };
  const entry = (key, name, order, app) => ({
    key, name, order, manufacturer: manuOf(key), appName: app.name,
    types: app.types, params: app.params, objs: app.objs, dyn: app.dyn, ip: app.ip,
    objCount: Object.keys(app.objs).length,
    paramCount: Object.keys(app.params).length
  });

  docs.forEach(doc => tags(doc, 'CatalogItem').forEach(ci => {
    const appId = h2p.get(attr(ci, 'Hardware2ProgramRefId'));
    const app = appId && apps.get(appId);
    if (!app) return;
    const prod = products.get(attr(ci, 'ProductRefId')) || {};
    const key = attr(ci, 'Id');
    if (seen.has(key)) return;
    seen.add(key);
    out.push(entry(key, attr(ci, 'Name') || prod.text || app.name,
      attr(ci, 'OrderNumber') || prod.order || '', app));
  }));

  // Ohne Katalogeinträge bleibt der Weg über die Programme selbst
  if (!out.length)
    apps.forEach((app, id) => out.push(entry(id, app.name, '', app)));

  // Koppler und IP-Schnittstellen haben oft keine Objekte, aber Einstellungen
  return out.filter(p => p.objCount || p.paramCount)
            .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/* Liest eine .knxprod-Datei und liefert die enthaltenen Produkte. */
async function read(file, prefer) {
  if (typeof DecompressionStream === 'undefined')
    throw new Error('Dieser Browser kann ZIP-Inhalte nicht entpacken.');

  const buf = await file.arrayBuffer();
  const entries = zipEntries(buf).filter(e => /\.xml$/i.test(e.name));
  if (!entries.length) throw new Error('Das Archiv enthält keine XML-Dateien.');

  const parser = new DOMParser();
  const dec = new TextDecoder('utf-8');
  const docs = [];
  for (const e of entries) {
    const doc = parser.parseFromString(dec.decode(await zipRead(buf, e)), 'application/xml');
    if (!doc.getElementsByTagName('parsererror').length) docs.push(doc);
  }
  if (!docs.length) throw new Error('Keine lesbaren XML-Daten gefunden.');

  const products = collect(docs, prefer || ['de-DE', 'de-AT', 'de-CH', 'en-US', 'en-GB']);
  if (!products.length)
    throw new Error('Keine Produkte mit Objekten oder Parametern gefunden.');
  return products;
}

return { read };
})();
