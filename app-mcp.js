/* ============================================================
   KNX-Struktur — KI-Zugang (MCP)
   ------------------------------------------------------------
   Eine KI-Sitzung (etwa Claude Code) spricht den lokalen Dienst
   über /mcp an. Der Dienst reicht jeden Aufruf an das Fenster
   weiter, das das Projekt zeigt — nur hier lebt das Datenmodell.
   Dieses Fenster rechnet das Ergebnis aus und schickt es zurück;
   der Dienst schneidet vor dem Hinausgehen alles ab, was das
   Werkzeug nicht ausdrücklich vorsieht, und setzt Platzhalter für
   Namen und Anschriften ein (server: mcp/Shape.java, mcp/Privacy.java).

   Geliefert wird deshalb nur, was ein Werkzeug braucht. Notizen,
   Seriennummern, Objektbeschreibungen und Secure-Angaben gehören
   nie dazu, IP-Daten nur über get_ip_config und nur nach Rückfrage.
   Ändern darf eine KI-Sitzung Gruppenadressen, Verknüpfungen,
   Gebäudestruktur und Funktionen — wie, entscheidet der Modus
   (siehe „Planen“ unten). Geräte, Parameter und Bus bleiben tabu.
   ============================================================ */
'use strict';

(() => {

const A = window.KNXApp, $ = s => document.querySelector(s);
const esc = A.esc, T18 = A.t;
const B = window.KNXBackend;

if (!B || !B.mcp) { window.KNXMcp = { available: false }; return; }

const MODES = [
  { key: 'off',     label: 'Aus',            desc: 'Keine KI-Sitzung erreicht dieses Projekt.' },
  { key: 'read',    label: 'Lesen',          desc: 'KI-Sitzungen dürfen das Projekt lesen — mit Platzhaltern für Namen und Anschriften, ohne Notizen.' },
  { key: 'propose', label: 'Vorschlag',      desc: 'Die KI sammelt Änderungen als Vorschläge; übernommen wird erst von Hand.' },
  { key: 'step',    label: 'Einzelschritte', desc: 'Jede Änderung der KI wartet auf Bestätigung.' },
  { key: 'auto',    label: 'Auto',           desc: 'Änderungen der KI gelten sofort, jede als eigener Rückgängig-Schritt.' }
];
const modeOf = k => MODES.find(m => m.key === k) || MODES[0];

/* Text aus dem Modell: Produktnamen sind teils zweisprachig ({de, en}). */
const S = v => (typeof v === 'string' ? v
  : v && typeof v === 'object' ? (A.L(v) || '') : v == null ? '' : String(v));

/* ============================================================
   Schalter in der Kopfleiste
   ============================================================ */

const btn = $('#btn-ai');
const st = { mode: 'off', handle: null, sessions: 0, busy: 0, available: MODES.map(m => m.key), last: null };

function paint() {
  const m = modeOf(st.mode);
  btn.hidden = false;
  btn.dataset.mode = st.mode;
  const open = proposals().length;
  btn.querySelector('.ai-label').textContent = open
    ? T18('KI: {0} · {1}', T18(m.label), open) : T18('KI: {0}', T18(m.label));
  btn.classList.toggle('busy', st.busy > 0);
  const badge = btn.querySelector('.btn-badge');
  badge.hidden = !st.sessions;
  badge.textContent = st.sessions;
  btn.title = T18('KI-Zugang für dieses Projekt: {0}', T18(m.label)) + ' — '
    + (st.sessions === 1 ? T18('1 KI-Sitzung verbunden') : T18('{0} KI-Sitzungen verbunden', st.sessions))
    + (open ? ' — ' + T18('{0} offene Vorschläge', open) : '');
}

function apply(s) {
  if (!s) return;
  st.mode = s.mode || 'off';
  st.handle = s.handle || null;
  st.sessions = Array.isArray(s.sessions) ? s.sessions.length : 0;
  st.busy = s.busy || 0;
  if (Array.isArray(s.available)) st.available = s.available;
  st.last = s;
  paint();
  if (dialogOpen()) paintDialog();
}

async function refresh() {
  try { apply(await B.mcp.status(B.projectId)); }
  catch (e) { /* Ein Dienst ohne KI-Zugang (ältere Version) — der Schalter bleibt aus */ }
}

async function setMode(mode) {
  if (mode === st.mode) return;
  try {
    apply(await B.mcp.mode(B.projectId, mode));
    A.toast(T18('KI-Zugang: {0}', T18(modeOf(st.mode).label)));
  } catch (e) {
    A.warn(T18('KI-Zugang nicht umschaltbar: {0}', e.message));
    refresh();
  }
}

btn.addEventListener('click', () => {
  const r = btn.getBoundingClientRect();
  A.openMenu(r.left, r.bottom + 4, [
    ...MODES.map(m => ({
      label: T18(m.label) + (m.key === st.mode ? '  ✓' : ''),
      icon: `<span class="ai-dot" data-mode="${m.key}"></span>`,
      hint: T18(m.desc),
      disabled: !st.available.includes(m.key),
      run: () => setMode(m.key)
    })),
    '-',
    proposals().length && { label: T18('Vorschläge ansehen ({0}) …', proposals().length), run: openProposals },
    window.KNXChat && KNXChat.available && { label: T18('KI-Chat öffnen'), run: () => KNXChat.open() },
    { label: T18('KI-Zugang einrichten …'), run: openDialog }
  ]);
});

B.events.on('mcp', ev => {
  if (!ev) return;
  if (typeof ev.sessions === 'number') st.sessions = ev.sessions;
  if (ev.project === B.projectId) {
    st.mode = ev.mode || 'off';
    st.handle = ev.handle || null;
    st.busy = ev.busy || 0;
  }
  paint();
  if (dialogOpen()) refreshDialogSoon();
});
// Nach einem Abriss der Ereignisleitung kann die Freigabe weggefallen sein
B.events.on('state', s => { if (s === 'offen') refresh(); });
window.KNXI18n.onChange(paint);

/* ============================================================
   Werkzeuge — hier ausgeführt, im Dienst gefiltert
   ============================================================ */

const P = () => KNX.project();
const progState = d => (window.KNXProg && KNXProg.available ? KNXProg.state(d) : null);
const due = d => { const s = progState(d); return s ? s.due : []; };
const paOf = d => (KNX.hasPa(d) ? KNX.paStr(d.addr) : null);
const gaAddr = id => { const g = KNX.gaById(id); return g ? KNX.addrStr(g) : null; };
const has = (q, ...parts) => !q || parts.some(x => S(x).toLowerCase().includes(q));
const lower = v => S(v).toLowerCase();

function page(list, a, def) {
  const offset = a.offset || 0, limit = a.limit || def;
  return { total: list.length, offset, items: list.slice(offset, offset + limit) };
}

function device(id) {
  const d = KNX.deviceById(id);
  if (!d) throw new Error('Gerät ' + id + ' gibt es in diesem Projekt nicht.');
  return d;
}

function needNode(id) {
  if (id && !KNX.findNode(id)) throw new Error('Knoten ' + id + ' gibt es in diesem Projekt nicht.');
}

function deviceRow(d) {
  return {
    id: d.id, name: S(d.name), product: S(d.product), pa: paOf(d), line: d.lineId, room: d.roomId || null,
    catalog: d.catalogId || null, objectCount: d.objs.length,
    linkedObjects: d.objs.filter(o => o.gas.length).length,
    pending: due(d), secure: !!d.secure, ip: KNX.deviceIsIp(d),
    busCurrent: KNX.deviceMa(d), supply: +d.supply || 0
  };
}

const KINDS = ['enum', 'num', 'text', 'time', 'date'];

function paramRow(item, d, r, group, ref) {
  const prm = item.params[ref];
  if (!prm) return null;
  const label = S(prm.t).trim();
  if (!label) return null;
  const type = item.types[prm.pt] || { k: 'text' };
  // IP-Angaben der Produktdatei gibt es nur über get_ip_config
  if (type.k === 'ip') return null;
  const fixed = Object.prototype.hasOwnProperty.call(r.assigned || {}, ref);
  const kind = type.k === 'none' ? 'head'
    : prm.ro && type.k === 'enum' && (type.v || []).length <= 1 ? 'note'
    : KINDS.includes(type.k) ? type.k : 'text';
  const row = { ref, group, label, kind, fixed, readOnly: !!prm.ro };
  if (kind === 'head' || kind === 'note') return row;
  row.value = fixed ? String(r.assigned[ref]) : KNX.paramValue(item, d.params, ref);
  if (type.k === 'enum') {
    const opts = type.v || [];
    const hit = opts.find(([v]) => String(v) === row.value);
    row.display = hit ? S(hit[1] || hit[0]) : '';
    if (opts.length <= 32) row.options = opts.map(([v, t]) => ({ value: String(v), label: S(t || v) }));
  }
  if (type.k === 'num') { row.min = String(type.min ?? ''); row.max = String(type.max ?? ''); }
  return row;
}

const TOOLS = {
  summary() {
    const p = P();
    return {
      name: S(p.name),
      buildings: (p.tree.children || []).filter(n => n.kind === 'building').map(n => S(n.name)).slice(0, 50),
      devices: p.devices.length, groups: p.groups.length,
      pendingDevices: p.devices.filter(d => due(d).length).length
    };
  },

  get_overview() {
    const p = P(), structure = [];
    (function walk(n, parent) {
      structure.push({ id: n.id, parent, kind: n.kind, name: S(n.name), devices: KNX.devicesInRoom(n.id).length });
      (n.children || []).forEach(c => walk(c, n.id));
    })(p.tree, null);
    const rangeKey = k => k.split('/').map(Number);
    return {
      name: S(p.name),
      gaStyle: p.gaStyle,
      counts: {
        rooms: KNX.rooms().length, devices: p.devices.length, groups: p.groups.length,
        functions: p.functions.length, pendingDevices: p.devices.filter(d => due(d).length).length,
        catalog: p.catalog.length
      },
      structure,
      topology: p.areas.map(a => ({
        id: a.id, addr: a.addr, name: S(a.name), backbone: !!a.backbone,
        lines: a.lines.map(l => ({
          id: l.id, addr: l.addr, name: S(l.name), medium: l.medium, devices: KNX.devicesOnLine(l.id).length,
          segments: KNX.segmentsOf(l).map(sg => ({
            id: sg.id, num: sg.num, name: S(sg.name), medium: sg.medium,
            devices: KNX.devicesInSegment(sg.id).length
          }))
        }))
      })),
      gaRanges: Object.keys(p.gaNames).filter(k => S(p.gaNames[k]))
        .sort((x, y) => { const a = rangeKey(x), b = rangeKey(y); return a[0] - b[0] || (a[1] ?? -1) - (b[1] ?? -1); })
        .map(k => ({ range: k, name: S(p.gaNames[k]) }))
    };
  },

  list_devices(a) {
    needNode(a.room);
    if (a.line && !KNX.lineById(a.line)) throw new Error('Linie ' + a.line + ' gibt es in diesem Projekt nicht.');
    const q = lower(a.query);
    const under = a.room ? new Set(KNX.roomIdsUnder(a.room)) : null;
    const list = P().devices.filter(d => (!a.line || d.lineId === a.line)
        && (!under || under.has(d.roomId))
        && (a.pending === undefined || (due(d).length > 0) === a.pending)
        && has(q, d.name, d.product, paOf(d)))
      .sort((x, y) => (x.addr ?? 1e9) - (y.addr ?? 1e9));
    const pg = page(list, a, 100);
    return { total: pg.total, offset: pg.offset, devices: pg.items.map(deviceRow) };
  },

  get_device(a) {
    const d = device(a.device);
    const item = d.catalogId ? KNX.catalogById(d.catalogId) : null;
    const r = item ? KNX.resolveProduct(item, d.params) : null;
    return {
      ...deviceRow(d),
      manufacturer: item ? S(item.manufacturer) : '',
      order: item ? S(item.order) : '',
      application: item ? S(item.appName) : '',
      mask: item ? S(item.mask) : '',
      objects: d.objs.slice().sort((x, y) => x.num - y.num).map(o => ({
        num: o.num, name: S(o.name), dpt: o.dpt || null,
        flags: { c: !!o.flags.c, r: !!o.flags.r, w: !!o.flags.w, t: !!o.flags.t, u: !!o.flags.u, i: !!o.flags.i },
        groups: o.gas.map(gaAddr).filter(Boolean),
        sendsTo: o.flags.t && o.gas.length ? gaAddr(o.gas[0]) : null
      })),
      parameterGroups: r ? r.groups
        .map(g => ({ group: g.label, parameters: g.params.filter(ref => paramRow(item, d, r, g.label, ref)).length }))
        .filter(g => g.parameters) : []
    };
  },

  get_parameters(a) {
    const d = device(a.device);
    const item = d.catalogId ? KNX.catalogById(d.catalogId) : null;
    if (!item) return { device: d.id, total: 0, offset: 0, parameters: [] };
    const r = KNX.resolveProduct(item, d.params);
    const q = lower(a.query), rows = [];
    r.groups.forEach(g => {
      if (a.group && g.label !== a.group) return;
      g.params.forEach(ref => {
        const row = paramRow(item, d, r, g.label, ref);
        if (row && has(q, row.group, row.label, row.value, row.display)) rows.push(row);
      });
    });
    const pg = page(rows, a, 100);
    return { device: d.id, total: pg.total, offset: pg.offset, parameters: pg.items };
  },

  list_group_addresses(a) {
    const q = lower(a.query);
    const list = P().groups.slice().sort((x, y) => x.raw - y.raw).filter(g => {
      const addr = KNX.addrStr(g);
      if (a.range && addr !== a.range && !addr.startsWith(a.range + '/')) return false;
      if (a.unused !== undefined && (KNX.gaLinks(g.id).length === 0) !== a.unused) return false;
      return has(q, g.name, addr);
    });
    const pg = page(list, a, 200);
    return {
      total: pg.total, offset: pg.offset,
      groups: pg.items.map(g => {
        const links = KNX.gaLinks(g.id);
        return {
          id: g.id, addr: KNX.addrStr(g), name: S(g.name), dpt: g.dpt || null,
          objects: links.length, senders: links.filter(l => l.sending).length,
          rooms: KNX.gaRooms(g.id).map(n => n.id).slice(0, 64), secure: !!g.secure
        };
      })
    };
  },

  list_functions(a) {
    needNode(a.room);
    return {
      functions: P().functions.filter(f => !a.room || A.inSubtree(f.nodeId, a.room)).map(f => ({
        id: f.id, room: f.nodeId, type: f.type, name: S(f.name),
        groups: (f.gas || []).map(x => ({ ga: gaAddr(x.ga), role: x.role || 'none' })).filter(x => x.ga)
      }))
    };
  },

  check_project(a) {
    const rank = { info: 0, warn: 1, error: 2 }, min = rank[a.level || 'info'];
    return {
      issues: KNX.issues().filter(i => rank[i.level] >= min)
        .map(i => ({ level: i.level, kind: i.kind, ref: i.id || null, text: String(i.msg) }))
    };
  },

  list_catalog(a) {
    const p = P(), q = lower(a.query), used = new Map();
    p.devices.forEach(d => { if (d.catalogId) used.set(d.catalogId, (used.get(d.catalogId) || 0) + 1); });
    const list = p.catalog.filter(c => has(q, c.name, c.manufacturer, c.order, c.appName));
    return {
      total: list.length,
      products: list.slice(0, a.limit || 50).map(c => ({
        id: c.id, name: S(c.name), manufacturer: S(c.manufacturer), order: S(c.order), application: S(c.appName),
        ...(c.medium ? { medium: c.medium } : {}),
        objects: Object.keys(c.objs || {}).length, parameters: Object.keys(c.params || {}).length,
        secure: !!c.secure, ip: !!c.ip, coupler: !!c.coupler, powerSupply: !!c.powerSupply,
        usedBy: used.get(c.id) || 0
      }))
    };
  },

  /* Handbücher liegen beim Dienst, für alle Projekte gemeinsam. Zugeordnet sind
     sie Produkten über Hersteller und Bestellnummer — hier werden daraus die
     Katalogeinträge dieses Projekts. */
  async list_manuals(a) {
    const MN = window.KNXManuals;
    if (!MN || !MN.available) throw new Error('Handbücher gibt es nur mit dem lokalen Dienst.');
    const all = await MN.load(), q = lower(a.query), p = P();
    const byKey = new Map(p.catalog.map(c => [MN.productKey(MN.asProduct(c)), c]));
    const rows = all.map(m => {
      const products = [], otherProducts = [];
      (m.products || []).forEach(x => {
        const c = byKey.get(MN.productKey(x));
        if (c) products.push(c.id);
        else otherProducts.push([x.manufacturer, x.name, x.order].filter(Boolean).join(' · '));
      });
      return { m, products, otherProducts };
    }).filter(r => has(q, r.m.title, ...(r.m.products || []).flatMap(x => [x.name, x.order, x.manufacturer])));
    rows.sort((x, y) => (y.products.length > 0) - (x.products.length > 0));
    return {
      total: rows.length,
      manuals: rows.slice(0, a.limit || 50).map(r => ({
        file: r.m.file, title: S(r.m.title), pages: r.m.pages ?? null,
        products: r.products, otherProducts: r.otherProducts
      }))
    };
  },

  list_function_types() {
    return {
      types: KNX.FN_TYPES.map(t => ({
        type: t.key, name: t.de, category: t.cat,
        roles: t.roles.map(r => ({ role: r.key, name: r.de, dpt: r.dpt }))
      }))
    };
  },

  get_change_status(a, ev) {
    const mine = changes.filter(c => c.session === ev.session);
    if (a.change && !mine.some(c => c.id === a.change))
      throw new Error('Änderung ' + a.change + ' gibt es in diesem Fenster nicht — vielleicht wurde es neu geladen.');
    return { changes: mine.filter(c => !a.change || c.id === a.change).slice(-100).map(changeResult) };
  },

  async get_ip_config(a, ev) {
    if (!await ask(ev, 'ip')) throw new Error('Der Nutzer hat das Lesen der IP-Konfiguration abgelehnt.');
    const p = P(), bb = KNX.backbone();
    const ip = v => (KNX.isIpV4(v) ? v : null);
    return {
      backbone: { medium: bb ? bb.line.medium : 'tp', multicast: bb ? ip(bb.line.mcast) : null },
      devices: p.devices.filter(KNX.deviceIsIp).map(d => {
        const c = KNX.ipConfig(d), item = d.catalogId ? KNX.catalogById(d.catalogId) : null;
        const params = [];
        if (item) {
          const r = KNX.resolveProduct(item, d.params);
          r.groups.forEach(g => g.params.forEach(ref => {
            const prm = item.params[ref], type = prm && item.types[prm.pt];
            if (type && type.k === 'ip' && S(prm.t).trim())
              params.push({ label: S(prm.t).trim(), value: ip(KNX.paramValue(item, r.values, ref)) });
          }));
        }
        const manual = c.mode === 'manual';
        return {
          id: d.id, name: S(d.name), pa: paOf(d), mode: c.mode,
          address: manual ? ip(c.addr) : null, mask: manual ? ip(c.mask) : null, gateway: manual ? ip(c.gw) : null,
          tunnels: c.tunnels, tunnelAddresses: KNX.tunnelAddrs(d).map(KNX.paStr), parameters: params.slice(0, 32)
        };
      })
    };
  }
};

/* Was nie hinausgeht, auch nicht als Teil eines längeren Textes: Der Dienst
   ersetzt es durch Platzhalter. Projekt- und Liegenschaftsname zerlegt er
   selbst in Wörter („Familie Müller“ → auch „Müller“ allein). */
function names() {
  const p = P();
  return [S(p.name), S(p.tree && p.tree.name)].filter(Boolean);
}
function terms(tool, list) {
  const p = P();
  const out = (list || (p.privacy && p.privacy.terms) || []).slice();
  // Die Prüfung nennt Objekte mit ihrer Beschreibung — die ist Sache des Nutzers
  if (tool === 'check_project') p.devices.forEach(d => d.objs.forEach(o => { if (o.desc) out.push(o.desc); }));
  return out.slice(0, 2000);
}

async function run(ev) {
  if (!ev || typeof ev.call !== 'string') return;
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const fn = own(TOOLS, ev.tool) ? TOOLS[ev.tool] : null;
  const body = { call: ev.call, names: names(), terms: terms(ev.tool) };
  try {
    if (own(PLANNERS, ev.tool)) body.data = await runChange(ev);
    else if (fn) body.data = await fn(ev.args || {}, ev);
    else throw new Error('Dieses Fenster kennt das Werkzeug ' + ev.tool + ' nicht — bitte neu laden.');
    body.ok = true;
  } catch (e) {
    body.ok = false;
    body.error = String((e && e.message) || e);
  }
  try { await B.mcp.result(body); } catch (e) { console.warn('KI-Ergebnis nicht zustellbar:', e.message); }
}

B.events.on('mcp-call', run);

/* ============================================================
   Planen (Stufe 2): Änderungen der KI
   ------------------------------------------------------------
   Jedes schreibende Werkzeug wird zuerst geplant: geprüft und in
   Zeilen beschrieben, ohne etwas zu ändern. Angewendet wird je
   nach Modus sofort (Auto), nach einer Bestätigung (Einzelschritte)
   oder aus der Vorschlagsliste (Vorschlag) — dann mit frischem
   Plan, denn das Projekt kann sich inzwischen geändert haben.
   Entfernen wartet immer auf ein Ja. Ein Aufruf ist ein
   Rückgängig-Schritt. Die Änderungen leben nur in diesem Fenster.
   ============================================================ */

const DECIDE_MS = 45000;      // so lange wartet ein Aufruf auf die Entscheidung
const CHANGES_MAX = 200;
const changes = [];
let changeSeq = 0;

const q = s => '„' + S(s) + '“';
const kindName = k => T18(KNX.kindDe(k));

function cleanName(v, what) {
  const t = String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!t) throw new Error(what + ': Name fehlt.');
  return t;
}

const gaParts = text => String(text).split('/').map(x => (/^\d+$/.test(x) ? +x : NaN));

/* Vollständige Adresse in der Darstellung des Projekts → Rohwert. */
function gaRaw(text) {
  const style = KNX.gaStyle(), parts = gaParts(text);
  if (parts.length !== style.parts.length || parts.some((v, i) => !(v >= 0 && v <= style.parts[i].max)))
    throw new Error('Adresse ' + text + ' passt nicht zur Darstellung des Projekts ('
      + style.parts.map(p => '0–' + p.max).join('/') + ').');
  const raw = KNX.gaJoin(parts, style);
  if (!raw) throw new Error('0/0/0 ist als Broadcast reserviert.');
  return raw;
}

/* Haupt- oder Mittelgruppe → ihre Stellen. */
function rangeOf(text) {
  const style = KNX.gaStyle(), depth = style.parts.length - 1, parts = gaParts(text);
  if (depth < 1) throw new Error('Bei freier Adressierung gibt es keine Haupt- und Mittelgruppen.');
  if (parts.length < 1 || parts.length > depth || parts.some((v, i) => !(v >= 0 && v <= style.parts[i].max)))
    throw new Error(text + ' ist keine Haupt- oder Mittelgruppe dieses Projekts.');
  return parts;
}

/* Nächste freie Adresse unter `prefix` — wie beim Anlegen von Hand ohne Untergruppe 0. */
function nextFree(prefix, taken) {
  const style = KNX.gaStyle(), rest = style.parts.slice(prefix.length);
  const lo = KNX.gaJoin([...prefix, ...rest.map(() => 0)], style);
  const hi = KNX.gaJoin([...prefix, ...rest.map(p => p.max)], style);
  const last = style.parts.length - 1;
  for (let raw = Math.max(lo, 1); raw <= hi; raw++) {
    if (!taken.has(raw) && KNX.gaSplit(raw, style)[last] !== 0) return raw;
  }
  return 0;
}

function dptOf(x) {
  const d = KNX.dptById(x);
  const ok = String(x).includes('.') ? d.id === String(x) : d.id.startsWith(x + '.');
  if (!ok) throw new Error('Datenpunkttyp ' + x + ' ist unbekannt.');
  return d.id;
}

function groupsByRaw() {
  const map = new Map(P().groups.map(g => [g.raw, g]));
  return text => {
    const g = map.get(gaRaw(text));
    if (!g) throw new Error('Gruppenadresse ' + text + ' gibt es nicht.');
    return g;
  };
}

/* Gerät in einer Plan-Zeile: Adresse und gekürzter Name — Produktnamen sind oft
   eine halbe Zeile lang, und die Adresse macht das Gerät ohnehin eindeutig. */
const devLine = d => {
  const n = S(d.name);
  return `${KNX.paStr(d.addr)} ${q(n.length > 32 ? n.slice(0, 31) + '…' : n)}`;
};
/* Name des Objekts ohne Beschreibung des Nutzers — die geht nie hinaus. */
const objLine = (d, o) => `${devLine(d)} ` + T18('Objekt {0} {1}', o.num, q(o.name));

const newOut = warnings => ({ created: [], changed: [], removed: [], warnings });

/* Was ein Aufruf neu anlegt, ist über seine Schlüssel erreichbar — auch aus
   den anderen Teilen von change_project. Knoten bekommen ihre Kennung erst
   beim Anwenden, Adressen werden dann über ihren geplanten Rohwert gefunden. */
const newCtx = () => ({ nodes: new Map(), groups: new Map(), taken: null, objs: new Map() });

/* Ein Objekt für Verknüpfungen und Flags. Ändert derselbe Aufruf die Parameter
   des Geräts, steht die neue Objektliste schon fest (ctx.objs) — dann gilt sie.
   Angewendet wird auf das Objekt, das beim Anwenden diese Nummer trägt: Das
   Neuableiten nach einer Parameteränderung ersetzt die Objekte. */
function objRef(devId, num, ctx) {
  const d = KNX.deviceById(devId);
  if (!d) throw new Error('Gerät ' + devId + ' gibt es nicht.');
  const live = () => d.objs.find(x => x.num === num && !x.stale);
  const o = live();
  const planned = ctx.objs.get(d.id);
  let view = o;
  if (planned) {
    const src = planned.get(num);
    if (!src) throw new Error('Gerät ' + devId + ' hat nach der Parameteränderung kein Objekt ' + num + '.');
    if (!o || o.ref !== src.ref) {
      const f = String(src.f || '');
      view = { num, name: S(src.name) || 'Objekt ' + num, dpt: KNX.dptById(src.dpt).id, gas: [],
               flags: { c: f.includes('c'), r: f.includes('r'), w: f.includes('w'), t: f.includes('t'), u: f.includes('u'), i: !!src.ri } };
    }
  } else if (!o) {
    throw new Error('Gerät ' + devId + ' hat kein Objekt ' + num + '.');
  }
  return {
    d, o: view,
    get: () => {
      const x = live();
      if (!x) throw new Error('Gerät ' + devId + ' hat kein Objekt ' + num + '.');
      return x;
    }
  };
}

/* Wert für einen Parameter: so, wie ihn die Produktdatei erlaubt. Bei einer
   Auswahl darf die KI auch den angezeigten Text nennen. */
function paramInput(type, raw, name) {
  const v = String(raw).trim();
  switch (type.k) {
    case 'enum': {
      const opts = type.v || [];
      let hit = opts.find(([x]) => String(x) === v);
      if (!hit) {
        const byLabel = opts.filter(([, t]) => S(t).trim().toLowerCase() === v.toLowerCase());
        if (byLabel.length === 1) hit = byLabel[0];
      }
      if (!hit) throw new Error(`„${v}“ passt nicht zu ${name}; möglich: `
        + opts.slice(0, 16).map(([x, t]) => `${x} (${S(t)})`).join(', ') + (opts.length > 16 ? ' …' : ''));
      return String(hit[0]);
    }
    case 'num': {
      const n = Number(v.replace(',', '.'));
      if (!v || !Number.isFinite(n)) throw new Error(`${name} erwartet eine Zahl.`);
      if ((type.min != null && n < +type.min) || (type.max != null && n > +type.max))
        throw new Error(`${name}: erlaubt ist ${type.min} bis ${type.max}.`);
      return String(n);
    }
    case 'time':
      if (!/^\d{1,2}:\d{2}(:\d{2})?$/.test(v)) throw new Error(`${name} erwartet eine Uhrzeit wie 07:30.`);
      return v;
    case 'date':
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`${name} erwartet ein Datum wie 2026-10-21.`);
      return v;
    default: {
      const max = type.max || 80;
      if (v.length > max) throw new Error(`${name}: höchstens ${max} Zeichen.`);
      return v;
    }
  }
}
const paramShow = (type, v) => {
  if (type.k !== 'enum') return v === '' ? '—' : v;
  const hit = (type.v || []).find(([x]) => String(x) === String(v));
  return hit ? S(hit[1] || hit[0]) : String(v);
};

