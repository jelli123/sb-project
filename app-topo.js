/* ============================================================
   KNX-Struktur — Topologie, Geräte, Kommunikationsobjekte
   ============================================================ */
'use strict';

(() => {
const A = window.KNXApp, G = window.KNXGA, $ = s => document.querySelector(s);
const state = A.state, esc = A.esc;

const showErr = msg => { $('#m-err').innerHTML = msg ? `<span class="hint warn">${esc(msg)}</span>` : ''; };

function lineOptions(sel) {
  return KNX.project().areas.map(a =>
    `<optgroup label="${esc(a.addr + '  ' + a.name)}">` + a.lines.map(l =>
      `<option value="${l.id}"${l.id === sel ? ' selected' : ''}>` +
      `${a.addr}.${l.addr} — ${esc(l.name)}</option>`).join('') + '</optgroup>').join('');
}
function roomOptions(sel) {
  return '<option value="">— kein Raum —</option>' + KNX.rooms().map(r =>
    `<option value="${r.node.id}"${r.node.id === sel ? ' selected' : ''}>${esc(r.trail)}</option>`).join('');
}

/* Nur Nummern anbieten, die auf der Linie noch frei sind — die eigene bleibt
   beim Bearbeiten wählbar. */
function deviceOptions(lineId, sel, exceptId) {
  const line = KNX.lineById(lineId), area = KNX.areaOfLine(lineId);
  if (!line || !area) return '';
  const out = [];
  for (let n = 0; n <= KNX.PA_MAX.device; n++) {
    const raw = KNX.paJoin(area.addr, line.addr, n);
    if (n !== sel && !KNX.paFree(raw, exceptId)) continue;
    out.push(`<option value="${n}"${n === sel ? ' selected' : ''}>${area.addr}.${line.addr}.${n}` +
      (n === 0 ? ' — Koppler' : '') + '</option>');
  }
  return out.join('');
}
function flagBoxes(flags) {
  return '<div class="flag-grid">' + KNX.KO_FLAGS.map(f => `
    <label class="flag-box" title="${esc(f.desc)}">
      <input type="checkbox" id="m-f-${f.key}"${flags[f.key] ? ' checked' : ''}>
      <b>${f.short}</b><span>${esc(f.de)}</span>
    </label>`).join('') + '</div>';
}
const readFlags = () => {
  const out = {};
  KNX.KO_FLAGS.forEach(f => { out[f.key] = $('#m-f-' + f.key).checked; });
  return out;
};

/* ---------- Geräte ---------- */
const objCount = c => Object.keys(c.objs || {}).length;

function catalogOptions(sel) {
  const items = KNX.project().catalog;
  return '<option value="">— frei definiert —</option>' + items.map(c =>
    `<option value="${c.id}"${c.id === sel ? ' selected' : ''}>` +
    `${esc(c.name)}${c.order ? ' · ' + esc(c.order) : ''}</option>`).join('');
}

function deviceForm(d, opt) {
  const noAddr = d.addr === null;
  const [, , dev] = noAddr ? [0, 0, KNX.paSplit(KNX.freePa(d.lineId, opt && opt.exceptId))[2]] : KNX.paSplit(d.addr);
  const cat = opt && opt.catalog;
  const except = opt && opt.exceptId;
  return `
    ${cat ? `
    <div class="field"><span>Produkt</span>
      <div class="pick-row">
        <select class="select" id="m-cat">${catalogOptions(d.catalogId)}</select>
        <button type="button" class="btn btn-sm" id="m-cat-open">Katalog …</button>
      </div>
      <p class="hint" id="m-cat-hint"></p>
    </div>` : ''}
    <label class="field"><span>Name</span>
      <input class="input" id="m-name" maxlength="60" value="${esc(d.name)}" placeholder="z. B. Schaltaktor 8-fach">
    </label>
    <label class="field"><span>Produkt / Bauform</span>
      <input class="input" id="m-product" maxlength="60" value="${esc(d.product)}" placeholder="z. B. REG, 16 A">
    </label>
    <label class="field"><span>Linie</span>
      <select class="select" id="m-line">${lineOptions(d.lineId)}</select>
    </label>
    <label class="field"><span>Physikalische Adresse <em>nur freie</em></span>
      <select class="select mono" id="m-dev"${noAddr ? ' disabled' : ''}>${deviceOptions(d.lineId, dev, except)}</select>
    </label>
    <label class="chk" title="Drosseln, Netzteile und passives Zubehör: nur der Linie zugeordnet, belegen keine Adresse">
      <input type="checkbox" id="m-noaddr"${noAddr ? ' checked' : ''}> Ohne physikalische Adresse</label>
    <label class="field"><span>Verbaut in</span>
      <select class="select" id="m-room">${roomOptions(d.roomId)}</select>
    </label>
    <div class="addr-grid" style="grid-template-columns:1fr 1fr">
      <label class="field"><span>Busstrom <em>mA</em></span>
        <input class="input mono" id="m-ma" type="number" min="0" max="5000"
               value="${d.ma == null ? '' : d.ma}" placeholder="${KNX.deviceMa(d)}">
      </label>
      <label class="field"><span>Einspeisung <em>mA, 0 = keine</em></span>
        <input class="input mono" id="m-supply" type="number" min="0" max="5000" value="${+d.supply || 0}">
      </label>
    </div>
    <label class="field"><span>Seriennummer <em>6 Byte hex, optional</em></span>
      <input class="input mono" id="m-serial" maxlength="20" value="${esc(d.serial || '')}"
             placeholder="wird beim Auslesen am Bus eingetragen">
    </label>
    <label class="field"><span>Notiz</span>
      <textarea class="input note" id="m-note" rows="3" maxlength="${KNX.NOTE_MAX}"
                placeholder="z. B. Einbauort im Verteiler, Besonderheiten, Reklamation">${esc(d.note || '')}</textarea>
    </label>
    <div id="m-err"></div>`;
}
function readDevice(exceptId) {
  const name = $('#m-name').value.trim();
  if (!name) return { err: 'Bitte einen Namen vergeben.' };
  const lineId = $('#m-line').value;
  const line = KNX.lineById(lineId), area = KNX.areaOfLine(lineId);
  let addr = null;
  if (!$('#m-noaddr').checked) {
    const n = parseInt($('#m-dev').value, 10);
    if (!Number.isInteger(n)) return { err: 'Auf dieser Linie ist keine Adresse mehr frei.' };
    addr = KNX.paJoin(area.addr, line.addr, n);
    if (!KNX.paFree(addr, exceptId))
      return { err: `Physikalische Adresse ${KNX.paStr(addr)} ist bereits vergeben.` };
  }
  const ma = $('#m-ma').value.trim();
  const serialRaw = $('#m-serial').value.trim();
  const serial = KNX.normSerial(serialRaw);
  if (serialRaw && !serial)
    return { err: 'Die Seriennummer besteht aus 6 Byte, also 12 Hex-Zeichen (z. B. 00FA12345678).' };
  return { name, product: $('#m-product').value.trim(), lineId, addr,
           roomId: $('#m-room').value || null,
           ma: ma === '' ? null : Math.max(0, parseInt(ma, 10) || 0),
           supply: Math.max(0, $('#m-supply').valueAsNumber || 0),
           serial, note: $('#m-note').value.trim() };
}

/* Merkt den Formularstand, damit ein Ausflug in den Katalog nichts verwirft. */
function readDraft() {
  const lineId = $('#m-line') ? $('#m-line').value : null;
  const line = lineId && KNX.lineById(lineId), area = lineId && KNX.areaOfLine(lineId);
  const n = $('#m-dev') ? parseInt($('#m-dev').value, 10) : 0;
  return {
    name: $('#m-name') ? $('#m-name').value : '',
    product: $('#m-product') ? $('#m-product').value : '',
    lineId,
    addr: $('#m-noaddr') && $('#m-noaddr').checked ? null
      : line && area ? KNX.paJoin(area.addr, line.addr, Number.isInteger(n) ? n : 0) : 0,
    roomId: ($('#m-room') && $('#m-room').value) || null,
    ma: $('#m-ma') && $('#m-ma').value !== '' ? parseInt($('#m-ma').value, 10) : null,
    supply: ($('#m-supply') && $('#m-supply').valueAsNumber) || 0,
    serial: ($('#m-serial') && $('#m-serial').value) || '',
    note: ($('#m-note') && $('#m-note').value) || '',
    catalogId: ($('#m-cat') && $('#m-cat').value) || ''
  };
}
function actNewDevice(ctx) {
  const p = KNX.project();
  const lineId = ctx?.lineId || (state.filter?.kind === 'line' ? state.filter.id : p.areas[0].lines[0]?.id);
  const roomId = ctx?.roomId
    || (state.sel?.kind === 'node' && KNX.DEVICE_HOSTS.has(KNX.findNode(state.sel.id)?.kind || '')
        ? state.sel.id : null);
  const draft = ctx?.draft || { name: '', product: '', lineId, addr: KNX.freePa(lineId), roomId,
                                ma: null, supply: 0, serial: '', note: '' };
  if (ctx?.catalogId) draft.catalogId = ctx.catalogId;
  if (!draft.addr && draft.addr !== null) draft.addr = KNX.freePa(draft.lineId || lineId);

  A.openModal('Neues Gerät anlegen', deviceForm(draft, { catalog: true }), () => {
    const r = readDevice();
    if (r.err) { showErr(r.err); return false; }
    const cat = KNX.catalogById($('#m-cat').value);
    const d = KNX.addDevice({
      id: KNX.uid('d'), ...r,
      catalogId: cat ? cat.id : null,
      params: {},
      objs: []
    });
    if (cat) KNX.applyProduct(d);
    state.sel = { kind: 'dev', id: d.id };
    A.commit();
    if (cat) A.status(`${d.objs.length} Kommunikationsobjekte aus „${cat.name}“ übernommen`);
  });

  // Linienwechsel bietet die freien Nummern der neuen Linie an
  $('#m-line').addEventListener('change', e => {
    const next = KNX.paSplit(KNX.freePa(e.target.value))[2];
    $('#m-dev').innerHTML = deviceOptions(e.target.value, next);
  });

  const applyCat = () => {
    const c = KNX.catalogById($('#m-cat').value);
    const hint = $('#m-cat-hint');
    // Ein Produkt ohne physikalische Adresse legt das fest
    $('#m-noaddr').disabled = !!(c && c.noAddress);
    if (c && c.noAddress && !$('#m-noaddr').checked) {
      $('#m-noaddr').checked = true;
      $('#m-dev').disabled = true;
    }
    if (!c) {
      hint.textContent = 'Ohne Produkt entsteht ein leeres Gerät — Objekte legt man später einzeln an.';
      return;
    }
    if (c.hwOnly) {
      // Die Produktdatei nennt nur, was das Gerät selbst dem Bus entnimmt — die
      // Einspeisung einer Drossel hängt vom angeschlossenen Netzteil ab.
      hint.innerHTML = 'Ohne Applikation' + (c.manufacturer ? ` · ${esc(c.manufacturer)}` : '') +
        (c.choke || c.powerSupply
          ? '. Die Einspeisung steht nicht in der Produktdatei — bitte unten den Nennstrom '
            + (c.choke ? 'des angeschlossenen Netzteils' : 'des Netzteils') + ' eintragen.' : '.') +
        (c.noAddress ? ' Das Gerät hat keine physikalische Adresse und hängt nur an seiner Linie.' : '');
      if (!$('#m-name').value.trim()) $('#m-name').value = c.name.slice(0, 60);
      if (!$('#m-product').value.trim()) $('#m-product').value = (c.order || c.name).slice(0, 60);
      if (c.ma) $('#m-ma').placeholder = String(c.ma);
      return;
    }
    const r = KNX.resolveProduct(c, {});
    const nParams = r.groups.reduce((s, g) => s + g.params.filter(ref => {
      const p = c.params[ref];
      return p && String(p.t || '').trim() && (c.types[p.pt] || {}).k !== 'none';
    }).length, 0);
    hint.innerHTML = (r.objs.length
        ? `<b>${r.objs.length}</b> Kommunikationsobjekte und <b>${nParams}</b> Parameter`
        : `<b>${nParams}</b> Parameter, keine Kommunikationsobjekte`) +
      ' in der Grundeinstellung' +
      (c.manufacturer ? ` · ${esc(c.manufacturer)}` : '') +
      (c.appName ? ` · ${esc(c.appName)}` : '');
    if (!$('#m-name').value.trim()) $('#m-name').value = c.name.slice(0, 60);
    if (!$('#m-product').value.trim()) $('#m-product').value = (c.order || c.name).slice(0, 60);
    // Busstrom aus der Produktdatei als Vorbelegung anbieten
    if (c.ma) $('#m-ma').placeholder = String(c.ma);
  };
  $('#m-cat').addEventListener('change', applyCat);
  wireNoAddr();
  $('#m-cat-open').addEventListener('click', () => {
    const draftNow = readDraft();
    A.closeModal();
    actCatalog(id => actNewDevice({ ...ctx, draft: draftNow, catalogId: id || draftNow.catalogId }));
  });
  applyCat();
  $('#m-name').focus();
}

/* Ohne Adresse ist die Nummernauswahl gesperrt; beim Abwählen gibt es die nächste freie. */
function wireNoAddr() {
  $('#m-noaddr').addEventListener('change', e => {
    $('#m-dev').disabled = e.target.checked;
  });
}

function actEditDevice(id) {
  const d = KNX.deviceById(id);
  if (!d) return;
  A.openModal(`Gerät bearbeiten — ${KNX.paStr(d.addr)}`, deviceForm(d, { exceptId: id }), () => {
    const r = readDevice(id);
    if (r.err) { showErr(r.err); return false; }
    Object.assign(d, r);
    KNX.touch();
    A.commit();
  });
  wireNoAddr();
  const item = d.catalogId && KNX.catalogById(d.catalogId);
  if (item && item.noAddress) $('#m-noaddr').disabled = true;
  $('#m-line').addEventListener('change', e => {
    const keep = d.addr === null ? 1 : KNX.paSplit(d.addr)[2];
    const free = KNX.paSplit(KNX.freePa(e.target.value, id))[2];
    $('#m-dev').innerHTML = deviceOptions(e.target.value,
      KNX.paFree(KNX.paJoin(KNX.areaOfLine(e.target.value).addr,
        KNX.lineById(e.target.value).addr, keep), id) ? keep : free, id);
  });
}

function actDeleteDevice(id) {
  const d = KNX.deviceById(id);
  if (!d) return;
  const n = d.objs.reduce((s, o) => s + o.gas.length, 0);
  A.openModal(`Gerät „${esc(d.name)}“ löschen?`, `
    <p><b>${KNX.paStr(d.addr)}</b> wird mit allen ${d.objs.length} Kommunikationsobjekten entfernt.</p>
    ${n ? `<p class="hint warn">${n} Adresszuordnungen gehen verloren. Die Gruppenadressen
           selbst bleiben erhalten.</p>` : ''}
  `, () => {
    KNX.deleteDevice(id);
    if (state.sel?.kind === 'dev' && state.sel.id === id) state.sel = null;
    if (state.filter?.kind === 'dev' && state.filter.id === id) state.filter = null;
    A.commit();
  });
}

/* ---------- Produktkatalog aus .knxprod ---------- */

/* Öffnet den Dateidialog und liefert die enthaltenen Produkte. */
function pickProdFile(onProducts) {
  const input = $('#prod-file');
  input.onchange = async () => {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    A.status('Lese ' + file.name + ' …');
    try {
      const r = await KNXProd.read(file);
      onProducts(r.products, file.name, r);
    } catch (e) {
      A.warn('Produktdatei nicht lesbar: ' + (e && e.message ? e.message : e));
    }
  };
  input.click();
}

/* Katalogverwaltung; `onPick` bekommt die Id des gewählten Produkts. */
function actCatalog(onPick) {
  const render = () => {
    const items = KNX.project().catalog;
    return `
      <p class="hint">Produkte aus ETS-Produktdateien (<b>.knxprod</b>). Ein gewähltes
      Produkt legt beim Anlegen eines Geräts alle Kommunikationsobjekte mit an.</p>
      <div class="pick-row">
        <button type="button" class="btn btn-sm btn-primary" id="m-load">Produktdatei laden …</button>
        <input class="input" id="m-search" placeholder="Katalog durchsuchen …">
      </div>
      <div class="chk-list tall" id="m-cat-list">
        ${items.length ? items.map(c => `
          <div class="cat-row" data-id="${c.id}"
               data-name="${esc((c.name + ' ' + c.order + ' ' + c.manufacturer).toLowerCase())}">
            <div class="cat-main">
              <b>${esc(c.name)}</b>
              <span>${esc([c.manufacturer, c.order, c.appName].filter(Boolean).join(' · '))}</span>
            </div>
            <span class="dpt-tag">${c.hwOnly ? 'ohne Applikation' : objCount(c)
              ? objCount(c) + ' KO'
              : Object.keys(c.params || {}).length + ' P'}</span>            <button type="button" class="icon-btn cat-del" data-id="${c.id}" title="Aus dem Katalog entfernen">
              ${A.IC_TRASH}</button>
          </div>`).join('')
          : '<p class="hint">Der Katalog ist leer. Oben eine <b>.knxprod</b>-Datei laden.</p>'}
      </div>`;
  };

  let picked = '';
  A.openModal('Produktkatalog', render(), () => {
    if (onPick) A.nextModal(() => onPick(picked));
  });

  const wire = () => {
    const list = $('#m-cat-list');
    list.querySelectorAll('.cat-row').forEach(row => {
      row.addEventListener('click', e => {
        if (e.target.closest('.cat-del')) return;
        picked = row.dataset.id;
        list.querySelectorAll('.cat-row').forEach(r => r.classList.toggle('sel', r === row));
      });
      row.addEventListener('dblclick', () => { picked = row.dataset.id; A.modalConfirm(); });
    });
    list.querySelectorAll('.cat-del').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      const c = KNX.catalogById(b.dataset.id);
      KNX.deleteCatalogItem(b.dataset.id);
      if (picked === b.dataset.id) picked = '';
      A.commit();
      $('#modal-body').innerHTML = render();
      wire();
      A.status(`„${c ? c.name : 'Produkt'}“ aus dem Katalog entfernt`);
    }));
    $('#m-search').addEventListener('input', e => {
      const q = e.target.value.trim().toLowerCase();
      list.querySelectorAll('.cat-row').forEach(r => {
        r.hidden = !!q && !r.dataset.name.includes(q);
      });
    });
    $('#m-load').addEventListener('click', () => {
      pickProdFile((products, fileName, info) => {
        A.closeModal();
        actImportPick(products, fileName, () => actCatalog(onPick), info);
      });
    });
  };
  wire();
}

