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

function objectName(el) {
  const text = attr(el, 'Text').trim();
  const fn = attr(el, 'FunctionText').trim();
  if (text && fn && text !== fn) return `${text} — ${fn}`;
  return text || fn || attr(el, 'Name').trim() || 'Objekt';
}

function readComObject(el, refText) {
  const dpt = toDpt(attr(el, 'DatapointType')) || dptFromSize(attr(el, 'ObjectSize'));
  return {
    num: parseInt(attr(el, 'Number'), 10) || 0,
    name: refText || objectName(el),
    dpt,
    flags: {
      c: flagOn(el, 'CommunicationFlag', true),
      r: flagOn(el, 'ReadFlag', false),
      w: flagOn(el, 'WriteFlag', false),
      t: flagOn(el, 'TransmitFlag', false),
      u: flagOn(el, 'UpdateFlag', false)
    }
  };
}

/* ---------- knxprod ---------- */

/* Sammelt Produkte über Katalog → Produkt → Hardware2Program → Programm.
   Fehlt der Katalog, wird direkt über die Hardware gegangen.              */
function collect(docs) {
  const apps = new Map();          // AppProgram-Id → { name, objs }
  const h2p = new Map();           // Hardware2Program-Id → AppProgram-Id
  const products = new Map();      // Product-Id → { text, order }
  const manufacturers = new Map(); // M-xxxx → Name

  docs.forEach(doc => {
    tags(doc, 'Manufacturer').forEach(m => {
      const id = attr(m, 'Id') || attr(m, 'RefId');
      const name = attr(m, 'Name');
      if (id && name) manufacturers.set(id, name);
    });

    tags(doc, 'ApplicationProgram').forEach(ap => {
      const id = attr(ap, 'Id');
      if (!id || apps.has(id)) return;
      // Texte aus den Refs überschreiben die der Tabelle, wenn dort etwas fehlt
      const refText = new Map();
      tags(ap, 'ComObjectRef').forEach(r => {
        const t = objectName(r);
        const ref = attr(r, 'RefId');
        if (ref && t && t !== 'Objekt' && !refText.has(ref)) refText.set(ref, t);
      });
      const objs = tags(ap, 'ComObject')
        .map(o => readComObject(o, refText.get(attr(o, 'Id'))))
        .sort((a, b) => a.num - b.num);
      apps.set(id, { id, name: attr(ap, 'Name'), objs });
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

  docs.forEach(doc => tags(doc, 'CatalogItem').forEach(ci => {
    const appId = h2p.get(attr(ci, 'Hardware2ProgramRefId'));
    const app = appId && apps.get(appId);
    if (!app) return;
    const prod = products.get(attr(ci, 'ProductRefId')) || {};
    const key = attr(ci, 'Id');
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      key,
      name: attr(ci, 'Name') || prod.text || app.name,
      order: attr(ci, 'OrderNumber') || prod.order || '',
      manufacturer: manuOf(key || appId),
      appName: app.name,
      objs: app.objs
    });
  }));

  // Ohne Katalogeinträge bleibt der Weg über die Programme selbst
  if (!out.length)
    apps.forEach(app => out.push({
      key: app.id, name: app.name, order: '',
      manufacturer: manuOf(app.id), appName: app.name, objs: app.objs
    }));

  return out.filter(p => p.objs.length)
            .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/* Liest eine .knxprod-Datei und liefert die enthaltenen Produkte. */
async function read(file) {
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

  const products = collect(docs);
  if (!products.length)
    throw new Error('Keine Produkte mit Kommunikationsobjekten gefunden.');
  return products;
}

return { read };
})();
