/* ============================================================
   KNX-Struktur — Init: Start, Topbar, Sortierung, Tastatur,
   Import/Export
   ============================================================ */
'use strict';

(() => {
const A = window.KNXApp, G = window.KNXGA, T = window.KNXTopo, $ = s => document.querySelector(s);
const T18 = A.t;
const state = A.state, esc = A.esc;

/* ---------- Start ---------- */
KNX.load();
A.restoreUI();
A.initHistory();
A.initNav();
syncProjectMeta();
window.KNXOnRender();
A.syncHistoryButtons();
showMigrationNotes();

function syncProjectMeta() {
  const p = KNX.project();
  $('#project-name').value = p.name;
  $('#project-kind').textContent = p.isSample ? 'Musterprojekt' : 'Eigenes Projekt';
  $('#ga-style').value = p.gaStyle;
}

/* Was die Migration an den Daten geändert hat, darf nicht unbemerkt bleiben. */
function showMigrationNotes() {
  const n = KNX.migrationNotes();
  if (!n.length) return;
  A.openModal(T18('Projekt angepasst'), `
    <p>${T18('Beim Laden wurden Daten an das aktuelle Modell angeglichen:')}</p>
    <ul class="issue-list">${n.map(x => `<li class="info">${esc(x)}</li>`).join('')}</ul>
    <p class="hint">${T18('Die Änderungen sind bereits gespeichert. Bei Bedarf die alte Datei aufbewahren und die betroffenen Adressen nachziehen.')}</p>
  `, () => {});
  $('#modal-cancel').hidden = true;
}

/* ---------- Modal-Events ---------- */
$('#modal-cancel').addEventListener('click', () => A.closeModal());
$('#modal-ok').addEventListener('click', () => A.modalConfirm());
$('#modal-backdrop').addEventListener('click', e => {
  if (e.target.id === 'modal-backdrop') A.closeModal();
});

/* ---------- Projektname ---------- */
$('#project-name').addEventListener('change', e => {
  const name = e.target.value.trim() || 'Mein Wohnobjekt';
  KNX.project().name = name;
  KNX.findNode(KNX.project().tree.id).name = name;
  KNX.project().isSample = false;
  A.commit();
  syncProjectMeta();
});

/* ---------- Adressstil (projektweit, wie in der ETS) ---------- */
$('#ga-style').addEventListener('change', e => {
  KNX.project().gaStyle = e.target.value;
  A.commit();
  A.status(T18('Adressdarstellung: {0}', KNX.gaStyle().label));
});

/* ---------- Ansichtsumschalter ---------- */
document.querySelectorAll('.tab[data-view]').forEach(tab => {
  tab.addEventListener('click', () => {
    state.view = tab.dataset.view;
    // Beim Wechsel den Filter verwerfen, wenn er zur neuen Ansicht nicht passt
    const ok = { building: ['node'], topology: ['area', 'line', 'dev'], ga: ['grp'] };
    if (state.filter && !ok[state.view].includes(state.filter.kind)) state.filter = null;
    if (state.view === 'topology') state.mid = 'dev';
    if (state.view === 'ga') state.mid = 'ga';
    A.persistUI();
    window.KNXOnRender();
  });
});
document.querySelectorAll('.tab[data-mid]').forEach(tab => {
  tab.addEventListener('click', () => {
    state.mid = tab.dataset.mid;
    state.sort = { key: 'addr', dir: 1 };
    A.persistUI();
    window.KNXOnRender();
  });
});

/* ---------- Verlauf: Ansicht und Bearbeitung ---------- */
$('#btn-back').addEventListener('click', () => A.navGo(-1));
$('#btn-fwd').addEventListener('click', () => A.navGo(1));
$('#btn-undo').addEventListener('click', () => A.undo());
$('#btn-redo').addEventListener('click', () => A.redo());

/* ---------- Spaltenbreiten ---------- */
const COL = { left: '--col-left', right: '--col-right' };
const COL_MIN = 220, COL_DEFAULT = { left: 300, right: 340 };

function setCol(edge, px) {
  const max = Math.max(COL_MIN, window.innerWidth - COL_MIN * 2 - 40);
  const v = Math.min(Math.max(px, COL_MIN), max);
  document.documentElement.style.setProperty(COL[edge], v + 'px');
  return v;
}
function storeCols() {
  try {
    const s = getComputedStyle(document.documentElement);
    localStorage.setItem('knx-cols-v1', JSON.stringify({
      left: parseInt(s.getPropertyValue(COL.left)) || COL_DEFAULT.left,
      right: parseInt(s.getPropertyValue(COL.right)) || COL_DEFAULT.right
    }));
  } catch (e) {}
}
(function restoreCols() {
  try {
    const c = JSON.parse(localStorage.getItem('knx-cols-v1') || '{}');
    setCol('left', +c.left || COL_DEFAULT.left);
    setCol('right', +c.right || COL_DEFAULT.right);
  } catch (e) {
    setCol('left', COL_DEFAULT.left);
    setCol('right', COL_DEFAULT.right);
  }
})();

document.querySelectorAll('.resizer').forEach(bar => {
  const edge = bar.dataset.edge;
  bar.addEventListener('pointerdown', e => {
    e.preventDefault();
    bar.setPointerCapture(e.pointerId);
    bar.classList.add('dragging');
    document.body.classList.add('resizing');
    const startX = e.clientX;
    const start = parseInt(getComputedStyle(document.documentElement)
      .getPropertyValue(COL[edge])) || COL_DEFAULT[edge];

    const move = ev => {
      const d = ev.clientX - startX;
      setCol(edge, edge === 'left' ? start + d : start - d);
    };
    const up = () => {
      bar.releasePointerCapture(e.pointerId);
      bar.classList.remove('dragging');
      document.body.classList.remove('resizing');
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', up);
      bar.removeEventListener('pointercancel', up);
      storeCols();
      window.KNXRender.paintTreeViewport();
      window.KNXRender.paintTable();
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
    bar.addEventListener('pointercancel', up);
  });

  bar.addEventListener('dblclick', () => {
    setCol(edge, COL_DEFAULT[edge]);
    storeCols();
    A.status(T18('Spaltenbreite zurückgesetzt'));
  });

  bar.addEventListener('keydown', e => {
    const step = e.shiftKey ? 40 : 12;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const cur = parseInt(getComputedStyle(document.documentElement)
      .getPropertyValue(COL[edge])) || COL_DEFAULT[edge];
    const d = e.key === 'ArrowRight' ? step : -step;
    setCol(edge, edge === 'left' ? cur + d : cur - d);
    storeCols();
  });
});

/* ---------- Suche ---------- */
let searchTimer = null;
$('#search').addEventListener('input', e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.search = e.target.value.trim().toLowerCase();
    window.KNXOnRender();
  }, 150);
});