/* Auswahl aus einer frisch geladenen Produktdatei. */
function actImportPick(products, fileName, onDone, info) {
  const skipped = (info && info.binaries) || [];
  const rows = products.map((p, i) => {
    const g = p.prog;
    // BCU1 und Koppler bringen die Ladeprozedur über die Maskendefinition mit
    const ready = !!(g && g.dl && (g.procedures.length || (g.dl.mk && g.dl.mk.procs.length))
      && !g.unsupported.length && !g.plugin);
    const mask = g && g.mask ? g.mask.replace(/^MV-/, '') : '';
    return `
    <label class="chk-row" data-name="${esc((p.name + ' ' + p.order + ' ' + p.manufacturer).toLowerCase())}">
      <input type="checkbox" class="chk" data-i="${i}"${products.length === 1 ? ' checked' : ''}>
      <span class="chk-label">
        <b>${esc(p.name)}</b>
        ${p.order || p.manufacturer
          ? `<span class="cat-sub">${esc([p.manufacturer, p.order].filter(Boolean).join(' · '))}</span>` : ''}
      </span>
      ${mask ? `<span class="src-tag${ready ? ' prog' : ''}"
        title="${ready
          ? 'Ladeprozeduren vollständig gelesen — das Gerät lässt sich programmieren'
          : 'Für einen Download fehlen Angaben oder es wird ein herstellereigenes Programm gebraucht'}"
        >Maske ${esc(mask)}</span>` : ''}
      <span class="dpt-tag" title="Objekte und Parameter der Produktdatei">${p.hwOnly
        ? 'ohne Applikation' : p.objCount + ' KO · ' + p.paramCount + ' P'}</span>
    </label>`;
  }).join('');

  A.openModal(`${products.length} Produkte in ${fileName}`, `
    <p class="hint">Produkte auswählen, die in den Katalog übernommen werden sollen.</p>
    ${skipped.length ? `<p class="hint warn">${skipped.length} herstellereigene
      ${skipped.length === 1 ? 'Datei wird' : 'Dateien werden'} übergangen
      (${esc(skipped.slice(0, 3).map(b => b.name.split('/').pop()).join(', '))}${
        skipped.length > 3 ? ' …' : ''}). Solche Programme laufen nur unter Windows in der ETS.
      Die Produktdaten selbst sind davon unberührt.</p>` : ''}
    <div class="pick-row">
      <input class="input" id="m-search" placeholder="Filtern …">
      <button type="button" class="btn btn-sm" id="m-all">Alle</button>
      <button type="button" class="btn btn-sm" id="m-none">Keine</button>
    </div>
    <div class="chk-list tall" id="m-prods">${rows}</div>
    <div id="m-err"></div>
  `, () => {
    const sel = [...$('#m-prods').querySelectorAll('.chk:checked')].map(c => products[+c.dataset.i]);
    if (!sel.length) { showErr('Mindestens ein Produkt auswählen.'); return false; }
    const added = KNX.addCatalogItems(sel);
    A.commit();
    A.status(`${added.length} ${added.length === 1 ? 'Produkt' : 'Produkte'} im Katalog`);
    if (onDone) A.nextModal(onDone);
  });

  const visible = () => [...$('#m-prods').querySelectorAll('.chk-row')].filter(r => !r.hidden);
  $('#m-all').addEventListener('click', () =>
    visible().forEach(r => { r.querySelector('.chk').checked = true; }));
  $('#m-none').addEventListener('click', () =>
    visible().forEach(r => { r.querySelector('.chk').checked = false; }));
  $('#m-search').addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    $('#m-prods').querySelectorAll('.chk-row').forEach(r => {
      r.hidden = !!q && !r.dataset.name.includes(q);
    });
  });
}

