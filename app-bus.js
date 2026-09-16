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
   Rueckmeldung: Hinweiston, Systembenachrichtigung, Tab-Titel
   ============================================================ */

/* Kurze Vorgaenge melden sich nur per Toast; ab dieser Dauer — oder wenn das
   Fenster nicht im Vordergrund ist — kommen Ton und Benachrichtigung dazu. */
const NOTIFY_AFTER_MS = 4000;
const PREFS_KEY = 'knx-bus-notify-v1';

const prefs = (() => {
  const def = { sound: true, desktop: false };
  try { return { ...def, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; }
  catch (e) { return def; }
})();

function savePrefs(patch) {
  Object.assign(prefs, patch);
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* nur Komfort */ }
}

/* Browser geben Audio erst nach einer Nutzeraktion frei. Deshalb wird der
   Kontext beim Klick auf eine Aktion geweckt und spielt spaeter auch im Hintergrund. */
let audioCtx = null;
function unlockAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) {
    try { audioCtx = new Ctx(); } catch (e) { return null; }
  }
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

function chime(kind) {
  if (!prefs.sound) return;
  const ctx = unlockAudio();
  if (!ctx) return;
  const notes = kind === 'error' ? [[523, 0], [392, 0.16], [311, 0.32]]
              : kind === 'warn'  ? [[659, 0], [659, 0.18]]
              :                    [[659, 0], [988, 0.14]];
  const t0 = ctx.currentTime + 0.02;
  notes.forEach(([freq, dt]) => {
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0 + dt);
    gain.gain.exponentialRampToValueAtTime(0.22, t0 + dt + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0 + dt);
    osc.stop(t0 + dt + 0.4);
  });
}

const canNotify = () => 'Notification' in window && window.isSecureContext;
const isAway = () => document.visibilityState !== 'visible' || !document.hasFocus();

function desktopNotify(title, body, level) {
  if (!prefs.desktop || !canNotify() || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, {
      body, tag: 'knx-bus', renotify: true, requireInteraction: level === 'error'
    });
    n.onclick = () => { window.focus(); openOverlay(); n.close(); };
  } catch (e) {
    // Manche Browser erlauben Benachrichtigungen nur ueber einen Service Worker.
  }
}

const TITLE_BADGE = /^[⏳✓⚠✕] /;
function setTitleBadge(symbol) {
  const base = document.title.replace(TITLE_BADGE, '');
  document.title = symbol ? symbol + ' ' + base : base;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !task.current) setTitleBadge('');
});

async function toggleDesktop(e) {
  const box = e.target;
  if (!box.checked) { savePrefs({ desktop: false }); return; }
  let perm = Notification.permission;
  if (perm === 'default') {
    try { perm = await Notification.requestPermission(); } catch (err) { perm = 'denied'; }
  }
  if (perm !== 'granted') {
    box.checked = false;
    savePrefs({ desktop: false });
    A.warn('Benachrichtigungen sind im Browser blockiert. Bitte in den Website-Einstellungen fuer diese Seite erlauben.');
    return;
  }
  savePrefs({ desktop: true });
  try {
    new Notification('KNX Inbetriebnahme', {
      body: 'Benachrichtigungen sind eingeschaltet. Sie erscheinen, wenn ein Vorgang im Hintergrund endet.',
      tag: 'knx-bus'
    });
  } catch (err) { /* siehe desktopNotify */ }
}

/* ============================================================
   Inbetriebnahme
   ============================================================ */

const bus = { connected: false, connection: null, scanJob: null, progJob: null, servers: [], lastScan: [], found: [], autoSearched: false };
const task = { current: null, timer: 0 };
let overlay = null;

const q = sel => overlay.querySelector(sel);

/* Alles, was ueber den Busthread des Dienstes laeuft. Der arbeitet streng
   nacheinander — ein zweiter Klick wuerde nur unsichtbar in der Warteschlange landen. */
