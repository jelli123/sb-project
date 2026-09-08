/* ============================================================
   KNX-Struktur — Funktionen, die den lokalen Dienst voraussetzen:
   Projektverwaltung auf dem PC und Inbetriebnahme am Bus.
   Ohne laufenden Dienst bleiben die Knoepfe ausgeblendet.
   ============================================================ */
'use strict';

(() => {

const A = window.KNXApp, $ = s => document.querySelector(s);
const esc = A.esc;
const B = window.KNXBackend;

if (!B) { window.KNXBus = { available: false }; return; }

$('#btn-projects').hidden = false;
$('#btn-bus').hidden = false;

/* ============================================================
   Projektverwaltung
   ============================================================ */

async function openProjects() {
  let list = [];
  try {
    list = await B.listProjects();
  } catch (e) {
    A.warn('Projektliste nicht lesbar: ' + e.message);
    return;
  }
  const rows = list.map(p => `
    <tr${p.id === B.projectId ? ' class="current"' : ''}>
      <td>${esc(p.id)}${p.id === B.projectId ? ' <span class="dpt-tag">geoeffnet</span>' : ''}</td>
      <td class="num">${(p.bytes / 1024).toFixed(0)} KiB</td>
      <td>${new Date(p.modified).toLocaleString('de-DE')}</td>
      <td class="col-act">
        <button class="btn btn-sm" data-open="${esc(p.id)}"${p.id === B.projectId ? ' disabled' : ''}>Oeffnen</button>
        <button class="btn btn-sm btn-danger" data-del="${esc(p.id)}"${p.id === B.projectId ? ' disabled' : ''}>Loeschen</button>
      </td>
    </tr>`).join('');

  A.openModal('Projekte auf diesem Rechner', `
    <p class="hint">Ablage: <code>${esc(B.info.dataDir)}</code></p>
    <table class="ga mini"><thead><tr>
      <th>Name</th><th class="num">Groesse</th><th>Zuletzt geaendert</th><th></th>
    </tr></thead><tbody>${rows || '<tr><td colspan="4">Noch keine Projekte</td></tr>'}</tbody></table>
    <label class="field"><span>Neues Projekt</span>
      <input class="input" id="m-newproj" maxlength="60" placeholder="Name der Projektdatei">
    </label>
  `, () => {
    const name = $('#m-newproj').value.trim();
    if (!name) return;
    createProject(name);
  });

  $('#modal-body').querySelectorAll('[data-open]').forEach(b =>
    b.onclick = () => { A.closeModal(); switchProject(b.dataset.open); });
  $('#modal-body').querySelectorAll('[data-del]').forEach(b =>
    b.onclick = () => deleteProject(b.dataset.del, b));
}

async function switchProject(id) {
  try {
    B.flush();
    const doc = await B.readProject(id);
    B.projectId = id;
    await B.writeSettings({ current: id });
    KNX.setProject(doc);
    A.resetHistory();
    location.reload();
  } catch (e) {
    A.warn('Projekt nicht ladbar: ' + e.message);
  }
}

async function createProject(name) {
  try {
    const existing = await B.listProjects();
    if (existing.some(p => p.id === name)) { A.warn('Es gibt schon ein Projekt namens ' + name); return; }
    await B.writeProject(name, JSON.stringify(KNX.project()));
    await B.writeSettings({ current: name });
    B.projectId = name;
    A.toast('Projekt „' + name + '“ angelegt');
    location.reload();
  } catch (e) {
    A.warn('Anlegen fehlgeschlagen: ' + e.message);
  }
}

async function deleteProject(id, btn) {
  try {
    await B.deleteProject(id);
    btn.closest('tr').remove();
    A.toast('Projekt „' + id + '“ geloescht');
  } catch (e) {
    A.warn('Loeschen fehlgeschlagen: ' + e.message);
  }
}

/* ============================================================
   Inbetriebnahme
   ============================================================ */

const bus = { connected: false, scanJob: null, servers: [], lastScan: [] };
let overlay = null;

const q = sel => overlay.querySelector(sel);
const setBusy = (el, on) => { el.disabled = on; el.dataset.busy = on ? '1' : ''; };

function ensureOverlay() {
  if (overlay) return;
  overlay = document.createElement('div');
  overlay.id = 'bus-overlay';
  overlay.innerHTML = `
    <div class="ovl-card" role="dialog" aria-modal="true" aria-label="Inbetriebnahme">
      <header class="ovl-head">
        <h2>Inbetriebnahme</h2>
        <span id="bus-state" class="dpt-tag">nicht verbunden</span>
        <div class="spacer"></div>
        <button id="bus-close" class="btn" title="Schliessen">Schliessen</button>
      </header>

      <div class="ovl-body">
        <section class="ovl-sec">
          <h3>1 · Schnittstelle</h3>
          <div class="row">
            <button id="bus-discover" class="btn btn-sm">Suchen</button>
            <select id="bus-server" class="select"><option value="">— noch nicht gesucht —</option></select>
            <label class="chk"><input type="checkbox" id="bus-nat"> NAT</label>
            <button id="bus-connect" class="btn btn-sm btn-primary" disabled>Verbinden</button>
            <button id="bus-disconnect" class="btn btn-sm" disabled>Trennen</button>
          </div>
          <div class="row">
            <label class="chk"><input type="radio" name="bus-mode" value="tunneling" checked> Tunneling</label>
            <label class="chk"><input type="radio" name="bus-mode" value="routing"> Routing (Multicast)</label>
            <select id="bus-nic" class="select" hidden></select>
            <input id="bus-own" class="input narrow" hidden placeholder="15.15.250" title="Eigene Adresse beim Routing">
          </div>
          <p class="hint" id="bus-conn-info">Tunneling ist fuer Managementprozeduren die richtige Wahl.
             Routing eignet sich zum Mithoeren, nicht zum Programmieren.</p>
        </section>

        <section class="ovl-sec">
          <h3>2 · Busscan</h3>
          <div class="row">
            <select id="bus-line" class="select"></select>
            <button id="bus-scan" class="btn btn-sm btn-primary" disabled>Linie scannen</button>
            <button id="bus-scan-stop" class="btn btn-sm" disabled>Abbrechen</button>
            <span id="bus-scan-info" class="pane-meta"></span>
          </div>
          <div class="ovl-table-wrap">
            <table class="ga mini"><thead><tr>
              <th>Adresse</th><th>Maske</th><th>Profil</th><th>Im Projekt</th><th></th>
            </tr></thead><tbody id="bus-scan-rows"></tbody></table>
          </div>
        </section>

        <section class="ovl-sec">
          <h3>3 · Geraet auslesen</h3>
          <div class="row">
            <input id="bus-addr" class="input narrow" placeholder="1.1.5" value="1.1.1">
            <button id="bus-read" class="btn btn-sm" disabled>Auslesen</button>
            <button id="bus-occupied" class="btn btn-sm" disabled>Adresse belegt?</button>
          </div>
          <div id="bus-device"></div>
        </section>

        <section class="ovl-sec">
          <h3>4 · Physikalische Adresse vergeben</h3>
          <div class="row">
            <button id="bus-prog-list" class="btn btn-sm" disabled>Geraete im Programmiermodus</button>
            <span id="bus-prog-info" class="pane-meta"></span>
          </div>
          <div class="row">
            <select id="bus-target" class="select"></select>
            <input id="bus-target-manual" class="input narrow" placeholder="1.1.5">
            <button id="bus-assign" class="btn btn-sm btn-primary" disabled>Vergeben</button>
          </div>
          <div class="row">
            <input id="bus-serial" class="input" placeholder="Seriennummer, 6 Byte hex — optional">
            <button id="bus-assign-serial" class="btn btn-sm" disabled>Per Seriennummer vergeben</button>
          </div>
          <p class="hint">Ohne Seriennummer muss genau ein Geraet im Programmiermodus sein.
             Der Dienst prueft das und bricht sonst ab.</p>
        </section>

        <section class="ovl-sec danger">
          <h3>5 · Neustart und Entladen</h3>
          <div class="row">
            <input id="bus-rst-addr" class="input narrow" placeholder="1.1.5">
            <select id="bus-erase" class="select">
              <option value="">Einfacher Neustart</option>
              <option value="ConfirmedRestart">Bestaetigter Neustart</option>
              <option value="ResetApplicationProgram">Applikationsprogramm zuruecksetzen</option>
              <option value="ResetApplicationParameters">Applikationsparameter zuruecksetzen</option>
              <option value="ResetLinks">Verknuepfungen zuruecksetzen</option>
              <option value="ResetIndividualAddress">Physikalische Adresse zuruecksetzen</option>
              <option value="FactoryResetWithoutIndividualAddress">Werkszustand, Adresse behalten</option>
              <option value="FactoryReset">Werkszustand vollstaendig</option>
            </select>
            <button id="bus-restart" class="btn btn-sm btn-danger" disabled>Ausfuehren</button>
          </div>
          <div class="row">
            <input id="bus-unload-idx" class="input narrow" value="3" title="Index des Interface-Objekts">
            <button id="bus-unload" class="btn btn-sm btn-danger" disabled>Objekt entladen</button>
            <button id="bus-loadstate" class="btn btn-sm" disabled>Ladezustand lesen</button>
          </div>
          <p class="hint warn">Diese Aktionen veraendern das Geraet. Der Werkszustand loescht die
             Applikation vollstaendig — danach muss neu geladen werden.</p>
        </section>
      </div>

      <footer class="ovl-foot">
        <span class="pane-meta">Protokoll</span>
        <div id="bus-log" class="ovl-log"></div>
      </footer>
    </div>`;
  document.body.appendChild(overlay);
  wire();
}

/* ---------- Verdrahtung ---------- */

function wire() {
  q('#bus-close').onclick = closeOverlay;
  overlay.addEventListener('click', e => { if (e.target === overlay) closeOverlay(); });

  q('#bus-discover').onclick = discover;
  q('#bus-connect').onclick = connect;
  q('#bus-disconnect').onclick = disconnect;
  q('#bus-server').onchange = () => { q('#bus-connect').disabled = !q('#bus-server').value; };

  overlay.querySelectorAll('input[name="bus-mode"]').forEach(r => r.onchange = () => {
    const routing = mode() === 'routing';
    q('#bus-nic').hidden = !routing;
    q('#bus-own').hidden = !routing;
    q('#bus-server').disabled = routing;
    q('#bus-connect').disabled = routing ? false : !q('#bus-server').value;
    if (routing) loadInterfaces();
  });

  q('#bus-scan').onclick = startScan;
  q('#bus-scan-stop').onclick = stopScan;
  q('#bus-read').onclick = readDevice;
  q('#bus-occupied').onclick = checkOccupied;
  q('#bus-prog-list').onclick = listProgMode;
  q('#bus-assign').onclick = () => assign(false);
  q('#bus-assign-serial').onclick = () => assign(true);
  q('#bus-restart').onclick = restart;
  q('#bus-unload').onclick = unload;
  q('#bus-loadstate').onclick = readLoadState;

  q('#bus-target').onchange = () => {
    const v = q('#bus-target').value;
    if (v) q('#bus-target-manual').value = v;
  };

  B.events.on('log', e => appendLog(e.level, e.message));
  B.events.on('job', e => {
    if (e.id !== bus.scanJob) return;
    if (e.message) q('#bus-scan-info').textContent = e.message;
  });
}

const mode = () => overlay.querySelector('input[name="bus-mode"]:checked').value;

function appendLog(level, message) {
  const log = q('#bus-log');
  const line = document.createElement('div');
  line.className = 'log-line ' + (level || 'info');
  line.textContent = new Date().toLocaleTimeString('de-DE') + '  ' + message;
  log.appendChild(line);
  while (log.childElementCount > 200) log.firstElementChild.remove();
  log.scrollTop = log.scrollHeight;
}

/* ---------- Schnittstelle ---------- */

async function discover() {
  const btn = q('#bus-discover');
  setBusy(btn, true);
  q('#bus-server').innerHTML = '<option value="">— wird gesucht —</option>';
  try {
    const r = await B.bus.discover(3);
    bus.servers = r.servers || [];
    q('#bus-server').innerHTML = bus.servers.length
      ? bus.servers.map((s, i) =>
          `<option value="${i}">${esc(s.name)} — ${esc(s.host)}:${s.port} (${esc(s.address)})</option>`).join('')
      : '<option value="">— nichts gefunden —</option>';
    q('#bus-connect').disabled = !bus.servers.length;
    appendLog('info', bus.servers.length + ' KNXnet/IP-Server gefunden');
  } catch (e) {
    A.warn('Suche fehlgeschlagen: ' + e.message);
  } finally {
    setBusy(btn, false);
  }
}

async function loadInterfaces() {
  try {
    const r = await B.bus.interfaces();
    q('#bus-nic').innerHTML = '<option value="">Standardschnittstelle</option>' +
      (r.interfaces || []).map(n =>
        `<option value="${esc(n.name)}">${esc(n.display)} — ${esc(n.addresses.join(', '))}</option>`).join('');
  } catch (e) {
    appendLog('warn', 'Netzwerkschnittstellen nicht lesbar: ' + e.message);
  }
}

async function connect() {
  const btn = q('#bus-connect');
  setBusy(btn, true);
  try {
    let status;
    if (mode() === 'routing') {
      status = await B.bus.connect({
        mode: 'routing',
        networkInterface: q('#bus-nic').value || null,
        ownAddress: q('#bus-own').value.trim() || null
      });
    } else {
      const s = bus.servers[+q('#bus-server').value];
      if (!s) { A.warn('Bitte zuerst eine Schnittstelle waehlen.'); return; }
      status = await B.bus.connect({
        mode: 'tunneling', host: s.host, port: s.port, nat: q('#bus-nat').checked
      });
    }
    applyStatus(status);
  } catch (e) {
    A.warn('Verbindung fehlgeschlagen: ' + e.message);
    appendLog('error', e.message);
  } finally {
    setBusy(btn, false);
  }
}

async function disconnect() {
  try {
    applyStatus(await B.bus.disconnect());
    appendLog('info', 'Verbindung getrennt');
  } catch (e) {
    A.warn(e.message);
  }
}

function applyStatus(status) {
  bus.connected = !!status.connected;
  const tag = q('#bus-state');
  tag.textContent = bus.connected
    ? 'verbunden' + (status.linkAddress ? ' als ' + status.linkAddress : '')
    : 'nicht verbunden';
  tag.classList.toggle('ok', bus.connected);
  q('#bus-disconnect').disabled = !bus.connected;
  ['#bus-scan', '#bus-read', '#bus-occupied', '#bus-prog-list', '#bus-assign',
   '#bus-assign-serial', '#bus-restart', '#bus-unload', '#bus-loadstate']
    .forEach(sel => q(sel).disabled = !bus.connected);
}

/* ---------- Busscan ---------- */

function fillLines() {
  const opts = [];
  KNX.project().areas.forEach(a => (a.lines || []).forEach(l => {
    opts.push(`<option value="${a.addr}.${l.addr}">${a.addr}.${l.addr} — ${esc(a.name)} / ${esc(l.name)}</option>`);
  }));
  q('#bus-line').innerHTML = opts.length ? opts.join('') : '<option value="1.1">1.1</option>';
}

function fillTargets() {
  const devs = KNX.project().devices.slice().sort((x, y) => x.addr - y.addr);
  q('#bus-target').innerHTML = '<option value="">— Adresse aus dem Projekt waehlen —</option>' +
    devs.map(d => `<option value="${KNX.paStr(d.addr)}">${KNX.paStr(d.addr)} — ${esc(d.name)}</option>`).join('');
}

async function startScan() {
  const [area, line] = q('#bus-line').value.split('.').map(Number);
  q('#bus-scan-rows').innerHTML = '';
  q('#bus-scan-info').textContent = 'laeuft …';
  setBusy(q('#bus-scan'), true);
  q('#bus-scan-stop').disabled = false;
  try {
    const r = await B.bus.scan(area, line);
    bus.scanJob = r.job;
    await pollJob(r.job, result => {
      bus.lastScan = result || [];
      renderScan(bus.lastScan);
    });
  } catch (e) {
    A.warn('Scan fehlgeschlagen: ' + e.message);
    q('#bus-scan-info').textContent = 'Fehler';
  } finally {
    setBusy(q('#bus-scan'), false);
    q('#bus-scan-stop').disabled = true;
    bus.scanJob = null;
  }
}

function stopScan() {
  if (bus.scanJob) B.bus.cancelJob(bus.scanJob).catch(() => {});
}

function pollJob(id, onDone) {
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const s = await B.bus.job(id);
        if (s.state === 'fertig') { onDone(s.result); resolve(s); return; }
        if (s.state === 'fehler') { reject(new Error(s.error || 'unbekannter Fehler')); return; }
        if (s.state === 'abgebrochen') { q('#bus-scan-info').textContent = 'abgebrochen'; resolve(s); return; }
        setTimeout(tick, 700);
      } catch (e) { reject(e); }
    };
    setTimeout(tick, 500);
  });
}