const nodeRef = (ref, ctx) => ctx.nodes.get(ref) || KNX.findNode(ref);

function groupRef(ref, ctx, byRaw) {
  const pl = ctx.groups.get(ref);
  if (pl) return {
    planned: true, id: null, addr: KNX.gaStr(pl.raw), name: pl.name, dpt: pl.dpt,
    get: () => {
      const g = P().groups.find(x => x.raw === pl.raw);
      if (!g) throw new Error('Adresse ' + ref + ' wurde nicht angelegt.');
      return g;
    }
  };
  if (/^[A-Za-z]/.test(String(ref))) throw new Error('Schlüssel ' + ref + ' wird in diesem Aufruf nicht angelegt.');
  const g = byRaw(ref);
  return { planned: false, id: g.id, addr: KNX.addrStr(g), name: g.name, dpt: g.dpt, get: () => g };
}

const PLANNERS = {
  change_group_addresses(a, ctx = newCtx()) {
    const p = P(), taken = ctx.taken || (ctx.taken = new Set(p.groups.map(g => g.raw)));
    const lines = [], ops = [], warnings = [], out = newOut(warnings), del = new Set();

    (a.delete || []).forEach(id => {
      const g = KNX.gaById(id);
      if (!g) throw new Error('Gruppenadresse ' + id + ' gibt es nicht.');
      if (del.has(id)) return;
      del.add(id);
      taken.delete(g.raw);
      const links = KNX.gaLinks(id).length, fns = KNX.functionsOfGa(id).length;
      lines.push({ remove: true, text: T18('Löschen {0} {1}', KNX.addrStr(g), q(g.name))
        + (links || fns ? ' — ' + T18('{0} Verknüpfungen und {1} Funktionen verlieren sie', links, fns) : '') });
      ops.push(() => { const addr = KNX.addrStr(g); if (KNX.deleteGa(id)) out.removed.push(addr); });
    });

    (a.update || []).forEach(u => {
      const g = KNX.gaById(u.id);
      if (!g || del.has(u.id)) throw new Error('Gruppenadresse ' + u.id + ' gibt es nicht (mehr).');
      if (u.addr && u.range) throw new Error(u.id + ': entweder addr oder range, nicht beides.');
      let raw = g.raw;
      if (u.addr) {
        raw = gaRaw(u.addr);
        if (raw !== g.raw && taken.has(raw)) throw new Error(u.addr + ' ist schon vergeben.');
      } else if (u.range) {
        taken.delete(g.raw);
        raw = nextFree(rangeOf(u.range), taken);
        if (!raw) throw new Error('In ' + u.range + ' ist keine Adresse mehr frei.');
      }
      taken.delete(g.raw);
      taken.add(raw);
      const name = u.name != null ? cleanName(u.name, u.id) : g.name;
      const dpt = u.dpt ? dptOf(u.dpt) : g.dpt;
      const what = [];
      if (name !== g.name) what.push(T18('Name {0} → {1}', q(g.name), q(name)));
      if (dpt !== g.dpt) what.push(T18('DPT {0} → {1}', g.dpt, dpt));
      if (raw !== g.raw) what.push(T18('Adresse {0} → {1}', KNX.addrStr(g), KNX.gaStr(raw)));
      if (!what.length) return;
      if (dpt !== g.dpt && KNX.gaLinks(g.id).some(l => l.obj.dpt !== dpt))
        warnings.push(T18('{0}: Objekte mit anderem DPT hängen daran.', KNX.gaStr(raw)));
      lines.push({ text: T18('Ändern {0}: {1}', KNX.addrStr(g), what.join(', ')) });
      ops.push(() => { Object.assign(g, { name, dpt, raw }); out.changed.push(KNX.gaStr(raw)); });
    });

    (a.ranges || []).forEach(r => {
      const key = rangeOf(r.range).join('/'), name = cleanName(r.name, r.range), old = S(p.gaNames[key]);
      if (old === name) return;
      lines.push({ text: old ? T18('Gruppe {0}: {1} → {2}', key, q(old), q(name)) : T18('Gruppe {0} heißt {1}', key, q(name)) });
      ops.push(() => { p.gaNames[key] = name; out.changed.push(key); });
    });

    (a.create || []).forEach((c, i) => {
      if (c.addr && c.range) throw new Error('Neue Adresse ' + (i + 1) + ': entweder addr oder range, nicht beides.');
      const name = cleanName(c.name, 'Neue Adresse ' + (i + 1)), dpt = dptOf(c.dpt);
      let raw;
      if (c.addr) {
        raw = gaRaw(c.addr);
        if (taken.has(raw)) throw new Error(c.addr + ' ist schon vergeben.');
      } else {
        raw = nextFree(c.range ? rangeOf(c.range) : [], taken);
        if (!raw) throw new Error((c.range ? 'In ' + c.range : 'Im Projekt') + ' ist keine Adresse mehr frei.');
      }
      taken.add(raw);
      if (c.key) {
        if (ctx.groups.has(c.key)) throw new Error('Schlüssel ' + c.key + ' ist doppelt.');
        ctx.groups.set(c.key, { raw, name, dpt });
      }
      lines.push({ text: T18('Neu {0} {1} ({2})', KNX.gaStr(raw), q(name), dpt) });
      ops.push(() => {
        const g = KNX.addGa({ id: KNX.uid('g'), raw, name, dpt, note: '' });
        out.created.push({ key: c.key || null, type: 'group', id: g.id, addr: KNX.addrStr(g), name });
      });
    });
    return { lines, warnings, removes: del.size > 0, apply: () => { ops.forEach(f => f()); return out; } };
  },

  change_links(a, ctx = newCtx()) {
    const ga = groupsByRaw();
    const lines = [], ops = [], warnings = [], out = newOut(warnings);
    let removes = false;

    (a.unlink || []).forEach(x => {
      const { d, o, get } = objRef(x.device, x.object, ctx), g = groupRef(x.ga, ctx, ga);
      if (g.planned || !o.gas.includes(g.id)) { warnings.push(T18('{0} ist nicht mit {1} verknüpft.', objLine(d, o), g.addr)); return; }
      removes = true;
      lines.push({ remove: true, text: T18('Lösen {0} von {1} {2}', objLine(d, o), g.addr, q(g.name)) });
      ops.push(() => { const oo = get(); oo.gas = oo.gas.filter(id => id !== g.id); out.removed.push(`${d.id}#${o.num}→${g.addr}`); });
    });

    (a.link || []).forEach(x => {
      const { d, o, get } = objRef(x.device, x.object, ctx), g = groupRef(x.ga, ctx, ga);
      const has = !g.planned && o.gas.includes(g.id);
      if (has && (!x.send || o.gas[0] === g.id)) {
        warnings.push(T18('{0} ist schon mit {1} verknüpft.', objLine(d, o), g.addr));
        return;
      }
      if (o.dpt !== g.dpt)
        warnings.push(T18('DPT weicht ab: {0} hat {1}, {2} hat {3}.', objLine(d, o), o.dpt, g.addr, g.dpt));
      lines.push({ text: T18('Verknüpfen {0} mit {1} {2}', objLine(d, o), g.addr, q(g.name))
        + (x.send ? ' (' + T18('sendend') + ')' : '') });
      ops.push(() => {
        const id = g.get().id, oo = get();
        if (x.send) { oo.gas = [id, ...oo.gas.filter(y => y !== id)]; oo.flags.t = true; }
        else if (!oo.gas.includes(id)) oo.gas.push(id);
        out.changed.push(`${d.id}#${o.num}→${g.addr}`);
      });
    });

    (a.flags || []).forEach(x => {
      const { d, o, get } = objRef(x.device, x.object, ctx), set = {};
      KNX.KO_FLAGS.forEach(f => { if (typeof x[f.key] === 'boolean' && !!o.flags[f.key] !== x[f.key]) set[f.key] = x[f.key]; });
      if (!Object.keys(set).length) return;
      lines.push({ text: T18('Flags {0}: {1} → {2}', objLine(d, o), KNX.flagStr(o.flags), KNX.flagStr({ ...o.flags, ...set })) });
      ops.push(() => { Object.assign(get().flags, set); out.changed.push(`${d.id}#${o.num}`); });
    });
    return { lines, warnings, removes, apply: () => { ops.forEach(f => f()); return out; } };
  },

  /* Parameter wie im Parameterdialog: nur sichtbare, nicht zugewiesene, nicht
     gesperrte; danach wird die Objektliste neu abgeleitet. Wird immer bestätigt. */
  change_parameters(a, ctx = newCtx()) {
    const lines = [], ops = [], warnings = [], out = newOut(warnings);
    let removes = false;
    const byDev = new Map();
    (a.set || []).forEach(x => {
      if (!byDev.has(x.device)) byDev.set(x.device, []);
      byDev.get(x.device).push(x);
    });
    byDev.forEach((list, devId) => {
      const d = KNX.deviceById(devId);
      if (!d) throw new Error('Gerät ' + devId + ' gibt es nicht.');
      const item = d.catalogId ? KNX.catalogById(d.catalogId) : null;
      if (!item) throw new Error(`${KNX.paStr(d.addr)} ${S(d.name)} hat keine Produktdaten — Parameter gibt es nur mit Produkt.`);
      const draft = { ...(d.params || {}) };
      const dev = devLine(d);
      let changed = 0;
      list.forEach(x => {
        // Nach jeder Änderung neu: Eine Auswahl kann weitere Parameter sichtbar machen
        const r = KNX.resolveProduct(item, draft);
        const grp = r.groups.find(g => g.params.includes(x.ref));
        const prm = item.params[x.ref];
        if (!prm || !grp) throw new Error(`Parameter ${x.ref} ist bei ${devId} unbekannt oder gerade nicht sichtbar.`);
        const type = item.types[prm.pt] || { k: 'text' };
        const name = S(prm.t).trim();
        if (!name || type.k === 'none') throw new Error(`${x.ref} ist kein einstellbarer Parameter.`);
        if (type.k === 'ip') throw new Error(`${name} ist eine IP-Einstellung — die vergibt der Nutzer in SB-Projekt.`);
        if (Object.prototype.hasOwnProperty.call(r.assigned || {}, x.ref)) throw new Error(`${name} wird von der Produktdatei fest zugewiesen.`);
        if (prm.ro) throw new Error(`${name} ist schreibgeschützt.`);
        const value = paramInput(type, x.value, name);
        const before = KNX.paramValue(item, draft, x.ref);
        if (before === value) return;
        lines.push({ text: `${dev} · ${grp.label} · ${name}: ${paramShow(type, before)} → ${paramShow(type, value)}` });
        draft[x.ref] = value;
        changed++;
      });
      if (!changed) return;
      // Welche Objekte die neue Einstellung zeigt — dieselbe Rechnung, die applyProduct gleich anwendet
      const m = KNX.productObjects(d, item, draft);
      m.orphans.filter(o => !o.stale).forEach(o => {
        removes = true;
        lines.push({ remove: true, text: T18('{0} entfällt — bleibt mit {1} Adressen als überzählig stehen', objLine(d, o), o.gas.length) });
      });
      m.dropped.filter(o => !o.stale).forEach(o => lines.push({ text: T18('{0} entfällt', objLine(d, o)) }));
      m.plan.forEach(x => {
        if (x.from && !x.from.stale)
          lines.push({ text: T18('{0} wird neu abgeleitet — die Adressen gehen mit', objLine(d, x.from)) });
        else if (!x.old && !x.from)
          lines.push({ text: T18('Neu: {0} Objekt {1} {2} ({3})', dev, x.src.num, q(x.src.name), KNX.dptById(x.src.dpt).id) });
      });
      ctx.objs.set(d.id, new Map(m.plan.map(x => [x.src.num, { ...x.src, ref: x.ref }])));
      ops.push(() => {
        d.params = draft;
        KNX.applyProduct(d);
        KNX.touch();
        out.changed.push(d.id);
      });
    });
    return { lines, warnings, removes, confirm: lines.length > 0, apply: () => { ops.forEach(f => f()); return out; } };
  },

  change_structure(a, ctx = newCtx()) {
    const p = P(), planned = ctx.nodes, dels = new Set(a.delete || []);
    const lines = [], ops = [], warnings = [], out = newOut(warnings);
    dels.forEach(id => {
      const n = KNX.findNode(id);
      if (!n) throw new Error('Knoten ' + id + ' gibt es nicht.');
      if (n.id === p.tree.id) throw new Error('Die Liegenschaft lässt sich nicht löschen.');
    });
    const doomed = id => [...dels].some(x => KNX.isInside(id, x));

    (a.create || []).forEach((c, i) => {
      const pre = planned.get(c.parent), parent = pre || KNX.findNode(c.parent);
      if (!parent) throw new Error('Übergeordneter Knoten ' + c.parent + ' gibt es nicht.');
      if (!pre && doomed(parent.id)) throw new Error(q(parent.name) + ' wird im selben Aufruf gelöscht.');
      if (!KNX.kindHolds(parent.kind).includes(c.kind))
        throw new Error(KNX.kindDe(parent.kind) + ' ' + q(parent.name) + ' kann kein ' + KNX.kindDe(c.kind) + ' enthalten.');
      const name = cleanName(c.name, 'Neuer Knoten ' + (i + 1));
      const node = { id: '', kind: c.kind, name, note: '', children: [] };
      if (c.key) {
        if (planned.has(c.key)) throw new Error('Schlüssel ' + c.key + ' ist doppelt.');
        planned.set(c.key, node);
      }
      lines.push({ text: T18('Neu {0} {1} in {2}', kindName(c.kind), q(name), q(parent.name)) });
      ops.push(() => {
        node.id = KNX.uid('n');
        parent.children.push(node);
        KNX.touch();
        out.created.push({ key: c.key || null, type: 'node', id: node.id, addr: null, name });
      });
    });

    (a.update || []).forEach(u => {
      const n = KNX.findNode(u.id);
      if (!n || doomed(u.id)) throw new Error('Knoten ' + u.id + ' gibt es nicht (mehr).');
      const root = n.id === p.tree.id, what = [];
      const name = u.name != null ? cleanName(u.name, u.id) : n.name;
      let kind = n.kind, to = null;
      if (u.kind && u.kind !== n.kind) {
        if (root) throw new Error('Die Liegenschaft bleibt Liegenschaft.');
        const parent = KNX.parentOf(n.id), holds = KNX.kindHolds(u.kind);
        if (!KNX.kindHolds(parent.kind).includes(u.kind))
          throw new Error(KNX.kindDe(parent.kind) + ' ' + q(parent.name) + ' kann kein ' + KNX.kindDe(u.kind) + ' enthalten.');
        if ((n.children || []).some(c => !holds.includes(c.kind)))
          throw new Error(q(n.name) + ' enthält Teile, die ein ' + KNX.kindDe(u.kind) + ' nicht enthalten kann.');
        kind = u.kind;
      }
      if (u.parent && (KNX.parentOf(n.id) || {}).id !== u.parent) {
        to = nodeRef(u.parent, ctx);
        if (root || !to) throw new Error('Knoten ' + u.id + ' lässt sich nicht nach ' + u.parent + ' verschieben.');
        if (to.id && KNX.isInside(to.id, n.id)) throw new Error(q(n.name) + ' kann nicht in sich selbst liegen.');
        if (!KNX.kindHolds(to.kind).includes(kind))
          throw new Error(KNX.kindDe(to.kind) + ' ' + q(to.name) + ' kann kein ' + KNX.kindDe(kind) + ' enthalten.');
      }
      if (name !== n.name) what.push(T18('Name {0} → {1}', q(n.name), q(name)));
      if (kind !== n.kind) what.push(T18('Typ {0} → {1}', kindName(n.kind), kindName(kind)));
      if (to) what.push(T18('nach {0}', q(to.name)));
      if (!what.length) return;
      lines.push({ text: T18('Ändern {0} {1}: {2}', kindName(n.kind), q(n.name), what.join(', ')) });
      ops.push(() => {
        n.name = name;
        n.kind = kind;
        KNX.touch();
        if (to) KNX.moveNode(n.id, to.id);
        out.changed.push(n.id);
      });
    });

    dels.forEach(id => {
      const n = KNX.findNode(id);
      const rooms = new Set(KNX.roomIdsUnder(id));
      const devs = p.devices.filter(d => rooms.has(d.roomId)).length, fns = KNX.functionsUnder(id).length;
      lines.push({ remove: true, text: T18('Löschen {0} {1} samt Inhalt', kindName(n.kind), q(n.name))
        + (devs || fns ? ' — ' + T18('{0} Geräte verlieren ihren Raum, {1} Funktionen entfallen', devs, fns) : '') });
      ops.push(() => { if (KNX.deleteNode(id)) out.removed.push(id); });
    });
    return { lines, warnings, removes: dels.size > 0, apply: () => { ops.forEach(f => f()); return out; } };
  },

  change_functions(a, ctx = newCtx()) {
    const ga = groupsByRaw();
    const lines = [], ops = [], warnings = [], out = newOut(warnings);
    let removes = false;
    const typeOf = k => {
      const t = KNX.FN_TYPES.find(x => x.key === k);
      if (!t) throw new Error('Funktionsart ' + k + ' gibt es nicht — siehe list_function_types.');
      return t;
    };
    const roleOf = (t, r) => {
      if (r && !t.roles.some(x => x.key === r)) throw new Error('Rolle ' + r + ' gibt es bei ' + t.key + ' nicht.');
      return r || '';
    };
    const roleName = (t, r) => T18((t.roles.find(x => x.key === r) || { de: r }).de);

    (a.create || []).forEach((c, i) => {
      const node = nodeRef(c.node, ctx);
      if (!node) throw new Error('Knoten ' + c.node + ' gibt es nicht.');
      const t = typeOf(c.type), name = cleanName(c.name, 'Neue Funktion ' + (i + 1));
      const groups = (c.groups || []).map(x => ({ g: groupRef(x.ga, ctx, ga), role: roleOf(t, x.role) }));
      const held = new Set(groups.map(x => x.role).filter(Boolean));
      const roles = (c.roles || t.roles.map(r => r.key)).filter(r => { roleOf(t, r); return !held.has(r); });
      const make = c.createGroups !== false && roles.length > 0;
      // Für einen Knoten, der erst im selben Aufruf entsteht, steht der Ordner erst beim Anwenden fest
      const folder = make && node.id ? KNX.functionFolder(node.id, t.key) : null;
      lines.push({ text: T18('Neue Funktion {0} ({1}) in {2}', q(name), T18(t.de), q(node.name))
        + (make ? ' — ' + T18('Adressen für {0}', roles.map(r => roleName(t, r)).join(', '))
          + (folder ? ' ' + T18('in {0}', folder.label) : '') : '') });
      groups.forEach(x => lines.push({ text: T18('dazu {0} {1}', x.g.addr, q(x.g.name)) }));
      ops.push(() => {
        const before = new Set(P().groups.map(g => g.id));
        const fn = KNX.addFunction({ id: KNX.uid('f'), nodeId: node.id, type: t.key, name, icon: '', note: '',
                                     gas: groups.map(x => ({ ga: x.g.get().id, role: x.role })) });
        const missing = make ? KNX.createRoleGas(fn, roles, KNX.functionFolder(node.id, t.key)) : 0;
        out.created.push({ key: c.key || null, type: 'function', id: fn.id, addr: null, name });
        fn.gas.forEach(x => {
          const g = !before.has(x.ga) && KNX.gaById(x.ga);
          if (g) out.created.push({ key: null, type: 'group', id: g.id, addr: KNX.addrStr(g), name: g.name });
        });
        if (missing) warnings.push(T18('{0}: {1} Adressen fanden keinen Platz.', name, missing));
      });
    });

    (a.update || []).forEach(u => {
      const fn = KNX.functionById(u.id);
      if (!fn) throw new Error('Funktion ' + u.id + ' gibt es nicht.');
      const t = KNX.fnType(fn.type);
      const name = u.name != null ? cleanName(u.name, u.id) : fn.name;
      const node = u.node && u.node !== fn.nodeId ? nodeRef(u.node, ctx) : null;
      if (u.node && u.node !== fn.nodeId && !node) throw new Error('Knoten ' + u.node + ' gibt es nicht.');
      const attach = (u.attach || []).map(x => ({ g: groupRef(x.ga, ctx, ga), role: roleOf(t, x.role) }))
        .filter(x => x.g.planned || !fn.gas.some(y => y.ga === x.g.id));
      const detach = (u.detach || []).map(ref => groupRef(ref, ctx, ga))
        .filter(g => !g.planned && fn.gas.some(y => y.ga === g.id));
      const what = [];
      if (name !== fn.name) what.push(T18('Name {0} → {1}', q(fn.name), q(name)));
      if (node) what.push(T18('nach {0}', q(node.name)));
      attach.forEach(x => what.push(T18('dazu {0} {1}', x.g.addr, q(x.g.name))));
      if (what.length) lines.push({ text: T18('Ändern Funktion {0}: {1}', q(fn.name), what.join(', ')) });
      detach.forEach(g => lines.push({ remove: true, text: T18('Lösen Funktion {0} von {1} {2}', q(fn.name), g.addr, q(g.name)) }));
      if (detach.length) removes = true;
      if (!what.length && !detach.length) return;
      ops.push(() => {
        fn.name = name;
        if (node) KNX.moveFunction(fn.id, node.id);
        attach.forEach(x => {
          const id = x.g.get().id;
          if (fn.gas.some(y => y.ga === id)) return;
          if (x.role) fn.gas.push({ ga: id, role: x.role });
          else KNX.attachGas(fn.id, [id]);
        });
        detach.forEach(g => KNX.detachGa(fn.id, g.id));
        KNX.touch();
        out.changed.push(fn.id);
      });
    });

    (a.delete || []).forEach(x => {
      const fn = KNX.functionById(x.id);
      if (!fn) throw new Error('Funktion ' + x.id + ' gibt es nicht.');
      removes = true;
      lines.push({ remove: true, text: T18('Löschen Funktion {0}', q(fn.name))
        + (x.withGroups && fn.gas.length ? ' ' + T18('samt ihren Adressen ({0})', fn.gas.length) : '') });
      ops.push(() => { KNX.deleteFunction(fn.id, !!x.withGroups); out.removed.push(fn.id); });
    });
    return { lines, warnings, removes, apply: () => { ops.forEach(f => f()); return out; } };
  },

  /* Mehrere Teile in einem Aufruf: ein Vorschlag, eine Bestätigung, ein
     Rückgängig-Schritt. Die Reihenfolge erlaubt Verweise nach vorn —
     die Funktion in den neuen Raum, die Verknüpfung auf die neue Adresse. */
  /* Einspeisung und Busstrom — die Werte aus dem Geräteformular, keine Parameter. */
  change_devices(a) {
    const lines = [], ops = [], warnings = [], out = newOut(warnings);
    const mA = v => (v == null ? T18('automatisch') : v + ' mA');
    (a.set || []).forEach(x => {
      const d = device(x.device), dev = devLine(d), before = ops.length;
      if ('supply' in x && x.supply !== (+d.supply || 0)) {
        lines.push({ text: T18('{0} · Einspeisung: {1} → {2}', dev, (+d.supply || 0) + ' mA', x.supply + ' mA') });
        ops.push(() => { d.supply = x.supply; });
      }
      const ma = Number.isInteger(d.ma) ? d.ma : null;
      if ('busCurrent' in x && x.busCurrent !== ma) {
        lines.push({ text: T18('{0} · Busstrom: {1} → {2}', dev, mA(ma), mA(x.busCurrent)) });
        ops.push(() => { d.ma = x.busCurrent; });
      }
      if (ops.length > before) ops.push(() => { if (!out.changed.includes(d.id)) out.changed.push(d.id); });
    });
    return {
      lines, warnings, removes: false,
      apply: () => {
        ops.forEach(f => f());
        if (ops.length) KNX.touch();
        return out;
      }
    };
  },

  change_project(a) {
    const ctx = newCtx(), parts = [];
    if (a.structure) parts.push(PLANNERS.change_structure(a.structure, ctx));
    if (a.groups) parts.push(PLANNERS.change_group_addresses(a.groups, ctx));
    if (a.parameters) parts.push(PLANNERS.change_parameters(a.parameters, ctx));
    if (a.devices) parts.push(PLANNERS.change_devices(a.devices, ctx));
    if (a.functions) parts.push(PLANNERS.change_functions(a.functions, ctx));
    if (a.links) parts.push(PLANNERS.change_links(a.links, ctx));
    return {
      lines: parts.flatMap(x => x.lines),
      warnings: parts.flatMap(x => x.warnings),
      removes: parts.some(x => x.removes),
      confirm: parts.some(x => x.confirm),
      apply: () => {
        const out = newOut([]);
        parts.forEach(x => {
          const r = x.apply();
          out.created.push(...r.created);
          out.changed.push(...r.changed);
          out.removed.push(...r.removed);
          out.warnings.push(...r.warnings);
        });
        return out;
      }
    };
  }
};