/* ---------- Geräteparameter ---------- *
 * Wie in der ETS bestimmen die Parameter, welche weiteren Parameter und
 * welche Kommunikationsobjekte überhaupt existieren. Der Dialog rechnet
 * deshalb nach jeder Änderung neu.                                        */
function actParams(devId) {
  const dev = KNX.deviceById(devId);
  if (!dev) return;
  const item = (dev.catalogId && KNX.catalogById(dev.catalogId)) || null;
  const hasIp = KNX.deviceIsIp(dev);
  if (!item && !hasIp) {
    A.warn('Diesem Gerät liegt kein Produkt aus einer .knxprod zugrunde.');
    return;
  }

  const draft = { ...dev.params };
  const ip = KNX.ipConfig(dev);
  let focusRef = null;
  let lastFilter = '';

  /* IP-Adresse, Maske und Multicast stehen nicht in der Produktdatei —
     die ETS führt sie im Eigenschaftsfenster des Geräts.                  */
  const ipField = f => {
    if (f.manualOnly && ip.mode !== 'manual') return '';
    if (f.key === 'tunnels' && KNX.tunnelCountFixed(dev)) {
      return `<label class="prm"><span>${esc(f.label)} <em>laut Produktdatei</em></span>
        <input class="input mono" type="text" value="${KNX.tunnelCount(dev)}" disabled></label>`;
    }
    const val = ip[f.key] == null ? '' : String(ip[f.key]);
    if (f.kind === 'enum') {
      return `<label class="prm"><span>${esc(f.label)}</span>
        <select class="select ip-in" data-key="${f.key}">${f.v.map(([v, t]) =>
          `<option value="${v}"${v === val ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
    }
    if (f.kind === 'num') {
      return `<label class="prm"><span>${esc(f.label)} <em>${f.min}–${f.max}</em></span>
        <input class="input mono ip-in" type="number" data-key="${f.key}"
               min="${f.min}" max="${f.max}" value="${esc(val)}"></label>`;
    }
    if (f.kind === 'ip') {
      return `<label class="prm"><span>${esc(f.label)} <em>IPv4</em></span>
        <input class="input mono ip-in" type="text" data-key="${f.key}" value="${esc(val)}"
               inputmode="decimal" placeholder="192.168.1.10"
               pattern="^((25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(25[0-5]|2[0-4]\\d|1?\\d?\\d)$"></label>`;
    }
    return `<label class="prm"><span>${esc(f.label)}</span>
      <input class="input ip-in" type="text" data-key="${f.key}" value="${esc(val)}"
             placeholder="${esc(dev.name)}" maxlength="${f.max || 60}"></label>`;
  };

  const field = ref => {
    const p = item.params[ref];
    const type = item.types[p.pt] || { k: 'text' };
    const label = String(p.t || '').trim();
    // Parameter ohne Beschriftung sind interne Hilfsgrößen der Produktdatei
    if (!label) return '';
    // Parameter ohne Wert sind in der ETS Zwischenüberschriften
    if (type.k === 'none') return `<h5 class="prm-head">${esc(label)}</h5>`;
    // Feste Einwert-Auswahl ohne Schreibrecht ist ein Hinweistext, kein Feld
    if (p.ro && type.k === 'enum' && (type.v || []).length <= 1)
      return `<p class="prm-note">${esc(label)}</p>`;
    const val = KNX.paramValue(item, draft, ref);
    const dis = p.ro ? ' disabled' : '';
    if (type.k === 'enum') {
      const opts = (type.v || []).map(([v, t]) =>
        `<option value="${esc(v)}"${String(v) === val ? ' selected' : ''}>${esc(t || v)}</option>`).join('');
      return `<label class="prm"><span>${esc(label)}</span>
        <select class="select prm-in" data-ref="${ref}"${dis}>${opts}</select></label>`;
    }
    if (type.k === 'num') {
      return `<label class="prm"><span>${esc(label)} <em>${type.min}–${type.max}</em></span>
        <input class="input mono prm-in" type="number" data-ref="${ref}"
               min="${type.min}" max="${type.max}" value="${esc(val)}"${dis}></label>`;
    }
    if (type.k === 'ip') {
      return `<label class="prm"><span>${esc(label)} <em>IPv4</em></span>
        <input class="input mono prm-in" type="text" data-ref="${ref}" value="${esc(val)}"
               inputmode="decimal" placeholder="192.168.1.10"
               pattern="^((25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(25[0-5]|2[0-4]\\d|1?\\d?\\d)$"${dis}></label>`;
    }
    if (type.k === 'time' || type.k === 'date') {
      return `<label class="prm"><span>${esc(label)}</span>
        <input class="input mono prm-in" type="${type.k}" data-ref="${ref}" value="${esc(val)}"${dis}></label>`;
    }
    return `<label class="prm"><span>${esc(label)}</span>
      <input class="input prm-in" type="text" data-ref="${ref}" value="${esc(val)}"
             maxlength="${type.max || 80}"${dis}></label>`;
  };

  const editable = ref => {
    const p = item.params[ref];
    if (!p || !String(p.t || '').trim()) return false;
    const t = item.types[p.pt] || {};
    if (t.k === 'none') return false;
    return !(p.ro && t.k === 'enum' && (t.v || []).length <= 1);
  };

  const body = () => {
    const r = item ? KNX.resolveProduct(item, draft) : { groups: [], objs: [] };
    const n = r.groups.reduce((s, g) => s + g.params.filter(editable).length, 0);
    const ipGroup = hasIp ? `
      <section class="prm-group" data-name="ip netzwerk adresse ${esc(KNX.IP_FIELDS.map(f => f.label.toLowerCase()).join(' '))}">
        <h4>IP-Konfiguration</h4>
        <p class="prm-note">Diese Angaben stehen nicht in der Produktdatei — die ETS
        führt sie im Eigenschaftsfenster des Geräts.</p>
        ${KNX.IP_FIELDS.map(ipField).join('')}
      </section>` : '';
    return `
      <p class="hint">${esc(item ? item.name : dev.name)}${item && item.appName ? ' · ' + esc(item.appName) : ''} —
        <b>${n}</b> Parameter${r.objs.length
          ? `, <b>${r.objs.length}</b> Kommunikationsobjekte`
          : ' — dieses Gerät arbeitet ohne Kommunikationsobjekte'}.
        Nicht jede Einstellung ist immer sichtbar; die Liste folgt der Auswahl.</p>
      <input class="input" id="m-search" placeholder="Parameter filtern …" value="${esc(lastFilter)}">
      <div class="prm-list" id="m-params">
        ${ipGroup}
        ${r.groups.map(g => `
          <section class="prm-group" data-name="${esc((g.label + ' ' +
              g.params.map(x => item.params[x].t || '').join(' ')).toLowerCase())}">
            <h4>${esc(g.label)}</h4>
            ${g.params.map(field).join('')}
          </section>`).join('')}
        ${!ipGroup && !r.groups.length ? '<p class="hint">Keine einstellbaren Parameter.</p>' : ''}
      </div>`;
  };

  const wire = () => {
    const list = $('#m-params');
    list.querySelectorAll('.prm-in').forEach(el => {
      el.addEventListener('change', () => {
        draft[el.dataset.ref] = el.value;
        focusRef = '[data-ref="' + el.dataset.ref + '"]';
        redraw();
      });
    });
    list.querySelectorAll('.ip-in').forEach(el => {
      el.addEventListener('change', () => {
        ip[el.dataset.key] = el.value;
        // Der Wechsel auf „manuell“ blendet weitere Felder ein
        if (el.dataset.key === 'mode') { focusRef = '[data-key="mode"]'; redraw(); }
      });
    });
    const box = $('#m-search');
    box.addEventListener('input', e => {
      lastFilter = e.target.value.trim().toLowerCase();
      applyFilter();
    });
    applyFilter();
    if (focusRef) {
      const el = list.querySelector(focusRef);
      if (el) { el.focus(); el.scrollIntoView({ block: 'center' }); }
      focusRef = null;
    }
  };
  const applyFilter = () => {
    $('#m-params').querySelectorAll('.prm-group').forEach(g => {
      g.hidden = !!lastFilter && !g.dataset.name.includes(lastFilter);
    });
  };
  const redraw = () => { $('#modal-body').innerHTML = body(); wire(); };

  A.openModal(`Parameter — ${esc(dev.name)}`, body(), () => {
    const bad = $('#m-params').querySelector('.prm-in:invalid, .ip-in:invalid');
    if (bad) {
      const grp = bad.closest('.prm-group');
      if (grp) grp.hidden = false;
      bad.focus();
      bad.scrollIntoView({ block: 'center' });
      A.warn('Ungültiger Wert bei „' +
        bad.closest('.prm').querySelector('span').firstChild.textContent.trim() + '“.');
      return false;
    }
    dev.params = draft;
    if (hasIp) {
      ip.tunnels = Math.max(0, Math.min(8, parseInt(ip.tunnels, 10) || 0));
      dev.ip = ip;
      KNX.ensureTunnelAddrs(dev);
    }
    const res = KNX.applyProduct(dev);
    A.commit();
    if (res && res.orphans.length)
      A.warn(`${res.orphans.length} ${res.orphans.length === 1 ? 'Objekt entfällt' : 'Objekte entfallen'} ` +
             'durch die neue Einstellung, tragen aber noch Gruppenadressen — sie bleiben als überzählig stehen.');
    else A.status(dev.objs.length
      ? `${dev.objs.length} Kommunikationsobjekte`
      : 'Einstellungen übernommen');
  });
  wire();
}

