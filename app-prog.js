/* ============================================================
   KNX-Struktur — Geführte Programmierung
   ------------------------------------------------------------
   Zeigt je Gerät, was neu zu laden ist — physikalische Adresse,
   Applikation, Parameter, Gruppenadressen — und lädt es in einem
   Durchgang: erst alle Adressen (dabei nennt das Fenster nacheinander
   das Gerät, an dem die Programmiertaste zu drücken ist), danach die
   Downloads ohne weiteres Zutun.

   Grundlage ist der Programmierstand am Gerät (`loaded`): die
   Prüfsummen dessen, was zuletzt geladen wurde, verglichen mit dem
   aktuellen Projekt (KNXDownload.fingerprint). Das Inbetriebnahme-
   Fenster (app-bus.js) bleibt für Test und Fehlersuche; beide teilen
   sich die Busverbindung und die Sperre des Busthreads.
   ============================================================ */
'use strict';

(() => {

const A = window.KNXApp, $ = s => document.querySelector(s);
const esc = A.esc, T18 = A.t;
const B = window.KNXBackend, BUS = window.KNXBus;

if (!B || !BUS || !BUS.available) { window.KNXProg = { available: false }; return; }
const FB = BUS.feedback;

$('#btn-prog').hidden = false;

/* ============================================================
   Programmierstand
   ============================================================ */

const PARTS = ['pa', 'app', 'par', 'grp'];
const LOAD_PARTS = ['app', 'par', 'grp'];

/* Was ein Löschcode bzw. das Entladen eines Interface-Objekts im Gerät
   ungültig macht. Lieber einmal zu viel neu laden als falsch vermerken. */
const ERASES = {
  FactoryReset: ['pa', 'app', 'par', 'grp'],
  FactoryResetWithoutIndividualAddress: ['app', 'par', 'grp'],
  ResetApplicationProgram: ['app', 'par', 'grp'],
  ResetApplicationParameters: ['par'],
  ResetLinks: ['grp'],
  ResetIndividualAddress: ['pa']
};
const UNLOADS = { 3: ['app', 'par', 'grp'], 4: ['app', 'par', 'grp'], 1: ['grp'], 2: ['grp'], 6: ['grp'] };

const KIND_LABELS = {
  all: 'Vollständig', ap1: 'Vollständig ohne PEI-Programm', par: 'Nur Parameter', grp: 'Nur Gruppenadressen',
  'par,grp': 'Parameter und Gruppenadressen', unload: 'Applikation entladen'
};

const itemOf = dev => (dev && dev.catalogId ? KNX.catalogById(dev.catalogId) : null);
const isCoupler = dev => KNXDownload.usesFilterTable(itemOf(dev));

/* Die Prüfsummen gelten bis zur nächsten Änderung am Projekt. */
const fpCache = { rev: -1, map: new Map(), groups: null };
function fingerprint(dev) {
  if (fpCache.rev !== KNX.rev()) { fpCache.rev = KNX.rev(); fpCache.map.clear(); fpCache.groups = null; }
  if (fpCache.map.has(dev.id)) return fpCache.map.get(dev.id);
  const p = KNX.project();
  if (!fpCache.groups) fpCache.groups = new Map(p.groups.map(g => [g.id, g]));
  let fp = null;
  try { fp = KNXDownload.fingerprint(p, dev, itemOf(dev), fpCache.groups); } catch (e) { fp = null; }
  fpCache.map.set(dev.id, fp);
  return fp;
}

/**
 * Je Teil 'ok' oder 'due'; null für Teile, die das Gerät nicht hat (ohne
 * Programmierdaten bleibt nur die Adresse). Geräte ohne physikalische Adresse
 * — Netzteil, Drossel — haben nichts zu programmieren: dann null.
 */
function state(dev) {
  if (!dev || dev.placeholder || !KNX.hasPa(dev) || !(dev.addr > 0)) return null;
  const l = dev.loaded || {}, fp = fingerprint(dev);
  const s = { pa: l.pa === dev.addr ? 'ok' : 'due', app: null, par: null, grp: null, fp };
  if (fp) LOAD_PARTS.forEach(k => { s[k] = l[k] === fp[k] ? 'ok' : 'due'; });
  s.due = PARTS.filter(k => s[k] === 'due');
  return s;
}
const isDue = dev => { const s = state(dev); return !!s && s.due.length > 0; };

/** Vermerkt, was geladen ist: die vergebene Adresse und je Teil die Prüfsumme beim Planen. */
function record(dev, { pa, fp, parts = [] }) {
  if (!dev) return;
  const l = { ...(dev.loaded || {}) };
  if (Number.isInteger(pa)) l.pa = pa;
  if (fp) parts.forEach(k => { if (fp[k]) l[k] = fp[k]; });
  l.at = Date.now();
  dev.loaded = l;
  A.saveQuiet();
}

function forget(dev, parts) {
  if (!dev || !dev.loaded || !parts.length) return;
  const l = { ...dev.loaded };
  parts.forEach(k => { delete l[k]; });
  if (Object.keys(l).some(k => k !== 'at')) dev.loaded = l; else delete dev.loaded;
  A.saveQuiet();
}

function partLabel(k, dev) {
  if (k === 'grp' && isCoupler(dev)) return T18('Filtertabelle');
  return T18({ pa: 'Phys. Adresse', app: 'Applikation', par: 'Parameter', grp: 'Gruppenadressen' }[k]);
}

const fmtStamp = ms => new Date(ms).toLocaleString(T18('de-DE'), { dateStyle: 'short', timeStyle: 'short' });

/* ---------- Anzeige im Baum und im Detail ---------- */

const IC_DL = '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10"/></svg>';

/** Markierung für eine Baumzeile: nur, wenn darunter etwas zu programmieren ist. */
function badge(devs) {
  const due = devs.filter(isDue);
  if (!due.length) return null;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'prog-dot' + (devs.length > 1 ? ' n' : '');
  b.tabIndex = -1;
  b.innerHTML = IC_DL + (devs.length > 1 ? `<span>${due.length}</span>` : '');
  const one = devs.length === 1 ? state(due[0]) : null;
  b.title = (one ? T18('Zu programmieren: {0}', one.due.map(k => partLabel(k, due[0])).join(', '))
    : due.length === 1 ? T18('1 Gerät zu programmieren') : T18('{0} Geräte zu programmieren', due.length))
    + '\n' + T18('Klick öffnet die Programmierung');
  b.onclick = e => { e.stopPropagation(); open({ devices: due.map(d => d.id) }); };
  return b;
}

function deviceSection(dev) {
  const s = state(dev);
  if (!s) return '';
  const l = dev.loaded || {};
  const item = itemOf(dev);
  const row = k => s[k] ? `<li><span class="grow">${esc(partLabel(k, dev))}</span>${s[k] === 'ok'
    ? `<span class="pg-tag ok">${T18('geladen')}</span>`
    : `<span class="pg-tag due">${T18('ausstehend')}</span>`}</li>` : '';
  return `<h3 class="detail-h">${T18('Programmierung')}</h3>
    <ul class="detail-list">${PARTS.map(row).join('')}
      ${l.at ? `<li><span class="grow">${T18('Zuletzt programmiert')}</span><span class="addr">${esc(fmtStamp(l.at))}</span></li>` : ''}
    </ul>
    ${!s.fp && item && !item.hwOnly
      ? `<p class="hint">${T18('Zum Produkt fehlen Programmierdaten — bitte die .knxprod erneut in den Katalog laden.')}</p>` : ''}`;
}

/** Zählt im Kopf mit, wie viele Geräte zu programmieren sind; hält das offene Fenster aktuell. */
function refresh() {
  const n = KNX.project().devices.filter(isDue).length;
  const btn = $('#btn-prog');
  const b = btn.querySelector('.btn-badge');
  b.hidden = !n;
  b.textContent = n;
  if (!run.active) {
    btn.title = n === 1 ? T18('1 Gerät zu programmieren')
      : n ? T18('{0} Geräte zu programmieren', n) : T18('Alle Geräte sind auf dem Stand des Projekts');
  }
  if (overlay && overlay.classList.contains('open')) renderAll();
}

/* ============================================================
   Fenster
   ============================================================ */

const conn = { connected: false, linkAddress: '', interfaceAddress: '', servers: [], last: null,
               busy: false, searched: false, status: null };
/* Auswahl je Gerät. `auto` folgt dem Programmierstand, bis jemand sie anfasst. */
const pick = new Map();
const run = { active: false, cancel: false, skip: false, force: '', job: null, onJob: null,
              rows: new Map(), ids: new Set(), release: null, timer: 0, started: 0, label: '', step: '' };
const view = { show: 'due' };
let overlay = null, langStale = false;
const q = sel => overlay.querySelector(sel);

const IFACE_KEY = 'knx-prog-iface-v1';
const CANCELLED = { cancelled: true };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function ensureOverlay() {
  if (overlay) return;
  overlay = document.createElement('div');
  overlay.id = 'prog-overlay';
  overlay.innerHTML = `
    <div class="ovl-card pg-card" role="dialog" aria-modal="true" aria-label="${T18('Programmieren')}">
      <header class="ovl-head">
        <h2>${T18('Programmieren')}</h2>
        <span id="pg-state" class="dpt-tag">${T18('nicht verbunden')}</span>
        <div class="spacer"></div>
        <label class="chk" title="${T18('Hinweiston, wenn eine Programmiertaste zu drücken ist und wenn der Durchgang endet')}">
          <input type="checkbox" id="pg-sound"> ${T18('Ton')}</label>
        <button id="pg-close" class="btn" title="${T18('Schließen — ein laufender Durchgang läuft weiter (Esc)')}">${T18('Schließen')}</button>
      </header>

      <div class="pg-conn">
        <span class="lbl">${T18('Schnittstelle')}</span>
        <select id="pg-server" class="select" aria-label="${T18('Gefundene Schnittstelle')}">
          <option value="">${T18('— zuerst suchen —')}</option></select>
        <button id="pg-discover" class="btn btn-sm">${T18('Suchen')}</button>
        <label class="chk" title="${T18('Nötig, wenn die Schnittstelle hinter einem Router mit Adressumsetzung liegt')}">
          <input type="checkbox" id="pg-nat"> ${T18('NAT')}</label>
        <button id="pg-connect" class="btn btn-sm btn-primary">${T18('Verbinden')}</button>
        <button id="pg-disconnect" class="btn btn-sm" hidden>${T18('Trennen')}</button>
        <span id="pg-conn-info" class="pane-meta"></span>
      </div>

      <div id="pg-activity" class="ovl-activity" role="status" aria-live="polite">
        <span class="act-text">${T18('Bereit.')}</span>
        <span class="act-time"></span>
      </div>

      <div id="pg-prompt" class="pg-prompt" hidden role="alert">
        <div class="pg-prompt-main">
          <b class="pg-prompt-title"></b>
          <span class="pg-prompt-detail"></span>
        </div>
        <button id="pg-force" class="btn btn-sm" hidden>${T18('Trotzdem vergeben')}</button>
        <button id="pg-skip" class="btn btn-sm">${T18('Überspringen')}</button>
      </div>

      <div class="pg-tools">
        <div class="pg-show" role="radiogroup" aria-label="${T18('Anzeigen')}">
          <label class="chk"><input type="radio" name="pg-show" value="due" checked>
            ${T18('Ausstehende')} <span id="pg-n-due" class="pane-meta"></span></label>
          <label class="chk"><input type="radio" name="pg-show" value="all">
            ${T18('Alle Geräte')} <span id="pg-n-all" class="pane-meta"></span></label>
        </div>
        <button id="pg-sel-due" class="btn btn-sm" title="${T18('Bei jedem Gerät genau das wählen, was aussteht')}">${T18('Ausstehendes wählen')}</button>
        <button id="pg-sel-none" class="btn btn-sm">${T18('Nichts wählen')}</button>
        <div class="spacer"></div>
        <label class="chk" title="${T18('Ist die Seriennummer bekannt, braucht die Adressvergabe keine Programmiertaste')}">
          <input type="checkbox" id="pg-serial" checked> ${T18('Adresse per Seriennummer, wenn bekannt')}</label>
      </div>

      <div class="ovl-body pg-body">
        <table class="ga mini pg-table">
          <thead><tr>
            <th class="col-chk"><input type="checkbox" id="pg-all" aria-label="${T18('Alle gezeigten Geräte wählen')}"></th>
            <th>${T18('Adresse')}</th><th>${T18('Gerät')}</th><th>${T18('Laden')}</th><th></th><th>${T18('Stand')}</th>
          </tr></thead>
          <tbody id="pg-rows"></tbody>
        </table>
      </div>

      <footer class="ovl-foot pg-foot">
        <div class="pg-foot-row">
          <button id="pg-log-toggle" class="btn btn-sm" aria-expanded="false" aria-controls="pg-log">${T18('Protokoll')}</button>
          <span id="pg-summary" class="pane-meta"></span>
          <div class="spacer"></div>
          <button id="pg-stop" class="btn" hidden>${T18('Abbrechen')}</button>
          <button id="pg-run" class="btn btn-primary">${T18('Ausführen')}</button>
        </div>
        <div id="pg-log" class="ovl-log" hidden></div>
      </footer>
    </div>`;
  document.body.appendChild(overlay);
  wire();
}

function wire() {
  q('#pg-close').onclick = closeOverlay;
  overlay.addEventListener('click', e => { if (e.target === overlay) closeOverlay(); });

  q('#pg-sound').checked = FB.prefs.sound;
  q('#pg-sound').onchange = e => { FB.savePrefs({ sound: e.target.checked }); FB.chime('ok'); };

  q('#pg-discover').onclick = () => discover(false);
  q('#pg-connect').onclick = connect;
  q('#pg-disconnect').onclick = disconnect;
  q('#pg-server').onchange = syncControls;

  overlay.querySelectorAll('input[name="pg-show"]').forEach(r => r.onchange = () => {
    view.show = r.value;
    renderAll();
  });
  q('#pg-sel-due').onclick = () => { pick.clear(); renderAll(); };
  q('#pg-sel-none').onclick = () => {
    KNX.project().devices.forEach(d => pick.set(d.id, { on: false, mode: 'prog', parts: new Set(), auto: false }));
    renderAll();
  };
  q('#pg-all').onchange = e => {
    shownDevices().forEach(d => setOn(d, e.target.checked));
    renderAll();
  };
  q('#pg-serial').onchange = renderAll;

  q('#pg-rows').addEventListener('click', e => {
    const chip = e.target.closest('.pchip');
    if (!chip || chip.disabled) return;
    const d = KNX.deviceById(chip.closest('tr').dataset.dev);
    if (d) togglePart(d, chip.dataset.part);
  });
  q('#pg-rows').addEventListener('change', e => {
    const tr = e.target.closest('tr');
    if (e.target.matches('[data-line]')) {
      shownDevices().filter(d => d.lineId === e.target.dataset.line).forEach(d => setOn(d, e.target.checked));
      renderAll();
      return;
    }
    const d = tr && KNX.deviceById(tr.dataset.dev);
    if (!d) return;
    if (e.target.matches('[data-pick]')) { setOn(d, e.target.checked); renderAll(); }
    else if (e.target.matches('.pg-mode')) setMode(d, e.target.value);
  });

  q('#pg-run').onclick = start;
  q('#pg-stop').onclick = cancel;
  q('#pg-skip').onclick = () => { run.skip = true; promptDetail(T18('Wird übersprungen …')); };
  q('#pg-force').onclick = () => { run.force = q('#pg-force').dataset.pa || ''; q('#pg-force').hidden = true; };
  q('#pg-log-toggle').onclick = () => {
    const log = q('#pg-log');
    log.hidden = !log.hidden;
    q('#pg-log-toggle').setAttribute('aria-expanded', String(!log.hidden));
    if (!log.hidden) log.scrollTop = log.scrollHeight;
  };
}

/* Der Busthread meldet sich über die Ereignisleitung — einmal, nicht je Fensteraufbau. */
B.events.on('log', e => appendLog(e.level, e.message));
B.events.on('bus', e => { if (e.connected === false) { conn.connected = false; refreshStatus(); } });
B.events.on('job', e => { if (run.active && run.onJob && e.id === run.job) run.onJob(e); });

/* ---------- Sprachwechsel: neu aufbauen, aber nie mitten im Durchgang ---------- */

function rebuildForLanguage() {
  if (!overlay) return;
  if (run.active) { langStale = true; return; }
  langStale = false;
  const wasOpen = overlay.classList.contains('open');
  const keep = { server: q('#pg-server').value, nat: q('#pg-nat').checked, serial: q('#pg-serial').checked,
                 log: q('#pg-log').innerHTML, logOpen: !q('#pg-log').hidden };
  overlay.remove();
  overlay = null;
  ensureOverlay();
  fillServers();
  q('#pg-server').value = keep.server;
  q('#pg-nat').checked = keep.nat;
  q('#pg-serial').checked = keep.serial;
  q('#pg-log').innerHTML = keep.log;
  q('#pg-log').hidden = !keep.logOpen;
  overlay.querySelector(`input[name="pg-show"][value="${view.show}"]`).checked = true;
  if (conn.status) applyStatus(conn.status);
  renderAll();
  if (wasOpen) overlay.classList.add('open');
}
window.KNXI18n.onChange(rebuildForLanguage);

/* ---------- Auswahl ---------- */

function defaultPick(d, force) {
  const s = state(d);
  const parts = new Set(s ? s.due : []);
  // Ausdrücklich gewählt, aber nichts offen: neu laden, was das Gerät hat
  if (!parts.size && force && s) parts.add(s.fp ? 'app' : 'pa');
  return { on: parts.size > 0, mode: 'prog', parts, auto: !force, rev: KNX.rev() };
}

function pickOf(d) {
  let p = pick.get(d.id);
  if (!p || (p.auto && p.rev !== KNX.rev())) {
    p = defaultPick(d, false);
    pick.set(d.id, p);
  }
  return p;
}

/* Mit der Applikation kommen Parameter und Gruppenadressen ohnehin mit. */
const effParts = p => new Set([...p.parts, ...(p.parts.has('app') ? ['par', 'grp'] : [])]);

function setOn(d, on) {
  const p = pickOf(d);
  if (on && p.mode === 'prog' && !p.parts.size) {
    const def = defaultPick(d, true);
    p.parts = def.parts;
  }
  p.on = on && (p.mode !== 'prog' || p.parts.size > 0);
  p.auto = false;
}

function togglePart(d, k) {
  const p = pickOf(d);
  if (p.parts.has(k)) p.parts.delete(k); else p.parts.add(k);
  p.on = p.parts.size > 0;
  p.auto = false;
  renderAll();
}

function setMode(d, mode) {
  const p = pickOf(d);
  p.mode = mode;
  p.on = mode !== 'prog' || p.parts.size > 0;
  p.auto = false;
  renderAll();
}

/* Welcher Download die gewählten Teile abdeckt — Teil-Downloads nur, wenn die Produktdatei sie anbietet. */
function kindFor(item, want) {
  const ks = KNXDownload.kinds(item);
  const full = ks.includes('all') ? 'all' : ks.includes('ap1') ? 'ap1' : (ks[0] || 'all');
  if (want.app) return full;
  if (want.par && want.grp) return ks.includes('par,grp') ? 'par,grp' : full;
  if (want.par) return ks.includes('par') ? 'par' : ks.includes('par,grp') ? 'par,grp' : full;
  if (want.grp) return ks.includes('grp') ? 'grp' : ks.includes('par,grp') ? 'par,grp' : full;
  return null;
}

function kindLabel(kind, dev) {
  const de = KIND_LABELS[kind] || kind;
  return T18(isCoupler(dev) ? de.replace('Gruppenadressen', 'Filtertabelle') : de);
}

/** Was der Durchgang je Gerät tut, in der Reihenfolge der Schritte. */
function jobsFromPick() {
  const bySerial = q('#pg-serial').checked;
  const out = [];
  KNX.project().devices.slice().sort(KNX.byPa).forEach(d => {
    const s = state(d);
    if (!s) return;
    const p = pickOf(d);
    if (!p.on) return;
    const ops = [];
    if (p.mode === 'prog') {
      const eff = effParts(p);
      if (eff.has('pa')) ops.push({ op: 'pa', serial: bySerial && !!d.serial });
      const want = { app: eff.has('app'), par: eff.has('par'), grp: eff.has('grp') };
      if (s.fp && (want.app || want.par || want.grp)) ops.push({ op: 'dl', kind: kindFor(itemOf(d), want) });
    } else if (p.mode === 'unload' && s.fp) {
      ops.push({ op: 'dl', kind: 'unload' });
    } else if (p.mode === 'reset' || p.mode === 'resetKeep') {
      ops.push({ op: 'reset', code: p.mode === 'reset' ? 'FactoryReset' : 'FactoryResetWithoutIndividualAddress' });
    }
    if (ops.length) out.push({ dev: d, ops, addr: d.addr, pa: KNX.paStr(d.addr), state: s, left: ops.length });
  });
  return out;
}

/* ---------- Darstellung ---------- */

function shownDevices() {
  const devs = KNX.project().devices.filter(d => state(d)).sort(KNX.byPa);
  if (view.show === 'all') return devs;
  return devs.filter(d => isDue(d) || run.ids.has(d.id) || pickOf(d).on);
}

function chipTitle(k, d, s, implied) {
  if (implied) return T18('Wird mit der Applikation geladen');
  const what = partLabel(k, d);
  if (k === 'pa') return s.pa === 'ok' ? T18('Adresse {0} ist vergeben', KNX.paStr(d.addr))
    : T18('Adresse {0} ist nicht als vergeben vermerkt', KNX.paStr(d.addr));
  return s[k] === 'ok' ? T18('{0}: geladen', what) : T18('{0}: ausstehend', what);
}

function standHtml(d, s) {
  const r = run.rows.get(d.id);
  if (r) {
    return `<span class="pg-st ${r.phase}" title="${esc(r.text)}">${esc(r.text)}</span>`
      + (r.pct != null ? `<div class="prog-bar"><span style="width:${r.pct}%"></span></div>` : '');
  }
  const l = d.loaded || {};
  const when = l.at ? T18('Zuletzt programmiert: {0}', fmtStamp(l.at)) : T18('Noch nie programmiert');
  return s.due.length
    ? `<span class="pg-st due" title="${esc(when)}">${T18('ausstehend')}</span>`
    : `<span class="pg-st ok" title="${esc(when)}">${T18('aktuell')}</span>`;
}

function rowHtml(d) {
  const s = state(d), p = pickOf(d), item = itemOf(d);
  const locked = run.active;
  const eff = effParts(p);
  const chips = p.mode !== 'prog'
    ? `<span class="pg-mode-text">${esc({ unload: T18('Applikation, Parameter und Gruppenadressen werden entladen'),
        reset: T18('Werkszustand — die Adresse wird 15.15.255'),
        resetKeep: T18('Werkszustand — die Adresse bleibt') }[p.mode])}</span>`
    : PARTS.filter(k => s[k]).map(k => {
        const implied = (k === 'par' || k === 'grp') && p.parts.has('app');
        const on = eff.has(k);
        return `<button type="button" class="pchip${s[k] === 'due' ? ' due' : ''}${on ? ' on' : ''}${implied ? ' implied' : ''}"
          data-part="${k}" aria-pressed="${on}"${locked || implied ? ' disabled' : ''}
          title="${esc(chipTitle(k, d, s, implied))}">${esc(partLabel(k, d))}</button>`;
      }).join('');
  const modes = [['prog', T18('Programmieren')]];
  if (s.fp) modes.push(['unload', T18('Applikation entladen')]);
  modes.push(['reset', T18('Werkszustand vollständig')], ['resetKeep', T18('Werkszustand, Adresse behalten')]);
  const hint = !s.fp && item && !item.hwOnly ? `<small class="warn">${T18('Programmierdaten fehlen')}</small>`
    : d.product ? `<small>${esc(d.product)}</small>` : '';
  const r = run.rows.get(d.id);
  return `<tr class="pg-row${p.on ? ' on' : ''}${r ? ' ' + r.phase : ''}" data-dev="${esc(d.id)}">
    <td class="col-chk"><input type="checkbox" data-pick${p.on ? ' checked' : ''}${locked ? ' disabled' : ''}
      aria-label="${esc(T18('{0} wählen', d.name))}"></td>
    <td class="addr">${KNX.paStr(d.addr)}</td>
    <td class="pg-name"><span>${d.secure ? A.IC_LOCK + ' ' : ''}${esc(d.name)}</span>${hint}</td>
    <td class="pg-what"><div class="pg-chips">${chips}</div></td>
    <td class="pg-mode-cell"><select class="select pg-mode"${locked ? ' disabled' : ''} aria-label="${T18('Vorgang')}">${
      modes.map(([v, t]) => `<option value="${v}"${p.mode === v ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></td>
    <td class="pg-stand">${standHtml(d, s)}</td>
  </tr>`;
}

function renderRows() {
  const devs = shownDevices();
  const out = [];
  let line = null;
  devs.forEach(d => {
    if (d.lineId !== line) {
      line = d.lineId;
      out.push(`<tr class="pg-line"><td class="col-chk"><input type="checkbox" data-line="${esc(line)}"${run.active ? ' disabled' : ''}
        aria-label="${esc(T18('Linie {0} wählen', KNX.lineLabel(line)))}"></td>
        <td colspan="5">${esc(KNX.lineLabel(line))}</td></tr>`);
    }
    out.push(rowHtml(d));
  });
  const all = KNX.project().devices.filter(d => state(d));
  q('#pg-rows').innerHTML = out.join('') || `<tr><td colspan="6" class="pg-empty">${view.show === 'due'
    ? (all.length ? T18('Alle Geräte sind auf dem Stand des Projekts.') : T18('Im Projekt gibt es kein Gerät mit physikalischer Adresse.'))
    : T18('Im Projekt gibt es kein Gerät mit physikalischer Adresse.')}</td></tr>`;

  // Kästchen der Linien und der Kopfzeile: an, aus oder teils
  const tri = (box, list) => {
    const on = list.filter(d => pickOf(d).on).length;
    box.checked = !!list.length && on === list.length;
    box.indeterminate = on > 0 && on < list.length;
  };
  q('#pg-rows').querySelectorAll('[data-line]').forEach(b => tri(b, devs.filter(d => d.lineId === b.dataset.line)));
  tri(q('#pg-all'), devs);
  q('#pg-all').disabled = run.active || !devs.length;
  q('#pg-n-due').textContent = '(' + all.filter(isDue).length + ')';
  q('#pg-n-all').textContent = '(' + all.length + ')';
}

/* Während des Durchgangs ändert sich nur der Stand einer Zeile — nicht die ganze Tabelle neu bauen. */
function paintRow(id) {
  const tr = overlay && q(`#pg-rows tr[data-dev="${CSS.escape(id)}"]`);
  const d = KNX.deviceById(id);
  if (!tr || !d) { if (overlay) renderRows(); return; }
  const r = run.rows.get(id);
  tr.className = 'pg-row' + (pickOf(d).on ? ' on' : '') + (r ? ' ' + r.phase : '');
  tr.querySelector('.pg-stand').innerHTML = standHtml(d, state(d));
}

function summarize() {
  const jobs = jobsFromPick();
  let pa = 0, dl = 0, other = 0;
  jobs.forEach(j => j.ops.forEach(o => { if (o.op === 'pa') pa++; else if (o.op === 'dl' && o.kind !== 'unload') dl++; else other++; }));
  const bits = [pa && T18('{0} × Adresse', pa), dl && T18('{0} × Download', dl), other && T18('{0} × Entladen/Werkszustand', other)]
    .filter(Boolean);
  q('#pg-summary').textContent = run.active ? '' : !jobs.length ? T18('Nichts gewählt')
    : bits.join(' · ') + (conn.connected ? '' : ' ' + T18('— erst verbinden'));
  q('#pg-run').textContent = jobs.length === 1 ? T18('1 Gerät programmieren')
    : jobs.length ? T18('{0} Geräte programmieren', jobs.length) : T18('Ausführen');
  return jobs;
}

function syncControls() {
  if (!overlay) return;
  const busy = run.active || conn.busy;
  const other = !run.active && !conn.busy && BUS.busy();
  ['#pg-discover', '#pg-nat'].forEach(sel => { q(sel).disabled = busy || conn.connected; });
  q('#pg-server').disabled = busy || conn.connected || !conn.servers.length;
  q('#pg-connect').hidden = conn.connected;
  q('#pg-connect').disabled = busy || !!other || !q('#pg-server').value;
  q('#pg-disconnect').hidden = !conn.connected;
  q('#pg-disconnect').disabled = busy || !!other;
  ['#pg-sel-due', '#pg-sel-none', '#pg-serial'].forEach(sel => { q(sel).disabled = run.active; });
  q('#pg-stop').hidden = !run.active;
  q('#pg-run').hidden = run.active;
  const jobs = summarize();
  q('#pg-run').disabled = busy || !!other || !conn.connected || !jobs.length;
  q('#pg-run').title = !conn.connected ? T18('Erst mit einer Schnittstelle verbinden')
    : other ? T18('Bitte warten — es läuft noch: {0}', other) : '';
}

function renderAll() {
  if (!overlay) return;
  renderRows();
  syncControls();
}

function appendLog(level, message) {
  if (!overlay) return;
  const log = q('#pg-log');
  const line = document.createElement('div');
  line.className = 'log-line ' + (level || 'info');
  line.textContent = new Date().toLocaleTimeString(T18('de-DE')) + '  ' + message;
  log.appendChild(line);
  while (log.childElementCount > 300) log.firstElementChild.remove();
  log.scrollTop = log.scrollHeight;
}

function setActivity(cls, text, time = '') {
  if (!overlay) return;
  q('#pg-activity').className = 'ovl-activity ' + cls;
  q('#pg-activity .act-text').textContent = text;
  q('#pg-activity .act-time').textContent = time;
}

/* ---------- Schnittstelle ---------- */

function refreshStatus() {
  return B.bus.status().then(applyStatus).catch(() => {});
}

function applyStatus(st) {
  conn.status = st;
  conn.connected = !!st.connected;
  conn.linkAddress = st.linkAddress || '';
  if (st.interfaceAddress !== undefined) conn.interfaceAddress = st.interfaceAddress || '';
  const c = st.connection || {};
  // Im Inbetriebnahme-Fenster verbunden: auch dann lässt sich nach einem Abriss neu verbinden
  if (conn.connected && c.mode !== 'routing' && c.host && (!conn.last || conn.last.host !== c.host))
    conn.last = { mode: 'tunneling', host: c.host, port: c.port, nat: !!c.nat };
  if (!overlay) return;
  const tag = q('#pg-state');
  tag.textContent = conn.connected
    ? (conn.linkAddress ? T18('verbunden als {0}', conn.linkAddress) : T18('verbunden'))
    : T18('nicht verbunden');
  tag.classList.toggle('ok', conn.connected);
  q('#pg-conn-info').textContent = conn.connected
    ? (c.mode === 'routing' ? T18('Routing über {0}', c.multicast || '224.0.23.12')
      : c.host ? T18('Tunneling zu {0}', `${c.host}:${c.port}${c.nat ? ' (NAT)' : ''}`)
        + (conn.interfaceAddress ? ' — ' + T18('Schnittstelle {0}', conn.interfaceAddress) : '') : '')
    : (st.reason ? T18('Zuletzt getrennt: {0}', st.reason) : '');
  syncControls();
}

function remembered() {
  try { return JSON.parse(localStorage.getItem(IFACE_KEY) || 'null'); } catch (e) { return null; }
}

function fillServers() {
  const keep = remembered();
  q('#pg-server').innerHTML = conn.servers.length
    ? conn.servers.map((s, i) =>
        `<option value="${i}">${esc(s.name)} — ${esc(s.host)}:${s.port} (${esc(s.address)})</option>`).join('')
    : `<option value="">${T18('— nichts gefunden —')}</option>`;
  // Die zuletzt benutzte Schnittstelle vorwählen
  const i = keep ? conn.servers.findIndex(s => s.host === keep.host && s.port === keep.port) : -1;
  if (i >= 0) q('#pg-server').value = String(i);
}

/* Kurze Verbindungsvorgänge: belegen den Busthread wie alles andere. */
async function connOp(btn, busyText, label, quiet, fn) {
  const release = BUS.lock(label);
  if (!release) { A.warn(T18('Bitte warten — es läuft noch: {0}', BUS.busy())); return; }
  const text = btn.textContent;
  conn.busy = true;
  btn.dataset.busy = '1';
  btn.textContent = busyText;
  setActivity('running', label + ' …');
  syncControls();
  try {
    const o = await fn();
    setActivity(o.level, o.message);
    if (o.level !== 'ok' && !quiet) A.warn(o.message);
  } catch (e) {
    const msg = T18('{0} fehlgeschlagen: {1}', label, e.message);
    setActivity('error', msg);
    appendLog('error', msg);
    if (!quiet) A.warn(msg);
  } finally {
    conn.busy = false;
    btn.dataset.busy = '';
    btn.textContent = text;
    release();
    syncControls();
  }
}

function discover(quiet) {
  return connOp(q('#pg-discover'), T18('Sucht …'), T18('Schnittstellen suchen'), quiet, async () => {
    q('#pg-server').innerHTML = `<option value="">${T18('— wird gesucht —')}</option>`;
    try {
      conn.servers = (await B.bus.discover(3)).servers || [];
    } catch (e) {
      conn.servers = [];
      throw e;
    } finally {
      fillServers();
    }
    const n = conn.servers.length;
    return n
      ? { level: 'ok', message: n === 1 ? T18('1 Schnittstelle gefunden') : T18('{0} Schnittstellen gefunden', n) }
      : { level: 'warn', message: T18('Keine KNXnet/IP-Schnittstelle gefunden — Netzwerk und Firewall prüfen') };
  });
}

function connect() {
  const s = conn.servers[+q('#pg-server').value];
  if (!s) { A.warn(T18('Bitte zuerst eine Schnittstelle suchen und auswählen.')); return; }
  // Adresse und Seriennummer der Schnittstelle braucht der Dienst, um sie selbst als Ziel zu erkennen
  const opts = { mode: 'tunneling', host: s.host, port: s.port, nat: q('#pg-nat').checked,
                 deviceAddress: s.address, deviceSerial: s.serial };
  connOp(q('#pg-connect'), T18('Verbindet …'), T18('Verbinden mit {0}', s.host), false, async () => {
    applyStatus(await B.bus.connect(opts));
    if (!conn.connected) return { level: 'warn', message: T18('Verbindung kam nicht zustande') };
    conn.last = opts;
    try { localStorage.setItem(IFACE_KEY, JSON.stringify({ host: s.host, port: s.port })); } catch (e) { /* nur Komfort */ }
    return { level: 'ok', message: conn.linkAddress ? T18('Verbunden als {0}', conn.linkAddress) : T18('Verbunden') };
  });
}

function disconnect() {
  connOp(q('#pg-disconnect'), T18('Trennt …'), T18('Trennen'), false, async () => {
    applyStatus(await B.bus.disconnect());
    return { level: 'ok', message: T18('Verbindung getrennt') };
  });
}

/* Nach einem Abriss, meist weil die Schnittstelle selbst neu gestartet ist: neu suchen — sie
   kann eine neue Adresse haben — und wieder verbinden. Das dauert, bis sie wieder antwortet. */
async function reconnect() {
  const last = conn.last;
  if (!last) return false;
  for (let attempt = 0; attempt < 3 && !run.cancel; attempt++) {
    run.step = T18('Verbindung wird neu aufgebaut …');
    tick();
    if (attempt) await sleep(3000);
    try {
      const servers = (await B.bus.discover(3)).servers || [];
      const s = servers.find(x => x.host === last.host && x.port === last.port)
        || (last.deviceSerial && servers.find(x => x.serial === last.deviceSerial));
      if (s) {
        conn.servers = servers;
        fillServers();
        Object.assign(last, { host: s.host, port: s.port, deviceAddress: s.address, deviceSerial: s.serial });
      }
      applyStatus(await B.bus.connect(last));
      if (conn.connected) {
        appendLog('info', conn.linkAddress ? T18('Wieder verbunden als {0}', conn.linkAddress) : T18('Wieder verbunden'));
        return true;
      }
    } catch (e) {
      appendLog('warn', T18('Neu verbinden fehlgeschlagen: {0}', e.message));
    }
  }
  return false;
}

/* ============================================================
   Durchgang
   ============================================================ */

/* Ist dieses Gerät die Schnittstelle, über die verbunden ist? Dann startet sie
   beim Programmieren neu, und die Verbindung bricht ab. */
function isInterface(j) {
  const serial = conn.last && KNX.normSerial(conn.last.deviceSerial);
  return (!!conn.interfaceAddress && j.pa === conn.interfaceAddress) || (!!serial && j.dev.serial === serial);
}

async function start() {
  if (run.active) return;
  const jobs = jobsFromPick();
  if (!jobs.length) { A.warn(T18('Nichts gewählt.')); return; }
  if (!conn.connected) { A.warn(T18('Bitte zuerst mit einer Schnittstelle verbinden.')); return; }
  if (BUS.busy()) { A.warn(T18('Bitte warten — es läuft noch: {0}', BUS.busy())); return; }
  // Secure-Geräte geben ohne entsperrte Schlüsselablage nichts preis
  const S = window.KNXSecure;
  if (S && jobs.some(j => S.relevant(j.dev) && j.ops.some(o => o.op !== 'pa'))) {
    if (!(await S.ensureUnlocked())) return;
  }
  confirmRun(jobs);
}

function confirmRun(jobs) {
  const n = { button: 0, serial: 0, dl: 0, unload: 0, reset: 0 };
  jobs.forEach(j => j.ops.forEach(o => {
    if (o.op === 'pa') n[o.serial ? 'serial' : 'button']++;
    else if (o.op === 'dl') n[o.kind === 'unload' ? 'unload' : 'dl']++;
    else n.reset++;
  }));
  const li = (count, label) => count ? `<li class="ok"><b>${count}</b><span>${label}</span></li>` : '';
  const iface = jobs.filter(isInterface);
  const noPa = jobs.filter(j => j.state.pa === 'due' && !j.ops.some(o => o.op === 'pa') && j.ops.some(o => o.op !== 'reset'));
  const names = list => list.map(j => `„${esc(j.dev.name)}“ (${esc(j.pa)})`).join(', ');

  A.openModal(jobs.length === 1 ? T18('Gerät programmieren?') : T18('{0} Geräte programmieren?', jobs.length), `
    <ul class="issue-list">
      ${li(n.button, T18('Adressen per Programmiertaste'))}
      ${li(n.serial, T18('Adressen per Seriennummer'))}
      ${li(n.dl, T18('Downloads: Applikation, Parameter, Gruppenadressen'))}
      ${li(n.unload, T18('Applikationen entladen'))}
      ${li(n.reset, T18('Werkszustand herstellen'))}
    </ul>
    ${n.button ? `<p class="hint">${T18('Zuerst werden die Adressen vergeben. Das Fenster nennt dabei nacheinander das Gerät, an dem die Programmiertaste zu drücken ist.')}</p>` : ''}
    ${n.dl + n.unload + n.reset ? `<p class="hint">${T18('Die Downloads laufen danach ohne weiteres Zutun. Die Geräte sind währenddessen ohne Funktion.')}</p>` : ''}
    ${n.reset ? `<p class="hint warn">${T18('Der Werkszustand löscht die geladene Applikation. Das Gerät muss danach vollständig neu programmiert werden.')}</p>` : ''}
    ${iface.length ? `<p class="hint warn">${T18('{0} ist die verbundene Schnittstelle. Sie kommt zuletzt an die Reihe; bricht die Verbindung dabei ab, wird sie neu aufgebaut.', names(iface))}</p>` : ''}
    ${noPa.length ? `<p class="hint warn">${T18('Bei {0} ist die Adresse nicht als vergeben vermerkt, aber nicht gewählt — geladen wird an die Adresse aus dem Projekt.', names(noPa))}</p>` : ''}
  `, () => { execute(jobs); });
}

function setRow(j, phase, text, pct = null) {
  run.rows.set(j.dev.id, { phase, text, pct });
  paintRow(j.dev.id);
}

function tick() {
  if (!run.active) return;
  const clock = fmtClock(Date.now() - run.started);
  setActivity('running', T18('Programmieren') + ' … ' + run.label + (run.step ? ' — ' + run.step : ''), clock);
  $('#btn-prog').title = T18('Läuft: {0} ({1})', T18('Programmieren'), clock);
  FB.setTitleBadge('⏳');
}
const fmtClock = ms => {
  const s = Math.floor(ms / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};

async function execute(jobs) {
  const release = BUS.lock(T18('Programmieren'));
  if (!release) { A.warn(T18('Bitte warten — es läuft noch: {0}', BUS.busy())); return; }
  FB.unlockAudio();
  Object.assign(run, { active: true, cancel: false, skip: false, force: '', job: null, onJob: null,
                       rows: new Map(), ids: new Set(jobs.map(j => j.dev.id)), release,
                       started: Date.now(), label: '', step: '' });
  jobs.forEach(j => run.rows.set(j.dev.id, { phase: 'wait', text: T18('wartet'), pct: null }));
  $('#btn-prog').dataset.busy = '1';
  q('#pg-stop').disabled = false;
  q('#pg-stop').textContent = T18('Abbrechen');
  run.timer = setInterval(tick, 1000);
  tick();
  renderAll();

  const S = window.KNXSecure;
  if (S && S.available()) { try { await S.refresh(); } catch (e) { /* dann meldet es der Plan */ } }

  /* Adressen zuerst — das ist die Runde durch die Anlage von Taste zu Taste —,
     danach die Downloads ohne Zutun. Die Schnittstelle selbst kommt zum Schluss,
     weil die Verbindung bei ihrem Neustart abreißt. */
  const normal = jobs.filter(j => !isInterface(j)), last = jobs.filter(isInterface);
  const steps = [
    ...normal.flatMap(j => j.ops.filter(o => o.op === 'pa').map(o => [j, o])),
    ...normal.flatMap(j => j.ops.filter(o => o.op !== 'pa').map(o => [j, o])),
    ...last.flatMap(j => j.ops.map(o => [j, o]))
  ];
  let aborted = '';
  for (const [j, o] of steps) {
    if (run.cancel) { aborted = T18('abgebrochen'); break; }
    if (j.failed || j.skipped) continue;
    if (!conn.connected && !(await reconnect())) { aborted = T18('Verbindung verloren'); break; }
    run.label = `${j.pa} „${j.dev.name}“`;
    run.step = '';
    tick();
    try {
      // Adressen ändern sich mit jeder Vergabe — die Secure-Schlüssel werden vor jedem Schritt neu zugeordnet
      if (S && S.available()) {
        try { await S.bindForBus(); } catch (e) { appendLog('warn', T18('Secure-Schlüssel nicht zugeordnet: {0}', e.message)); }
      }
      if (o.op === 'pa') await opAssign(j, o);
      else if (o.op === 'dl') await opDownload(j, o);
      else await opReset(j, o);
      if (j.skipped) continue;
      j.left--;
      if (j.left) setRow(j, 'wait', T18('Adresse vergeben, Download folgt'));
      else setRow(j, j.warned ? 'warn' : 'done', j.doneText || T18('fertig'));
    } catch (e) {
      if (e === CANCELLED) { aborted = T18('abgebrochen'); break; }
      j.failed = true;
      setRow(j, 'fail', e.message);
      appendLog('error', `${j.pa} ${j.dev.name}: ${e.message}`);
      await refreshStatus();
    }
  }
  jobs.forEach(j => {
    const r = run.rows.get(j.dev.id);
    if (r.phase === 'wait' || r.phase === 'run') setRow(j, 'skip', aborted || T18('nicht ausgeführt'));
  });
  finishRun(jobs, aborted);
}

function finishRun(jobs, aborted) {
  clearInterval(run.timer);
  hidePrompt();
  const ms = Date.now() - run.started;
  const count = ph => jobs.filter(j => ph.includes(run.rows.get(j.dev.id).phase)).length;
  const done = count(['done', 'warn']), failed = count(['fail']), skipped = count(['skip']), warned = count(['warn']);
  const level = failed ? 'error' : (aborted || skipped || warned) ? 'warn' : 'ok';
  const msg = [jobs.length === 1 && done ? T18('„{0}“ programmiert', jobs[0].dev.name)
                 : T18('{0} von {1} Geräten programmiert', done, jobs.length),
               failed && T18('{0} fehlgeschlagen', failed),
               skipped && T18('{0} nicht ausgeführt', skipped),
               warned && T18('mit Hinweisen im Protokoll')].filter(Boolean).join(' · ');
  const took = ms >= 1000 ? (ms < 60000 ? Math.round(ms / 1000) + ' s' : fmtClock(ms) + ' min') : '';
  setActivity(level, msg, took && T18('Dauer {0}', took));
  appendLog(level === 'ok' ? 'info' : level, msg + (took ? ` (${took})` : ''));
  level === 'ok' ? A.toast(msg, 3000) : A.warn(msg);

  const away = FB.isAway();
  FB.setTitleBadge(away ? { ok: '✓', warn: '⚠', error: '✕' }[level] : '');
  if (away || ms >= 4000 || level === 'error') FB.chime(level);
  if (away) {
    const head = T18({ ok: 'Fertig', warn: 'Beendet mit Hinweis', error: 'Fehlgeschlagen' }[level]);
    FB.desktopNotify(head + ': ' + T18('Programmieren'), msg, level, openOverlay);
  }

  // Was geklappt hat, folgt wieder dem Programmierstand
  jobs.forEach(j => { if (['done', 'warn'].includes(run.rows.get(j.dev.id).phase)) pick.delete(j.dev.id); });
  const release = run.release;
  Object.assign(run, { active: false, job: null, onJob: null, release: null, label: '', step: '' });
  $('#btn-prog').dataset.busy = '';
  release();
  if (langStale) rebuildForLanguage();
  refresh();
  renderAll();
}

function cancel() {
  if (!run.active) return;
  run.cancel = true;
  q('#pg-stop').disabled = true;
  q('#pg-stop').textContent = T18('Wird abgebrochen …');
  promptDetail(T18('Wird abgebrochen …'));
  if (run.job) B.bus.cancelJob(run.job).catch(e => appendLog('warn', T18('Abbrechen nicht möglich: {0}', e.message)));
}

/* ---------- Programmiertaste ---------- */

function showPrompt(j) {
  if (!overlay.classList.contains('open')) openOverlay();
  q('#pg-prompt').hidden = false;
  q('#pg-prompt .pg-prompt-title').textContent =
    T18('Programmiertaste drücken: „{0}“ — bekommt {1}', j.dev.name, j.pa);
  q('#pg-force').hidden = true;
  promptDetail(T18('Noch kein Gerät im Programmiermodus …'));
}
function promptDetail(text) {
  if (overlay) q('#pg-prompt .pg-prompt-detail').textContent = text;
}
function hidePrompt() {
  if (overlay) q('#pg-prompt').hidden = true;
}

/**
 * Wartet, bis genau ein Gerät im Programmiermodus ist. Liefert false, wenn der
 * Nutzer überspringt. Ein Gerät, das laut Projekt schon eine andere Adresse
 * hat, ist vermutlich das falsche — dann wird erst nach Rückfrage vergeben.
 */
async function waitForButton(j) {
  showPrompt(j);
  FB.chime('warn');
  if (FB.isAway()) FB.desktopNotify(T18('Programmiertaste drücken'), `${j.dev.name} (${j.pa})`, 'warn', openOverlay);
  run.skip = false;
  run.force = '';
  try {
    for (;;) {
      if (run.cancel) throw CANCELLED;
      if (run.skip) return false;
      let list = [];
      try {
        list = (await B.bus.progModeList()).devices || [];
      } catch (e) {
        if (!conn.connected) throw e;
        promptDetail(T18('Abfrage fehlgeschlagen: {0}', e.message));
      }
      if (run.cancel) throw CANCELLED;
      if (run.skip) return false;
      if (list.length === 1) {
        const other = KNX.project().devices.find(d => d !== j.dev && KNX.paStr(d.addr) === list[0]
          && d.loaded && d.loaded.pa === d.addr);
        const own = j.dev.loaded && KNX.paStr(j.dev.loaded.pa || 0) === list[0];
        if (!other || own || run.force === list[0]) return true;
        promptDetail(T18('Im Programmiermodus ist {0} — das ist „{1}“. Falsches Gerät? Dort die Taste erneut drücken und hier die richtige.', list[0], other.name));
        q('#pg-force').hidden = false;
        q('#pg-force').dataset.pa = list[0];
      } else {
        q('#pg-force').hidden = true;
        promptDetail(list.length
          ? T18('{0} Geräte im Programmiermodus ({1}) — es darf nur eines sein.', list.length, list.join(', '))
          : T18('Noch kein Gerät im Programmiermodus …'));
      }
      await sleep(700);
    }
  } finally {
    hidePrompt();
  }
}

/* ---------- Schritte ---------- */

/* Programmiert die Schnittstelle sich selbst um, reißt die Verbindung ab. Die Schleife verbindet neu. */
function linkCheck(r, j) {
  if (!r || !r.linkLost) return;
  conn.connected = false;
  j.warned = true;
  appendLog('warn', r.message || T18('Verbindung verloren'));
  refreshStatus();
}

async function opAssign(j, o) {
  let r;
  if (o.serial) {
    run.step = T18('Adresse per Seriennummer');
    setRow(j, 'run', T18('Adresse {0} per Seriennummer …', j.pa));
    r = await B.bus.assign({ address: j.pa, serial: j.dev.serial });
  } else {
    setRow(j, 'run', T18('wartet auf die Programmiertaste'));
    run.step = T18('wartet auf die Programmiertaste');
    tick();
    if (!(await waitForButton(j))) {
      j.skipped = true;
      setRow(j, 'skip', T18('übersprungen'));
      return;
    }
    run.step = T18('Adresse wird vergeben');
    setRow(j, 'run', T18('Adresse {0} wird vergeben …', j.pa));
    r = await B.bus.assign({ address: j.pa });
  }
  linkCheck(r, j);
  // Bricht die Verbindung ab, hat sich meist die Schnittstelle selbst umadressiert — die Vergabe gilt
  if (!r.ok && !r.linkLost) throw new Error(r.message || T18('Adresse nicht vergeben'));
  record(j.dev, { pa: j.addr });
  j.doneText = T18('Adresse vergeben');
  appendLog('info', r.message || T18('Adresse {0} ist vergeben', j.pa));
}

async function opDownload(j, o) {
  const dev = j.dev, item = itemOf(dev);
  if (!item) throw new Error(T18('Kein Produkt zugeordnet'));
  if (KNX.deviceCanIp(dev) && KNX.ensureTunnelAddrs(dev)) {
    A.commit();
    appendLog('info', T18('Tunneladressen für {0}: {1}', dev.name, KNX.tunnelAddrs(dev).map(KNX.paStr).join(', ')));
  }
  // Vermerkt wird der Stand, der geladen wird — nicht, was währenddessen geändert wird
  const fp = fingerprint(dev);
  const S = window.KNXSecure;
  const secure = S && S.available() ? (S.known() || { unlocked: false, loading: true }) : null;
  let plan;
  try {
    plan = KNXDownload.plan(KNX.project(), dev, item, { kind: o.kind, secure });
  } catch (e) {
    throw new Error(T18('Plan nicht berechenbar: {0}', e.message));
  }
  if (plan.errors.length) throw new Error(plan.errors[0]);
  plan.warnings.forEach(w => appendLog('warn', `${j.pa}: ${w}`));

  const what = kindLabel(o.kind, dev);
  run.step = what;
  setRow(j, 'run', what + ' …', 0);
  run.onJob = e => {
    const d = e.detail;
    if (!d || !d.total) return;
    run.step = `${what} ${d.step}/${d.total}`;
    setRow(j, 'run', `${d.step}/${d.total} ${d.label}`, Math.round(d.step / d.total * 100));
  };
  const r = await B.bus.download({ address: j.pa, label: `${what} ${j.pa}`, steps: plan.steps });
  run.job = r.job;
  let s;
  try {
    s = await pollJob(r.job);
  } finally {
    run.job = null;
    run.onJob = null;
  }
  if (s.state === 'abgebrochen') {
    j.failed = true;
    setRow(j, 'fail', T18('abgebrochen — das Gerät ist unvollständig geladen'));
    throw CANCELLED;
  }
  const res = s.result || {};
  (res.notes || []).forEach(n => { appendLog('warn', `${j.pa}: ${n}`); j.warned = true; });
  if (o.kind === 'unload') forget(dev, ['app', 'par', 'grp']);
  else record(dev, { pa: j.addr, fp, parts: KNXDownload.kindParts(o.kind) });
  j.doneText = o.kind === 'unload' ? T18('entladen')
    : T18('programmiert') + (res.seconds ? ` · ${res.seconds} s` : '');
  if (res.linkLost) linkCheck({ linkLost: true, message: res.message }, j);
}

async function opReset(j, o) {
  run.step = T18('Werkszustand');
  setRow(j, 'run', T18('Werkszustand wird hergestellt …'));
  const r = await B.bus.restart({ address: j.pa, eraseCode: o.code });
  // Unbestätigt kann er trotzdem ausgeführt sein — dann lieber neu laden als falsch vermerken
  forget(j.dev, ERASES[o.code]);
  linkCheck(r, j);
  if (r.ok === false) { j.warned = true; appendLog('warn', r.message); }
  j.doneText = T18('zurückgesetzt');
}

function pollJob(id) {
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const s = await B.bus.job(id);
        if (s.state === 'fertig' || s.state === 'abgebrochen') { resolve(s); return; }
        if (s.state === 'fehler') { reject(new Error(s.error || T18('unbekannter Fehler'))); return; }
        setTimeout(poll, 700);
      } catch (e) { reject(e); }
    };
    setTimeout(poll, 500);
  });
}

