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
   Diese Stufe liest nur; am Projekt ändert eine KI-Sitzung nichts.
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
const st = { mode: 'off', handle: null, sessions: 0, busy: 0, available: ['off', 'read'], last: null };

function paint() {
  const m = modeOf(st.mode);
  btn.hidden = false;
  btn.dataset.mode = st.mode;
  btn.querySelector('.ai-label').textContent = T18('KI: {0}', T18(m.label));
  btn.classList.toggle('busy', st.busy > 0);
  const badge = btn.querySelector('.btn-badge');
  badge.hidden = !st.sessions;
  badge.textContent = st.sessions;
  btn.title = T18('KI-Zugang für dieses Projekt: {0}', T18(m.label)) + ' — '
    + (st.sessions === 1 ? T18('1 KI-Sitzung verbunden') : T18('{0} KI-Sitzungen verbunden', st.sessions));
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
    ...MODES.map(m => {
      const can = st.available.includes(m.key);
      return {
        label: T18(m.label) + (m.key === st.mode ? '  ✓' : ''),
        icon: `<span class="ai-dot" data-mode="${m.key}"></span>`,
        hint: T18(m.desc) + (can ? '' : ' ' + T18('(kommt mit den Planungswerkzeugen)')),
        disabled: !can,
        run: () => setMode(m.key)
      };
    }),
    '-',
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
    pending: due(d), secure: !!d.secure, ip: KNX.deviceIsIp(d)
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
  const fn = Object.prototype.hasOwnProperty.call(TOOLS, ev.tool) ? TOOLS[ev.tool] : null;
  const body = { call: ev.call, names: names(), terms: terms(ev.tool) };
  try {
    if (!fn) throw new Error('Dieses Fenster kennt das Werkzeug ' + ev.tool + ' nicht — bitte neu laden.');
    body.data = await fn(ev.args || {}, ev);
    body.ok = true;
  } catch (e) {
    body.ok = false;
    body.error = String((e && e.message) || e);
  }
  try { await B.mcp.result(body); } catch (e) { console.warn('KI-Ergebnis nicht zustellbar:', e.message); }
}

B.events.on('mcp-call', run);

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
    const box = document.createElement('div');
    box.className = 'mcp-ask';
    box.setAttribute('role', 'alertdialog');
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
    document.body.appendChild(box);
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
              <span><b>${T18(m.label)}</b> — ${T18(m.desc)}${st.available.includes(m.key) ? '' : ` <em>${T18('(kommt mit den Planungswerkzeugen)')}</em>`}</span>
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

window.KNXMcp = { available: true, open: openDialog, refresh, state: () => ({ ...st }), tools: TOOLS };

})();