/* Wendet eine Änderung an — mit frischem Plan, wenn sie gewartet hat. Scheitert
   etwas mittendrin, wird der Stand davor wiederhergestellt. */
function applyChange(ch, plan) {
  let before = null;
  try {
    plan = plan || PLANNERS[ch.tool](ch.args);
    ch.lines = plan.lines;
    before = JSON.stringify(KNX.project());
    const r = plan.apply();
    A.commit();
    ch.state = 'applied';
    ch.result = r;
    ch.message = `Übernommen: ${r.created.length} angelegt, ${r.changed.length} geändert, ${r.removed.length} entfernt.`;
    A.toast(T18('KI ({0}): {1} angelegt, {2} geändert, {3} entfernt',
      ch.session, r.created.length, r.changed.length, r.removed.length), 2500);
    return true;
  } catch (e) {
    if (before) {
      KNX.setProject(JSON.parse(before));
      if (window.KNXOnRender) window.KNXOnRender();
    }
    ch.state = 'failed';
    ch.message = 'Nicht übernommen: ' + ((e && e.message) || e);
    A.warn(T18('KI-Änderung {0} nicht übernommen: {1}', ch.id, (e && e.message) || e));
    return false;
  } finally {
    paint();
    paintProposals();
  }
}

function changeResult(ch) {
  const r = ch.result || {};
  return {
    change: ch.id, tool: ch.tool, state: ch.state, message: ch.message,
    lines: ch.lines.slice(0, 200).map(l => (l.remove ? '− ' : '') + l.text),
    created: (r.created || []).slice(0, 500), changed: (r.changed || []).slice(0, 1000),
    removed: (r.removed || []).slice(0, 1000), warnings: (r.warnings || ch.warnings || []).slice(0, 100)
  };
}

