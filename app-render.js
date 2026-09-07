/* ============================================================
   KNX-Struktur — Rendering: Bäume, Tabellen, Details
   ============================================================ */
'use strict';

(() => {
const A = window.KNXApp, G = window.KNXGA, T = window.KNXTopo, $ = s => document.querySelector(s);
const state = A.state, esc = A.esc;
const iconBtn = A.iconBtn;

/* Sichtbare Baumzeilen in Anzeigereihenfolge — Grundlage der Tastaturnavigation. */
let visibleRows = [];
let issueMap = new Map();

const sameRef = (a, b) => !!a && !!b && a.kind === b.kind && a.id === b.id;
const issuesOf = id => issueMap.get(id) || [];
/* Reine Hinweise bekommen keine Markierung — sonst ist alles markiert. */
function issueBadge(id) {
  const is = issuesOf(id);
  const err = is.some(i => i.level === 'error');
  const wrn = is.some(i => i.level === 'warn');
  if (!err && !wrn) return null;
  const s = document.createElement('span');
  s.className = 'issue-dot ' + (err ? 'error' : 'warn');
  s.title = is.map(i => i.msg).join('\n');
  s.textContent = err ? '!' : '?';
  return s;
}

/* ============================================================
   Baumzeile
   ============================================================ *
 * Der Baum wird zweistufig gebaut: erst eine flache Liste von Zeilen-
 * beschreibungen, dann DOM nur für den sichtbaren Ausschnitt. Ein
 * mittelgroßes Projekt hat schnell mehrere tausend Zeilen — die alle zu
 * erzeugen kostet rund eine Sekunde pro Klick.                            */
const ROW_H = 30;

function emit(o) {
  visibleRows.push(o);
  if (o.hasKids && !o.collapsed && o.children) o.children();
}

function buildTreeRow(o, index) {
  const el = document.createElement('div');
  el.className = 'tree-node' + (sameRef(state.sel, o.ref) ? ' sel' : '')
    + (sameRef(state.filter, o.ref) ? ' filtered' : '');
  el.style.top = (index * ROW_H) + 'px';

  const row = document.createElement('div');
  row.className = 'tree-row';
  row.style.paddingLeft = (o.depth * 14 + 4) + 'px';
  row.dataset.ptId = 'tree-' + o.ref.kind + '-' + o.ref.id;
  row.dataset.index = index;
  row.setAttribute('role', 'treeitem');
  row.setAttribute('aria-level', o.depth + 1);
  row.tabIndex = 0;

  const caret = document.createElement('span');
  caret.className = 'caret' + (o.hasKids ? '' : ' invisible');
  caret.textContent = o.collapsed ? '▸' : '▾';
  caret.title = o.hasKids ? (o.collapsed ? 'Aufklappen' : 'Zuklappen') : '';
  caret.onclick = e => { e.stopPropagation(); if (o.hasKids) A.toggleCollapse(o.key); };

  const icon = document.createElement('span');
  icon.className = 'lvl-ic ' + (o.iconClass || '');
  icon.innerHTML = o.icon || '';

  const name = document.createElement('span');
  name.className = 'node-name';
  name.textContent = o.label;
  if (o.title) name.title = o.title;

  row.append(caret, icon, name);

  if (o.addr) {
    const a = document.createElement('span');
    a.className = 'node-addr';
    a.textContent = o.addr;
    row.appendChild(a);
  }
  const badge = issueBadge(o.ref.id);
  if (badge) row.appendChild(badge);
  if (o.meta) {
    const m = document.createElement('span');
    m.className = 'node-meta';
    m.textContent = o.meta;
    row.appendChild(m);
  }
  const acts = o.actions ? o.actions() : [];
  if (acts.length) {
    const act = document.createElement('span');
    act.className = 'node-actions';
    acts.forEach(b => act.appendChild(b));
    act.onclick = e => e.stopPropagation();
    row.appendChild(act);
  }

  row.onclick = () => o.onSelect();
  if (o.onEdit) row.ondblclick = e => { e.stopPropagation(); o.onEdit(); };
  row.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); o.onSelect(); }
    else if (e.key === 'ArrowRight' && o.hasKids && o.collapsed) A.toggleCollapse(o.key);
    else if (e.key === 'ArrowLeft' && o.hasKids && !o.collapsed) A.toggleCollapse(o.key);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      moveTreeSel(e.key === 'ArrowDown' ? 1 : -1);
    }
  };

  el.appendChild(row);
  return el;
}

/* ---------- Ansicht 1: Gebäude ---------- */
function buildingNode(node, depth) {
  const p = KNX.project();
  const isRoot = node.id === p.tree.id;
  const holds = KNX.kindHolds(node.kind);
  const devs = KNX.DEVICE_HOSTS.has(node.kind) ? KNX.devicesInRoom(node.id).length : 0;

  emit({
    depth, key: node.id, ref: { kind: 'node', id: node.id },
    icon: A.IC[node.kind] || A.IC.room, iconClass: node.kind,
    label: node.name, title: KNX.kindDe(node.kind),
    meta: devs ? devs + '\u00A0G' : '',
    hasKids: (node.children || []).length > 0,
    collapsed: state.collapsed.has(node.id),
    actions: () => {
      const a = [];
      if (!isRoot) a.push(iconBtn(A.IC_TRASH, 'Löschen', () => A.actDeleteNode(node.id)));
      if (KNX.DEVICE_HOSTS.has(node.kind))
        a.push(iconBtn(A.IC.device, 'Gerät hier verbauen', () => T.actNewDevice({ roomId: node.id })));
      a.push(iconBtn('+', holds.length ? 'Untergeordnetes Element' : 'Keine Unterteilung möglich',
        () => A.actNewNode(node.id), !holds.length));
      return a;
    },
    onSelect: () => A.selectNode(node.id),
    onEdit: () => A.actRenameNode(node.id),
    children: () => node.children.forEach(c => buildingNode(c, depth + 1))
  });
}