/* ---------- Kommunikationsobjekte ---------- */
function objForm(o) {
  return `
    <div class="addr-grid" style="grid-template-columns:1fr 3fr">
      <label class="field"><span>Nr.</span>
        <input class="input mono" id="m-num" type="number" min="0" max="65535" value="${o.num}">
      </label>
      <label class="field"><span>Name</span>
        <input class="input" id="m-name" maxlength="60" value="${esc(o.name)}" placeholder="z. B. A1 Schalten">
      </label>
    </div>
    <label class="field"><span>Datenpunkttyp</span>
      <select class="select" id="m-dpt">${G.dptOptions(o.dpt)}</select>
    </label>
    <div class="field"><span>Flags</span>${flagBoxes(o.flags)}</div>
    <div id="m-err"></div>`;
}

function actNewObj(devId) {
  const d = KNX.deviceById(devId);
  if (!d) return;
  if (d.catalogId) {
    A.warn('Die Objektliste kommt aus der Produktdatei — sie folgt der Parametrierung. ' +
           'Über „Parameter …“ anpassen.');
    return;
  }
  const draft = { num: d.objs.length ? Math.max(...d.objs.map(o => o.num)) + 1 : 0,
                  name: '', dpt: '1.001',
                  flags: { c: true, r: false, w: true, t: false, u: false } };
  A.openModal(`Neues Objekt — ${esc(d.name)}`, objForm(draft), () => {
    const name = $('#m-name').value.trim();
    if (!name) { showErr('Bitte einen Namen vergeben.'); return false; }
    const o = { id: KNX.uid('o'), num: $('#m-num').valueAsNumber || 0, name,
                dpt: $('#m-dpt').value, flags: readFlags(), gas: [] };
    d.objs.push(o);
    KNX.touch();
    state.sel = { kind: 'obj', id: o.id };
    A.commit();
  });
}