/* ---------- Virtualisierung: nur den sichtbaren Ausschnitt zeichnen ---------- */
let rafTree = 0, rafTable = 0;
$('#tree').addEventListener('scroll', () => {
  if (rafTree) return;
  rafTree = requestAnimationFrame(() => { rafTree = 0; window.KNXRender.paintTreeViewport(); });
}, { passive: true });
$('#ga-scroll').addEventListener('scroll', () => {
  if (rafTable) return;
  rafTable = requestAnimationFrame(() => { rafTable = 0; window.KNXRender.paintTable(); });
}, { passive: true });
window.addEventListener('resize', () => {
  window.KNXRender.paintTreeViewport();
  window.KNXRender.paintTable();
});

/* ---------- Aktionen ---------- */
$('#btn-tree-add').addEventListener('click', () => {
  if (state.view === 'building')
    A.actNewNode(state.sel?.kind === 'node' ? state.sel.id : KNX.project().tree.id);
  else if (state.view === 'topology') T.actNewArea();
  else if (G.folderDepth() >= 1) G.actNewGaGroup('');
  else G.actNewGa();
});
$('#btn-add-row').addEventListener('click', () =>
  state.mid === 'ga' ? G.actNewGa() : T.actNewDevice());
$('#btn-clear-filter').addEventListener('click', () => {
  state.filter = null;
  A.persistUI();
  window.KNXOnRender();
});
$('#btn-del-sel').addEventListener('click', () => G.actDeleteSelected());
$('#btn-move-sel').addEventListener('click', () => G.actMoveGas([...state.checked]));
$('#chk-all').addEventListener('change', e => {
  const gs = A.visibleGAs();
  if (e.target.checked) gs.forEach(g => state.checked.add(g.id));
  else gs.forEach(g => state.checked.delete(g.id));
  window.KNXOnRender();
});
$('#btn-issues').addEventListener('click', () => showIssues());

