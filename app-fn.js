/* ============================================================
   KNX-Struktur — Funktionen: anlegen, bearbeiten, Adressen zuordnen
   ============================================================ *
 * Eine Funktion liegt in einem Gebäudeteil und bündelt die Adressen, mit
 * denen etwas bedient wird. Anders als in der ETS entstehen die Adressen
 * gleich beim Anlegen, in der Gruppe aus Gewerk und Geschoss.            */
'use strict';

(() => {
const A = window.KNXApp, $ = s => document.querySelector(s);
const state = A.state, esc = A.esc;

/* Symbol einer Funktion oder eines Typs, eingefärbt nach Kategorie. */
function fnIc(fn, size = 15) {
  return `<span class="fn-ic fn-${KNX.fnType(fn.type).cat}">${KNXIcons.svg(KNX.fnIcon(fn), size)}</span>`;
}
const typeIc = (t, size) => fnIc({ type: t.key, icon: '' }, size);

function showErr(msg) {
  $('#m-err').innerHTML = msg ? `<span class="hint warn">${esc(msg)}</span>` : '';
}

/* Unterste Ordnerebene der Gruppenadressen mit Namenspfad. */
function folderList() {
  const depth = KNX.gaStyle().parts.length - 1;
  const out = [];
  if (depth < 1) return out;
  const walk = (n, trail) => n.children.forEach(c => {
    const t = trail.concat(c.name || '');
    if (c.level === depth - 1) out.push({ key: c.key, label: t.filter(Boolean).join(' › ') });
    else walk(c, t);
  });
  walk(KNX.gaTree(), []);
  return out;
}

/* Symbolauswahl: leer heißt Symbol des Typs. */
function iconGrid(current) {
  return `<div class="icon-grid" id="m-icons">
    <button type="button" class="icon-pick std${current ? '' : ' on'}" data-icon="" title="Symbol des Typs">Standard</button>
    ${KNXIcons.names().map(n => `<button type="button" class="icon-pick${n === current ? ' on' : ''}"
      data-icon="${n}" title="${n}">${KNXIcons.svg(n, 18)}</button>`).join('')}
  </div>`;
}
function wireIconGrid(onPick) {
  $('#m-icons').addEventListener('click', e => {
    const b = e.target.closest('.icon-pick');
    if (!b) return;
    $('#m-icons').querySelectorAll('.icon-pick').forEach(x => x.classList.toggle('on', x === b));
    onPick(b.dataset.icon);
  });
}

/* ---------- Anlegen ---------- */
function actNewFunction(nodeId) {
  const node = KNX.findNode(nodeId);
  if (!node) return;
  const depth = KNX.gaStyle().parts.length - 1;
  let type = KNX.fnType('light-switch'), icon = '', nameTouched = false;

  A.openModal(`Neue Funktion in „${node.name}“`, `
    <div class="field"><span>Typ</span>
      <div class="fn-types" id="m-types">${KNX.FN_TYPES.map(t => `
        <button type="button" class="fn-type" data-type="${t.key}">
          ${typeIc(t, 20)}<span>${esc(t.de)}</span></button>`).join('')}
      </div>
    </div>
    <label class="field"><span>Name</span>
      <input class="input" id="m-name" maxlength="60">
    </label>
    <details class="fn-icons"><summary>Symbol <span id="m-icon-cur"></span></summary>${iconGrid('')}</details>
    <div class="field" id="m-roles-f"><span>Gruppenadressen dazu anlegen</span>
      <div class="chk-list" id="m-roles"></div>
    </div>
    <label class="field" id="m-folder-f"><span>${depth >= 1 ? 'in Gruppe' : 'Adressen'}</span>
      <select class="select" id="m-folder"></select>
    </label>
    <p class="hint" id="m-fn-hint"></p>
    <div id="m-err"></div>
  `, () => {
    const name = $('#m-name').value.trim();
    if (!name) { showErr('Bitte einen Namen vergeben.'); $('#m-name').focus(); return false; }
    const roles = [...$('#m-roles').querySelectorAll('.chk:checked')].map(c => c.dataset.role);
    const choice = $('#m-folder').value;
    const fn = KNX.addFunction({ id: KNX.uid('f'), nodeId, type: type.key, name, icon, note: '', gas: [] });
    let missing = 0;
    if (roles.length && choice !== 'none') {
      const folder = choice === 'auto' ? KNX.functionFolder(nodeId, type.key)
        : choice === 'free' ? null : { key: choice, create: {} };
      missing = KNX.createRoleGas(fn, roles, folder);
    }
    state.collapsed.delete(nodeId);
    state.sel = { kind: 'fn', id: fn.id };
    state.filter = { kind: 'fn', id: fn.id };
    A.commit();
    if (missing) A.warn(`${missing} ${missing === 1 ? 'Adresse fand' : 'Adressen fanden'} in der Gruppe keinen Platz mehr.`);
  });

  const folders = folderList();
  const sync = () => {
    $('#m-types').querySelectorAll('.fn-type').forEach(b => b.classList.toggle('on', b.dataset.type === type.key));
    if (!nameTouched) $('#m-name').value = `${type.short} ${node.name}`;
    $('#m-icon-cur').innerHTML = fnIc({ type: type.key, icon });

    $('#m-roles-f').hidden = !type.roles.length;
    $('#m-folder-f').hidden = !type.roles.length;
    $('#m-roles').innerHTML = type.roles.map(r => `
      <label class="chk-row">
        <input type="checkbox" class="chk" data-role="${r.key}" checked>
        <span class="chk-label">${esc(r.de)}</span>
        <span class="dpt-tag">${r.dpt}</span>
      </label>`).join('');

    const keep = $('#m-folder').value;
    const sug = KNX.functionFolder(nodeId, type.key);
    const isNew = sug && Object.keys(sug.create).length;
    $('#m-folder').innerHTML = (depth >= 1
      ? `<option value="auto">${esc(sug ? sug.label : 'nächste freie Adressen')}${isNew ? ' (wird angelegt)' : ''}</option>` +
        folders.filter(f => !sug || f.key !== sug.key).map(f =>
          `<option value="${esc(f.key)}">${esc(f.key)}${f.label ? ' ' + esc(f.label) : ''}</option>`).join('')
      : '<option value="free">nächste freie Adressen</option>') +
      '<option value="none">keine Adressen anlegen</option>';
    if (keep && keep !== 'auto' && [...$('#m-folder').options].some(o => o.value === keep)) $('#m-folder').value = keep;
    $('#m-fn-hint').textContent = type.roles.length
      ? 'Die Adressen heißen wie die Funktion plus Rolle und liegen dort auf den nächsten freien Nummern.'
      : 'Benutzerdefinierte Funktionen haben keine festen Rollen — Adressen danach zuordnen oder auf die Funktion ziehen.';
  };
  $('#m-types').addEventListener('click', e => {
    const b = e.target.closest('.fn-type');
    if (!b) return;
    type = KNX.fnType(b.dataset.type);
    sync();
  });
  $('#m-name').addEventListener('input', () => { nameTouched = true; });
  wireIconGrid(v => { icon = v; sync(); });
  sync();
  $('#m-name').focus();
  $('#m-name').select();
}

/* ---------- Bearbeiten ---------- */
function actEditFunction(id) {
  const fn = KNX.functionById(id);
  if (!fn) return;
  let icon = fn.icon;
  A.openModal('Funktion bearbeiten', `
    <label class="field"><span>Name</span>
      <input class="input" id="m-name" maxlength="60" value="${esc(fn.name)}">
    </label>
    <label class="field"><span>Typ</span>
      <select class="select" id="m-type">${KNX.FN_TYPES.map(t =>
        `<option value="${t.key}"${t.key === fn.type ? ' selected' : ''}>${esc(t.de)}</option>`).join('')}</select>
    </label>
    <details class="fn-icons"${fn.icon ? ' open' : ''}><summary>Symbol <span id="m-icon-cur"></span></summary>${iconGrid(fn.icon)}</details>
    <label class="field"><span>Notiz</span>
      <textarea class="input note" id="m-note" rows="3" maxlength="${KNX.NOTE_MAX}"
                placeholder="Freitext zur Dokumentation">${esc(fn.note || '')}</textarea>
    </label>
    <p class="hint">Beim Typwechsel behalten Adressen ihre Rolle, wenn der neue Typ sie kennt —
       sonst laufen sie als weitere Adressen mit.</p>
    <div id="m-err"></div>
  `, () => {
    const name = $('#m-name').value.trim();
    if (!name) { showErr('Bitte einen Namen vergeben.'); $('#m-name').focus(); return false; }
    fn.name = name;
    fn.type = $('#m-type').value;
    fn.icon = icon;
    fn.note = $('#m-note').value.trim();
    fn.gas.forEach(x => { if (!KNX.fnRole(fn, x.role)) x.role = ''; });
    KNX.touch();
    A.commit();
  });
  const cur = () => { $('#m-icon-cur').innerHTML = fnIc({ type: $('#m-type').value, icon }); };
  $('#m-type').addEventListener('change', cur);
  wireIconGrid(v => { icon = v; cur(); });
  cur();
}

/* ---------- Löschen ---------- */
function actDeleteFunction(id) {
  const fn = KNX.functionById(id);
  if (!fn) return;
  const own = fn.gas.filter(x => KNX.functionsOfGa(x.ga).length === 1);
  const linked = own.filter(x => KNX.gaLinks(x.ga).length).length;
  A.openModal(`Funktion „${fn.name}“ löschen?`, `
    <p>Die Funktion wird entfernt.</p>
    ${own.length ? `
    <label class="chk-row">
      <input type="checkbox" class="chk" id="m-withgas">
      <span class="chk-label">auch ihre ${own.length === 1 ? 'Gruppenadresse' : own.length + ' Gruppenadressen'} löschen</span>
    </label>
    ${linked ? `<p class="hint warn">${linked} davon sind Kommunikationsobjekten zugeordnet.</p>` : ''}`
    : '<p class="hint">Adressen, die auch andere Funktionen nutzen, bleiben in jedem Fall erhalten.</p>'}
  `, () => {
    const withGas = !!$('#m-withgas')?.checked;
    const n = KNX.deleteFunction(id, withGas);
    if (state.sel?.kind === 'fn' && state.sel.id === id) state.sel = { kind: 'node', id: fn.nodeId };
    if (state.filter?.kind === 'fn' && state.filter.id === id) state.filter = { kind: 'node', id: fn.nodeId };
    A.commit();
    if (n) A.toast(`${n} ${n === 1 ? 'Adresse' : 'Adressen'} mitgelöscht`);
  });
}

/* ---------- Adressen ---------- */
function actAssignFunctionGas(id) {
  const fn = KNX.functionById(id);
  if (!fn) return;
  const has = new Set(fn.gas.map(x => x.ga));
  const gs = KNX.project().groups.slice().sort((a, b) => a.raw - b.raw);
  A.openModal(`Adressen — ${fn.name}`, `
    <p class="hint">Adressen mit passendem DPT übernehmen die nächste freie Rolle.
       Schneller geht es, Adressen aus Tabelle oder Baum auf die Funktion zu ziehen.</p>
    <input class="input" id="m-search" placeholder="Adressen filtern …">
    <div class="chk-list tall" id="m-gas">${gs.map(g => `
      <label class="chk-row" data-name="${esc((KNX.addrStr(g) + ' ' + g.name).toLowerCase())}">
        <input type="checkbox" class="chk" data-ga="${g.id}"${has.has(g.id) ? ' checked' : ''}>
        <span class="addr">${KNX.addrStr(g)}</span>
        <span class="chk-label">${esc(g.name)}</span>
        <span class="dpt-tag">${g.dpt}</span>
      </label>`).join('') || '<p class="hint">Noch keine Gruppenadressen angelegt.</p>'}
    </div>
  `, () => {
    const picked = new Set([...$('#m-gas').querySelectorAll('.chk:checked')].map(c => c.dataset.ga));
    has.forEach(g => { if (!picked.has(g)) KNX.detachGa(id, g); });
    KNX.attachGas(id, [...picked].filter(g => !has.has(g)));
    A.commit();
  });
  $('#m-search').addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    $('#m-gas').querySelectorAll('.chk-row').forEach(el => { el.hidden = !!q && !el.dataset.name.includes(q); });
  });
}

