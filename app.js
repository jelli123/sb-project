/* ============================================================
   KNX-Struktur — Kern: State, Dialoge, Aktionen
   ============================================================ */
'use strict';

(() => {

const $ = s => document.querySelector(s);
/* Kurzformen: T18 übersetzt festen Text, L wählt aus einem zweisprachigen
   Wert aus der Produktdatei die eingestellte Sprache. Beide gehen über
   KNXApp an die übrigen Dateien; im globalen Bereich stünden sie sich mit
   gleichnamigen Bindungen anderer Dateien im Weg. */
const T18 = (...a) => window.KNXI18n.t(...a);
const L = v => window.KNXI18n.pick(v);
const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- Icons (Strich, 12–15 px) ---------- */
const svg = (d, extra = '') => '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" ' +
  'stroke="currentColor" stroke-width="1.3"' + extra + '>' + d + '</svg>';
const IC = {
  site:     svg('<path d="M2.5 7.5 8 2.8l5.5 4.7V14h-11z"/><path d="M6 14v-4h4v4"/>'),
  building: svg('<rect x="3.5" y="2" width="9" height="12"/><path d="M6 5h1.5M8.5 5H10M6 8h1.5M8.5 8H10M6 11h4"/>'),
  part:     svg('<path d="M2.5 14V6l4-2.5V14M6.5 14V6l7 2.5V14"/><path d="M9 11h1.5"/>'),
  floor:    svg('<path d="M2 5.5 8 2.5l6 3-6 3z"/><path d="M2 10.5l6 3 6-3"/>'),
  outdoor:  svg('<path d="M8 13V8"/><path d="M8 8a3 3 0 1 1 0-4 3 3 0 1 1 0 4z"/><path d="M3 13h10"/>'),
  room:     svg('<rect x="2.5" y="3.5" width="11" height="9"/><path d="M2.5 12.5h4M7.5 12.5v-3"/>'),
  corridor: svg('<path d="M3 2.5v11M13 2.5v11"/><path d="M5.5 8h5"/>'),
  cabinet:  svg('<rect x="3" y="2.5" width="10" height="11" rx="1"/><path d="M3 6.5h10M3 10h10M10.5 4.5v0M10.5 8.2v0M10.5 11.8v0"/>'),
  area:     svg('<rect x="2.5" y="2.5" width="11" height="11" rx="2"/><path d="M2.5 8h11M8 2.5v11"/>'),
  line:     svg('<path d="M2.5 8h11"/><circle cx="5" cy="8" r="1.4"/><circle cx="11" cy="8" r="1.4"/>'),
  device:   svg('<rect x="2.5" y="4.5" width="11" height="7" rx="1"/><path d="M5 11.5v2M11 11.5v2M5 4.5v-2M11 4.5v-2"/>'),
  obj:      svg('<circle cx="8" cy="8" r="4.5"/><path d="M8 3.5v9"/>'),
  params:   '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M3 4.5h10M3 8h10M3 11.5h10"/><circle cx="6" cy="4.5" r="1.6" fill="currentColor" stroke="none"/><circle cx="10.5" cy="8" r="1.6" fill="currentColor" stroke="none"/><circle cx="5" cy="11.5" r="1.6" fill="currentColor" stroke="none"/></svg>'
};
const IC_PENCIL = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M11.2 2.8l2 2L5 13H3v-2z"/></svg>';
const IC_TRASH  = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M3 4.5h10M6.5 4V3h3v1M4.5 4.5 5 13h6l.5-8.5"/></svg>';
const IC_LOCK   = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="3.5" y="7.5" width="9" height="6.5" rx="1"/><path d="M5.5 7.5V5.5a2.5 2.5 0 0 1 5 0v2"/></svg>';
const IC_LINK   = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M6.5 9.5a3 3 0 0 0 4.2.3l2-2a3 3 0 0 0-4.2-4.2l-1.2 1.2"/><path d="M9.5 6.5a3 3 0 0 0-4.2-.3l-2 2a3 3 0 0 0 4.2 4.2l1.2-1.2"/></svg>';


/* ---------- State ---------- */
const state = {
  view: 'building',          // linker Baum: 'building' | 'topology' | 'ga'
  mid: 'ga',                 // mittlere Tabelle: 'ga' | 'dev'
  sel: null,                 // { kind, id } — node | ga | dev | obj | line | area | grp
  filter: null,              // { kind, id } — schränkt die mittlere Tabelle ein
  search: '',
  filterView: 'pass',        // Filtertabelle: 'pass' | 'local'
  sort: { key: 'addr', dir: 1 },
  collapsed: new Set(),      // im Seed-Status: alles offen
  checked: new Set(),        // GA-IDs in der Tabellen-Markierung
};

/* ---------- Persistenz ---------- */
function persistUI() {
  try {
    localStorage.setItem('knx-ui-v1', JSON.stringify({
      view: state.view, mid: state.mid, collapsed: [...state.collapsed],
      sel: state.sel, filter: state.filter, sort: state.sort
    }));
  } catch (e) {}
  navPush();
}
function restoreUI() {
  try {
    const u = JSON.parse(localStorage.getItem('knx-ui-v1') || '{}');
    state.collapsed = new Set(u.collapsed || []);
    if (['building', 'topology', 'ga'].includes(u.view)) state.view = u.view;
    if (['ga', 'dev'].includes(u.mid)) state.mid = u.mid;
    if (u.sort) state.sort = u.sort;
    if (u.filter && resolve(u.filter)) state.filter = u.filter;
    if (u.sel && resolve(u.sel)) state.sel = u.sel;
  } catch (e) {}
}

/* Prüft, ob eine gespeicherte Auswahl im aktuellen Projekt noch existiert. */
function resolve(ref) {
  if (!ref || !ref.kind) return null;
  switch (ref.kind) {
    case 'node': return KNX.findNode(ref.id);
    case 'ga':   return KNX.gaById(ref.id);
    case 'dev':  return KNX.deviceById(ref.id);
    case 'obj':  return KNX.objById(ref.id);
    case 'line': return KNX.lineById(ref.id);
    case 'seg':  return KNX.segmentInfo(ref.id);
    case 'area': return KNX.project().areas.find(a => a.id === ref.id) || null;
    case 'grp':  return typeof ref.id === 'string' ? ref : null;
    case 'fn':   return KNX.functionById(ref.id);
    default:     return null;
  }
}

function reRender() {
  if (window.KNXOnRender) window.KNXOnRender();
  syncHistoryButtons();
}

/* ---------- Ansichtsverlauf ---------- *
 * Getrennt vom Undo-Stack: hier steht, wo man war (Ansicht, Auswahl, Filter),
 * nicht was man geändert hat. Hängt an der Browser-History, damit Zurück/Vor
 * des Browsers das Erwartete tun statt die Seite zu verlassen. Die Suche
 * bleibt bewusst draußen — sonst erzeugt jedes getippte Wort Einträge.     */
const NAV_MAX = 100;
const nav = { stack: [], idx: -1, muted: false };

const navSnapshot = () => ({
  view: state.view, mid: state.mid,
  sel: state.sel ? { ...state.sel } : null,
  filter: state.filter ? { ...state.filter } : null
});
const navSame = (a, b) => a && b && a.view === b.view && a.mid === b.mid
  && JSON.stringify(a.sel) === JSON.stringify(b.sel)
  && JSON.stringify(a.filter) === JSON.stringify(b.filter);

function navPush() {
  if (nav.muted) return;
  const s = navSnapshot();
  if (navSame(nav.stack[nav.idx], s)) return;
  nav.stack.splice(nav.idx + 1);
  nav.stack.push(s);
  if (nav.stack.length > NAV_MAX) nav.stack.shift();
  nav.idx = nav.stack.length - 1;
  try { history.pushState({ knxNav: nav.idx }, ''); } catch (e) {}
  syncHistoryButtons();
}

function navApply(i) {
  const s = nav.stack[i];
  if (!s) return;
  nav.idx = i;
  nav.muted = true;
  state.view = s.view;
  state.mid = s.mid;
  state.sel = s.sel && resolve(s.sel) ? s.sel : null;
  state.filter = s.filter && resolve(s.filter) ? s.filter : null;
  persistUI();
  nav.muted = false;
  syncHistoryButtons();
  reRender();
}

/* delta -1 = zurück, +1 = vor. Nutzt die Browser-History, damit deren
   Zurück-Schaltfläche und diese Knöpfe denselben Zeiger bewegen. */
function navGo(delta) {
  const target = nav.idx + delta;
  if (target < 0 || target >= nav.stack.length) {
    toast(delta < 0 ? T18('Kein früherer Schritt') : T18('Kein späterer Schritt'), 900);
    return;
  }
  history.go(delta);
}

const canBack = () => nav.idx > 0;
const canFwd = () => nav.idx < nav.stack.length - 1;

window.addEventListener('popstate', e => {
  const i = e.state && e.state.knxNav;
  if (typeof i === 'number' && nav.stack[i]) navApply(i);
});

function initNav() {
  nav.stack = [navSnapshot()];
  nav.idx = 0;
  try { history.replaceState({ knxNav: 0 }, ''); } catch (e) {}
}

/* ---------- Undo / Redo ---------- *
 * Schnappschüsse statt Kommando-Objekten: Jede Aktion mutiert das Projekt
 * direkt, ein Kommandomodell wäre hier nur zusätzliche Fehlerquelle.       */
const UNDO_MAX = 30;
const undoStack = [], redoStack = [];
let baseline = null;
const snapshot = () => JSON.stringify(KNX.project());

function initHistory() { baseline = snapshot(); }

const canUndo = () => undoStack.length > 0;
const canRedo = () => redoStack.length > 0;

/* Hält die vier Verlaufsknöpfe im Kopfbereich aktuell. */
function syncHistoryButtons() {
  const steps = n => n === 1 ? T18('{0} Schritt', n) : T18('{0} Schritte', n);
  const set = (id, on, label) => {
    const b = $(id);
    if (!b) return;
    b.disabled = !on;
    b.title = label;
  };
  set('#btn-undo', canUndo(),
    canUndo() ? T18('Rückgängig: {0} (Strg+Z)', steps(undoStack.length)) : T18('Nichts rückgängig zu machen'));
  set('#btn-redo', canRedo(),
    canRedo() ? T18('Wiederholen: {0} (Strg+Y)', steps(redoStack.length)) : T18('Nichts zu wiederholen'));
  set('#btn-back', canBack(), canBack() ? T18('Zurück zur vorherigen Ansicht (Alt+←)') : T18('Kein früherer Schritt'));
  set('#btn-fwd', canFwd(), canFwd() ? T18('Vor zur nächsten Ansicht (Alt+→)') : T18('Kein späterer Schritt'));
}

function applySnapshot(json) {
  KNX.setProject(JSON.parse(json));
  if (!KNX.save()) warn(KNX.saveError());
  state.checked.clear();
  persistUI();
  reRender();
}
function undo() {
  if (!canUndo()) { toast(T18('Nichts rückgängig zu machen'), 900); return; }
  redoStack.push(baseline);
  baseline = undoStack.pop();
  applySnapshot(baseline);
  status(T18('Rückgängig — noch {0} Schritte', undoStack.length));
}
function redo() {
  if (!canRedo()) { toast('Nichts zu wiederholen', 900); return; }
  undoStack.push(baseline);
  baseline = redoStack.pop();
  applySnapshot(baseline);
  status(T18('Wiederhergestellt'));
}

function commit() {
  if (baseline !== null) {
    undoStack.push(baseline);
    if (undoStack.length > UNDO_MAX) undoStack.shift();
  }
  redoStack.length = 0;
  KNX.markDirty();
  const ok = KNX.save();
  baseline = snapshot();
  persistUI();
  syncHistoryButtons();
  reRender();
  ok ? toast(T18('Gespeichert'), 800) : warn(KNX.saveError());
}

/* ---------- Toast / Status ---------- */
let toastTimer = null;
function toast(msg, ms = 1600) {
  const t = $('#toast');
  t.classList.remove('warn');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
function warn(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show', 'warn');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 6000);
}
function status(msg) {
  $('#status-msg').textContent = msg || '';
  if (msg) setTimeout(() => {
    if ($('#status-msg').textContent === msg) $('#status-msg').textContent = '';
  }, 4000);
}

/* ---------- Modal ---------- */
let modalOkFn = null;
function openModal(title, bodyHtml, onOk) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = bodyHtml;
  modalOkFn = onOk;
  $('#modal-cancel').hidden = false;
  $('#modal-backdrop').classList.add('open');
  const first = $('#modal-body').querySelector('input, select');
  if (first) first.focus();
}
function closeModal() {
  $('#modal-backdrop').classList.remove('open');
  modalOkFn = null;
}
function modalConfirm() {
  if (modalOkFn && modalOkFn() === false) return;
  closeModal();
}

/* modalConfirm schliesst den Dialog erst nach dem Bestätigen — ein direkt
   daraus geöffneter Folgedialog würde sofort wieder zugehen. */
const nextModal = fn => setTimeout(fn, 0);

/* ---------- Kontextmenü ---------- *
 * Rechtsklick auf eine Zeile bietet dieselben Aktionen wie der Detailbereich
 * rechts — und nur die, die für dieses Element gültig sind; welche das sind,
 * entscheidet `menuFor` in app-render.js. Abgefangen wird nur auf den Zeilen
 * selbst: in Eingabefeldern und bei markiertem Text bleibt das Browsermenü,
 * sonst wäre Kopieren und Einfügen nicht mehr erreichbar.                  */

let menuEl = null;

/* `items`: Einträge {label, icon?, run, danger?, disabled?}, '-' als Trenner.
   Falsche Werte fallen heraus — so lassen sich Einträge inline bedingen. */
function openMenu(x, y, items) {
  closeMenu();
  const live = [];
  items.forEach(it => {
    if (!it) return;
    // Kein Trenner am Anfang und keine zwei hintereinander
    if (it === '-') { if (live.length && live[live.length - 1] !== '-') live.push('-'); }
    else live.push(it);
  });
  while (live.length && live[live.length - 1] === '-') live.pop();
  if (!live.some(it => it !== '-')) return;

  menuEl = document.createElement('div');
  menuEl.className = 'ctx-menu';
  menuEl.setAttribute('role', 'menu');
  menuEl.innerHTML = live.map((it, i) => it === '-'
    ? '<div class="ctx-sep" role="separator"></div>'
    : `<button type="button" role="menuitem" class="ctx-item${it.danger ? ' danger' : ''}"
         data-i="${i}"${it.disabled ? ' disabled' : ''}${it.hint ? ` title="${esc(it.hint)}"` : ''}>
         <span class="ctx-ic">${it.icon || ''}</span><span>${esc(it.label)}</span></button>`).join('');
  document.body.appendChild(menuEl);

  /* Erst nach dem Einfügen messbar: an der Kante wird gespiegelt statt abgeschnitten. */
  const box = menuEl.getBoundingClientRect();
  const pad = 6;
  menuEl.style.left = Math.max(pad, Math.min(x, window.innerWidth - box.width - pad)) + 'px';
  menuEl.style.top = Math.max(pad, Math.min(y, window.innerHeight - box.height - pad)) + 'px';

  menuEl.addEventListener('click', ev => {
    const btn = ev.target.closest('.ctx-item');
    if (!btn || btn.disabled) return;
    const it = live[+btn.dataset.i];
    closeMenu();
    if (it && it.run) it.run();
  });
  // Ein Rechtsklick im Menü soll es nicht erneut aufklappen
  menuEl.addEventListener('contextmenu', ev => ev.preventDefault());

  document.addEventListener('pointerdown', onMenuAway, true);
  document.addEventListener('keydown', onMenuKey, true);
  document.addEventListener('scroll', closeMenu, true);
  window.addEventListener('resize', closeMenu);
  window.addEventListener('blur', closeMenu);

  const first = menuEl.querySelector('.ctx-item:not([disabled])');
  if (first) first.focus();
}

function closeMenu() {
  if (!menuEl) return;
  menuEl.remove();
  menuEl = null;
  document.removeEventListener('pointerdown', onMenuAway, true);
  document.removeEventListener('keydown', onMenuKey, true);
  document.removeEventListener('scroll', closeMenu, true);
  window.removeEventListener('resize', closeMenu);
  window.removeEventListener('blur', closeMenu);
}

function onMenuAway(ev) {
  if (menuEl && !menuEl.contains(ev.target)) closeMenu();
}

function onMenuKey(ev) {
  if (!menuEl) return;
  if (ev.key === 'Escape') { ev.preventDefault(); closeMenu(); return; }
  if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp' && ev.key !== 'Home' && ev.key !== 'End') return;
  ev.preventDefault();
  const all = [...menuEl.querySelectorAll('.ctx-item:not([disabled])')];
  if (!all.length) return;
  const at = all.indexOf(document.activeElement);
  const to = ev.key === 'Home' ? 0
    : ev.key === 'End' ? all.length - 1
    : ev.key === 'ArrowDown' ? (at + 1) % all.length
    : (at - 1 + all.length) % all.length;
  all[to].focus();
}

/* Öffnet das Menü zu einem Rechtsklick, sofern für das Element etwas anzubieten ist. */
function contextMenuFor(ev, kind, id) {
  const items = window.KNXRender && window.KNXRender.menuFor
    ? window.KNXRender.menuFor(kind, id) : [];
  if (!items || !items.length) return false;
  ev.preventDefault();
  select(kind, id);
  openMenu(ev.clientX, ev.clientY, items);
  return true;
}

/* Wo das Browsermenü Vorrang hat. */
function nativeMenuWins(ev) {
  if (ev.target.closest('input, textarea, select, [contenteditable="true"]')) return true;
  const sel = window.getSelection();
  return !!(sel && !sel.isCollapsed && sel.toString().trim());
}

/* ---------- Baum-Hilfen ---------- */
function inSubtree(id, ancestorId) {
  if (id === ancestorId) return true;
  const anc = KNX.findNode(ancestorId);
  let hit = false;
  if (anc) KNX.walk(anc, n => { if (n.id === id) hit = true; });
  return hit;
}

/* ---------- Filter & Suche ---------- */
function matchesSearch(text) {
  return !state.search || text.toLowerCase().includes(state.search);
}

function gaPassesFilter(g, f) {
  if (!f) return true;
  switch (f.kind) {
    case 'node': {
      const ids = new Set(KNX.roomIdsUnder(f.id));
      return KNX.gaLinks(g.id).some(l => ids.has(l.dev.roomId));
    }
    case 'line': return KNX.gaLinks(g.id).some(l => l.dev.lineId === f.id);
    case 'seg':  return KNX.gaLinks(g.id).some(l => KNX.segKeyOf(l.dev) === f.id);
    case 'area': {
      const ids = new Set((KNX.project().areas.find(a => a.id === f.id)?.lines || []).map(l => l.id));
      return KNX.gaLinks(g.id).some(l => ids.has(l.dev.lineId));
    }
    case 'dev': {
      const d = KNX.deviceById(f.id);
      return !!d && d.objs.some(o => o.gas.includes(g.id));
    }
    case 'grp': {
      const pre = String(f.id).split('/').map(Number);
      const v = KNX.gaSplit(g.raw);
      return pre.every((x, i) => v[i] === x);
    }
    case 'fn': {
      const fn = KNX.functionById(f.id);
      return !!fn && fn.gas.some(x => x.ga === g.id);
    }
    default: return true;
  }
}

function visibleGAs() {
  let gs = KNX.project().groups.filter(g => gaPassesFilter(g, state.filter));
  if (state.search)
    gs = gs.filter(g => matchesSearch(g.name + ' ' + KNX.addrStr(g) + ' ' + g.dpt + ' ' + g.note + ' ' +
      KNX.functionsOfGa(g.id).map(f => f.name).join(' ')));
  const { key, dir } = state.sort;
  gs.sort((a, b) => {
    let r = 0;
    if (key === 'addr') {
      r = a.raw - b.raw;
    } else if (key === 'name') {
      r = a.name.localeCompare(b.name, 'de');
    } else if (key === 'func') {
      const da = KNX.dptById(a.dpt), db = KNX.dptById(b.dpt);
      r = da.main - db.main || da.id.localeCompare(db.id) || a.raw - b.raw;
    }
    return r * dir;
  });
  return gs;
}

function devPassesFilter(d, f) {
  if (!f) return true;
  switch (f.kind) {
    case 'node': return new Set(KNX.roomIdsUnder(f.id)).has(d.roomId);
    case 'line': return d.lineId === f.id;
    case 'seg':  return KNX.segKeyOf(d) === f.id;
    case 'area': {
      const ids = new Set((KNX.project().areas.find(a => a.id === f.id)?.lines || []).map(l => l.id));
      return ids.has(d.lineId);
    }
    case 'dev':  return d.id === f.id;
    case 'grp': {
      const pre = String(f.id).split('/').map(Number);
      return d.objs.some(o => o.gas.some(gid => {
        const g = KNX.gaById(gid);
        if (!g) return false;
        const v = KNX.gaSplit(g.raw);
        return pre.every((x, i) => v[i] === x);
      }));
    }
    case 'fn': {
      const fn = KNX.functionById(f.id);
      return !!fn && KNX.functionDevices(fn).includes(d);
    }
    default: return true;
  }
}

function visibleDevices() {
  let ds = KNX.project().devices.filter(d => devPassesFilter(d, state.filter));
  if (state.search)
    ds = ds.filter(d => matchesSearch(d.name + ' ' + d.product + ' ' + KNX.paStr(d.addr))
      || d.objs.some(o => matchesSearch(KNX.objLabel(o))));
  const { key, dir } = state.sort;
  ds.sort((a, b) => {
    let r = 0;
    if (key === 'name') r = a.name.localeCompare(b.name, 'de');
    else r = KNX.byPa(a, b);
    return r * dir || KNX.byPa(a, b);
  });
  return ds;
}


/* ============================================================
   Aktionen — Gebäudestruktur
   ============================================================ */
function select(kind, id) {
  state.sel = { kind, id };
  persistUI();
  reRender();
}
function selectNode(id) {
  const node = KNX.findNode(id);
  if (!node) return;
  state.sel = { kind: 'node', id };
  // Klick auf einen Bereich filtert die Tabelle; die Wurzel hebt den Filter auf
  state.filter = id === KNX.project().tree.id ? null : { kind: 'node', id };
  persistUI();
  reRender();
}
function toggleCollapse(id) {
  state.collapsed.has(id) ? state.collapsed.delete(id) : state.collapsed.add(id);
  persistUI();
  reRender();
}
/* Der Titel wird hier übersetzt, nicht an den rund zwei Dutzend Aufrufstellen —
   der deutsche Text bleibt dort stehen und ist zugleich der Schlüssel. */
function iconBtn(html, title, fn, disabled) {
  const b = document.createElement('button');
  b.className = 'icon-btn';
  b.innerHTML = html;
  b.title = T18(title);
  if (disabled) { b.disabled = true; }
  else b.onclick = fn;
  return b;
}
function actNewNode(parentId) {
  const parent = KNX.findNode(parentId);
  if (!parent) return;
  const holds = KNX.kindHolds(parent.kind);
  if (!holds.length) return;
  openModal(T18('Unter „{0}“ anlegen', parent.name), `
    <label class="field"><span>${T18('Typ')}</span>
      <select class="select" id="m-kind">${holds.map(k =>
        `<option value="${k}">${esc(T18(KNX.kindDe(k)))}</option>`).join('')}</select>
    </label>
    <label class="field"><span>${T18('Name')}</span>
      <input class="input" id="m-name" maxlength="40" placeholder="${T18('z. B. Bad')}">
    </label>
    <label class="field"><span>${T18('Notiz')}</span>
      <textarea class="input note" id="m-note" rows="3" maxlength="${KNX.NOTE_MAX}"
                placeholder="${T18('Freitext zur Dokumentation')}"></textarea>
    </label>
    <p class="hint" id="m-kind-hint"></p>
  `, () => {
    const name = $('#m-name').value.trim();
    if (!name) { $('#m-name').focus(); return false; }
    const kind = $('#m-kind').value;
    const node = { id: KNX.uid('n'), kind, name, note: $('#m-note').value.trim(), children: [] };
    parent.children.push(node);
    state.collapsed.delete(parentId);
    state.sel = { kind: 'node', id: node.id };
    commit();
  });
  const hint = $('#m-kind-hint');
  const upd = () => {
    const k = $('#m-kind').value;
    const sub = KNX.kindHolds(k);
    hint.innerHTML = (KNX.DEVICE_HOSTS.has(k)
        ? T18('Hier können <b>Geräte</b> verbaut werden.') + ' '
        : '') +
      (sub.length ? T18('Enthält: {0}.', sub.map(x => esc(T18(KNX.kindDe(x)))).join(', '))
                  : T18('Unterste Ebene — keine weitere Unterteilung.'));
  };
  $('#m-kind').addEventListener('change', upd);
  upd();
  $('#m-name').focus();
}
function actRenameNode(id) {
  const n = KNX.findNode(id);
  if (!n) return;
  const isRoot = n.id === KNX.project().tree.id;
  // Nur Typen, die das übergeordnete Element aufnehmen kann — sonst wäre die
  // Struktur ungültig und die Migration müsste sie beim nächsten Laden umbauen.
  const allowed = isRoot ? [] : KNX.kindHolds(KNX.parentOf(id).kind);
  const holds = isRoot ? [] : allowed.includes(n.kind) ? allowed : [n.kind, ...allowed];
  openModal(T18('{0} bearbeiten', T18(KNX.kindDe(n.kind))), `
    <label class="field"><span>${T18('Name')}</span>
      <input class="input" id="m-name" maxlength="40" value="${esc(n.name)}">
    </label>
    ${holds.length ? `<label class="field"><span>${T18('Typ')}</span>
      <select class="select" id="m-kind">${holds.map(k =>
        `<option value="${k}"${k === n.kind ? ' selected' : ''}>${esc(T18(KNX.kindDe(k)))}</option>`).join('')}</select>
    </label>` : ''}
    <label class="field"><span>${T18('Notiz')}</span>
      <textarea class="input note" id="m-note" rows="3" maxlength="${KNX.NOTE_MAX}"
                placeholder="${T18('Freitext zur Dokumentation')}">${esc(n.note || '')}</textarea>
    </label>
    ${holds.length ? '<div id="m-err"></div>' : ''}
  `, () => {
    const name = $('#m-name').value.trim();
    if (!name) { $('#m-name').focus(); return false; }
    const kind = $('#m-kind')?.value || n.kind;
    if (!isRoot && !allowed.includes(kind)) {
      $('#m-err').innerHTML = `<span class="hint warn">${T18('„{0}“ kann kein {1} enthalten — erlaubt: {2}.',
        esc(KNX.parentOf(id).name), esc(T18(KNX.kindDe(kind))), allowed.map(k => esc(T18(KNX.kindDe(k)))).join(', '))}</span>`;
      return false;
    }
    if (kind !== n.kind) {
      const holdsNew = KNX.kindHolds(kind);
      const bad = n.children.find(c => !holdsNew.includes(c.kind));
      if (bad) {
        $('#m-err').innerHTML = `<span class="hint warn">${T18('Ein {0} kann kein {1} („{2}“) enthalten.',
          esc(T18(KNX.kindDe(kind))), esc(T18(KNX.kindDe(bad.kind))), esc(bad.name))}</span>`;
        return false;
      }
      const lost = !KNX.DEVICE_HOSTS.has(kind) && KNX.devicesInRoom(n.id).length;
      if (lost) {
        $('#m-err').innerHTML = `<span class="hint warn">${T18('Hier sind {0} Geräte verbaut — ein {1} kann keine Geräte aufnehmen.',
          lost, esc(T18(KNX.kindDe(kind))))}</span>`;
        return false;
      }
      n.kind = kind;
    }
    n.name = name;
    n.note = $('#m-note').value.trim();
    if (n.id === KNX.project().tree.id) KNX.project().name = name;
    commit();
  });
}
function actDeleteNode(id) {
  const n = KNX.findNode(id);
  if (!n || n.id === KNX.project().tree.id) return;
  const roomIds = KNX.roomIdsUnder(id);
  const devs = roomIds.reduce((s, r) => s + KNX.devicesInRoom(r).length, 0);
  const fns = KNX.functionsUnder(id).length;
  openModal(T18('{0} „{1}“ löschen?', T18(KNX.kindDe(n.kind)), n.name), `
    <p>${T18('Das Element und alles, was darunter liegt, wird entfernt')}${fns
      ? T18(', auch {0}. Deren Gruppenadressen bleiben erhalten',
            fns === 1 ? T18('eine Funktion') : T18('{0} Funktionen', fns)) : ''}.</p>
    ${devs
      ? `<p class="hint warn">${T18('{0} Geräte verlieren ihre Raumzuordnung. Die Geräte selbst bleiben mit allen Objekten und Adressen in der Topologie erhalten.', devs)}</p>`
      : `<p class="hint">${T18('Hier sind keine Geräte verbaut.')}</p>`}
  `, () => {
    KNX.deleteNode(id);
    if (state.sel?.kind === 'node' && (state.sel.id === id || inSubtree(state.sel.id, id))) state.sel = null;
    if (state.filter?.kind === 'node' && (state.filter.id === id || inSubtree(state.filter.id, id)))
      state.filter = null;
    commit();
  });
}

/* ---------- Umhängen ---------- */

/* Auswahl vorhandener Einträge mit Suche. items: { id, label, sub, icon } */
function pickDialog(title, hint, items, onPick) {
  if (!items.length) { toast(T18('Nichts Passendes vorhanden')); return; }
  openModal(title, `
    ${hint ? `<p class="hint">${hint}</p>` : ''}
    <input class="input" id="m-search" placeholder="${T18('Filtern …')}">
    <div class="chk-list tall" id="m-pick">${items.map(it => `
      <label class="chk-row" data-name="${esc((it.label + ' ' + (it.sub || '')).toLowerCase())}">
        <input type="checkbox" class="chk" data-id="${esc(it.id)}">
        ${it.icon || ''}
        <span class="chk-label"><span>${esc(it.label)}</span>${it.sub ? `<span class="ga-note">${esc(it.sub)}</span>` : ''}</span>
      </label>`).join('')}
    </div>
  `, () => {
    const ids = [...$('#m-pick').querySelectorAll('.chk:checked')].map(c => c.dataset.id);
    if (!ids.length) return;
    onPick(ids);
  });
  $('#m-search').addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    $('#m-pick').querySelectorAll('.chk-row').forEach(el => { el.hidden = !!q && !el.dataset.name.includes(q); });
  });
}