/* ---------- Prüfliste ---------- */
function showIssues() {
  const all = KNX.issues();
  const label = i => {
    if (i.kind === 'ga') { const g = KNX.gaById(i.id); return g ? KNX.addrStr(g) + ' ' + g.name : ''; }
    if (i.kind === 'device') { const d = KNX.deviceById(i.id); return d ? KNX.paStr(d.addr) + ' ' + d.name : ''; }
    if (i.kind === 'line') return T18('Linie {0}', KNX.lineLabel(i.id));
    if (i.kind === 'seg') { const s = KNX.segmentInfo(i.id); return s ? T18('Linie {0}', KNX.lineLabel(s.line.id)) + ' · ' + s.name : ''; }
    if (i.kind === 'fn') { const f = KNX.functionById(i.id); return f ? T18('Funktion {0}', f.name) : ''; }
    if (i.kind === 'area') { const a = KNX.project().areas.find(x => x.id === i.id); return a ? T18('Bereich {0}', a.name) : ''; }
    return '';
  };
  const order = { error: 0, warn: 1, info: 2 };
  all.sort((a, b) => order[a.level] - order[b.level]);
  const n = l => all.filter(i => i.level === l).length;
  A.openModal(T18('Prüfergebnis — {0} Fehler, {1} Hinweise, {2} Anmerkungen', n('error'), n('warn'), n('info')), `
    <ul class="issue-list big" id="m-issues">
      ${all.map(i => `<li class="${i.level}" data-kind="${i.kind === 'device' ? 'dev' : i.kind}" data-id="${i.id}">
        <b>${esc(label(i))}</b><span>${esc(i.msg)}</span></li>`).join('')
        || `<li class="ok">${T18('Keine Auffälligkeiten.')}</li>`}
    </ul>
  `, () => {});
  $('#m-issues').addEventListener('click', ev => {
    const li = ev.target.closest('li[data-id]');
    if (!li) return;
    A.closeModal();
    window.KNXRender.jumpTo(li.dataset.kind, li.dataset.id);
  });
}


/* ---------- Sortierung ---------- */
document.querySelectorAll('th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    const key = th.dataset.key;
    if (state.sort.key === key) state.sort.dir *= -1;
    else state.sort = { key, dir: 1 };
    A.persistUI();
    window.KNXOnRender();
  });
});

/* ---------- Kontextmenü ---------- *
 * Baum- und Tabellenzeilen hängen sich in app-render.js selbst ein, weil dort
 * die Referenz schon im Closure liegt. Hier bleibt der Detailbereich, dessen
 * Verweise kind und id im DOM tragen — delegiert, weil sein Inhalt bei jedem
 * Rendern ersetzt wird, der Behälter selbst aber bleibt.                    */
$('#detail')?.addEventListener('contextmenu', ev => {
  if (A.nativeMenuWins(ev)) return;
  const row = ev.target.closest('[data-kind][data-id]');
  if (row) A.contextMenuFor(ev, row.dataset.kind, row.dataset.id);
});

/* ---------- Sprache ---------- *
 * Umgeschaltet wird in KNXI18n; der feste Text im Markup zieht dort selbst
 * nach. Hier kommt nur das Ausgeben der Auswahl und das Neuzeichnen dazu —
 * die Bäume, Tabellen und Detailtexte entstehen ja im Skript.              */
const langSel = $('#ui-lang');
if (langSel && window.KNXI18n) {
  langSel.innerHTML = Object.entries(KNXI18n.LANGS)
    .map(([code, name]) => `<option value="${code}">${esc(name)}</option>`).join('');
  langSel.value = KNXI18n.lang();
  langSel.addEventListener('change', e => KNXI18n.set(e.target.value));
  KNXI18n.onChange(() => {
    langSel.value = KNXI18n.lang();
    syncThemeButton();
    window.KNXOnRender();
  });
}

/* ---------- Darstellung: hell, dunkel, automatisch ---------- *
 * Das Umlegen selbst macht KNXTheme im Kopf der Seite - dort, weil es vor
 * dem Stylesheet passieren muss. Hier haengt nur der Knopf daran.        */

const THEME_LABEL = { system: 'Automatisch', light: 'Hell', dark: 'Dunkel' };
const themeLabel = mode => T18(THEME_LABEL[mode] || mode);
const THEME_ICON = {
  // Halb gefuellter Kreis: folgt der Systemvorgabe
  system: '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4">'
    + '<circle cx="8" cy="8" r="5.5"/><path d="M8 2.5a5.5 5.5 0 0 0 0 11z" fill="currentColor" stroke="none"/></svg>',
  light: '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4">'
    + '<circle cx="8" cy="8" r="3.1"/><path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15'
    + 'M3.05 3.05l1.13 1.13M11.82 11.82l1.13 1.13M12.95 3.05l-1.13 1.13M4.18 11.82l-1.13 1.13"/></svg>',
  dark: '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4">'
    + '<path d="M13 9.8A5.6 5.6 0 0 1 6.2 3a5.6 5.6 0 1 0 6.8 6.8z"/></svg>'
};