/* ---------- Ansicht 2: Topologie ---------- */
function areaNode(a) {
  emit({
    depth: 0, key: a.id, ref: { kind: 'area', id: a.id },
    icon: A.IC.area, iconClass: 'area',
    label: a.name, title: 'Bereich', addr: a.addr + '.-.-',
    hasKids: a.lines.length > 0, collapsed: state.collapsed.has(a.id),
    actions: () => [
      iconBtn(A.IC_TRASH, 'Bereich löschen', () => T.actDeleteArea(a.id)),
      iconBtn('+', 'Neue Linie', () => T.actNewLine(a.id))
    ],
    onSelect: () => { state.filter = { kind: 'area', id: a.id }; A.select('area', a.id); },
    onEdit: () => T.actEditArea(a.id),
    children: () => a.lines.slice().sort((x, y) => x.addr - y.addr).forEach(l => lineNode(a, l))
  });
}
function lineNode(a, l) {
  const devs = KNX.devicesOnLine(l.id);
  emit({
    depth: 1, key: l.id, ref: { kind: 'line', id: l.id },
    icon: A.IC.line, iconClass: 'line',
    label: l.name, title: KNX.MEDIA[l.medium], addr: a.addr + '.' + l.addr + '.-',
    meta: devs.length ? devs.length + '\u00A0T' : '',
    hasKids: devs.length > 0, collapsed: state.collapsed.has(l.id),
    actions: () => [
      iconBtn(A.IC_TRASH, 'Linie löschen', () => T.actDeleteLine(l.id)),
      iconBtn('+', 'Neues Gerät', () => T.actNewDevice({ lineId: l.id }))
    ],
    onSelect: () => { state.filter = { kind: 'line', id: l.id }; A.select('line', l.id); },
    onEdit: () => T.actEditLine(l.id),
    children: () => devs.slice().sort((x, y) => x.addr - y.addr).forEach(d => deviceNode(d, 2))
  });
}
function deviceNode(d, depth) {
  emit({
    depth, key: d.id, ref: { kind: 'dev', id: d.id },
    icon: A.IC.device, iconClass: 'device',
    label: d.name, title: d.product, addr: KNX.paStr(d.addr),
    meta: d.objs.length ? d.objs.length + '\u00A0KO' : '',
    hasKids: d.objs.length > 0, collapsed: state.collapsed.has(d.id),
    actions: () => [
      iconBtn(A.IC_TRASH, 'Gerät löschen', () => T.actDeleteDevice(d.id)),
      iconBtn('+', 'Neues Kommunikationsobjekt', () => T.actNewObj(d.id))
    ],
    onSelect: () => { state.filter = { kind: 'dev', id: d.id }; A.select('dev', d.id); },
    onEdit: () => T.actEditDevice(d.id),
    children: () => d.objs.forEach(o => objNode(o, depth + 1))
  });
}
function objNode(o, depth) {
  const send = o.gas[0] ? KNX.gaById(o.gas[0]) : null;
  emit({
    depth, key: o.id, ref: { kind: 'obj', id: o.id },
    icon: A.IC.obj, iconClass: 'obj',
    label: o.name, title: `Objekt ${o.num} · ${o.dpt} · Flags ${KNX.flagStr(o.flags)}`,
    addr: send ? KNX.addrStr(send) : '',
    meta: o.gas.length > 1 ? '+' + (o.gas.length - 1) : '',
    hasKids: false, collapsed: false,
    actions: () => [
      iconBtn(A.IC_TRASH, 'Objekt löschen', () => T.actDeleteObj(o.id)),
      iconBtn(A.IC_LINK, 'Adressen zuordnen', () => T.actAssignObj(o.id))
    ],
    onSelect: () => A.select('obj', o.id),
    onEdit: () => T.actEditObj(o.id)
  });
}

/* ---------- Ansicht 3: Gruppenadressen ---------- */
function gaGroupNode(n, depth) {
  const count = countGroups(n);
  emit({
    depth, key: 'grp:' + n.key, ref: { kind: 'grp', id: n.key },
    icon: A.IC.area, iconClass: 'grp',
    label: n.name || '(ohne Namen)', title: n.label + ' ' + n.key, addr: n.key,
    meta: count ? String(count) : '',
    hasKids: n.children.length > 0, collapsed: state.collapsed.has('grp:' + n.key),
    actions: () => [ iconBtn(A.IC_PENCIL, 'Benennen', () => T.actRenameGaGroup(n.key)) ],
    onSelect: () => { state.filter = { kind: 'grp', id: n.key }; A.select('grp', n.key); },
    onEdit: () => T.actRenameGaGroup(n.key),
    children: () => n.children.forEach(c => gaGroupNode(c, depth + 1))
  });
}
function countGroups(n) {
  return n.groups.length + n.children.reduce((s, c) => s + countGroups(c), 0);
}

/* ============================================================
   Baum-Master
   ============================================================ */
function renderTree() {
  const p = KNX.project();
  visibleRows = [];

  if (state.view === 'building') {
    buildingNode(p.tree, 0);
    $('#tree-count').textContent =
      `${KNX.rooms().length} Bereiche mit Geräteplatz · ` +
      `${p.devices.filter(d => d.roomId).length} von ${p.devices.length} Geräten verortet`;
    $('#btn-tree-add').textContent = '+ Element';
    $('#btn-tree-add').title = 'Unter dem gewählten Element anlegen';
  } else if (state.view === 'topology') {
    p.areas.slice().sort((a, b) => a.addr - b.addr).forEach(areaNode);
    const nLines = p.areas.reduce((s, a) => s + a.lines.length, 0);
    $('#tree-count').textContent =
      `${p.areas.length} Bereiche · ${nLines} Linien · ${p.devices.length} Teilnehmer`;
    $('#btn-tree-add').textContent = '+ Bereich';
    $('#btn-tree-add').title = 'Neuen Bereich anlegen';
  } else {
    const root = KNX.gaTree();
    root.children.forEach(c => gaGroupNode(c, 0));
    $('#tree-count').textContent =
      `${p.groups.length} Adressen in ${root.children.length} Hauptgruppen`;
    $('#btn-tree-add').textContent = '+ Adresse';
    $('#btn-tree-add').title = 'Neue Gruppenadresse anlegen';
  }

  document.querySelectorAll('.tab[data-view]').forEach(t =>
    t.classList.toggle('on', t.dataset.view === state.view));

  const inner = $('#tree-inner');
  inner.style.height = (visibleRows.length * ROW_H) + 'px';
  inner.innerHTML = visibleRows.length ? '' : '<div class="tree-empty">Nichts anzuzeigen.</div>';
  drawnFrom = -1;
  paintTreeViewport();
}

