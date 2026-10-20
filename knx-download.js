/* ============================================================
   KNX-Struktur — Applikationsdownload planen
   ============================================================ *
 * Rechnet aus Produktdaten, Parametrierung und Gruppenadressen, was in ein
 * Gerät geladen wird, und übersetzt die Ladeprozedur der Produktdatei in
 * eine Folge einfacher Busschritte. Ausgeführt wird der Plan vom lokalen
 * Dienst (Download.java); hier wird nichts gesendet.
 *
 * Grundlagen im KNX-Standard:
 *   03/05/01 Resources     — Tabellenformate, Load State Machine, Router Object
 *   03/05/02 Mgmt. Proc.   — DM_LoadStateMachineWrite (Speicher und Property)
 *   03/08/03 KNXnet/IP     — Parameterobjekt der IP-Geräte
 * Die Ladeprozeduren selbst stammen aus der Produktdatei bzw. knx_master.xml. */
'use strict';

const KNXDownload = (() => {

/* ---------- Bytes ---------- */

const hex = bytes => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
const fromHex = s => {
  const clean = String(s || '').replace(/[^0-9a-f]/gi, '');
  const out = new Uint8Array(clean.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
};
const fromB64 = s => {
  if (!s) return new Uint8Array(0);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const u16 = v => [(v >> 8) & 0xFF, v & 0xFF];
const num = v => {
  const s = String(v == null ? '' : v).trim();
  if (!s) return 0;
  return /^0x/i.test(s) ? parseInt(s, 16) : parseInt(s, 10) || 0;
};

/* Schreibt `bits` Bit von `value` (BigInt) ab Bitposition `pos` — gezählt ab
   dem höchstwertigen Bit des ersten Oktetts, wie BitOffset in der Produktdatei. */
function putBits(buf, pos, bits, value) {
  for (let i = 0; i < bits; i++) {
    const p = pos + i, at = p >> 3;
    if (at >= buf.length) return false;
    const mask = 0x80 >> (p & 7);
    if ((value >> BigInt(bits - 1 - i)) & 1n) buf[at] |= mask;
    else buf[at] &= ~mask;
  }
  return true;
}
const bytesToBig = bytes => [...bytes].reduce((v, b) => (v << 8n) | BigInt(b), 0n);

/* ---------- Parameterwerte kodieren ---------- */

/* KNX-Gleitkomma DPT 9: MEEEEMMM MMMMMMMM, Mantisse in Hundertsteln. */
function dpt9(value) {
  let m = Math.round(Number(value) * 100), e = 0;
  while ((m > 2047 || m < -2048) && e < 15) { m = Math.round(m / 2); e++; }
  return ((m < 0 ? 0x8000 : 0) | (e << 11) | (m & 0x7FF)) & 0xFFFF;
}

/* Liefert den Wert als BigInt in der Breite des Typs oder wirft mit Klartext. */
function encode(type, raw, opt) {
  const bits = type.n || 0;
  const text = String(raw == null ? '' : raw);
  switch (type.e) {
    case 'u': case undefined: {
      const v = Math.trunc(Number(text.replace(',', '.')) || 0);
      return BigInt(Math.max(0, v)) & ((1n << BigInt(bits)) - 1n);
    }
    case 's': {
      let v = BigInt(Math.trunc(Number(text.replace(',', '.')) || 0));
      if (v < 0n) v += 1n << BigInt(bits);
      return v & ((1n << BigInt(bits)) - 1n);
    }
    case 'f9':
      return BigInt(dpt9(text.replace(',', '.')));
    case 'f32': case 'f64': {
      const dv = new DataView(new ArrayBuffer(bits / 8));
      if (bits === 32) dv.setFloat32(0, Number(text.replace(',', '.')) || 0);
      else dv.setFloat64(0, Number(text.replace(',', '.')) || 0);
      return bytesToBig(new Uint8Array(dv.buffer));
    }
    case 'txt': {
      const size = bits >> 3;
      const out = new Uint8Array(size);
      // ISO 8859-1 wie in Options/TextParameterEncoding; alles darüber wird zu „?“
      const limit = opt && opt.zt ? size - 1 : size;
      for (let i = 0; i < Math.min(text.length, limit); i++) {
        const c = text.charCodeAt(i);
        out[i] = c < 256 ? c : 0x3F;
      }
      return bytesToBig(out);
    }
    case 'ip': {
      const parts = text.split('.').map(Number);
      if (parts.length !== 4 || parts.some(p => !(p >= 0 && p <= 255))) return 0n;
      return bytesToBig(parts);
    }
    case 'bin': {
      const b = type.b && type.b[text];
      if (b == null) throw new Error(`Wert „${text}“ fehlt in der Auswahlliste`);
      const bytes = fromB64(b), size = Math.ceil(bits / 8);
      const out = new Uint8Array(size);
      out.set(bytes.slice(0, size), size - Math.min(size, bytes.length));
      return bytesToBig(out) & ((1n << BigInt(bits)) - 1n);
    }
    default:
      throw new Error('Parametertyp wird beim Download nicht unterstützt');
  }
}

/* ---------- Abbilder ---------- */

/* Die Speichersegmente der Applikation, vorbelegt mit ihren Daten. `keep`
   markiert Oktette, die laut Maske nicht geschrieben werden dürfen. */
function segmentImages(dl) {
  const out = {};
  Object.entries(dl.segs || {}).forEach(([id, [addr, size, data, mask, lsm]]) => {
    const img = new Uint8Array(size);
    img.set(fromB64(data).slice(0, size));
    const m = mask ? fromB64(mask) : null;
    out[id] = { id, addr, size, img, mask: m, hasData: !!data };
    // Relatives Segment: `addr` ist der Versatz im Block der Load State Machine
    if (Number.isInteger(lsm) && lsm > 0) out[id].lsm = lsm;
  });
  return out;
}

/* Sichtbare Parameter-Referenzen bei der aktuellen Parametrierung. */
/* Sichtbare Referenzen und wirksame Werte. Wirksam heißt: eingestellt,
   überschrieben von den Zuweisungen (Assign) der aktiven Zweige — so lädt
   die ETS auch versteckte Parameter mit dem Wert, den die Produktdatei
   ihnen gibt, statt mit der Vorgabe. */
function resolveValues(item, values, resolve) {
  if (!resolve) return { visible: null, values };
  const r = resolve(item, values);
  const set = new Set();
  r.groups.forEach(g => g.params.forEach(ref => set.add(ref)));
  return { visible: set, values: r.values || values };
}

/* Wert eines Parameters: bevorzugt über eine sichtbare Referenz, sonst über
   irgendeine eingestellte Referenz, sonst die Vorgabe. */
function paramValue(item, values, pid, loc, visible, refIds) {
  const refs = (refIds || []).map(r => [r, item.params[r]]);
  const has = r => values && Object.prototype.hasOwnProperty.call(values, r);
  const vis = visible ? refs.filter(([r]) => visible.has(r)) : [];
  for (const [r, p] of vis) return has(r) ? values[r] : p.d;
  for (const [r] of refs) if (has(r)) return values[r];
  if (refs.length && refs[0][1].d != null && refs[0][1].d !== '') return refs[0][1].d;
  return loc.d;
}

/* Schreibt alle Parameter in Segment- und Property-Abbilder.
   Unions: nur das sichtbare Mitglied (sonst das Standardmitglied) wird
   geschrieben. Übrige Parameter werden alle geschrieben, sichtbare zuletzt —
   so gewinnt bei Überlappung der Wert, den die Oberfläche zeigt.           */
function writeParams(ctx) {
  const { item, dl, values, visible, segs, props, warn } = ctx;
  const refsOf = new Map();
  Object.entries(item.params || {}).forEach(([r, p]) => {
    if (!refsOf.has(p.p)) refsOf.set(p.p, []);
    refsOf.get(p.p).push(r);
  });
  const isVisible = pid => !visible || (refsOf.get(pid) || []).some(r => visible.has(r));

  const unions = new Map();
  const plain = [];
  Object.entries(dl.loc || {}).forEach(([pid, loc]) => {
    if (loc.u) {
      const key = loc.uk || (loc.w + '@union');
      if (!unions.has(key)) unions.set(key, []);
      unions.get(key).push([pid, loc]);
    } else {
      plain.push([pid, loc]);
    }
  });

  const chosen = [];
  plain.sort((a, b) => isVisible(a[0]) - isVisible(b[0])).forEach(e => chosen.push(e));
  unions.forEach(members => {
    const vis = members.filter(([pid]) => isVisible(pid));
    (vis.length ? vis : members.filter(([, l]) => l.du)).forEach(e => chosen.push(e));
  });

  let skipped = 0;
  chosen.forEach(([pid, loc]) => {
    const type = item.types[loc.t];
    if (!type || !type.n) return;
    let value;
    try {
      value = encode(type, paramValue(item, values, pid, loc, visible, refsOf.get(pid)), dl.opt);
    } catch (e) {
      skipped++;
      warn(`Parameter ${pid}: ${e.message} — nicht geschrieben.`);
      return;
    }
    if (loc.w.startsWith('s:')) {
      const seg = segs[loc.w.slice(2)];
      if (!seg || !putBits(seg.img, loc.o, type.n, value)) {
        skipped++;
        warn(`Parameter ${pid} liegt außerhalb seines Speichersegments.`);
      }
    } else {
      const need = Math.ceil((loc.o + type.n) / 8);
      let p = props.get(loc.w);
      if (!p) { p = new Uint8Array(need); props.set(loc.w, p); }
      if (p.length < need) {
        const grown = new Uint8Array(need);
        grown.set(p);
        p = grown;
        props.set(loc.w, p);
      }
      putBits(p, loc.o, type.n, value);
    }
  });
  return { written: chosen.length - skipped, skipped };
}

/* ---------- Gruppenadressen, Assoziationen, Objekttabelle ---------- */

const BCU1_MASKS = new Set([0x0010, 0x0011, 0x0012, 0x0013]);

function linkModel(project, dev, item, warn) {
  const gaRaw = new Map(project.groups.map(g => [g.id, g.raw]));
  const objs = [];
  const seenNum = new Set();
  dev.objs.forEach(o => {
    if (o.stale) {
      if (o.gas.length) warn(`Objekt „${o.name}“ ist durch die Parametrierung entfallen — seine Adressen werden nicht geladen.`);
      return;
    }
    if (seenNum.has(o.num)) return;
    seenNum.add(o.num);
    const gas = o.gas.map(id => gaRaw.get(id)).filter(r => Number.isInteger(r) && r > 0);
    objs.push({ num: o.num, gas, flags: o.flags, src: item.objs[o.ref] || null, name: o.name });
  });
  const addrs = [...new Set(objs.flatMap(o => o.gas))].sort((a, b) => a - b);
  return { objs, addrs };
}

/* Die erste Adresse eines Objekts ist seine sendende. */
const UNUSED = 0xFE;

/* BCU1 (03/05/01 4.17.3.4.1): Das Gerät sendet über die Assoziation, deren
   Nummer der Objektnummer entspricht. Die Tabelle hat mindestens so viele
   Plätze wie Objekte, unbenutzte tragen TSAP FEh. Weitere Paare folgen
   dahinter; reicht der Platz nicht, belegen sie einen freien Platz j hinter
   ihrem Objekt, sofern keine spätere sendende Assoziation dieselbe Adresse
   nutzt.
   Andere Masken: Kein Platzhalter — bei 255 Einträgen wäre FEh eine gültige
   Adressnummer. Die sendenden Paare stehen vorn, damit Geräte, die das erste
   Paar eines Objekts nehmen, die richtige Adresse finden. */
function associations(objs, addrs, objectCount, max, bcu1) {
  const tsap = raw => addrs.indexOf(raw) + 1;
  const sending = [], extra = [];
  objs.slice().sort((a, b) => a.num - b.num).forEach(o => {
    if (!o.gas.length) return;
    sending.push([tsap(o.gas[0]), o.num]);
    o.gas.slice(1).forEach(g => extra.push([tsap(g), o.num]));
  });
  extra.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (!bcu1) return sending.concat(extra);

  const slots = Math.max(objectCount, ...sending.map(e => e[1] + 1), 0);
  const base = [];
  for (let i = 0; i < slots; i++) base.push([UNUSED, i]);
  sending.forEach(e => { base[e[1]] = e; });
  const room = Math.max(0, (max || Infinity) - base.length);
  const rest = [];
  extra.forEach(([t, a], n) => {
    if (n < room) { rest.push([t, a]); return; }
    const j = base.findIndex((e, i) => e[0] === UNUSED && i > a
      && !base.some((x, k) => k > i && x[0] === t && x[1] === k));
    if (j >= 0) base[j] = [t, a];
    else rest.push([t, a]);
  });
  return base.concat(rest);
}

/* Konfigurationsoktett nach 03/05/01 4.18.3.1.2: Bit 6 Senden, 4 Schreiben,
   3 Lesen, 2 Kommunikation, 1–0 Priorität. Bit 7 ist bei BCU1 fest 1, bei
   BCU2 und BIM M112 die Aktualisierung. */
const PRIO_BITS = { L: 3, H: 1, A: 2 };
function patchObjectTable(ctx, tab, model, mask) {
  const seg = ctx.segs[tab.seg];
  if (!seg || !seg.hasData) return 0;
  const bcu1 = BCU1_MASKS.has(mask);
  const img = seg.img, off = tab.off;
  const count = img[off];
  const first = off + (bcu1 ? 2 : 3), step = bcu1 ? 3 : 4;
  let patched = 0;
  model.objs.forEach(o => {
    if (o.num >= count) {
      ctx.warn(`Objekt ${o.num} liegt hinter dem Ende der Objekttabelle (${count} Einträge).`);
      return;
    }
    const at = first + o.num * step + (bcu1 ? 1 : 2);
    if (at + 1 >= img.length) return;
    let cfg = img[at] & 0xA0;                       // Segmentwahl und Bit 7 behalten
    const f = o.flags || {};
    if (f.t) cfg |= 0x40;
    if (f.w) cfg |= 0x10;
    if (f.r) cfg |= 0x08;
    if (f.c) cfg |= 0x04;
    if (!bcu1) cfg = f.u ? (cfg | 0x80) : (cfg & 0x7F);
    const src = o.src || {};
    cfg |= PRIO_BITS[src.pr] != null ? PRIO_BITS[src.pr] : (img[at] & 0x03);
    img[at] = cfg;
    if (Number.isInteger(src.z) && src.z >= 0) img[at + 1] = src.z;
    patched++;
  });
  return patched;
}

/* ---------- System B: Tabellen im relativen Speicher ---------- *
 * Adress- und Objekttabelle nach Realisierungstyp 7, die Assoziationstabelle
 * nach Typ 6 (03/05/01 4.16.8, 4.17.5, 4.18.6): je 2 Oktette Länge, dann die
 * Einträge. Die Assoziationen stehen mit 2 Oktetten TSAP und 2 Oktetten ASAP
 * (Format 1), sendende vorn nach ASAP — so liest sie der Referenzstack, mit
 * dem die ETS System-B-Geräte lädt (thelsing/knx). Wo die Tabellen im Gerät
 * liegen, sagt es erst nach der Zuteilung über PID_TABLE_REFERENCE.        */
const be16 = v => [(v >> 8) & 0xFF, v & 0xFF];
const be32 = v => [(v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF];

/* Objektdeskriptor (Tabelle 87): Bit 15 Aktualisieren, 14 Übertragen, 13 Lesen
   bei Initialisierung, 12 Schreiben, 11 Lesen, 10 Kommunikation, 9–8 Priorität,
   7–0 Typcode der Wertgröße (Tabelle 88). */
function descriptorB(flags, ri, pr, z) {
  const f = flags || {};
  return ((f.u ? 1 : 0) << 15) | ((f.t ? 1 : 0) << 14) | ((ri ? 1 : 0) << 13) | ((f.w ? 1 : 0) << 12)
    | ((f.r ? 1 : 0) << 11) | ((f.c ? 1 : 0) << 10) | ((PRIO_BITS[pr] != null ? PRIO_BITS[pr] : 3) << 8) | (z & 0xFF);
}
const flagsFrom = f => ({ c: /c/.test(f || ''), r: /r/.test(f || ''), w: /w/.test(f || ''),
                          t: /t/.test(f || ''), u: /u/.test(f || '') });

function systemBTables(ctx, prog, model) {
  const { errors, warn } = ctx;
  const at = prog.addrTab, as = prog.assocTab;
  if (at && at.max && model.addrs.length > at.max)
    throw new Error(`${model.addrs.length} Gruppenadressen, das Gerät fasst ${at.max}.`);
  const addr = [...be16(model.addrs.length), ...model.addrs.flatMap(be16)];

  const assoc = associations(model.objs, model.addrs, 0, as && as.max, false);
  if (as && as.max && assoc.length > as.max)
    throw new Error(`${assoc.length} Zuordnungen, das Gerät fasst ${as.max}.`);
  const asc = [...be16(assoc.length), ...assoc.flatMap(([t, a]) => [...be16(t), ...be16(a)])];

  /* Die Objekttabelle umfasst alle Objekte der Applikation bis zur höchsten
     Nummer: sichtbare mit den Flags des Projekts, ausgeblendete mit denen ihrer
     Objektdefinition, Lücken mit 0. ASAP und Objektnummer zählen ab 1. */
  const co = (ctx.dl && ctx.dl.co) || {};
  const byNum = new Map(model.objs.map(o => [o.num, o]));
  const nums = Object.keys(co).map(Number).filter(n => Number.isInteger(n) && n >= 0)
    .concat(model.objs.map(o => o.num));
  const count = Math.max(0, ...nums);
  if (byNum.has(0) || Object.prototype.hasOwnProperty.call(co, '0'))
    warn('Die Applikation hat ein Objekt 0 — System B zählt Objekte ab 1, es bleibt außen vor.');
  const go = [...be16(count)];
  for (let n = 1; n <= count; n++) {
    const o = byNum.get(n);
    let d = 0;
    if (o) {
      const src = o.src || {};
      const z = Number.isInteger(src.z) && src.z >= 0 ? src.z : (co[n] ? co[n].z : -1);
      if (!(z >= 0)) errors.push(`Objekt ${n} „${o.name}“: Größe unbekannt — die Objekttabelle lässt sich nicht bilden.`);
      d = descriptorB(o.flags, src.ri || (co[n] && co[n].ri), src.pr || (co[n] && co[n].pr), z);
    } else if (co[n]) {
      const c = co[n];
      d = c.z >= 0 ? descriptorB(flagsFrom(c.f), c.ri, c.pr, c.z) : 0;
    }
    go.push(...be16(d));
  }
  // Nach Objekttyp: 1 Adresstabelle, 2 Assoziationstabelle, 9 Objekttabelle
  return {
    images: { 1: Uint8Array.from(addr), 2: Uint8Array.from(asc), 9: Uint8Array.from(go) },
    summary: { addrs: model.addrs.length, assocs: assoc.length, objects: count }
  };
}

function writeTables(ctx, prog, model, pa, mask) {
  const at = prog.addrTab, as = prog.assocTab, ct = prog.comTab;
  if (ctx.systemB) {
    const t = systemBTables(ctx, prog, model);
    ctx.rel = t.images;
    return t.summary;
  }
  if (!at && !as) return {};
  const out = { addrs: model.addrs.length, assocs: 0 };

  if (at) {
    const seg = ctx.segs[at.seg];
    if (!seg) throw new Error('Speichersegment der Adresstabelle fehlt in der Produktdatei.');
    if (at.max && model.addrs.length > at.max)
      throw new Error(`${model.addrs.length} Gruppenadressen, das Gerät fasst ${at.max}.`);
    const len = 3 + 2 * (at.max || model.addrs.length);
    seg.img.fill(0, at.off, Math.min(seg.size, at.off + len));
    seg.img[at.off] = model.addrs.length + 1;
    seg.img.set(u16(pa), at.off + 1);
    model.addrs.forEach((g, i) => seg.img.set(u16(g), at.off + 3 + 2 * i));
  }

  if (as) {
    const seg = ctx.segs[as.seg];
    if (!seg) throw new Error('Speichersegment der Assoziationstabelle fehlt in der Produktdatei.');
    const comSeg = ct && ctx.segs[ct.seg];
    const objectCount = comSeg && comSeg.hasData ? comSeg.img[ct.off] : 0;
    const final = associations(model.objs, model.addrs, objectCount, as.max, BCU1_MASKS.has(mask));
    const max = as.max || final.length;
    if (final.length > max)
      throw new Error(`${final.length} Zuordnungen, das Gerät fasst ${max}.`);
    const len = 1 + 2 * max;
    seg.img.fill(0, as.off, Math.min(seg.size, as.off + len));
    seg.img[as.off] = final.length;
    final.forEach(([t, a], i) => { seg.img[as.off + 1 + 2 * i] = t; seg.img[as.off + 2 + 2 * i] = a; });
    out.assocs = final.filter(e => e[0] !== UNUSED).length;
    out.objectCount = objectCount;
  }

  if (ct) out.objects = patchObjectTable(ctx, ct, model, mask);
  return out;
}

/* ---------- Koppler ---------- */

/* Filtertabelle Realisierungstyp 2/3: ein Bit je Gruppenadresse, Oktett =
   GA div 8, Bit = GA mod 8 ab dem niederwertigsten Bit (03/05/01 5.2.1, 5.3.1).
   Hinein kommen alle Adressen, die ein Teilnehmer hinter dem Koppler nutzt. */
function filterTable(project, dev, size) {
  const table = new Uint8Array(size);
  const area = project.areas.find(a => a.lines.some(l => l.id === dev.lineId));
  const line = area && area.lines.find(l => l.id === dev.lineId);
  if (!area || !line) return { table, count: 0 };
  const inside = new Set(line.addr === 0 ? area.lines.map(l => l.id) : [line.id]);
  const used = new Set();
  project.devices.forEach(d => {
    if (d.id === dev.id || !inside.has(d.lineId)) return;
    d.objs.forEach(o => { if (!o.stale) o.gas.forEach(g => used.add(g)); });
  });
  let count = 0;
  project.groups.forEach(g => {
    if (!used.has(g.id) || !(g.raw > 0)) return;
    const at = g.raw >> 3;
    if (at >= size) return;
    table[at] |= 1 << (g.raw & 7);
    count++;
  });
  return { table, count };
}

/* KNXnet/IP-Parameterobjekt (Objekttyp 11) nach 03/08/03. */
function ipSteps(ip, addAddr, errors) {
  const steps = [];
  const ipv4 = s => {
    const p = String(s || '').split('.').map(Number);
    return p.length === 4 && p.every(x => x >= 0 && x <= 255) ? p : null;
  };
  const prop = (pid, data, label, count = 1) =>
    steps.push({ op: 'writeProp', ot: 11, occ: 0, pid, start: 1, count, data: hex(data), verify: false, label });
  const manual = ip.mode === 'manual';
  prop(55, [manual ? 1 : 4], manual ? 'IP-Adresse fest' : 'IP-Adresse per DHCP');
  if (manual) {
    const a = ipv4(ip.addr), m = ipv4(ip.mask), g = ipv4(ip.gw) || [0, 0, 0, 0];
    if (a) prop(60, a, 'IP-Adresse ' + ip.addr);
    if (m) prop(61, m, 'Subnetzmaske ' + ip.mask);
    prop(62, g, 'Standardgateway ' + (ip.gw || '0.0.0.0'));
  }
  const mc = ipv4(ip.mcast);
  if (mc) prop(66, mc, 'Routing-Multicast ' + ip.mcast);
  const name = new Uint8Array(30);
  String(ip.name || '').slice(0, 29).split('').forEach((c, i) => {
    const code = c.charCodeAt(0);
    name[i] = code < 256 ? code : 0x3F;
  });
  prop(76, name, 'Gerätename „' + (ip.name || '') + '“', 30);
  // Tunneladressen: Element 0 ist die Länge, geschrieben werden die Einträge ab 1 (2.5.4)
  const tunnels = (ip.tunnelAddrs || []).filter(r => Number.isInteger(r) && r > 0);
  if (addAddr && tunnels.length !== addAddr) {
    errors.push(`Das Gerät braucht ${addAddr} Tunneladressen, im Projekt stehen ${tunnels.length}.`);
  } else if (tunnels.length) {
    prop(53, tunnels.flatMap(u16), 'Tunneladressen ' + tunnels.map(r =>
      [(r >> 12) & 15, (r >> 8) & 15, r & 255].join('.')).join(', '), tunnels.length);
  }
  return steps;
}

/* ---------- Ladeprozedur übersetzen ---------- */

function pickProcedure(prog, kind) {
  const dl = prog.dl, mk = dl.mk;
  const type = kind === 'unload' ? 'Unload' : 'Load';
  const sub = kind === 'unload' ? 'all' : (kind || 'all');
  if (prog.style === 'ProductProcedure') {
    const lp = dl.lp.filter(p => !p.m && (p.t || 'Load') === type);
    if (!lp.length && type === 'Unload' && mk) {
      const m = mk.procs.find(p => p.t === 'Unload');
      if (m) return { steps: m.k, merged: false };
    }
    return lp.length ? { steps: lp[0].k, merged: false } : null;
  }
  if (!mk) return null;
  const m = mk.procs.find(p => p.t === type && p.s === sub)
    || (sub === 'all' ? mk.procs.find(p => p.t === type) : null);
  return m ? { steps: m.k, merged: prog.style === 'MergedProcedure' } : null;
}

/* Objektliste der Maske (Index → Objekttyp) aus knx_master.xml. Ältere
   Kataloge haben sie nicht; für System B gilt dann die Liste aller System-B-
   Masken (07B0h, 17B0h, 27B0h, 57B0h). */
const SYSTEM_B_IO = { 0: 0, 1: 1, 2: 2, 3: 9, 4: 3, 5: 4 };
function maskObjects(mk) {
  if (mk && mk.io && Object.keys(mk.io).length) return mk.io;
  return mk && mk.mm === 'SystemB' ? SYSTEM_B_IO : null;
}
const objectTypeAt = (mk, index) => {
  const io = maskObjects(mk);
  return io && io[index] != null ? +io[index] : null;
};

/* Ein Schritt, der eine Load State Machine anspricht. LsmIdx ist der Index
   des Objekts (InterfaceObjectRef seiner LoadControl-Ressource). Angesprochen
   wird es über seinen Typ: das Gerät nennt selbst, wo es liegt. */
function lsmTarget(a, propertyMapped, mk) {
  if (a.ObjType != null && a.ObjType !== '')
    return { mode: 'prop', ot: num(a.ObjType), occ: num(a.Occurrence) };
  if (a.ObjIdx != null && a.ObjIdx !== '')
    return { mode: 'prop', oi: num(a.ObjIdx) };
  const lsm = num(a.LsmIdx);
  if (!propertyMapped) return { mode: 'mem', lsm };
  const ot = objectTypeAt(mk, lsm);
  return { mode: 'prop', ot: ot != null ? ot : lsm, occ: 0, lsm };
}

const OT_NAMES = { 1: 'Adresstabelle', 2: 'Assoziationstabelle', 3: 'Applikation', 4: 'PEI-Programm',
                   6: 'Filtertabelle', 9: 'Objekttabelle', 17: 'Security-Objekt' };
const targetName = t => OT_NAMES[t.ot != null ? t.ot : t.lsm] || (t.oi != null ? 'Objekt ' + t.oi : 'Objekttyp ' + t.ot);

/* Ladeereignis bzw. zusätzliche Ladesteuerung nach 03/05/02 3.31.2 und 3.31.3:
   Speicher: 11 Oktette an 0104h, erstes Oktett = LSM-Nummer | Ereignis.
   Property: 10 Oktette an PID_LOAD_STATE_CONTROL.                          */
function lsmStep(target, event, payload, label, expect) {
  let bytes;
  if (target.mode === 'mem') {
    bytes = [((target.lsm & 0x0F) << 4) | event, ...(payload ? [payload[0], 0, ...payload.slice(1)] : [])];
    while (bytes.length < 11) bytes.push(0);
  } else {
    bytes = [event, ...(payload || [])];
    while (bytes.length < 10) bytes.push(0);
  }
  const s = { op: 'lsm', mode: target.mode, event, data: hex(bytes), expect, label };
  if (target.mode === 'mem') s.lsm = target.lsm;
  if (target.ot != null) { s.ot = target.ot; s.occ = target.occ || 0; }
  if (target.oi != null) s.oi = target.oi;
  return s;
}

/* Adressraum der Applikation: absolute Segmente plus Filtertabelle. */
function imageAt(ctx, addr, size, space) {
  if (space === 'LcFilter') {
    const t = ctx.filter;
    if (!t || addr < 512 || addr - 512 + size > t.table.length) return null;
    return t.table.slice(addr - 512, addr - 512 + size);
  }
  const out = new Uint8Array(size);
  let covered = 0;
  Object.values(ctx.segs).forEach(seg => {
    if (seg.lsm) return;                          // relative Segmente haben keine feste Adresse
    const from = Math.max(addr, seg.addr), to = Math.min(addr + size, seg.addr + seg.size);
    for (let a = from; a < to; a++) { out[a - addr] = seg.img[a - seg.addr]; covered++; }
  });
  return covered === size ? out : null;
}

/* Schreibbare Abschnitte eines Segments: Oktette mit Maske 00 bleiben stehen. */
function segmentWrites(seg, label) {
  const steps = [];
  let start = -1;
  const flush = end => {
    if (start < 0) return;
    steps.push({ op: 'writeMem', addr: seg.addr + start, data: hex(seg.img.slice(start, end)),
                 verify: true, label });
    start = -1;
  };
  for (let i = 0; i < seg.size; i++) {
    const keep = seg.mask && i < seg.mask.length && seg.mask[i] === 0;
    if (keep) flush(i);
    else if (start < 0) start = i;
  }
  flush(seg.size);
  return steps;
}

/* Property-Wert aus Vorgabe der Prozedur und Parametern. Ohne Vorgabe gehören
   dem Download nur die Bits der Parameter: `mask` markiert sie, der Dienst
   liest den aktuellen Wert und ersetzt nur diese Bits (z. B. PID 57, dessen
   übrige Bits wie EN_SNA_READ sonst gelöscht würden). */
function propImage(ctx, a) {
  const key = a.ObjIdx != null && a.ObjIdx !== ''
    ? `i:${num(a.ObjIdx)}:${num(a.PropId)}`
    : `t:${num(a.ObjType)}:${num(a.Occurrence)}:${num(a.PropId)}`;
  const fromParams = ctx.props.get(key);
  const inline = a.InlineData ? fromHex(a.InlineData) : null;
  if (!fromParams) return inline ? { data: inline } : null;

  const len = Math.max(inline ? inline.length : 0, fromParams.length);
  const out = new Uint8Array(len), mask = new Uint8Array(len);
  if (inline) out.set(inline);
  Object.values(ctx.dl.loc).filter(l => l.w === key).forEach(l => {
    const t = ctx.item.types[l.t];
    if (!t || !t.n) return;
    for (let i = 0; i < t.n; i++) {
      const p = l.o + i, m = 0x80 >> (p & 7);
      mask[p >> 3] |= m;
      if (fromParams[p >> 3] & m) out[p >> 3] |= m;
      else out[p >> 3] &= ~m;
    }
  });
  return inline || mask.every(b => b === 0xFF) ? { data: out } : { data: out, mask };
}

const objRef = a => (a.ObjIdx != null && a.ObjIdx !== '')
  ? { oi: num(a.ObjIdx) } : { ot: num(a.ObjType), occ: num(a.Occurrence) };

/* CRC16-CCITT wie im Memory Control Block: Polynom 1021h, Start FFFFh,
   nicht gespiegelt (03/05/01 4.2.27.1.2). */
function crc16(bytes) {
  let c = 0xFFFF;
  for (const b of bytes) {
    c ^= b << 8;
    for (let i = 0; i < 8; i++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) & 0xFFFF : (c << 1) & 0xFFFF;
  }
  return c;
}

/* Inhalt, der in das Objekt mit Index `oi` relativ geschrieben wird: eine
   der System-B-Tabellen oder die relativen Segmente seiner Load State Machine. */
function relImage(ctx, oi) {
  const ot = objectTypeAt(ctx.dl.mk, oi);
  if (ctx.rel && ot != null && ctx.rel[ot]) return ctx.rel[ot];
  const segs = Object.values(ctx.segs).filter(g => g.lsm === oi);
  if (!segs.length) return null;
  const end = segs.reduce((m, g) => Math.max(m, g.addr + g.size), 0);
  const img = new Uint8Array(end);
  segs.forEach(g => img.set(g.img, g.addr));
  return img;
}

/* Parameterreferenz aus einer Ladeprozedur: dort steht die volle Id mit dem
   Programmpräfix, im Projekt die gekürzte — die längste bekannte Endung gilt. */
function paramRefOf(item, full) {
  const parts = String(full || '').split('_');
  for (let i = 0; i < parts.length; i++) {
    const k = parts.slice(i).join('_');
    if (item.params && item.params[k]) return k;
  }
  return null;
}

const testHits = (test, val) => (typeof KNX !== 'undefined' && KNX.testHits
  ? KNX.testHits(test, val) : String(test).trim().split(/\s+/).includes(String(val)));

const imageKey = a => (a.ObjIdx != null && a.ObjIdx !== '')
  ? `i:${num(a.ObjIdx)}:${num(a.PropId)}` : `t:${num(a.ObjType)}:${num(a.Occurrence)}:${num(a.PropId)}`;

function translate(ctx, steps, out) {
  steps.forEach(s => {
    const a = s.a || {};
    // AppliesTo: „full“ beim vollständigen, „par“ beim teilweisen Laden
    if (a.AppliesTo && !String(a.AppliesTo).split(/[\s,]+/).includes(ctx.full ? 'full' : 'par')) return;
    const before = out.length;
    translateOne(ctx, s, a, out);
    // LdCtrlMapError: Fehler der eingeschlossenen Schritte gelten nicht als Abbruch
    if (ctx.tolerate) for (let i = before; i < out.length; i++) out[i].tolerate = true;
  });
}

function translateOne(ctx, s, a, out) {
  const { dl, prog, errors } = ctx;
  const propertyMapped = dl.mk && dl.mk.feat && dl.mk.feat.PropertyMappedLsms === '1';
  const appId = [...u16(dl.manu), ...u16(prog.appNumber), prog.appVersion & 0xFF];
  {
    switch (s.n) {
      case 'LdCtrlConnect': case 'LdCtrlDisconnect':
      case 'LdCtrlSetControlVariable': case 'LdCtrlDeclarePropDesc': case 'LdCtrlLoadImageMem':
        return;                                     // Verbindung und Prüfmodus regelt der Dienst
      case 'LdCtrlMerge': {
        const part = dl.lp.filter(p => p.m === a.MergeId);
        part.forEach(p => translate(ctx, p.k, out));
        if (a.MergeId === '4' && ctx.ip) out.push(...ctx.ip.splice(0));
        return;
      }
      case 'LdCtrlCompareProp':
        // Ist der Wert vorher ins Abbild gelesen worden, gilt das Abbild — die Vorgabe ist dann Platzhalter
        out.push({ op: 'compareProp', ...objRef(a), pid: num(a.PropId),
          start: num(a.StartIndex) || 1, count: num(a.Count) || 1, data: a.InlineData || '',
          ...(ctx.images.has(imageKey(a)) ? { image: true } : {}),
          label: `Gerät prüfen (Property ${a.PropId})` });
        return;
      case 'choose': {
        // Verzweigung in der Ladeprozedur: zählt der Wert des Parameters, wie im Sichtbarkeitsbaum
        const ref = paramRefOf(ctx.item, a.ParamRefId);
        if (!ref) { errors.push(`Ladeprozedur verzweigt über einen unbekannten Parameter (${a.ParamRefId}).`); return; }
        const has = Object.prototype.hasOwnProperty.call(ctx.values || {}, ref);
        const val = String(has ? ctx.values[ref] : (ctx.item.params[ref].d != null ? ctx.item.params[ref].d : ''));
        const whens = (s.k || []).filter(w => w.n === 'when');
        let hits = whens.filter(w => w.a && w.a.test != null && w.a.test !== '' && testHits(w.a.test, val));
        if (!hits.length) hits = whens.filter(w => w.a && w.a.default === 'true').slice(0, 1);
        hits.forEach(w => translate(ctx, w.k || [], out));
        return;
      }
      case 'LdCtrlRelSegment': {
        // Data Relative Allocation (03/05/02 3.31.3.4): 03h 0Bh, Größe (4 Oktette), Mode, Fill
        const t = lsmTarget(a, propertyMapped, dl.mk);
        const lsm = num(a.LsmIdx);
        const img = relImage(ctx, lsm);
        // Bei den Tabellen steht in knx_master.xml nur die Mindestgröße — zugeteilt wird, was sie brauchen
        const size = Math.max(num(a.Size), img ? img.length : 0);
        const mode = num(a.Mode) & 1, fill = num(a.Fill) & 0xFF;
        ctx.alloc[lsm] = { size, mode, fill };
        out.push(lsmStep(t, 3, [0x0B, ...be32(size), mode, fill, 0, 0],
          `${targetName(t)}: ${size} Byte zuteilen`, [2]));
        return;
      }
      case 'LdCtrlWriteRelMem': {
        // Schreiben relativ zum zugeteilten Block; dessen Lage meldet PID_TABLE_REFERENCE
        const oi = num(a.ObjIdx), off = num(a.Offset), size = num(a.Size);
        const img = relImage(ctx, oi);
        const name = targetName({ ot: objectTypeAt(dl.mk, oi), oi });
        if (!img) { errors.push(`Für ${name} (Objekt ${oi}) liegen keine Daten vor.`); return; }
        const part = img.slice(off, Math.min(img.length, off + size));
        if (!part.length) return;
        if (off === 0) ctx.written[oi] = part;
        out.push({ op: 'writeRelMem', oi, offset: off, data: hex(part), verify: a.Verify === 'true',
                   label: `${name}: ${part.length} Byte schreiben` });
        return;
      }
      case 'LdCtrlMapError':
        // Abgebildet auf 0 heißt: dieser Fehler bricht nicht ab; zurück auf sich selbst hebt das auf
        ctx.tolerate = String(a.MappedError) === '0' && String(a.OriginalError) !== '0';
        return;
      case 'LdCtrlLoadImageProp': {
        // Den Wert aus dem Gerät ins Abbild lesen — PID 7 vor dem Neuzuteilen, PID 27 (Prüfsumme) danach
        ctx.images.add(imageKey(a));
        const step = { op: 'loadImageProp', ...objRef(a), pid: num(a.PropId),
                       start: num(a.StartIndex) || 1, count: num(a.Count) || 1, label: `Property ${a.PropId} lesen` };
        const oi = a.ObjIdx != null && a.ObjIdx !== '' ? num(a.ObjIdx) : null;
        const alloc = oi != null ? ctx.alloc[oi] : null, data = oi != null ? ctx.written[oi] : null;
        if (num(a.PropId) === 27 && alloc && data) {
          // Memory Control Block: Segmentgröße und CRC16-CCITT über den zugeteilten Block (4.2.27)
          let block = null;
          if (data.length >= alloc.size) block = data.slice(0, alloc.size);
          else if (alloc.mode) { block = new Uint8Array(alloc.size).fill(alloc.fill); block.set(data); }
          if (block) Object.assign(step, { expectSize: alloc.size, expectCrc: crc16(block) });
        }
        out.push(step);
        return;
      }
      case 'LdCtrlUnload': case 'LdCtrlLoad': case 'LdCtrlLoadCompleted': {
        const t = lsmTarget(a, propertyMapped, dl.mk);
        const ev = { LdCtrlUnload: 4, LdCtrlLoad: 1, LdCtrlLoadCompleted: 2 }[s.n];
        const verb = { 4: 'entladen', 1: 'Laden beginnen', 2: 'Laden abschließen' }[ev];
        out.push(lsmStep(t, ev, null, `${targetName(t)}: ${verb}`, { 4: [0], 1: [2], 2: [1] }[ev]));
        return;
      }
      case 'LdCtrlAbsSegment': {
        const t = lsmTarget(a, propertyMapped, dl.mk);
        const addr = num(a.Address), size = num(a.Size);
        out.push(lsmStep(t, 3, [num(a.SegType), ...u16(addr), ...u16(size),
          num(a.Access) & 0xFF, num(a.MemType) & 0xFF, num(a.SegFlags) & 0xFF, 0],
          `${targetName(t)}: Segment ${addr.toString(16).toUpperCase()}h reservieren`, [2]));
        // EEPROM-Segmente mit Inhalt werden gleich danach beschrieben
        const seg = Object.values(ctx.segs).find(x => x.addr === addr);
        if (seg && num(a.MemType) === 3 && num(a.SegType) === 0)
          out.push(...segmentWrites(seg, `${targetName(t)}: ${size} Byte schreiben`));
        return;
      }
      case 'LdCtrlTaskSegment': {
        const t = lsmTarget(a, propertyMapped, dl.mk);
        out.push(lsmStep(t, 3, [2, ...u16(num(a.Address)), num(prog.pei) & 0xFF, ...appId],
          `${targetName(t)}: Kennung setzen`, [2]));
        return;
      }
      case 'LdCtrlTaskPtr': {
        const t = lsmTarget(a, propertyMapped, dl.mk);
        out.push(lsmStep(t, 3, [3, ...u16(num(a.InitAddress)), ...u16(num(a.SaveAddress)),
          ...u16(num(a.SerialAddress)), 0, 0], `${targetName(t)}: Einsprünge setzen`, [2]));
        return;
      }
      case 'LdCtrlTaskCtrl1': {
        const t = lsmTarget(a, propertyMapped, dl.mk);
        out.push(lsmStep(t, 3, [4, ...u16(num(a.Address)), num(a.Count) & 0xFF, 0, 0, 0, 0, 0],
          `${targetName(t)}: Interface-Objekte anmelden`, [2]));
        return;
      }
      case 'LdCtrlTaskCtrl2': {
        const t = lsmTarget(a, propertyMapped, dl.mk);
        out.push(lsmStep(t, 3, [5, ...u16(num(a.CallbackAddress)), ...u16(num(a.Address)),
          ...u16(num(a.Seg0)), ...u16(num(a.Seg1))], `${targetName(t)}: Objektzeiger setzen`, [2]));
        return;
      }
      case 'LdCtrlMaxLength': {
        const t = lsmTarget(a, propertyMapped, dl.mk);
        out.push(lsmStep(t, 3, [0x0A, ...u16(num(a.Size)), 0, 0, 0, 0, 0, 0],
          `${targetName(t)}: Größe festlegen`, [2]));
        return;
      }
      case 'LdCtrlWriteMem': {
        const addr = num(a.Address), size = num(a.Size), space = a.AddressSpace || '';
        if (space && space !== 'LcFilter') {
          errors.push(`Ladeschritt schreibt in den Adressraum „${space}“ — das wird nicht unterstützt.`);
          return;
        }
        const data = a.InlineData ? fromHex(a.InlineData) : imageAt(ctx, addr, size, space);
        if (!data) {
          errors.push(`Für ${size} Byte ab ${addr.toString(16).toUpperCase()}h liegen keine Daten vor.`);
          return;
        }
        out.push({ op: 'writeMem', addr, data: hex(data), verify: a.Verify === 'true',
          skipZeros: space === 'LcFilter',
          label: space === 'LcFilter' ? `Filtertabelle schreiben (${ctx.filter.count} Adressen)`
            : `${size} Byte ab ${addr.toString(16).toUpperCase()}h schreiben` });
        return;
      }
      case 'LdCtrlWriteProp': {
        const img = propImage(ctx, a);
        /* PID_PROGRAM_VERSION des Applikationsobjekts: die Vorgabe aus Nullen ist ein
           Platzhalter für Hersteller, Applikationsnummer und -version (03/05/01 4.2.13). */
        if (img && num(a.PropId) === 13 && !img.mask && img.data.length === 5 && img.data.every(b => b === 0)
            && a.ObjIdx != null && a.ObjIdx !== '' && objectTypeAt(dl.mk, num(a.ObjIdx)) === 3) {
          img.data = Uint8Array.from(appId);
        }
        if (!img) {
          ctx.warn(`Property ${a.PropId} hat weder Vorgabe noch Parameter — übersprungen.`);
          return;
        }
        out.push({ op: 'writeProp', ...objRef(a), pid: num(a.PropId),
          start: num(a.StartIndex) || 1, count: num(a.Count) || 1, data: hex(img.data),
          ...(img.mask ? { mask: hex(img.mask) } : {}),
          verify: a.Verify === 'true', label: `Property ${a.PropId} schreiben` });
        return;
      }
      case 'LdCtrlClearLCFilterTable':
        out.push({ op: 'clearFilterTable', ot: 6, occ: 0, label: 'Filtertabelle löschen' });
        return;
      case 'LdCtrlClearCachedObjectTypes':
        out.push({ op: 'clearObjectCache', label: 'Objektliste neu lesen' });
        return;
      case 'LdCtrlDelay':
        out.push({ op: 'delay', ms: num(a.MilliSeconds), label: 'Warten' });
        return;
      case 'LdCtrlRestart':
        if (ctx.ip && ctx.ip.length) out.push(...ctx.ip.splice(0));
        if (ctx.sec && ctx.sec.length) out.push(...ctx.sec.splice(0));
        out.push({ op: 'restart', label: 'Neustart' });
        return;
      default:
        errors.push(`Ladeschritt ${s.n} wird nicht unterstützt.`);
    }
  }
}

/* ---------- KNX Secure ---------- *
 * Die Produktdaten kennen keine Secure-Schritte; was dafür zusätzlich geladen
 * wird, legt der Standard fest:
 *   03/05/01 6.1.5, 6.3.10.5   Tool Key zuerst, gesichert mit dem FDSK
 *   03/05/01 6.3.5             Security Mode über eine Function Property
 *   03/05/01 6.3.7, 6.3.8, 6.3.15  Gruppenschlüssel-, Security-IA-Tabelle, GO-Flags
 *   AN209                      Ablauf: Security-Objekt entladen, Laden beginnen,
 *                              je Tabelle erst Länge 0, dann die Einträge
 * Schlüssel stehen nie im Plan. Den Tool Key erzeugt und setzt der Dienst, die
 * Gruppenschlüssel holt er aus seiner Ablage; hier stehen nur Ids und Indizes. */

const SEC = { ot: 17, ia: 54, goFlags: 61 };
// b1 conf, b0 auth (03/05/01 6.3.15.2) — sichere Gruppenadressen immer mit Verschlüsselung
const GO_AUTH_CONF = 0x03;

const validPa = a => Number.isInteger(a) && a > 0 && (a & 0xFF) !== 0xFF;

/**
 * Secure-Anteil des Plans. `status` ist der Zustand der Schlüsselablage aus
 * dem Dienst (nur, ob Schlüssel da sind — nie die Schlüssel). Liefert
 * { head, tables, summary } oder null, wenn das Gerät ohne Secure geladen wird.
 */
function secureSteps(project, dev, item, kind, model, status, errors, warn) {
  const groups = new Map(project.groups.map(g => [g.id, g]));
  const gaText = id => {
    const g = groups.get(id);
    return g ? (typeof KNX !== 'undefined' ? KNX.gaStr(g.raw) : String(g.raw)) : id;
  };
  const live = dev.objs.filter(o => !o.stale);
  const secureGas = new Set();
  live.forEach(o => o.gas.forEach(id => {
    const g = groups.get(id);
    if (g && g.secure && g.raw > 0) secureGas.add(id);
  }));
  const keys = status && status.unlocked && dev.serial ? (status.devices || {})[dev.serial] : null;
  const withTables = kind !== 'par' && kind !== 'cfg' && kind !== 'unload';
  const t = { mode: 'prop', ot: SEC.ot, occ: 0 };
  const prop = (pid, start, count, bytes, label) => ({ op: 'writeProp', ot: SEC.ot, occ: 0, pid, start, count,
    data: hex(bytes), verify: false, loose: true, label });
  const sync = { op: 'secureSync', serial: dev.serial, label: 'Secure: Zugang herstellen' };

  if (!dev.secure) {
    if (secureGas.size)
      warn(`Das Gerät wird ohne Secure geladen und nimmt an ${[...secureGas].map(gaText).join(', ')} nicht teil — diese Adressen sind sicher.`);
    // War es Secure, wird es zurückgebaut: sonst bliebe es halb gesichert
    if (!keys || !(keys.toolKey || keys.pending) || kind === 'unload') return null;
    return {
      head: [sync, { op: 'secureMode', on: false, label: 'Secure: Security Mode ausschalten' }],
      tables: withTables ? [
        lsmStep(t, 4, null, 'Security-Objekt: entladen', [0]),
        lsmStep(t, 1, null, 'Security-Objekt: Laden beginnen', [2]),
        prop(SEC.ia, 0, 1, [0, 0], 'Security-IA-Tabelle leeren'),
        { op: 'secureGroupKeys', entries: [], label: 'Gruppenschlüssel leeren' },
        prop(SEC.goFlags, 0, 1, [0, 0], 'GO-Security-Flags leeren'),
        lsmStep(t, 2, null, 'Security-Objekt: Laden abschließen', [1])
      ] : [],
      summary: { off: true }
    };
  }

  if (!item.secure) {
    errors.push('Laut Produktdatei kann das Gerät kein KNX Secure. Ist sie vor der Secure-Unterstützung eingelesen worden, die .knxprod bitte neu laden.');
    return null;
  }
  if (!dev.serial) {
    errors.push('Für die Secure-Inbetriebnahme fehlt die Seriennummer — bitte das Gerätezertifikat (FDSK) eintragen.');
    return null;
  }
  if (!status) {
    errors.push('KNX Secure braucht den lokalen Dienst mit seiner Schlüsselablage.');
    return null;
  }
  if (status.error) {
    errors.push(`Die Schlüsselablage ist nicht erreichbar: ${status.error}`);
    return null;
  }
  if (status.loading) {
    errors.push('Der Zustand der Schlüsselablage wird gelesen …');
    return null;
  }
  if (!status.unlocked) {
    errors.push(status.exists === false
      ? 'Für KNX Secure braucht das Projekt eine Schlüsselablage — bitte mit einem Projektpasswort anlegen.'
      : 'Die Schlüsselablage ist gesperrt — bitte mit dem Projektpasswort entsperren.');
    return null;
  }
  if (!keys || !(keys.fdsk || keys.toolKey || keys.pending)) {
    errors.push(`Für die Seriennummer ${dev.serial} ist kein Gerätezertifikat (FDSK) hinterlegt.`);
    return null;
  }

  const head = [sync];
  const summary = { toolKey: !!keys.toolKey, groups: 0, senders: 0, objects: 0 };
  if (kind === 'unload') return { head, tables: [], summary };
  head.push({ op: 'secureToolKey', serial: dev.serial,
              label: keys.toolKey ? 'Secure: Tool Key prüfen' : 'Secure: Tool Key setzen' });
  head.push({ op: 'secureMode', on: true, label: 'Secure: Security Mode einschalten' });
  if (!withTables) return { head, tables: [], summary };

  // Gruppenschlüssel: GA_Index ist die TSAP der Adresse in der Adresstabelle (6.3.7.2, NOTE 103)
  const addrs = model ? model.addrs : [];
  const entries = [...secureGas]
    .map(id => ({ tsap: addrs.indexOf(groups.get(id).raw) + 1, ga: id }))
    .filter(e => e.tsap > 0)
    .sort((a, b) => a.tsap - b.tsap);

  // GO-Security-Flags: ein Oktett je Objekt, Index = Objektnummer (6.3.15.2)
  const flags = new Map();
  live.forEach(o => {
    const linked = o.gas.map(id => groups.get(id)).filter(g => g && g.raw > 0);
    const secureCount = linked.filter(g => g.secure).length;
    if (!secureCount) return;
    if (secureCount < linked.length)
      errors.push(`Objekt ${o.num} „${o.name}“ hat sichere und unsichere Gruppenadressen — ein Objekt ist entweder gesichert oder nicht (03/05/01 6.3.15).`);
    if (o.num < 1)
      errors.push(`Objekt ${o.num} „${o.name}“ kann nicht gesichert werden: die GO-Security-Flags zählen ab Objekt 1.`);
    else flags.set(o.num, GO_AUTH_CONF);
  });
  const maxNum = Math.max(0, ...flags.keys());
  const flagBytes = new Uint8Array(maxNum);
  flags.forEach((v, n) => { flagBytes[n - 1] = v; });

  // Security-IA-Tabelle: wer auf diesen Adressen gesichert sendet, aufsteigend, Last Valid SeqNr 0 (6.3.8.5)
  const senders = new Set();
  project.devices.forEach(d => {
    if (d.id === dev.id || !validPa(d.addr)) return;
    if (!d.objs.some(o => !o.stale && o.gas.some(id => secureGas.has(id)))) return;
    if (d.secure) senders.add(d.addr);
  });
  const ia = [...senders].sort((a, b) => a - b);

  secureGas.forEach(id => {
    const plainPeers = project.devices.filter(d => d.id !== dev.id && !d.secure
      && d.objs.some(o => !o.stale && o.gas.includes(id)));
    if (plainPeers.length)
      warn(`${gaText(id)} ist sicher, ${plainPeers.map(d => `„${d.name}“`).join(', ')} wird aber ohne Secure geladen — dort kommt nichts an.`);
  });
  const lim = item.secure || {};
  if (lim.gk && entries.length > lim.gk) errors.push(`${entries.length} sichere Gruppenadressen, das Gerät fasst ${lim.gk} Gruppenschlüssel.`);
  if (lim.ia && ia.length > lim.ia) errors.push(`${ia.length} sichere Absender, die Security-IA-Tabelle des Geräts fasst ${lim.ia}.`);

  summary.groups = entries.length;
  summary.senders = ia.length;
  summary.objects = flags.size;
  const tables = [
    lsmStep(t, 4, null, 'Security-Objekt: entladen', [0]),
    lsmStep(t, 1, null, 'Security-Objekt: Laden beginnen', [2]),
    prop(SEC.ia, 0, 1, [0, 0], 'Security-IA-Tabelle leeren')
  ];
  if (ia.length) tables.push(prop(SEC.ia, 1, ia.length, ia.flatMap(a => [...u16(a), 0, 0, 0, 0, 0, 0]),
    `Security-IA-Tabelle: ${ia.length} Absender`));
  tables.push({ op: 'secureGroupKeys', entries, label: `Gruppenschlüssel: ${entries.length}` });
  tables.push(prop(SEC.goFlags, 0, 1, [0, 0], 'GO-Security-Flags leeren'));
  if (maxNum) tables.push(prop(SEC.goFlags, 1, maxNum, flagBytes, `GO-Security-Flags: ${flags.size} Objekte gesichert`));
  tables.push(lsmStep(t, 2, null, 'Security-Objekt: Laden abschließen', [1]));
  return { head, tables, summary };
}

/* ---------- Plan ---------- */

function findStep(steps, pred) {
  for (const s of steps) {
    if (pred(s)) return s;
    const inner = s.k && findStep(s.k, pred);
    if (inner) return inner;
  }
  return null;
}

/* Koppler laden statt Gruppenadressen eine Filtertabelle. */
function usesFilterTable(item) {
  const mk = item && item.prog && item.prog.dl && item.prog.dl.mk;
  return !!(mk && findStep(mk.procs.flatMap(p => p.k),
    s => s.n === 'LdCtrlWriteMem' && (s.a || {}).AddressSpace === 'LcFilter'));
}

/* Welche Teil-Downloads die Produktdatei anbietet. */
function kinds(item) {
  const prog = item && item.prog;
  if (!prog || !prog.dl) return [];
  if (prog.style === 'ProductProcedure') return ['all'];
  const mk = prog.dl.mk;
  if (!mk) return [];
  return mk.procs.filter(p => p.t === 'Load').map(p => p.s);
}

/**
 * Baut den Plan für ein Gerät.
 * opts.kind      'all' | 'par' | 'grp' | 'par,grp' | 'unload'
 * opts.resolve   Sichtbarkeitsauflösung (KNX.resolveProduct)
 * opts.secure    Zustand der Schlüsselablage ({ unlocked, devices }) oder null
 * Liefert { steps, summary, errors, warnings }; bei errors nicht ausführen.
 */
function plan(project, dev, item, opts = {}) {
  const errors = [], warnings = [];
  const warn = m => { if (!warnings.includes(m)) warnings.push(m); };
  const result = { steps: [], summary: {}, errors, warnings };
  const prog = item && item.prog;
  if (!prog || !prog.dl) {
    errors.push('Zum Produkt fehlen Programmierdaten — bitte die .knxprod erneut in den Katalog laden.');
    return result;
  }
  const dl = prog.dl;
  const mask = parseInt(String(prog.mask || '').replace(/^MV-/, ''), 16);
  if (prog.plugin) warn('Die Produktdatei nennt ein herstellereigenes Programm. Was es beim Laden zusätzlich tut, fehlt hier.');
  if (!(dev.addr > 0) || (dev.addr & 0xFF) === 0xFF)
    errors.push('Das Gerät hat keine gültige physikalische Adresse.');
  const kind = opts.kind || 'all';

  const ctx = { item, prog, dl, dev, errors, warn, segs: segmentImages(dl), props: new Map(),
                values: dev.params || {},
                // System B: Tabellen und Applikation im relativen Speicher, siehe systemBTables
                systemB: !!findStep((dl.mk ? dl.mk.procs.flatMap(p => p.k) : []).concat((dl.lp || []).flatMap(p => p.k)),
                  x => x.n === 'LdCtrlWriteRelMem'),
                full: kind === 'all' || kind === 'ap1',
                alloc: {}, written: {}, images: new Set(), tolerate: false };
  const resolve = opts.resolve || (typeof KNX !== 'undefined' ? KNX.resolveProduct : null);
  Object.assign(ctx, resolveValues(item, ctx.values, resolve));
  // Vor der System-B-Unterstützung eingelesen: die relativen Segmente fehlen in den Programmierdaten
  if ((prog.segments || []).some(x => x.k === 'rel') && !Object.values(ctx.segs).some(g => g.lsm)) {
    errors.push('Die Produktdatei wurde vor der Unterstützung relativer Speichersegmente (System B) eingelesen — bitte die .knxprod erneut in den Katalog laden.');
    return result;
  }

  const summary = result.summary;
  summary.mask = prog.mask;
  summary.kind = kind;
  summary.procedure = prog.style;

  let model = null;
  try {
    summary.params = writeParams(ctx).written;
    model = linkModel(project, dev, item, warn);
    const tables = writeTables(ctx, prog, model, dev.addr, mask);
    Object.assign(summary, tables);
  } catch (e) {
    errors.push(e.message);
  }

  // KNX Secure: Zugang, Tool Key und Security Mode vorweg, das Security-Objekt vor dem Neustart
  const sec = secureSteps(project, dev, item, kind, model, opts.secure || null, errors, warn);
  if (sec) {
    summary.secure = sec.summary;
    ctx.sec = sec.tables;
  }

  // Koppler: Filtertabelle aus der Topologie, IP-Geräte: Parameterobjekt
  const lcFilter = findStep(dl.mk ? dl.mk.procs.flatMap(p => p.k) : [],
    s => s.n === 'LdCtrlWriteMem' && (s.a || {}).AddressSpace === 'LcFilter');
  if (lcFilter) {
    ctx.filter = filterTable(project, dev, num(lcFilter.a.Size) || 8192);
    summary.filter = ctx.filter.count;
  }
  if (dev.ip && ['all', 'par', 'par,grp', 'cfg'].includes(kind)) {
    // Die Multicast-Adresse gilt projektweit und steht am Backbone
    const bb = project.areas.find(a => a.backbone);
    const ipCfg = { ...{ name: '', mode: 'dhcp', addr: '', mask: '', gw: '' }, ...dev.ip,
                    mcast: (bb && bb.lines[0] && bb.lines[0].mcast) || (dev.ip && dev.ip.mcast) || '224.0.23.12' };
    // Ein leerer Name hieße 30 Nullbytes im Gerät; wie die ETS gilt dann der Gerätename
    if (!String(ipCfg.name || '').trim()) ipCfg.name = dev.name || '';
    ctx.ip = ipSteps(ipCfg, dl.addAddr, errors);
  }

  const proc = pickProcedure(prog, kind);
  if (!proc) {
    errors.push(kind === 'all'
      ? 'Die Produktdatei enthält keine Ladeprozedur für diese Maske.'
      : `Die Produktdatei bietet keinen Teil-Download „${kind}“.`);
    return result;
  }

  const steps = [];
  if (sec) steps.push(...sec.head);
  if (mask) {
    const hosts = dl.mk && dl.mk.hosts && dl.mk.hosts.length ? dl.mk.hosts : [mask];
    steps.push({ op: 'checkMask', masks: hosts, label: 'Maskenversion prüfen' });
    if (!BCU1_MASKS.has(mask))
      steps.push({ op: 'authorize', key: 'FFFFFFFF', label: 'Zugriff anmelden' });
  }
  translate(ctx, proc.steps, steps);
  if (ctx.ip && ctx.ip.length) steps.push(...ctx.ip.splice(0));
  if (ctx.sec && ctx.sec.length) steps.push(...ctx.sec.splice(0));

  result.steps = steps;
  // Die Filtertabelle wird nach dem Löschen nur dort geschrieben, wo Bits gesetzt sind
  summary.writes = steps.filter(s => s.op === 'writeMem' || s.op === 'writeRelMem').reduce((n, s) => n + (s.skipZeros
    ? fromHex(s.data).filter(b => b).length : s.data.length / 2), 0);
  summary.steps = steps.length;
  return result;
}

return { plan, kinds, usesFilterTable, encode, dpt9, associations, filterTable, hex, fromHex };
})();