function syncThemeButton() {
  const btn = $('#btn-theme'), th = window.KNXTheme;
  if (!btn || !th) return;
  const mode = th.mode();
  btn.innerHTML = THEME_ICON[mode];
  btn.title = T18('Darstellung: {0}', themeLabel(mode))
    + (mode === 'system' ? ' ' + T18('(gerade {0})', themeLabel(th.resolved())) : '')
    + ' ' + T18('— klicken für {0}', themeLabel(th.next()));
  btn.setAttribute('aria-label', btn.title);
}

if ($('#btn-theme') && window.KNXTheme) {
  $('#btn-theme').addEventListener('click', () => {
    window.KNXTheme.set(window.KNXTheme.next());
    syncThemeButton();
  });
  // Wechselt die Systemvorgabe, waehrend „Automatisch“ laeuft, stimmt sonst der Hinweistext nicht mehr.
  window.matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', syncThemeButton);
  syncThemeButton();
}

/* ---------- Import / Export ---------- */
$('#btn-export').addEventListener('click', () => {
  const p = KNX.project();
  const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = p.name.toLowerCase().replace(/[^\wäöüß]+/gi, '-').replace(/^-|-$/g, '') + '.knx.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  A.status(T18('Projekt exportiert.'));
});
$('#btn-import').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (/\.knxproj$/i.test(file.name)) { importEts(file); return; }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const p = KNX.migrate(JSON.parse(reader.result));
      if (!p) throw new Error('Kein KNX-Projekt');
      takeProject(p);
      A.toast(T18('Projekt importiert.'));
      showMigrationNotes();
    } catch (err) {
      A.warn(T18('Datei konnte nicht gelesen werden (unerwartetes Format).'));
    }
  };
  reader.readAsText(file);
});

function takeProject(p) {
  p.isSample = false;
  state.sel = null; state.filter = null; state.checked.clear();
  state.collapsed.clear();
  KNX.setProject(p);
  if (!KNX.save()) A.warn(KNX.saveError());
  A.resetHistory();
  A.persistUI();
  syncProjectMeta();
  window.KNXOnRender();
}

/* ETS-Projekt: erst lesen und zeigen, was ankommt und was nicht — ersetzt
   wird das aktuelle Projekt erst nach dem Bestätigen. */
async function importEts(file) {
  A.status(T18('Lese {0} …', file.name));
  let p, report;
  try {
    const r = await KNXProj.read(file);
    report = r.report;
    p = KNX.migrate(r.project);
    if (!p) throw new Error('Kein KNX-Projekt');
  } catch (err) {
    A.status('');
    A.warn(T18('ETS-Projekt nicht lesbar: {0}', err && err.message ? err.message : err));
    return;
  }
  A.status('');
  const notes = KNX.migrationNotes();
  const objs = p.devices.reduce((n, d) => n + d.objs.length, 0);
  const links = p.devices.reduce((n, d) => n + d.objs.reduce((m, o) => m + o.gas.length, 0), 0);
  let nodes = -1;
  KNX.walk(p.tree, () => { nodes++; });
  const row = (label, n) => `<li class="ok"><b>${n}</b><span>${label}</span></li>`;
  A.openModal(T18('ETS-Projekt „{0}“ importieren', p.name), `
    <ul class="issue-list">
      ${row(T18('Gebäudeteile und Räume'), nodes)}
      ${row(T18('Bereiche und Linien'), p.areas.filter(a => !a.backbone).length + ' / '
        + p.areas.reduce((n, a) => n + a.lines.length, 0))}
      ${row(T18('Geräte'), p.devices.length)}
      ${row(T18('Kommunikationsobjekte, davon verknüpft'), objs + ' / ' + p.devices.reduce((n, d) =>
        n + d.objs.filter(o => o.gas.length).length, 0))}
      ${row(T18('Gruppenadressen'), p.groups.length)}
      ${row(T18('Verknüpfungen'), links)}
      ${row(T18('Funktionen'), p.functions.length)}
      ${row(T18('Produkte im Katalog'), p.catalog.length)}
    </ul>
    ${report.length || notes.length ? `
      <p>${T18('Nicht alles ließ sich übernehmen:')}</p>
      <ul class="issue-list">
        ${report.map(x => `<li class="warn">${esc(T18(x.msg, ...x.args))}</li>`).join('')}
        ${notes.map(x => `<li class="info">${esc(x)}</li>`).join('')}
      </ul>` : ''}
    <p class="hint">${T18('Das aktuelle Projekt („<b>{0}</b>“) wird ersetzt. Vorher per <b>Export</b> sichern?', esc(KNX.project().name))}</p>
  `, () => {
    takeProject(p);
    A.toast(T18('ETS-Projekt importiert.'));
  });
}