/* Erzeugt DOM nur für den sichtbaren Ausschnitt plus Puffer. */
let drawnFrom = -1, drawnTo = -1;
const TREE_PAD = 10;
function paintTreeViewport() {
  const cont = $('#tree');
  const inner = $('#tree-inner');
  if (!visibleRows.length) return;
  const from = Math.max(0, Math.floor(cont.scrollTop / ROW_H) - TREE_PAD);
  const to = Math.min(visibleRows.length,
    Math.ceil((cont.scrollTop + cont.clientHeight) / ROW_H) + TREE_PAD);
  if (from === drawnFrom && to === drawnTo) return;
  drawnFrom = from; drawnTo = to;
  const frag = document.createDocumentFragment();
  for (let i = from; i < to; i++) frag.appendChild(buildTreeRow(visibleRows[i], i));
  inner.replaceChildren(frag);
}
function scrollTreeTo(index) {
  const cont = $('#tree');
  const y = index * ROW_H;
  if (y < cont.scrollTop) cont.scrollTop = y;
  else if (y + ROW_H > cont.scrollTop + cont.clientHeight)
    cont.scrollTop = y + ROW_H - cont.clientHeight;
  paintTreeViewport();
}


/* ============================================================
   Statistik und Prüfergebnis
   ============================================================ */
function renderStats() {
  const p = KNX.project();
  const linked = p.groups.filter(g => KNX.gaLinks(g.id).length).length;
  const nLinks = p.devices.reduce((s, d) => s + d.objs.reduce((t, o) => t + o.gas.length, 0), 0);
  const unlinked = p.groups.length - linked;

  $('#stat-rooms').textContent = KNX.rooms().length;
  $('#stat-devs').textContent = p.devices.length;
  $('#stat-ga').textContent = p.groups.length;
  $('#stat-links').textContent = nLinks;

  const bar = $('#stat-bar');
  if (!p.groups.length) {
    bar.innerHTML = '';
    bar.style.display = 'none';
    $('#stat-bar-info').textContent = '';
  } else {
    bar.style.display = 'flex';
    bar.innerHTML = '<div class="bar-seg linked" style="flex:' + linked + '"></div>'
      + (unlinked ? '<div class="bar-seg unlinked" style="flex:' + unlinked + '"></div>' : '');
    $('#stat-bar-info').textContent = unlinked
      ? unlinked + ' Adressen ohne Objekt'
      : 'alle Adressen sind belegt';
  }

  const btn = $('#btn-issues');
  const all = [...issueMap.values()].flat();
  const errs = all.filter(i => i.level === 'error').length;
  const warns = all.filter(i => i.level === 'warn').length;
  btn.hidden = !all.length;
  btn.className = 'issues' + (errs ? ' error' : warns ? '' : ' info');
  btn.textContent = errs ? `${errs} Fehler · ${warns} Hinweise`
    : warns ? `${warns} Hinweise`
    : `${all.length} Anmerkungen`;
  btn.title = 'Alle Auffälligkeiten anzeigen';
}

function chips(names, max = 3) {
  if (!names.length) return '<span class="room-chip empty">—</span>';
  return names.slice(0, max).map(n => '<span class="room-chip">' + esc(n) + '</span>').join('')
    + (names.length > max
      ? '<span class="room-chip more" title="' + esc(names.join(', ')) + '">+' +
        (names.length - max) + '</span>' : '');
}
function moveTreeSel(delta) {
  if (!visibleRows.length) return;
  let idx = visibleRows.findIndex(r => sameRef(r.ref, state.sel));
  idx = Math.min(Math.max(idx + delta, 0), visibleRows.length - 1);
  const ref = visibleRows[idx] && visibleRows[idx].ref;
  if (!ref) return;
  ref.kind === 'node' ? A.selectNode(ref.id) : A.select(ref.kind, ref.id);
  scrollTreeTo(idx);
  document.querySelector('.tree-node.sel .tree-row')?.focus();
}


/* ============================================================
   Tabellen — virtualisiert
   ============================================================ *
 * Statt aller Zeilen wird nur der sichtbare Ausschnitt erzeugt; die
 * fehlende Höhe tragen zwei Platzhalterzeilen.                            */
const TBL_ROW_H = 33;
const TBL_PAD = 6;
let tableRows = [], tablePainted = { from: -1, to: -1 };

function paintTable() {
  const scroll = $('#ga-scroll');
  const isGa = state.mid === 'ga';
  const tbody = isGa ? $('#ga-tbody') : $('#dev-tbody');
  if (!tableRows.length) return;

  const head = scroll.querySelector('thead')?.offsetHeight || 0;
  const top = Math.max(0, scroll.scrollTop - head);
  const from = Math.max(0, Math.floor(top / TBL_ROW_H) - TBL_PAD);
  const to = Math.min(tableRows.length,
    Math.ceil((top + scroll.clientHeight) / TBL_ROW_H) + TBL_PAD);
  if (from === tablePainted.from && to === tablePainted.to) return;
  tablePainted = { from, to };

  const frag = document.createDocumentFragment();
  if (from > 0) frag.appendChild(spacer(from * TBL_ROW_H, isGa));
  for (let i = from; i < to; i++)
    frag.appendChild(isGa ? gaRow(tableRows[i]) : devRow(tableRows[i]));
  if (to < tableRows.length) frag.appendChild(spacer((tableRows.length - to) * TBL_ROW_H, isGa));
  tbody.replaceChildren(frag);
}
function spacer(h, isGa) {
  const tr = document.createElement('tr');
  tr.className = 'row-spacer';
  tr.innerHTML = `<td colspan="${isGa ? 7 : 6}" style="height:${h}px"></td>`;
  return tr;
}