const trailOf = id => KNX.nodePath(id)?.sub || KNX.project().tree.name;

function moveNode(id, parentId, refId, where) {
  const err = KNX.nodeMoveError(id, parentId);
  if (err) { warn(T18(err)); return false; }
  KNX.moveNode(id, parentId, refId, where);
  state.collapsed.delete(parentId);
  commit();
  return true;
}

/* Vorhandene Elemente unter `nodeId` einordnen. */
function actPickChildren(nodeId) {
  const node = KNX.findNode(nodeId);
  if (!node) return;
  const items = [];
  KNX.walk(KNX.project().tree, n => {
    if (KNX.parentOf(n.id)?.id !== nodeId && !KNX.nodeMoveError(n.id, nodeId))
      items.push({ id: n.id, label: n.name, sub: T18(KNX.kindDe(n.kind)) + ' · ' + trailOf(n.id),
                   icon: `<span class="lvl-ic ${n.kind}">${IC[n.kind] || IC.room}</span>` });
  });
  pickDialog(T18('Vorhandenes in „{0}“ einordnen', node.name),
    T18('Angeboten wird, was ein {0} enthalten kann. Unterelemente wandern mit.', esc(T18(KNX.kindDe(node.kind)))),
    items, ids => {
      ids.forEach(id => KNX.moveNode(id, nodeId));
      state.collapsed.delete(nodeId);
      commit();
    });
}