/* ---------- Öffnen und Schließen ---------- */

/**
 * Öffnet das Fenster. opts.devices: nur diese Geräte wählen — aus dem Baum,
 * dem Gerätedetail oder dem Kontextmenü. Ohne Angabe ist alles Ausstehende
 * gewählt; opts.keep lässt Auswahl und letzte Ergebnisse stehen.
 */
async function open(opts = {}) {
  if (langStale) rebuildForLanguage();
  ensureOverlay();
  if (!run.active && !opts.keep) {
    pick.clear();
    if (opts.devices) {
      const want = new Set(opts.devices);
      KNX.project().devices.forEach(d => {
        if (!want.has(d.id)) pick.set(d.id, { on: false, mode: 'prog', parts: new Set(), auto: false });
        else pick.set(d.id, defaultPick(d, true));
      });
      view.show = opts.devices.every(id => isDue(KNX.deviceById(id))) ? 'due' : 'all';
      overlay.querySelector(`input[name="pg-show"][value="${view.show}"]`).checked = true;
    }
    run.rows = new Map();
    run.ids = new Set();
  }
  if (window.KNXSecure && KNXSecure.available()) KNXSecure.refresh();
  overlay.classList.add('open');
  renderAll();
  const first = q('#pg-rows tr.pg-row.on');
  if (first) first.scrollIntoView({ block: 'nearest' });
  if (!run.active) {
    try { applyStatus(await B.bus.status()); } catch (e) { appendLog('warn', T18('Status nicht lesbar: {0}', e.message)); }
    // Beim ersten Öffnen gleich suchen — das ist fast immer der erste Schritt
    if (!conn.connected && !conn.searched && !BUS.busy()) {
      conn.searched = true;
      discover(true);
    }
  }
}
const openOverlay = () => open({ keep: true });

function closeOverlay() {
  overlay.classList.remove('open');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && overlay && overlay.classList.contains('open')
      && !$('#modal-backdrop').classList.contains('open')) {
    closeOverlay();
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !run.active && !BUS.busy()) FB.setTitleBadge('');
});

$('#btn-prog').addEventListener('click', () => open());
if (window.KNXSecure) KNXSecure.onChange(() => { if (overlay && !run.active) renderAll(); });

window.KNXProg = {
  available: true,
  open, refresh, state, isDue, badge, deviceSection, fingerprint, record, forget, ERASES, UNLOADS
};

})();