function actEditObj(objId) {
  const e = KNX.objById(objId);
  if (!e) return;
  const { dev: d, obj: o } = e;
  A.openModal(`Objekt bearbeiten — ${esc(d.name)}`, objForm(o), () => {
    const name = $('#m-name').value.trim();
    if (!name) { showErr('Bitte einen Namen vergeben.'); return false; }
    const dpt = $('#m-dpt').value;
    const clash = o.gas.map(x => KNX.gaById(x)).filter(g => g && g.dpt !== dpt);
    if (clash.length && !$('#m-force')) {
      showErr(`Weicht vom DPT der Adresse ${KNX.addrStr(clash[0])} (${clash[0].dpt}) ab. ` +
              'Erneut bestätigen, um es trotzdem zu übernehmen.');
      $('#m-err').insertAdjacentHTML('beforeend', '<input type="hidden" id="m-force">');
      return false;
    }
    Object.assign(o, { num: $('#m-num').valueAsNumber || 0, name, dpt, flags: readFlags() });
    KNX.touch();
    A.commit();
  });
}

function actDeleteObj(objId) {
  const e = KNX.objById(objId);
  if (!e) return;
  const { dev: d, obj: o } = e;
  if (d.catalogId && o.ref && !o.stale) {
    A.warn('Dieses Objekt gehört zur Produktdatei. Über „Parameter …“ abwählen, ' +
           'statt es zu löschen.');
    return;
  }
  A.openModal('Kommunikationsobjekt löschen?', `
    <p>„${esc(o.name)}“ von <b>${esc(d.name)}</b> wird entfernt.</p>
    ${o.gas.length ? `<p class="hint warn">${o.gas.length} Adresszuordnungen gehen verloren.</p>` : ''}
  `, () => {
    d.objs = d.objs.filter(x => x.id !== objId);
    KNX.touch();
    if (state.sel?.kind === 'obj' && state.sel.id === objId) state.sel = { kind: 'dev', id: d.id };
    A.commit();
  });
}