async function runChange(ev) {
  const plan = PLANNERS[ev.tool](ev.args || {});
  const ch = { id: 'c' + (++changeSeq), tool: ev.tool, args: ev.args || {}, session: ev.session, client: ev.client,
               at: Date.now(), lines: plan.lines, warnings: plan.warnings, removes: plan.removes, confirm: !!plan.confirm,
               state: 'pending', result: null, message: '' };
  changes.push(ch);
  // Alte Einträge fallen weg; offene bleiben
  while (changes.length > CHANGES_MAX && changes.some(c => c.state !== 'pending' && c.state !== 'proposed')) {
    changes.splice(changes.findIndex(c => c.state !== 'pending' && c.state !== 'proposed'), 1);
  }
  if (!plan.lines.length) {
    ch.state = 'applied';
    ch.result = newOut(plan.warnings);
    ch.message = 'Nichts zu ändern.';
  } else if (ev.mode === 'auto' && !plan.removes && !plan.confirm) {
    applyChange(ch, plan);
  } else if (ev.mode === 'propose') {
    ch.state = 'proposed';
    ch.message = 'Als Vorschlag abgelegt; der Nutzer übernimmt oder verwirft ihn im Fenster.';
    paint();
    paintProposals();
  } else if (ev.mode === 'step' || ev.mode === 'auto') {
    if (!(await confirmChange(ch)))
      ch.message = 'Wartet auf die Bestätigung im Fenster — später mit get_change_status nachsehen.';
  } else {
    throw new Error('Der KI-Zugang steht nicht auf einem Modus, der Änderungen erlaubt.');
  }
  return changeResult(ch);
}