/* ============================================================
   Tabelle — Gruppenadressen
   ============================================================ */
function gaRow(ga) {
  const checked = state.checked.has(ga.id);
  const dpt = KNX.dptById(ga.dpt);
  const links = KNX.gaLinks(ga.id);

  const tr = document.createElement('tr');
  tr.className = (sameRef(state.sel, { kind: 'ga', id: ga.id }) ? 'sel' : '') + (checked ? ' checked' : '');
  tr.dataset.ptId = 'ga-' + ga.id;
  tr.tabIndex = -1;
  tr.onclick = () => A.select('ga', ga.id);
  tr.ondblclick = () => G.actEditGa(ga.id);

  const tdC = document.createElement('td');
  tdC.className = 'cell-chk';
  const cb = document.createElement('input');
  cb.type = 'checkbox'; cb.className = 'row-chk'; cb.checked = checked;
  cb.title = 'Für Mehrfachlöschung markieren';
  cb.onclick = e => {
    e.stopPropagation();
    checked ? state.checked.delete(ga.id) : state.checked.add(ga.id);
    renderGaTable();
  };
  tdC.appendChild(cb);

  const tdA = document.createElement('td');
  tdA.className = 'cell-addr';
  tdA.innerHTML = '<span class="addr">' + KNX.addrStr(ga) + '</span>';
  const badge = issueBadge(ga.id);
  if (badge) tdA.appendChild(badge);

  const tdN = document.createElement('td');
  tdN.className = 'cell-name';
  tdN.innerHTML = esc(ga.name) + (ga.note ? ' <span class="ga-note">' + esc(ga.note) + '</span>' : '');

  const tdD = document.createElement('td');
  tdD.className = 'cell-dpt';
  tdD.innerHTML = '<span class="dpt-tag" title="' + esc(dpt.name + ' — ' + dpt.desc) + '">' + dpt.id + '</span>';

  const tdO = document.createElement('td');
  tdO.className = 'cell-objs';
  if (!links.length) tdO.innerHTML = '<span class="room-chip empty">—</span>';
  else {
    const send = links.find(l => l.sending);
    const title = links.map(l => (l.sending ? '↑ ' : '↓ ') + KNX.paStr(l.dev.addr) +
      '  ' + l.dev.name + ' · ' + l.obj.name).join('\n');
    tdO.innerHTML = send
      ? `<span class="room-chip send" title="${esc(title)}">↑ ${KNX.paStr(send.dev.addr)}` +
        (links.length > 1 ? ` ·${links.length}` : '') + '</span>'
      : `<span class="room-chip empty" title="${esc('kein sendendes Objekt\n' + title)}">↑ — ·${links.length}</span>`;
  }

  const tdR = document.createElement('td');
  tdR.className = 'cell-rooms';
  tdR.innerHTML = chips(KNX.gaRooms(ga.id).map(r => r.name), 1);

  const tdX = document.createElement('td');
  tdX.className = 'cell-act';
  tdX.appendChild(iconBtn(A.IC_LINK, 'Objekte zuordnen', () => G.actAssignGa(ga.id)));
  tdX.appendChild(iconBtn(A.IC_PENCIL, 'Bearbeiten', () => G.actEditGa(ga.id)));
  tdX.appendChild(iconBtn(A.IC_TRASH, 'Löschen', () => G.actDeleteGa(ga.id)));

  tr.append(tdC, tdA, tdN, tdD, tdO, tdR, tdX);
  return tr;
}

function renderGaTable() {
  const tbody = $('#ga-tbody');
  const gs = A.visibleGAs();
  tableRows = gs;
  tablePainted = { from: -1, to: -1 };
  if (!gs.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="7" class="empty-row">' +
      (state.search ? 'Keine Adresse passt zur Suche.'
        : state.filter ? 'Keine Adressen in diesem Bereich.'
        : 'Noch keine Gruppenadressen. Oben rechts auf <b>+ Adresse</b> klicken.') + '</td>';
    tbody.replaceChildren(tr);
  } else paintTable();
  $('#ga-count').textContent = gs.length + ' / ' + KNX.project().groups.length;
  syncSelButton(gs);
}

/* ============================================================
   Tabelle — Geräte
   ============================================================ */
function devRow(d) {
  const room = d.roomId ? KNX.findNode(d.roomId) : null;
  const tr = document.createElement('tr');
  tr.className = sameRef(state.sel, { kind: 'dev', id: d.id }) ? 'sel' : '';
  tr.dataset.ptId = 'dev-' + d.id;
  tr.tabIndex = -1;
  tr.onclick = () => A.select('dev', d.id);
  tr.ondblclick = () => T.actEditDevice(d.id);

  const tdA = document.createElement('td');
  tdA.className = 'cell-addr';
  tdA.innerHTML = '<span class="addr">' + KNX.paStr(d.addr) + '</span>';
  const badge = issueBadge(d.id);
  if (badge) tdA.appendChild(badge);

  const tdN = document.createElement('td');
  tdN.className = 'cell-name';
  tdN.innerHTML = esc(d.name) + (d.product ? ' <span class="ga-note">' + esc(d.product) + '</span>' : '');

  const tdL = document.createElement('td');
  tdL.innerHTML = '<span class="dpt-tag">' + esc(KNX.lineLabel(d.lineId)) + '</span>';

  const tdR = document.createElement('td');
  tdR.className = 'cell-rooms';
  tdR.innerHTML = room ? chips([room.name]) : '<span class="room-chip empty">ohne Raum</span>';

  const tdO = document.createElement('td');
  tdO.className = 'cell-objs';
  const linked = d.objs.filter(o => o.gas.length).length;
  tdO.innerHTML = d.objs.length
    ? '<span class="room-chip' + (linked < d.objs.length ? ' more' : '') + '" title="' +
      esc(d.objs.map(o => o.num + '  ' + o.name + '  ' + KNX.flagStr(o.flags)).join('\n')) + '">' +
      linked + '/' + d.objs.length + '\u00A0KO</span>'
    : '<span class="room-chip empty">—</span>';

  const tdX = document.createElement('td');
  tdX.className = 'cell-act';
  tdX.appendChild(iconBtn('+', 'Neues Kommunikationsobjekt', () => T.actNewObj(d.id)));
  tdX.appendChild(iconBtn(A.IC_PENCIL, 'Bearbeiten', () => T.actEditDevice(d.id)));
  tdX.appendChild(iconBtn(A.IC_TRASH, 'Löschen', () => T.actDeleteDevice(d.id)));

  tr.append(tdA, tdN, tdL, tdR, tdO, tdX);
  return tr;
}

