/* ============================================================
   KNX-Struktur — Rendering: Bäume, Tabellen, Details
   ============================================================ */
'use strict';

(() => {
const A = window.KNXApp, G = window.KNXGA, T = window.KNXTopo, F = window.KNXFn, $ = s => document.querySelector(s);
/* Datentyp beim Ziehen von Gruppenadressen auf eine Gruppe im Baum */
const GA_DRAG = 'application/x-knx-ga';
/* Umhängen in der Gebäudeansicht: Knoten, Funktionen, Geräte. Was gezogen wird,
   steht zusätzlich hier — beim Überfahren gibt der Browser die Daten nicht preis,
   die Ablagestelle soll aber schon dann zeigen, ob sie passt.              */
const ITEM_DRAG = 'application/x-knx-item';
let dragItem = null;
document.addEventListener('dragend', () => { dragItem = null; });
function startItemDrag(e, item) {
  dragItem = item;
  e.dataTransfer.setData(ITEM_DRAG, item.type + ':' + item.id);
  e.dataTransfer.effectAllowed = 'move';
}
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

  if (o.dragGa) {
    row.draggable = true;
    row.ondragstart = e => {
      const ids = state.checked.has(o.dragGa) ? [...state.checked] : [o.dragGa];
      e.dataTransfer.setData(GA_DRAG, JSON.stringify(ids));
      e.dataTransfer.effectAllowed = 'move';
    };
  }
  // Auf eine Gruppe gezogen verschiebt die Adressen, auf eine Funktion ordnet sie zu
  if (o.dropKey || o.dropFn) {
    const accepts = e => [...e.dataTransfer.types].includes(GA_DRAG);
    row.ondragover = e => { if (accepts(e)) { e.preventDefault(); row.classList.add('drop'); } };
    row.ondragleave = () => row.classList.remove('drop');
    row.ondrop = e => {
      row.classList.remove('drop');
      if (!accepts(e)) return;
      e.preventDefault();
      const ids = JSON.parse(e.dataTransfer.getData(GA_DRAG));
      if (o.dropFn) F.dropGas(ids, o.dropFn);
      else G.moveGasTo(ids, o.dropKey);
    };
  }

  if (o.drag) {
    row.draggable = true;
    row.ondragstart = e => startItemDrag(e, o.drag);
  }
  if (o.dropItem) {
    const zone = e => { const r = row.getBoundingClientRect(); return (e.clientY - r.top) / r.height; };
    const clear = () => row.classList.remove('drop', 'drop-before', 'drop-after');
    row.addEventListener('dragover', e => {
      if (!dragItem) return;
      const plan = o.dropItem(dragItem, zone(e));
      clear();
      if (plan) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; row.classList.add(plan.cls); }
    });
    row.addEventListener('dragleave', clear);
    row.addEventListener('drop', e => {
      if (!dragItem) return;
      const plan = o.dropItem(dragItem, zone(e));
      clear();
      dragItem = null;
      if (plan) { e.preventDefault(); plan.run(); }
    });
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
  const fns = KNX.functionsAt(node.id);
  const inRoom = KNX.DEVICE_HOSTS.has(node.kind) ? KNX.devicesInRoom(node.id) : [];

  emit({
    depth, key: node.id, ref: { kind: 'node', id: node.id },
    icon: A.IC[node.kind] || A.IC.room, iconClass: node.kind,
    label: node.name, title: KNX.kindDe(node.kind),
    meta: devs ? devs + '\u00A0G' : '',
    hasKids: (node.children || []).length + fns.length + inRoom.length > 0,
    collapsed: state.collapsed.has(node.id),
    actions: () => {
      const a = [];
      if (!isRoot) a.push(iconBtn(A.IC_TRASH, 'Löschen', () => A.actDeleteNode(node.id)));
      if (KNX.DEVICE_HOSTS.has(node.kind))
        a.push(iconBtn(A.IC.device, 'Gerät hier verbauen', () => T.actNewDevice({ roomId: node.id })));
      a.push(iconBtn(KNXIcons.svg('shapes', 13), 'Neue Funktion', () => F.actNewFunction(node.id)));
      a.push(iconBtn('+', holds.length ? 'Untergeordnetes Element' : 'Keine Unterteilung möglich',
        () => A.actNewNode(node.id), !holds.length));
      return a;
    },
    drag: isRoot ? null : { type: 'node', id: node.id },
    dropItem: (item, y) => dropOnNode(node, item, y),
    onSelect: () => A.selectNode(node.id),
    onEdit: () => A.actRenameNode(node.id),
    children: () => {
      node.children.forEach(c => buildingNode(c, depth + 1));
      fns.forEach(f => fnNode(f, depth + 1));
      inRoom.slice().sort(KNX.byPa).forEach(d => deviceNode(d, depth + 1, true));
    }
  });
}

/* Was passiert, wenn `item` auf dem Knoten landet. Knoten gehen hinein, wenn
   der Typ passt; am oberen oder unteren Rand der Zeile daneben — so lässt sich
   auch die Reihenfolge ändern. → { cls, run } oder null                    */
function dropOnNode(node, item, y) {
  if (item.type === 'node') {
    if (item.id === node.id) return null;
    const par = KNX.parentOf(node.id);
    const into = !KNX.nodeMoveError(item.id, node.id);
    const side = !!par && !KNX.nodeMoveError(item.id, par.id);
    const intoPlan = { cls: 'drop', run: () => A.moveNode(item.id, node.id) };
    const sidePlan = where => ({ cls: 'drop-' + where, run: () => A.moveNode(item.id, par.id, node.id, where) });
    if (into && side) return y < 0.25 ? sidePlan('before') : y > 0.75 ? sidePlan('after') : intoPlan;
    if (into) return intoPlan;
    if (side) return sidePlan(y < 0.5 ? 'before' : 'after');
    return null;
  }
  if (item.type === 'fn') return { cls: 'drop', run: () => F.moveFunction(item.id, node.id) };
  if (item.type === 'dev')
    return KNX.DEVICE_HOSTS.has(node.kind) && KNX.deviceById(item.id)?.roomId !== node.id
      ? { cls: 'drop', run: () => A.setDeviceRoom(item.id, node.id) } : null;
  return null;
}

/* Funktionen stehen unter ihrem Raum; aufgeklappt zeigen sie ihre Adressen.
   Anders als Räume starten sie zugeklappt — der Merker heißt deshalb „offen“. */
function fnNode(fn, depth) {
  const t = KNX.fnType(fn.type);
  const open = 'fn-open:' + fn.id;
  emit({
    depth, key: open, ref: { kind: 'fn', id: fn.id },
    icon: KNXIcons.svg(KNX.fnIcon(fn), 15), iconClass: 'fn-ic fn-' + t.cat,
    label: fn.name, title: t.de,
    meta: fn.gas.length ? fn.gas.length + '\u00A0GA' : '',
    hasKids: fn.gas.length > 0, collapsed: !state.collapsed.has(open),
    actions: () => [
      iconBtn(A.IC_TRASH, 'Funktion löschen', () => F.actDeleteFunction(fn.id)),
      iconBtn(A.IC_LINK, 'Adressen zuordnen', () => F.actAssignFunctionGas(fn.id))
    ],
    dropFn: fn.id,
    drag: { type: 'fn', id: fn.id },
    dropItem: (item, y) => {
      if (item.type === 'fn')
        return item.id === fn.id ? null : { cls: y < 0.5 ? 'drop-before' : 'drop-after',
          run: () => F.moveFunction(item.id, fn.nodeId, fn.id, y < 0.5 ? 'before' : 'after') };
      return item.type === 'dev' ? dropOnNode(KNX.findNode(fn.nodeId), item, 0.5) : null;
    },
    onSelect: () => { state.filter = { kind: 'fn', id: fn.id }; A.select('fn', fn.id); },
    onEdit: () => F.actEditFunction(fn.id),
    children: () => fn.gas.forEach(x => {
      const g = KNX.gaById(x.ga);
      const r = KNX.fnRole(fn, x.role);
      if (g) gaLeafNode(g, depth + 1, { key: 'fn:' + fn.id + ':' + g.id, role: r ? r.de : '' });
    })
  });
}

/* ---------- Ansicht 2: Topologie ---------- */
function backboneNode(bb) {
  const devs = KNX.devicesOnLine(bb.line.id);
  const areas = KNX.regularAreas().slice().sort((x, y) => x.addr - y.addr);
  emit({
    depth: 0, key: bb.area.id, ref: { kind: 'line', id: bb.line.id },
    icon: A.IC.area, iconClass: 'area',
    label: bb.line.name, title: 'Backbone · ' + KNX.MEDIA[bb.line.medium], addr: '0.0.-',
    meta: devs.length ? devs.length + '\u00A0T' : '',
    hasKids: devs.length + areas.length + KNX.segmentsOf(bb.line).length > 0, collapsed: state.collapsed.has(bb.area.id),
    actions: () => [
      iconBtn(A.IC.device, 'Gerät auf dem Backbone', () => T.actNewDevice({ lineId: bb.line.id })),
      iconBtn('+', 'Neuer Bereich', () => T.actNewArea())
    ],
    onSelect: () => { state.filter = { kind: 'line', id: bb.line.id }; A.select('line', bb.line.id); },
    onEdit: () => T.actEditLine(bb.line.id),
    children: () => {
      if (KNX.segmentsOf(bb.line).length) KNX.segmentKeys(bb.line).forEach(key => segmentNode(key, 1));
      else devs.slice().sort(KNX.byPa).forEach(d => deviceNode(d, 1));
      areas.forEach(a => areaNode(a, 1));
    }
  });
}
function areaNode(a, depth = 0) {
  emit({
    depth, key: a.id, ref: { kind: 'area', id: a.id },
    icon: A.IC.area, iconClass: 'area',
    label: a.name, title: 'Bereich', addr: a.addr + '.-.-',
    hasKids: a.lines.length > 0, collapsed: state.collapsed.has(a.id),
    actions: () => [
      iconBtn(A.IC_TRASH, 'Bereich löschen', () => T.actDeleteArea(a.id)),
      iconBtn('+', 'Neue Linie', () => T.actNewLine(a.id))
    ],
    onSelect: () => { state.filter = { kind: 'area', id: a.id }; A.select('area', a.id); },
    onEdit: () => T.actEditArea(a.id),
    children: () => a.lines.slice().sort((x, y) => x.addr - y.addr).forEach(l => lineNode(a, l, depth + 1))
  });
}
function lineNode(a, l, depth = 1) {
  const devs = KNX.devicesOnLine(l.id);
  const segmented = KNX.segmentsOf(l).length > 0;
  const main = l.addr === 0;
  emit({
    depth, key: l.id, ref: { kind: 'line', id: l.id },
    icon: A.IC.line, iconClass: 'line',
    label: l.name, title: (main ? 'Hauptlinie · ' : '') + KNX.MEDIA[l.medium], addr: a.addr + '.' + l.addr + '.-',
    meta: devs.length ? devs.length + '\u00A0T' : '',
    hasKids: devs.length > 0 || segmented, collapsed: state.collapsed.has(l.id),
    actions: () => [
      ...(main ? [] : [iconBtn(A.IC_TRASH, 'Linie löschen', () => T.actDeleteLine(l.id))]),
      iconBtn('+', 'Neues Gerät', () => T.actNewDevice({ lineId: l.id }))
    ],
    onSelect: () => { state.filter = { kind: 'line', id: l.id }; A.select('line', l.id); },
    onEdit: () => T.actEditLine(l.id),
    children: () => segmented
      ? KNX.segmentKeys(l).forEach(key => segmentNode(key, depth + 1))
      : devs.slice().sort(KNX.byPa).forEach(d => deviceNode(d, depth + 1))
  });
}
/* Segmente erscheinen erst, wenn eine Linie geteilt ist — wie in der ETS. */
function segmentNode(key, depth) {
  const s = KNX.segmentInfo(key);
  const devs = KNX.devicesInSegment(key);
  emit({
    depth, key: 'seg:' + key, ref: { kind: 'seg', id: key },
    icon: A.IC.line, iconClass: 'line',
    label: s.seg ? s.name : 'Segment 0', title: 'Segment · ' + KNX.MEDIA[s.medium],
    addr: 'S' + s.num,
    meta: devs.length ? devs.length + '\u00A0T' : '',
    hasKids: devs.length > 0, collapsed: state.collapsed.has('seg:' + key),
    actions: () => [
      ...(s.seg ? [iconBtn(A.IC_TRASH, 'Segment löschen', () => T.actDeleteSegment(key))] : []),
      iconBtn('+', 'Neues Gerät', () => T.actNewDevice({ lineId: s.line.id, segmentId: s.seg ? key : null }))
    ],
    onSelect: () => { state.filter = { kind: 'seg', id: key }; A.select('seg', key); },
    onEdit: () => T.actEditSegment(key),
    children: () => devs.slice().sort(KNX.byPa).forEach(d => deviceNode(d, depth + 1))
  });
}

function deviceNode(d, depth, building) {
  // In der Gebäudeansicht starten Geräte zugeklappt — der Merker heißt dort „offen“
  const key = building ? 'dev-open:' + d.id : d.id;
  emit({
    depth, key, ref: { kind: 'dev', id: d.id },
    icon: A.IC.device, iconClass: 'device',
    label: d.name, title: d.product, addr: KNX.paStr(d.addr),
    meta: d.objs.length ? d.objs.length + '\u00A0KO' : '',
    hasKids: d.objs.length > 0, collapsed: building ? !state.collapsed.has(key) : state.collapsed.has(key),
    actions: () => [
      iconBtn(A.IC_TRASH, 'Gerät löschen', () => T.actDeleteDevice(d.id)),
      (d.catalogId || KNX.deviceIsIp(d))
        ? iconBtn(A.IC.params, 'Parameter', () => T.actParams(d.id))
        : iconBtn('+', 'Neues Kommunikationsobjekt', () => T.actNewObj(d.id))
    ],
    drag: building ? { type: 'dev', id: d.id } : null,
    // Gerät auf Gerät: in denselben Raum
    dropItem: building ? (item => item.type === 'dev' && item.id !== d.id
      && KNX.deviceById(item.id)?.roomId !== d.roomId
      ? { cls: 'drop', run: () => A.setDeviceRoom(item.id, d.roomId) } : null) : null,
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
  const folder = n.level === G.folderDepth() - 1;
  emit({
    depth, key: 'grp:' + n.key, ref: { kind: 'grp', id: n.key },
    icon: A.IC.area, iconClass: 'grp',
    label: n.name || '(ohne Namen)', title: n.label + ' ' + n.key, addr: n.key,
    meta: count ? String(count) : '',
    hasKids: n.children.length > 0 || n.groups.length > 0, collapsed: state.collapsed.has('grp:' + n.key),
    actions: () => [
      iconBtn(A.IC_TRASH, 'Gruppe mit allen Adressen löschen', () => G.actDeleteGaGroup(n.key)),
      iconBtn(A.IC_PENCIL, 'Benennen', () => T.actRenameGaGroup(n.key)),
      folder
        ? iconBtn('+', 'Neue Gruppenadresse', () => G.actNewGa(n.key))
        : iconBtn('+', 'Neue ' + (KNX.gaStyle().parts[n.level + 1] || {}).label, () => G.actNewGaGroup(n.key))
    ],
    dropKey: folder ? n.key : null,
    onSelect: () => { state.filter = { kind: 'grp', id: n.key }; A.select('grp', n.key); },
    onEdit: () => T.actRenameGaGroup(n.key),
    children: () => {
      n.children.forEach(c => gaGroupNode(c, depth + 1));
      n.groups.forEach(g => gaLeafNode(g, depth + 1));
    }
  });
}

/* Gruppenadresse als Blatt ihrer Gruppe — auswählen, bearbeiten, ziehen. */
function gaLeafNode(g, depth, under) {
  const links = KNX.gaLinks(g.id);
  const fn = KNX.functionsOfGa(g.id)[0];
  emit({
    depth, key: under ? under.key : 'ga:' + g.id, ref: { kind: 'ga', id: g.id },
    icon: fn ? KNXIcons.svg(KNX.fnIcon(fn), 15) : A.IC.obj,
    iconClass: fn ? 'fn-ic fn-' + KNX.fnType(fn.type).cat : 'obj',
    label: g.name, addr: KNX.addrStr(g),
    title: (under && under.role ? under.role + ' · ' : '') + g.dpt + (g.note ? ' · ' + g.note : ''),
    meta: links.length ? links.length + '\u00A0KO' : '',
    hasKids: false, collapsed: false,
    actions: () => [
      iconBtn(A.IC_TRASH, 'Löschen', () => G.actDeleteGa(g.id)),
      iconBtn(A.IC_LINK, 'Objekte zuordnen', () => G.actAssignGa(g.id))
    ],
    dragGa: g.id,
    onSelect: () => A.select('ga', g.id),
    onEdit: () => G.actEditGa(g.id)
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
    const bb = KNX.backbone();
    if (bb) backboneNode(bb);
    else KNX.regularAreas().slice().sort((a, b) => a.addr - b.addr).forEach(a => areaNode(a));
    const regular = KNX.regularAreas();
    const nLines = regular.reduce((s, a) => s + a.lines.length, 0);
    $('#tree-count').textContent =
      `${bb ? 'Backbone ' + KNX.MEDIA[bb.line.medium] + ' · ' : ''}${regular.length} Bereiche · ` +
      `${nLines} Linien · ${p.devices.length} Teilnehmer`;
    $('#btn-tree-add').textContent = '+ Bereich';
    $('#btn-tree-add').title = 'Neuen Bereich anlegen';
  } else {
    const root = KNX.gaTree();
    root.children.forEach(c => gaGroupNode(c, 0));
    root.groups.forEach(g => gaLeafNode(g, 0));          // freie Adressierung ohne Ordner
    const folders = G.folderDepth() >= 1;
    $('#tree-count').textContent = folders
      ? `${p.groups.length} Adressen in ${root.children.length} Hauptgruppen`
      : `${p.groups.length} Adressen`;
    $('#btn-tree-add').textContent = folders ? '+ Hauptgruppe' : '+ Adresse';
    $('#btn-tree-add').title = folders ? 'Neue Hauptgruppe anlegen' : 'Neue Gruppenadresse anlegen';
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
const TBL_ROW_H = 34;
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
  // Auf eine Gruppe im Baum ziehen verschiebt die Adresse — markierte gleich mit
  tr.draggable = true;
  tr.ondragstart = e => {
    const ids = state.checked.has(ga.id) ? [...state.checked] : [ga.id];
    e.dataTransfer.setData(GA_DRAG, JSON.stringify(ids));
    e.dataTransfer.effectAllowed = 'move';
  };

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
  const fns = KNX.functionsOfGa(ga.id);
  tdN.innerHTML = (fns.length ? `<span title="${esc(fns.map(f => f.name).join(', '))}">${F.fnIc(fns[0], 14)}</span> ` : '') +
    esc(ga.name) + (ga.note ? ' <span class="ga-note">' + esc(ga.note) + '</span>' : '');

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
  // Auf einen Raum im Gebäudebaum ziehen verbaut das Gerät dort
  tr.draggable = true;
  tr.ondragstart = e => startItemDrag(e, { type: 'dev', id: d.id });

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
  if (d.catalogId || KNX.deviceIsIp(d))
    tdX.appendChild(iconBtn(A.IC.params, 'Parameter', () => T.actParams(d.id)));
  else
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
  $('#btn-move-sel').hidden = !n || G.folderDepth() < 1;
  $('#btn-move-sel').textContent = n ? 'Verschieben (' + n + ')' : '';
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
    case 'seg': {
      const s = KNX.segmentInfo(f.id);
      return s ? 'Linie ' + KNX.lineLabel(s.line.id) + ' · ' + s.name : '';
    }
    case 'area': return 'Bereich ' + (KNX.project().areas.find(a => a.id === f.id)?.name || '');
    case 'dev':  return 'Gerät ' + (KNX.deviceById(f.id)?.name || '');
    case 'grp':  return (KNX.project().gaNames[f.id] || 'Gruppe') + ' ' + f.id;
    case 'fn':   return 'Funktion ' + (KNX.functionById(f.id)?.name || '');
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
    <p class="hint">${window.KNXBackend
      ? 'Das Projekt liegt als Datei auf diesem Rechner — der lokale Dienst speichert jede Änderung.'
      : 'Alles wird lokal im Browser gespeichert.'} Doppelklick auf einen
    Baumeintrag öffnet den Bearbeiten-Dialog, Strg+Z macht Änderungen rückgängig.</p>`;
}

/* Freitext der Entität — Zeilenumbrüche bleiben erhalten. */
function noteSection(note) {
  return note
    ? '<h3 class="detail-h">Notiz</h3><p class="detail-note">' + esc(note) + '</p>'
    : '';
}

/* Was die Produktdatei über das Laden sagt und ob der Download damit auskommt. */
function progSection(item) {
  const p = item && item.prog;
  if (!p) return '';
  const rows = [];
  const add = (k, v) => { if (v) rows.push(`<li><span class="grow">${k}</span>
    <span class="addr">${esc(String(v))}</span></li>`); };
  const tab = t => t ? `Offset ${t.off}${t.max ? ', max. ' + t.max + ' Einträge' : ''}` : 'nicht beschrieben';

  add('Maskenversion', p.mask || '—');
  add('Applikation', p.appNumber ? `Nr. ${p.appNumber}, Version ${p.appVersion}` : '');
  add('Ladeverfahren', p.style || '—');
  add('Adresstabelle', tab(p.addrTab));
  add('Assoziationstabelle', tab(p.assocTab));
  add('Objekttabelle', tab(p.comTab));
  if (p.segments.length) {
    const bytes = p.segments.reduce((s, x) => s + (x.size || 0), 0);
    add('Speichersegmente', `${p.segments.length} · zusammen ${bytes} Byte`);
  }
  if (p.properties.length) add('Eigenschaften', p.properties.length + ' Einträge');
  if (p.procedures.length) {
    const steps = p.procedures.reduce((s, x) => s + x.count, 0);
    add('Ladeprozeduren', `${p.procedures.length} · ${steps} Schritte`);
  }

  const blocked = [];
  if (p.plugin) blocked.push('Die Produktdatei verweist auf ein herstellereigenes Programm. '
    + 'Solche Programme laufen nur unter Windows in der ETS und werden hier übergangen.');
  if (p.unsupported.length) blocked.push('Unbekannte Ladeschritte: ' + p.unsupported.join(', ') + '.');
  if (!p.dl) blocked.push('Das Produkt wurde mit einer älteren Version eingelesen. '
    + 'Für den Download die .knxprod bitte erneut in den Katalog laden.');
  else if (!p.procedures.length && !(p.dl.mk && p.dl.mk.procs.length))
    blocked.push('Weder Produktdatei noch Maskendefinition enthalten eine Ladeprozedur.');

  return `<h3 class="detail-h">Programmierdaten</h3>
    <ul class="detail-list">${rows.join('')}</ul>
    ${blocked.length
      ? '<p class="hint warn">' + blocked.map(esc).join(' ') + '</p>'
      : '<p class="hint">Die Applikation lässt sich über die Inbetriebnahme laden.</p>'}`;
}

function issueList(id) {
  const is = issuesOf(id);
  if (!is.length) return '';
  return '<h3 class="detail-h">Prüfung</h3><ul class="issue-list">' +
    is.map(i => `<li class="${i.level}">${esc(i.msg)}</li>`).join('') + '</ul>';
}

/* Überschrift eines Detailabschnitts mit Knöpfen daneben. */
const sectionHead = (title, buttons) =>
  `<div class="detail-h-row"><h3 class="detail-h">${esc(title)}</h3><span class="detail-h-btns">${buttons}</span></div>`;

function detailNode(node) {
  const p = KNX.project();
  const isRoot = node.id === p.tree.id;
  const path = KNX.nodePath(node.id);
  const devs = KNX.roomIdsUnder(node.id).flatMap(r => KNX.devicesInRoom(r));
  const gaSet = new Set();
  devs.forEach(d => d.objs.forEach(o => o.gas.forEach(x => gaSet.add(x))));
  const holds = KNX.kindHolds(node.kind);
  const host = KNX.DEVICE_HOSTS.has(node.kind);
  const fns = KNX.functionsAt(node.id);
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
      ${isRoot ? '' : '<button class="btn btn-sm btn-danger" id="d-delete">' + A.IC_TRASH + ' Löschen</button>'}
    </div>
    ${isRoot ? '' : `<label class="field detail-field"><span>Liegt in</span>
      <select class="select" id="d-parent" title="Übergeordnetes Element wählen — oder im Baum ziehen">${A.parentOptions(node.id)}</select></label>`}
    ${noteSection(node.note)}
    ${holds.length ? sectionHead('Untergeordnet',
        '<button class="btn btn-sm" id="d-add">+ Neu</button><button class="btn btn-sm" id="d-pickchild">Vorhandene …</button>') +
      (node.children.length
        ? '<ul class="detail-list">' + node.children.map(c => `
            <li class="jump" data-kind="node" data-id="${c.id}">
              <span class="lvl-ic ${c.kind}">${A.IC[c.kind] || A.IC.room}</span>
              <span class="grow">${esc(c.name)}</span>
              <span class="dpt-tag">${esc(KNX.kindDe(c.kind))}</span></li>`).join('') + '</ul>'
        : '<p class="hint">Noch nichts darunter.</p>') : ''}
    ${sectionHead('Funktionen',
        '<button class="btn btn-sm" id="d-addfn">+ Neu</button><button class="btn btn-sm" id="d-pickfn">Vorhandene …</button>')}
    ${fns.length ? fnItems(fns) : '<p class="hint">Keine Funktion hier.</p>'}
    ${host
      ? sectionHead('Geräte', '<button class="btn btn-sm" id="d-adddev">+ Neu</button><button class="btn btn-sm" id="d-pickdev">Vorhandene …</button>')
      : devs.length ? '<h3 class="detail-h">Geräte darunter</h3>' : ''}
    ${devs.length
      ? '<ul class="detail-list">' +
        devs.map(d => `<li class="jump" data-kind="dev" data-id="${d.id}">
          <span class="addr">${KNX.paStr(d.addr)}</span>
          <span class="grow">${esc(d.name)}</span>
          <span class="dpt-tag">${d.objs.length} KO</span></li>`).join('') + '</ul>'
      : host ? '<p class="hint">Hier ist noch kein Gerät verbaut.</p>' : ''}`;
}

function fnItems(fns) {
  return '<ul class="detail-list">' + fns.map(f => `
    <li class="jump" data-kind="fn" data-id="${f.id}">
      ${F.fnIc(f)}
      <span class="grow">${esc(f.name)}</span>
      <span class="dpt-tag">${f.gas.length} GA</span></li>`).join('') + '</ul>';
}
function fnListSection(fns, title) {
  return fns.length ? `<h3 class="detail-h">${esc(title)}</h3>` + fnItems(fns) : '';
}

function nodeOptions(sel, filter = () => true) {
  const out = [];
  KNX.walk(KNX.project().tree, n => {
    if (n.id === sel || filter(n))
      out.push(`<option value="${n.id}"${n.id === sel ? ' selected' : ''}>${esc(A.trailOf(n.id))} (${esc(KNX.kindDe(n.kind))})</option>`);
  });
  return out.join('');
}

/* Funktion: Rollen des Typs mit ihren Adressen, dann alles Weitere. */
function detailFn(fn) {
  const t = KNX.fnType(fn.type);
  const path = KNX.nodePath(fn.nodeId);
  const devs = KNX.functionDevices(fn);
  const byRole = new Map(fn.gas.filter(x => x.role).map(x => [x.role, x.ga]));
  const free = t.roles.filter(r => !byRole.has(r.key));
  const gaCells = (g, dptWant) => `
    <span class="addr">${KNX.addrStr(g)}</span>
    <span class="grow">${esc(g.name)}</span>
    <span class="dpt-tag${dptWant && dptWant.split('.')[0] !== g.dpt.split('.')[0] ? ' bad' : ''}">${g.dpt}</span>`;
  const unlink = gaId => `<button class="icon-btn fn-detach" data-ga="${gaId}" title="Aus der Funktion lösen">×</button>`;

  const roleRows = t.roles.map(r => {
    const g = byRole.has(r.key) ? KNX.gaById(byRole.get(r.key)) : null;
    return g
      ? `<li class="jump" data-kind="ga" data-id="${g.id}"><span class="fn-role">${esc(r.de)}</span>
           ${gaCells(g, r.dpt)}${unlink(g.id)}</li>`
      : `<li><span class="fn-role">${esc(r.de)}</span><span class="grow hint">frei</span>
           <span class="dpt-tag">${r.dpt}</span>
           <button class="btn btn-sm fn-create" data-role="${r.key}" title="Neue Adresse für diese Rolle">anlegen</button></li>`;
  }).join('');
  const extra = fn.gas.filter(x => !x.role).map(x => KNX.gaById(x.ga)).filter(Boolean);
  const extraRows = extra.map(g => `
    <li class="jump" data-kind="ga" data-id="${g.id}">${gaCells(g)}
      ${free.length ? `<select class="select fn-role-pick" data-ga="${g.id}" title="Einer Rolle zuweisen">
        <option value="">Rolle …</option>${free.map(r =>
          `<option value="${r.key}">${esc(r.de)}</option>`).join('')}</select>` : ''}
      ${unlink(g.id)}</li>`).join('');

  return `
    <div class="detail-head">
      <span class="lvl-ic big">${F.fnIc(fn, 22)}</span>
      <div>
        <h2 data-pt-id="detail-fn-title">${esc(fn.name)}</h2>
        <p class="detail-sub">Funktion · ${esc(t.de)} · ${esc(path ? path.trail : '')}</p>
      </div>
    </div>
    <div class="detail-meta">
      <div class="meta-item"><span class="meta-num">${fn.gas.length}</span><span class="meta-lbl">Adressen</span></div>
      <div class="meta-item"><span class="meta-num">${devs.length}</span><span class="meta-lbl">Geräte beteiligt</span></div>
    </div>
    <div class="detail-actions">
      <button class="btn btn-sm" id="d-assign">${A.IC_LINK} Adressen zuordnen</button>
      <button class="btn btn-sm" id="d-rename">${A.IC_PENCIL} Bearbeiten</button>
      <button class="btn btn-sm btn-danger" id="d-delete">${A.IC_TRASH} Löschen</button>
    </div>
    <label class="field detail-field"><span>Liegt in</span>
      <select class="select" id="d-fnnode" title="Gebäudeteil wählen — oder im Baum ziehen">${nodeOptions(fn.nodeId)}</select></label>
    ${issueList(fn.id)}
    ${t.roles.length ? `<h3 class="detail-h">Rollen</h3><ul class="detail-list">${roleRows}</ul>` : ''}
    ${extra.length || !t.roles.length
      ? `<h3 class="detail-h">${t.roles.length ? 'Weitere Adressen' : 'Adressen'}</h3>` +
        (extra.length ? `<ul class="detail-list">${extraRows}</ul>`
          : '<p class="hint">Noch keine Adressen — zuordnen oder aus der Tabelle auf die Funktion im Baum ziehen.</p>')
      : ''}
    ${devs.length
      ? '<h3 class="detail-h">Geräte</h3><ul class="detail-list">' + devs.map(d => `
          <li class="jump" data-kind="dev" data-id="${d.id}">
            <span class="addr">${KNX.paStr(d.addr)}</span>
            <span class="grow">${esc(d.name)}</span></li>`).join('') + '</ul>'
      : ''}
    ${noteSection(fn.note)}`;
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
      ${G.folderDepth() >= 1 ? '<button class="btn btn-sm" id="d-move">Verschieben …</button>' : ''}
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
    ${fnListSection(KNX.functionsOfGa(ga.id), 'Funktionen')}
    ${rooms.length
      ? '<h3 class="detail-h">Wirksam in</h3><ul class="detail-list">' + rooms.map(r =>
          `<li class="jump" data-kind="node" data-id="${r.id}">${esc(KNX.nodePath(r.id).sub)}</li>`).join('') + '</ul>'
      : ''}
    ${noteSection(ga.note)}`;
}

/* Die Filtertabelle ist kein Eingabewert, sondern folgt aus der Topologie —
   deshalb wird sie nur angezeigt, so wie die ETS sie beim Programmieren bildet. */
function filterSection(d) {
  const f = KNX.filterTable(d);
  if (!f) return '';
  const show = state.filterView === 'local' ? f.local : f.pass;
  const max = 40;
  const rows = show.slice(0, max).map(g => `
    <li class="jump" data-kind="ga" data-id="${g.id}">
      <span class="addr">${KNX.addrStr(g)}</span>
      <span class="grow">${esc(g.name)}</span>
      <span class="dpt-tag">${g.dpt}</span></li>`).join('');
  const tile = (key, n, label) =>
    `<button class="meta-item pick${state.filterView === key ? ' on' : ''}" data-fv="${key}">
       <span class="meta-num">${n}</span><span class="meta-lbl">${label}</span></button>`;
  return `
    <h3 class="detail-h">Filtertabelle · ${esc(f.scope.de)} ${esc(f.scope.label)}</h3>
    <div class="detail-meta">
      ${tile('pass', f.pass.length, 'durchgelassen')}
      ${tile('local', f.local.length, 'gesperrt')}
    </div>
    <p class="hint">Wird aus den Geräteadressen berechnet: durchgelassen wird, was
    Teilnehmer auf beiden Seiten hat. Die Weiterleitungsparameter des Kopplers
    gehen zusätzlich ein.${f.high
      ? ` <b>${f.high}</b> Adressen liegen in Hauptgruppe 14–31 — ältere Koppler führen
        nur 0–13 in der Tabelle und behandeln den Rest über den Parameter.` : ''}</p>
    ${show.length
      ? `<ul class="detail-list">${rows}</ul>` +
        (show.length > max ? `<p class="hint">… und ${show.length - max} weitere.</p>` : '')
      : state.filterView === 'local'
        ? '<p class="hint">Jede Adresse dieses Segments überschreitet die Grenze.</p>'
        : '<p class="hint">Keine Adresse überschreitet diese Grenze — es gibt nichts weiterzuleiten.</p>'}`;
}

/* Busstrom einer Linie, sobald Verbraucher darauf sitzen. */
function powerSection(lineId) {
  const p = KNX.powerBudget(lineId);
  if (!p || !p.loads.length) return '';
  const pct = p.have ? Math.min(100, Math.round(p.need / p.have * 100)) : 100;
  const cls = !p.have || p.need > p.have ? 'over' : (p.reserve < p.have * 0.1 ? 'tight' : 'ok');
  return `
    <h3 class="detail-h">Busstrom</h3>
    <div class="power-bar ${cls}"><span style="width:${pct}%"></span></div>
    <p class="hint"><b>${p.need} mA</b> Bedarf von ${p.loads.length} Teilnehmern ·
      <b>${p.have} mA</b> eingespeist${p.supplies.length
        ? ' (' + p.supplies.map(s => esc(s.name)).join(', ') + ')'
        : ' — keine Spannungsversorgung eingeplant'}${p.have
        ? ` · Reserve ${p.reserve} mA` : ''}</p>`;
}

function detailDev(d) {
  const room = d.roomId ? KNX.findNode(d.roomId) : null;
  const item = d.catalogId ? KNX.catalogById(d.catalogId) : null;
  const isIp = KNX.deviceIsIp(d);
  const ip = isIp ? KNX.ipConfig(d) : null;
  const coupler = !!KNX.couplerScope(d);
  const nSet = Object.keys(d.params || {}).length;
  return `
    <div class="detail-head">
      <span class="addr big">${KNX.paStr(d.addr)}</span>
      <div>
        <h2 data-pt-id="detail-dev-title">${esc(d.name)}</h2>
        <p class="detail-sub">${esc(d.product || 'ohne Produktangabe')} · Linie ${esc(KNX.lineLabel(d.lineId))}${
          d.segmentId && KNX.segmentInfo(d.segmentId) ? ' · ' + esc(KNX.segmentInfo(d.segmentId).name) : ''}
          · ${room ? esc(KNX.nodePath(room.id).sub) : '<b>kein Raum</b>'}</p>
        <p class="detail-sub"><span class="src-tag${item ? ' prog' : ''}"
          title="${item
            ? 'Produktdatei vorhanden — Objekte und Parameter stammen daraus'
            : 'Frei angelegt — dient der Dokumentation und den Filtertabellen'}">${
          item ? 'aus .knxprod' : 'frei definiert'}</span></p>
      </div>
    </div>
    ${coupler && !d.objs.length ? '' : `
    <div class="detail-meta">
      <div class="meta-item"><span class="meta-num">${d.objs.length}</span><span class="meta-lbl">Objekte</span></div>
      ${item || isIp
        ? `<div class="meta-item"><span class="meta-num">${nSet}</span><span class="meta-lbl">geänderte Einstellungen</span></div>`
        : `<div class="meta-item"><span class="meta-num">${d.objs.reduce((s, o) => s + o.gas.length, 0)}</span><span class="meta-lbl">Adresszuordnungen</span></div>`}
    </div>`}
    <div class="detail-actions">
      ${item || isIp ? '<button class="btn btn-sm btn-primary" id="d-params">Parameter …</button>' : ''}
      ${item && window.KNXBus && window.KNXBus.available
        ? '<button class="btn btn-sm" id="d-program" title="Applikation, Parameter und Gruppenadressen ins Gerät laden">Programmieren …</button>' : ''}
      ${item ? '' : '<button class="btn btn-sm" id="d-addobj">+ Objekt</button>'}
      <button class="btn btn-sm" id="d-rename">${A.IC_PENCIL} Bearbeiten</button>
      <button class="btn btn-sm btn-danger" id="d-delete">${A.IC_TRASH} Löschen</button>
    </div>
    <label class="field detail-field"><span>Verbaut in</span>
      <select class="select" id="d-room" title="Einbauort wählen — oder in der Gebäudeansicht auf einen Raum ziehen">
        <option value="">— kein Raum —</option>${nodeOptions(d.roomId, n => KNX.DEVICE_HOSTS.has(n.kind))}</select></label>
    ${issueList(d.id)}
    ${isIp ? `<h3 class="detail-h">IP-Konfiguration</h3><ul class="detail-list">
      <li><span class="grow">Adressvergabe</span><span class="addr">${
        ip.mode === 'manual' ? 'manuell' : 'DHCP / AutoIP'}</span></li>
      ${ip.mode === 'manual' ? `
      <li><span class="grow">IP-Adresse</span><span class="addr">${esc(ip.addr || '—')}</span></li>
      <li><span class="grow">Subnetzmaske</span><span class="addr">${esc(ip.mask || '—')}</span></li>
      <li><span class="grow">Standardgateway</span><span class="addr">${esc(ip.gw || '—')}</span></li>` : ''}
      <li><span class="grow">Routing-Multicast (Backbone)</span><span class="addr">${esc(ip.mcast || '—')}</span></li>
      <li><span class="grow">Tunnelverbindungen${KNX.tunnelCountFixed(d) ? ' (laut Produktdatei)' : ''}</span>
        <span class="addr">${KNX.tunnelCount(d)}</span></li>
      ${KNX.tunnelAddrs(d).length ? `<li><span class="grow">Tunneladressen</span>
        <span class="addr">${KNX.tunnelAddrs(d).map(KNX.paStr).join(', ')}</span></li>` : ''}
    </ul>` : ''}
    ${d.serial ? `<h3 class="detail-h">Seriennummer</h3><ul class="detail-list">
      <li><span class="grow">6 Byte, für die Adressvergabe ohne Programmiertaste</span>
        <span class="addr">${esc(d.serial)}</span></li></ul>` : ''}
    ${noteSection(d.note)}
    ${progSection(item)}
    ${filterSection(d)}
    <h3 class="detail-h">Kommunikationsobjekte</h3>
    ${d.objs.length
      ? '<ul class="detail-list">' + d.objs.map(o => {
          const send = o.gas[0] ? KNX.gaById(o.gas[0]) : null;
          return `<li class="jump${o.stale ? ' stale' : ''}" data-kind="obj" data-id="${o.id}"
            ${o.stale ? 'title="Durch die aktuelle Parametrierung nicht mehr vorgesehen"' : ''}>
            <span class="onum">${o.num}</span>
            <span class="grow">${esc(o.name)}</span>
            ${send ? '<span class="addr">' + KNX.addrStr(send) + '</span>'
                   : '<span class="room-chip empty">—</span>'}
            <span class="dpt-tag">${o.dpt}</span>
            <span class="flags">${KNX.flagStr(o.flags)}</span></li>`;
        }).join('') + '</ul>'
      : item
        ? '<p class="hint">Dieses Gerät arbeitet ohne Kommunikationsobjekte — es wird ' +
          'allein über seine Eigenschaften eingestellt.</p>'
        : coupler
          ? '<p class="hint">Koppler arbeiten ohne Kommunikationsobjekte — sie leiten ' +
            'nach ihrer Filtertabelle weiter.</p>'
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

function detailBackbone(l) {
  const devs = KNX.devicesOnLine(l.id);
  const areas = KNX.regularAreas().slice().sort((x, y) => x.addr - y.addr);
  return `
    <div class="detail-head">
      <span class="addr big">0.0</span>
      <div>
        <h2>${esc(l.name)}</h2>
        <p class="detail-sub">Backbone · ${esc(KNX.MEDIA[l.medium])}${l.medium === 'ip'
          ? ' · Multicast ' + esc(l.mcast || '—') : ''}</p>
      </div>
    </div>
    <div class="detail-meta">
      <div class="meta-item"><span class="meta-num">${areas.length}</span><span class="meta-lbl">Bereiche</span></div>
      <div class="meta-item"><span class="meta-num">${devs.length}</span><span class="meta-lbl">Teilnehmer</span></div>
    </div>
    <div class="detail-actions">
      <button class="btn btn-sm" id="d-adddev">+ Gerät</button>
      <button class="btn btn-sm" id="d-addarea">+ Bereich</button>
      <button class="btn btn-sm" id="d-addseg">+ Segment</button>
      <button class="btn btn-sm" id="d-rename">${A.IC_PENCIL} Bearbeiten</button>
    </div>
    ${issueList(l.id)}
    ${segmentList(l)}
    <p class="hint">Der Backbone verbindet die Bereiche über ihre Bereichskoppler (x.0.0).
      ${l.medium === 'ip' ? 'Die Multicast-Adresse gilt für alle KNXnet/IP-Router des Projekts.' : ''}</p>
    ${noteSection(l.note)}
    <h3 class="detail-h">Bereiche</h3>
    <ul class="detail-list">${areas.map(a =>
      `<li class="jump" data-kind="area" data-id="${a.id}">
        <span class="addr">${a.addr}</span>
        <span class="grow">${esc(a.name)}</span>
        <span class="dpt-tag">${a.lines.length} L</span></li>`).join('')}</ul>
    ${devs.length
      ? '<h3 class="detail-h">Teilnehmer</h3><ul class="detail-list">' +
        devs.slice().sort(KNX.byPa).map(d =>
          `<li class="jump" data-kind="dev" data-id="${d.id}">
            <span class="addr">${KNX.paStr(d.addr)}</span>
            <span class="grow">${esc(d.name)}</span>
            <span class="dpt-tag">${d.objs.length} KO</span></li>`).join('') + '</ul>' : ''}`;
}

/* Segmente einer Linie mit Teilnehmern und Busstrom. */
function segmentList(l) {
  if (!KNX.segmentsOf(l).length) return '';
  return '<h3 class="detail-h">Segmente</h3><ul class="detail-list">' + KNX.segmentKeys(l).map(key => {
    const s = KNX.segmentInfo(key);
    const p = KNX.powerBudget(key);
    return `<li class="jump" data-kind="seg" data-id="${esc(key)}">
      <span class="addr">S${s.num}</span>
      <span class="grow">${esc(s.seg ? s.name : 'Segment 0')} · ${esc(KNX.MEDIA[s.medium])}</span>
      ${p && p.loads.length ? `<span class="dpt-tag${p.need > p.have ? ' bad' : ''}">${p.need}/${p.have} mA</span>` : ''}
      <span class="dpt-tag">${KNX.devicesInSegment(key).length} T</span></li>`;
  }).join('') + '</ul>';
}

function detailSeg(s) {
  const a = KNX.areaOfLine(s.line.id);
  const devs = KNX.devicesInSegment(s.key);
  return `
    <div class="detail-head">
      <span class="addr big">${a.addr}.${s.line.addr} S${s.num}</span>
      <div>
        <h2>${esc(s.seg ? s.name : 'Segment 0')}</h2>
        <p class="detail-sub">Segment der Linie ${esc(KNX.lineLabel(s.line.id))} · ${esc(KNX.MEDIA[s.medium])}</p>
      </div>
    </div>
    <div class="detail-meta">
      <div class="meta-item"><span class="meta-num">${devs.length}</span><span class="meta-lbl">Teilnehmer</span></div>
    </div>
    <div class="detail-actions">
      <button class="btn btn-sm" id="d-adddev">+ Gerät</button>
      <button class="btn btn-sm" id="d-rename">${A.IC_PENCIL} Bearbeiten</button>
      ${s.seg ? `<button class="btn btn-sm btn-danger" id="d-delete">${A.IC_TRASH} Löschen</button>` : ''}
    </div>
    ${issueList(s.key)}
    <p class="hint">${s.seg ? 'Ein Segment teilt sich den Adressraum der Linie, hat aber eigene Teilnehmer, '
      + 'eigenen Busstrom und ein eigenes Medium.' : 'Segment 0 ist die Linie selbst; sein Medium ist das der Linie.'}</p>
    ${s.seg ? noteSection(s.seg.note) : ''}
    ${powerSection(s.key)}
    ${devs.length
      ? '<h3 class="detail-h">Teilnehmer</h3><ul class="detail-list">' +
        devs.slice().sort(KNX.byPa).map(d =>
          `<li class="jump" data-kind="dev" data-id="${d.id}">
            <span class="addr">${KNX.paStr(d.addr)}</span>
            <span class="grow">${esc(d.name)}</span>
            <span class="dpt-tag">${d.objs.length} KO</span></li>`).join('') + '</ul>' : ''}`;
}

function detailLine(l) {
  const a = KNX.areaOfLine(l.id);
  const devs = KNX.devicesOnLine(l.id);
  if (a.backbone) return detailBackbone(l);
  const main = l.addr === 0;
  const segmented = KNX.segmentsOf(l).length > 0;
  return `
    <div class="detail-head">
      <span class="addr big">${a.addr}.${l.addr}</span>
      <div>
        <h2>${esc(l.name)}</h2>
        <p class="detail-sub">${main ? 'Hauptlinie des Bereichs' : 'Linie in Bereich'} ${esc(a.name)} · ${esc(KNX.MEDIA[l.medium])}</p>
      </div>
    </div>
    <div class="detail-meta">
      <div class="meta-item"><span class="meta-num">${devs.length}</span><span class="meta-lbl">Teilnehmer</span></div>
      <div class="meta-item"><span class="meta-num">${255 - devs.length}</span><span class="meta-lbl">freie Nummern</span></div>
    </div>
    <div class="detail-actions">
      <button class="btn btn-sm" id="d-adddev">+ Gerät</button>
      <button class="btn btn-sm" id="d-addseg">+ Segment</button>
      <button class="btn btn-sm" id="d-rename">${A.IC_PENCIL} Bearbeiten</button>
      ${main ? '' : `<button class="btn btn-sm btn-danger" id="d-delete">${A.IC_TRASH} Löschen</button>`}
    </div>
    ${issueList(l.id)}
    ${main ? `<p class="hint">Auf der Hauptlinie sitzt der Bereichskoppler ${a.addr}.0.0; weitere Geräte
      bekommen ${a.addr}.0.1 und folgende. Sie gehört fest zum Bereich.</p>` : ''}
    ${noteSection(l.note)}
    ${segmented ? segmentList(l) : powerSection(l.id)}
    ${devs.length
      ? '<h3 class="detail-h">Teilnehmer</h3><ul class="detail-list">' +
        devs.slice().sort(KNX.byPa).map(d =>
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
    ${noteSection(a.note)}
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
      ${level < G.folderDepth() - 1
        ? `<button class="btn btn-sm" id="d-addgrp">+ ${esc(style.parts[level + 1].label)}</button>`
        : '<button class="btn btn-sm" id="d-addga">+ Adresse</button>'}
      ${gs.length && G.folderDepth() >= 1 ? '<button class="btn btn-sm" id="d-move">Adressen verschieben …</button>' : ''}
      <button class="btn btn-sm btn-danger" id="d-delete">${A.IC_TRASH} Löschen</button>
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
    on('#d-addfn', () => F.actNewFunction(target.id));
    on('#d-pickchild', () => A.actPickChildren(target.id));
    on('#d-pickfn', () => F.actPickFunctions(target.id));
    on('#d-pickdev', () => A.actPickDevices(target.id));
    $('#d-parent')?.addEventListener('change', e => { if (!A.moveNode(target.id, e.target.value)) renderDetail(); });
  } else if (sel.kind === 'fn') {
    panel.innerHTML = detailFn(target);
    on('#d-assign', () => F.actAssignFunctionGas(target.id));
    on('#d-rename', () => F.actEditFunction(target.id));
    on('#d-delete', () => F.actDeleteFunction(target.id));
    $('#d-fnnode')?.addEventListener('change', e => F.moveFunction(target.id, e.target.value));
    panel.querySelectorAll('.fn-create').forEach(b =>
      b.addEventListener('click', () => F.createRoleGa(target.id, b.dataset.role)));
    panel.querySelectorAll('.fn-detach').forEach(b =>
      b.addEventListener('click', e => { e.stopPropagation(); F.detach(target.id, b.dataset.ga); }));
    panel.querySelectorAll('.fn-role-pick').forEach(s => {
      s.addEventListener('click', e => e.stopPropagation());
      s.addEventListener('change', () => { if (s.value) F.setRole(target.id, s.dataset.ga, s.value); });
    });
  } else if (sel.kind === 'ga') {
    panel.innerHTML = detailGa(target);
    on('#d-assign', () => G.actAssignGa(target.id));
    on('#d-rename', () => G.actEditGa(target.id));
    on('#d-move', () => G.actMoveGas([target.id]));
    on('#d-delete', () => G.actDeleteGa(target.id));
  } else if (sel.kind === 'dev') {
    panel.innerHTML = detailDev(target);
    on('#d-addobj', () => T.actNewObj(target.id));
    on('#d-params', () => T.actParams(target.id));
    on('#d-program', () => window.KNXBus.program(target.id));
    on('#d-rename', () => T.actEditDevice(target.id));
    on('#d-delete', () => T.actDeleteDevice(target.id));
    $('#d-room')?.addEventListener('change', e => A.setDeviceRoom(target.id, e.target.value || null));
    panel.querySelectorAll('[data-fv]').forEach(b =>
      b.addEventListener('click', () => { state.filterView = b.dataset.fv; renderDetail(); }));
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
    on('#d-addarea', () => T.actNewArea());
    on('#d-addseg', () => T.actNewSegment(target.id));
    on('#d-rename', () => T.actEditLine(target.id));
    on('#d-delete', () => T.actDeleteLine(target.id));
  } else if (sel.kind === 'seg') {
    panel.innerHTML = detailSeg(target);
    on('#d-adddev', () => T.actNewDevice({ lineId: target.line.id, segmentId: target.seg ? target.key : null }));
    on('#d-rename', () => T.actEditSegment(target.key));
    on('#d-delete', () => T.actDeleteSegment(target.key));
  } else if (sel.kind === 'area') {
    panel.innerHTML = detailArea(target);
    on('#d-addline', () => T.actNewLine(target.id));
    on('#d-rename', () => T.actEditArea(target.id));
    on('#d-delete', () => T.actDeleteArea(target.id));
  } else if (sel.kind === 'grp') {
    panel.innerHTML = detailGrp(sel.id);
    on('#d-rename', () => T.actRenameGaGroup(sel.id));
    on('#d-addga', () => G.actNewGa(sel.id));
    on('#d-addgrp', () => G.actNewGaGroup(sel.id));
    on('#d-move', () => G.actMoveGas(KNX.gasInGroup(sel.id).map(g => g.id)));
    on('#d-delete', () => G.actDeleteGaGroup(sel.id));
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
  if (kind === 'node' || kind === 'fn') state.view = 'building';
  else if (['dev', 'obj', 'line', 'seg', 'area'].includes(kind)) state.view = 'topology';
  else if (kind === 'grp') state.view = 'ga';
  if (kind === 'ga') state.mid = 'ga';
  if (kind === 'dev') state.mid = 'dev';
  expandTo(kind, id);
  A.select(kind, id);
}
function expandTo(kind, id) {
  const openLine = lineId => {
    const bb = KNX.backbone();
    if (bb) state.collapsed.delete(bb.area.id);
    state.collapsed.delete(lineId);
    const a = KNX.areaOfLine(lineId);
    if (a) state.collapsed.delete(a.id);
  };
  if (kind === 'area') {
    const bb = KNX.backbone();
    if (bb) state.collapsed.delete(bb.area.id);
  } else if (kind === 'obj') {
    const e = KNX.objById(id);
    if (e) { state.collapsed.delete(e.dev.id); openLine(e.dev.lineId); state.collapsed.delete('seg:' + KNX.segKeyOf(e.dev)); }
  } else if (kind === 'dev') {
    const d = KNX.deviceById(id);
    if (d) { openLine(d.lineId); state.collapsed.delete('seg:' + KNX.segKeyOf(d)); }
  } else if (kind === 'seg') {
    const s = KNX.segmentInfo(id);
    if (s) openLine(s.line.id);
  } else if (kind === 'fn') {
    const fn = KNX.functionById(id);
    if (fn) { state.collapsed.delete(fn.nodeId); expandTo('node', fn.nodeId); }
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