/* ---------- Bestätigung (Einzelschritte, Entfernen) ---------- */

const confirmQueue = [];

/* true, wenn innerhalb der Wartezeit entschieden wurde. Die Frage bleibt
   danach stehen — entschieden wird, wann der Nutzer will. */
function confirmChange(ch) {
  ch.decision = new Promise(res => { ch.decided = res; });
  confirmQueue.push(ch);
  showConfirm();
  return Promise.race([ch.decision.then(() => true), new Promise(res => setTimeout(() => res(false), DECIDE_MS))]);
}

function showConfirm() {
  const open = document.querySelector('.mcp-change');
  if (open) { open.querySelector('.mcp-count').textContent = confirmQueue.length > 1 ? T18('1 von {0}', confirmQueue.length) : ''; return; }
  const ch = confirmQueue[0];
  if (!ch) return;
  const shown = ch.lines.slice(0, 30);
  const box = panel('mcp-ask mcp-change');
  box.innerHTML = `
    <b>${ch.confirm ? T18('KI-Sitzung {0} möchte Parameter ändern', esc(ch.session))
      : ch.removes ? T18('KI-Sitzung {0} möchte etwas entfernen', esc(ch.session))
      : T18('KI-Sitzung {0} möchte ändern', esc(ch.session))}
      <span class="mcp-count"></span></b>
    <ul class="mcp-lines">${shown.map(l => `<li${l.remove ? ' class="rm"' : ''}>${esc(l.text)}</li>`).join('')}
      ${ch.lines.length > shown.length ? `<li class="more">${T18('… und {0} weitere', ch.lines.length - shown.length)}</li>` : ''}</ul>
    ${(ch.warnings || []).length ? `<p class="hint warn">${ch.warnings.slice(0, 5).map(esc).join('<br>')}</p>` : ''}
    ${ch.confirm ? `<p class="hint">${T18('Parameteränderungen brauchen immer eine Bestätigung. Ins Gerät kommen sie erst beim Programmieren.')}`
        + (ch.removes ? ' ' + T18('Rot markierte Objekte mit Adressen entfallen.') : '') + '</p>'
      : ch.removes ? `<p class="hint">${T18('Entfernen braucht immer eine Bestätigung.')}</p>` : ''}
    <div class="mcp-ask-btns">
      <button class="btn btn-sm" data-a="no">${T18('Ablehnen')}</button>
      <button class="btn btn-sm btn-primary" data-a="yes">${T18('Übernehmen')}</button>
    </div>`;
  box.querySelector('.mcp-count').textContent = confirmQueue.length > 1 ? T18('1 von {0}', confirmQueue.length) : '';
  const title = document.title;
  document.title = '⚠ ' + T18('KI-Rückfrage') + ' — ' + title;
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    confirmQueue.shift();
    box.remove();
    document.title = title;
    if (b.dataset.a === 'yes') applyChange(ch);
    else { ch.state = 'rejected'; ch.message = 'Vom Nutzer abgelehnt.'; }
    ch.decided();
    showConfirm();
  });
  box.querySelector('[data-a="no"]').focus();
}