/* Adressen eines Objekts festlegen — die erste ist die sendende. */
function actAssignObj(objId) {
  const e = KNX.objById(objId);
  if (!e) return;
  const { dev: d, obj: o } = e;
  const gs = KNX.project().groups.slice().sort((a, b) => a.raw - b.raw);
  A.openModal(`Adressen — ${esc(o.name)}`, `
    <p class="hint">${esc(d.name)} · ${KNX.paStr(d.addr)} · Objekt-DPT <b>${o.dpt}</b>.
    Die <b>erste</b> markierte Adresse ist die sendende.</p>
    <input class="input" id="m-search" placeholder="Adressen filtern …">
    <div class="chk-list tall" id="m-gas">
      ${gs.map(g => `
        <label class="chk-row" data-name="${esc((g.name + ' ' + KNX.addrStr(g)).toLowerCase())}">
          <input type="checkbox" class="chk" data-ga="${g.id}"${o.gas.includes(g.id) ? ' checked' : ''}>
          <span class="addr">${KNX.addrStr(g)}</span>
          <span class="chk-label">${esc(g.name)}</span>
          <span class="dpt-tag${g.dpt === o.dpt ? '' : ' bad'}">${g.dpt}</span>
        </label>`).join('') || '<p class="hint">Noch keine Gruppenadressen angelegt.</p>'}
    </div>
  `, () => {
    const picked = [...$('#m-gas').querySelectorAll('.chk:checked')].map(c => c.dataset.ga);
    // bestehende Reihenfolge beibehalten, damit die sendende Adresse stabil bleibt
    o.gas = o.gas.filter(x => picked.includes(x)).concat(picked.filter(x => !o.gas.includes(x)));
    KNX.touch();
    A.commit();
  });
  $('#m-search').addEventListener('input', ev => {
    const q = ev.target.value.trim().toLowerCase();
    $('#m-gas').querySelectorAll('.chk-row').forEach(el => {
      el.hidden = !!q && !el.dataset.name.includes(q);
    });
  });
}