/* Vorhandene Geräte in diesem Raum verbauen. */
function actPickDevices(nodeId) {
  const node = KNX.findNode(nodeId);
  if (!node || !KNX.DEVICE_HOSTS.has(node.kind)) return;
  const items = KNX.project().devices.filter(d => d.roomId !== nodeId).slice().sort(KNX.byPa).map(d => ({
    id: d.id, label: KNX.paStr(d.addr) + '  ' + d.name,
    sub: d.roomId ? T18('bisher {0}', trailOf(d.roomId)) : T18('ohne Raum'),
    icon: `<span class="lvl-ic device">${IC.device}</span>`
  }));
  pickDialog(T18('Geräte in „{0}“ verbauen', node.name),
    T18('Ein Gerät hat genau einen Einbauort — der bisherige wird ersetzt.'),
    items, ids => {
      ids.forEach(id => KNX.setDeviceRoom(id, nodeId));
      state.collapsed.delete(nodeId);
      commit();
    });
}

function setDeviceRoom(devId, nodeId) {
  if (!KNX.setDeviceRoom(devId, nodeId)) { warn(T18('Geräte lassen sich nur in Räumen, Fluren, Verteilern und Außenbereichen verbauen.')); return; }
  if (nodeId) state.collapsed.delete(nodeId);
  commit();
}