/* ---------- Vorschläge ---------- */

const proposals = () => changes.filter(c => c.state === 'proposed');

function openProposals() {
  A.openModal(T18('KI-Vorschläge'), '<div id="mcp-props" class="mcp-props"></div>', () => {});
  $('#modal-ok').textContent = T18('Schließen');
  $('#modal-cancel').hidden = true;
  paintProposals();
}

function paintProposals() {
  const box = $('#mcp-props');
  if (!box) return;
  const list = proposals();
  box.innerHTML = list.length ? `
    <p class="mcp-row">
      <button class="btn btn-sm btn-primary" data-all="yes">${T18('Alle übernehmen')}</button>
      <button class="btn btn-sm" data-all="no">${T18('Alle verwerfen')}</button>
    </p>
    ${list.map(ch => `
      <section class="mcp-prop">
        <div class="mcp-prop-head"><b>${esc(ch.id)}</b> · ${T18('Sitzung {0}', esc(ch.session))} · ${esc(fmtTime(ch.at))}</div>
        <ul class="mcp-lines">${ch.lines.slice(0, 50).map(l => `<li${l.remove ? ' class="rm"' : ''}>${esc(l.text)}</li>`).join('')}
          ${ch.lines.length > 50 ? `<li class="more">${T18('… und {0} weitere', ch.lines.length - 50)}</li>` : ''}</ul>
        ${(ch.warnings || []).length ? `<p class="hint warn">${ch.warnings.slice(0, 5).map(esc).join('<br>')}</p>` : ''}
        <p class="mcp-row">
          <button class="btn btn-sm btn-primary" data-yes="${esc(ch.id)}">${T18('Übernehmen')}</button>
          <button class="btn btn-sm" data-no="${esc(ch.id)}">${T18('Verwerfen')}</button>
        </p>
      </section>`).join('')}`
    : `<p class="hint">${T18('Keine offenen Vorschläge.')}</p>`;
  const byId = id => changes.find(c => c.id === id);
  const reject = ch => { ch.state = 'rejected'; ch.message = 'Vom Nutzer verworfen.'; };
  box.querySelectorAll('[data-yes]').forEach(b => { b.onclick = () => applyChange(byId(b.dataset.yes)); });
  box.querySelectorAll('[data-no]').forEach(b => { b.onclick = () => { reject(byId(b.dataset.no)); paint(); paintProposals(); }; });
  box.querySelectorAll('[data-all]').forEach(b => {
    b.onclick = () => {
      proposals().forEach(ch => (b.dataset.all === 'yes' ? applyChange(ch) : reject(ch)));
      paint();
      paintProposals();
    };
  });
}

