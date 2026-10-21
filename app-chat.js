/* ============================================================
   KNX-Struktur — KI-Chat im Fenster
   ------------------------------------------------------------
   Ein Gespräch mit Claude direkt in SB-Projekt, ohne externes
   Werkzeug. Der Dienst startet dafür die Claude-Code-Kommando-
   zeile des Nutzers (server: chat/ChatService.java) — nur mit
   den Werkzeugen von sb-projekt. Was die KI am Projekt sieht
   und ändert, läuft deshalb über denselben Weg wie jede andere
   KI-Sitzung: Freigabe am Schalter, Platzhalter, Vorschläge,
   Bestätigung. Auch die eigene Nachricht bekommt Platzhalter,
   bevor sie hinausgeht; die Antwort kommt in Klartext zurück.

   Gespräche werden je Projekt im Datenverzeichnis gespeichert
   (server: chat/ChatHistory.java). Nach einem Neustart erscheint
   das letzte wieder und lässt sich fortsetzen; ältere öffnet der
   Verlauf.
   ============================================================ */
'use strict';

(() => {

const A = window.KNXApp, $ = s => document.querySelector(s);
const esc = A.esc, T18 = A.t;
const B = window.KNXBackend, M = window.KNXMcp;

if (!B || !B.chat || !M || !M.available) { window.KNXChat = { available: false }; return; }

/* ---------- Reiter in der rechten Spalte ---------- */

const pane = $('#detail').closest('.pane');
const head = pane.querySelector('.pane-head');
head.innerHTML = `
  <div class="tabs" role="tablist" aria-label="${T18('Rechte Spalte')}">
    <button class="tab" data-right="detail" role="tab">${T18('Details')}</button>
    <button class="tab" data-right="chat" role="tab">${T18('KI-Chat')}</button>
  </div>`;

const box = document.createElement('div');
box.id = 'chat';
box.className = 'chat';
box.hidden = true;
box.innerHTML = `
  <div class="chat-log" id="chat-log" aria-live="polite"></div>
  <p class="chat-note hint" id="chat-note" hidden></p>
  <form class="chat-form" id="chat-form">
    <p class="chat-info" id="chat-info"></p>
    <textarea class="input" id="chat-input" rows="3" maxlength="8000" spellcheck="true"
              placeholder="${T18('Was soll geplant werden? Enter sendet, Umschalt+Enter macht eine neue Zeile.')}"></textarea>
    <div class="chat-btns">
      <select class="select" id="chat-model" title="${T18('Opus plant am gründlichsten, Haiku ist am schnellsten und schont das Kontingent')}">
        <option value="">${T18('Modell: Standard (laut Konto)')}</option>
        <option value="opus">${T18('Gründlich (Opus)')}</option>
        <option value="sonnet">${T18('Ausgewogen (Sonnet)')}</option>
        <option value="haiku">${T18('Schnell (Haiku)')}</option>
      </select>
      <select class="select" id="chat-effort" title="${T18('Mehr Aufwand plant gründlicher, braucht aber länger und mehr Kontingent')}">
        <option value="">${T18('Aufwand: Standard')}</option>
        <option value="low">${T18('Aufwand: niedrig')}</option>
        <option value="medium">${T18('Aufwand: mittel')}</option>
        <option value="high">${T18('Aufwand: hoch')}</option>
        <option value="xhigh">${T18('Aufwand: sehr hoch')}</option>
      </select>
    </div>
    <div class="chat-btns">
      <button type="button" class="btn btn-sm" id="chat-new" title="${T18('Die KI vergisst das bisherige Gespräch')}">${T18('Neues Gespräch')}</button>
      <button type="button" class="btn btn-sm" id="chat-history">${T18('Verlauf …')}</button>
      <span class="spacer"></span>
      <button type="button" class="btn btn-sm" id="chat-stop" hidden>${T18('Anhalten')}</button>
      <button type="submit" class="btn btn-sm btn-primary" id="chat-send">${T18('Senden')}</button>
    </div>
  </form>`;
pane.appendChild(box);

const RIGHT_KEY = 'knx-right-v1';
function show(which) {
  const chat = which === 'chat';
  $('#detail').hidden = chat;
  box.hidden = !chat;
  head.querySelectorAll('.tab[data-right]').forEach(t => {
    const on = t.dataset.right === which;
    t.classList.toggle('on', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  try { localStorage.setItem(RIGHT_KEY, which); } catch (e) { /* nur Komfort */ }
  if (chat) { sync(); $('#chat-input').focus(); scrollDown(); }
}
head.querySelectorAll('.tab[data-right]').forEach(t => t.addEventListener('click', () => show(t.dataset.right)));

/* ---------- Zustand ---------- */

const chat = { running: false, available: null, cli: null, bubble: null, turn: null, conversation: null };

async function checkCli() {
  try {
    const s = await B.chat.status();
    chat.available = !!s.available;
    chat.cli = s;
    chat.running = !!s.running;
  } catch (e) {
    chat.available = false;
  }
  sync();
}

/* Womit gechattet wird: Version und Anmeldung. Eine API-Anmeldung kostet pro
   Nachricht — die steht deshalb farbig da. */
function info() {
  const s = chat.cli;
  if (!s || !s.available) return { text: '', warn: false };
  const v = s.version ? 'Claude Code ' + s.version : 'Claude Code';
  if (!s.loggedIn) return { text: v + ' · ' + T18('nicht angemeldet'), warn: true };
  if (s.method === 'claude.ai')
    return { text: v + ' · ' + (s.plan ? T18('Claude-Abo ({0})', s.plan) : T18('Claude-Abo')) + quotaText(s.quota), warn: false };
  return { text: v + ' · ' + T18('API-Abrechnung ({0})', s.method), warn: true };
}

/* Auslastung des Abos, wie Claude Code sie mit jeder Antwort meldet. */
function quotaText(q) {
  if (!q || (q.fiveHour == null && q.week == null)) return '';
  const parts = [];
  if (q.fiveHour != null) parts.push(T18('5 h {0} %', q.fiveHour));
  if (q.week != null) parts.push(T18('Woche {0} %', q.week));
  return ' · ' + T18('Kontingent: {0}', parts.join(' · '));
}

/* „claude-sonnet-5-5“ → „Sonnet 5.5“ */
function modelName(id) {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(String(id || ''));
  return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1) + ' ' + m[2] + (m[3] ? '.' + m[3] : '') : String(id || '');
}
const kTok = n => (n >= 1000 ? (n / 1000).toLocaleString(T18('de-DE'), { maximumFractionDigits: 1 }) + 'k' : String(n || 0));

/* Verbrauch einer Antwort: alle Zwischenschritte zusammen. */
function usageLine(u) {
  if (!u) return;
  const input = (u.input || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0);
  const parts = [];
  if (u.model) parts.push(modelName(u.model));
  parts.push(u.cacheRead ? T18('{0} ein (davon {1} aus dem Cache)', kTok(input), kTok(u.cacheRead)) : T18('{0} ein', kTok(input)));
  parts.push(T18('{0} aus', kTok(u.output)));
  if (u.ms) parts.push(T18('{0} s', Math.round(u.ms / 1000)));
  add('chat-usage', esc(parts.join(' · ')));
}

/* Wann gesendet werden darf: Claude Code vorhanden, KI-Zugang an, nichts läuft. */
function sync() {
  const mode = M.state().mode;
  let note = '';
  if (chat.available === false)
    note = T18('Claude Code wurde auf diesem Rechner nicht gefunden. Es kommt mit der VS-Code-Erweiterung oder mit Claude Desktop; sonst den Dienst mit --claude <pfad> starten.');
  else if (chat.cli && chat.cli.blocked)
    note = chat.cli.blocked;
  else if (mode === 'off')
    note = T18('Der KI-Zugang ist aus. Oben am Schalter „KI“ freigeben — „Lesen“ zum Fragen, Vorschlag, Einzelschritte oder Auto zum Ändern.');
  else if (mode === 'read')
    note = T18('Der KI-Zugang steht auf „Lesen“: Die KI kann antworten und planen, aber nichts ändern.');
  const note$ = $('#chat-note');
  note$.textContent = note;
  note$.hidden = !note;
  const i = info();
  $('#chat-info').textContent = i.text;
  $('#chat-info').classList.toggle('warn', i.warn);
  const blocked = chat.available === false || mode === 'off' || !!(chat.cli && chat.cli.blocked);
  $('#chat-input').disabled = blocked;
  $('#chat-send').disabled = blocked || chat.running;
  $('#chat-send').hidden = chat.running;
  $('#chat-stop').hidden = !chat.running;
  $('#chat-new').disabled = chat.running;
}

/* ---------- Verlauf ---------- */

const log = $('#chat-log');
const scrollDown = () => { log.scrollTop = log.scrollHeight; };

function add(cls, html) {
  const el = document.createElement('div');
  el.className = cls;
  el.innerHTML = html;
  log.appendChild(el);
  scrollDown();
  return el;
}

/* Kleines Markdown für die Antworten: Absätze, Überschriften, Listen,
   Tabellen, fett, kursiv, Code. Alles wird zuerst maskiert. */
/* Vom Dienst eingesetzter Klartext kommt als \uE000Platzhalter\uE001Klartext\uE002 —
   unterstrichen angezeigt, im Tooltip steht, was die KI tatsächlich gesehen hat. */
const unmarked = html => html.replace(/\uE000([^\uE001\uE002]*)\uE001([^\uE002]*)\uE002/g,
  (m, tag, text) => `<span class="chat-ph" title="${T18('Die KI sieht hier nur {0} — der Klartext bleibt auf diesem Rechner.', tag)}">${text}</span>`);

function inline(t) {
  return unmarked(esc(t))
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:!?]|$)/g, '$1<i>$2</i>');
}
function md(src) {
  const out = [];
  let para = [], list = null, table = null;
  const flush = () => {
    if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; }
    if (list) { out.push(`<${list.tag}>` + list.items.map(i => '<li>' + inline(i) + '</li>').join('') + `</${list.tag}>`); list = null; }
    if (table) {
      const [headRow, ...rows] = table;
      out.push('<div class="chat-table-wrap"><table class="ga mini chat-table"><thead><tr>' + headRow.map(c => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>'
        + rows.map(r => '<tr>' + r.map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>');
      table = null;
    }
  };
  String(src).split('\n').forEach(line => {
    const t = line.trim();
    let m;
    if (/^\|.*\|$/.test(t)) {
      if (/^\|[\s:|-]+\|$/.test(t)) return;
      if (!table) flush();
      table = table || [];
      table.push(t.slice(1, -1).split('|').map(c => c.trim()));
    } else if ((m = /^[-*•]\s+(.*)$/.exec(t))) {
      if (!list || list.tag !== 'ul') { flush(); list = { tag: 'ul', items: [] }; }
      list.items.push(m[1]);
    } else if ((m = /^\d+[.)]\s+(.*)$/.exec(t))) {
      if (!list || list.tag !== 'ol') { flush(); list = { tag: 'ol', items: [] }; }
      list.items.push(m[1]);
    } else if ((m = /^#{1,4}\s+(.*)$/.exec(t))) {
      flush();
      out.push('<h4>' + inline(m[1]) + '</h4>');
    } else if (!t) {
      flush();
    } else {
      if (list || table) flush();
      para.push(t);
    }
  });
  flush();
  return out.join('');
}

const TOOL_IC = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M3.6 12.4 5 11M11 5l1.4-1.4"/></svg>';

/* Werkzeugaufruf in einer Zeile: Name und die Argumente knapp. */
function toolLine(name, input) {
  let args = '';
  try {
    const o = JSON.parse(input);
    args = Object.entries(o).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ');
  } catch (e) { args = input || ''; }
  if (args.length > 160) args = args.slice(0, 160) + '…';
  add('chat-tool', `${TOOL_IC}<code>${esc(name)}</code> <span>${unmarked(esc(args))}</span>`);
}

B.events.on('chat', ev => {
  if (!ev || (chat.turn && ev.turn !== chat.turn)) return;
  switch (ev.kind) {
    case 'start':
      chat.bubble = null;
      break;
    case 'text':
      if (!chat.bubble) chat.bubble = add('chat-msg ai', '');
      chat.bubble.innerHTML = md(ev.text || '');
      scrollDown();
      break;
    case 'tool':
      chat.bubble = null;
      toolLine(ev.name, ev.input);
      break;
    case 'toolError':
      add('chat-tool err', `${TOOL_IC}<span>${unmarked(esc(ev.text || T18('Werkzeug meldet einen Fehler')))}</span>`);
      break;
    case 'quota':
      if (chat.cli) chat.cli.quota = ev.quota;
      sync();
      break;
    case 'done':
      chat.running = false;
      chat.bubble = null;
      if (ev.stopped) add('chat-sys', esc(T18('Angehalten.')));
      else if (ev.error) add('chat-sys err', unmarked(esc(T18('Fehler: {0}', ev.error))));
      usageLine(ev.usage);
      sync();
      break;
    default:
  }
});

/* ---------- Senden ---------- */

async function send() {
  const input = $('#chat-input');
  const text = input.value.trim();
  if (!text || chat.running) return;
  add('chat-msg me', esc(text).replace(/\n/g, '<br>'));
  input.value = '';
  chat.running = true;
  chat.bubble = null;
  chat.turn = null;
  sync();
  try {
    const r = await B.chat.send({ project: B.projectId, text, model: $('#chat-model').value,
                                  effort: $('#chat-effort').value, ...M.privacyContext() });
    chat.turn = r.turn;
    chat.conversation = r.conversation;
  } catch (e) {
    chat.running = false;
    add('chat-sys err', esc(T18('Fehler: {0}', e.message)));
    checkCli();
  }
}

$('#chat-form').addEventListener('submit', e => { e.preventDefault(); send(); });
$('#chat-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
});
$('#chat-stop').addEventListener('click', () => { B.chat.stop().catch(() => {}); });
$('#chat-new').addEventListener('click', async () => {
  try { await B.chat.reset(); } catch (e) { /* dann eben nur hier leeren */ }
  log.innerHTML = '';
  chat.bubble = null;
  chat.conversation = null;
  add('chat-sys', esc(T18('Neues Gespräch.')));
});

/* ---------- Gespeicherte Gespräche ---------- */

/* Ein Eintrag aus dem gespeicherten Gespräch — so, wie er angezeigt war. */
function replay(e) {
  switch (e.k) {
    case 'me': add('chat-msg me', esc(e.text || '').replace(/\n/g, '<br>')); break;
    case 'ai': add('chat-msg ai', md(e.text || '')); break;
    case 'tool': toolLine(e.name, e.input); break;
    case 'toolError': add('chat-tool err', `${TOOL_IC}<span>${unmarked(esc(e.text || ''))}</span>`); break;
    case 'sys': add('chat-sys', esc(e.text || '')); break;
    case 'err': add('chat-sys err', unmarked(esc(T18('Fehler: {0}', e.text || '')))); break;
    case 'usage': usageLine(e.usage); break;
    default:
  }
}

async function openConversation(id, quiet) {
  try {
    const doc = await B.chat.open(B.projectId, id);
    log.innerHTML = '';
    chat.bubble = null;
    chat.conversation = id;
    (doc.entries || []).forEach(replay);
    if (!quiet) add('chat-sys', esc(T18('Gespräch vom {0} — die KI knüpft daran an.', fmtDate(doc.updated))));
  } catch (e) {
    if (!quiet) A.warn(T18('Gespräch nicht ladbar: {0}', e.message));
  }
}

const fmtDate = ms => new Date(ms).toLocaleString(T18('de-DE'), { dateStyle: 'short', timeStyle: 'short' });

async function openHistory() {
  let list = [];
  try { list = (await B.chat.history(B.projectId)).conversations || []; }
  catch (e) { A.warn(T18('Verlauf nicht lesbar: {0}', e.message)); return; }
  A.openModal(T18('Gespräche in diesem Projekt'), `
    <p class="hint">${T18('Gespeichert auf diesem Rechner, nur für dich lesbar. Je Projekt bleiben die letzten {0}.', 50)}</p>
    ${list.length ? `<table class="ga mini chat-hist"><tbody>${list.map(c => `
      <tr${c.id === chat.conversation ? ' class="current"' : ''}>
        <td>${esc(c.title || '—')}<br><span class="hint">${esc(fmtDate(c.updated))} · ${T18('{0} Einträge', c.entries)}</span></td>
        <td class="col-act">
          <button class="btn btn-sm" data-open="${esc(c.id)}"${c.id === chat.conversation || chat.running ? ' disabled' : ''}>${T18('Öffnen')}</button>
          <button class="btn btn-sm btn-danger" data-del="${esc(c.id)}">${T18('Löschen')}</button>
        </td></tr>`).join('')}</tbody></table>`
      : `<p class="hint">${T18('Noch keine Gespräche.')}</p>`}
  `, () => {});
  $('#modal-ok').textContent = T18('Schließen');
  $('#modal-cancel').hidden = true;
  $('#modal-body').querySelectorAll('[data-open]').forEach(b => {
    b.onclick = () => { A.closeModal(); show('chat'); openConversation(b.dataset.open); };
  });
  $('#modal-body').querySelectorAll('[data-del]').forEach(b => {
    b.onclick = async () => {
      try {
        await B.chat.remove(B.projectId, b.dataset.del);
        if (b.dataset.del === chat.conversation) { chat.conversation = null; log.innerHTML = ''; }
        b.closest('tr').remove();
      } catch (e) { A.warn(T18('Löschen fehlgeschlagen: {0}', e.message)); }
    };
  });
}
$('#chat-history').addEventListener('click', openHistory);

/* Nach einem Neustart: das letzte Gespräch dieses Projekts wieder zeigen. */
async function restoreLast() {
  try {
    const list = (await B.chat.history(B.projectId)).conversations || [];
    if (list.length && !chat.conversation && !log.children.length) await openConversation(list[0].id, true);
  } catch (e) { /* ohne Verlauf eben leer */ }
}

// Der Modus kann sich jederzeit ändern — am Schalter oder in einem anderen Fenster
B.events.on('mcp', () => setTimeout(sync, 0));
B.events.on('state', s => { if (s === 'offen') checkCli(); });

/* Modell und Aufwand merkt sich der Browser. */
[['#chat-model', 'knx-chat-model-v1'], ['#chat-effort', 'knx-chat-effort-v1']].forEach(([sel, key]) => {
  const el = $(sel);
  try {
    const v = localStorage.getItem(key) || '';
    if ([...el.options].some(o => o.value === v)) el.value = v;
  } catch (e) { /* nur Komfort */ }
  el.addEventListener('change', () => { try { localStorage.setItem(key, el.value); } catch (e) { /* nur Komfort */ } });
});

let start = 'detail';
try { start = localStorage.getItem(RIGHT_KEY) === 'chat' ? 'chat' : 'detail'; } catch (e) { /* nur Komfort */ }
show(start);
checkCli();
restoreLast();

window.KNXChat = { available: true, open: () => show('chat') };

})();