/* ---------- Neues Projekt ---------- */
$('#btn-new').addEventListener('click', () => {
  A.openModal(T18('Neues Projekt starten'), `
    <p>${T18('Das aktuelle Projekt („<b>{0}</b>“) wird ersetzt. Vorher per <b>Export</b> sichern?', esc(KNX.project().name))}</p>
    <label class="field"><span>${T18('Name des neuen Objekts')}</span>
      <input class="input" id="m-name" maxlength="40" placeholder="${T18('z. B. Haus Bergstraße 4')}">
    </label>
  `, () => {
    const name = $('#m-name').value.trim();
    if (!name) { $('#m-name').focus(); return false; }
    const p = KNX.newProject(name);
    p.gaStyle = KNX.project().gaStyle;
    KNX.setProject(p);
    if (!KNX.save()) A.warn(KNX.saveError());
    A.resetHistory();
    state.sel = null; state.filter = null; state.checked.clear();
    state.collapsed.clear();
    A.persistUI();
    syncProjectMeta();
    window.KNXOnRender();
  });
});

/* ---------- Tastatur ---------- */
document.addEventListener('keydown', e => {
  const modalOpen = $('#modal-backdrop').classList.contains('open');
  if (modalOpen) {
    if (e.key === 'Escape') { A.closeModal(); return; }
    if (e.key === 'Enter' && document.activeElement?.tagName === 'INPUT') {
      e.preventDefault();
      $('#modal-ok').click();
    }
    return;
  }

  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    e.shiftKey ? A.redo() : A.undo();
    return;
  }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); A.redo(); return; }
  if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); $('#search').focus(); return; }
  if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); A.navGo(-1); return; }
  if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); A.navGo(1); return; }

  const inField = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);
  if (inField) {
    if (e.key === 'Escape' && document.activeElement.id === 'search') {
      document.activeElement.value = '';
      state.search = '';
      document.activeElement.blur();
      window.KNXOnRender();
    }
    return;
  }

  if (e.key === 'Escape' && (state.sel || state.filter)) {
    state.sel = null;
    state.filter = null;
    A.persistUI();
    window.KNXOnRender();
  }
  if (e.key === 'Delete' && state.sel) {
    e.preventDefault();
    deleteSelected();
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const dir = e.key === 'ArrowDown' ? 1 : -1;
    const onRow = document.activeElement?.classList?.contains('tree-row');
    const inTable = document.activeElement?.closest?.('#ga-scroll tr');
    if (inTable) { e.preventDefault(); moveTableSelection(dir); }
    else if (!onRow) { e.preventDefault(); window.KNXRender.moveTreeSel(dir); }
  }
});

function deleteSelected() {
  const s = state.sel;
  if (!s) return;
  switch (s.kind) {
    case 'node': A.actDeleteNode(s.id); break;
    case 'ga':   G.actDeleteGa(s.id); break;
    case 'dev':  T.actDeleteDevice(s.id); break;
    case 'obj':  T.actDeleteObj(s.id); break;
    case 'line': T.actDeleteLine(s.id); break;
    case 'area': T.actDeleteArea(s.id); break;
  }
}

function moveTableSelection(delta) {
  const isGa = state.mid === 'ga';
  const rows = isGa ? A.visibleGAs() : A.visibleDevices();
  if (!rows.length) return;
  const kind = isGa ? 'ga' : 'dev';
  let idx = state.sel?.kind === kind ? rows.findIndex(r => r.id === state.sel.id) : -1;
  idx = Math.min(Math.max(idx + delta, 0), rows.length - 1);
  A.select(kind, rows[idx].id);
  document.querySelector('#ga-scroll tr.sel')?.focus();
}

})();