/* Rückfragen und Bestätigungen stapeln sich rechts oben, über allem. */
function panel(cls) {
  let host = document.querySelector('.mcp-panels');
  if (!host) {
    host = document.createElement('div');
    host.className = 'mcp-panels';
    document.body.appendChild(host);
  }
  const box = document.createElement('div');
  box.className = cls;
  box.setAttribute('role', 'alertdialog');
  host.appendChild(box);
  return box;
}

/* ============================================================
   Rückfrage: IP-Konfiguration
   ============================================================ */

const ASK_MS = 120000;
const allowed = new Set();   // „Sitzung:Was“ — erlaubt bis zum Neuladen dieses Fensters
let askChain = Promise.resolve();

function ask(ev, what) {
  const key = ev.session + ':' + what;
  if (allowed.has(key)) return Promise.resolve(true);
  const p = askChain.then(() => (allowed.has(key) ? true : showAsk(ev, key)));
  askChain = p.catch(() => {});
  return p;
}

function showAsk(ev, key) {
  return new Promise(resolve => {
    const box = panel('mcp-ask');
    box.setAttribute('aria-labelledby', 'mcp-ask-t');
    box.innerHTML = `
      <b id="mcp-ask-t">${T18('KI möchte die IP-Konfiguration lesen')}</b>
      <p>${T18('Sitzung {0} ({1}) fragt nach der Multicast-Adresse des IP-Backbones und nach Adresse, Maske und Gateway der IP-Geräte. Diese Angaben gehen dann an den KI-Anbieter.',
        esc(ev.session), esc(ev.client))}</p>
      <div class="mcp-ask-btns">
        <button class="btn btn-sm" data-a="no">${T18('Ablehnen')}</button>
        <button class="btn btn-sm" data-a="session">${T18('Für diese Sitzung erlauben')}</button>
        <button class="btn btn-sm btn-primary" data-a="once">${T18('Einmal erlauben')}</button>
      </div>`;
    const title = document.title;
    document.title = '⚠ ' + T18('KI-Rückfrage') + ' — ' + title;
    const done = ok => {
      clearTimeout(timer);
      box.remove();
      document.title = title;
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), ASK_MS);
    box.addEventListener('click', e => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      if (b.dataset.a === 'session') allowed.add(key);
      done(b.dataset.a !== 'no');
    });
    box.querySelector('[data-a="no"]').focus();
  });
}

/* ============================================================
   Dialog: Freigabe, Datenschutz, Sitzungen, Einrichtung
   ============================================================ */

const dialogOpen = () => $('#modal-backdrop').classList.contains('open') && !!$('#mcp-dlg');

let dialogTimer = 0;
function refreshDialogSoon() {
  clearTimeout(dialogTimer);
  dialogTimer = setTimeout(refresh, 300);
}

function setupCommand(tokenFile) {
  const url = location.origin + '/mcp';
  const win = tokenFile.includes('\\');
  const read = win ? `$(Get-Content '${tokenFile}')` : `$(cat '${tokenFile}')`;
  return `claude mcp add --transport http --scope user sb-projekt ${url} --header "Authorization: Bearer ${read}"`;
}