/* Fehlende Rolle nachträglich mit einer neuen Adresse belegen — in der Gruppe,
   in der die Funktion schon Adressen hat. */
function createRoleGa(id, role) {
  const fn = KNX.functionById(id);
  if (!fn) return;
  const key = KNX.functionGroupKey(fn);
  const folder = key ? { key, create: {} } : KNX.functionFolder(fn.nodeId, fn.type);
  const missing = KNX.createRoleGas(fn, [role], folder);
  A.commit();
  if (missing) A.warn('In der Gruppe ist keine Adresse mehr frei.');
}

/* Rolle wechseln; wer die Rolle bisher hatte, wird zur weiteren Adresse. */
function setRole(id, gaId, role) {
  const fn = KNX.functionById(id);
  if (!fn) return;
  fn.gas.forEach(x => {
    if (x.ga === gaId) x.role = role;
    else if (role && x.role === role) x.role = '';
  });
  KNX.touch();
  A.commit();
}
function detach(id, gaId) {
  KNX.detachGa(id, gaId);
  A.commit();
}

/* Aus Tabelle oder Baum auf eine Funktion gezogen. */
function dropGas(ids, fnId) {
  const fn = KNX.functionById(fnId);
  if (!fn) return;
  const n = KNX.attachGas(fnId, ids);
  if (n) {
    A.commit();
    A.toast(`${n} ${n === 1 ? 'Adresse' : 'Adressen'} zu „${fn.name}“ hinzugefügt`);
  } else A.toast('Die Adressen gehören schon zu „' + fn.name + '“');
}

/* ---------- Umhängen ---------- */
function moveFunction(id, nodeId, refId, where) {
  if (!KNX.moveFunction(id, nodeId, refId, where)) return;
  state.collapsed.delete(nodeId);
  A.commit();
}
function actPickFunctions(nodeId) {
  const node = KNX.findNode(nodeId);
  if (!node) return;
  const items = KNX.project().functions.filter(f => f.nodeId !== nodeId).map(f => ({
    id: f.id, label: f.name, sub: KNX.fnType(f.type).de + ' · bisher ' + A.trailOf(f.nodeId), icon: fnIc(f)
  }));
  A.pickDialog(`Funktionen nach „${node.name}“ holen`, 'Die Funktionen behalten ihre Adressen.', items, ids => {
    ids.forEach(id => KNX.moveFunction(id, nodeId));
    state.collapsed.delete(nodeId);
    A.commit();
  });
}

window.KNXFn = { fnIc, typeIc, actNewFunction, actEditFunction, actDeleteFunction,
                 actAssignFunctionGas, createRoleGa, setRole, detach, dropGas,
                 moveFunction, actPickFunctions };
})();
