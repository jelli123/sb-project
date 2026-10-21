/* ============================================================
   KNX-Struktur — Handbücher für die KI
   ------------------------------------------------------------
   PDF-Handbücher, die der Nutzer selbst hochlädt — im KI-Chat
   oder im Produktkatalog. Sie liegen im Datenverzeichnis des
   Dienstes (server: chat/ManualStore.java), für alle Projekte
   gemeinsam, und werden Produkten über Hersteller und
   Bestellnummer zugeordnet. Die KI findet sie mit list_manuals
   und liest im Chat nur die Seiten, die sie braucht. Aus dem
   Internet wird nichts geladen.
   ============================================================ */
'use strict';

(() => {

const A = window.KNXApp, $ = s => document.querySelector(s);
const esc = A.esc, T18 = A.t;
const B = window.KNXBackend;

if (!B || !B.manuals) { window.KNXManuals = { available: false }; return; }

const L = v => (v && typeof v === 'object' ? A.L(v) : String(v ?? ''));

/* Ein Produkt ist dasselbe, wenn Hersteller und Bestellnummer passen — ohne
   Bestellnummer zählt der Name. So gilt die Zuordnung in jedem Projekt. */
const norm = s => L(s).toLowerCase().replace(/\s+/g, '');
const productKey = p => norm(p.manufacturer) + '|' + (norm(p.order) || '#' + norm(p.name));
const asProduct = c => ({ manufacturer: L(c.manufacturer), order: L(c.order), name: L(c.name) });

let cache = [];
async function load() {
  cache = (await B.manuals.list()).manuals || [];
  return cache;
}

/** Handbücher zu einem Katalogeintrag des Projekts. */
const forItem = (c, list = cache) => {
  const k = productKey(asProduct(c));
  return list.filter(m => (m.products || []).some(p => productKey(p) === k));
};

const titleOf = file => {
  const m = cache.find(x => x.file === file);
  return m ? m.title : null;
};

const fmtSize = n => n >= 1 << 20
  ? (n / (1 << 20)).toLocaleString(T18('de-DE'), { maximumFractionDigits: 1 }) + ' MB'
  : Math.max(1, Math.round(n / 1024)) + ' KB';

/** Dateien hochladen; ein Produkt aus dem Katalog wird gleich zugeordnet. */
async function upload(files, item) {
  const done = [];
  for (const f of files) {
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') {
      A.warn(T18('„{0}“ ist keine PDF-Datei.', f.name));
      continue;
    }
    try {
      let m = await B.manuals.upload(f.name, new Uint8Array(await f.arrayBuffer()));
      if (item) m = await B.manuals.update({ id: m.id, products: [asProduct(item)] });
      done.push(m);
    } catch (e) {
      A.warn(T18('„{0}“ nicht hochgeladen: {1}', f.name, e.message));
    }
  }
  await load().catch(() => {});
  return done;
}

const pickFiles = () => new Promise(resolve => {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'application/pdf,.pdf';
  inp.multiple = true;
  inp.onchange = () => resolve([...inp.files]);
  inp.click();
});

/**
 * Die Handbücher verwalten. Mit `item` (Katalogeintrag) stehen dessen
 * Handbücher oben und neue werden ihm gleich zugeordnet; `onUpload` meldet
 * neu hochgeladene (der Chat sagt es der KI dann).
 */
async function open({ item = null, onUpload = null } = {}) {
  try { await load(); }
  catch (e) { A.warn(T18('Handbücher nicht lesbar: {0}', e.message)); return; }
  const catalog = KNX.project().catalog;
  let query = '';

  const row = m => {
    const own = item && forItem(item, [m]).length;
    const prods = (m.products || []).map((p, i) => `
      <span class="man-prod" title="${esc([p.manufacturer, p.order].filter(Boolean).join(' · '))}">
        ${esc(p.name || p.order)}
        <button type="button" class="icon-btn" data-unlink="${i}" aria-label="${esc(T18('Zuordnung entfernen'))}">×</button>
      </span>`).join('');
    const keys = new Set((m.products || []).map(productKey));
    const options = catalog.filter(c => !keys.has(productKey(asProduct(c))));
    return `
      <div class="man-row${own ? ' sel' : ''}" data-id="${esc(m.id)}">
        <div class="man-main">
          <input class="input" data-title value="${esc(m.title)}" maxlength="200" aria-label="${esc(T18('Titel'))}">
          <span class="hint">${m.pages ? T18('{0} Seiten', m.pages) : T18('Seitenzahl unbekannt')} · ${esc(fmtSize(m.bytes))}</span>
          <div class="man-prods">${prods || `<span class="hint">${T18('keinem Produkt zugeordnet')}</span>`}
            ${options.length ? `<select class="select" data-link aria-label="${esc(T18('Produkt zuordnen'))}">
              <option value="">${T18('+ Produkt zuordnen …')}</option>
              ${options.map(c => `<option value="${esc(c.id)}">${esc(L(c.name))}${c.order ? ' · ' + esc(L(c.order)) : ''}</option>`).join('')}
            </select>` : ''}
          </div>
        </div>
        <div class="man-act">
          <a class="btn btn-sm" href="${esc(B.manuals.fileUrl(m.id))}" target="_blank" rel="noopener">${T18('Ansehen')}</a>
          <button type="button" class="icon-btn" data-del title="${esc(T18('Handbuch löschen'))}">${A.IC_TRASH}</button>
        </div>
      </div>`;
  };

  const list = () => {
    const q = query.toLowerCase();
    const shown = cache.filter(m => !q || [m.title, ...(m.products || []).flatMap(p => [p.name, p.order, p.manufacturer])]
      .some(s => String(s || '').toLowerCase().includes(q)));
    if (item) shown.sort((a, b) => forItem(item, [b]).length - forItem(item, [a]).length);
    return shown.length ? shown.map(row).join('')
      : `<p class="hint">${cache.length ? T18('Keine Treffer.') : T18('Noch keine Handbücher.')}</p>`;
  };

  A.openModal(item ? T18('Handbücher — {0}', L(item.name)) : T18('Handbücher'), `
    <p class="hint">${T18('PDF-Handbücher, die die KI im Chat lesen darf — sie sucht erst im Inhaltsverzeichnis und liest dann nur die passenden Seiten. Die Dateien bleiben auf diesem Rechner; gelesene Seiten gehen an den KI-Anbieter. Deshalb nur Herstellerunterlagen hochladen, nichts Persönliches.')}</p>
    <div class="pick-row">
      <button type="button" class="btn btn-sm btn-primary" id="man-up">${T18('PDF hochladen …')}</button>
      <input class="input" id="man-search" placeholder="${esc(T18('Handbücher durchsuchen …'))}">
    </div>
    <div class="chk-list tall" id="man-list">${list()}</div>`, () => {});
  $('#modal-ok').textContent = T18('Schließen');
  $('#modal-cancel').hidden = true;

  const repaint = () => { $('#man-list').innerHTML = list(); };
  const save = async (id, patch) => {
    try {
      const m = await B.manuals.update({ id, ...patch });
      cache = cache.map(x => (x.id === id ? m : x));
    } catch (e) { A.warn(T18('Handbuch nicht gespeichert: {0}', e.message)); }
  };

  $('#man-up').addEventListener('click', async () => {
    const files = await pickFiles();
    if (!files.length) return;
    $('#man-up').disabled = true;
    const done = await upload(files, item);
    if ($('#man-up')) { $('#man-up').disabled = false; repaint(); }
    if (done.length) {
      A.status(done.length === 1 ? T18('Handbuch „{0}“ hochgeladen', done[0].title) : T18('{0} Handbücher hochgeladen', done.length));
      if (onUpload) onUpload(done);
    }
  });
  $('#man-search').addEventListener('input', e => { query = e.target.value.trim(); repaint(); });

  const listEl = $('#man-list');
  listEl.addEventListener('change', async e => {
    const r = e.target.closest('.man-row');
    if (!r) return;
    const m = cache.find(x => x.id === r.dataset.id);
    if (e.target.matches('[data-title]')) {
      await save(m.id, { title: e.target.value });
    } else if (e.target.matches('[data-link]') && e.target.value) {
      const c = catalog.find(x => x.id === e.target.value);
      await save(m.id, { products: [...(m.products || []), asProduct(c)] });
      repaint();
    }
  });
  listEl.addEventListener('click', async e => {
    const r = e.target.closest('.man-row');
    if (!r) return;
    const m = cache.find(x => x.id === r.dataset.id);
    const un = e.target.closest('[data-unlink]');
    if (un) {
      await save(m.id, { products: m.products.filter((p, i) => i !== +un.dataset.unlink) });
      repaint();
    } else if (e.target.closest('[data-del]')) {
      // Erst der zweite Klick löscht
      const b = e.target.closest('[data-del]');
      if (!b.classList.contains('armed')) {
        b.classList.add('armed');
        b.title = T18('Nochmals klicken: „{0}“ löschen', m.title);
        return;
      }
      try {
        await B.manuals.remove(m.id);
        cache = cache.filter(x => x.id !== m.id);
        repaint();
      } catch (err) { A.warn(T18('Löschen fehlgeschlagen: {0}', err.message)); }
    }
  });
}

load().catch(() => {});

window.KNXManuals = { available: true, open, load, forItem, titleOf, productKey, asProduct, list: () => cache };

})();