function renderDevTable() {
  const tbody = $('#dev-tbody');
  const ds = A.visibleDevices();
  tableRows = ds;
  tablePainted = { from: -1, to: -1 };
  if (!ds.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="6" class="empty-row">' +
      (state.search ? 'Kein Gerät passt zur Suche.'
        : state.filter ? 'Keine Geräte in diesem Bereich.'
        : 'Noch keine Geräte. Oben rechts auf <b>+ Gerät</b> klicken.') + '</td>';
    tbody.replaceChildren(tr);
  } else paintTable();
  $('#ga-count').textContent = ds.length + ' / ' + KNX.project().devices.length;
}

function renderTable() {
  const isGa = state.mid === 'ga';
  $('#tbl-ga').hidden = !isGa;
  $('#tbl-dev').hidden = isGa;
  $('#btn-add-row').textContent = isGa ? '+ Adresse' : '+ Gerät';
  document.querySelectorAll('.tab[data-mid]').forEach(t =>
    t.classList.toggle('on', (t.dataset.mid === 'ga') === isGa));
  if (isGa) renderGaTable();
  else { renderDevTable(); $('#btn-del-sel').hidden = true; }
}

function syncSelButton(gs) {
  const n = state.checked.size;
  const btn = $('#btn-del-sel');
  btn.hidden = !n;
  btn.textContent = n ? 'Löschen (' + n + ')' : '';
  const head = $('#chk-all');
  head.checked = gs.length > 0 && gs.every(g => state.checked.has(g.id));
  head.indeterminate = gs.some(g => state.checked.has(g.id)) && !head.checked;
}

function renderSortHead() {
  document.querySelectorAll('th.sortable').forEach(th => {
    th.classList.remove('sorted');
    const a = th.querySelector('.arrow'); if (a) a.textContent = '';
  });
  const tbl = state.mid === 'ga' ? '#tbl-ga' : '#tbl-dev';
  const th = document.querySelector(tbl + ' th[data-key="' + state.sort.key + '"]');
  if (th) {
    th.classList.add('sorted');
    th.querySelector('.arrow').textContent = state.sort.dir === 1 ? ' ↑' : ' ↓';
  }
}

