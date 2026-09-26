/* ============================================================
   KNX-Struktur — ETS-Projekt aus .knxproj
   ============================================================ *
 * Eine .knxproj ist ein ZIP wie die .knxprod: Die Produktdaten aller
 * verbauten Geräte liegen je Hersteller unter M-xxxx/, das Projekt selbst
 * unter P-xxxx/0.xml. Gelesen wird mit denselben Mitteln wie die
 * Produktdatei (knx-prod.js); hier kommt nur die Abbildung des Projekts
 * auf unser Modell dazu. Das Ergebnis ist ein rohes Projekt, das wie jede
 * andere Datei durch KNX.migrate() geht — dort wird es begrenzt und geprüft.
 *
 * Mit Projektpasswort liegt P-xxxx als verschlüsseltes inneres ZIP vor;
 * entschlüsselt wird es mit knx-crypt.js. */
'use strict';

const KNXProj = (() => {

const { tags, attr, localName, toDpt, objectName, plain } = KNXProd.xml;
const LIM = KNXProd.LIMITS.proj;

const MEDIUM = { 'MT-0': 'tp', 'MT-1': 'pl', 'MT-2': 'rf', 'MT-5': 'ip' };
const GA_STYLE = { ThreeLevel: 'three', TwoLevel: 'two', Free: 'free' };

/* Raumtypen der ETS. Treppenhaus kennt das Modell nicht, es ist ein Flur. */
const SPACE = {
  Building: 'building', BuildingPart: 'part', Floor: 'floor', Room: 'room',
  Corridor: 'corridor', Stairway: 'corridor', DistributionBoard: 'cabinet'
};

/* Funktionstypen aus knx_master.xml. FT-2 bis FT-5 sind dort als veraltet
   markiert, kommen in älteren Projekten aber noch vor. */
const FN_TYPE = {
  'FT-1': 'light-switch', 'FT-2': 'light-dim', 'FT-6': 'light-dim',
  'FT-3': 'blind', 'FT-7': 'blind',
  'FT-8': 'heating-switch', 'FT-4': 'heating', 'FT-5': 'heating', 'FT-9': 'heating',
  'FT-10': 'socket'
};

/* Fremde Werte: nur ganze Zahlen im erlaubten Bereich, sonst null. */
function int(v, lo, hi) {
  const s = String(v == null ? '' : v).trim();
  if (!/^\d{1,6}$/.test(s)) return null;
  const n = parseInt(s, 10);
  return n >= lo && n <= hi ? n : null;
}

const VALUE_MAX = 2000;
const text = (v, max = 200) => String(v == null ? '' : v).trim().slice(0, max);

/* Die Seriennummer steht base64-kodiert im Projekt (6 Byte). */
function serialHex(b64) {
  try {
    const bin = atob(String(b64 || ''));
    if (bin.length !== 6) return '';
    return [...bin].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').toUpperCase();
  } catch (e) {
    return '';
  }
}

/* Die Flags am Objekt der Instanz schlagen die des Produkts. */
const FLAG_ATTR = { c: 'CommunicationFlag', r: 'ReadFlag', w: 'WriteFlag', t: 'TransmitFlag', u: 'UpdateFlag' };
const flagsFrom = s => ({
  c: String(s || '').includes('c'), r: String(s || '').includes('r'),
  w: String(s || '').includes('w'), t: String(s || '').includes('t'),
  u: String(s || '').includes('u')
});

const kids = (el, ...names) => [...el.children].filter(c => names.includes(localName(c)));

/**
 * Liest eine .knxproj und liefert { project, report }. `project` ist roh und
 * muss noch durch KNX.migrate(); `report` sammelt, was nicht oder nur
 * teilweise übernommen wurde — als deutscher Text mit Platzhaltern, damit die
 * Oberfläche ihn übersetzen kann.
 *
 * Ein geschütztes Projekt ohne `password` wirft einen Fehler mit
 * `needPassword`, ein falsches Passwort einen mit `wrongPassword` — die
 * Oberfläche fragt dann (erneut) nach.
 */
async function read(file, password) {
  if (typeof DecompressionStream === 'undefined')
    throw new Error('Dieser Browser kann ZIP-Inhalte nicht entpacken.');

  const buf = await file.arrayBuffer();
  const all = KNXProd.zip.entries(buf, LIM);
  const budget = { left: LIM.total };

  /* Ungeschützt steht das Projekt als Ordner P-xxxx/ im Archiv, geschützt
     als verschlüsseltes P-xxxx.zip mit denselben Dateien ohne Ordner. */
  const byNumber = list => list.sort((a, b) => parseInt(a.name.replace(/^.*\//, ''), 10)
                                              - parseInt(b.name.replace(/^.*\//, ''), 10));
  let src = null;
  const plain = byNumber(all.filter(e => /^P-[0-9A-Za-z]+\/\d+\.xml$/.test(e.name)));
  if (plain.length) {
    const folder = plain[0].name.split('/')[0];
    src = { buf, inst: plain, info: all.find(e => e.name === folder + '/project.xml'), folder };
  } else {
    const locked = all.find(e => /^P-[0-9A-Za-z]+\.zip$/.test(e.name));
    if (!locked) throw new Error('Keine Projektdaten gefunden — ist das wirklich eine .knxproj-Datei?');
    if (!password) {
      const err = new Error('Das Projekt ist mit einem Passwort geschützt.');
      err.needPassword = true;
      throw err;
    }
    // Eigener Puffer: gespeichert (Methode 0) wäre es sonst nur eine Sicht auf die Datei
    const innerBuf = (await KNXProd.zip.read(buf, locked, budget, LIM)).slice().buffer;
    const inner = KNXProd.zip.entries(innerBuf, LIM, { encrypted: true });
    const inst = byNumber(inner.filter(e => /^(P-[0-9A-Za-z]+\/)?\d+\.xml$/.test(e.name)));
    if (!inst.length) throw new Error('Im geschützten Teil stehen keine Projektdaten.');
    src = { buf: innerBuf, inst, info: inner.find(e => /(^|\/)project\.xml$/.test(e.name)),
            folder: locked.name.replace(/\.zip$/, ''), decrypt: KNXCrypt.decryptor(password) };
  }

  const xmlEntries = all.filter(e => /\.xml$/i.test(e.name) && !e.name.startsWith(src.folder + '/'));
  if (xmlEntries.length > LIM.xml)
    throw new Error(`Das Archiv enthält ${xmlEntries.length} XML-Dateien — mehr als ${LIM.xml}.`);

  const parser = new DOMParser();
  const dec = new TextDecoder('utf-8');
  const toDoc = bytes => {
    const doc = parser.parseFromString(dec.decode(bytes), 'application/xml');
    return doc.getElementsByTagName('parsererror').length ? null : doc;
  };
  const parse = async e => toDoc(await KNXProd.zip.read(buf, e, budget, LIM));
  const parseProject = async e => toDoc(await KNXProd.zip.read(src.buf, e, budget, LIM, src.decrypt));

  const report = [];
  const say = (msg, ...args) => report.push({ msg, args });

  const projDoc = await parseProject(src.inst[0]);
  if (!projDoc) throw new Error('Die Projektdaten sind kein lesbares XML.');
  const infoDoc = src.info ? await parseProject(src.info) : null;
  if (src.inst.length > 1)
    say('Das Projekt hat {0} Installationen — übernommen wird nur die erste.', src.inst.length);

  /* Produktdaten: alles außerhalb des Projekts. */
  const docs = [];
  for (const e of xmlEntries) {
    const doc = await parse(e);
    if (doc) docs.push(doc);
  }
  const products = docs.length
    ? KNXProd.collect(docs, ['de-DE', 'de-AT', 'de-CH', 'en-US', 'en-GB']) : [];
  const plugins = all.filter(e => KNXProd.BINARY.test(e.name)).length;
  if (plugins)
    say('{0} herstellereigene Programmdateien übergangen — sie laufen nur in der ETS unter Windows.', plugins);

  const project = build(projDoc, infoDoc, products, say);
  return { project, report };
}

/* ---------- Abbildung ---------- */

function build(doc, infoDoc, products, say) {
  let seq = 1;
  const nid = pfx => pfx + (++seq);

  const installation = tags(doc, 'Installation')[0] || doc.documentElement;
  const info = (infoDoc && tags(infoDoc, 'ProjectInformation')[0]) || tags(doc, 'ProjectInformation')[0];
  const name = text(attr(info, 'Name')) || text(attr(tags(doc, 'Project')[0], 'Name')) || 'ETS-Projekt';
  const gaStyle = GA_STYLE[attr(info, 'GroupAddressStyle')] || 'three';

  /* ---- Gruppenadressen ---- *
   * Die Verweise der Objekte (Links) nennen nur den hinteren Teil der Id
   * („GA-3“), ältere Fassungen die ganze. Beides führt zur selben Adresse. */
  const groups = [];
  const gaByRef = new Map();
  const usedRaw = new Set();
  let badGa = 0;
  tags(installation, 'GroupAddress').forEach(el => {
    const raw = int(attr(el, 'Address'), 1, 0xFFFF);
    if (raw == null || usedRaw.has(raw)) { badGa++; return; }
    usedRaw.add(raw);
    const g = { id: nid('g'), raw, name: text(attr(el, 'Name')) || 'Unbenannt',
                dpt: toDpt(attr(el, 'DatapointType')), note: text(attr(el, 'Description'), 2000) };
    groups.push(g);
    const id = attr(el, 'Id');
    gaByRef.set(id, g);
    gaByRef.set(id.slice(id.lastIndexOf('_') + 1), g);
  });
  if (badGa) say('{0} Gruppenadressen ohne gültige oder mit doppelter Adresse übergangen.', badGa);

  /* Benannte Adressbereiche werden zu Haupt- und Mittelgruppen. Die ETS
     erlaubt Bereiche, die nicht auf Gruppengrenzen liegen; die fallen weg. */
  const gaNames = {};
  let lostRanges = 0;
  const rangeWalk = (el, depth) => kids(el, 'GroupRange').forEach(r => {
    const start = int(attr(r, 'RangeStart'), 0, 0xFFFF);
    const nm = text(attr(r, 'Name'));
    let key = null;
    if (start != null && gaStyle === 'three' && depth === 0) key = String(start >> 11);
    else if (start != null && gaStyle === 'three' && depth === 1) key = (start >> 11) + '/' + ((start >> 8) & 7);
    else if (start != null && gaStyle === 'two' && depth === 0) key = String(start >> 11);
    if (key != null && nm) gaNames[key] = nm;
    else if (nm) lostRanges++;
    rangeWalk(r, depth + 1);
  });
  tags(installation, 'GroupRanges').forEach(r => rangeWalk(r, 0));
  if (lostRanges) say('{0} Namen von Adressbereichen passen nicht zum Adressstil und wurden nicht übernommen.', lostRanges);

  /* ---- Produkte ---- */
  const byPair = new Map(), byH2p = new Map();
  products.forEach(p => {
    if (p.productRef && p.h2p) byPair.set(p.productRef + '|' + p.h2p, p);
    if (p.h2p && !byH2p.has(p.h2p)) byH2p.set(p.h2p, p);
  });
  const catalog = [];
  const catIdOf = new Map();            // Produkt → Katalog-Id im neuen Projekt
  const useProduct = p => {
    if (!catIdOf.has(p)) {
      const id = nid('c');
      catIdOf.set(p, id);
      // In den Katalog kommt die speicherbare Form; migrate() faltet Module wieder aus
      const k = KNXProd.compact(p);
      catalog.push({
        id, name: k.name, order: k.order, manufacturer: k.manufacturer, appName: k.appName,
        types: k.types, params: k.params, objs: k.objs, dyn: k.dyn, prog: k.prog,
        ...(k.mods ? { mods: k.mods, inst: k.inst } : {}),
        mask: k.mask, ip: k.ip, medium: k.medium, ma: k.ma, coupler: k.coupler,
        powerSupply: k.powerSupply, choke: k.choke, noAddress: k.noAddress, hwOnly: k.hwOnly
      });
    }
    return catIdOf.get(p);
  };

  /* ---- Topologie und Geräte ---- */
  const areas = [], devices = [];
  const devById = new Map();            // ETS-Id → Gerät
  const stat = { noProduct: 0, params: 0, lostParams: 0, stale: 0, lostLinks: 0, noAddr: 0 };

  tags(installation, 'Area').forEach(aEl => {
    const aAddr = int(attr(aEl, 'Address'), 0, 15);
    if (aAddr == null || areas.some(a => a.addr === aAddr)) {
      say('Bereich „{0}“ hat keine gültige Adresse und wurde übergangen.', text(attr(aEl, 'Name')));
      return;
    }
    const area = { id: nid('a'), addr: aAddr, name: text(attr(aEl, 'Name')) || ('Bereich ' + aAddr), lines: [] };
    areas.push(area);
    kids(aEl, 'Line').forEach(lEl => {
      const lAddr = int(attr(lEl, 'Address'), 0, 15);
      if (lAddr == null || area.lines.some(l => l.addr === lAddr)) {
        say('Linie „{0}“ hat keine gültige Adresse und wurde übergangen.', text(attr(lEl, 'Name')));
        return;
      }
      /* Ab ETS 6 trägt jede Linie Segmente, das Medium steht dort. Segment 0
         ist die Linie selbst, weitere werden zu Segmenten der Linie. */
      const segEls = kids(lEl, 'Segment');
      const seg0 = segEls.find(s => int(attr(s, 'Number'), 0, 15) === 0) || segEls[0];
      const line = {
        id: nid('l'), addr: lAddr, name: text(attr(lEl, 'Name')) || ('Linie ' + lAddr),
        medium: MEDIUM[attr(lEl, 'MediumTypeRefId')] || MEDIUM[attr(seg0, 'MediumTypeRefId')] || 'tp',
        segments: []
      };
      area.lines.push(line);
      const hosts = [{ el: lEl, segmentId: null }];
      segEls.forEach(sEl => {
        const num = int(attr(sEl, 'Number'), 0, 15);
        if (sEl === seg0) { hosts.push({ el: sEl, segmentId: null }); return; }
        if (!num || line.segments.some(s => s.num === num)) {
          say('Segment auf Linie „{0}“ ohne gültige Nummer — seine Geräte hängen jetzt an der Linie.', line.name);
          hosts.push({ el: sEl, segmentId: null });
          return;
        }
        const s = { id: nid('s'), num, name: text(attr(sEl, 'Name')) || ('Segment ' + num),
                    medium: MEDIUM[attr(sEl, 'MediumTypeRefId')] || line.medium };
        line.segments.push(s);
        hosts.push({ el: sEl, segmentId: s.id });
      });
      hosts.forEach(h => kids(h.el, 'DeviceInstance').forEach(dEl => {
        const d = device(dEl, area, line, h.segmentId);
        if (d) { devices.push(d); devById.set(attr(dEl, 'Id'), d); }
      }));
    });
  });

  function device(dEl, area, line, segmentId) {
    const prodRef = attr(dEl, 'ProductRefId'), h2p = attr(dEl, 'Hardware2ProgramRefId');
    const prod = byPair.get(prodRef + '|' + h2p) || byH2p.get(h2p) || null;
    if (!prod) stat.noProduct++;

    /* Ohne Address hat das Gerät keine physikalische Adresse (Drossel,
       Netzteil). Eine unbrauchbare wird später neu vergeben (-1). */
    const rawAddr = attr(dEl, 'Address');
    let addr = null;
    if (rawAddr !== '') {
      const n = int(rawAddr, 0, 255);
      if (n == null) { stat.noAddr++; addr = -1; } else addr = KNX.paJoin(area.addr, line.addr, n);
    }
    const name = text(attr(dEl, 'Name')) || (prod ? text(plain(prod.name)) : '') || 'Gerät';
    const comment = attr(dEl, 'Comment');
    const note = [attr(dEl, 'Description'), /^\s*\{\\rtf/.test(comment) ? '' : comment]
      .map(s => text(s, 2000)).filter(s => s && s !== name).join('\n');
    const d = {
      id: nid('d'), name,
      product: prod ? text(prod.order || plain(prod.name), 60) : '',
      lineId: line.id, segmentId, addr,
      roomId: null,
      catalogId: prod ? useProduct(prod) : null,
      note, serial: serialHex(attr(dEl, 'SerialNumber')),
      params: {}, ip: ipConfig(dEl, name), ma: null, supply: 0, objs: []
    };

    /* Parameter: Die Ids sind vollständig, im Katalog um das Programm
       gekürzt. Was dort fehlt (etwa Module), bleibt weg. */
    const appId = prod && prod.appId;
    const cut = id => (appId && id.startsWith(appId + '_')) ? id.slice(appId.length + 1) : id;
    tags(dEl, 'ParameterInstanceRef').forEach(pEl => {
      const ref = cut(attr(pEl, 'RefId'));
      if (prod && prod.params[ref]) { d.params[ref] = text(attr(pEl, 'Value'), VALUE_MAX); stat.params++; }
      else stat.lostParams++;
    });

    /* Objekte: zuerst die, die das Produkt bei dieser Parametrierung zeigt —
       dieselbe Ableitung wie beim Bearbeiten der Parameter. */
    const byRef = new Map();
    const mk = (ref, src) => {
      const o = { id: nid('o'), ref, num: src.num, name: src.name || ('Objekt ' + src.num),
                  dpt: src.dpt, flags: flagsFrom(src.f), gas: [] };
      byRef.set(ref, o);
      d.objs.push(o);
      return o;
    };
    if (prod && !prod.hwOnly) KNX.resolveProduct(prod, d.params).objs.forEach(ref => mk(ref, prod.objs[ref]));

    tags(dEl, 'ComObjectInstanceRef').forEach((oEl, i) => {
      const ref = cut(attr(oEl, 'RefId'));
      const gas = linksOf(oEl);
      let o = byRef.get(ref);
      if (!o) {
        // Nur Objekte mit Verknüpfungen sind der Rede wert
        if (!gas.length) return;
        if (prod && prod.objs[ref]) {
          o = mk(ref, prod.objs[ref]);
          o.stale = true;               // nach unserer Auswertung gerade unsichtbar
          stat.stale++;
        } else {
          const m = /^O-(\d+)/.exec(ref);
          o = { id: nid('o'), ref: null, num: m ? parseInt(m[1], 10) : i,
                name: 'Objekt ' + (m ? m[1] : i), dpt: '', flags: flagsFrom('cw'), gas: [] };
          d.objs.push(o);
        }
      }
      const own = objectName(attr(oEl, 'Text'), attr(oEl, 'FunctionText'));
      const desc = text(attr(oEl, 'Description'));
      if (own) o.name = own;
      if (desc && desc !== o.name) o.desc = desc;
      o.dpt = toDpt(attr(oEl, 'DatapointType')) || o.dpt;
      Object.keys(FLAG_ATTR).forEach(k => {
        const v = attr(oEl, FLAG_ATTR[k]);
        if (v) o.flags[k] = v === 'Enabled';
      });
      o.gas = gas.map(g => g.id);
    });
    return d;
  }

  /* IP-Einstellungen aus dem Eigenschaftsfenster der ETS. Ohne IPConfig
     bleibt es beim Vorgabewert (DHCP). */
  function ipConfig(dEl, name) {
    const c = kids(dEl, 'IPConfig')[0];
    if (!c) return null;
    const ip = v => KNX.isIpV4(attr(c, v)) ? attr(c, v) : '';
    const manual = attr(c, 'Assign') === 'Fixed';
    return { ...KNX.IP_DEFAULTS, name: name.slice(0, 30), mode: manual ? 'manual' : 'dhcp',
             addr: manual ? ip('IPAddress') : '', mask: ip('SubnetMask') || KNX.IP_DEFAULTS.mask,
             gw: manual ? ip('DefaultGateway') : '' };
  }

  /* ETS 5/6: Links="GA-1 GA-2", die erste ist die sendende. ETS 4:
     Connectors mit Send und Receive. */
  function linksOf(oEl) {
    const refs = attr(oEl, 'Links').split(/\s+/).filter(Boolean);
    tags(oEl, 'Send').concat(tags(oEl, 'Receive'))
      .forEach(c => refs.push(attr(c, 'GroupAddressRefId')));
    const out = [];
    refs.forEach(r => {
      const g = gaByRef.get(r);
      if (g && !out.includes(g)) out.push(g);
      else if (!g) stat.lostLinks++;
    });
    return out;
  }

  /* Backbone: Bereich 0 mit Linie 0, wie im Modell verlangt. */
  const zero = areas.find(a => a.addr === 0);
  if (zero) {
    zero.backbone = true;
    if (!zero.lines.some(l => l.addr === 0))
      zero.lines.unshift({ id: nid('l'), addr: 0, name: 'Backbone', medium: 'ip', segments: [] });
    zero.lines.sort((x, y) => x.addr - y.addr);
    if (!['ip', 'tp'].includes(zero.lines[0].medium)) zero.lines[0].medium = 'tp';
  }

  /* ---- Gebäude ---- */
  const tree = { id: 'n1', kind: 'site', name, children: [] };
  const functions = [];
  let unknownSpace = 0, notInRoom = 0;
  const spaceWalk = (el, into) => kids(el, 'Space', 'BuildingPart').forEach(sEl => {
    const type = attr(sEl, 'Type');
    if (!SPACE[type]) unknownSpace++;
    const node = { id: nid('n'), kind: SPACE[type] || 'room', name: text(attr(sEl, 'Name')), children: [] };
    into.push(node);
    kids(sEl, 'DeviceInstanceRef').forEach(r => {
      const dev = devById.get(attr(r, 'RefId'));
      if (!dev) return;
      if (KNX.DEVICE_HOSTS.has(node.kind)) dev.roomId = node.id;
      else notInRoom++;
    });
    kids(sEl, 'Function').forEach(fEl => functions.push(fn(fEl, node)));
    spaceWalk(sEl, node.children);
  });
  const loc = tags(installation, 'Locations')[0] || tags(installation, 'Buildings')[0];
  if (loc) spaceWalk(loc, tree.children);
  if (unknownSpace) say('{0} Gebäudeteile mit unbekanntem Typ als Raum übernommen.', unknownSpace);
  if (notInRoom) say('{0} Geräte hängen in der ETS an einem Gebäudeteil, der hier keine Geräte aufnimmt — sie sind keinem Raum zugeordnet.', notInRoom);

  function fn(fEl, node) {
    const gas = [];
    kids(fEl, 'GroupAddressRef').forEach(r => {
      const g = gaByRef.get(attr(r, 'RefId'));
      if (g && !gas.some(x => x.ga === g.id)) gas.push({ ga: g.id, role: '' });
    });
    return { id: nid('f'), nodeId: node.id, type: FN_TYPE[attr(fEl, 'Type')] || 'custom',
             name: text(attr(fEl, 'Name')), icon: '', note: '', gas };
  }

  /* ETS 5 kennt an der Adresse keinen DPT — dann gilt der des ersten
     verbundenen Objekts. */
  const dptOfGa = new Map();
  devices.forEach(d => d.objs.forEach(o => o.gas.forEach(id => {
    if (o.dpt && !dptOfGa.has(id)) dptOfGa.set(id, o.dpt);
  })));
  groups.forEach(g => { g.dpt = g.dpt || dptOfGa.get(g.id) || '1.001'; });
  devices.forEach(d => d.objs.forEach(o => { if (!o.dpt) o.dpt = '1.001'; }));

  /* Die Rollen der ETS stehen im Projekt nur als GUID. Sie werden über den
     Datenpunkttyp auf die Rollen unseres Funktionstyps gelegt. */
  const gaById = new Map(groups.map(g => [g.id, g]));
  functions.forEach(f => {
    const roles = KNX.fnType(f.type).roles, taken = new Set();
    f.gas.forEach(x => {
      const role = roles.find(r => !taken.has(r.key) && r.dpt === gaById.get(x.ga).dpt);
      if (role) { taken.add(role.key); x.role = role.key; }
    });
  });

  /* Ungültige physikalische Adressen: nächste freie Nummer auf der Linie. */
  const usedPa = new Set(devices.map(d => d.addr).filter(Number.isInteger));
  devices.filter(d => d.addr === -1).forEach(d => {
    const a = areas.find(x => x.lines.some(l => l.id === d.lineId));
    const l = a.lines.find(x => x.id === d.lineId);
    d.addr = null;
    for (let n = 1; n <= 255 && d.addr == null; n++) {
      const raw = KNX.paJoin(a.addr, l.addr, n);
      if (!usedPa.has(raw)) { usedPa.add(raw); d.addr = raw; }
    }
  });

  if (stat.noProduct) say('{0} Geräte ohne Produktdaten im Archiv — sie sind als leere Geräte übernommen.', stat.noProduct);
  if (stat.lostParams) say('{0} Parameterwerte gehören zu keinem bekannten Parameter und wurden nicht übernommen.', stat.lostParams);
  if (stat.stale) say('{0} verknüpfte Objekte sind nach der hiesigen Auswertung der Parameter unsichtbar — sie stehen als überzählig da.', stat.stale);
  if (stat.lostLinks) say('{0} Verknüpfungen zeigen auf keine vorhandene Gruppenadresse.', stat.lostLinks);
  if (stat.noAddr) say('{0} Geräte mit ungültiger physikalischer Adresse — neu vergeben.', stat.noAddr);
  if (tags(installation, 'Trade').length)
    say('Gewerke gibt es hier nicht — sie wurden nicht übernommen.');
  if (tags(installation, 'Security').some(s => attr(s, 'ToolKey') || attr(s, 'DeviceAuthenticationCode'))
      || tags(installation, 'GroupAddress').some(g => attr(g, 'Key')))
    say('KNX-Secure-Schlüssel wurden nicht übernommen.');

  return {
    schema: 3, name, isSample: false, gaStyle, seq: seq + 1,
    tree, areas, devices, groups, gaNames, functions, catalog
  };
}

return { read };
})();
