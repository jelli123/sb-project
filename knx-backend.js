/* ============================================================
   KNX-Struktur — Anbindung an den lokalen Dienst (sb-server)
   ------------------------------------------------------------
   Diese Datei laeuft als einzige zuerst. Sie klaert, ob der Java-Dienst
   erreichbar ist, holt das Projekt und laedt danach erst die uebrigen
   Skripte. Ohne Dienst bleibt alles wie bisher im Browserspeicher.
   ============================================================ */
'use strict';

window.KNXBoot = { mode: 'local', project: null, projectId: null, settings: {} };
window.KNXBackend = null;

(() => {

const SCRIPTS = [
  'knx-data.js', 'knx-icons.js', 'knx-prod.js', 'knx-crypt.js', 'knx-proj.js', 'knx-download.js',
  'app.js', 'app-ga.js', 'app-fn.js', 'app-secure.js', 'app-topo.js', 'app-render.js', 'app-bus.js', 'app-prog.js',
  'app-mcp.js', 'app-init.js'
];

const DEFAULT_PROJECT_ID = 'Projekt';

/* Jedes Fenster hat eine eigene Kennung. Damit richtet der Dienst Aufrufe einer
   KI-Sitzung an genau das Fenster, das das Projekt zeigt, und erkennt, wer
   zuletzt gespeichert hat. Beim Neuladen entsteht eine neue. */
const WINDOW_ID = (() => {
  try { if (crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* unten weiter */ }
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
})();

/* ---------- HTTP-Grundlagen ---------- */

async function request(method, path, body, opts = {}) {
  // Fenster und Projekt: für die Reservierung der Busverbindung und um eigene Speicherungen zu erkennen
  const init = { method, headers: { 'X-SB-Window': WINDOW_ID,
    'X-SB-Project': encodeURIComponent(backend.projectId), ...(opts.headers || {}) } };
  if (body !== undefined && body !== null) {
    if (typeof body === 'string' || body instanceof ArrayBuffer || body instanceof Uint8Array) {
      init.body = body;
      init.headers['Content-Type'] = typeof body === 'string'
        ? 'application/json' : 'application/octet-stream';
    } else {
      init.body = JSON.stringify(body);
      init.headers['Content-Type'] = 'application/json';
    }
  }
  if (opts.keepalive) init.keepalive = true;
  if (opts.timeout) init.signal = AbortSignal.timeout(opts.timeout);

  const res = await fetch(path, init);
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
  }
  if (!res.ok) {
    const msg = data && data.error ? data.error : ('HTTP ' + res.status);
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/* Liest ein Projekt samt Revision (ETag). Mit ihr wird später gespeichert; hat
   inzwischen ein anderes Fenster gespeichert, lehnt der Dienst ab (409). */
async function readProjectRev(id) {
  const res = await fetch('/api/projects/' + encodeURIComponent(id), { headers: { 'X-SB-Window': WINDOW_ID } });
  if (!res.ok) {
    const err = new Error('HTTP ' + res.status);
    err.status = res.status;
    throw err;
  }
  const rev = (res.headers.get('ETag') || '').replace(/"/g, '') || null;
  return { doc: JSON.parse(await res.text()), rev };
}

/* Holt eine Binaerantwort (Produktdatei). request() liest immer Text und
   wuerde eine .knxprod verstuemmeln. */
async function getBytes(path, opts = {}) {
  const init = {};
  if (opts.timeout) init.signal = AbortSignal.timeout(opts.timeout);
  const res = await fetch(path, init);
  if (!res.ok) {
    let msg = 'HTTP ' + res.status;
    try {
      const data = JSON.parse(await res.text());
      if (data && data.error) msg = data.error;
    } catch (e) { /* dann bleibt es beim Statuscode */ }
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return new Uint8Array(await res.arrayBuffer());
}

const get  = (p, o)    => request('GET', p, null, o);
const post = (p, b, o) => request('POST', p, b ?? {}, o);
const put  = (p, b, o) => request('PUT', p, b, o);
const del  = (p)       => request('DELETE', p, null);

/* ---------- Speichern: gebuendelt, damit jeder Tastendruck nicht schreibt ---------- *
 * Gespeichert wird auf der zuletzt bekannten Revision. Hat ein anderes Fenster
 * dazwischen gespeichert, hält der Speicher an, bis die Bedienung entschieden
 * hat: neu laden oder den anderen Stand überschreiben.                       */

function makeSaver() {
  let pendingJson = null, timer = 0, inFlight = false;
  let lastError = '';
  let conflict = null;
  const conflictHandlers = new Set();

  const headers = () => (backend.rev ? { 'If-Match': '"' + backend.rev + '"' } : {});

  async function drain() {
    if (inFlight || conflict || pendingJson === null) return;
    const json = pendingJson;
    pendingJson = null;
    inFlight = true;
    try {
      const r = await request('PUT', '/api/projects/' + encodeURIComponent(backend.projectId), json,
        { headers: headers() });
      if (r && r.rev) backend.rev = r.rev;
      lastError = '';
    } catch (e) {
      if (e.status === 409) {
        // Nicht verlieren: Der Stand bleibt vorgemerkt, bis entschieden ist
        if (pendingJson === null) pendingJson = json;
        raise({ rev: e.data && e.data.rev, by: null });
      } else {
        lastError = 'Speichern auf dem PC fehlgeschlagen: ' + e.message;
        if (window.KNXApp) window.KNXApp.warn(lastError);
      }
    } finally {
      inFlight = false;
      if (pendingJson !== null && !conflict) drain();
    }
  }

  function raise(info) {
    if (conflict) return;
    conflict = info;
    conflictHandlers.forEach(h => h(info));
  }

  return {
    queue(json) {
      pendingJson = json;
      clearTimeout(timer);
      // Solange ein Konflikt offen ist, erinnert jede Änderung daran
      if (conflict) { conflictHandlers.forEach(h => h(conflict)); return; }
      timer = setTimeout(drain, 300);
    },
    /** Beim Verlassen der Seite: sofort und ohne auf die Antwort zu warten. */
    flushNow() {
      clearTimeout(timer);
      if (pendingJson === null || conflict) return;
      const json = pendingJson;
      pendingJson = null;
      request('PUT', '/api/projects/' + encodeURIComponent(backend.projectId), json,
        { keepalive: true, headers: headers() }).catch(() => {});
    },
    error: () => lastError,
    /* Konflikt: von außen gemeldet (Ereignis eines anderen Fensters) oder beim Speichern erkannt. */
    conflict: () => conflict,
    raise,
    onConflict(fn) { conflictHandlers.add(fn); },
    /** Den anderen Stand überschreiben: Ab jetzt gilt dessen Revision als Grundlage. */
    overwrite(rev) {
      if (rev) backend.rev = rev;
      conflict = null;
      // KNX ist eine globale Konstante der später geladenen knx-data.js, kein window.KNX
      if (pendingJson === null && typeof KNX !== 'undefined') pendingJson = JSON.stringify(KNX.project());
      drain();
    },
    hasPending: () => pendingJson !== null || inFlight,
    /** Neu laden ist gewählt: Was hier noch nicht gespeichert ist, wird bewusst verworfen. */
    discard() { clearTimeout(timer); pendingJson = null; }
  };
}

/* ---------- Ereignisleitung ---------- */

function makeEvents() {
  let source = null;
  const KINDS = ['log', 'job', 'bus', 'project', 'mcp', 'mcp-call'];
  const handlers = { state: new Set() };
  KINDS.forEach(k => { handlers[k] = new Set(); });

  function ensure() {
    if (source) return;
    // Fenster und Projekt melden sich an: KI-Aufrufe gehen gezielt an dieses Fenster
    source = new EventSource('/api/events?window=' + encodeURIComponent(WINDOW_ID)
      + '&project=' + encodeURIComponent(backend.projectId));
    KINDS.forEach(k => source.addEventListener(k, e => emit(k, e)));
    source.addEventListener('open', () => handlers.state.forEach(h => h('offen')));
    source.onerror = () => handlers.state.forEach(h => h('gestoert'));
  }
  function emit(kind, e) {
    let data = null;
    try { data = JSON.parse(e.data); } catch (err) { return; }
    handlers[kind].forEach(h => h(data));
  }
  return {
    on(kind, fn) { ensure(); handlers[kind].add(fn); return () => handlers[kind].delete(fn); }
  };
}

/* ---------- Die Schnittstelle, die der Rest der Anwendung sieht ---------- */

const backend = {
  mode: 'server',
  info: null,
  projectId: DEFAULT_PROJECT_ID,
  // Revision des geladenen Stands; null, solange die Datei noch nicht existiert
  rev: null,
  windowId: WINDOW_ID,
  events: null,

  saveProject(json) { saver.queue(json); },
  saveError: () => saver.error(),
  flush: () => saver.flushNow(),
  saver: null,
  /* Adresse, unter der ein Projekt in einem Fenster aufgeht — jedes Fenster
     behält so sein Projekt, auch wenn ein anderes inzwischen ein anderes zeigt. */
  projectUrl: id => location.pathname + '?p=' + encodeURIComponent(id),

  listProjects: () => get('/api/projects').then(r => r.projects || []),
  readProject: id => get('/api/projects/' + encodeURIComponent(id)),
  writeProject: (id, json) => put('/api/projects/' + encodeURIComponent(id), json),
  deleteProject: id => del('/api/projects/' + encodeURIComponent(id)),
  renameProject: (id, name) => post('/api/projects/' + encodeURIComponent(id), { name }),

  readSettings: () => get('/api/settings'),
  writeSettings: obj => put('/api/settings', obj),

  catalogList: () => get('/api/catalog').then(r => r.entries || []),
  catalogRead: id => get('/api/catalog/' + encodeURIComponent(id)),
  catalogWrite: (id, doc) => put('/api/catalog/' + encodeURIComponent(id), doc),
  catalogWriteFile: (id, bytes) => put('/api/catalog/' + encodeURIComponent(id) + '/file', bytes),
  catalogDelete: id => del('/api/catalog/' + encodeURIComponent(id)),

  /* Onlinekatalog. Der Dienst haelt einen Cache vor; erreicht wird das Netz nur,
     wenn etwas fehlt oder ausdruecklich erneuert wird. */
  online: {
    status:        ()  => get('/api/online/status'),
    manufacturers: (refresh = false) =>
      get('/api/online/manufacturers' + (refresh ? '?refresh=1' : ''), { timeout: 120000 })
        .then(r => r.entries || []),
    index: (manufacturer, lang = 'de-DE', refresh = false) =>
      get('/api/online/index?manufacturer=' + encodeURIComponent(manufacturer)
        + '&lang=' + encodeURIComponent(lang) + (refresh ? '&refresh=1' : ''), { timeout: 300000 }),
    search: q => get('/api/online/search?q=' + encodeURIComponent(q), { timeout: 60000 }),
    product: (id, lang = 'de-DE') =>
      getBytes('/api/online/product?id=' + encodeURIComponent(id)
        + '&lang=' + encodeURIComponent(lang), { timeout: 300000 }),
    sync:      body => post('/api/online/sync', body || {}),
    job:       id   => get('/api/online/jobs/' + encodeURIComponent(id)),
    cancelJob: id   => post('/api/online/jobs/' + encodeURIComponent(id) + '/cancel'),
    clearCache: what => del('/api/online/cache?what=' + encodeURIComponent(what || 'all'))
  },

  bus: {
    status:      ()      => get('/api/bus/status'),
    discover:    (s = 3) => get('/api/bus/discover?timeout=' + s, { timeout: (s + 6) * 1000 }),
    interfaces:  ()      => get('/api/bus/interfaces'),
    // takeover: die Verbindung eines anderen Fensters ausdrücklich übernehmen
    connect:     (opts, takeover) => post('/api/bus/connect' + (takeover ? '?takeover=1' : ''), opts, { timeout: 40000 }),
    disconnect:  ()      => post('/api/bus/disconnect', {}, { timeout: 30000 }),
    scan:        (area, line) => post('/api/bus/scan', { area, line }),
    job:         id      => get('/api/bus/jobs/' + encodeURIComponent(id)),
    cancelJob:   id      => post('/api/bus/jobs/' + encodeURIComponent(id) + '/cancel'),
    routers:     ()      => get('/api/bus/routers', { timeout: 320000 }),
    device:      addr    => get('/api/bus/device?address=' + encodeURIComponent(addr), { timeout: 70000 }),
    occupied:    addr    => get('/api/bus/address/occupied?address=' + encodeURIComponent(addr), { timeout: 40000 }),
    progModeList:()      => get('/api/bus/progmode', { timeout: 40000 }),
    progModeSet: (address, on) => post('/api/bus/progmode', { address, on }, { timeout: 40000 }),
    assign:      body    => post('/api/bus/address', body, { timeout: 130000 }),
    download:    body    => post('/api/bus/download', body, { timeout: 30000 }),
    restart:     body    => post('/api/bus/restart', body, { timeout: 130000 }),
    unload:      body    => post('/api/bus/unload', body, { timeout: 70000 }),
    loadState:   (address, objectType) =>
      get('/api/bus/loadstate?address=' + encodeURIComponent(address) + '&objectType=' + objectType),
    keys:        body    => post('/api/bus/keys', body)
  },

  /* KI-Zugang (MCP). Der Zugangsschlüssel selbst kommt hier nie vorbei. */
  mcp: {
    status:  project       => get('/api/mcp/status?project=' + encodeURIComponent(project)),
    mode:    (project, mode) => post('/api/mcp/mode', { project, mode }),
    result:  body          => post('/api/mcp/result', body, { timeout: 30000 }),
    preview: body          => post('/api/mcp/preview', body, { timeout: 30000 }),
    rotateToken: ()        => post('/api/mcp/token', {})
  },

  /* KNX Secure: Die Schlüssel bleiben im Dienst. Hinein gehen Passwort und
     Gerätezertifikat, heraus kommt nur, ob etwas vorhanden ist. */
  secure: {
    status:   project => get('/api/secure/status?project=' + encodeURIComponent(project)),
    unlock:   body    => post('/api/secure/unlock', body, { timeout: 60000 }),
    lock:     project => post('/api/secure/lock', { project }),
    password: body    => post('/api/secure/password', body, { timeout: 60000 }),
    certificate:       body => post('/api/secure/certificate', body),
    removeCertificate: body => post('/api/secure/certificate/remove', body)
  }
};
const saver = makeSaver();
backend.saver = saver;

/* ---------- Start ---------- */

function loadScripts(list) {
  return list.reduce((chain, src) => chain.then(() => new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error('Skript nicht ladbar: ' + src));
    document.body.appendChild(el);
  })), Promise.resolve());
}

async function bootServer() {
  backend.info = await get('/api/info', { timeout: 2000 });
  backend.events = makeEvents();

  let settings = {};
  try { settings = await backend.readSettings(); } catch (e) { settings = {}; }

  const projects = await backend.listProjects();
  // Das Projekt dieses Fensters steht in der Adresse; sonst das zuletzt geöffnete
  let id = new URLSearchParams(location.search).get('p');
  if (!id || !projects.some(p => p.id === id)) id = settings.current;
  if (!id || !projects.some(p => p.id === id)) id = projects.length ? projects[0].id : null;

  if (id) {
    backend.projectId = id;
    try {
      const r = await readProjectRev(id);
      window.KNXBoot.project = r.doc;
      backend.rev = r.rev;
    } catch (e) {
      window.KNXBoot.project = null;
    }
  } else {
    backend.projectId = DEFAULT_PROJECT_ID;
  }

  window.KNXBoot.mode = 'server';
  window.KNXBoot.projectId = backend.projectId;
  window.KNXBoot.settings = settings;
  window.KNXBackend = backend;

  // Bei offenem Konflikt sind Änderungen dieses Fensters noch nicht gespeichert
  window.addEventListener('beforeunload', e => {
    if (saver.conflict() && saver.hasPending()) e.preventDefault();
  });
  window.addEventListener('pagehide', () => {
    backend.flush();
    // Freigaben dieses Fensters sollen nicht erst beim nächsten Ping des Dienstes fallen
    try { navigator.sendBeacon('/api/events/bye?window=' + encodeURIComponent(WINDOW_ID)); } catch (e) { /* egal */ }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') backend.flush();
  });
}

(async () => {
  try {
    await bootServer();
  } catch (e) {
    window.KNXBoot.mode = 'local';
    window.KNXBackend = null;
    console.info('Kein lokaler Dienst erreichbar — das Projekt bleibt im Browserspeicher.', e.message);
  }
  try {
    await loadScripts(SCRIPTS);
  } catch (e) {
    document.body.innerHTML = '<p style="padding:2rem;font:14px system-ui">' + e.message + '</p>';
  }
})();

})();
