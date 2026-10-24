/* ============================================================
   KNX-Struktur — Topologie, Geräte, Kommunikationsobjekte
   ============================================================ */
'use strict';

(() => {
const A = window.KNXApp, G = window.KNXGA, $ = s => document.querySelector(s);
const state = A.state, esc = A.esc, T18 = A.t;

const showErr = msg => { $('#m-err').innerHTML = msg ? `<span class="hint warn">${esc(msg)}</span>` : ''; };

function lineOptions(sel) {
  return KNX.project().areas.map(a =>
    `<optgroup label="${esc(a.addr + '  ' + a.name)}">` + a.lines.map(l =>
      `<option value="${l.id}"${l.id === sel ? ' selected' : ''}>` +
      `${a.addr}.${l.addr} — ${esc(l.name)}</option>`).join('') + '</optgroup>').join('');
}
/* Leer, solange die Linie nicht geteilt ist — dann gibt es nur Segment 0. */
function segmentOptions(lineId, sel) {
  const line = KNX.lineById(lineId);
  if (!line || !KNX.segmentsOf(line).length) return '';
  return KNX.segmentKeys(line).map(key => {
    const s = KNX.segmentInfo(key);
    const on = s.seg ? key === sel : !sel;
    return `<option value="${esc(key)}"${on ? ' selected' : ''}>S${s.num} — ${esc(s.seg ? s.name : 'Segment 0')} · ${esc(T18(KNX.MEDIA[s.medium]))}</option>`;
  }).join('');
}
function syncSegments(lineId, sel) {
  const html = segmentOptions(lineId, sel);
  $('#m-seg').innerHTML = html;
  $('#m-seg-row').hidden = !html;
}
const readSegment = lineId => {
  const v = $('#m-seg') && !$('#m-seg-row').hidden ? $('#m-seg').value : '';
  return v && v !== lineId ? v : null;
};

function roomOptions(sel) {
  return `<option value="">${T18('— kein Raum —')}</option>` + KNX.rooms().map(r =>
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
    <label class="flag-box" title="${esc(A.t(f.desc))}">
      <input type="checkbox" id="m-f-${f.key}"${flags[f.key] ? ' checked' : ''}>
      <b>${esc(A.t(f.short))}</b><span>${esc(A.t(f.de))}</span>
    </label>`).join('') + '</div>';
}
const readFlags = () => {
  const out = {};
  KNX.KO_FLAGS.forEach(f => { out[f.key] = $('#m-f-' + f.key).checked; });
  return out;
};

/* ---------- Geräte ---------- */
const objCount = c => Object.keys(c.objs || {}).length;

/* Die Applikationsversion gehört zum Produkt: Fassungen mit derselben
   Bestellnummer stehen nebeneinander im Katalog. */
const appVersionOf = c => c && c.prog && c.prog.appNumber ? T18('Version {0}', c.prog.appVersion) : '';

function catalogOptions(sel) {
  const items = KNX.project().catalog;
  return `<option value="">${T18('— frei definiert —')}</option>` + items.map(c =>
    `<option value="${c.id}"${c.id === sel ? ' selected' : ''}>` +
    esc([A.L(c.name), c.order, appVersionOf(c)].filter(Boolean).join(' · ')) + '</option>').join('');
}

function deviceForm(d, opt) {
  const noAddr = d.addr === null;
  const [, , dev] = noAddr ? [0, 0, KNX.paSplit(KNX.freePa(d.lineId, opt && opt.exceptId))[2]] : KNX.paSplit(d.addr);
  // Beim Anlegen mit Katalogdialog, beim Bearbeiten als Produktwechsel
  const cat = opt && (opt.catalog || opt.change);
  const except = opt && opt.exceptId;
  return `
    ${cat ? `
    <div class="field"><span>${T18('Produkt')}</span>
      <div class="pick-row">
        <select class="select" id="m-cat">${catalogOptions(d.catalogId)}</select>
        ${opt.catalog ? `<button type="button" class="btn btn-sm" id="m-cat-open">${T18('Katalog …')}</button>` : ''}
      </div>
      <p class="hint" id="m-cat-hint"></p>
    </div>` : ''}
    <label class="field"><span>${T18('Name')}</span>
      <input class="input" id="m-name" maxlength="60" value="${esc(d.name)}" placeholder="${T18('z. B. Schaltaktor 8-fach')}">
    </label>
    <label class="field"><span>${T18('Produkt / Bauform')}</span>
      <input class="input" id="m-product" maxlength="60" value="${esc(d.product)}" placeholder="${T18('z. B. REG, 16 A')}">
    </label>
    <label class="field"><span>${T18('Linie')}</span>
      <select class="select" id="m-line">${lineOptions(d.lineId)}</select>
    </label>
    <label class="field" id="m-seg-row"${segmentOptions(d.lineId, d.segmentId) ? '' : ' hidden'}><span>${T18('Segment')}</span>
      <select class="select" id="m-seg">${segmentOptions(d.lineId, d.segmentId)}</select>
    </label>
    <label class="field"><span>${T18('Physikalische Adresse')} <em>${T18('nur freie')}</em></span>
      <select class="select mono" id="m-dev"${noAddr ? ' disabled' : ''}>${deviceOptions(d.lineId, dev, except)}</select>
    </label>
    <label class="chk" title="${T18('Drosseln, Netzteile und passives Zubehör: nur der Linie zugeordnet, belegen keine Adresse')}">
      <input type="checkbox" id="m-noaddr"${noAddr ? ' checked' : ''}> ${T18('Ohne physikalische Adresse')}</label>
    <label class="field"><span>${T18('Verbaut in')}</span>
      <select class="select" id="m-room">${roomOptions(d.roomId)}</select>
    </label>
    <div class="addr-grid" style="grid-template-columns:1fr 1fr">
      <label class="field"><span>${T18('Busstrom')} <em>mA</em></span>
        <input class="input mono" id="m-ma" type="number" min="0" max="5000"
               value="${d.ma == null ? '' : d.ma}" placeholder="${KNX.deviceMa(d)}">
      </label>
      <label class="field"><span>${T18('Einspeisung')} <em>${T18('mA, 0 = keine')}</em></span>
        <input class="input mono" id="m-supply" type="number" min="0" max="5000" value="${+d.supply || 0}">
      </label>
    </div>
    <label class="field"><span>${T18('Seriennummer')} <em>${T18('6 Byte hex, optional')}</em></span>
      <input class="input mono" id="m-serial" maxlength="20" value="${esc(d.serial || '')}"
             placeholder="${T18('wird beim Auslesen am Bus eingetragen')}">
    </label>
    <label class="field"><span>${T18('Notiz')}</span>
      <textarea class="input note" id="m-note" rows="3" maxlength="${KNX.NOTE_MAX}"
                placeholder="${T18('z. B. Einbauort im Verteiler, Besonderheiten, Reklamation')}">${esc(d.note || '')}</textarea>
    </label>
    <div id="m-err"></div>`;
}
function readDevice(exceptId) {
  const name = $('#m-name').value.trim();
  if (!name) return { err: T18('Bitte einen Namen vergeben.') };
  const lineId = $('#m-line').value;
  const line = KNX.lineById(lineId), area = KNX.areaOfLine(lineId);
  let addr = null;
  if (!$('#m-noaddr').checked) {
    const n = parseInt($('#m-dev').value, 10);
    if (!Number.isInteger(n)) return { err: T18('Auf dieser Linie ist keine Adresse mehr frei.') };
    addr = KNX.paJoin(area.addr, line.addr, n);
    if (!KNX.paFree(addr, exceptId))
      return { err: `Physikalische Adresse ${KNX.paStr(addr)} ist bereits vergeben.` };
  }
  const ma = $('#m-ma').value.trim();
  const serialRaw = $('#m-serial').value.trim();
  const serial = KNX.normSerial(serialRaw);
  if (serialRaw && !serial)
    return { err: T18('Die Seriennummer besteht aus 6 Byte, also 12 Hex-Zeichen (z. B. 00FA12345678).') };
  return { name, product: $('#m-product').value.trim(), lineId, addr, segmentId: readSegment(lineId),
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
    segmentId: lineId ? readSegment(lineId) : null,
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
  const lineId = ctx?.lineId || (state.filter?.kind === 'line' ? state.filter.id : KNX.regularAreas()[0].lines[0]?.id);
  const roomId = ctx?.roomId
    || (state.sel?.kind === 'node' && KNX.DEVICE_HOSTS.has(KNX.findNode(state.sel.id)?.kind || '')
        ? state.sel.id : null);
  const draft = ctx?.draft || { name: '', product: '', lineId, segmentId: ctx?.segmentId || null,
                                addr: KNX.freePa(lineId), roomId,
                                ma: null, supply: 0, serial: '', note: '' };
  if (ctx?.catalogId) draft.catalogId = ctx.catalogId;
  if (!draft.addr && draft.addr !== null) draft.addr = KNX.freePa(draft.lineId || lineId);

  A.openModal(T18('Neues Gerät anlegen'), deviceForm(draft, { catalog: true }), () => {
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
    if (cat) A.status(A.t('{0} Kommunikationsobjekte aus „{1}“ übernommen', d.objs.length, A.L(cat.name)));
  });

  // Linienwechsel bietet die freien Nummern der neuen Linie an
  $('#m-line').addEventListener('change', e => {
    const next = KNX.paSplit(KNX.freePa(e.target.value))[2];
    $('#m-dev').innerHTML = deviceOptions(e.target.value, next);
    syncSegments(e.target.value, null);
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
      hint.textContent = T18('Ohne Produkt entsteht ein leeres Gerät — Objekte legt man später einzeln an.');
      return;
    }
    if (c.hwOnly) {
      // Die Produktdatei nennt nur, was das Gerät selbst dem Bus entnimmt — die
      // Einspeisung einer Drossel hängt vom angeschlossenen Netzteil ab.
      hint.innerHTML = T18('Ohne Applikation') + (c.manufacturer ? ` · ${esc(c.manufacturer)}` : '') +
        (c.choke || c.powerSupply
          ? '. ' + (c.choke
              ? T18('Die Einspeisung steht nicht in der Produktdatei — bitte unten den Nennstrom des angeschlossenen Netzteils eintragen.')
              : T18('Die Einspeisung steht nicht in der Produktdatei — bitte unten den Nennstrom des Netzteils eintragen.'))
          : '.') +
        (c.noAddress ? ' ' + T18('Das Gerät hat keine physikalische Adresse und hängt nur an seiner Linie.') : '');
      if (!$('#m-name').value.trim()) $('#m-name').value = A.L(c.name).slice(0, 60);
      if (!$('#m-product').value.trim()) $('#m-product').value = (c.order || A.L(c.name)).slice(0, 60);
      if (c.ma) $('#m-ma').placeholder = String(c.ma);
      return;
    }
    const r = KNX.resolveProduct(c, {});
    const nParams = r.groups.reduce((s, g) => s + g.params.filter(ref => {
      const p = c.params[ref];
      return p && String(p.t || '').trim() && (c.types[p.pt] || {}).k !== 'none';
    }).length, 0);
    hint.innerHTML = (r.objs.length
        ? T18('<b>{0}</b> Kommunikationsobjekte und <b>{1}</b> Parameter in der Grundeinstellung', r.objs.length, nParams)
        : T18('<b>{0}</b> Parameter, keine Kommunikationsobjekte in der Grundeinstellung', nParams)) +
      (c.manufacturer ? ` · ${esc(c.manufacturer)}` : '') +
      (c.appName ? ` · ${esc(A.L(c.appName))}` : '');
    if (!$('#m-name').value.trim()) $('#m-name').value = A.L(c.name).slice(0, 60);
    if (!$('#m-product').value.trim()) $('#m-product').value = (c.order || A.L(c.name)).slice(0, 60);
    // Busstrom aus der Produktdatei als Vorbelegung anbieten
    if (c.ma) $('#m-ma').placeholder = String(c.ma);
  };
  $('#m-cat').addEventListener('change', applyCat);
  wireNoAddr();
  $('#m-cat-open').addEventListener('click', () => {
    const draftNow = readDraft();
    A.closeModal();
    actCatalog((id, t) => {
      const draft = { ...draftNow };
      if (t) {
        // Auf einer anderen Linie gilt die alte Adresse nicht mehr
        if (t.lineId && t.lineId !== draft.lineId && draft.addr !== null) draft.addr = KNX.freePa(t.lineId);
        Object.assign(draft, { lineId: t.lineId || draft.lineId, segmentId: t.segmentId, roomId: t.roomId });
      }
      actNewDevice({ ...ctx, draft, catalogId: id || draftNow.catalogId });
    },
               { lineId: draftNow.lineId, segmentId: draftNow.segmentId, roomId: draftNow.roomId });
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
  A.openModal(T18('Gerät bearbeiten — {0}', KNX.paStr(d.addr)), deviceForm(d, { exceptId: id, change: true }), () => {
    const r = readDevice(id);
    if (r.err) { showErr(r.err); return false; }
    const before = d.catalogId || '', next = $('#m-cat').value || '';
    Object.assign(d, r);
    followTunnels([d]);
    let msg = '';
    if (next !== before) {
      const c = next && KNX.catalogById(next);
      if (c) {
        const res = KNX.changeProduct(d, next);
        msg = res && res.orphans.length
          ? A.t('Produkt gewechselt auf „{0}“ — {1} verknüpfte Objekte gibt es dort nicht mehr; sie bleiben als überzählig stehen.',
                A.L(c.name), res.orphans.length)
          : A.t('Produkt gewechselt auf „{0}“', A.L(c.name));
      } else {
        // Ohne Produkt bleiben die Objekte und lassen sich frei bearbeiten
        d.catalogId = null;
        d.params = {};
        delete d.proxy;
        msg = A.t('Produkt entfernt — die Objekte bleiben und lassen sich frei bearbeiten.');
      }
    }
    KNX.touch();
    A.commit();
    if (msg) A.status(msg);
  });
  wireNoAddr();
  const item = d.catalogId && KNX.catalogById(d.catalogId);
  if (item && item.noAddress) $('#m-noaddr').disabled = true;
  // Was ein Produktwechsel mit sich bringt
  const changeHint = () => {
    const c = KNX.catalogById($('#m-cat').value);
    const hint = $('#m-cat-hint');
    if (($('#m-cat').value || '') === (d.catalogId || '')) { hint.textContent = ''; return; }
    if (!c) {
      hint.textContent = T18('Ohne Produkt bleiben die Objekte stehen, Parameter und Programmierdaten entfallen.');
      return;
    }
    const was = item ? [A.L(item.name), appVersionOf(item)].filter(Boolean).join(' · ') : T18('frei definiert');
    hint.textContent = T18('Wechsel von {0}. Parameter und Verknüpfungen gehen mit, soweit das neue Produkt sie kennt; danach ist ein vollständiger Download fällig.', was);
  };
  $('#m-cat').addEventListener('change', changeHint);
  $('#m-line').addEventListener('change', e => {
    syncSegments(e.target.value, e.target.value === d.lineId ? d.segmentId : null);
    const keep = d.addr === null ? 1 : KNX.paSplit(d.addr)[2];
    const free = KNX.paSplit(KNX.freePa(e.target.value, id))[2];
    $('#m-dev').innerHTML = deviceOptions(e.target.value,
      KNX.paFree(KNX.paJoin(KNX.areaOfLine(e.target.value).addr,
        KNX.lineById(e.target.value).addr, keep), id) ? keep : free, id);
  });
}

/* Tunneladressen ziehen mit, wenn das Gerät die Linie wechselt oder Bereich
   und Linie neue Nummern bekommen. */
const followTunnels = devs => devs.forEach(d => {
  if (KNX.deviceCanIp(d) && KNX.tunnelAddrs(d).length) KNX.ensureTunnelAddrs(d);
});

/* Gerät per Ziehen auf eine andere Linie oder in ein anderes Segment. Die Teilnehmernummer
   bleibt, wenn sie auf der neuen Linie frei ist — sonst die nächste freie, wie im Dialog. */
function moveDevice(id, lineId, segmentId) {
  const d = KNX.deviceById(id), line = KNX.lineById(lineId), area = KNX.areaOfLine(lineId);
  if (!d || !line || !area) return;
  const to = KNX.segmentInfo(segmentId || lineId);
  const media = KNX.deviceMedia(d);
  if (!to || !media.has(to.medium)) {
    A.warn(T18('Das Medium passt nicht: Ziel {0}, Gerät {1}.', T18(KNX.MEDIA[to ? to.medium : line.medium] || '?'),
      [...media].map(m => T18(KNX.MEDIA[m])).join(' / ')));
    return;
  }
  const before = d.addr;
  let addr = d.addr;
  if (d.lineId !== lineId && addr !== null) {
    // 0.0.0 ist keine Teilnehmeradresse — ein Koppler auf dem Backbone bekommt die nächste freie
    const keep = KNX.paJoin(area.addr, line.addr, KNX.paSplit(addr)[2]);
    addr = keep !== 0 && KNX.paFree(keep, id) ? keep : KNX.freePa(lineId, id);
    if (!KNX.paFree(addr, id)) { A.warn(T18('Auf dieser Linie ist keine Adresse mehr frei.')); return; }
  }
  d.lineId = lineId;
  d.segmentId = segmentId && segmentId !== lineId ? segmentId : null;
  d.addr = addr;
  followTunnels([d]);
  KNX.touch();
  state.collapsed.delete(segmentId && segmentId !== lineId ? 'seg:' + segmentId : lineId);
  A.commit();
  A.status(addr === before
    ? T18('„{0}“ verschoben', d.name)
    : T18('„{0}“ verschoben: {1} → {2}', d.name, KNX.paStr(before), KNX.paStr(addr)));
}

/* ---------- Kopieren ---------- *
 * Noch einmal dasselbe Gerät — gleiches Produkt, gleiche Parameter — mit der
 * nächsten freien Adresse. Ohne Häkchen ohne Verknüpfungen: Sonst schalteten
 * Original und Kopie dieselben Gruppenadressen.                             */

const COPY_MAX = 20;

/* Name der n-ten Kopie: Endet der Name auf eine Zahl, wird weitergezählt
   („Taster 2“ → „Taster 3“), sonst angehängt („Aktor“ → „Aktor 2“). */
function copyName(base, n) {
  const m = /^(.*?)(\d+)$/.exec(base);
  return m ? m[1] + (+m[2] + n) : n ? base + ' ' + (n + 1) : base;
}
const firstCopyName = name => (/\d$/.test(name) ? copyName(name, 1) : name + ' 2');

function actCopyDevice(id) {
  const d = KNX.deviceById(id);
  if (!d) return;
  const links = d.objs.reduce((s, o) => s + o.gas.length, 0);
  const manualIp = !!(d.ip && d.ip.mode === 'manual');
  A.openModal(T18('Gerät kopieren — {0}', d.name), `
    <p class="hint">${T18('Die Kopie bekommt dasselbe Produkt mit denselben Parametern und Objekten samt Flags — und die nächste freie physikalische Adresse ihrer Linie. Seriennummer, Notiz und Programmierstand bleiben beim Original.')}</p>
    <label class="field"><span>${T18('Name')}</span>
      <input class="input" id="m-name" maxlength="60" value="${esc(firstCopyName(d.name))}">
    </label>
    <div class="addr-grid" style="grid-template-columns:1fr 3fr">
      <label class="field"><span>${T18('Anzahl')}</span>
        <input class="input mono" id="m-count" type="number" min="1" max="${COPY_MAX}" value="1">
      </label>
      <label class="field"><span>${T18('Linie')}</span>
        <select class="select" id="m-line">${lineOptions(d.lineId)}</select>
      </label>
    </div>
    <label class="field"><span>${T18('Verbaut in')}</span>
      <select class="select" id="m-room">${roomOptions(d.roomId)}</select>
    </label>
    ${links ? `<label class="chk"><input type="checkbox" id="m-links"> ${T18('Verknüpfungen und Objektbeschreibungen übernehmen ({0})', links)}</label>
      <p class="hint">${T18('Ohne Häkchen hört die Kopie auf keine Gruppenadresse; mit Häkchen schalten Original und Kopie dieselben.')}</p>` : ''}
    ${d.secure ? `<p class="hint warn">${T18('KNX Secure: Jede Kopie braucht ihr eigenes Gerätezertifikat (FDSK).')}</p>` : ''}
    ${manualIp ? `<p class="hint warn">${T18('Die feste IP-Adresse geht nicht mit — bitte bei der Kopie eine eigene eintragen.')}</p>` : ''}
    <p class="hint" id="m-names"></p>
    <div id="m-err"></div>
  `, () => {
    const name = $('#m-name').value.trim();
    const n = $('#m-count').valueAsNumber;
    const lineId = $('#m-line').value;
    if (!name) { showErr(T18('Bitte einen Namen vergeben.')); return false; }
    if (!Number.isInteger(n) || n < 1 || n > COPY_MAX) { showErr(T18('Anzahl 1 bis {0}.', COPY_MAX)); return false; }
    const to = KNX.segmentInfo(lineId === d.lineId && d.segmentId ? d.segmentId : lineId);
    const media = KNX.deviceMedia(d);
    if (!to || !media.has(to.medium)) {
      showErr(T18('Das Medium passt nicht: Ziel {0}, Gerät {1}.', T18(KNX.MEDIA[to ? to.medium : '?'] || '?'),
        [...media].map(m => T18(KNX.MEDIA[m])).join(' / ')));
      return false;
    }
    const made = [];
    for (let i = 0; i < n; i++) {
      const c = KNX.copyDevice(id, { name: copyName(name, i), lineId, roomId: $('#m-room').value || null,
                                     links: !!($('#m-links') && $('#m-links').checked) });
      if (!c) break;
      made.push(c);
    }
    if (made.length < n) {
      // Nichts halb anlegen: was schon da ist, wieder entfernen
      made.forEach(c => KNX.deleteDevice(c.id));
      showErr(T18('Auf dieser Linie sind nur noch {0} Adressen frei.', made.length));
      return false;
    }
    state.sel = { kind: 'dev', id: made[0].id };
    A.commit();
    A.status(n === 1
      ? T18('„{0}“ angelegt: {1}', made[0].name, KNX.paStr(made[0].addr))
      : T18('{0} Kopien angelegt: {1}', n, made.map(c => KNX.paStr(c.addr)).join(', ')));
  });
  const preview = () => {
    const n = Math.max(1, Math.min(COPY_MAX, $('#m-count').valueAsNumber || 1));
    const name = $('#m-name').value.trim();
    $('#m-names').textContent = n > 1 && name
      ? T18('Namen: {0} bis {1}', copyName(name, 0), copyName(name, n - 1)) : '';
  };
  $('#m-count').addEventListener('input', preview);
  $('#m-name').addEventListener('input', preview);
  $('#m-name').focus();
  $('#m-name').select();
}

function actDeleteDevice(id) {
  const d = KNX.deviceById(id);
  if (!d) return;
  const n = d.objs.reduce((s, o) => s + o.gas.length, 0);
  A.openModal(T18('Gerät „{0}“ löschen?', esc(d.name)), `
    <p>${T18('<b>{0}</b> wird mit allen {1} Kommunikationsobjekten entfernt.', KNX.paStr(d.addr), d.objs.length)}</p>
    ${n ? `<p class="hint warn">${T18('{0} Adresszuordnungen gehen verloren. Die Gruppenadressen selbst bleiben erhalten.', n)}</p>` : ''}
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
      A.warn(T18('Produktdatei nicht lesbar: {0}', e && e.message ? e.message : e));
    }
  };
  input.click();
}

/* Mehrere Geräte auf einmal aus dem Katalog: je Produkt die gewünschte
   Stückzahl, fortlaufend auf die freien Adressen der Ziellinie. Prüft erst
   alles und legt dann in einem Schritt an — ein Rückgängig nimmt alle zurück.
   → Fehlertext oder null */
function addFromCatalog(picks, tgt) {
  const line = KNX.lineById(tgt.lineId), area = KNX.areaOfLine(tgt.lineId);
  if (!line || !area) return T18('Bitte eine Linie wählen.');
  const items = picks.map(p => ({ c: KNX.catalogById(p.id), n: p.qty })).filter(x => x.c && x.n > 0);
  if (!items.length) return T18('Mindestens ein Produkt auswählen.');
  const need = items.reduce((s, x) => s + (x.c.noAddress ? 0 : x.n), 0);
  const free = [];
  for (let n = 1; n <= KNX.PA_MAX.device && free.length < need; n++) {
    const raw = KNX.paJoin(area.addr, line.addr, n);
    if (KNX.paFree(raw)) free.push(raw);
  }
  if (free.length < need)
    return T18('Auf Linie {0}.{1} sind nur noch {2} Adressen frei, gebraucht werden {3}.', area.addr, line.addr, free.length, need);
  const room = tgt.roomId && KNX.findNode(tgt.roomId) ? tgt.roomId : null;
  const made = [];
  items.forEach(({ c, n }) => {
    for (let k = 0; k < n; k++) {
      const d = KNX.addDevice({
        id: KNX.uid('d'), name: A.L(c.name).slice(0, 60), product: (c.order || A.L(c.name)).slice(0, 60),
        lineId: line.id, segmentId: tgt.segmentId || null, addr: c.noAddress ? null : free.shift(),
        roomId: room, ma: null, supply: 0, serial: '', note: '',
        catalogId: c.id, params: {}, objs: []
      });
      KNX.applyProduct(d);
      made.push(d);
    }
  });
  state.sel = { kind: 'dev', id: made[0].id };
  state.collapsed.delete(tgt.segmentId ? 'seg:' + tgt.segmentId : line.id);
  A.commit();
  const pas = made.filter(d => d.addr !== null).map(d => KNX.paStr(d.addr));
  A.status((made.length === 1 ? T18('1 Gerät angelegt') : T18('{0} Geräte angelegt', made.length))
    + (pas.length ? ' · ' + (pas.length > 1 ? pas[0] + ' … ' + pas[pas.length - 1] : pas[0]) : ''));
  return null;
}

/* Katalogverwaltung; `onPick` bekommt die Id des gewählten Produkts. Mit
   `target` (Linie, Segment, Raum aus dem Geräteformular) lassen sich mehrere
   Produkte samt Stückzahl ankreuzen und direkt als Geräte anlegen. Ein
   einzelnes Produkt mit Stückzahl 1 geht wie bisher zurück ins Formular. */
function actCatalog(onPick, target) {
  const bulk = !!target;
  const picks = new Map();                 // Produkt-Id → Stückzahl
  const tgt = { lineId: null, segmentId: null, roomId: null, ...(target || {}) };
  if (bulk && !KNX.lineById(tgt.lineId)) tgt.lineId = (KNX.regularAreas()[0].lines[0] || {}).id || null;
  const QTY_MAX = 99;

  const MN = window.KNXManuals && window.KNXManuals.available ? window.KNXManuals : null;
  const render = () => {
    const items = KNX.project().catalog;
    return `
      <p class="hint">${bulk
        ? T18('Produkte ankreuzen und die Stückzahl eintragen — sie entstehen direkt als Geräte auf der Ziellinie. Ein einzelnes Gerät geht zurück ins Formular.')
        : T18('Produkte aus ETS-Produktdateien (<b>.knxprod</b>). Ein gewähltes Produkt legt beim Anlegen eines Geräts alle Kommunikationsobjekte mit an.')}</p>
      <div class="pick-row">
        <button type="button" class="btn btn-sm btn-primary" id="m-load">${T18('Produktdatei laden …')}</button>
        <button type="button" class="btn btn-sm" id="m-online"
                title="${T18('Produktdaten aus dem offenen KNX-Onlinekatalog holen')}">${T18('Onlinekatalog …')}</button>
        ${MN ? `<button type="button" class="btn btn-sm" id="m-manuals"
                title="${T18('PDF-Handbücher, die die KI im Chat lesen darf')}">${T18('Handbücher …')}</button>` : ''}
      </div>
      <div class="pick-row">
        <input class="input" id="m-search" placeholder="${T18('Katalog durchsuchen …')}">
      </div>
      <div class="chk-list tall" id="m-cat-list">
        ${items.length ? items.map(c => `
          <div class="cat-row${picks.has(c.id) ? ' sel' : ''}" data-id="${c.id}"
               data-name="${esc((A.L(c.name) + ' ' + c.order + ' ' + c.manufacturer).toLowerCase())}">
            ${bulk ? `<input type="checkbox" class="chk cat-chk" aria-label="${T18('Auswählen')}"${picks.has(c.id) ? ' checked' : ''}>` : ''}
            <div class="cat-main">
              <b>${esc(A.L(c.name))}</b>
              <span>${esc([c.manufacturer, c.order, A.L(c.appName), appVersionOf(c)].filter(Boolean).join(' · '))}</span>
            </div>
            <span class="dpt-tag">${c.hwOnly ? T18('ohne Applikation') : objCount(c)
              ? objCount(c) + ' KO'
              : Object.keys(c.params || {}).length + ' P'}</span>
            ${bulk ? `<input class="input mono cat-qty" type="number" min="1" max="${QTY_MAX}" value="${picks.get(c.id) || 1}"
                       aria-label="${T18('Stückzahl')}" title="${T18('Stückzahl')}"${picks.has(c.id) ? '' : ' disabled'}>` : ''}
            ${MN ? (n => `<button type="button" class="icon-btn cat-man${n ? ' has' : ''}" data-id="${c.id}"
                    title="${n ? T18('{0} Handbücher — verwalten oder weitere hochladen', n) : T18('Handbuch (PDF) hochladen')}">
              ${A.IC_BOOK}${n ? `<small>${n}</small>` : ''}</button>`)(MN.forItem(c).length) : ''}
            <button type="button" class="icon-btn cat-del" data-id="${c.id}" title="${T18('Aus dem Katalog entfernen')}">
              ${A.IC_TRASH}</button>
          </div>`).join('')
          : `<p class="hint">${T18('Der Katalog ist leer. Oben eine <b>.knxprod</b>-Datei laden.')}</p>`}
      </div>
      ${bulk ? `
      <div class="cat-target">
        <label class="field"><span>${T18('Ziellinie')}</span>
          <select class="select" id="m-line">${lineOptions(tgt.lineId)}</select></label>
        <label class="field" id="m-seg-row"${segmentOptions(tgt.lineId, tgt.segmentId) ? '' : ' hidden'}><span>${T18('Segment')}</span>
          <select class="select" id="m-seg">${segmentOptions(tgt.lineId, tgt.segmentId)}</select></label>
        <label class="field"><span>${T18('Verbaut in')}</span>
          <select class="select" id="m-room">${roomOptions(tgt.roomId)}</select></label>
      </div>
      <p class="hint" id="m-cat-sum"></p>
      <div id="m-err"></div>` : ''}`;
  };

  let picked = '';
  const count = () => [...picks.values()].reduce((s, n) => s + n, 0);
  // Ein einzelnes Produkt mit Stückzahl 1 ist die gewohnte Wahl fürs Formular
  const single = () => picks.size === 1 && count() === 1;
  A.openModal(T18('Produktkatalog'), render(), () => {
    if (bulk && picks.size && !single()) {
      const err = addFromCatalog([...picks].map(([id, qty]) => ({ id, qty })), tgt);
      if (err) { showErr(err); return false; }
      return;
    }
    const id = bulk && single() ? [...picks.keys()][0] : picked;
    // Ziellinie, Segment und Raum gehen mit zurück ins Formular
    if (onPick) A.nextModal(() => onPick(id, bulk ? { ...tgt } : null));
  });

  const sync = () => {
    if (!bulk) return;
    const n = count();
    $('#modal-ok').textContent = picks.size && !single()
      ? (n === 1 ? T18('1 Gerät anlegen') : T18('{0} Geräte anlegen', n)) : T18('Übernehmen');
    const line = KNX.lineById(tgt.lineId), area = KNX.areaOfLine(tgt.lineId);
    $('#m-cat-sum').textContent = !picks.size ? T18('Nichts angekreuzt.')
      : single() ? T18('Ein Gerät — weiter im Formular.')
      : T18('{0} Geräte aus {1} Produkten auf Linie {2}', n, picks.size, line && area ? area.addr + '.' + line.addr : '?');
    showErr('');
  };
  const qtyOf = row => {
    const v = parseInt(row.querySelector('.cat-qty').value, 10);
    return Number.isInteger(v) ? Math.min(QTY_MAX, Math.max(1, v)) : 1;
  };
  const setPick = (row, on) => {
    const id = row.dataset.id;
    if (on) picks.set(id, qtyOf(row)); else picks.delete(id);
    row.classList.toggle('sel', on);
    row.querySelector('.cat-chk').checked = on;
    row.querySelector('.cat-qty').disabled = !on;
    sync();
  };

  const wire = () => {
    const list = $('#m-cat-list');
    list.querySelectorAll('.cat-row').forEach(row => {
      row.addEventListener('click', e => {
        if (e.target.closest('.cat-del, .cat-qty, .cat-man')) return;
        if (bulk) {
          // Die Box schaltet selbst um; ein Klick auf die Zeile tut dasselbe
          setPick(row, e.target.classList.contains('cat-chk') ? e.target.checked : !picks.has(row.dataset.id));
          return;
        }
        picked = row.dataset.id;
        list.querySelectorAll('.cat-row').forEach(r => r.classList.toggle('sel', r === row));
      });
      row.addEventListener('dblclick', e => {
        if (e.target.closest('.cat-del, .cat-qty, .cat-chk, .cat-man')) return;
        picks.clear();
        picked = row.dataset.id;
        if (bulk) picks.set(picked, 1);
        A.modalConfirm();
      });
      const qty = row.querySelector('.cat-qty');
      if (qty) qty.addEventListener('input', () => {
        if (picks.has(row.dataset.id)) { picks.set(row.dataset.id, qtyOf(row)); sync(); }
      });
    });
    // Handbücher: Der Katalog geht zu, der Handbuchdialog auf
    list.querySelectorAll('.cat-man').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      const c = KNX.catalogById(b.dataset.id);
      A.closeModal();
      A.nextModal(() => MN.open({ item: c }));
    }));
    if ($('#m-manuals')) $('#m-manuals').addEventListener('click', () => {
      A.closeModal();
      A.nextModal(() => MN.open());
    });
    list.querySelectorAll('.cat-del').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      const c = KNX.catalogById(b.dataset.id);
      // Wer es noch benutzt, wechselt erst im Gerät das Produkt — dann ist nichts aufzuräumen
      const users = KNX.catalogUsers(b.dataset.id);
      if (users.length) {
        A.warn(users.length === 1
          ? A.t('„{0}“ wird von „{1}“ verwendet — dort erst unter „Bearbeiten“ ein anderes Produkt wählen, dann entfernen.', A.L(c.name), users[0].name)
          : A.t('„{0}“ wird von {1} Geräten verwendet — dort erst unter „Bearbeiten“ ein anderes Produkt wählen, dann entfernen.', A.L(c.name), users.length));
        return;
      }
      KNX.deleteCatalogItem(b.dataset.id);
      if (picked === b.dataset.id) picked = '';
      picks.delete(b.dataset.id);
      A.commit();
      $('#modal-body').innerHTML = render();
      wire();
      A.status(A.t('„{0}“ aus dem Katalog entfernt', c ? A.L(c.name) : A.t('Produkt')));
    }));
    if (bulk) {
      $('#m-line').addEventListener('change', e => {
        tgt.lineId = e.target.value;
        syncSegments(tgt.lineId, null);
        tgt.segmentId = readSegment(tgt.lineId);
        sync();
      });
      $('#m-seg').addEventListener('change', () => { tgt.segmentId = readSegment(tgt.lineId); });
      $('#m-room').addEventListener('change', e => { tgt.roomId = e.target.value || null; });
      sync();
    }
    $('#m-search').addEventListener('input', e => {
      const q = e.target.value.trim().toLowerCase();
      list.querySelectorAll('.cat-row').forEach(r => {
        r.hidden = !!q && !r.dataset.name.includes(q);
      });
    });
    $('#m-load').addEventListener('click', () => {
      pickProdFile((products, fileName, info) => {
        A.closeModal();
        actImportPick(products, fileName, () => actCatalog(onPick, bulk ? tgt : null), info);
      });
    });
    const online = $('#m-online');
    // Ohne lokalen Dienst gibt es kein Netz - dann bleibt der Knopf gesperrt.
    if (!window.KNXBackend) {
      online.disabled = true;
      online.title = T18('Dafür muss der lokale Dienst laufen.');
    } else {
      online.addEventListener('click', () => {
        A.closeModal();
        A.nextModal(() => actOnlineCatalog(() => actCatalog(onPick, bulk ? tgt : null)));
      });
    }
  };
  wire();
}

