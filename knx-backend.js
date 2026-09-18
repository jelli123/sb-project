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
  'knx-data.js', 'knx-icons.js', 'knx-prod.js', 'knx-download.js',
  'app.js', 'app-ga.js', 'app-fn.js', 'app-topo.js', 'app-render.js', 'app-bus.js', 'app-init.js'
];

const DEFAULT_PROJECT_ID = 'Projekt';

/* ---------- HTTP-Grundlagen ---------- */

async function request(method, path, body, opts = {}) {
  const init = { method, headers: {} };
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
    throw err;
  }
  return data;
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

/* ---------- Speichern: gebuendelt, damit jeder Tastendruck nicht schreibt ---------- */

function makeSaver() {
  let pendingJson = null, timer = 0, inFlight = false;
  let lastError = '';

  async function drain() {
    if (inFlight || pendingJson === null) return;
    const json = pendingJson;
    pendingJson = null;
    inFlight = true;
    try {
      await put('/api/projects/' + encodeURIComponent(backend.projectId), json);
      lastError = '';
    } catch (e) {
      lastError = 'Speichern auf dem PC fehlgeschlagen: ' + e.message;
      if (window.KNXApp) window.KNXApp.warn(lastError);
    } finally {
      inFlight = false;
      if (pendingJson !== null) drain();
    }
  }

  return {
    queue(json) {
      pendingJson = json;
      clearTimeout(timer);
      timer = setTimeout(drain, 300);
    },
    /** Beim Verlassen der Seite: sofort und ohne auf die Antwort zu warten. */
    flushNow() {
      clearTimeout(timer);
      if (pendingJson === null) return;
      const json = pendingJson;
      pendingJson = null;
      request('PUT', '/api/projects/' + encodeURIComponent(backend.projectId), json, { keepalive: true })
        .catch(() => {});
    },
    error: () => lastError
  };
}

/* ---------- Ereignisleitung ---------- */

function makeEvents() {
  let source = null;
  const handlers = { log: new Set(), job: new Set(), bus: new Set(), state: new Set() };

  function ensure() {
    if (source) return;
    source = new EventSource('/api/events');
    source.addEventListener('log', e => emit('log', e));
    source.addEventListener('job', e => emit('job', e));
    source.addEventListener('bus', e => emit('bus', e));
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

const saver = makeSaver();
const backend = {
  mode: 'server',
  info: null,
  projectId: DEFAULT_PROJECT_ID,
  events: null,

  saveProject(json) { saver.queue(json); },
  saveError: () => saver.error(),
  flush: () => saver.flushNow(),

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
    connect:     opts    => post('/api/bus/connect', opts, { timeout: 40000 }),
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
      get('/api/bus/loadstate?address=' + encodeURIComponent(address) + '&objectType=' + objectType)
  }
};

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
  let id = settings.current;
  if (!id || !projects.some(p => p.id === id)) id = projects.length ? projects[0].id : null;

  if (id) {
    backend.projectId = id;
    try {
      window.KNXBoot.project = await backend.readProject(id);
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

  window.addEventListener('pagehide', () => backend.flush());
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
