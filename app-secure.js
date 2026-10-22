/* ============================================================
   KNX-Struktur — KNX Secure: Schlüsselablage und Gerätezertifikate
   ============================================================ *
 * Die Schlüssel selbst bleiben im lokalen Dienst (KeyVault.java): Projekt-
 * JSON, Browserspeicher, Undo-Verlauf und Export sehen nie einen. Hier wird
 * nur angezeigt, ob ein Zertifikat oder Tool Key vorliegt, und Passwort und
 * Zertifikat werden an den Dienst gereicht.
 *
 * Im Projekt stehen nur die Entscheidungen: `dev.secure` (Secure-Inbetrieb-
 * nahme) und `ga.secure` (Gruppenadresse mit Gruppenschlüssel).            */
'use strict';

(() => {

const A = window.KNXApp, $ = s => document.querySelector(s);
const esc = A.esc, T18 = A.t;
const B = () => window.KNXBackend;

const available = () => !!B() && !!B().secure;
const projectId = () => (B() ? B().projectId : null);

/* ---------- Zustand der Ablage ---------- */

/* `failed`: die letzte Abfrage scheiterte — dann fragt erst ein ausdrückliches
   refresh() wieder, sonst stieße jedes Neuzeichnen die nächste Abfrage an. */
const cache = { project: null, status: null, loading: null, failed: null };
const listeners = new Set();

function changed() {
  listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
  if (window.KNXOnRender) window.KNXOnRender();
}

async function refresh() {
  if (!available()) return null;
  const id = projectId();
  try {
    const st = await B().secure.status(id);
    cache.project = id;
    cache.status = st;
    cache.failed = null;
  } catch (e) {
    cache.project = id;
    cache.status = { unlocked: false, error: e.message || String(e) };
    cache.failed = id;
  }
  cache.loading = null;
  changed();
  return cache.status;
}

/** Zuletzt bekannter Zustand für das offene Projekt; ist keiner da, wird er geholt. */
function known() {
  if (!available()) return null;
  if (cache.project === projectId() && cache.status) return cache.status;
  if (!cache.loading && cache.failed !== projectId()) cache.loading = refresh();
  return null;
}

const keysOf = dev => {
  const st = known();
  return st && st.unlocked && dev && dev.serial ? (st.devices || {})[dev.serial] || null : null;
};

/* Ein Gerät, für das vor einem Busvorgang die Ablage offen sein sollte. */
function relevant(dev) {
  if (!dev) return false;
  if (dev.secure) return true;
  const item = dev.catalogId && KNX.catalogById(dev.catalogId);
  const st = known();
  return !!(item && item.secure && st && st.exists && !st.unlocked);
}

/* Schließt der Dialog ohne Bestätigen, soll ein wartender Aufrufer davon erfahren. */
function onModalClose(fn) {
  const el = $('#modal-backdrop');
  const obs = new MutationObserver(() => {
    if (!el.classList.contains('open')) { obs.disconnect(); fn(); }
  });
  obs.observe(el, { attributes: true, attributeFilter: ['class'] });
  return () => obs.disconnect();
}

function modalError(msg) {
  const box = $('#m-err');
  if (box) { box.textContent = msg; box.hidden = !msg; }
}

/**
 * Sorgt dafür, dass die Ablage entsperrt ist; gibt es noch keine, wird sie
 * angelegt. Liefert true, wenn sie danach offen ist — false, wenn abgebrochen.
 */
async function ensureUnlocked() {
  if (!available()) { A.warn(T18('KNX Secure braucht den lokalen Dienst.')); return false; }
  const st = (cache.project === projectId() && cache.status) || await refresh();
  if (!st) { A.warn(T18('Zustand der Schlüsselablage nicht lesbar.')); return false; }
  if (st.unlocked) return true;
  return new Promise(resolve => {
    const create = !st.exists;
    let done = false;
    const finish = ok => { if (done) return; done = true; stop(); resolve(ok); };
    A.openModal(create ? T18('Schlüsselablage anlegen') : T18('Schlüsselablage entsperren'), `
      <p>${create
        ? T18('Für KNX Secure braucht das Projekt eine Schlüsselablage. Sie liegt verschlüsselt neben dem Projekt; das Passwort wird nirgends gespeichert.')
        : T18('Die KNX-Secure-Schlüssel dieses Projekts sind mit dem Projektpasswort verschlüsselt.')}</p>
      <label class="field"><span>${T18('Projektpasswort')}</span>
        <input class="input" id="m-pw" type="password" maxlength="200" autocomplete="off"></label>
      ${create ? `<label class="field"><span>${T18('Passwort wiederholen')}</span>
        <input class="input" id="m-pw2" type="password" maxlength="200" autocomplete="off"></label>
        <p class="hint warn">${T18('Ohne dieses Passwort sind die Schlüssel verloren. Geräte mit Tool Key lassen sich dann nur noch über den Werkszustand am Gerät und das Gerätezertifikat (FDSK) wieder in Betrieb nehmen.')}</p>` : ''}
      <p class="hint warn" id="m-err" hidden></p>
    `, () => {
      const pw = $('#m-pw').value;
      if (pw.length < 8) { modalError(T18('Das Projektpasswort braucht mindestens 8 Zeichen.')); $('#m-pw').focus(); return false; }
      if (create && pw !== $('#m-pw2').value) { modalError(T18('Die Passwörter stimmen nicht überein.')); $('#m-pw2').focus(); return false; }
      const ok = $('#modal-ok');
      if (ok) ok.disabled = true;
      modalError('');
      A.status(T18('Schlüsselablage wird entsperrt …'));
      B().secure.unlock({ project: projectId(), password: pw, create }).then(s => {
        cache.project = projectId();
        cache.status = s;
        A.status('');
        if (ok) ok.disabled = false;
        // Wurde der Dialog inzwischen geschlossen, gehört der offene Dialog jemand anderem
        if (!done) {
          done = true;
          stop();
          A.closeModal();
          resolve(true);
        }
        A.toast(create ? T18('Schlüsselablage angelegt') : T18('Schlüsselablage entsperrt'));
        changed();
      }).catch(e => {
        A.status('');
        if (ok) ok.disabled = false;
        if (done) return;
        modalError(e.message);
        $('#m-pw').select();
      });
      return false;
    });
    const stop = onModalClose(() => finish(false));
  });
}

async function lock() {
  if (!available()) return;
  try {
    cache.status = await B().secure.lock(projectId());
    cache.project = projectId();
    A.toast(T18('Schlüsselablage gesperrt'));
  } catch (e) {
    A.warn(e.message);
  }
  changed();
}

/* ---------- Gerätezertifikat ---------- */

/** Zertifikat (Seriennummer + FDSK) eines Geräts eintragen. Geprüft wird im Dienst. */
async function enterCertificate(devId) {
  const dev = KNX.deviceById(devId);
  if (!dev || !(await ensureUnlocked())) return;
  A.nextModal(() => A.openModal(T18('Gerätezertifikat für „{0}“', dev.name), `
    <p>${T18('Das Zertifikat steht als Text und QR-Code auf dem Gerät oder dem beiliegenden Zettel: 36 Zeichen in sechs Blöcken. Es enthält Seriennummer und FDSK.')}</p>
    <label class="field"><span>${T18('Zertifikat')}</span>
      <input class="input mono" id="m-cert" maxlength="60" autocomplete="off" spellcheck="false"
             placeholder="XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX"></label>
    ${dev.serial ? `<label class="chk"><input type="checkbox" id="m-cert-take">
      ${T18('Seriennummer des Geräts ({0}) durch die des Zertifikats ersetzen', esc(dev.serial))}</label>` : ''}
    <p class="hint warn" id="m-err" hidden></p>
  `, () => {
    const text = $('#m-cert').value.trim();
    if (!text) { $('#m-cert').focus(); return false; }
    const take = !!($('#m-cert-take') && $('#m-cert-take').checked);
    const ok = $('#modal-ok');
    if (ok) ok.disabled = true;
    modalError('');
    let closed = false;
    const stop = onModalClose(() => { closed = true; });
    B().secure.certificate({ project: projectId(), certificate: text, ...(dev.serial && !take ? { serial: dev.serial } : {}) })
      .then(r => {
        cache.project = projectId();
        cache.status = r.status;
        if (ok) ok.disabled = false;
        stop();
        if (!closed) A.closeModal();
        if (dev.serial !== r.serial) {
          dev.serial = r.serial;
          KNX.touch();
          A.commit();
        }
        A.toast(T18('Zertifikat für Seriennummer {0} eingetragen', r.serial));
        changed();
      })
      .catch(e => {
        if (ok) ok.disabled = false;
        stop();
        if (closed) { A.warn(e.message); return; }
        modalError(e.message);
        $('#m-cert').select();
      });
    return false;
  }));
}

async function removeCertificate(devId) {
  const dev = KNX.deviceById(devId);
  if (!dev || !dev.serial || !(await ensureUnlocked())) return;
  const k = keysOf(dev) || {};
  A.nextModal(() => A.openModal(T18('Gerätezertifikat entfernen?'), `
    <p>${T18('Der FDSK für Seriennummer <b>{0}</b> wird aus der Schlüsselablage entfernt.', esc(dev.serial))}</p>
    ${k.toolKey
      ? `<p class="hint">${T18('Der gesetzte Tool Key bleibt erhalten — das Gerät bleibt erreichbar.')}</p>`
      : `<p class="hint warn">${T18('Ohne FDSK lässt sich das Gerät nicht mehr Secure in Betrieb nehmen, bis das Zertifikat wieder eingetragen ist.')}</p>`}
  `, () => {
    B().secure.removeCertificate({ project: projectId(), serial: dev.serial })
      .then(s => { cache.status = s; cache.project = projectId(); A.toast(T18('Zertifikat entfernt')); changed(); })
      .catch(e => A.warn(e.message));
  }));
}

/* ---------- Bindung für den Bus ---------- */

/**
 * Meldet dem Dienst, welches Gerät des Projekts unter welcher Adresse liegt.
 * Er bindet daraufhin die Schlüssel aus der Ablage — die Seriennummer ist der
 * Schlüssel zur Ablage, die Adresse kann sich mit jeder Vergabe ändern.
 */
async function bindForBus() {
  if (!available()) return null;
  const devices = KNX.project().devices
    .filter(d => d.serial && KNX.hasPa(d))
    .map(d => ({ address: KNX.paStr(d.addr), serial: d.serial }));
  // Doppelte Adressen meldet die Prüfung; gebunden wird dann keine von beiden
  const seen = new Map();
  devices.forEach(d => seen.set(d.address, (seen.get(d.address) || 0) + 1));
  return B().bus.keys({ project: projectId(), devices: devices.filter(d => seen.get(d.address) === 1) });
}

/* ---------- Detailbereich ---------- */

function deviceSection(dev) {
  const item = dev.catalogId ? KNX.catalogById(dev.catalogId) : null;
  const st = known();
  const k = keysOf(dev);
  if (!dev.secure && !(item && item.secure) && !k) return '';
  const rows = [];
  const row = (label, value, cls = '') => rows.push(`<li><span class="grow">${label}</span><span class="addr${cls}">${value}</span></li>`);
  if (!available()) {
    return `<h3 class="detail-h">${A.IC_LOCK} KNX Secure</h3>
      <p class="hint">${T18('KNX Secure braucht den lokalen Dienst mit seiner Schlüsselablage.')}</p>`;
  }
  if (!st) row(T18('Schlüsselablage'), T18('wird gelesen …'));
  else if (st.error) row(T18('Schlüsselablage'), T18('nicht erreichbar'), ' warn');
  else if (!st.unlocked) row(T18('Schlüsselablage'), st.exists ? T18('gesperrt — Passwort nötig') : T18('noch nicht angelegt'));
  else {
    row(T18('Gerätezertifikat (FDSK)'), k && k.fdsk ? T18('hinterlegt') : T18('fehlt'), k && k.fdsk ? '' : ' warn');
    row(T18('Tool Key'), k && k.toolKey ? T18('gesetzt') : k && k.pending ? T18('vorgemerkt, unbestätigt') : T18('noch nicht gesetzt'));
  }
  const hints = [];
  if (dev.secure && item && !item.secure)
    hints.push(`<p class="hint warn">${T18('Die Produktdatei nennt keine Secure-Unterstützung. Ist sie vor der Secure-Unterstützung eingelesen worden, die .knxprod bitte neu laden.')}</p>`);
  if (dev.secure && !dev.serial)
    hints.push(`<p class="hint">${T18('Die Seriennummer fehlt noch — sie wird mit dem Zertifikat übernommen.')}</p>`);
  if (st && st.unlocked && st.file && (dev.secure || k))
    hints.push(`<p class="hint">${T18('Schlüsseldatei: {0} — bitte mit dem Projekt sichern; ohne sie sind Geräte mit Tool Key nur per Werkszustand erreichbar.', `<code>${esc(st.file)}</code>`)}</p>`);
  if (!dev.secure && k && (k.toolKey || k.pending))
    hints.push(`<p class="hint">${T18('Das Gerät hat einen Tool Key. Beim nächsten Programmieren werden Security Mode und Schlüsseltabellen zurückgenommen; der Tool Key bleibt bis zum Werkszustand.')}</p>`);
  const unlocked = st && st.unlocked;
  return `<h3 class="detail-h">${A.IC_LOCK} KNX Secure</h3>
    <label class="chk detail-field" title="${T18('Tool Key setzen, Security Mode einschalten und gesicherte Gruppenadressen laden')}">
      <input type="checkbox" id="d-secure"${dev.secure ? ' checked' : ''}> ${T18('Secure-Inbetriebnahme')}</label>
    <ul class="detail-list">${rows.join('')}</ul>
    <div class="detail-actions">
      ${unlocked
        ? `<button class="btn btn-sm" id="d-cert">${k && k.fdsk ? T18('Zertifikat ersetzen …') : T18('Zertifikat eintragen …')}</button>
           ${k && k.fdsk ? `<button class="btn btn-sm" id="d-cert-del">${T18('Zertifikat entfernen …')}</button>` : ''}
           <button class="btn btn-sm" id="d-sec-lock" title="${T18('Schlüssel bis zum nächsten Entsperren aus dem Speicher des Dienstes nehmen')}">${T18('Sperren')}</button>`
        : `<button class="btn btn-sm" id="d-sec-unlock">${st && !st.exists ? T18('Schlüsselablage anlegen …') : T18('Entsperren …')}</button>`}
    </div>
    ${hints.join('')}`;
}

function wireDevice(panel, dev) {
  const on = (sel, fn) => { const el = panel.querySelector(sel); if (el) el.addEventListener('click', fn); };
  const box = panel.querySelector('#d-secure');
  if (box) box.addEventListener('change', () => {
    if (box.checked) dev.secure = true;
    else delete dev.secure;
    KNX.touch();
    A.commit();
  });
  on('#d-cert', () => enterCertificate(dev.id));
  on('#d-cert-del', () => removeCertificate(dev.id));
  on('#d-sec-unlock', () => ensureUnlocked());
  on('#d-sec-lock', () => lock());
}

function gaSection(ga) {
  const links = KNX.gaLinks(ga.id);
  const an = KNX.proxyAnalysis ? KNX.proxyAnalysis() : null;
  // Wen ein Security Proxy bedient, der versteht die Adresse auch ohne Secure (knx-proxy.js)
  const plain = an
    ? [...new Set(an.mixed.filter(m => m.ga.id === ga.id).map(m => m.dev))]
    : [...new Set(links.filter(l => !l.dev.secure).map(l => l.dev))];
  const unbridged = an ? an.blocked.filter(b => b.ga.id === ga.id) : [];
  const proxies = [];
  if (an) an.proxies.forEach(p => { if (p.entries.some(e => e.ga === ga.id)) proxies.push(p.dev); });
  return `<h3 class="detail-h">${A.IC_LOCK} KNX Secure</h3>
    <label class="chk detail-field" title="${T18('Telegramme auf dieser Adresse werden authentifiziert und verschlüsselt')}">
      <input type="checkbox" id="d-ga-secure"${ga.secure ? ' checked' : ''}> ${T18('Sicher (Gruppenschlüssel)')}</label>
    ${ga.secure && plain.length
      ? `<p class="hint warn">${T18('Ohne Secure geladen, verstehen diese Geräte die Adresse nicht: {0}', plain.map(d => esc(KNX.paStr(d.addr) + ' ' + d.name)).join(', '))}</p>`
      : ''}
    ${ga.secure && unbridged.length
      ? `<p class="hint warn">${T18('An {0} trifft die Adresse auf unverschlüsselte Teilnehmer, ohne dass ein Security Proxy übersetzt.', unbridged.map(b => esc(KNX.paStr(b.pa))).join(', '))}</p>`
      : ''}
    ${ga.secure && proxies.length
      ? `<p class="hint">${T18('Security Proxy übersetzt für die unverschlüsselte Seite: {0}', proxies.map(d => esc(KNX.paStr(d.addr) + ' ' + d.name)).join(', '))}</p>`
      : ''}
    ${ga.secure && !plain.length && !unbridged.length
      ? `<p class="hint">${T18('Wirksam, sobald alle zugeordneten Geräte neu programmiert sind. Den Schlüssel erzeugt der Dienst beim ersten Laden.')}</p>`
      : ''}`;
}

function wireGa(panel, ga) {
  const box = panel.querySelector('#d-ga-secure');
  if (box) box.addEventListener('change', () => {
    if (box.checked) ga.secure = true;
    else delete ga.secure;
    KNX.touch();
    A.commit();
  });
}

window.KNXSecure = {
  available, known, refresh, relevant, keysOf,
  ensureUnlocked, lock, enterCertificate, removeCertificate, bindForBus,
  deviceSection, wireDevice, gaSection, wireGa,
  onChange: fn => { listeners.add(fn); return () => listeners.delete(fn); }
};

})();