/* Auswahl aus einer frisch geladenen Produktdatei. */
function actImportPick(products, fileName, onDone, info) {
  const skipped = (info && info.binaries) || [];
  const failed = (info && info.failed) || [];
  const rows = products.map((p, i) => {
    const g = p.prog;
    // BCU1 und Koppler bringen die Ladeprozedur über die Maskendefinition mit
    const ready = !!(g && g.dl && (g.procedures.length || (g.dl.mk && g.dl.mk.procs.length))
      && !g.unsupported.length && !g.plugin);
    const mask = g && g.mask ? g.mask.replace(/^MV-/, '') : '';
    return `
    <label class="chk-row" data-name="${esc((A.L(p.name) + ' ' + p.order + ' ' + p.manufacturer).toLowerCase())}">
      <input type="checkbox" class="chk" data-i="${i}"${products.length === 1 ? ' checked' : ''}>
      <span class="chk-label">
        <b>${esc(A.L(p.name))}</b>
        ${p.order || p.manufacturer
          ? `<span class="cat-sub">${esc([p.manufacturer, p.order].filter(Boolean).join(' · '))}</span>` : ''}
      </span>
      ${mask ? `<span class="src-tag${ready ? ' prog' : ''}"
        title="${ready
          ? T18('Ladeprozeduren vollständig gelesen — das Gerät lässt sich programmieren')
          : T18('Für einen Download fehlen Angaben oder es wird ein herstellereigenes Programm gebraucht')}"
        >${T18('Maske {0}', esc(mask))}</span>` : ''}
      <span class="dpt-tag" title="${T18('Objekte und Parameter der Produktdatei')}">${p.hwOnly
        ? T18('ohne Applikation') : p.objCount + ' KO · ' + p.paramCount + ' P'}</span>
    </label>`;
  }).join('');

  A.openModal(products.length === 1 ? T18('1 Produkt in {0}', fileName) : T18('{0} Produkte in {1}', products.length, fileName), `
    <p class="hint">${T18('Produkte auswählen, die in den Katalog übernommen werden sollen.')}</p>
    ${failed.length ? `<p class="hint warn">${failed.length === 1 ? T18('1 Produkt liess sich nicht laden:')
        : T18('{0} Produkte liessen sich nicht laden:', failed.length)}
      ${failed.map(f => esc(f)).join('<br>')}</p>` : ''}
    ${skipped.length ? `<p class="hint warn">${T18(skipped.length === 1
        ? '1 herstellereigene Datei wird übergangen ({1}). Solche Programme laufen nur unter Windows in der ETS. Die Produktdaten selbst sind davon unberührt.'
        : '{0} herstellereigene Dateien werden übergangen ({1}). Solche Programme laufen nur unter Windows in der ETS. Die Produktdaten selbst sind davon unberührt.',
        skipped.length,
        esc(skipped.slice(0, 3).map(b => b.name.split('/').pop()).join(', ')) + (skipped.length > 3 ? ' …' : ''))}</p>` : ''}
    <div class="pick-row">
      <input class="input" id="m-search" placeholder="${T18('Filtern …')}">
      <button type="button" class="btn btn-sm" id="m-all">${T18('Alle')}</button>
      <button type="button" class="btn btn-sm" id="m-none">${T18('Keine')}</button>
    </div>
    <div class="chk-list tall" id="m-prods">${rows}</div>
    <div id="m-err"></div>
  `, () => {
    const sel = [...$('#m-prods').querySelectorAll('.chk:checked')].map(c => products[+c.dataset.i]);
    if (!sel.length) { showErr(T18('Mindestens ein Produkt auswählen.')); return false; }
    const added = KNX.addCatalogItems(sel);
    A.commit();
    A.status(added.length === 1 ? T18('1 Produkt im Katalog') : T18('{0} Produkte im Katalog', added.length));
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

/* ---------- Produktkatalog aus dem KNX-Onlinekatalog ---------- *
 * Der Katalog unter onlinecatalog.knx.org antwortet ohne Anmeldung. Gefragt
 * wird er vom lokalen Dienst, nicht vom Browser — nur der kennt das Netz und
 * hält den Cache. Hier steht allein die Auswahl.
 *
 * Sparsam bleiben: ein Herstellerindex sind ein bis fünf Megabyte, und der
 * Katalog kennt kein bedingtes Nachladen. Darum wird je Hersteller einmal
 * geholt und danach aus dem Cache gelesen; „Aktualisieren“ ist der einzige
 * Weg zurück ins Netz.                                                     */

const ONLINE_LANG  = 'de-DE';
const ONLINE_MEDIA = { 'MT-0': 'TP', 'MT-1': 'PL', 'MT-2': 'RF', 'MT-5': 'IP' };
const ONLINE_ROWS  = 300;   // mehr Zeilen bremsen den Dialog, ohne zu helfen

/* Suchtext eines Eintrags, einmal berechnet und am Eintrag gemerkt. */
function onlineHay(e) {
  if (!e._hay) {
    e._hay = [e.ProductName, e.CatalogItemName, e.OrderNumber,
              e.ApplicationProgramName, e.manufacturerName]
      .filter(Boolean).join(' ').toLowerCase();
  }
  return e._hay;
}

function onlineRow(e, i) {
  const medium = (e.MediumTypeIds || []).map(m => ONLINE_MEDIA[m] || m).join('/');
  const plugin = e.NoDownloadWithoutPlugin || e.RequiresExternalSoftware;
  const sub = [e.manufacturerName, e.OrderNumber, e.ApplicationProgramName].filter(Boolean).join(' · ');
  return `
    <label class="chk-row" data-name="${esc(onlineHay(e))}">
      <input type="checkbox" class="chk" data-i="${i}">
      <span class="chk-label">
        <b>${esc(e.ProductName || e.CatalogItemName || 'Produkt')}</b>
        ${sub ? `<span class="cat-sub">${esc(sub)}</span>` : ''}
      </span>
      ${plugin ? `<span class="src-tag" title="${T18('Das Gerät wird in der ETS über ein herstellereigenes Programm parametriert. Die Produktdaten lassen sich trotzdem laden.')}">${T18('Zusatzprogramm')}</span>` : ''}
      ${medium ? `<span class="dpt-tag" title="${T18('Übertragungsmedium')}">${esc(medium)}</span>` : ''}
    </label>`;
}

const onlineSize = n => !n ? '0 B'
  : n < 1024 ? n + ' B'
  : n < 1048576 ? (n / 1024).toFixed(0) + ' KB'
  : (n / 1048576).toFixed(1) + ' MB';

/* Auswahl im Onlinekatalog; die gewählten Produkte laufen danach durch
   denselben Übernahmedialog wie eine selbst geladene Produktdatei. */
function actOnlineCatalog(onDone) {
  const be = window.KNXBackend;
  if (!be) {
    A.warn(T18('Der Onlinekatalog braucht den lokalen Dienst — im reinen Browserbetrieb steht er nicht bereit.'));
    return;
  }

  let all = [];        // voller Bestand des gewählten Herstellers bzw. Suchtreffer
  let shown = [];      // was gerade in der Liste steht
  let chosen = '';     // Hersteller-Nummer als Text, '' = im geladenen Bestand suchen
  let searchTimer = 0;

  A.openModal(T18('Onlinekatalog'), `
    <p class="hint">${T18('Produktdaten aus dem offenen KNX-Onlinekatalog. Einmal Geholtes bleibt auf diesem Rechner — der zweite Zugriff kommt ohne Übertragung aus. Ohne gewählten Hersteller durchsucht das Suchfeld alles, was schon geholt wurde.')}</p>
    <div class="pick-row">
      <select class="input" id="m-maker"><option value="">${T18('— Hersteller werden geladen … —')}</option></select>
      <button type="button" class="btn btn-sm" id="m-fresh"
              title="${T18('Diesen Hersteller neu vom Katalog holen')}">${T18('Aktualisieren')}</button>
      <button type="button" class="btn btn-sm" id="m-cache" title="${T18('Zwischenspeicher ansehen')}">${T18('Speicher …')}</button>
    </div>
    <div class="pick-row">
      <input class="input" id="m-search" placeholder="${T18('Name oder Bestellnummer …')}">
      <button type="button" class="btn btn-sm" id="m-all">${T18('Alle')}</button>
      <button type="button" class="btn btn-sm" id="m-none">${T18('Keine')}</button>
    </div>
    <div class="chk-list tall" id="m-prods"><p class="hint">${T18('Einen Hersteller wählen.')}</p></div>
    <div id="m-note"></div>
    <div id="m-err"></div>
  `, () => {
    const sel = [...$('#m-prods').querySelectorAll('.chk:checked')].map(c => shown[+c.dataset.i]);
    if (!sel.length) { showErr(T18('Mindestens ein Produkt auswählen.')); return false; }
    A.nextModal(() => onlineLoad(sel, onDone));
  });

  const note = html => { $('#m-note').innerHTML = html ? `<p class="hint">${html}</p>` : ''; };
  const live = () => !!$('#m-prods');   // der Dialog kann zwischendurch geschlossen worden sein

  function render(list, empty) {
    if (!live()) return;
    shown = list.slice(0, ONLINE_ROWS);
    $('#m-prods').innerHTML = shown.length ? shown.map(onlineRow).join('')
      : `<p class="hint">${esc(empty)}</p>`;
    if (list.length > shown.length) {
      note(T18('{0} Treffer — angezeigt werden die ersten {1}. Bitte enger suchen.', list.length, shown.length));
    }
  }

  const query = () => $('#m-search').value.trim().toLowerCase();

  /* Ein gewählter Hersteller wird örtlich gefiltert, sonst sucht der Dienst
     in allem, was schon im Cache liegt. */
  function refilter() {
    if (!live()) return;
    const q = query();
    if (chosen) {
      note('');
      render(q ? all.filter(e => onlineHay(e).includes(q)) : all,
        T18('Zu diesem Hersteller steht nichts im Katalog.'));
      return;
    }
    if (!q) {
      render([], T18('Einen Hersteller wählen — oder hier suchen, dann werden die bereits geholten Hersteller durchsucht.'));
      return;
    }
    be.online.search(q).then(r => {
      if (!live() || query() !== q) return;
      all = r.entries || [];
      render(all, r.manufacturersSearched
        ? T18('Kein Treffer in den {0} bereits geholten Herstellern.', r.manufacturersSearched)
        : T18('Noch kein Hersteller geholt. Oben einen auswählen — oder unter „Speicher …“ einmal alle holen, dann sucht dieses Feld über den ganzen Katalog.'));
      if (all.length && r.manufacturersSearched) {
        // Sind ohnehin alle Hersteller geholt, waere der Rat, weitere zu holen, unsinnig.
        const known = Math.max(0, $('#m-maker').options.length - 1);
        const rest = known && r.manufacturersSearched < known && !r.truncated
          ? ' ' + T18('Nicht durchsucht: {0} noch nicht geholte Hersteller.', known - r.manufacturersSearched) : '';
        note((r.truncated
          ? T18('{0} und mehr Treffer aus {1} Herstellern.', all.length, r.manufacturersSearched)
          : T18('{0} Treffer aus {1} Herstellern.', all.length, r.manufacturersSearched)) + rest);
      }
    }).catch(e => showErr(T18('Suche fehlgeschlagen: {0}', e && e.message ? e.message : e)));
  }

  async function loadMaker(id, refresh) {
    chosen = String(id || '');
    if (!chosen) { all = []; refilter(); return; }
    $('#m-prods').innerHTML = `<p class="hint">${T18('Produktliste wird geholt …')}</p>`;
    note('');
    showErr('');
    try {
      const doc = await be.online.index(chosen, ONLINE_LANG, !!refresh);
      if (!live()) return;
      all = doc.entries || [];
      refilter();
      if (doc.stale) {
        note(doc.sourceBytes
          ? T18('Der Stand ist älter als eine Woche. „Aktualisieren“ holt ihn neu (beim letzten Mal {0} Übertragung).', onlineSize(doc.sourceBytes))
          : T18('Der Stand ist älter als eine Woche. „Aktualisieren“ holt ihn neu.'));
      }
    } catch (e) {
      if (!live()) return;
      $('#m-prods').innerHTML = `<p class="hint">${T18('Nichts geladen.')}</p>`;
      showErr(T18('Hersteller nicht ladbar: {0}', e && e.message ? e.message : e));
    }
  }

  async function fillMakers(refresh) {
    try {
      const makers = await be.online.manufacturers(refresh);
      if (!live()) return;
      $('#m-maker').innerHTML =
        `<option value="">${T18('— im geholten Bestand suchen —')}</option>`
        + makers.map(m => `<option value="${m.id}">${esc(m.name)}${m.cached ? ' ·' : ''}</option>`).join('');
      $('#m-maker').value = chosen;
    } catch (e) {
      if (!live()) return;
      showErr(T18('Herstellerliste nicht erreichbar: {0}', e && e.message ? e.message : e));
    }
  }

  $('#m-maker').addEventListener('change', e => loadMaker(e.target.value, false));
  $('#m-fresh').addEventListener('click', () => chosen ? loadMaker(chosen, true) : fillMakers(true));
  $('#m-cache').addEventListener('click', () => { A.closeModal(); A.nextModal(() => actOnlineCache(onDone)); });
  $('#m-search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(refilter, chosen ? 0 : 300);
  });
  const visible = () => [...$('#m-prods').querySelectorAll('.chk-row')].filter(r => !r.hidden);
  $('#m-all').addEventListener('click', () =>
    visible().forEach(r => { r.querySelector('.chk').checked = true; }));
  $('#m-none').addEventListener('click', () =>
    visible().forEach(r => { r.querySelector('.chk').checked = false; }));

  fillMakers(false);
}

/* Holt die gewählten Produktdateien und übergibt sie dem Übernahmedialog. */
async function onlineLoad(sel, onDone) {
  const be = window.KNXBackend;
  const files = [], failed = [];

  for (let i = 0; i < sel.length; i++) {
    const e = sel[i];
    const label = e.OrderNumber || e.ProductName || T18('Produkt');
    A.status(T18('Produktdatei {0} von {1}: {2} …', i + 1, sel.length, label));
    try {
      files.push({ label, blob: new Blob([await be.online.product(e.Id, ONLINE_LANG)]) });
    } catch (err) {
      failed.push(`${label}: ${err && err.message ? err.message : err}`);
    }
  }

  const products = [], binaries = [], extras = [];
  for (const f of files) {
    try {
      const r = await KNXProd.read(f.blob);
      products.push(...r.products);
      binaries.push(...r.binaries);
      extras.push(...r.extras);
    } catch (err) {
      failed.push(`${f.label}: ${err && err.message ? err.message : err}`);
    }
  }

  A.status('');

  /* „NotInAnyMarket“ trifft auch Produkte, die im Index ganz normal aussehen —
     ob eine Produktdatei noch abrufbar ist, zeigt erst der Versuch. */
  if (!products.length) {
    A.openModal(T18('Nichts geladen'), `
      <p class="hint warn">${T18('Keine der gewählten Produktdateien liess sich holen.')}</p>
      <ul class="detail-list">${failed.map(f => `<li><span>${esc(f)}</span></li>`).join('')}</ul>
    `, () => { if (onDone) A.nextModal(onDone); });
    return;
  }
  actImportPick(products, files.length === 1 ? files[0].label
    : T18('{0} Produktdateien aus dem Onlinekatalog', files.length), onDone,
    { binaries, extras, failed });
}

/* Zwischenspeicher des Onlinekatalogs: ansehen, vorsorglich füllen, leeren. */
function actOnlineCache(onBack) {
  const be = window.KNXBackend;
  let off = null;   // Abmeldung von der Ereignisleitung
  let job = '';

  A.openModal(T18('Speicher des Onlinekatalogs'), `
    <div id="m-stat"><p class="hint">${T18('Wird gelesen …')}</p></div>
    <p class="hint">${T18('Der Katalog kennt weder Kurzabfrage noch Komprimierung — jeder Hersteller kostet stets die volle Übertragung. Darum wird einzeln nur geholt, was gebraucht wird. Einmal alle 252 Hersteller zu holen sind rund 60 MB und etwa eine Viertelminute; daraus werden gut 5 MB Zwischenspeicher. Danach durchsucht die Suche den ganzen Katalog, ohne das Netz noch einmal zu berühren.')}</p>
    <div class="pick-row">
      <button type="button" class="btn btn-sm" id="m-sync">${T18('Alle Hersteller holen …')}</button>
      <button type="button" class="btn btn-sm" id="m-stop" hidden>${T18('Abbrechen')}</button>
      <button type="button" class="btn btn-sm" id="m-clear-i">${T18('Produktlisten verwerfen')}</button>
      <button type="button" class="btn btn-sm" id="m-clear-p">${T18('Produktdateien verwerfen')}</button>
    </div>
    <div id="m-prog"></div>
    <div id="m-err"></div>
  `, () => { if (onBack) A.nextModal(() => actOnlineCatalog(onBack)); });

  const live = () => !!$('#m-stat');
  const prog = html => { if (live()) $('#m-prog').innerHTML = html ? `<p class="hint">${html}</p>` : ''; };

  async function stats() {
    try {
      const s = await be.online.status();
      if (!live()) return;
      $('#m-stat').innerHTML = `<ul class="detail-list kv">
        <li><span>${T18('Hersteller bekannt')}</span><span class="grow">${s.manufacturers || 0}</span></li>
        <li><span>${T18('Produktlisten geholt')}</span><span class="grow">${s.indexes || 0} · ${onlineSize(s.indexBytes)}</span></li>
        <li><span>${T18('Produktdateien im Speicher')}</span><span class="grow">${s.products || 0} · ${onlineSize(s.productBytes)}</span></li>
        <li><span>${T18('Ablage')}</span><span class="grow" title="${esc(s.dir || '')}">${esc(s.dir || '')}</span></li>
      </ul>`;
    } catch (e) {
      if (live()) $('#m-stat').innerHTML = `<p class="hint warn">${esc(e && e.message ? e.message : String(e))}</p>`;
    }
  }

  function watch(id) {
    job = id;
    $('#m-sync').hidden = true;
    $('#m-stop').hidden = false;
    off = be.events.on('job', ev => {
      if (ev.id !== job) return;
      const d = ev.detail;
      if (d && d.total) {
        prog(T18('{0} von {1} Herstellern — {2} geholt', d.done, d.total, d.fetched)
             + (d.failed ? ', ' + T18('{0} fehlgeschlagen', d.failed) : '')
             + (ev.message ? ' · ' + esc(ev.message) : ''));
      }
      if (ev.state === 'fertig' || ev.state === 'fehler' || ev.state === 'abgebrochen') {
        if (off) { off(); off = null; }
        job = '';
        if (live()) { $('#m-sync').hidden = false; $('#m-stop').hidden = true; }
        prog(T18('Durchlauf {0}', esc(T18(ev.state))) + (ev.error ? ': ' + esc(ev.error) : '') + '.');
        stats();
      }
    });
  }

  $('#m-sync').addEventListener('click', async () => {
    try {
      const r = await be.online.sync({ language: ONLINE_LANG });
      watch(r.job);
      prog(T18('Wird geholt … Der Dialog darf offen bleiben; ein Abbruch behält das bereits Geholte.'));
    } catch (e) {
      showErr('Nicht gestartet: ' + (e && e.message ? e.message : e));
    }
  });
  $('#m-stop').addEventListener('click', () => { if (job) be.online.cancelJob(job).catch(() => {}); });
  $('#m-clear-i').addEventListener('click', () => be.online.clearCache('index').then(stats));
  $('#m-clear-p').addEventListener('click', () => be.online.clearCache('products').then(stats));

  stats();
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
    A.warn(T18('Diesem Gerät liegt kein Produkt aus einer .knxprod zugrunde.'));
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
      return `<label class="prm"><span>${esc(T18(f.label))} <em>${T18('laut Produktdatei')}</em></span>
        <input class="input mono" type="text" value="${KNX.tunnelCount(dev)}" disabled></label>`;
    }
    const val = ip[f.key] == null ? '' : String(ip[f.key]);
    if (f.kind === 'enum') {
      return `<label class="prm"><span>${esc(T18(f.label))}</span>
        <select class="select ip-in" data-key="${f.key}">${f.v.map(([v, t]) =>
          `<option value="${v}"${v === val ? ' selected' : ''}>${esc(T18(t))}</option>`).join('')}</select></label>`;
    }
    if (f.kind === 'num') {
      return `<label class="prm"><span>${esc(T18(f.label))} <em>${f.min}–${f.max}</em></span>
        <input class="input mono ip-in" type="number" data-key="${f.key}"
               min="${f.min}" max="${f.max}" value="${esc(val)}"></label>`;
    }
    if (f.kind === 'ip') {
      return `<label class="prm"><span>${esc(T18(f.label))} <em>IPv4</em></span>
        <input class="input mono ip-in" type="text" data-key="${f.key}" value="${esc(val)}"
               inputmode="decimal" placeholder="192.168.1.10"
               pattern="^((25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(25[0-5]|2[0-4]\\d|1?\\d?\\d)$"></label>`;
    }
    return `<label class="prm"><span>${esc(T18(f.label))}</span>
      <input class="input ip-in" type="text" data-key="${f.key}" value="${esc(val)}"
             placeholder="${esc(dev.name)}" maxlength="${f.max || 60}"></label>`;
  };

  /* Was eine Zuweisung der Produktdatei festlegt, zeigt den wirksamen Wert
     und lässt sich nicht ändern — wie in der ETS. Gesetzt von body(). */
  let assigned = {};
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
    const fixed = Object.prototype.hasOwnProperty.call(assigned, ref);
    const val = fixed ? String(assigned[ref]) : KNX.paramValue(item, draft, ref);
    const dis = p.ro || fixed ? ' disabled' : '';
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
    assigned = r.assigned || {};
    const n = r.groups.reduce((s, g) => s + g.params.filter(editable).length, 0);
    const ipGroup = hasIp ? `
      <section class="prm-group" data-name="ip netzwerk network adresse address ${esc(KNX.IP_FIELDS.map(f => (f.label + ' ' + T18(f.label)).toLowerCase()).join(' '))}">
        <h4>${T18('IP-Konfiguration')}</h4>
        <p class="prm-note">${T18('Diese Angaben stehen nicht in der Produktdatei — die ETS führt sie im Eigenschaftsfenster des Geräts. Die Routing-Multicast-Adresse ({0}) gilt für das ganze Projekt und wird am Backbone eingestellt.', esc(KNX.ipConfig(dev).mcast))}</p>
        ${KNX.IP_FIELDS.map(ipField).join('')}
      </section>` : '';
    return `
      <p class="hint">${esc(item ? A.L(item.name) : dev.name)}${item && item.appName ? ' · ' + esc(A.L(item.appName)) : ''} —
        ${r.objs.length
          ? T18('<b>{0}</b> Parameter, <b>{1}</b> Kommunikationsobjekte.', n, r.objs.length)
          : T18('<b>{0}</b> Parameter — dieses Gerät arbeitet ohne Kommunikationsobjekte.', n)}
        ${T18('Nicht jede Einstellung ist immer sichtbar; die Liste folgt der Auswahl.')}</p>
      <input class="input" id="m-search" placeholder="${T18('Parameter filtern …')}" value="${esc(lastFilter)}">
      <div class="prm-list" id="m-params">
        ${ipGroup}
        ${r.groups.map(g => `
          <section class="prm-group" data-name="${esc((g.label + ' ' +
              g.params.map(x => item.params[x].t || '').join(' ')).toLowerCase())}">
            <h4>${esc(g.label)}</h4>
            ${g.params.map(field).join('')}
          </section>`).join('')}
        ${!ipGroup && !r.groups.length ? `<p class="hint">${T18('Keine einstellbaren Parameter.')}</p>` : ''}
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

  A.openModal(T18('Parameter — {0}', esc(dev.name)), body(), () => {
    const bad = $('#m-params').querySelector('.prm-in:invalid, .ip-in:invalid');
    if (bad) {
      const grp = bad.closest('.prm-group');
      if (grp) grp.hidden = false;
      bad.focus();
      bad.scrollIntoView({ block: 'center' });
      A.warn(T18('Ungültiger Wert bei „{0}“.',
        bad.closest('.prm').querySelector('span').firstChild.textContent.trim()));
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
      A.warn(res.orphans.length === 1
        ? T18('1 Objekt entfällt durch die neue Einstellung, trägt aber noch Gruppenadressen — es bleibt als überzählig stehen.')
        : T18('{0} Objekte entfallen durch die neue Einstellung, tragen aber noch Gruppenadressen — sie bleiben als überzählig stehen.', res.orphans.length));
    else if (res && res.carried.length)
      A.status(T18('{0} Objekte neu abgeleitet — ihre Gruppenadressen sind mitgegangen', res.carried.length));
    else A.status(dev.objs.length
      ? T18('{0} Kommunikationsobjekte', dev.objs.length)
      : T18('Einstellungen übernommen'));
  });
  wire();
}

/* ---------- Kommunikationsobjekte ---------- */
function objForm(o) {
  return `
    <div class="addr-grid" style="grid-template-columns:1fr 3fr">
      <label class="field"><span>${T18('Nr.')}</span>
        <input class="input mono" id="m-num" type="number" min="0" max="65535" value="${o.num}">
      </label>
      <label class="field"><span>${T18('Name')}</span>
        <input class="input" id="m-name" maxlength="60" value="${esc(o.name)}" placeholder="${T18('z. B. A1 Schalten')}">
      </label>
    </div>
    <label class="field"><span>${T18('Beschreibung')}</span>
      <input class="input" id="m-desc" maxlength="200" value="${esc(o.desc || '')}" placeholder="${T18('z. B. Taster Flur links')}">
    </label>
    <label class="field"><span>${T18('Datenpunkttyp')}</span>
      <select class="select" id="m-dpt">${G.dptOptions(o.dpt)}</select>
    </label>
    <div class="field"><span>Flags</span>${flagBoxes(o.flags)}</div>
    <div id="m-err"></div>`;
}

function actNewObj(devId) {
  const d = KNX.deviceById(devId);
  if (!d) return;
  if (d.catalogId) {
    A.warn(T18('Die Objektliste kommt aus der Produktdatei — sie folgt der Parametrierung. Über „Parameter …“ anpassen.'));
    return;
  }
  const draft = { num: d.objs.length ? Math.max(...d.objs.map(o => o.num)) + 1 : 0,
                  name: '', dpt: '1.001',
                  flags: { c: true, r: false, w: true, t: false, u: false, i: false } };
  A.openModal(T18('Neues Objekt — {0}', esc(d.name)), objForm(draft), () => {
    const name = $('#m-name').value.trim();
    if (!name) { showErr(T18('Bitte einen Namen vergeben.')); return false; }
    const o = { id: KNX.uid('o'), num: $('#m-num').valueAsNumber || 0, name,
                desc: $('#m-desc').value.trim(), dpt: $('#m-dpt').value, flags: readFlags(), gas: [] };
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
  A.openModal(T18('Objekt bearbeiten — {0}', esc(d.name)), objForm(o), () => {
    const name = $('#m-name').value.trim();
    if (!name) { showErr(T18('Bitte einen Namen vergeben.')); return false; }
    const dpt = $('#m-dpt').value;
    const clash = o.gas.map(x => KNX.gaById(x)).filter(g => g && g.dpt !== dpt);
    if (clash.length && !$('#m-force')) {
      showErr(T18('Weicht vom DPT der Adresse {0} ({1}) ab. Erneut bestätigen, um es trotzdem zu übernehmen.',
              KNX.addrStr(clash[0]), clash[0].dpt));
      $('#m-err').insertAdjacentHTML('beforeend', '<input type="hidden" id="m-force">');
      return false;
    }
    Object.assign(o, { num: $('#m-num').valueAsNumber || 0, name, desc: $('#m-desc').value.trim(), dpt, flags: readFlags() });
    KNX.touch();
    A.commit();
  });
}

function actDeleteObj(objId) {
  const e = KNX.objById(objId);
  if (!e) return;
  const { dev: d, obj: o } = e;
  if (d.catalogId && o.ref && !o.stale) {
    A.warn(T18('Dieses Objekt gehört zur Produktdatei. Über „Parameter …“ abwählen, statt es zu löschen.'));
    return;
  }
  A.openModal(T18('Kommunikationsobjekt löschen?'), `
    <p>${T18('„{0}“ von <b>{1}</b> wird entfernt.', esc(o.name), esc(d.name))}</p>
    ${o.gas.length ? `<p class="hint warn">${T18('{0} Adresszuordnungen gehen verloren.', o.gas.length)}</p>` : ''}
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
  A.openModal(T18('Adressen — {0}', esc(o.name)), `
    <p class="hint">${esc(d.name)} · ${KNX.paStr(d.addr)} · ${T18('Objekt-DPT <b>{0}</b>. Die <b>erste</b> markierte Adresse ist die sendende.', o.dpt)}</p>
    <input class="input" id="m-search" placeholder="${T18('Adressen filtern …')}">
    <div class="chk-list tall" id="m-gas">
      ${gs.map(g => `
        <label class="chk-row" data-name="${esc((g.name + ' ' + KNX.addrStr(g)).toLowerCase())}">
          <input type="checkbox" class="chk" data-ga="${g.id}"${o.gas.includes(g.id) ? ' checked' : ''}>
          <span class="addr">${KNX.addrStr(g)}</span>
          <span class="chk-label">${esc(g.name)}</span>
          <span class="dpt-tag${g.dpt === o.dpt ? '' : ' bad'}">${g.dpt}</span>
        </label>`).join('') || `<p class="hint">${T18('Noch keine Gruppenadressen angelegt.')}</p>`}
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

/* Ein Flag direkt umschalten — aus dem Detailbereich, ohne Dialog. Das gilt
   auch für Objekte aus der Produktdatei: wie in der ETS darf man ihre Flags
   ändern, und das Neuableiten nach einer Parameteränderung behält sie. */
function actToggleFlag(objId, key) {
  const e = KNX.objById(objId);
  const f = KNX.KO_FLAGS.find(x => x.key === key);
  if (!e || !f) return;
  const on = !e.obj.flags[key];
  e.obj.flags[key] = on;
  KNX.touch();
  A.commit();
  A.status(on ? T18('„{0}“ eingeschaltet · {1}', T18(f.de), KNX.objLabel(e.obj))
              : T18('„{0}“ ausgeschaltet · {1}', T18(f.de), KNX.objLabel(e.obj)));
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
  A.openModal(T18('Neuen Bereich anlegen'), `
    <label class="field"><span>${T18('Bereichsnummer')} <em>${T18('1–15, 0 ist der Backbone')}</em></span>
      <input class="input mono" id="m-addr" type="number" min="1" max="15" value="${Math.min(free, 15)}">
    </label>
    <label class="field"><span>${T18('Name')}</span>
      <input class="input" id="m-name" maxlength="40" placeholder="${T18('z. B. Nebengebäude')}">
    </label>
    <label class="field"><span>${T18('Medium der Hauptlinie')} <em>${Math.min(free, 15)}.0</em></span>
      <select class="select" id="m-medium">${mediumOptions('tp')}</select>
    </label>
    <label class="field"><span>${T18('Notiz')}</span>
      <textarea class="input note" id="m-note" rows="3" maxlength="${KNX.NOTE_MAX}"
                placeholder="${T18('Freitext zur Dokumentation')}"></textarea>
    </label>
    <div id="m-err"></div>
  `, () => {
    const addr = $('#m-addr').valueAsNumber;
    const name = $('#m-name').value.trim();
    if (!name) { showErr(T18('Bitte einen Namen vergeben.')); return false; }
    if (!Number.isInteger(addr) || addr < 1 || addr > KNX.PA_MAX.area)
      { showErr(T18('Bereichsnummer muss zwischen 1 und 15 liegen — Bereich 0 ist der Backbone.')); return false; }
    if (used.has(addr)) { showErr(T18('Bereich {0} ist bereits vergeben.', addr)); return false; }
    const a = { id: KNX.uid('a'), addr, name, note: $('#m-note').value.trim(),
                lines: [ { id: KNX.uid('l'), addr: 0, name: 'Hauptlinie', medium: $('#m-medium').value, note: '', segments: [] },
                         { id: KNX.uid('l'), addr: 1, name: 'Linie 1', medium: 'tp', note: '', segments: [] } ] };
    KNX.project().areas.push(a);
    KNX.touch();
    state.sel = { kind: 'area', id: a.id };
    A.commit();
  });
}

function actEditArea(id) {
  const a = KNX.project().areas.find(x => x.id === id);
  if (!a) return;
  if (a.backbone) { actEditLine(a.lines[0].id); return; }
  A.openModal(T18('Bereich bearbeiten'), `
    <label class="field"><span>${T18('Bereichsnummer')} <em>1–15</em></span>
      <input class="input mono" id="m-addr" type="number" min="1" max="15" value="${a.addr}">
    </label>
    <label class="field"><span>${T18('Name')}</span>
      <input class="input" id="m-name" maxlength="40" value="${esc(a.name)}">
    </label>
    <label class="field"><span>${T18('Medium der Hauptlinie')} <em>${a.addr}.0</em></span>
      <select class="select" id="m-medium">${mediumOptions((a.lines.find(l => l.addr === 0) || {}).medium || 'tp')}</select>
    </label>
    <label class="field"><span>${T18('Notiz')}</span>
      <textarea class="input note" id="m-note" rows="3" maxlength="${KNX.NOTE_MAX}"
                placeholder="${T18('Freitext zur Dokumentation')}">${esc(a.note || '')}</textarea>
    </label>
    <p class="hint">${T18('Beim Ändern der Nummer werden die physikalischen Adressen aller Geräte dieses Bereichs mitgezogen.')}</p>
    <div id="m-err"></div>
  `, () => {
    const addr = $('#m-addr').valueAsNumber;
    const name = $('#m-name').value.trim();
    if (!name) { showErr(T18('Bitte einen Namen vergeben.')); return false; }
    if (!Number.isInteger(addr) || addr < 1 || addr > KNX.PA_MAX.area)
      { showErr(T18('Bereichsnummer muss zwischen 1 und 15 liegen — Bereich 0 ist der Backbone.')); return false; }
    if (KNX.project().areas.some(x => x.id !== id && x.addr === addr))
      { showErr(T18('Bereich {0} ist bereits vergeben.', addr)); return false; }
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
    followTunnels(KNX.project().devices.filter(d => a.lines.some(l => l.id === d.lineId)));
    a.name = name;
    a.note = $('#m-note').value.trim();
    const mainLine = a.lines.find(l => l.addr === 0);
    if (mainLine) mainLine.medium = $('#m-medium').value;
    KNX.touch();
    A.commit();
  });
}

function actDeleteArea(id) {
  const a = KNX.project().areas.find(x => x.id === id);
  if (!a) return;
  if (a.backbone) { A.warn(T18('Der Backbone gehört zu jedem Projekt und lässt sich nicht löschen.')); return; }
  if (KNX.regularAreas().length < 2) { A.warn(T18('Der letzte Bereich kann nicht gelöscht werden.')); return; }
  const n = a.lines.reduce((s, l) => s + KNX.devicesOnLine(l.id).length, 0);
  A.openModal(T18('Bereich „{0}“ löschen?', esc(a.name)), `
    <p>${T18('Der Bereich mit {0} Linien wird entfernt.', a.lines.length)}</p>
    ${n ? `<p class="hint warn">${T18('{0} Geräte werden auf die erste verbleibende Linie verschoben — ihre physikalischen Adressen passen dann nicht mehr und werden als Fehler markiert.', n)}</p>` : ''}
  `, () => {
    KNX.deleteArea(id);
    if (state.sel?.kind === 'area' && state.sel.id === id) state.sel = null;
    A.commit();
  });
}

const mediumOptions = sel => Object.entries(KNX.MEDIA).map(([k, v]) =>
  `<option value="${k}"${k === sel ? ' selected' : ''}>${esc(T18(v))}</option>`).join('');

function actNewLine(areaId) {
  const a = KNX.project().areas.find(x => x.id === areaId);
  if (!a) return;
  if (a.backbone) { A.warn(T18('Der Backbone hat nur die Linie 0.0 — neue Linien gehören in einen Bereich.')); return; }
  const used = new Set(a.lines.map(l => l.addr));
  let free = 1;
  while (free <= KNX.PA_MAX.line && used.has(free)) free++;
  A.openModal(T18('Neue Linie in „{0}“', esc(a.name)), `
    <label class="field"><span>${T18('Liniennummer')} <em>${T18('1–15, 0 ist die Hauptlinie')}</em></span>
      <input class="input mono" id="m-addr" type="number" min="1" max="15" value="${Math.min(free, 15)}">
    </label>
    <label class="field"><span>${T18('Name')}</span>
      <input class="input" id="m-name" maxlength="40" placeholder="${T18('z. B. Linie Keller')}">
    </label>
    <label class="field"><span>${T18('Medium')}</span>
      <select class="select" id="m-medium">${Object.entries(KNX.MEDIA).map(([k, v]) =>
        `<option value="${k}">${esc(T18(v))}</option>`).join('')}</select>
    </label>
    <label class="field"><span>${T18('Notiz')}</span>
      <textarea class="input note" id="m-note" rows="3" maxlength="${KNX.NOTE_MAX}"
                placeholder="${T18('Freitext zur Dokumentation')}"></textarea>
    </label>
    <div id="m-err"></div>
  `, () => {
    const addr = $('#m-addr').valueAsNumber;
    const name = $('#m-name').value.trim();
    if (!name) { showErr(T18('Bitte einen Namen vergeben.')); return false; }
    if (!Number.isInteger(addr) || addr < 1 || addr > KNX.PA_MAX.line)
      { showErr(T18('Liniennummer muss zwischen 1 und 15 liegen — Linie 0 ist die Hauptlinie.')); return false; }
    if (used.has(addr)) { showErr(T18('Linie {0} ist bereits vergeben.', a.addr + '.' + addr)); return false; }
    const l = { id: KNX.uid('l'), addr, name, medium: $('#m-medium').value,
                note: $('#m-note').value.trim(), segments: [] };
    a.lines.push(l);
    KNX.touch();
    state.sel = { kind: 'line', id: l.id };
    A.commit();
  });
}

function actEditLine(id) {
  const l = KNX.lineById(id), a = KNX.areaOfLine(id);
  if (!l || !a) return;
  if (a.backbone) { actEditBackbone(l); return; }
  const main = l.addr === 0;
  A.openModal(main ? T18('Hauptlinie {0}.0 bearbeiten', a.addr) : T18('Linie bearbeiten'), `
    <label class="field"${main ? ' hidden' : ''}><span>${T18('Liniennummer')} <em>1–15</em></span>
      <input class="input mono" id="m-addr" type="number" min="1" max="15" value="${l.addr}">
    </label>
    <label class="field"><span>${T18('Name')}</span>
      <input class="input" id="m-name" maxlength="40" value="${esc(l.name)}">
    </label>
    <label class="field"><span>${T18('Medium')}</span>
      <select class="select" id="m-medium">${Object.entries(KNX.MEDIA).map(([k, v]) =>
        `<option value="${k}"${k === l.medium ? ' selected' : ''}>${esc(T18(v))}</option>`).join('')}</select>
    </label>
    <label class="field"><span>${T18('Notiz')}</span>
      <textarea class="input note" id="m-note" rows="3" maxlength="${KNX.NOTE_MAX}"
                placeholder="${T18('Freitext zur Dokumentation')}">${esc(l.note || '')}</textarea>
    </label>
    <p class="hint">${main ? T18('Die Hauptlinie gehört fest zum Bereich und behält die Nummer 0.')
      : T18('Beim Ändern der Nummer werden die Adressen der Geräte auf dieser Linie mitgezogen.')}</p>
    <div id="m-err"></div>
  `, () => {
    const addr = main ? 0 : $('#m-addr').valueAsNumber;
    const name = $('#m-name').value.trim();
    if (!name) { showErr(T18('Bitte einen Namen vergeben.')); return false; }
    if (!main && (!Number.isInteger(addr) || addr < 1 || addr > KNX.PA_MAX.line))
      { showErr(T18('Liniennummer muss zwischen 1 und 15 liegen — Linie 0 ist die Hauptlinie.')); return false; }
    if (a.lines.some(x => x.id !== id && x.addr === addr))
      { showErr(T18('Linie {0} ist bereits vergeben.', a.addr + '.' + addr)); return false; }
    if (addr !== l.addr) {
      KNX.devicesOnLine(id).filter(KNX.hasPa).forEach(d => {
        const [, , n] = KNX.paSplit(d.addr);
        d.addr = KNX.paJoin(a.addr, addr, n);
      });
    }
    l.addr = addr;
    followTunnels(KNX.devicesOnLine(id));
    l.name = name;
    l.medium = $('#m-medium').value;
    l.note = $('#m-note').value.trim();
    KNX.touch();
    A.commit();
  });
}

/* Backbone: Nummer fest 0.0, Medium IP oder TP, bei IP die Multicast-Adresse
   aller KNXnet/IP-Router des Projekts (03/08/03 2.5.17).                   */
function actEditBackbone(l) {
  const mcastRow = medium => medium === 'ip' ? '' : ' hidden';
  A.openModal(T18('Backbone bearbeiten'), `
    <label class="field"><span>${T18('Name')}</span>
      <input class="input" id="m-name" maxlength="40" value="${esc(l.name)}">
    </label>
    <label class="field"><span>${T18('Medium')}</span>
      <select class="select" id="m-medium">${KNX.BACKBONE_MEDIA.map(k =>
        `<option value="${k}"${k === l.medium ? ' selected' : ''}>${esc(T18(KNX.MEDIA[k]))}</option>`).join('')}</select>
    </label>
    <label class="field" id="m-mcast-row"${mcastRow(l.medium)}><span>${T18('Routing-Multicast-Adresse')} <em>IPv4</em></span>
      <input class="input mono" id="m-mcast" value="${esc(l.mcast || '224.0.23.12')}" inputmode="decimal">
    </label>
    <label class="field"><span>${T18('Notiz')}</span>
      <textarea class="input note" id="m-note" rows="3" maxlength="${KNX.NOTE_MAX}"
                placeholder="${T18('Freitext zur Dokumentation')}">${esc(l.note || '')}</textarea>
    </label>
    <p class="hint">${T18('Der Backbone verbindet die Bereiche. Die Multicast-Adresse gilt für alle KNXnet/IP-Router und wird beim Programmieren in jeden geschrieben.')}</p>
    <div id="m-err"></div>
  `, () => {
    const name = $('#m-name').value.trim();
    if (!name) { showErr(T18('Bitte einen Namen vergeben.')); return false; }
    const medium = $('#m-medium').value;
    const mcast = $('#m-mcast').value.trim();
    // Multicast-Gruppen liegen in 224.0.0.0/4
    if (medium === 'ip' && (!KNX.isIpV4(mcast) || +mcast.split('.')[0] < 224 || +mcast.split('.')[0] > 239))
      { showErr(T18('Die Multicast-Adresse muss zwischen 224.0.0.0 und 239.255.255.255 liegen.')); return false; }
    l.name = name;
    l.medium = medium;
    if (medium === 'ip') l.mcast = mcast;
    l.note = $('#m-note').value.trim();
    KNX.areaOfLine(l.id).name = name;
    KNX.touch();
    A.commit();
  });
  $('#m-medium').addEventListener('change', e => { $('#m-mcast-row').hidden = e.target.value !== 'ip'; });
}

function actDeleteLine(id) {
  const l = KNX.lineById(id), a = KNX.areaOfLine(id);
  if (!l || !a) return;
  if (a.backbone) { A.warn(T18('Der Backbone gehört zu jedem Projekt und lässt sich nicht löschen.')); return; }
  if (l.addr === 0) { A.warn(T18('Die Hauptlinie {0}.0 gehört fest zum Bereich und lässt sich nicht löschen.', a.addr)); return; }
  const n = KNX.devicesOnLine(id).length;
  A.openModal(T18('Linie {0} „{1}“ löschen?', a.addr + '.' + l.addr, esc(l.name)), `
    ${n ? `<p class="hint warn">${T18('{0} Geräte werden auf die Hauptlinie {1}.0 verschoben — ihre physikalischen Adressen passen dann nicht mehr und werden als Fehler markiert.', n, a.addr)}</p>`
        : `<p>${T18('Auf dieser Linie sind keine Geräte.')}</p>`}
  `, () => {
    if (!KNX.deleteLine(id)) { A.warn(T18('Die letzte Linie kann nicht gelöscht werden.')); return; }
    if (state.sel?.kind === 'line' && state.sel.id === id) state.sel = null;
    if (state.filter?.kind === 'line' && state.filter.id === id) state.filter = null;
    A.commit();
  });
}

/* ---------- Segmente ---------- */
function actNewSegment(lineId) {
  const line = KNX.lineById(lineId);
  if (!line) return;
  const s = KNX.addSegment(lineId);
  state.collapsed.delete(lineId);
  state.sel = { kind: 'seg', id: s.id };
  A.commit();
  A.toast(T18('{0} angelegt — die bisherigen Geräte bleiben in Segment 0', s.name));
}

function actEditSegment(key) {
  const s = KNX.segmentInfo(key);
  if (!s) return;
  if (!s.seg) { actEditLine(s.line.id); return; }
  const others = new Set(KNX.segmentsOf(s.line).filter(x => x.id !== key).map(x => x.num));
  A.openModal(T18('Segment bearbeiten'), `
    <label class="field"><span>${T18('Segmentnummer')} <em>1–15</em></span>
      <input class="input mono" id="m-addr" type="number" min="1" max="15" value="${s.num}">
    </label>
    <label class="field"><span>${T18('Name')}</span>
      <input class="input" id="m-name" maxlength="40" value="${esc(s.seg.name)}">
    </label>
    <label class="field"><span>${T18('Medium')}</span>
      <select class="select" id="m-medium">${mediumOptions(s.seg.medium)}</select>
    </label>
    <label class="field"><span>${T18('Notiz')}</span>
      <textarea class="input note" id="m-note" rows="3" maxlength="${KNX.NOTE_MAX}"
                placeholder="${T18('z. B. Linienverstärker im Verteiler OG')}">${esc(s.seg.note || '')}</textarea>
    </label>
    <div id="m-err"></div>
  `, () => {
    const num = $('#m-addr').valueAsNumber;
    const name = $('#m-name').value.trim();
    if (!name) { showErr(T18('Bitte einen Namen vergeben.')); return false; }
    if (!Number.isInteger(num) || num < 1 || num > 15)
      { showErr(T18('Segmentnummer muss zwischen 1 und 15 liegen — Segment 0 ist die Linie selbst.')); return false; }
    if (others.has(num)) { showErr(T18('Segment {0} gibt es auf dieser Linie schon.', num)); return false; }
    Object.assign(s.seg, { num, name, medium: $('#m-medium').value, note: $('#m-note').value.trim() });
    KNX.touch();
    A.commit();
  });
}

function actDeleteSegment(key) {
  const s = KNX.segmentInfo(key);
  if (!s || !s.seg) return;
  const n = KNX.devicesInSegment(key).length;
  A.openModal(T18('{0} löschen?', esc(s.seg.name)), `
    <p>${T18('Das Segment wird entfernt.')}</p>
    ${n ? `<p class="hint">${T18('{0} Geräte wechseln in Segment 0 der Linie; ihre Adressen bleiben.', n)}</p>` : ''}
  `, () => {
    KNX.deleteSegment(key);
    if (state.sel?.kind === 'seg' && state.sel.id === key) state.sel = { kind: 'line', id: s.line.id };
    if (state.filter?.kind === 'seg' && state.filter.id === key) state.filter = null;
    A.commit();
  });
}

/* ---------- Haupt-/Mittelgruppen benennen ---------- */
function actRenameGaGroup(key) {
  const p = KNX.project();
  const style = KNX.gaStyle();
  const level = String(key).split('/').length - 1;
  const label = style.parts[level]?.label || 'Gruppe';
  A.openModal(T18('{0} {1} benennen', T18(label), key), `
    <label class="field"><span>${T18('Name')}</span>
      <input class="input" id="m-name" maxlength="40" value="${esc(p.gaNames[key] || '')}"
             placeholder="${T18('z. B. Beleuchtung')}">
    </label>
    <p class="hint">${T18('Leer lassen entfernt den Namen. Die Adressen bleiben unverändert.')}</p>
  `, () => {
    const name = $('#m-name').value.trim();
    if (name) p.gaNames[key] = name; else delete p.gaNames[key];
    A.commit();
  });
}

window.KNXTopo = {
  actNewDevice, actEditDevice, actCopyDevice, actDeleteDevice, moveDevice, actParams,
  actNewObj, actEditObj, actDeleteObj, actAssignObj, actSetSending, actToggleFlag,
  actNewArea, actEditArea, actDeleteArea,
  actNewLine, actEditLine, actDeleteLine,
  actNewSegment, actEditSegment, actDeleteSegment,
  actRenameGaGroup, actCatalog
};
})();