function renderScan(list) {
  const byAddr = new Map();
  KNX.project().devices.forEach(d => byAddr.set(KNX.paStr(d.addr), d));
  q('#bus-scan-info').textContent = list.length + ' Teilnehmer';
  q('#bus-scan-rows').innerHTML = list.map(d => {
    const known = byAddr.get(d.address);
    return `<tr>
      <td><b>${esc(d.address)}</b></td>
      <td>${esc(d.maskVersion || '—')}</td>
      <td>${esc(d.profile || '—')}</td>
      <td>${known ? esc(known.name) : '<span class="hint warn">nicht im Projekt</span>'}</td>
      <td class="col-act"><button class="btn btn-sm" data-read="${esc(d.address)}">Auslesen</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="5">Kein Teilnehmer geantwortet</td></tr>';

  q('#bus-scan-rows').querySelectorAll('[data-read]').forEach(b =>
    b.onclick = () => { q('#bus-addr').value = b.dataset.read; readDevice(); });
}

/* ---------- Geraet auslesen ---------- */

async function readDevice() {
  const addr = q('#bus-addr').value.trim();
  const box = q('#bus-device');
  box.innerHTML = '<p class="hint">wird gelesen …</p>';
  setBusy(q('#bus-read'), true);
  try {
    box.innerHTML = renderDevice(await B.bus.device(addr));
  } catch (e) {
    box.innerHTML = `<p class="hint warn">${esc(e.message)}</p>`;
  } finally {
    setBusy(q('#bus-read'), false);
  }
}

function renderDevice(d) {
  const rows = [];
  const add = (k, v) => { if (v !== null && v !== undefined && v !== '') rows.push([k, v]); };
  const dd = d.descriptor || {};
  add('Adresse', d.address);
  add('Maskenversion', dd.maskVersion);
  add('Profil', dd.profile);
  add('Firmware', dd.firmwareVersion === undefined ? null
    : `Typ ${dd.firmwareType}, Version ${dd.firmwareVersion}, Subcode ${dd.firmwareSubcode}`);

  const dev = d.device || {};
  add('Hersteller-Id', dev.manufacturerId);
  add('Seriennummer', dev.serialNumber);
  add('Bestellinformation', dev.orderInfo || dev.orderInfoRaw);
  add('Groesste APDU', dev.maxApduLength);
  add('PEI-Typ', dev.peiType);
  add('Beschreibung', dev.description);
  add('Programmiermodus', dev.programmingMode === undefined ? null : (dev.programmingMode ? 'ein' : 'aus'));
  if (dev.deviceControl && dev.deviceControl.length) add('Gerätesteuerung', dev.deviceControl.join(', '));
  if (dev.programVersion) {
    add('Applikation', `Hersteller ${dev.programVersion.manufacturerId}, `
      + `Typ ${dev.programVersion.deviceType}, Version ${dev.programVersion.version}`);
  }

  const app = d.applicationProgram;
  if (app) {
    add('Ladezustand', app.loadStateName + ' (Objekt ' + app.objectIndex + ')');
    add('Laufzustand', app.runStateName);
  }
  if (d.legacy) {
    add('Hinweis', d.legacy.note);
    if (d.legacy.programVersion) {
      add('Applikation (Speicher)', `Hersteller ${d.legacy.programVersion.manufacturerId}, `
        + `Typ ${d.legacy.programVersion.deviceType}, Version ${d.legacy.programVersion.version}`);
    }
    add('Laufzeitfehler', d.legacy.runError);
    add('Adresstabelle', d.legacy.addressTableEntries);
  }
  if (!d.propertyAccess) add('Properties', 'nicht unterstuetzt — Realisierungstyp 1');

  const objs = (d.interfaceObjects || [])
    .map(o => `${o.index}: ${esc(o.name)}`).join(' · ');

  return `<table class="kv">${rows.map(([k, v]) =>
      `<tr><th>${esc(k)}</th><td>${esc(String(v))}</td></tr>`).join('')}</table>`
    + (objs ? `<p class="hint">Interface-Objekte — ${objs}</p>` : '');
}

async function checkOccupied() {
  const addr = q('#bus-addr').value.trim();
  try {
    const r = await B.bus.occupied(addr);
    appendLog('info', 'Adresse ' + r.address + ' ist ' + (r.occupied ? 'belegt' : 'frei'));
    A.toast('Adresse ' + r.address + ' ist ' + (r.occupied ? 'belegt' : 'frei'));
  } catch (e) {
    A.warn(e.message);
  }
}

/* ---------- Adresse vergeben ---------- */

async function listProgMode() {
  setBusy(q('#bus-prog-list'), true);
  try {
    const r = await B.bus.progModeList();
    const list = r.devices || [];
    q('#bus-prog-info').textContent = list.length
      ? list.length + ' Geraet(e): ' + list.join(', ')
      : 'kein Geraet im Programmiermodus';
    appendLog('info', 'Programmiermodus: ' + (list.join(', ') || 'niemand'));
  } catch (e) {
    q('#bus-prog-info').textContent = e.message;
  } finally {
    setBusy(q('#bus-prog-list'), false);
  }
}

async function assign(bySerial) {
  const address = q('#bus-target-manual').value.trim() || q('#bus-target').value;
  if (!address) { A.warn('Bitte eine Zieladresse angeben.'); return; }
  const serial = q('#bus-serial').value.trim();
  if (bySerial && !serial) { A.warn('Ohne Seriennummer geht das nicht.'); return; }

  A.openModal('Adresse vergeben?', `
    <p>Dem Geraet wird die physikalische Adresse <b>${esc(address)}</b> zugewiesen
       ${bySerial ? 'anhand der Seriennummer <code>' + esc(serial) + '</code>' : 'ueber den Programmiermodus'}.</p>
    <p class="hint">Das Geraet startet anschliessend neu.</p>
  `, () => {
    doAssign(address, bySerial ? serial : null);
  });
}

async function doAssign(address, serial) {
  const btn = q(serial ? '#bus-assign-serial' : '#bus-assign');
  setBusy(btn, true);
  try {
    const r = await B.bus.assign(serial ? { address, serial } : { address });
    r.ok ? A.toast(r.message) : A.warn(r.message);
  } catch (e) {
    A.warn('Adressvergabe fehlgeschlagen: ' + e.message);
  } finally {
    setBusy(btn, false);
  }
}

/* ---------- Neustart und Entladen ---------- */

function restart() {
  const address = q('#bus-rst-addr').value.trim();
  const eraseCode = q('#bus-erase').value;
  if (!address) { A.warn('Bitte eine Adresse angeben.'); return; }
  const label = q('#bus-erase').selectedOptions[0].textContent;

  A.openModal('Wirklich ausfuehren?', `
    <p>An <b>${esc(address)}</b> wird ausgefuehrt: <b>${esc(label)}</b>.</p>
    ${eraseCode.startsWith('Factory')
      ? '<p class="hint warn">Der Werkszustand loescht die geladene Applikation. '
        + 'Das Geraet muss danach vollstaendig neu programmiert werden.</p>'
      : '<p class="hint">Das Geraet ist waehrend des Neustarts kurz nicht erreichbar.</p>'}
  `, async () => {
    try {
      const r = await B.bus.restart(eraseCode ? { address, eraseCode } : { address });
      A.toast(r.message);
    } catch (e) {
      A.warn('Fehlgeschlagen: ' + e.message);
    }
  });
}

function unload() {
  const address = q('#bus-rst-addr').value.trim();
  const objectIndex = +q('#bus-unload-idx').value || 3;
  if (!address) { A.warn('Bitte eine Adresse angeben.'); return; }

  A.openModal('Objekt entladen?', `
    <p>Interface-Objekt <b>${objectIndex}</b> an <b>${esc(address)}</b> wird entladen.
       Die zugehoerigen Daten gelten danach als ungueltig.</p>
    <p class="hint warn">Bei Objekt 3 (Applikationsprogramm) ist das Geraet anschliessend funktionslos,
       bis es neu geladen wird.</p>
  `, async () => {
    try {
      const r = await B.bus.unload({ address, objectIndex });
      r.ok ? A.toast(r.message) : A.warn(r.message);
    } catch (e) {
      A.warn('Entladen fehlgeschlagen: ' + e.message);
    }
  });
}

async function readLoadState() {
  const address = q('#bus-rst-addr').value.trim() || q('#bus-addr').value.trim();
  const objectIndex = +q('#bus-unload-idx').value || 3;
  try {
    const r = await B.bus.loadState(address, objectIndex);
    appendLog('info', address + ' Objekt ' + objectIndex + ': ' + r.loadStateName);
    A.toast('Ladezustand: ' + r.loadStateName);
  } catch (e) {
    A.warn(e.message);
  }
}

/* ---------- Oeffnen und Schliessen ---------- */

async function openOverlay() {
  ensureOverlay();
  fillLines();
  fillTargets();
  overlay.classList.add('open');
  try {
    applyStatus(await B.bus.status());
  } catch (e) {
    appendLog('warn', 'Status nicht lesbar: ' + e.message);
  }
}

function closeOverlay() {
  overlay.classList.remove('open');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && overlay && overlay.classList.contains('open')
      && !$('#modal-backdrop').classList.contains('open')) {
    closeOverlay();
  }
});

$('#btn-projects').addEventListener('click', openProjects);
$('#btn-bus').addEventListener('click', openOverlay);

window.KNXBus = { available: true, open: openOverlay, openProjects };

})();