const BUS_ACTIONS = ['#bus-line', '#bus-scan', '#bus-read', '#bus-occupied', '#bus-prog-list',
  '#bus-target', '#bus-assign', '#bus-assign-serial', '#bus-prog-dev', '#bus-prog-kind', '#bus-program',
  '#bus-erase', '#bus-restart', '#bus-unload', '#bus-loadstate'];

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
        <label class="chk" title="Hinweiston, wenn ein längerer Vorgang endet oder fehlschlägt">
          <input type="checkbox" id="bus-sound"> Ton</label>
        <label class="chk" id="bus-desktop-wrap"
               title="Systembenachrichtigung, wenn ein Vorgang endet, während das Fenster im Hintergrund ist">
          <input type="checkbox" id="bus-desktop"> Benachrichtigung</label>
        <button id="bus-close" class="btn" title="Schließen — laufende Vorgänge laufen weiter (Esc)">Schließen</button>
      </header>

      <div id="bus-activity" class="ovl-activity" role="status" aria-live="polite">
        <span class="act-text">Bereit.</span>
        <button id="bus-reconnect" class="btn btn-sm" hidden
                title="Schnittstelle erneut suchen und verbinden">Neu verbinden</button>
        <span class="act-time"></span>
      </div>

      <div class="ovl-body">
        <section class="ovl-sec">
          <h3>1 · Schnittstelle verbinden</h3>
          <div class="row">
            <label class="chk"><input type="radio" name="bus-mode" value="tunneling" checked>
              Tunneling <span class="lbl">— zum Programmieren</span></label>
            <label class="chk"><input type="radio" name="bus-mode" value="routing">
              Routing <span class="lbl">— nur zum Mithören</span></label>
          </div>
          <div class="row" data-mode="tunneling">
            <button id="bus-discover" class="btn btn-sm">Schnittstellen suchen</button>
            <select id="bus-server" class="select" aria-label="Gefundene Schnittstelle">
              <option value="">— zuerst suchen —</option></select>
            <label class="chk" title="Nötig, wenn die Schnittstelle hinter einem Router mit Adressumsetzung liegt">
              <input type="checkbox" id="bus-nat"> NAT</label>
          </div>
          <div class="row" data-mode="routing" hidden>
            <span class="lbl">Netzwerkkarte</span>
            <select id="bus-nic" class="select"><option value="">Standardschnittstelle</option></select>
            <span class="lbl">Eigene Adresse</span>
            <input id="bus-own" class="input narrow" placeholder="15.15.250" title="Absenderadresse beim Routing">
          </div>
          <div class="row">
            <button id="bus-connect" class="btn btn-sm btn-primary">Verbinden</button>
            <button id="bus-disconnect" class="btn btn-sm" hidden>Trennen</button>
            <span id="bus-conn-info" class="pane-meta"></span>
          </div>
        </section>

        <section class="ovl-sec" data-needs-bus>
          <h3>2 · Linie scannen <span class="sec-lock">— erst verbinden</span></h3>
          <div class="row">
            <span class="lbl">Linie</span>
            <select id="bus-line" class="select"></select>
            <button id="bus-scan" class="btn btn-sm btn-primary">Linie scannen</button>
            <button id="bus-scan-stop" class="btn btn-sm" hidden>Scan abbrechen</button>
            <span id="bus-scan-info" class="pane-meta"></span>
          </div>
          <p class="hint">Fragt alle 256 Teilnehmeradressen der Linie ab und dauert einige Minuten.
             Das Fenster darf dabei geschlossen oder im Hintergrund sein.
             Ein Klick auf eine gefundene Zeile übernimmt deren Adresse in die Felder
             der Abschnitte 3 bis 6.</p>
          <div class="ovl-table-wrap">
            <table class="ga mini"><thead><tr>
              <th>Adresse</th><th>Maske</th><th>Profil</th><th>Im Projekt</th><th></th>
            </tr></thead><tbody id="bus-scan-rows"></tbody></table>
          </div>
          <p class="hint warn" id="bus-scan-self" hidden></p>
        </section>

        <section class="ovl-sec" data-needs-bus id="bus-sec-device">
          <h3>3 · Gerät auslesen <span class="sec-lock">— erst verbinden</span></h3>
          <div class="row">
            <span class="lbl">Adresse</span>
            <input id="bus-addr" class="input narrow" placeholder="1.1.5" value="1.1.1">
            <button id="bus-read" class="btn btn-sm btn-primary">Geräteinfo lesen</button>
            <button id="bus-occupied" class="btn btn-sm">Belegt?</button>
            <span id="bus-addr-result" class="pane-meta"></span>
          </div>
          <div id="bus-device"></div>
        </section>

        <section class="ovl-sec" data-needs-bus>
          <h3>4 · Physikalische Adresse vergeben <span class="sec-lock">— erst verbinden</span></h3>
          <div class="row">
            <button id="bus-prog-list" class="btn btn-sm">Programmiermodus abfragen</button>
            <span id="bus-prog-info" class="pane-meta"></span>
          </div>
          <div class="row">
            <span class="lbl">Neue Adresse</span>
            <input id="bus-target-manual" class="input narrow" placeholder="1.1.5">
            <select id="bus-target" class="select" aria-label="Adresse aus dem Projekt übernehmen"></select>
          </div>
          <div class="row">
            <button id="bus-assign" class="btn btn-sm btn-primary"
                    title="An das eine Gerät, dessen Programmiertaste gedrückt ist">Per Programmiertaste vergeben</button>
            <span class="lbl">oder</span>
            <input id="bus-serial" class="input" placeholder="Seriennummer, 6 Byte hex">
            <button id="bus-assign-serial" class="btn btn-sm">Per Seriennummer vergeben</button>
          </div>
          <p class="hint">Per Programmiertaste muss genau ein Gerät im Programmiermodus sein —
             der Dienst prüft das und bricht sonst ab.</p>
        </section>

        <section class="ovl-sec" data-needs-bus id="bus-sec-program">
          <h3>5 · Applikation laden <span class="sec-lock">— erst verbinden</span></h3>
          <div class="row">
            <span class="lbl">Gerät</span>
            <select id="bus-prog-dev" class="select" aria-label="Gerät aus dem Projekt"></select>
            <select id="bus-prog-kind" class="select" aria-label="Umfang des Downloads"></select>
          </div>
          <div class="row">
            <button id="bus-program" class="btn btn-sm btn-primary">Programmieren</button>
            <button id="bus-program-stop" class="btn btn-sm" hidden>Abbrechen</button>
            <span id="bus-prog-state" class="pane-meta"></span>
          </div>
          <div id="bus-prog-plan"></div>
          <p class="hint">Lädt Parameter, Gruppenadressen und Tabellen so, wie sie im Projekt stehen.
             Das Gerät muss seine physikalische Adresse schon haben (Abschnitt 4).</p>
        </section>

        <section class="ovl-sec danger" data-needs-bus>
          <h3>6 · Neustart und Entladen <span class="sec-lock">— erst verbinden</span></h3>
          <div class="row">
            <span class="lbl">Adresse</span>
            <input id="bus-rst-addr" class="input narrow" placeholder="1.1.5">
            <select id="bus-erase" class="select">
              <option value="">Einfacher Neustart</option>
              <option value="ConfirmedRestart">Bestätigter Neustart</option>
              <option value="ResetApplicationProgram">Applikationsprogramm zurücksetzen</option>
              <option value="ResetApplicationParameters">Applikationsparameter zurücksetzen</option>
              <option value="ResetLinks">Verknüpfungen zurücksetzen</option>
              <option value="ResetIndividualAddress">Physikalische Adresse zurücksetzen</option>
              <option value="FactoryResetWithoutIndividualAddress">Werkszustand, Adresse behalten</option>
              <option value="FactoryReset">Werkszustand vollständig</option>
            </select>
            <button id="bus-restart" class="btn btn-sm btn-danger">Neu starten</button>
          </div>
          <div class="row">
            <span class="lbl">Interface-Objekt</span>
            <input id="bus-unload-idx" class="input narrow" value="3" title="Index des Interface-Objekts (3 = Applikationsprogramm)">
            <button id="bus-loadstate" class="btn btn-sm">Ladezustand lesen</button>
            <button id="bus-unload" class="btn btn-sm btn-danger">Objekt entladen</button>
          </div>
          <p class="hint warn">Diese Aktionen verändern das Gerät. Der Werkszustand löscht die
             Applikation vollständig — danach muss neu geladen werden.</p>
        </section>
      </div>

      <footer class="ovl-foot">
        <span class="pane-meta">Protokoll</span>
        <div id="bus-log" class="ovl-log"></div>
      </footer>
    </div>`;
  document.body.appendChild(overlay);
  wire();
  syncControls();
}

/* ---------- Verdrahtung ---------- */

function wire() {
  q('#bus-close').onclick = closeOverlay;
  overlay.addEventListener('click', e => { if (e.target === overlay) closeOverlay(); });
  overlay.addEventListener('input', e => e.target.classList.remove('invalid'));

  q('#bus-sound').checked = prefs.sound;
  q('#bus-sound').onchange = e => { savePrefs({ sound: e.target.checked }); chime('ok'); };
  q('#bus-desktop-wrap').hidden = !canNotify();
  q('#bus-desktop').checked = prefs.desktop && canNotify() && Notification.permission === 'granted';
  q('#bus-desktop').onchange = toggleDesktop;

  q('#bus-discover').onclick = () => discover(false);
  q('#bus-connect').onclick = connect;
  q('#bus-disconnect').onclick = disconnect;
  q('#bus-reconnect').onclick = reconnect;
  q('#bus-server').onchange = syncControls;

  overlay.querySelectorAll('input[name="bus-mode"]').forEach(r => r.onchange = () => {
    syncControls();
    if (mode() === 'routing') loadInterfaces();
  });

  q('#bus-scan').onclick = startScan;
  q('#bus-scan-stop').onclick = stopScan;
  q('#bus-read').onclick = readDevice;
  q('#bus-occupied').onclick = checkOccupied;
  q('#bus-prog-list').onclick = listProgMode;
  q('#bus-assign').onclick = () => assign(false);
  q('#bus-assign-serial').onclick = () => assign(true);
  q('#bus-program').onclick = program;
  q('#bus-program-stop').onclick = stopProgram;
  q('#bus-prog-dev').onchange = () => { fillKinds(); renderPlan(); };
  q('#bus-prog-kind').onchange = renderPlan;
  q('#bus-restart').onclick = restart;
  q('#bus-unload').onclick = unload;
  q('#bus-loadstate').onclick = readLoadState;

  q('#bus-erase').onchange = () => { q('#bus-restart').textContent = restartLabel(); };
  q('#bus-target').onchange = () => {
    const v = q('#bus-target').value;
    if (v) { q('#bus-target-manual').value = v; q('#bus-target-manual').classList.remove('invalid'); }
    suggestSerial();
  };
  q('#bus-target-manual').addEventListener('input', suggestSerial);
  // Eine von Hand eingetippte Seriennummer darf der Vorschlag nicht überschreiben.
  q('#bus-serial').addEventListener('input', e => {
    e.target.dataset.touched = e.target.value.trim() ? '1' : '';
  });

  onEnter('#bus-addr', '#bus-read', readDevice);
  onEnter('#bus-target-manual', '#bus-assign', () => assign(false));
  onEnter('#bus-serial', '#bus-assign-serial', () => assign(true));

  B.events.on('log', e => appendLog(e.level, e.message));
  B.events.on('bus', e => { if (e.connected === false) onLinkLost(e.reason); });
  B.events.on('job', e => {
    const t = task.current;
    if (!t || !t.onJob || (e.id !== bus.scanJob && e.id !== bus.progJob)) return;
    t.onJob(e);
  });
}

function onEnter(inputSel, btnSel, fn) {
  q(inputSel).addEventListener('keydown', e => {
    if (e.key === 'Enter' && !q(btnSel).disabled) fn();
  });
}

const mode = () => overlay.querySelector('input[name="bus-mode"]:checked').value;

/** Ein einziger Ort, der aus Verbindung und laufendem Vorgang ableitet, was bedienbar ist. */
function syncControls() {
  if (!overlay) return;
  const busy = !!task.current, conn = bus.connected, routing = mode() === 'routing';
  const setup = busy || conn;

  overlay.querySelectorAll('[data-mode]').forEach(r =>
    r.hidden = r.dataset.mode !== (routing ? 'routing' : 'tunneling'));
  overlay.querySelectorAll('input[name="bus-mode"]').forEach(r => r.disabled = setup);
  ['#bus-discover', '#bus-nat', '#bus-nic', '#bus-own'].forEach(sel => q(sel).disabled = setup);
  q('#bus-server').disabled = setup || !bus.servers.length;

  q('#bus-connect').hidden = conn;
  q('#bus-connect').disabled = busy || (!routing && !q('#bus-server').value);
  q('#bus-disconnect').hidden = !conn;
  q('#bus-disconnect').disabled = busy;

  BUS_ACTIONS.forEach(sel => q(sel).disabled = busy || !conn);
  q('#bus-scan-rows').querySelectorAll('[data-read]').forEach(b => b.disabled = busy || !conn);
  q('#bus-scan-stop').hidden = !bus.scanJob;
  q('#bus-program-stop').hidden = !bus.progJob;
  if (!busy && conn) q('#bus-program').disabled = !!(bus.plan && bus.plan.errors.length) || !bus.plan;

  overlay.querySelectorAll('[data-needs-bus]').forEach(s => s.classList.toggle('locked', !conn));
}

function appendLog(level, message) {
  if (!overlay) return;
  const log = q('#bus-log');
  const line = document.createElement('div');
  line.className = 'log-line ' + (level || 'info');
  line.textContent = new Date().toLocaleTimeString('de-DE') + '  ' + message;
  log.appendChild(line);
  while (log.childElementCount > 200) log.firstElementChild.remove();
  log.scrollTop = log.scrollHeight;
}

/* ---------- Vorgaenge: sperren, anzeigen, melden ---------- */

const fmtClock = ms => {
  const s = Math.floor(ms / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};
const fmtDuration = ms => ms < 60000 ? Math.round(ms / 1000) + ' s' : fmtClock(ms) + ' min';

/**
 * Fuehrt einen Busvorgang aus. Waehrend er laeuft, sind alle Busaktionen gesperrt,
 * der ausloesende Knopf dreht, Kopfzeile, Topbar und Tab-Titel zeigen den Vorgang.
 * fn liefert { level: 'ok' | 'info' | 'warn', message } oder wirft bei Fehlern.
 */
async function runTask(spec, fn) {
  if (task.current) {
    A.warn('Bitte warten — es läuft noch: ' + task.current.label);
    return null;
  }
  unlockAudio();
  const t = task.current = { ...spec, started: Date.now(), detail: '' };
  t.progress = detail => { t.detail = detail; tick(); };

  if (t.btn) {
    t.btnText = t.btn.textContent;
    t.btn.dataset.busy = '1';
    if (t.busyText) t.btn.textContent = t.busyText;
  }
  $('#btn-bus').dataset.busy = '1';
  q('#bus-activity').className = 'ovl-activity running';
  tick();
  task.timer = setInterval(tick, 1000);
  syncControls();

  let outcome, failed = false;
  try {
    outcome = (await fn(t)) || { level: 'ok', message: t.label + ' abgeschlossen' };
  } catch (e) {
    outcome = { level: 'error', message: t.label + ' fehlgeschlagen: ' + e.message };
    failed = true;
  } finally {
    clearInterval(task.timer);
    if (t.btn) {
      t.btn.dataset.busy = '';
      t.btn.textContent = t.btnText;
    }
    $('#btn-bus').dataset.busy = '';
    $('#btn-bus').title = 'Geräte am Bus suchen, auslesen und adressieren';
    task.current = null;
    syncControls();
  }
  finish(t, outcome);
  // Nach einem Fehler kann der Dienst die Verbindung aufgegeben haben — Zustand nachziehen,
  // damit die Oberflaeche nicht weiter Aktionen anbietet, die ohnehin scheitern.
  if (failed) refreshStatus();
  return outcome;
}

function refreshStatus() {
  return B.bus.status().then(applyStatus).catch(() => {});
}

/** Der Dienst meldet ueber die Ereignisleitung, dass die Verbindung weg ist. */
function onLinkLost(reason) {
  const was = bus.connected;
  bus.connected = false;
  refreshStatus();
  if (!was) return;
  q('#bus-reconnect').hidden = false;
  if (!task.current) {
    q('#bus-activity').className = 'ovl-activity warn';
    q('#bus-activity .act-text').textContent = 'Verbindung verloren: ' + (reason || 'Grund unbekannt');
    q('#bus-activity .act-time').textContent = '';
    chime('warn');
    if (isAway()) desktopNotify('Busverbindung verloren', reason || '', 'warn');
  }
}

/** Nach einem Abriss: erst neu suchen (die Schnittstelle kann eine neue Adresse haben), dann verbinden. */
function reconnect() {
  const last = bus.lastConnect;
  if (!last) { A.warn('Keine frühere Verbindung bekannt — bitte oben suchen und verbinden.'); return; }
  runTask({ btn: q('#bus-reconnect'), label: 'Neu verbinden', busyText: 'Verbindet …' }, async () => {
    if (last.mode === 'tunneling') {
      try {
        bus.servers = (await B.bus.discover(3)).servers || [];
        fillServers();
        const i = bus.servers.findIndex(s => s.host === last.host);
        if (i >= 0) {
          q('#bus-server').value = String(i);
          last.deviceAddress = bus.servers[i].address;
        }
      } catch (e) {
        appendLog('warn', 'Suche vor dem Neuverbinden fehlgeschlagen: ' + e.message);
      }
    }
    applyStatus(await B.bus.connect(last));
    return bus.connected
      ? { level: 'ok', message: 'Wieder verbunden' + (bus.linkAddress ? ' als ' + bus.linkAddress : '') }
      : { level: 'warn', message: 'Verbindung kam nicht zustande' };
  });
}

function tick() {
  const t = task.current;
  if (!t) return;
  const clock = fmtClock(Date.now() - t.started);
  q('#bus-activity .act-text').textContent = t.label + ' …' + (t.detail ? ' ' + t.detail : '');
  q('#bus-activity .act-time').textContent = clock;
  $('#btn-bus').title = 'Läuft: ' + t.label + ' (' + clock + ')';
  setTitleBadge('⏳');
}

function finish(t, o) {
  const ms = Date.now() - t.started;
  const level = o.level === 'info' ? 'ok' : o.level;
  const took = ms >= 1000 ? ' (' + fmtDuration(ms) + ')' : '';

  appendLog(level === 'ok' ? 'info' : level, o.message + took);
  q('#bus-activity').className = 'ovl-activity ' + level;
  q('#bus-activity .act-text').textContent = o.message;
  q('#bus-activity .act-time').textContent = took.trim() && 'Dauer ' + fmtDuration(ms);
  level === 'ok' ? A.toast(o.message, 3000) : A.warn(o.message);

  const away = isAway();
  setTitleBadge(away ? { ok: '✓', warn: '⚠', error: '✕' }[level] : '');
  if (t.quiet || !(away || ms >= NOTIFY_AFTER_MS || level === 'error')) return;
  chime(level);
  if (away) {
    const head = { ok: 'Fertig', warn: 'Beendet mit Hinweis', error: 'Fehlgeschlagen' }[level];
    desktopNotify(head + ': ' + t.label, o.message + took, level);
  }
}

/* ---------- Eingaben pruefen ---------- */

function parsePa(s) {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{1,3})$/.exec(s.trim());
  return m && +m[1] <= 15 && +m[2] <= 15 && +m[3] <= 255 ? `${+m[1]}.${+m[2]}.${+m[3]}` : null;
}

function readPa(sel, what = 'eine Adresse') {
  const el = q(sel), raw = el.value.trim(), pa = parsePa(raw);
  el.classList.toggle('invalid', !pa);
  if (!pa) {
    el.focus();
    A.warn(raw ? `„${raw}“ ist keine physikalische Adresse — erwartet Bereich.Linie.Teilnehmer, z. B. 1.1.5`
               : `Bitte ${what} angeben.`);
  }
  return pa;
}

/* ---------- Schnittstelle ---------- */

function discover(quiet) {
  return runTask({ btn: q('#bus-discover'), label: 'Schnittstellen suchen', busyText: 'Sucht …', quiet }, async () => {
    q('#bus-server').innerHTML = '<option value="">— wird gesucht —</option>';
    try {
      const r = await B.bus.discover(3);
      bus.servers = r.servers || [];
    } catch (e) {
      bus.servers = [];
      throw e;
    } finally {
      fillServers();
    }
    const n = bus.servers.length;
    return n
      ? { level: 'ok', message: n === 1 ? '1 Schnittstelle gefunden' : n + ' Schnittstellen gefunden' }
      : { level: 'warn', message: 'Keine KNXnet/IP-Schnittstelle gefunden — Netzwerk und Firewall prüfen' };
  });
}

function fillServers() {
  q('#bus-server').innerHTML = bus.servers.length
    ? bus.servers.map((s, i) =>
        `<option value="${i}">${esc(s.name)} — ${esc(s.host)}:${s.port} (${esc(s.address)})</option>`).join('')
    : '<option value="">— nichts gefunden —</option>';
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

function connect() {
  let opts;
  if (mode() === 'routing') {
    const own = q('#bus-own').value.trim();
    if (own && !readPa('#bus-own')) return;
    opts = { mode: 'routing', networkInterface: q('#bus-nic').value || null, ownAddress: parsePa(own) };
  } else {
    const s = bus.servers[+q('#bus-server').value];
    if (!s) { A.warn('Bitte zuerst eine Schnittstelle suchen und auswählen.'); return; }
    // Die Adresse der Schnittstelle merkt sich der Dienst, um das Programmieren
    // der eigenen Schnittstelle zu erkennen.
    opts = { mode: 'tunneling', host: s.host, port: s.port, nat: q('#bus-nat').checked,
             deviceAddress: s.address };
  }
  bus.lastConnect = opts;
  const target = opts.mode === 'routing' ? 'Routing' : opts.host;
  runTask({ btn: q('#bus-connect'), label: 'Verbinden mit ' + target, busyText: 'Verbindet …' }, async () => {
    applyStatus(await B.bus.connect(opts));
    return bus.connected
      ? { level: 'ok', message: 'Verbunden' + (bus.linkAddress ? ' als ' + bus.linkAddress : '') }
      : { level: 'warn', message: 'Verbindung kam nicht zustande' };
  });
}

function disconnect() {
  runTask({ btn: q('#bus-disconnect'), label: 'Trennen', busyText: 'Trennt …' }, async () => {
    applyStatus(await B.bus.disconnect());
    return { level: 'ok', message: 'Verbindung getrennt' };
  });
}

function applyStatus(status) {
  bus.connected = !!status.connected;
  bus.linkAddress = status.linkAddress || '';
  if (status.interfaceAddress !== undefined) bus.interfaceAddress = status.interfaceAddress || '';
  const c = status.connection || {};
  const tag = q('#bus-state');
  tag.textContent = bus.connected
    ? 'verbunden' + (bus.linkAddress ? ' als ' + bus.linkAddress : '')
    : 'nicht verbunden';
  tag.classList.toggle('ok', bus.connected);
  q('#bus-conn-info').textContent = bus.connected
    ? (c.mode === 'routing' ? `Routing über ${c.multicast || '224.0.23.12'}`
       : c.host ? `Tunneling zu ${c.host}:${c.port}${c.nat ? ' (NAT)' : ''}`
         + (bus.interfaceAddress ? ` — Schnittstelle ${bus.interfaceAddress}` : '') : '')
    : (status.reason ? 'Zuletzt getrennt: ' + status.reason : '');
  if (bus.connected) q('#bus-reconnect').hidden = true;
  syncControls();
}

/* ---------- Busscan ---------- */

function fillLines() {
  const opts = [];
  KNX.project().areas.forEach(a => (a.lines || []).forEach(l => {
    opts.push(`<option value="${a.addr}.${l.addr}">${a.addr}.${l.addr} — ${esc(a.name)} / ${esc(l.name)}</option>`);
  }));
  const keep = q('#bus-line').value;
  q('#bus-line').innerHTML = opts.length ? opts.join('') : '<option value="1.1">1.1</option>';
  if (keep) q('#bus-line').value = keep;
}

function fillTargets() {
  const devs = KNX.project().devices.slice().sort((x, y) => x.addr - y.addr);
  q('#bus-target').innerHTML = '<option value="">— aus dem Projekt übernehmen —</option>' +
    devs.map(d => `<option value="${KNX.paStr(d.addr)}">${KNX.paStr(d.addr)} — ${esc(d.name)}</option>`).join('');
}

function startScan() {
  const lineStr = q('#bus-line').value;
  const [area, line] = lineStr.split('.').map(Number);
  const info = q('#bus-scan-info');
  bus.scanLine = lineStr;

  runTask({ btn: q('#bus-scan'), label: 'Linie ' + lineStr + ' scannen', busyText: 'Scannt …' }, async t => {
    bus.found = [];
    renderScan([], true);
    info.textContent = '';

    // Treffer kommen live ueber die Ereignisleitung, die Beschreibung erst mit dem Ergebnis.
    t.onJob = e => {
      if (!e.detail || bus.found.includes(e.detail)) return;
      bus.found.push(e.detail);
      renderScan(bus.found.map(address => ({ address })), true);
      info.textContent = bus.found.length + ' bisher gefunden';
      t.progress('— ' + bus.found.length + ' gefunden');
    };

    const r = await B.bus.scan(area, line);
    bus.scanJob = r.job;
    q('#bus-scan-stop').disabled = false;
    q('#bus-scan-stop').textContent = 'Scan abbrechen';
    syncControls();

    let s;
    try {
      s = await pollJob(r.job);
    } catch (e) {
      info.textContent = 'Fehler';
      throw e;
    } finally {
      bus.scanJob = null;
    }

    if (s.state === 'abgebrochen') {
      info.textContent = 'abgebrochen — ' + bus.found.length + ' bis dahin gefunden';
      renderScan(bus.found.map(address => ({ address })), false);
      return { level: 'warn', message: 'Scan von Linie ' + lineStr + ' abgebrochen' };
    }
    bus.lastScan = s.result || [];
    renderScan(bus.lastScan, false);
    const n = bus.lastScan.length;
    info.textContent = n + ' Teilnehmer';
    return { level: 'ok', message: `Scan von Linie ${lineStr} fertig: ${n} Teilnehmer gefunden` };
  });
}

function stopScan() {
  if (!bus.scanJob) return;
  const btn = q('#bus-scan-stop');
  btn.disabled = true;
  btn.textContent = 'Wird abgebrochen …';
  B.bus.cancelJob(bus.scanJob).catch(e => {
    appendLog('warn', 'Abbrechen nicht möglich: ' + e.message);
    btn.disabled = false;
    btn.textContent = 'Scan abbrechen';
  });
}

function pollJob(id) {
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const s = await B.bus.job(id);
        if (s.state === 'fertig' || s.state === 'abgebrochen') { resolve(s); return; }
        if (s.state === 'fehler') { reject(new Error(s.error || 'unbekannter Fehler')); return; }
        setTimeout(poll, 700);
      } catch (e) { reject(e); }
    };
    setTimeout(poll, 500);
  });
}

/* Ein Klick auf einen gefundenen Teilnehmer setzt dessen Adresse in alle
   Aktionsfelder — Auslesen, Adressvergabe und Neustart arbeiten danach daran. */
function applyPa(pa, quiet) {
  ['#bus-addr', '#bus-target-manual', '#bus-rst-addr'].forEach(sel => {
    const el = q(sel);
    el.value = pa;
    el.classList.remove('invalid');
  });
  // Steht die Adresse im Projekt, zeigen auch die Auswahlfelder darauf.
  const target = q('#bus-target');
  target.value = [...target.options].some(o => o.value === pa) ? pa : '';
  const dev = deviceByPa(pa);
  if (dev && [...q('#bus-prog-dev').options].some(o => o.value === dev.id)) {
    q('#bus-prog-dev').value = dev.id;
    fillKinds();
    renderPlan();
  }
  suggestSerial();
  q('#bus-scan-rows').querySelectorAll('tr').forEach(tr =>
    tr.classList.toggle('sel', tr.dataset.pa === pa));
  if (!quiet) A.toast('Adresse ' + pa + ' übernommen', 1400);
}

function renderScan(list, live) {
  const byAddr = new Map();
  KNX.project().devices.forEach(d => byAddr.set(KNX.paStr(d.addr), d));
  const pending = live ? '…' : '—';

  /* Eine Schnittstelle kann sich über ihren eigenen Tunnel nicht selbst antworten:
     Die Anfrage geht auf den Bus hinaus, das eigene Gerät empfängt sie nicht. */
  const self = bus.interfaceAddress;
  const selfMissing = !live && self && bus.scanLine && self.startsWith(bus.scanLine + '.')
    && !list.some(d => d.address === self);
  const hint = q('#bus-scan-self');
  hint.hidden = !selfMissing;
  if (selfMissing) {
    hint.textContent = `${self} fehlt im Ergebnis: Über diese Schnittstelle läuft die Verbindung, `
      + 'und ein Gerät kann sich über seinen eigenen Tunnel nicht selbst antworten. '
      + 'Die Adresse ist also belegt, auch wenn sie hier nicht auftaucht.';
  }
  q('#bus-scan-rows').innerHTML = list.map(d => {
    const known = byAddr.get(d.address);
    return `<tr class="pick" data-pa="${esc(d.address)}" title="Adresse in die Felder unten übernehmen">
      <td><b>${esc(d.address)}</b></td>
      <td>${esc(d.maskVersion || pending)}</td>
      <td>${esc(d.profile || pending)}</td>
      <td>${known ? esc(known.name) : '<span class="hint warn">nicht im Projekt</span>'}</td>
      <td class="col-act"><button class="btn btn-sm" data-read="${esc(d.address)}">Auslesen</button></td>
    </tr>`;
  }).join('') + (selfMissing ? `<tr class="pick self" data-pa="${esc(self)}"
      title="Adresse in die Felder unten übernehmen">
      <td><b>${esc(self)}</b></td>
      <td>—</td>
      <td>Schnittstelle dieser Verbindung</td>
      <td>${byAddr.has(self) ? esc(byAddr.get(self).name) : '<span class="hint warn">nicht im Projekt</span>'}</td>
      <td class="col-act"></td>
    </tr>` : '') || `<tr><td colspan="5" class="pane-meta">${live
      ? 'Noch keine Antwort — die Linie wird abgefragt …'
      : 'Kein Teilnehmer hat geantwortet'}</td></tr>`;

  q('#bus-scan-rows').querySelectorAll('tr.pick').forEach(tr =>
    tr.onclick = () => applyPa(tr.dataset.pa));
  // Der Knopf in der Zeile liest zusätzlich aus; der Klick darf nicht doppelt wirken.
  q('#bus-scan-rows').querySelectorAll('[data-read]').forEach(b => b.onclick = e => {
    e.stopPropagation();
    applyPa(b.dataset.read, true);
    q('#bus-sec-device').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    readDevice();
  });
  syncControls();
}

/* ---------- Geraet auslesen ---------- */

function readDevice() {
  const addr = readPa('#bus-addr');
  if (!addr) return;
  const box = q('#bus-device');

  runTask({ btn: q('#bus-read'), label: 'Gerät ' + addr + ' auslesen', busyText: 'Liest …' }, async () => {
    box.innerHTML = `<p class="hint">Gerät ${esc(addr)} wird gelesen …</p>`;
    let d;
    try {
      d = await B.bus.device(addr);
      box.innerHTML = renderDevice(d);
    } catch (e) {
      box.innerHTML = `<p class="hint warn">${esc(e.message)}</p>`;
      throw e;
    }
    if (!q('#bus-rst-addr').value.trim()) q('#bus-rst-addr').value = addr;
    const kept = keepSerial(addr, (d.device || {}).serialNumber);
    return { level: 'ok', message: 'Gerät ' + addr + ' ausgelesen' + (kept ? ' · ' + kept : '') };
  });
}

const deviceByPa = pa => KNX.project().devices.find(d => KNX.paStr(d.addr) === pa) || null;

/**
 * Die am Bus gelesene Seriennummer beim Projektgerät hinterlegen. Damit kann später
 * ohne Programmiertaste adressiert werden — man kommt an verbaute Geräte oft nicht heran.
 */
function keepSerial(pa, raw) {
  const serial = KNX.normSerial(raw);
  const dev = deviceByPa(pa);
  if (!serial || !dev || dev.serial === serial) return '';
  const had = dev.serial;
  dev.serial = serial;
  KNX.touch();
  A.commit();
  return had
    ? `Seriennummer bei „${dev.name}“ auf ${serial} berichtigt (vorher ${had})`
    : `Seriennummer ${serial} bei „${dev.name}“ gespeichert`;
}

/** Ist die Seriennummer des Zielgeräts bekannt, gehört sie ins Feld für die Vergabe. */
function suggestSerial() {
  const field = q('#bus-serial');
  if (field.dataset.touched === '1') return;
  const pa = parsePa(q('#bus-target-manual').value || '');
  const dev = pa && deviceByPa(pa);
  field.value = dev && dev.serial ? dev.serial : '';
  field.classList.remove('invalid');
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

function checkOccupied() {
  const addr = readPa('#bus-addr');
  if (!addr) return;
  const out = q('#bus-addr-result');
  out.textContent = '';
  runTask({ btn: q('#bus-occupied'), label: 'Adresse ' + addr + ' prüfen', busyText: 'Prüft …' }, async () => {
    const r = await B.bus.occupied(addr);
    out.textContent = r.address + (r.occupied ? ' ist belegt' : ' ist frei');
    return { level: 'ok', message: 'Adresse ' + r.address + ' ist ' + (r.occupied ? 'belegt' : 'frei') };
  });
}

/* ---------- Adresse vergeben ---------- */

function listProgMode() {
  const out = q('#bus-prog-info');
  out.textContent = '';
  runTask({ btn: q('#bus-prog-list'), label: 'Programmiermodus abfragen', busyText: 'Fragt ab …' }, async () => {
    try {
      const list = (await B.bus.progModeList()).devices || [];
      bus.progList = list;
      out.textContent = !list.length ? 'kein Gerät im Programmiermodus'
        : list.length === 1 ? '1 Gerät: ' + list[0] + ' — bereit zur Vergabe'
        : list.length + ' Geräte: ' + list.join(', ') + ' — für die Vergabe darf nur eines aktiv sein';
      return list.length === 1
        ? { level: 'ok', message: 'Im Programmiermodus: ' + list[0] }
        : { level: 'warn', message: out.textContent.replace(/^./, c => c.toUpperCase()) };
    } catch (e) {
      out.textContent = e.message;
      throw e;
    }
  });
}

function assign(bySerial) {
  const address = readPa('#bus-target-manual', 'die neue Adresse');
  if (!address) return;
  const serial = q('#bus-serial').value.trim();
  if (bySerial && !/^[0-9a-f]{12}$/i.test(serial.replace(/[\s:.-]/g, ''))) {
    q('#bus-serial').classList.add('invalid');
    q('#bus-serial').focus();
    A.warn('Die Seriennummer besteht aus 6 Byte, also 12 Hex-Zeichen, z. B. 00FA12345678.');
    return;
  }

  // Wird die verbundene Schnittstelle selbst programmiert, bricht dabei der Tunnel ab.
  const iface = bus.interfaceAddress;
  const hitsInterface = iface && (address === iface || (bus.progList || []).includes(iface));

  A.openModal('Adresse vergeben?', `
    <p>Dem Gerät wird die physikalische Adresse <b>${esc(address)}</b> zugewiesen
       ${bySerial ? 'anhand der Seriennummer <code>' + esc(serial) + '</code>' : 'über den Programmiermodus'}.</p>
    <p class="hint">Das Gerät startet anschließend neu.</p>
    ${hitsInterface ? `<p class="hint warn">Das betrifft die verbundene Schnittstelle selbst
       (${esc(iface)}). Sie startet mit der neuen Adresse neu, dadurch bricht die Verbindung ab.
       Die Vergabe gilt trotzdem als ausgeführt — danach auf „Neu verbinden“ klicken.</p>` : ''}
  `, () => {
    doAssign(address, bySerial ? serial : null);
  });
}

function doAssign(address, serial) {
  const btn = q(serial ? '#bus-assign-serial' : '#bus-assign');
  runTask({ btn, label: 'Adresse ' + address + ' vergeben', busyText: 'Vergibt …' }, async () => {
    const r = await B.bus.assign(serial ? { address, serial } : { address });
    if (r.linkLost) {
      bus.connected = false;
      q('#bus-reconnect').hidden = false;
      if (bus.lastConnect) bus.lastConnect.deviceAddress = address;
      refreshStatus();
    }
    return { level: r.ok ? 'ok' : 'warn', message: r.message };
  });
}

/* ---------- Applikation laden ---------- */

const KIND_LABELS = {
  all: 'Vollständig', par: 'Nur Parameter', grp: 'Nur Gruppenadressen',
  'par,grp': 'Parameter und Gruppenadressen', cfg: 'Nur Konfiguration', unload: 'Applikation entladen'
};

function fillProgDevices() {
  const p = KNX.project();
  const devs = p.devices.filter(d => d.catalogId && KNX.catalogById(d.catalogId))
    .sort((x, y) => x.addr - y.addr);
  const keep = q('#bus-prog-dev').value;
  q('#bus-prog-dev').innerHTML = devs.length
    ? devs.map(d => `<option value="${esc(d.id)}">${KNX.paStr(d.addr)} — ${esc(d.name)}</option>`).join('')
    : '<option value="">— kein Gerät mit Produktdatei im Projekt —</option>';
  if (keep && devs.some(d => d.id === keep)) q('#bus-prog-dev').value = keep;
  fillKinds();
  renderPlan();
}

function fillKinds() {
  const dev = KNX.deviceById(q('#bus-prog-dev').value);
  const item = dev && KNX.catalogById(dev.catalogId);
  const kinds = item ? KNXDownload.kinds(item) : [];
  const keep = q('#bus-prog-kind').value;
  const opts = (kinds.length ? kinds : ['all']).concat('unload');
  const coupler = KNXDownload.usesFilterTable(item);
  const label = k => coupler ? (KIND_LABELS[k] || k).replace('Gruppenadressen', 'Filtertabelle') : (KIND_LABELS[k] || k);
  q('#bus-prog-kind').innerHTML = opts
    .map(k => `<option value="${esc(k)}">${esc(label(k))}</option>`).join('');
  if (opts.includes(keep)) q('#bus-prog-kind').value = keep;
}

/* Der Plan wird schon bei der Auswahl berechnet: Fehler zeigen sich, bevor der Bus berührt wird. */
function renderPlan() {
  const box = q('#bus-prog-plan');
  const dev = KNX.deviceById(q('#bus-prog-dev').value);
  const item = dev && KNX.catalogById(dev.catalogId);
  bus.plan = null;
  if (!dev || !item) { box.innerHTML = ''; syncControls(); return; }
  let plan;
  try {
    plan = KNXDownload.plan(KNX.project(), dev, item, { kind: q('#bus-prog-kind').value });
  } catch (e) {
    plan = { steps: [], summary: {}, errors: ['Plan nicht berechenbar: ' + e.message], warnings: [] };
  }
  bus.plan = plan;
  const s = plan.summary;
  const facts = [
    s.mask && 'Maske ' + s.mask.replace(/^MV-/, ''),
    s.procedure,
    s.addrs != null && s.addrs + ' Gruppenadressen',
    s.assocs != null && s.assocs + ' Zuordnungen',
    s.filter != null && s.filter + ' Adressen in der Filtertabelle',
    s.params != null && s.params + ' Parameter',
    s.writes ? s.writes + ' Byte Speicher' : '',
    s.steps && s.steps + ' Schritte'
  ].filter(Boolean);
  box.innerHTML = `<p class="hint">${esc(facts.join(' · '))}</p>`
    + plan.errors.map(m => `<p class="hint warn">${esc(m)}</p>`).join('')
    + plan.warnings.slice(0, 5).map(m => `<p class="hint">${esc(m)}</p>`).join('')
    + (plan.warnings.length > 5 ? `<p class="hint">… und ${plan.warnings.length - 5} weitere Hinweise.</p>` : '')
    + '<div class="prog-bar" hidden><span></span></div>';
  syncControls();
}

function program() {
  const dev = KNX.deviceById(q('#bus-prog-dev').value);
  const plan = bus.plan;
  if (!dev || !plan) return;
  if (plan.errors.length) { A.warn(plan.errors[0]); return; }
  const pa = KNX.paStr(dev.addr);
  const kind = q('#bus-prog-kind').value;
  const what = KIND_LABELS[kind] || kind;
  const iface = bus.interfaceAddress;

  A.openModal(kind === 'unload' ? 'Applikation entladen?' : 'Gerät programmieren?', `
    <p><b>${esc(dev.name)}</b> an <b>${esc(pa)}</b> — ${esc(what)}.</p>
    <p class="hint">${plan.steps.length} Schritte${plan.summary.writes ? ', ' + plan.summary.writes + ' Byte' : ''}.
       Das Gerät ist währenddessen ohne Funktion${plan.steps.some(x => x.op === 'restart')
         ? ' und startet am Ende neu' : ''}.</p>
    ${iface && iface === pa ? `<p class="hint warn">Das ist die verbundene Schnittstelle. Beim Neustart
       bricht die Verbindung ab — danach „Neu verbinden“.</p>` : ''}
    ${plan.warnings.length ? '<p class="hint warn">' + plan.warnings.map(esc).join('<br>') + '</p>' : ''}
  `, () => doProgram(dev, plan, what));
}

function doProgram(dev, plan, what) {
  const pa = KNX.paStr(dev.addr);
  const bar = q('#bus-prog-plan .prog-bar');
  const state = q('#bus-prog-state');
  runTask({ btn: q('#bus-program'), label: `${dev.name} (${pa}) programmieren`, busyText: 'Programmiert …' }, async t => {
    state.textContent = '';
    if (bar) { bar.hidden = false; bar.firstElementChild.style.width = '0%'; }
    t.onJob = e => {
      const d = e.detail;
      if (!d || !d.total) return;
      if (bar) bar.firstElementChild.style.width = Math.round(d.step / d.total * 100) + '%';
      state.textContent = `${d.step}/${d.total} ${d.label}`;
      t.progress(`— ${d.step}/${d.total} ${d.label}`);
    };
    const r = await B.bus.download({ address: pa, label: `${what} ${pa}`, steps: plan.steps });
    bus.progJob = r.job;
    syncControls();
    let s;
    try {
      s = await pollJob(r.job);
    } finally {
      bus.progJob = null;
      q('#bus-program-stop').disabled = false;
    }
    if (s.state === 'abgebrochen') {
      state.textContent = 'abgebrochen';
      return { level: 'warn', message: `Programmieren von ${pa} abgebrochen — das Gerät ist unvollständig geladen` };
    }
    const res = s.result || {};
    (res.notes || []).forEach(n => appendLog('warn', n));
    if (bar) bar.firstElementChild.style.width = '100%';
    if (res.linkLost) {
      bus.connected = false;
      q('#bus-reconnect').hidden = false;
      refreshStatus();
      state.textContent = 'fertig, Verbindung neu aufbauen';
      return { level: 'warn', message: res.message };
    }
    state.textContent = `fertig · ${res.bytes || 0} Byte · ${res.seconds || 0} s`;
    return { level: (res.notes || []).length ? 'warn' : 'ok',
             message: `${dev.name} (${pa}): ${what} geladen` + ((res.notes || []).length ? ' — mit Hinweisen im Protokoll' : '') };
  });
}

function stopProgram() {
  if (!bus.progJob) return;
  const btn = q('#bus-program-stop');
  btn.disabled = true;
  B.bus.cancelJob(bus.progJob).catch(e => {
    appendLog('warn', 'Abbrechen nicht möglich: ' + e.message);
    btn.disabled = false;
  });
}

/* Aus dem Gerätedetail heraus: Fenster öffnen und das Gerät vorwählen. */
async function programDevice(devId) {
  await openOverlay();
  if (task.current) return;
  const sel = q('#bus-prog-dev');
  if ([...sel.options].some(o => o.value === devId)) {
    sel.value = devId;
    fillKinds();
    renderPlan();
  }
  q('#bus-sec-program').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/* ---------- Neustart und Entladen ---------- */

function restartLabel() {
  const v = q('#bus-erase').value;
  return !v ? 'Neu starten'
    : v === 'ConfirmedRestart' ? 'Bestätigt neu starten'
    : v.startsWith('Factory') ? 'Werkszustand herstellen'
    : 'Zurücksetzen';
}

function restart() {
  const address = readPa('#bus-rst-addr');
  if (!address) return;
  const eraseCode = q('#bus-erase').value;
  const label = q('#bus-erase').selectedOptions[0].textContent;

  A.openModal('Wirklich ausführen?', `
    <p>An <b>${esc(address)}</b> wird ausgeführt: <b>${esc(label)}</b>.</p>
    ${eraseCode.startsWith('Factory')
      ? '<p class="hint warn">Der Werkszustand löscht die geladene Applikation. '
        + 'Das Gerät muss danach vollständig neu programmiert werden.</p>'
      : '<p class="hint">Das Gerät ist während des Neustarts kurz nicht erreichbar.</p>'}
  `, () => {
    runTask({ btn: q('#bus-restart'), label: label + ' an ' + address, busyText: 'Läuft …' }, async () => {
      const r = await B.bus.restart(eraseCode ? { address, eraseCode } : { address });
      return { level: r.ok === false ? 'warn' : 'ok', message: r.message || label + ' ausgeführt' };
    });
  });
}

function readIndex() {
  const el = q('#bus-unload-idx'), n = Number(el.value.trim());
  const ok = Number.isInteger(n) && n >= 0 && n <= 255 && el.value.trim() !== '';
  el.classList.toggle('invalid', !ok);
  if (!ok) { el.focus(); A.warn('Der Objektindex ist eine Zahl von 0 bis 255 (3 = Applikationsprogramm).'); }
  return ok ? n : null;
}

function unload() {
  const address = readPa('#bus-rst-addr');
  if (!address) return;
  const objectIndex = readIndex();
  if (objectIndex === null) return;

  A.openModal('Objekt entladen?', `
    <p>Interface-Objekt <b>${objectIndex}</b> an <b>${esc(address)}</b> wird entladen.
       Die zugehörigen Daten gelten danach als ungültig.</p>
    <p class="hint warn">Bei Objekt 3 (Applikationsprogramm) ist das Gerät anschließend funktionslos,
       bis es neu geladen wird.</p>
  `, () => {
    runTask({ btn: q('#bus-unload'), label: 'Objekt ' + objectIndex + ' an ' + address + ' entladen',
              busyText: 'Entlädt …' }, async () => {
      const r = await B.bus.unload({ address, objectIndex });
      return { level: r.ok ? 'ok' : 'warn', message: r.message };
    });
  });
}

function readLoadState() {
  if (!q('#bus-rst-addr').value.trim()) q('#bus-rst-addr').value = q('#bus-addr').value.trim();
  const address = readPa('#bus-rst-addr');
  if (!address) return;
  const objectIndex = readIndex();
  if (objectIndex === null) return;

  runTask({ btn: q('#bus-loadstate'), label: 'Ladezustand von ' + address + ' lesen', busyText: 'Liest …' }, async () => {
    const r = await B.bus.loadState(address, objectIndex);
    return { level: 'ok', message: `${address}, Objekt ${objectIndex}: ${r.loadStateName}` };
  });
}

/* ---------- Oeffnen und Schliessen ---------- */

async function openOverlay() {
  ensureOverlay();
  if (!task.current) { fillLines(); fillTargets(); fillProgDevices(); syncControls(); }
  overlay.classList.add('open');
  try {
    if (!task.current) applyStatus(await B.bus.status());
  } catch (e) {
    appendLog('warn', 'Status nicht lesbar: ' + e.message);
  }
  // Beim ersten Oeffnen gleich suchen — das ist fast immer der erste Schritt.
  if (!bus.connected && !bus.autoSearched && !task.current && mode() === 'tunneling') {
    bus.autoSearched = true;
    discover(true);
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

window.KNXBus = { available: true, open: openOverlay, openProjects, program: programDevice };

})();