/* Claude Desktop startet MCP-Server als Unterprozess. Der Starter reicht alles an
   diesen Dienst weiter; Port und Datenverzeichnis bekommt er ausdrücklich mit,
   damit er auch bei abweichenden Startoptionen den richtigen Dienst findet. */
function desktopConfig(starter) {
  const args = ['--port', location.port || '8420', '--data', B.info.dataDir];
  // Windows startet eine .cmd nur über die Shell
  const entry = /\.cmd$/i.test(starter)
    ? { command: 'cmd', args: ['/c', starter, ...args] }
    : { command: starter, args };
  return JSON.stringify({ mcpServers: { 'sb-projekt': entry } }, null, 2);
}

function desktopConfigFile(starter) {
  if (/\.cmd$/i.test(starter)) return '%APPDATA%\\Claude\\claude_desktop_config.json';
  if (/Mac/i.test(navigator.platform)) return '~/Library/Application Support/Claude/claude_desktop_config.json';
  return '~/.config/Claude/claude_desktop_config.json';
}

const fmtTime = ms => new Date(ms).toLocaleString(T18('de-DE'), { dateStyle: 'short', timeStyle: 'medium' });

function paintDialog() {
  const s = st.last;
  if (!s || !$('#mcp-dlg')) return;
  $('#mcp-dlg').querySelectorAll('input[name="mcp-mode"]').forEach(r => {
    r.checked = r.value === st.mode;
    r.disabled = !st.available.includes(r.value);
  });
  const sessions = s.sessions || [];
  $('#mcp-sessions').innerHTML = sessions.length
    ? `<table class="ga mini"><thead><tr><th>${T18('Sitzung')}</th><th>${T18('Programm')}</th><th>${T18('Seit')}</th><th class="num">${T18('Aufrufe')}</th></tr></thead><tbody>
        ${sessions.map(x => `<tr><td>${esc(x.label)}</td><td>${esc(x.client)}</td><td>${esc(fmtTime(x.since))}</td><td class="num">${esc(x.calls)}</td></tr>`).join('')}
      </tbody></table>`
    : `<p class="hint">${T18('Keine KI-Sitzung verbunden.')}</p>`;
  const recent = s.recent || [];
  $('#mcp-recent').innerHTML = recent.length
    ? `<table class="ga mini"><thead><tr><th>${T18('Zeit')}</th><th>${T18('Sitzung')}</th><th>${T18('Werkzeug')}</th><th>${T18('Ergebnis')}</th></tr></thead><tbody>
        ${recent.map(x => `<tr><td>${esc(fmtTime(x.at))}</td><td>${esc(x.session)}</td><td><code>${esc(x.tool)}</code></td>
          <td>${x.ok ? T18('ok') : esc(x.error || T18('Fehler'))}${x.dropped ? ' · ' + T18('{0} Felder zurückgehalten', x.dropped) : ''}</td></tr>`).join('')}
      </tbody></table>`
    : `<p class="hint">${T18('Für dieses Projekt noch keine Aufrufe.')}</p>`;
  if (s.tokenFile) $('#mcp-cmd').textContent = setupCommand(s.tokenFile);
}

function readTerms() {
  return $('#mcp-terms').value.split('\n').map(t => t.trim()).filter(Boolean);
}

async function preview() {
  const out = $('#mcp-preview');
  out.hidden = false;
  out.textContent = T18('Wird berechnet …');
  try {
    const list = KNX.normPrivacy({ terms: readTerms() }).terms;
    const r = await B.mcp.preview({
      project: B.projectId, tool: 'get_overview', data: TOOLS.get_overview({}),
      names: names(), terms: terms('get_overview', list)
    });
    out.textContent = JSON.stringify(r.result, null, 1);
  } catch (e) {
    out.textContent = T18('Vorschau nicht möglich: {0}', e.message);
  }
}

function openDialog() {
  const p = P();
  const current = (p.privacy && p.privacy.terms) || [];
  A.openModal(T18('KI-Zugang'), `
    <div id="mcp-dlg" class="mcp-dlg">
      <section>
        <h4>${T18('Freigabe für dieses Projekt')}</h4>
        <p class="hint">${T18('Gilt nur, solange dieses Fenster offen ist. Nach jedem Start des Dienstes ist der Zugang aus. Auf den Bus schreibt eine KI-Sitzung in keinem Modus — programmiert wird weiterhin über „Programmieren“.')}</p>
        <div class="mcp-modes">
          ${MODES.map(m => `
            <label class="mcp-mode">
              <input type="radio" name="mcp-mode" value="${m.key}">
              <span class="ai-dot" data-mode="${m.key}"></span>
              <span><b>${T18(m.label)}</b> — ${T18(m.desc)}</span>
            </label>`).join('')}
        </div>
      </section>
      <section>
        <h4>${T18('Datenschutz')}</h4>
        <p class="hint">${T18('Nie an den KI-Anbieter gehen: Notizen, Objektbeschreibungen, Seriennummern, KNX-Secure-Angaben, Einstellungen und Dateipfade. IP-Adressen nur nach Rückfrage. Projekt- und Liegenschaftsname, erkannte Anschriften, Telefonnummern und E-Mail-Adressen werden durch Platzhalter wie «Name1» ersetzt — die Zuordnung bleibt auf diesem Rechner.')}</p>
        <label class="field"><span>${T18('Weitere Begriffe, die nie hinausgehen — einer je Zeile (etwa Familienname, Vornamen in Raumnamen, Straße)')}</span>
          <textarea class="input" id="mcp-terms" rows="4" spellcheck="false">${esc(current.join('\n'))}</textarea>
        </label>
        <p><button class="btn btn-sm" id="mcp-preview-btn">${T18('Vorschau: Was die KI von der Projektübersicht sieht')}</button></p>
        <pre class="mcp-preview" id="mcp-preview" hidden></pre>
      </section>
      <section>
        <h4>${T18('Verbundene KI-Sitzungen')}</h4>
        <div id="mcp-sessions"></div>
        <h4>${T18('Letzte Aufrufe')}</h4>
        <div id="mcp-recent"></div>
      </section>
      <section>
        <h4>${T18('Einrichtung in Claude Code')}</h4>
        <p class="hint">${T18('Einmal im Terminal ausführen. Der Befehl liest den Zugangsschlüssel aus der Datei; über die Oberfläche geht er nie.')}</p>
        <pre class="mcp-cmd" id="mcp-cmd"></pre>
        <p class="mcp-row">
          <button class="btn btn-sm" data-copy="mcp-cmd">${T18('Befehl kopieren')}</button>
          <button class="btn btn-sm btn-danger" id="mcp-rotate">${T18('Schlüssel erneuern')}</button>
        </p>
      </section>
      ${B.info.mcpStarter ? `<section>
        <h4>${T18('Einrichtung in Claude Desktop')}</h4>
        <p class="hint">${T18('In {0} unter „mcpServers“ eintragen und Claude Desktop neu starten. Der Starter reicht alles an diesen Dienst weiter; läuft er nicht, melden die Werkzeuge das.',
          `<code>${esc(desktopConfigFile(B.info.mcpStarter))}</code>`)}</p>
        <pre class="mcp-cmd" id="mcp-desktop">${esc(desktopConfig(B.info.mcpStarter))}</pre>
        <p class="mcp-row"><button class="btn btn-sm" data-copy="mcp-desktop">${T18('Eintrag kopieren')}</button></p>
      </section>` : ''}
    </div>
  `, () => {
    const next = KNX.normPrivacy({ terms: readTerms() }).terms;
    const short = readTerms().filter(t => t.length < KNX.PRIVACY_TERM_MIN);
    if (JSON.stringify(next) !== JSON.stringify(current)) {
      P().privacy = { terms: next };
      A.commit();
    }
    if (short.length) A.warn(T18('Zu kurz und deshalb nicht übernommen: {0}', short.join(', ')));
  });
  $('#modal-ok').textContent = T18('Übernehmen');

  $('#mcp-dlg').querySelectorAll('input[name="mcp-mode"]').forEach(r =>
    r.addEventListener('change', () => { if (r.checked) setMode(r.value); }));
  $('#mcp-preview-btn').onclick = preview;
  $('#mcp-dlg').querySelectorAll('[data-copy]').forEach(b => {
    b.onclick = () => navigator.clipboard.writeText($('#' + b.dataset.copy).textContent)
      .then(() => A.toast(T18('Kopiert')))
      .catch(e => A.warn(T18('Kopieren nicht möglich: {0}', e.message)));
  });
  let armed = false;
  $('#mcp-rotate').onclick = async () => {
    if (!armed) {
      armed = true;
      $('#mcp-rotate').textContent = T18('Wirklich erneuern? Alle KI-Sitzungen werden getrennt');
      return;
    }
    try {
      await B.mcp.rotateToken();
      A.toast(T18('Neuer Schlüssel — die Einrichtung in der KI bitte wiederholen'));
    } catch (e) {
      A.warn(T18('Schlüssel nicht erneuert: {0}', e.message));
    }
    armed = false;
    $('#mcp-rotate').textContent = T18('Schlüssel erneuern');
    refresh();
  };
  paintDialog();
  refresh();
}

refresh();

window.KNXMcp = { available: true, open: openDialog, openProposals, refresh, state: () => ({ ...st }),
                  // Was im Chat nie hinausgeht — dieselben Begriffe wie bei den Werkzeugen
                  privacyContext: () => ({ names: names(), terms: terms('chat') }),
                  tools: TOOLS, planners: PLANNERS, changes: () => changes.slice() };

})();
