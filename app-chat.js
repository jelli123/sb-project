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

   Das Gespräch lebt nur in diesem Fenster; Neuladen beginnt
   ein neues.
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
    <textarea class="input" id="chat-input" rows="3" maxlength="8000" spellcheck="true"
              placeholder="${T18('Was soll geplant werden? Enter sendet, Umschalt+Enter macht eine neue Zeile.')}"></textarea>
    <div class="chat-btns">
      <button type="button" class="btn btn-sm" id="chat-new" title="${T18('Die KI vergisst das bisherige Gespräch')}">${T18('Neues Gespräch')}</button>
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

const chat = { running: false, available: null, version: null, bubble: null, turn: null };

async function checkCli() {
  try {
    const s = await B.chat.status();
    chat.available = !!s.available;
    chat.version = s.version || null;
    chat.running = !!s.running;
  } catch (e) {
    chat.available = false;
  }
  sync();
}

/* Wann gesendet werden darf: Claude Code vorhanden, KI-Zugang an, nichts läuft. */
function sync() {
  const mode = M.state().mode;
  let note = '';
  if (chat.available === false)
    note = T18('Claude Code wurde auf diesem Rechner nicht gefunden. Es kommt mit der VS-Code-Erweiterung oder mit Claude Desktop; sonst den Dienst mit --claude <pfad> starten.');
  else if (mode === 'off')
    note = T18('Der KI-Zugang ist aus. Oben am Schalter „KI“ freigeben — „Lesen“ zum Fragen, Vorschlag, Einzelschritte oder Auto zum Ändern.');
  else if (mode === 'read')
    note = T18('Der KI-Zugang steht auf „Lesen“: Die KI kann antworten und planen, aber nichts ändern.');
  const note$ = $('#chat-note');
  note$.textContent = note;
  note$.hidden = !note;
  const blocked = chat.available === false || mode === 'off';
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
    case 'done':
      chat.running = false;
      chat.bubble = null;
      if (ev.stopped) add('chat-sys', esc(T18('Angehalten.')));
      else if (ev.error) add('chat-sys err', unmarked(esc(T18('Fehler: {0}', ev.error))));
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
    const r = await B.chat.send({ project: B.projectId, text, ...M.privacyContext() });
    chat.turn = r.turn;
  } catch (e) {
    chat.running = false;
    add('chat-sys err', esc(T18('Fehler: {0}', e.message)));
    sync();
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
  add('chat-sys', esc(T18('Neues Gespräch.')));
});

// Der Modus kann sich jederzeit ändern — am Schalter oder in einem anderen Fenster
B.events.on('mcp', () => setTimeout(sync, 0));
B.events.on('state', s => { if (s === 'offen') checkCli(); });

let start = 'detail';
try { start = localStorage.getItem(RIGHT_KEY) === 'chat' ? 'chat' : 'detail'; } catch (e) { /* nur Komfort */ }
show(start);
checkCli();

window.KNXChat = { available: true, open: () => show('chat') };

})();
