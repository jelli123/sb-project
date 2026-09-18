/* ============================================================
   KNX-Struktur — GA-Aktionen + Dialoge
   ============================================================ */
'use strict';

(() => {
const A = window.KNXApp, $ = s => document.querySelector(s);
const state = A.state, esc = A.esc, T18 = A.t;

/* ---------- Formularbausteine ---------- */
function addrFields(raw) {
  const style = KNX.gaStyle();
  const vals = KNX.gaSplit(raw, style);
  return `<div class="addr-grid" style="grid-template-columns:repeat(${style.parts.length},1fr)">` +
    style.parts.map((p, i) => `
      <div class="field"><span>${esc(T18(p.label))} <em>0–${p.max}</em></span>
        <input class="input mono" id="m-a${i}" type="number" min="0" max="${p.max}" value="${vals[i]}">
      </div>`).join('') + '</div>';
}

/* Liefert den Rohwert oder eine Fehlermeldung. */
function readAddr(exceptId) {
  const style = KNX.gaStyle();
  const vals = [];
  for (let i = 0; i < style.parts.length; i++) {
    const p = style.parts[i];
    const v = $('#m-a' + i).valueAsNumber;
    if (!Number.isInteger(v) || v < 0 || v > p.max)
      return { err: T18('{0} muss zwischen 0 und {1} liegen.', T18(p.label), p.max) };
    vals.push(v);
  }
  const raw = KNX.gaJoin(vals, style);
  if (raw === 0) return { err: T18('Die Adresse 0/0/0 ist als Broadcast reserviert.') };
  if (!KNX.freeAddress(raw, exceptId))
    return { err: `Adresse ${KNX.gaStr(raw)} ist bereits vergeben.` };
  return { raw };
}

function dptOptions(sel) {
  return KNX.dptGroups().map(g =>
    `<optgroup label="${esc(g.label)}">` + g.items.map(d =>
      `<option value="${d.id}"${d.id === String(sel) ? ' selected' : ''}>` +
      `${d.id} — ${esc(d.name)}</option>`).join('') + '</optgroup>').join('');
}

function showErr(msg) {
  $('#m-err').innerHTML = msg ? `<span class="hint warn">${esc(msg)}</span>` : '';
}

/* ---------- Anlegen ---------- */
function actNewGa(groupKey) {
  const near = groupKey != null ? gaPrefixRaw(groupKey)
    : state.sel?.kind === 'ga' ? KNX.gaById(state.sel.id)?.raw
    : state.filter?.kind === 'grp' ? gaPrefixRaw(state.filter.id) : 0;
  const sug = KNX.suggestAddress(near);
  A.openModal(T18('Neue Gruppenadresse anlegen'), `
    <label class="field"><span>${T18('Name')}</span>
      <input class="input" id="m-name" maxlength="60" placeholder="${T18('z. B. Licht Flur OG schalten')}">
    </label>
    <div class="field"><span>${T18('Adresse ({0})', esc(T18(KNX.gaStyle().label)))}</span>
      ${addrFields(sug)}
      <div id="m-err"></div>
    </div>
    <label class="field"><span>${T18('Datenpunkttyp')}</span>
      <select class="select" id="m-dpt">${dptOptions('1.001')}</select>
    </label>
    <p class="hint">${T18('Wirksam wird die Adresse erst, wenn ihr Kommunikationsobjekte zugeordnet sind — danach über das Kettensymbol.')}</p>
  `, () => {
    const name = $('#m-name').value.trim();
    if (!name) { showErr(T18('Bitte einen Namen vergeben.')); $('#m-name').focus(); return false; }
    const r = readAddr();
    if (r.err) { showErr(r.err); return false; }
    const ga = KNX.addGa({ id: KNX.uid('g'), raw: r.raw, name,
                           dpt: $('#m-dpt').value, note: '' });
    state.sel = { kind: 'ga', id: ga.id };
    A.commit();
  });
}

/* Rohwert der ersten Adresse einer Haupt-/Mittelgruppe wie "1/2". */
function gaPrefixRaw(key) {
  const style = KNX.gaStyle();
  const vals = String(key).split('/').map(Number);
  while (vals.length < style.parts.length) vals.push(0);
  return KNX.gaJoin(vals, style);
}

/* ---------- Bearbeiten ---------- */
function actEditGa(id) {
  const ga = KNX.gaById(id);
  if (!ga) return;
  A.openModal(T18('Gruppenadresse bearbeiten'), `
    <label class="field"><span>${T18('Name')}</span>
      <input class="input" id="m-name" maxlength="60" value="${esc(ga.name)}">
    </label>
    <div class="field"><span>${T18('Adresse ({0})', esc(T18(KNX.gaStyle().label)))}</span>
      ${addrFields(ga.raw)}
      <div id="m-err"></div>
    </div>
    <label class="field"><span>${T18('Datenpunkttyp')}</span>
      <select class="select" id="m-dpt">${dptOptions(ga.dpt)}</select>
    </label>
    <label class="field"><span>${T18('Notiz')}</span>
      <input class="input" id="m-note" maxlength="120" placeholder="${T18('optional')}" value="${esc(ga.note || '')}">
    </label>
  `, () => {
    const name = $('#m-name').value.trim();
    if (!name) { showErr(T18('Bitte einen Namen vergeben.')); $('#m-name').focus(); return false; }
    const r = readAddr(ga.id);
    if (r.err) { showErr(r.err); return false; }
    Object.assign(ga, { name, raw: r.raw,
      dpt: $('#m-dpt').value, note: $('#m-note').value.trim() });
    A.commit();
  });
}

/* ---------- Löschen ---------- */
function actDeleteGa(id) {
  const ga = KNX.gaById(id);
  if (!ga) return;
  const n = KNX.gaLinks(id).length;
  A.openModal(T18('Gruppenadresse löschen?'), `
    <p>${T18('<b>{0}</b> — „{1}“ wird dauerhaft entfernt.', KNX.addrStr(ga), esc(ga.name))}</p>
    ${n ? `<p class="hint warn">${T18('{0} Kommunikationsobjekte verlieren diese Adresse.', n)}</p>` : ''}
  `, () => {
    KNX.deleteGa(id);
    if (state.sel?.id === id) state.sel = null;
    state.checked.delete(id);
    A.commit();
  });
}
function actDeleteSelected() {
  const ids = [...state.checked];
  if (!ids.length) return;
  const n = ids.reduce((s, x) => s + KNX.gaLinks(x).length, 0);
  A.openModal(T18('{0} Adressen löschen?', ids.length), `
    <p>${T18('Die markierten Gruppenadressen werden dauerhaft entfernt.')}</p>
    ${n ? `<p class="hint warn">${T18('{0} Objektzuordnungen gehen dabei verloren.', n)}</p>` : ''}
  `, () => {
    ids.forEach(x => KNX.deleteGa(x));
    state.checked.clear();
    if (state.sel?.kind === 'ga' && ids.includes(state.sel.id)) state.sel = null;
    A.commit();
  });
}

/* ---------- Haupt- und Mittelgruppen ---------- */

/* Neue Haupt- (parentKey leer) oder Mittelgruppe. Eine leere Gruppe besteht
   über ihren Namen, deshalb ist der Name Pflicht. Vorgeschlagen wird die
   kleinste Nummer, die weder benannt noch von Adressen belegt ist.        */
function actNewGaGroup(parentKey) {
  const style = KNX.gaStyle();
  const pre = parentKey ? String(parentKey).split('/').map(Number) : [];
  const level = pre.length;
  if (level >= style.parts.length - 1) return;
  const part = style.parts[level];
  const p = KNX.project();
  const keyOf = n => pre.concat(n).join('/');
  const taken = n => p.gaNames[keyOf(n)] != null || KNX.gasInGroup(keyOf(n)).length > 0;
  let free = 0;
  while (free <= part.max && taken(free)) free++;
  if (free > part.max) { A.warn(T18('Alle {0}n{1} sind belegt.', T18(part.label), parentKey ? ' ' + T18('in {0}', parentKey) : '')); return; }
  A.openModal(T18('Neue {0}{1}', T18(part.label), parentKey ? ' ' + T18('in {0}', parentKey) : ''), `
    <label class="field"><span>${esc(T18(part.label))} <em>0–${part.max}</em></span>
      <input class="input mono" id="m-num" type="number" min="0" max="${part.max}" value="${free}">
    </label>
    <label class="field"><span>${T18('Name')}</span>
      <input class="input" id="m-name" maxlength="40" placeholder="${level === 0 ? T18('z. B. Beleuchtung') : T18('z. B. Erdgeschoss')}">
    </label>
    <div id="m-err"></div>
  `, () => {
    const n = $('#m-num').valueAsNumber;
    const name = $('#m-name').value.trim();
    if (!Number.isInteger(n) || n < 0 || n > part.max) { showErr(T18('{0} muss zwischen 0 und {1} liegen.', T18(part.label), part.max)); return false; }
    if (taken(n)) { showErr(T18('{0} {1} gibt es schon.', T18(part.label), keyOf(n))); return false; }
    if (!name) { showErr(T18('Bitte einen Namen vergeben — eine leere Gruppe besteht über ihren Namen.')); $('#m-name').focus(); return false; }
    const key = keyOf(n);
    p.gaNames[key] = name;
    if (parentKey) state.collapsed.delete('grp:' + parentKey);
    state.sel = { kind: 'grp', id: key };
    KNX.touch();
    A.commit();
  });
  $('#m-name').focus();
}

/* Löscht die Gruppe mit allen Adressen darin, wie die ETS. */
function actDeleteGaGroup(key) {
  const style = KNX.gaStyle();
  const level = String(key).split('/').length - 1;
  const label = style.parts[level]?.label || 'Gruppe';
  const name = KNX.project().gaNames[key] || '';
  const gs = KNX.gasInGroup(key);
  const links = gs.reduce((s, g) => s + KNX.gaLinks(g.id).length, 0);
  A.openModal(T18('{0} {1} löschen?', T18(label), key), `
    <p>${T18('<b>{0}</b>{1} wird entfernt{2}.', esc(key),
        name ? ' — „' + esc(name) + '“' : '',
        gs.length ? T18(', mit <b>{0}</b> Gruppenadressen', gs.length) : '')}</p>
    ${links ? `<p class="hint warn">${T18('{0} Objektzuordnungen gehen dabei verloren.', links)}</p>` : ''}
    ${gs.length ? `<p class="hint">${T18('Sollen die Adressen erhalten bleiben, vorher markieren und verschieben.')}</p>` : ''}
  `, () => {
    const ids = new Set(gs.map(g => g.id));
    KNX.deleteGaGroup(key);
    ids.forEach(id => state.checked.delete(id));
    if ((state.sel?.kind === 'ga' && ids.has(state.sel.id))
        || (state.sel?.kind === 'grp' && (state.sel.id === key || String(state.sel.id).startsWith(key + '/'))))
      state.sel = null;
    if (state.filter?.kind === 'grp'
        && (state.filter.id === key || String(state.filter.id).startsWith(key + '/')))
      state.filter = null;
    A.commit();
  });
}

/* Unterste Ordnerebene: in sie hinein werden Adressen verschoben. */
const folderDepth = () => KNX.gaStyle().parts.length - 1;

function moveGasTo(ids, key) {
  const r = KNX.moveGas(ids, key);
  const name = KNX.project().gaNames[key];
  if (r.moved) {
    A.commit();
    A.toast(r.moved === 1 ? T18('{0} Adresse nach {1} verschoben', r.moved, key + (name ? ' „' + name + '“' : ''))
                          : T18('{0} Adressen nach {1} verschoben', r.moved, key + (name ? ' „' + name + '“' : '')));
  }
  if (r.failed) A.warn(r.failed === 1
    ? T18('{0} Adresse passt nicht mehr in {1} — dort ist nichts mehr frei.', r.failed, key)
    : T18('{0} Adressen passen nicht mehr in {1} — dort ist nichts mehr frei.', r.failed, key));
  else if (!r.moved && r.same) A.toast(T18('Die Adressen liegen bereits in {0}', key));
}

function actMoveGas(ids) {
  ids = ids.filter(id => KNX.gaById(id));
  if (!ids.length) return;
  const style = KNX.gaStyle();
  const depth = folderDepth();
  if (depth < 1) { A.warn(T18('Bei freier Adressierung gibt es keine Gruppen zum Verschieben.')); return; }
  const first = KNX.gaSplit(KNX.gaById(ids[0]).raw, style);
  const tree = KNX.gaTree();
  const folders = [];
  const collect = (n, trail) => n.children.forEach(c => {
    const t = trail.concat(c.name || '');
    if (c.level === depth - 1) folders.push({ key: c.key, label: t.filter(Boolean).join(' › ') });
    else collect(c, t);
  });
  collect(tree, []);
  A.openModal(ids.length === 1 ? T18('Adresse verschieben') : T18('{0} Adressen verschieben', ids.length), `
    <label class="field"><span>${T18('Vorhandene Gruppe')}</span>
      <select class="select" id="m-folder"><option value="">${T18('— Nummer unten eingeben —')}</option>${folders.map(f =>
        `<option value="${esc(f.key)}">${esc(f.key)}${f.label ? ' — ' + esc(f.label) : ''}</option>`).join('')}</select>
    </label>
    <div class="addr-grid" style="grid-template-columns:repeat(${depth},1fr)">${style.parts.slice(0, depth).map((p, i) => `
      <div class="field"><span>${esc(T18(p.label))} <em>0–${p.max}</em></span>
        <input class="input mono" id="m-p${i}" type="number" min="0" max="${p.max}" value="${first[i]}"></div>`).join('')}
    </div>
    <p class="hint">${T18('Die letzte Stufe bleibt, wenn sie in der Zielgruppe frei ist, sonst gibt es die nächste freie. Zuordnungen zu Objekten bleiben erhalten.')}</p>
    <div id="m-err"></div>
  `, () => {
    const vals = [];
    for (let i = 0; i < depth; i++) {
      const v = $('#m-p' + i).valueAsNumber;
      if (!Number.isInteger(v) || v < 0 || v > style.parts[i].max) {
        showErr(T18('{0} muss zwischen 0 und {1} liegen.', T18(style.parts[i].label), style.parts[i].max));
        return false;
      }
      vals.push(v);
    }
    moveGasTo(ids, vals.join('/'));
  });
  $('#m-folder').addEventListener('change', e => {
    if (!e.target.value) return;
    e.target.value.split('/').forEach((v, i) => { $('#m-p' + i).value = v; });
  });
}

/* ---------- Zuordnung zu Kommunikationsobjekten ---------- *
 * In der ETS liegt eine GA nicht auf einem Raum, sondern auf den Objekten
 * von Geräten. Der Raumbezug ergibt sich daraus, wo das Gerät verbaut ist. */
function actAssignGa(id) {
  const ga = KNX.gaById(id);
  if (!ga) return;
  const devs = KNX.project().devices;
  const rows = devs.map(d => {
    const room = d.roomId ? KNX.findNode(d.roomId) : null;
    return `
      <div class="assign-dev" data-name="${esc((d.name + ' ' + d.product + ' ' + (room ? room.name : '')).toLowerCase())}">
        <div class="assign-head"><span class="addr">${KNX.paStr(d.addr)}</span> ${esc(d.name)}
          <span class="assign-room">${room ? esc(room.name) : T18('ohne Raum')}</span></div>
        ${d.objs.map(o => `
          <label class="chk-row">
            <input type="checkbox" class="chk" data-obj="${o.id}"${o.gas.includes(id) ? ' checked' : ''}>
            <span class="chk-label">${esc(o.name)}</span>
            <span class="dpt-tag${o.dpt === ga.dpt ? '' : ' bad'}" title="${o.dpt === ga.dpt ? T18('passt zum DPT der Adresse') : T18('weicht vom DPT der Adresse ab')}">${o.dpt}</span>
            <span class="flags" title="${T18('K L S Ü A')}">${KNX.flagStr(o.flags)}</span>
          </label>`).join('') || `<p class="hint">${T18('Keine Objekte angelegt.')}</p>`}
      </div>`;
  }).join('');
  A.openModal(T18('Zuordnung — {0} {1}', KNX.addrStr(ga), ga.name), `
    <p class="hint">${T18('Objekte markieren, die auf dieser Adresse senden oder hören. Das <b>erste</b> Objekt mit Ü-Flag ist das sendende.')}</p>
    <input class="input" id="m-search" placeholder="${T18('Geräte filtern …')}">
    <div class="chk-list tall" id="m-objs">${rows || `<p class="hint">${T18('Noch keine Geräte angelegt.')}</p>`}</div>
  `, () => {
    const picked = new Set([...$('#m-objs').querySelectorAll('.chk:checked')].map(c => c.dataset.obj));
    devs.forEach(d => d.objs.forEach(o => {
      const has = o.gas.includes(id);
      if (picked.has(o.id) && !has) o.gas.push(id);
      else if (!picked.has(o.id) && has) o.gas = o.gas.filter(x => x !== id);
    }));
    A.commit();
  });
  $('#m-search').addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    $('#m-objs').querySelectorAll('.assign-dev').forEach(el => {
      el.hidden = !!q && !el.dataset.name.includes(q);
    });
  });
}

window.KNXGA = { actNewGa, actEditGa, actDeleteGa, actDeleteSelected, actAssignGa,
                 actDeleteGaGroup, actMoveGas, moveGasTo, folderDepth, actNewGaGroup,
                 dptOptions, addrFields, readAddr, showErr };
})();