/* Knoten, unter die `id` passt — für die Auswahl des übergeordneten Elements. */
function parentOptions(id) {
  const cur = KNX.parentOf(id)?.id;
  const out = [];
  KNX.walk(KNX.project().tree, n => {
    if (n.id === cur || !KNX.nodeMoveError(id, n.id))
      out.push(`<option value="${n.id}"${n.id === cur ? ' selected' : ''}>${esc(trailOf(n.id))} (${esc(T18(KNX.kindDe(n.kind)))})</option>`);
  });
  return out.join('');
}

/* ============================================================
   Export für app-ga.js / app-topo.js / Rendering / Init
   ============================================================ */
window.KNXApp = {
  state, esc,
  persistUI, restoreUI, resolve, commit,
  initHistory, initNav, undo, redo, navGo, canUndo, canRedo, canBack, canFwd,
  syncHistoryButtons,
  resetHistory: () => {
    undoStack.length = 0; redoStack.length = 0;
    initHistory(); initNav(); syncHistoryButtons();
  },
  toast, warn, status, openModal, closeModal, modalConfirm, nextModal,
  inSubtree, visibleGAs, visibleDevices,
  select, selectNode, toggleCollapse,
  actNewNode, actRenameNode, actDeleteNode,
  pickDialog, trailOf, moveNode, actPickChildren, actPickDevices, setDeviceRoom, parentOptions,
  iconBtn, t: T18, L,
  openMenu, closeMenu, contextMenuFor, nativeMenuWins,
  IC, IC_PENCIL, IC_TRASH, IC_LINK, IC_LOCK
};

})();