function renderFilter() {
  const bar = $('#filter-bar');
  const f = state.filter;
  if (!f || !A.resolve(f)) {
    if (f) state.filter = null;
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  $('#ga-filter-info').textContent = '∎ ' + filterLabel(f);
}
function filterLabel(f) {
  switch (f.kind) {
    case 'node': return KNX.nodePath(f.id)?.sub || '';
    case 'line': return 'Linie ' + KNX.lineLabel(f.id);
    case 'area': return 'Bereich ' + (KNX.project().areas.find(a => a.id === f.id)?.name || '');
    case 'dev':  return 'Gerät ' + (KNX.deviceById(f.id)?.name || '');
    case 'grp':  return (KNX.project().gaNames[f.id] || 'Gruppe') + ' ' + f.id;
    default:     return '';
  }
}

/* ============================================================
   Detailbereich
   ============================================================ */
function detailEmpty() {
  return `
    <h2 data-pt-id="detail-empty-title">Willkommen</h2>
    <p class="detail-lead">Der Editor arbeitet mit den drei Sichten der ETS:</p>
    <ol class="detail-steps">
      <li><b>Gebäude</b> — wo etwas verbaut ist: Gebäude, Geschosse, Räume, Verteiler.</li>
      <li><b>Topologie</b> — wie es am Bus hängt: Bereich, Linie, Teilnehmer mit
          physikalischer Adresse und Kommunikationsobjekten.</li>
      <li><b>Gruppen</b> — was es tut: Haupt- und Mittelgruppen mit den Gruppenadressen.</li>
    </ol>
    <p class="detail-lead">Eine Gruppenadresse wirkt nicht auf einen Raum, sondern auf
    <b>Kommunikationsobjekte</b> von Geräten. Der Raumbezug ergibt sich daraus, wo das
    Gerät verbaut ist. Deshalb prüft die Statusleiste laufend, ob jede Adresse genau
    ein sendendes Objekt und einen einheitlichen Datenpunkttyp hat.</p>
    <p class="hint">Alles wird lokal im Browser gespeichert. Doppelklick auf einen
    Baumeintrag öffnet den Bearbeiten-Dialog, Strg+Z macht Änderungen rückgängig.</p>`;
}

function issueList(id) {
  const is = issuesOf(id);
  if (!is.length) return '';
  return '<h3 class="detail-h">Prüfung</h3><ul class="issue-list">' +
    is.map(i => `<li class="${i.level}">${esc(i.msg)}</li>`).join('') + '</ul>';
}

function detailNode(node) {
  const p = KNX.project();
  const path = KNX.nodePath(node.id);
  const devs = KNX.roomIdsUnder(node.id).flatMap(r => KNX.devicesInRoom(r));
  const gaSet = new Set();
  devs.forEach(d => d.objs.forEach(o => o.gas.forEach(x => gaSet.add(x))));
  const holds = KNX.kindHolds(node.kind);
  return `
    <div class="detail-head">
      <span class="lvl-ic ${node.kind} big">${A.IC[node.kind] || A.IC.room}</span>
      <div>
        <h2 data-pt-id="detail-node-title">${esc(node.name)}</h2>
        <p class="detail-sub">${esc(KNX.kindDe(node.kind))} · ${esc(path.trail)}</p>
      </div>
    </div>
    <div class="detail-meta">
      <div class="meta-item"><span class="meta-num">${devs.length}</span><span class="meta-lbl">Geräte darunter</span></div>
      <div class="meta-item"><span class="meta-num">${gaSet.size}</span><span class="meta-lbl">Adressen wirksam</span></div>
    </div>
    <div class="detail-actions">
      <button class="btn btn-sm" id="d-rename">${A.IC_PENCIL} Bearbeiten</button>
      ${holds.length ? '<button class="btn btn-sm" id="d-add">+ Untergeordnet</button>' : ''}
      ${KNX.DEVICE_HOSTS.has(node.kind) ? '<button class="btn btn-sm" id="d-adddev">+ Gerät</button>' : ''}
      ${node.id !== p.tree.id
        ? '<button class="btn btn-sm btn-danger" id="d-delete">' + A.IC_TRASH + ' Löschen</button>' : ''}
    </div>
    ${devs.length
      ? '<h3 class="detail-h">Geräte</h3><ul class="detail-list">' +
        devs.map(d => `<li class="jump" data-kind="dev" data-id="${d.id}">
          <span class="addr">${KNX.paStr(d.addr)}</span>
          <span class="grow">${esc(d.name)}</span>
          <span class="dpt-tag">${d.objs.length} KO</span></li>`).join('') + '</ul>'
      : '<p class="hint">Hier ist noch kein Gerät verbaut.</p>'}`;
}

function detailGa(ga) {
  const dpt = KNX.dptById(ga.dpt);
  const links = KNX.gaLinks(ga.id);
  const rooms = KNX.gaRooms(ga.id);
  return `
    <div class="detail-head">
      <span class="addr big">${KNX.addrStr(ga)}</span>
      <div>
        <h2 data-pt-id="detail-ga-title">${esc(ga.name)}</h2>
        <p class="detail-sub"><span class="dpt-tag">${dpt.id}</span> ${esc(dpt.name)} · ${esc(dpt.desc)}</p>
      </div>
    </div>
    <div class="detail-meta">
      <div class="meta-item"><span class="meta-num">${links.length}</span><span class="meta-lbl">Objekte</span></div>
      <div class="meta-item"><span class="meta-num">${rooms.length}</span><span class="meta-lbl">Räume</span></div>
    </div>
    <div class="detail-actions">
      <button class="btn btn-sm" id="d-assign">${A.IC_LINK} Objekte zuordnen</button>
      <button class="btn btn-sm" id="d-rename">${A.IC_PENCIL} Bearbeiten</button>
      <button class="btn btn-sm btn-danger" id="d-delete">${A.IC_TRASH} Löschen</button>
    </div>
    ${issueList(ga.id)}
    <h3 class="detail-h">Zugeordnete Objekte</h3>
    ${links.length
      ? '<ul class="detail-list">' + links.map(l => `
          <li class="jump" data-kind="obj" data-id="${l.obj.id}">
            <span class="dir ${l.sending ? 'send' : 'recv'}" title="${l.sending ? 'sendendes Objekt' : 'hörendes Objekt'}">${l.sending ? '↑' : '↓'}</span>
            <span class="addr">${KNX.paStr(l.dev.addr)}</span>
            <span class="grow">${esc(l.dev.name)} · ${esc(l.obj.name)}</span>
            <span class="dpt-tag${l.obj.dpt === ga.dpt ? '' : ' bad'}">${l.obj.dpt}</span>
            <span class="flags">${KNX.flagStr(l.obj.flags)}</span>
          </li>`).join('') + '</ul>'
      : '<p class="hint">Kein Objekt zugeordnet — die Adresse ist wirkungslos.</p>'}
    ${rooms.length
      ? '<h3 class="detail-h">Wirksam in</h3><ul class="detail-list">' + rooms.map(r =>
          `<li class="jump" data-kind="node" data-id="${r.id}">${esc(KNX.nodePath(r.id).sub)}</li>`).join('') + '</ul>'
      : ''}
    ${ga.note ? '<p class="hint">Notiz: ' + esc(ga.note) + '</p>' : ''}`;
}

function detailDev(d) {
  const room = d.roomId ? KNX.findNode(d.roomId) : null;
  return `
    <div class="detail-head">
      <span class="addr big">${KNX.paStr(d.addr)}</span>
      <div>
        <h2 data-pt-id="detail-dev-title">${esc(d.name)}</h2>
        <p class="detail-sub">${esc(d.product || 'ohne Produktangabe')} · Linie ${esc(KNX.lineLabel(d.lineId))}
          · ${room ? esc(KNX.nodePath(room.id).sub) : '<b>kein Raum</b>'}</p>
      </div>
    </div>
    <div class="detail-meta">
      <div class="meta-item"><span class="meta-num">${d.objs.length}</span><span class="meta-lbl">Objekte</span></div>
      <div class="meta-item"><span class="meta-num">${d.objs.reduce((s, o) => s + o.gas.length, 0)}</span><span class="meta-lbl">Adresszuordnungen</span></div>
    </div>
    <div class="detail-actions">
      <button class="btn btn-sm" id="d-addobj">+ Objekt</button>
      <button class="btn btn-sm" id="d-rename">${A.IC_PENCIL} Bearbeiten</button>
      <button class="btn btn-sm btn-danger" id="d-delete">${A.IC_TRASH} Löschen</button>
    </div>
    ${issueList(d.id)}
    <h3 class="detail-h">Kommunikationsobjekte</h3>
    ${d.objs.length
      ? '<ul class="detail-list">' + d.objs.map(o => {
          const send = o.gas[0] ? KNX.gaById(o.gas[0]) : null;
          return `<li class="jump" data-kind="obj" data-id="${o.id}">
            <span class="onum">${o.num}</span>
            <span class="grow">${esc(o.name)}</span>
            ${send ? '<span class="addr">' + KNX.addrStr(send) + '</span>'
                   : '<span class="room-chip empty">—</span>'}
            <span class="dpt-tag">${o.dpt}</span>
            <span class="flags">${KNX.flagStr(o.flags)}</span></li>`;
        }).join('') + '</ul>'
      : '<p class="hint">Noch keine Objekte angelegt.</p>'}`;
}

function detailObj(dev, o) {
  const gas = o.gas.map(x => KNX.gaById(x)).filter(Boolean);
  return `
    <div class="detail-head">
      <span class="lvl-ic obj big">${A.IC.obj}</span>
      <div>
        <h2 data-pt-id="detail-obj-title">${esc(o.name)}</h2>
        <p class="detail-sub">Objekt ${o.num} von ${esc(dev.name)} · ${KNX.paStr(dev.addr)}</p>
      </div>
    </div>
    <div class="flag-row">${KNX.KO_FLAGS.map(f =>
      `<span class="flag-chip${o.flags[f.key] ? ' on' : ''}" title="${esc(f.de + ' — ' + f.desc)}">${f.short}</span>`).join('')}
      <span class="dpt-tag">${o.dpt}</span>
    </div>
    <div class="detail-actions">
      <button class="btn btn-sm" id="d-assign">${A.IC_LINK} Adressen zuordnen</button>
      <button class="btn btn-sm" id="d-rename">${A.IC_PENCIL} Bearbeiten</button>
      <button class="btn btn-sm btn-danger" id="d-delete">${A.IC_TRASH} Löschen</button>
    </div>
    <h3 class="detail-h">Adressen</h3>
    ${gas.length
      ? '<ul class="detail-list">' + gas.map((g, i) => `
          <li>
            <span class="dir ${i === 0 && o.flags.t ? 'send' : 'recv'}">${i === 0 && o.flags.t ? '↑' : '↓'}</span>
            <span class="addr jump" data-kind="ga" data-id="${g.id}">${KNX.addrStr(g)}</span>
            <span class="grow">${esc(g.name)}</span>
            <span class="dpt-tag${g.dpt === o.dpt ? '' : ' bad'}">${g.dpt}</span>
            ${i === 0 ? '' : `<button class="btn btn-sm setsend" data-ga="${g.id}" title="Diese Adresse zur sendenden machen">↑</button>`}
          </li>`).join('') + '</ul>' +
        (o.flags.t ? '<p class="hint">Die oberste Adresse ist die sendende.</p>'
                   : '<p class="hint warn">Ohne Ü-Flag sendet dieses Objekt nicht.</p>')
      : '<p class="hint">Keine Adresse zugeordnet.</p>'}`;
}

function detailLine(l) {
  const a = KNX.areaOfLine(l.id);
  const devs = KNX.devicesOnLine(l.id);
  return `
    <div class="detail-head">
      <span class="addr big">${a.addr}.${l.addr}</span>
      <div>
        <h2>${esc(l.name)}</h2>
        <p class="detail-sub">Linie in Bereich ${esc(a.name)} · ${esc(KNX.MEDIA[l.medium])}</p>
      </div>
    </div>
    <div class="detail-meta">
      <div class="meta-item"><span class="meta-num">${devs.length}</span><span class="meta-lbl">Teilnehmer</span></div>
      <div class="meta-item"><span class="meta-num">${255 - devs.length}</span><span class="meta-lbl">freie Nummern</span></div>
    </div>
    <div class="detail-actions">
      <button class="btn btn-sm" id="d-adddev">+ Gerät</button>
      <button class="btn btn-sm" id="d-rename">${A.IC_PENCIL} Bearbeiten</button>
      <button class="btn btn-sm btn-danger" id="d-delete">${A.IC_TRASH} Löschen</button>
    </div>
    ${issueList(l.id)}
    ${devs.length
      ? '<h3 class="detail-h">Teilnehmer</h3><ul class="detail-list">' +
        devs.slice().sort((x, y) => x.addr - y.addr).map(d =>
          `<li class="jump" data-kind="dev" data-id="${d.id}">
            <span class="addr">${KNX.paStr(d.addr)}</span>
            <span class="grow">${esc(d.name)}</span>
            <span class="dpt-tag">${d.objs.length} KO</span></li>`).join('') + '</ul>'
      : '<p class="hint">Noch keine Geräte auf dieser Linie.</p>'}`;
}

function detailArea(a) {
  const devs = a.lines.flatMap(l => KNX.devicesOnLine(l.id));
  return `
    <div class="detail-head">
      <span class="addr big">${a.addr}</span>
      <div>
        <h2>${esc(a.name)}</h2>
        <p class="detail-sub">Bereich · ${a.lines.length} Linien</p>
      </div>
    </div>
    <div class="detail-meta">
      <div class="meta-item"><span class="meta-num">${a.lines.length}</span><span class="meta-lbl">Linien</span></div>
      <div class="meta-item"><span class="meta-num">${devs.length}</span><span class="meta-lbl">Teilnehmer</span></div>
    </div>
    <div class="detail-actions">
      <button class="btn btn-sm" id="d-addline">+ Linie</button>
      <button class="btn btn-sm" id="d-rename">${A.IC_PENCIL} Bearbeiten</button>
      <button class="btn btn-sm btn-danger" id="d-delete">${A.IC_TRASH} Löschen</button>
    </div>
    <h3 class="detail-h">Linien</h3>
    <ul class="detail-list">${a.lines.slice().sort((x, y) => x.addr - y.addr).map(l =>
      `<li class="jump" data-kind="line" data-id="${l.id}">
        <span class="addr">${a.addr}.${l.addr}</span>
        <span class="grow">${esc(l.name)}</span>
        <span class="dpt-tag">${KNX.devicesOnLine(l.id).length} T</span></li>`).join('')}</ul>`;
}

function detailGrp(key) {
  const p = KNX.project();
  const style = KNX.gaStyle();
  const level = String(key).split('/').length - 1;
  const pre = String(key).split('/').map(Number);
  const gs = p.groups.filter(g => {
    const v = KNX.gaSplit(g.raw, style);
    return pre.every((x, i) => v[i] === x);
  }).sort((a, b) => a.raw - b.raw);
  return `
    <div class="detail-head">
      <span class="addr big">${esc(key)}</span>
      <div>
        <h2>${esc(p.gaNames[key] || '(ohne Namen)')}</h2>
        <p class="detail-sub">${esc(style.parts[level]?.label || 'Gruppe')} · ${gs.length} Adressen</p>
      </div>
    </div>
    <div class="detail-actions">
      <button class="btn btn-sm" id="d-rename">${A.IC_PENCIL} Benennen</button>
      <button class="btn btn-sm" id="d-addga">+ Adresse</button>
    </div>
    ${gs.length
      ? '<h3 class="detail-h">Adressen</h3><ul class="detail-list">' + gs.map(g =>
          `<li class="jump" data-kind="ga" data-id="${g.id}">
            <span class="addr">${KNX.addrStr(g)}</span>
            <span class="grow">${esc(g.name)}</span>
            <span class="dpt-tag">${g.dpt}</span></li>`).join('') + '</ul>'
      : '<p class="hint">Diese Gruppe ist noch leer.</p>'}`;
}

function renderDetail() {
  const panel = $('#detail');
  const sel = state.sel;
  const target = sel && A.resolve(sel);
  if (!target) {
    if (sel) state.sel = null;
    panel.innerHTML = detailEmpty();
    return;
  }
  const on = (id, fn) => $(id)?.addEventListener('click', fn);

  if (sel.kind === 'node') {
    panel.innerHTML = detailNode(target);
    on('#d-rename', () => A.actRenameNode(target.id));
    on('#d-delete', () => A.actDeleteNode(target.id));
    on('#d-add', () => A.actNewNode(target.id));
    on('#d-adddev', () => T.actNewDevice({ roomId: target.id }));
  } else if (sel.kind === 'ga') {
    panel.innerHTML = detailGa(target);
    on('#d-assign', () => G.actAssignGa(target.id));
    on('#d-rename', () => G.actEditGa(target.id));
    on('#d-delete', () => G.actDeleteGa(target.id));
  } else if (sel.kind === 'dev') {
    panel.innerHTML = detailDev(target);
    on('#d-addobj', () => T.actNewObj(target.id));
    on('#d-rename', () => T.actEditDevice(target.id));
    on('#d-delete', () => T.actDeleteDevice(target.id));
  } else if (sel.kind === 'obj') {
    panel.innerHTML = detailObj(target.dev, target.obj);
    on('#d-assign', () => T.actAssignObj(target.obj.id));
    on('#d-rename', () => T.actEditObj(target.obj.id));
    on('#d-delete', () => T.actDeleteObj(target.obj.id));
    panel.querySelectorAll('.setsend').forEach(b =>
      b.addEventListener('click', e => {
        e.stopPropagation();
        T.actSetSending(target.obj.id, b.dataset.ga);
      }));
  } else if (sel.kind === 'line') {
    panel.innerHTML = detailLine(target);
    on('#d-adddev', () => T.actNewDevice({ lineId: target.id }));
    on('#d-rename', () => T.actEditLine(target.id));
    on('#d-delete', () => T.actDeleteLine(target.id));
  } else if (sel.kind === 'area') {
    panel.innerHTML = detailArea(target);
    on('#d-addline', () => T.actNewLine(target.id));
    on('#d-rename', () => T.actEditArea(target.id));
    on('#d-delete', () => T.actDeleteArea(target.id));
  } else if (sel.kind === 'grp') {
    panel.innerHTML = detailGrp(sel.id);
    on('#d-rename', () => T.actRenameGaGroup(sel.id));
    on('#d-addga', () => G.actNewGa());
  }

  panel.querySelectorAll('.jump').forEach(el => {
    el.classList.add('clickable');
    el.addEventListener('click', ev => {
      ev.stopPropagation();
      jumpTo(el.dataset.kind, el.dataset.id);
    });
  });
}

/* Springt zu einem Element und schaltet dafür nötigenfalls die Ansicht um. */
function jumpTo(kind, id) {
  if (kind === 'node') state.view = 'building';
  else if (['dev', 'obj', 'line', 'area'].includes(kind)) state.view = 'topology';
  else if (kind === 'grp') state.view = 'ga';
  if (kind === 'ga') state.mid = 'ga';
  if (kind === 'dev') state.mid = 'dev';
  expandTo(kind, id);
  A.select(kind, id);
}
function expandTo(kind, id) {
  const openLine = lineId => {
    state.collapsed.delete(lineId);
    const a = KNX.areaOfLine(lineId);
    if (a) state.collapsed.delete(a.id);
  };
  if (kind === 'obj') {
    const e = KNX.objById(id);
    if (e) { state.collapsed.delete(e.dev.id); openLine(e.dev.lineId); }
  } else if (kind === 'dev') {
    const d = KNX.deviceById(id);
    if (d) openLine(d.lineId);
  } else if (kind === 'node') {
    let cur = KNX.parentOf(id);
    while (cur) { state.collapsed.delete(cur.id); cur = KNX.parentOf(cur.id); }
  }
}

/* ---------- Master ---------- */
function render() {
  issueMap = new Map();
  KNX.issues().forEach(i => {
    const a = issueMap.get(i.id);
    a ? a.push(i) : issueMap.set(i.id, [i]);
  });
  renderTree();
  renderStats();
  renderTable();
  renderSortHead();
  renderFilter();
  renderDetail();
}
window.KNXOnRender = render;
window.KNXRender = { render, jumpTo, moveTreeSel, paintTreeViewport, paintTable,
                     issues: () => issueMap };

})();

