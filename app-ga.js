/* ============================================================
   KNX-Struktur — GA-Aktionen + Dialoge
   ============================================================ */
'use strict';

(() => {
const A = window.KNXApp, $ = s => document.querySelector(s);
const state = A.state, esc = A.esc;

/* ---------- Formularbausteine ---------- */
function addrFields(raw) {
  const style = KNX.gaStyle();
  const vals = KNX.gaSplit(raw, style);
  return `<div class="addr-grid" style="grid-template-columns:repeat(${style.parts.length},1fr)">` +
    style.parts.map((p, i) => `
      <div class="field"><span>${esc(p.label)} <em>0–${p.max}</em></span>
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
      return { err: `${p.label} muss zwischen 0 und ${p.max} liegen.` };
    vals.push(v);
  }
  const raw = KNX.gaJoin(vals, style);
  if (raw === 0) return { err: 'Die Adresse 0/0/0 ist als Broadcast reserviert.' };
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
function actNewGa() {
  const near = state.sel?.kind === 'ga' ? KNX.gaById(state.sel.id)?.raw
    : state.filter?.kind === 'grp' ? gaPrefixRaw(state.filter.id) : 0;
  const sug = KNX.suggestAddress(near);
  A.openModal('Neue Gruppenadresse anlegen', `
    <label class="field"><span>Name</span>
      <input class="input" id="m-name" maxlength="60" placeholder="z. B. Licht Flur OG schalten">
    </label>
    <div class="field"><span>Adresse (${esc(KNX.gaStyle().label)})</span>
      ${addrFields(sug)}
      <div id="m-err"></div>
    </div>
    <label class="field"><span>Datenpunkttyp</span>
      <select class="select" id="m-dpt">${dptOptions('1.001')}</select>
    </label>
    <p class="hint">Wirksam wird die Adresse erst, wenn ihr Kommunikationsobjekte
    zugeordnet sind — danach über das Kettensymbol.</p>
  `, () => {
    const name = $('#m-name').value.trim();
    if (!name) { showErr('Bitte einen Namen vergeben.'); $('#m-name').focus(); return false; }
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
  A.openModal('Gruppenadresse bearbeiten', `
    <label class="field"><span>Name</span>
      <input class="input" id="m-name" maxlength="60" value="${esc(ga.name)}">
    </label>
    <div class="field"><span>Adresse (${esc(KNX.gaStyle().label)})</span>
      ${addrFields(ga.raw)}
      <div id="m-err"></div>
    </div>
    <label class="field"><span>Datenpunkttyp</span>
      <select class="select" id="m-dpt">${dptOptions(ga.dpt)}</select>
    </label>
    <label class="field"><span>Notiz</span>
      <input class="input" id="m-note" maxlength="120" placeholder="optional" value="${esc(ga.note || '')}">
    </label>
  `, () => {
    const name = $('#m-name').value.trim();
    if (!name) { showErr('Bitte einen Namen vergeben.'); $('#m-name').focus(); return false; }
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
  A.openModal('Gruppenadresse löschen?', `
    <p><b>${KNX.addrStr(ga)}</b> — „${esc(ga.name)}“ wird dauerhaft entfernt.</p>
    ${n ? `<p class="hint warn">${n} Kommunikationsobjekte verlieren diese Adresse.</p>` : ''}
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
  A.openModal(`${ids.length} Adressen löschen?`, `
    <p>Die markierten Gruppenadressen werden dauerhaft entfernt.</p>
    ${n ? `<p class="hint warn">${n} Objektzuordnungen gehen dabei verloren.</p>` : ''}
  `, () => {
    ids.forEach(x => KNX.deleteGa(x));
    state.checked.clear();
    if (state.sel?.kind === 'ga' && ids.includes(state.sel.id)) state.sel = null;
    A.commit();
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
          <span class="assign-room">${room ? esc(room.name) : 'ohne Raum'}</span></div>
        ${d.objs.map(o => `
          <label class="chk-row">
            <input type="checkbox" class="chk" data-obj="${o.id}"${o.gas.includes(id) ? ' checked' : ''}>
            <span class="chk-label">${esc(o.name)}</span>
            <span class="dpt-tag${o.dpt === ga.dpt ? '' : ' bad'}" title="${o.dpt === ga.dpt ? 'passt zum DPT der Adresse' : 'weicht vom DPT der Adresse ab'}">${o.dpt}</span>
            <span class="flags" title="K L S Ü A">${KNX.flagStr(o.flags)}</span>
          </label>`).join('') || '<p class="hint">Keine Objekte angelegt.</p>'}
      </div>`;
  }).join('');
  A.openModal(`Zuordnung — ${KNX.addrStr(ga)} ${esc(ga.name)}`, `
    <p class="hint">Objekte markieren, die auf dieser Adresse senden oder hören.
    Das <b>erste</b> Objekt mit Ü-Flag ist das sendende.</p>
    <input class="input" id="m-search" placeholder="Geräte filtern …">
    <div class="chk-list tall" id="m-objs">${rows || '<p class="hint">Noch keine Geräte angelegt.</p>'}</div>
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
                 dptOptions, addrFields, readAddr, showErr };
})();