/* Sendende Adresse eines Objekts wechseln. */
function actSetSending(objId, gaId) {
  const e = KNX.objById(objId);
  if (!e) return;
  e.obj.gas = [gaId, ...e.obj.gas.filter(x => x !== gaId)];
  if (!e.obj.flags.t) e.obj.flags.t = true;
  KNX.touch();
  A.commit();
}

/* ---------- Bereiche und Linien ---------- */
function actNewArea() {
  const used = new Set(KNX.project().areas.map(a => a.addr));
  let free = 1;
  while (free <= KNX.PA_MAX.area && used.has(free)) free++;
  A.openModal('Neuen Bereich anlegen', `
    <label class="field"><span>Bereichsnummer <em>0–15</em></span>
      <input class="input mono" id="m-addr" type="number" min="0" max="15" value="${Math.min(free, 15)}">
    </label>
    <label class="field"><span>Name</span>
      <input class="input" id="m-name" maxlength="40" placeholder="z. B. Nebengebäude">
    </label>
    <label class="field"><span>Notiz</span>
      <textarea class="input note" id="m-note" rows="3" maxlength="${KNX.NOTE_MAX}"
                placeholder="Freitext zur Dokumentation"></textarea>
    </label>
    <div id="m-err"></div>
  `, () => {
    const addr = $('#m-addr').valueAsNumber;
    const name = $('#m-name').value.trim();
    if (!name) { showErr('Bitte einen Namen vergeben.'); return false; }
    if (!Number.isInteger(addr) || addr < 0 || addr > KNX.PA_MAX.area)
      { showErr('Bereichsnummer muss zwischen 0 und 15 liegen.'); return false; }
    if (used.has(addr)) { showErr(`Bereich ${addr} ist bereits vergeben.`); return false; }
    const a = { id: KNX.uid('a'), addr, name, note: $('#m-note').value.trim(),
                lines: [ { id: KNX.uid('l'), addr: 1, name: 'Hauptlinie', medium: 'tp', note: '' } ] };
    KNX.project().areas.push(a);
    KNX.touch();
    state.sel = { kind: 'area', id: a.id };
    A.commit();
  });
}

function actEditArea(id) {
  const a = KNX.project().areas.find(x => x.id === id);
  if (!a) return;
  A.openModal('Bereich bearbeiten', `
    <label class="field"><span>Bereichsnummer <em>0–15</em></span>
      <input class="input mono" id="m-addr" type="number" min="0" max="15" value="${a.addr}">
    </label>
    <label class="field"><span>Name</span>
      <input class="input" id="m-name" maxlength="40" value="${esc(a.name)}">
    </label>
    <label class="field"><span>Notiz</span>
      <textarea class="input note" id="m-note" rows="3" maxlength="${KNX.NOTE_MAX}"
                placeholder="Freitext zur Dokumentation">${esc(a.note || '')}</textarea>
    </label>
    <p class="hint">Beim Ändern der Nummer werden die physikalischen Adressen aller
    Geräte dieses Bereichs mitgezogen.</p>
    <div id="m-err"></div>
  `, () => {
    const addr = $('#m-addr').valueAsNumber;
    const name = $('#m-name').value.trim();
    if (!name) { showErr('Bitte einen Namen vergeben.'); return false; }
    if (!Number.isInteger(addr) || addr < 0 || addr > KNX.PA_MAX.area)
      { showErr('Bereichsnummer muss zwischen 0 und 15 liegen.'); return false; }
    if (KNX.project().areas.some(x => x.id !== id && x.addr === addr))
      { showErr(`Bereich ${addr} ist bereits vergeben.`); return false; }
    if (addr !== a.addr) {
      const ids = new Set(a.lines.map(l => l.id));
      KNX.project().devices.forEach(d => {
        if (!ids.has(d.lineId)) return;
        if (!KNX.hasPa(d)) return;
        const [, l, n] = KNX.paSplit(d.addr);
        d.addr = KNX.paJoin(addr, l, n);
      });
    }
    a.addr = addr;
    a.name = name;
    a.note = $('#m-note').value.trim();
    KNX.touch();
    A.commit();
  });
}

function actDeleteArea(id) {
  const a = KNX.project().areas.find(x => x.id === id);
  if (!a) return;
  if (KNX.project().areas.length < 2) { A.warn('Der letzte Bereich kann nicht gelöscht werden.'); return; }
  const n = a.lines.reduce((s, l) => s + KNX.devicesOnLine(l.id).length, 0);
  A.openModal(`Bereich „${esc(a.name)}“ löschen?`, `
    <p>Der Bereich mit ${a.lines.length} Linien wird entfernt.</p>
    ${n ? `<p class="hint warn">${n} Geräte werden auf die erste verbleibende Linie verschoben —
           ihre physikalischen Adressen passen dann nicht mehr und werden als Fehler markiert.</p>` : ''}
  `, () => {
    KNX.deleteArea(id);
    if (state.sel?.kind === 'area' && state.sel.id === id) state.sel = null;
    A.commit();
  });
}

