/* ============================================================
   KNX-Struktur — Sprachumschaltung
   ------------------------------------------------------------
   Schlüssel ist der deutsche Text selbst. Das spart eine Schlüsseltabelle
   und hält den Quelltext lesbar: `t('Gerät löschen')` sagt im Code, was
   dasteht. Preis dafür: wird der deutsche Text geändert, bricht der
   Schlüssel und der Eintrag muss nachgezogen werden.

   Zwei Fallstricke, die hier abgefangen werden:

   1. Normalisierung. „ü“ ist entweder U+00FC (NFC) oder u + U+0308 (NFD).
      JS vergleicht Schlüssel zeichenweise, ein NFD-Schlüssel träfe also
      lautlos daneben. Darum läuft jeder Schlüssel durch normalize('NFC').
   2. Platzhalter. Sätze mit eingesetzten Werten lassen sich nicht als
      ganzer Text schlüsseln. Sie tragen {0}, {1} … und bekommen die Werte
      als weitere Argumente.

   Fehlt eine Übersetzung, steht der deutsche Text da — nie ein leeres Feld
   oder ein roher Schlüssel. Was gefehlt hat, sammelt `missing()`.
   ============================================================ */
'use strict';

const KNXI18n = (() => {

const KEY = 'knx-lang-v1';
const LANGS = { de: 'Deutsch', en: 'English' };
const DEFAULT = 'de';

const dicts = {};                 // Sprache → { deutscher Text: Übersetzung }
const missing = new Map();        // fehlender Schlüssel → Sprache
const listeners = new Set();

const norm = s => String(s == null ? '' : s).normalize('NFC');

let lang = DEFAULT;
try {
  const saved = localStorage.getItem(KEY);
  if (saved && LANGS[saved]) lang = saved;
} catch (e) { /* nur Komfort */ }

/** Nimmt eine Sprachtabelle entgegen; die Schlüssel werden gleich normalisiert. */
function add(code, table) {
  const into = dicts[code] || (dicts[code] = {});
  Object.keys(table || {}).forEach(k => { into[norm(k)] = table[k]; });
}

/**
 * Übersetzt `de` in die eingestellte Sprache und setzt {0}, {1} … ein.
 * Ohne Treffer bleibt der deutsche Text stehen.
 */
function t(de, ...args) {
  let out = de == null ? '' : String(de);
  if (lang !== DEFAULT) {
    const hit = dicts[lang] && dicts[lang][norm(out)];
    if (hit != null) out = hit;
    else if (out.trim()) missing.set(norm(out), lang);
  }
  if (args.length) out = out.replace(/\{(\d+)\}/g, (m, i) => (args[+i] != null ? args[+i] : m));
  return out;
}

/**
 * Übersetzt festen Text im HTML. Getragen wird er von data-i18n (Textinhalt)
 * und data-i18n-<attribut> für title, placeholder, aria-label. Der deutsche
 * Text bleibt im Markup stehen — er ist ja der Schlüssel; das Attribut hält
 * nur fest, was übersetzt werden soll.
 */
const ATTRS = ['title', 'placeholder', 'aria-label', 'label'];

function applyStatic(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => {
    if (!el.dataset.i18nDe) el.dataset.i18nDe = el.textContent.trim();
    el.textContent = t(el.dataset.i18nDe);
  });
  ATTRS.forEach(a => {
    root.querySelectorAll(`[data-i18n-${a}]`).forEach(el => {
      const store = 'i18n' + a.replace(/(^|-)([a-z])/g, (m, _, c) => c.toUpperCase()) + 'De';
      if (!el.dataset[store]) el.dataset[store] = el.getAttribute(a) || '';
      el.setAttribute(a, t(el.dataset[store]));
    });
  });
  if (document.documentElement) document.documentElement.lang = lang;
}

function set(next) {
  if (!LANGS[next] || next === lang) return lang;
  lang = next;
  try { localStorage.setItem(KEY, lang); } catch (e) { /* nur Komfort */ }
  applyStatic();
  listeners.forEach(fn => { try { fn(lang); } catch (e) { /* ein Zuhörer darf nicht alles aufhalten */ } });
  return lang;
}

/** Wählt aus einem Feld mit mehreren Sprachen den passenden Text. */
function pick(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return value[lang] || value[DEFAULT] || value.en || '';
}

return {
  LANGS,
  t, add, set, pick, applyStatic,
  lang: () => lang,
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  missing: () => [...missing.keys()].sort()
};

})();

window.KNXI18n = KNXI18n;

/* Der feste Text im Markup wird übersetzt, sobald er dasteht. Das Skript liegt
   im Kopf der Seite, also ist das DOM hier noch nicht fertig. */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => KNXI18n.applyStatic());
} else {
  KNXI18n.applyStatic();
}