function actNewLine(areaId) {
  const a = KNX.project().areas.find(x => x.id === areaId);
  if (!a) return;
  const used = new Set(a.lines.map(l => l.addr));
  let free = 1;
  while (free <= KNX.PA_MAX.line && used.has(free)) free++;
  A.openModal(`Neue Linie in „${esc(a.name)}“`, `
    <label class="field"><span>Liniennummer <em>0–15</em></span>
      <input class="input mono" id="m-addr" type="number" min="0" max="15" value="${Math.min(free, 15)}">
    </label>
    <label class="field"><span>Name</span>
      <input class="input" id="m-name" maxlength="40" placeholder="z. B. Linie Keller">
    </label>
    <label class="field"><span>Medium</span>
      <select class="select" id="m-medium">${Object.entries(KNX.MEDIA).map(([k, v]) =>
        `<option value="${k}">${esc(v)}</option>`).join('')}</select>
    </label>
    <label class="field"><span>Notiz</span>
      <textarea class="input note" id="m-note" rows="3" maxlength="${KNX.NOTE_MAX}"
                placeholder="Freitext zur Dokumentation"></textarea>
    </label>
    <div id="m-err"></div>
  `, () => {
    const addr = $('#m-addr').valueAsNumber;
    const name = $('#m-name').value.trim();
    if (!name) { showErr('Bitte einen Namen vergeben.'); return false; }
    if (!Number.isInteger(addr) || addr < 0 || addr > KNX.PA_MAX.line)
      { showErr('Liniennummer muss zwischen 0 und 15 liegen.'); return false; }
    if (used.has(addr)) { showErr(`Linie ${a.addr}.${addr} ist bereits vergeben.`); return false; }
    const l = { id: KNX.uid('l'), addr, name, medium: $('#m-medium').value,
                note: $('#m-note').value.trim() };
    a.lines.push(l);
    KNX.touch();
    state.sel = { kind: 'line', id: l.id };
    A.commit();
  });
}

function actEditLine(id) {
  const l = KNX.lineById(id), a = KNX.areaOfLine(id);
  if (!l || !a) return;
  A.openModal('Linie bearbeiten', `
    <label class="field"><span>Liniennummer <em>0–15</em></span>
      <input class="input mono" id="m-addr" type="number" min="0" max="15" value="${l.addr}">
    </label>
    <label class="field"><span>Name</span>
      <input class="input" id="m-name" maxlength="40" value="${esc(l.name)}">
    </label>
    <label class="field"><span>Medium</span>
      <select class="select" id="m-medium">${Object.entries(KNX.MEDIA).map(([k, v]) =>
        `<option value="${k}"${k === l.medium ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select>
    </label>
    <label class="field"><span>Notiz</span>
      <textarea class="input note" id="m-note" rows="3" maxlength="${KNX.NOTE_MAX}"
                placeholder="Freitext zur Dokumentation">${esc(l.note || '')}</textarea>
    </label>
    <p class="hint">Beim Ändern der Nummer werden die Adressen der Geräte auf dieser
    Linie mitgezogen.</p>
    <div id="m-err"></div>
  `, () => {
    const addr = $('#m-addr').valueAsNumber;
    const name = $('#m-name').value.trim();
    if (!name) { showErr('Bitte einen Namen vergeben.'); return false; }
    if (!Number.isInteger(addr) || addr < 0 || addr > KNX.PA_MAX.line)
      { showErr('Liniennummer muss zwischen 0 und 15 liegen.'); return false; }
    if (a.lines.some(x => x.id !== id && x.addr === addr))
      { showErr(`Linie ${a.addr}.${addr} ist bereits vergeben.`); return false; }
    if (addr !== l.addr) {
      KNX.devicesOnLine(id).filter(KNX.hasPa).forEach(d => {
        const [, , n] = KNX.paSplit(d.addr);
        d.addr = KNX.paJoin(a.addr, addr, n);
      });
    }
    l.addr = addr;
    l.name = name;
    l.medium = $('#m-medium').value;
    l.note = $('#m-note').value.trim();
    KNX.touch();
    A.commit();
  });
}

function actDeleteLine(id) {
  const l = KNX.lineById(id), a = KNX.areaOfLine(id);
  if (!l || !a) return;
  const n = KNX.devicesOnLine(id).length;
  A.openModal(`Linie ${a.addr}.${l.addr} „${esc(l.name)}“ löschen?`, `
    ${n ? `<p class="hint warn">${n} Geräte werden auf eine andere Linie verschoben —
           ihre physikalischen Adressen passen dann nicht mehr und werden als Fehler markiert.</p>`
        : '<p>Auf dieser Linie sind keine Geräte.</p>'}
  `, () => {
    if (!KNX.deleteLine(id)) { A.warn('Die letzte Linie kann nicht gelöscht werden.'); return; }
    if (state.sel?.kind === 'line' && state.sel.id === id) state.sel = null;
    if (state.filter?.kind === 'line' && state.filter.id === id) state.filter = null;
    A.commit();
  });
}

/* ---------- Haupt-/Mittelgruppen benennen ---------- */
function actRenameGaGroup(key) {
  const p = KNX.project();
  const style = KNX.gaStyle();
  const level = String(key).split('/').length - 1;
  const label = style.parts[level]?.label || 'Gruppe';
  A.openModal(`${label} ${key} benennen`, `
    <label class="field"><span>Name</span>
      <input class="input" id="m-name" maxlength="40" value="${esc(p.gaNames[key] || '')}"
             placeholder="z. B. Beleuchtung">
    </label>
    <p class="hint">Leer lassen entfernt den Namen. Die Adressen bleiben unverändert.</p>
  `, () => {
    const name = $('#m-name').value.trim();
    if (name) p.gaNames[key] = name; else delete p.gaNames[key];
    A.commit();
  });
}

window.KNXTopo = {
  actNewDevice, actEditDevice, actDeleteDevice, actParams,
  actNewObj, actEditObj, actDeleteObj, actAssignObj, actSetSending,
  actNewArea, actEditArea, actDeleteArea,
  actNewLine, actEditLine, actDeleteLine,
  actRenameGaGroup, actCatalog
};
})();
