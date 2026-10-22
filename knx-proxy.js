/* ============================================================
   KNX-Struktur — Security Proxy (AN192 "Coupler security extensions")
   ============================================================ *
 * Ein Koppler mit Security Proxy übersetzt eine Gruppenadresse zwischen einer
 * Seite, auf der sie mit KNX Data Secure gesichert ist, und einer, auf der sie
 * unverschlüsselt läuft. Ob eine Seite gesichert ist, steht nicht als eigener
 * Schalter im Projekt, sondern folgt aus den Geräten:
 *
 *   `ga.secure`  die Adresse hat einen Gruppenschlüssel
 *   Segment      gesichert, wenn alle Teilnehmer daran Secure geladen werden,
 *                unverschlüsselt, wenn keiner; beides auf einer Linie ist ein
 *                Fehler, denn zwischen ihnen sitzt kein Koppler
 *   Durchgang    ein Segment ohne eigene Teilnehmer (Hauptlinie, Backbone)
 *                übernimmt, was die angrenzenden Koppler ohne Proxy
 *                erzwingen — so übersetzt der Proxy dort, wo die Planung ihn
 *                hingesetzt hat. Erzwingt keiner etwas, ist es gesichert,
 *                sobald es überhaupt einen Secure-Teilnehmer gibt
 *
 * An jeder Grenze — Linie gegen Hauptlinie, Bereich gegen Backbone — werden
 * die beiden angrenzenden Segmente verglichen: Sekundärseite die Linie (beim
 * Bereichskoppler die Hauptlinie), Primärseite die Hauptlinie (bzw. der
 * Backbone). Sind sie verschieden, übersetzt der Koppler dort — wenn er ein
 * aktiver Proxy ist. Sonst geht die Planung nicht auf.
 *
 * Aktiv ist ein Proxy, wenn die Produktdatei die Fähigkeit nennt
 * (CouplerCapabilities="SecurityProxy") und das Gerät Secure in Betrieb
 * genommen wird; AN192 2.7 setzt Data Security voraus.
 *
 * Ohne Abhängigkeiten: arbeitet auf dem Projekt-JSON, damit Prüfung, Download
 * und Oberfläche dasselbe rechnen — und es sich ohne Browser prüfen lässt.  */
'use strict';

const KNXProxy = (() => {

/* Security Settings eines Eintrags der Proxy-Gruppenschlüsseltabelle
   (AN192 Figure 25): Sec@Prim, Sec@Sec, conf, auth. */
const SEC_PRIM = 0x80, SEC_SEC = 0x40, CONF_AUTH = 0x03;

const RULE = 'rule', BLOCK = 'block';

const paSplit = a => [(a >> 12) & 0x0F, (a >> 8) & 0x0F, a & 0xFF];
const paStr = a => paSplit(a).join('.');
const validPa = a => Number.isInteger(a) && a > 0 && (a & 0xFF) !== 0xFF;

function itemOf(project, dev) {
  return dev && dev.catalogId ? (project.catalog || []).find(c => c.id === dev.catalogId) || null : null;
}

/** Nennt die Produktdatei die Fähigkeit? */
const capable = item => !!(item && item.proxy);

function lineInfo(project, lineId) {
  for (const a of project.areas || [])
    for (const l of a.lines || []) if (l.id === lineId) return { area: a, line: l };
  return null;
}

const mainLine = area => (area.lines || []).find(l => l.addr === 0) || null;
const backboneLine = project => {
  const bb = (project.areas || []).find(a => a.backbone);
  return bb && bb.lines && bb.lines[0] ? bb.lines[0] : null;
};

/** Ist das Gerät ein Koppler, also Teilnehmer 0 einer Linie außerhalb des Backbones? */
function isCoupler(project, dev) {
  if (!dev || !validPa(dev.addr) || paSplit(dev.addr)[2] !== 0) return false;
  const at = lineInfo(project, dev.lineId);
  return !!at && !at.area.backbone;
}

function active(project, dev, item = itemOf(project, dev)) {
  return capable(item) && !!dev.secure && isCoupler(project, dev);
}

/**
 * Weiterleitung für Punkt-zu-Punkt und Broadcast je Seite: [primär, sekundär].
 * Als Proxy sperrt der Koppler beides, bis man es freigibt (AN192 3.5.2.2);
 * ohne Proxy gilt die Regel des Kopplers.
 */
function config(project, dev, item = itemOf(project, dev)) {
  const on = active(project, dev, item);
  const def = on ? BLOCK : RULE;
  const own = (dev && dev.proxy) || {};
  const pick = (list, i) => (on && Array.isArray(list) && (list[i] === RULE || list[i] === BLOCK)) ? list[i] : def;
  return { active: on, ptp: [pick(own.ptp, 0), pick(own.ptp, 1)], bc: [pick(own.bc, 0), pick(own.bc, 1)] };
}

/* Geräte je Gruppenadresse, ohne überzählige Objekte. */
function linksByGa(project) {
  const map = new Map();
  (project.devices || []).forEach(d => {
    const seen = new Set();
    (d.objs || []).forEach(o => {
      if (o.stale) return;
      (o.gas || []).forEach(id => {
        if (seen.has(id)) return;
        seen.add(id);
        if (!map.has(id)) map.set(id, []);
        map.get(id).push(d);
      });
    });
  });
  return map;
}

/* 'secure', 'plain', 'mixed' oder null für ein Segment ohne Teilnehmer. */
function status(devs, lineIds) {
  const on = devs.filter(d => lineIds.includes(d.lineId));
  if (!on.length) return null;
  const sec = on.filter(d => d.secure).length;
  return sec === on.length ? 'secure' : sec === 0 ? 'plain' : 'mixed';
}

/* Alle Grenzen, an denen ein Koppler sitzen kann: jede Linie gegen ihre
   Hauptlinie (Linienkoppler A.L.0), jeder Bereich gegen den Backbone
   (Bereichskoppler A.0.0) — auch wenn der Koppler im Projekt fehlt. */
function boundaries(project) {
  const out = [];
  const bb = backboneLine(project);
  (project.areas || []).forEach(a => {
    if (a.backbone) return;
    const main = mainLine(a);
    (a.lines || []).forEach(l => {
      if (l.addr === 0 || !main) return;
      out.push({ pa: (a.addr << 12) | (l.addr << 8), inside: new Set([l.id]), sec: l.id, prim: main.id });
    });
    if (bb && main) out.push({ pa: a.addr << 12, inside: new Set((a.lines || []).map(l => l.id)),
                               sec: main.id, prim: bb.id });
  });
  return out;
}

const couplerAt = (project, pa) => (project.devices || []).find(d => d.addr === pa) || null;

/**
 * Was alle Proxys des Projekts übersetzen und wo die Planung nicht aufgeht.
 *
 * Liefert {
 *   proxies:  Map devId → { dev, entries: [{ ga, raw, settings }] } für jeden aktiven Proxy
 *   mixed:    [{ ga, dev }]  unverschlüsselte Teilnehmer auf einer Linie, auf der die
 *             Adresse auch gesichert läuft — dazwischen kann kein Proxy sitzen
 *   blocked:  [{ ga, pa, dev, side }]  Grenzen, an denen gesichert auf unverschlüsselt
 *             trifft, ohne aktiven Proxy; `dev` fehlt, wenn dort gar kein Koppler steht,
 *             `side` ist die unverschlüsselte Seite ('sec' oder 'prim')
 * }
 */
function analyse(project) {
  const groups = new Map((project.groups || []).map(g => [g.id, g]));
  const links = linksByGa(project);
  const bounds = boundaries(project);
  const proxies = new Map(), mixed = [], blocked = [];

  (project.devices || []).forEach(d => {
    if (active(project, d)) proxies.set(d.id, { dev: d, entries: [] });
  });

  links.forEach((devs, gaId) => {
    const g = groups.get(gaId);
    if (!g || !g.secure || !(g.raw > 0)) return;

    const lines = new Map();
    devs.forEach(d => {
      if (!lines.has(d.lineId)) lines.set(d.lineId, []);
      lines.get(d.lineId).push(d);
    });
    lines.forEach(on => {
      if (status(on, [on[0].lineId]) === 'mixed')
        on.filter(d => !d.secure).forEach(d => mixed.push({ ga: g, dev: d }));
    });

    // Grenzen, über die die Adresse überhaupt läuft: Teilnehmer auf beiden Seiten
    const crossing = bounds.filter(b => {
      const others = devs.filter(d => d.addr !== b.pa);
      return others.some(d => b.inside.has(d.lineId)) && others.some(d => !b.inside.has(d.lineId));
    });
    const proxyAt = b => {
      const dev = couplerAt(project, b.pa);
      return dev && proxies.get(dev.id) ? dev : null;
    };

    // Segmente mit Teilnehmern haben ihren Zustand; die übrigen sind Durchgang
    const seg = new Map();
    lines.forEach((on, lineId) => seg.set(lineId, status(on, [lineId])));
    const transit = new Set();
    crossing.forEach(b => [b.sec, b.prim].forEach(id => { if (!seg.has(id)) transit.add(id); }));
    for (let round = 0; round <= transit.size; round++) {
      let changed = false;
      transit.forEach(id => {
        if (seg.has(id)) return;
        // Ein Koppler ohne Proxy reicht unverändert durch: beide Seiten gleich
        const want = new Set();
        crossing.forEach(b => {
          if (proxyAt(b) || (b.sec !== id && b.prim !== id)) return;
          const other = seg.get(b.sec === id ? b.prim : b.sec);
          if (other === 'secure' || other === 'plain') want.add(other);
        });
        if (want.size === 1) { seg.set(id, [...want][0]); changed = true; }
      });
      if (!changed) break;
    }
    const fallback = devs.some(d => d.secure) ? 'secure' : 'plain';
    transit.forEach(id => { if (!seg.has(id)) seg.set(id, fallback); });

    crossing.forEach(b => {
      const sec = seg.get(b.sec), prim = seg.get(b.prim);
      if (sec === 'mixed' || prim === 'mixed' || sec === prim) return;
      const dev = proxyAt(b);
      if (!dev) {
        blocked.push({ ga: g, pa: b.pa, dev: couplerAt(project, b.pa), side: sec === 'plain' ? 'sec' : 'prim' });
        return;
      }
      proxies.get(dev.id).entries.push({ ga: gaId, raw: g.raw,
        settings: (prim === 'secure' ? SEC_PRIM : 0) | (sec === 'secure' ? SEC_SEC : 0) | CONF_AUTH });
    });
  });

  proxies.forEach(p => p.entries.sort((a, b) => a.raw - b.raw));
  return { proxies, mixed, blocked };
}

/** Proxys, die diese Adresse übersetzen — sie senden sie gesichert unter eigener Adresse. */
function translators(project, gaId, an = analyse(project)) {
  const out = [];
  an.proxies.forEach(p => {
    if (p.entries.some(e => e.ga === gaId) && validPa(p.dev.addr)) out.push(p.dev.addr);
  });
  return out;
}

/**
 * Wer dem Proxy gesicherte Telegramme schickt: die Secure-Teilnehmer der
 * übersetzten Adressen und die anderen Proxys darauf. Das füllt seine
 * Sicherheits-IA-Tabelle — ohne Eintrag verwirft er (AN192 2.2.2.3).
 */
function senders(project, dev, an = analyse(project)) {
  const p = an.proxies.get(dev.id);
  if (!p) return [];
  const links = linksByGa(project);
  const out = new Set();
  p.entries.forEach(e => {
    (links.get(e.ga) || []).forEach(d => {
      if (d.id !== dev.id && d.secure && validPa(d.addr)) out.add(d.addr);
    });
    translators(project, e.ga, an).forEach(a => { if (a !== dev.addr) out.add(a); });
  });
  return [...out].sort((a, b) => a - b);
}

/* ---------- Programmieren über einen Proxy hinweg ---------- *
 * Sperrt ein Proxy Punkt-zu-Punkt oder Broadcast, öffnet ihn das Werkzeug für
 * sich: eine Temporary Unicast White List (PID 83) für die eigene Adresse und
 * die Ziele, die Broadcast-Freigabe auf Zeit (PID 84). Hier steht nur, welche
 * Proxys zwischen Schnittstelle und Ziel liegen, in Wegreihenfolge. */

function lineOfPa(project, pa) {
  const [a, l] = paSplit(pa);
  for (const area of project.areas || []) {
    if (area.addr !== a) continue;
    for (const line of area.lines || []) if (line.addr === l) return { area, line };
  }
  return null;
}

/* Die Koppler zwischen zwei Linien, von der ersten zur zweiten. */
function path(project, from, to) {
  if (!from || !to || from.line.id === to.line.id) return [];
  const lc = at => (!at.area.backbone && at.line.addr !== 0) ? (at.area.addr << 12) | (at.line.addr << 8) : null;
  const ac = at => !at.area.backbone ? at.area.addr << 12 : null;
  const pas = from.area.id === to.area.id ? [lc(from), lc(to)] : [lc(from), ac(from), ac(to), lc(to)];
  return pas.filter(pa => pa != null && pa !== 0)
    .map(pa => couplerAt(project, pa)).filter(Boolean);
}

/**
 * Freigaben für einen Zugriff von der Schnittstelle (`link`, ihre
 * Tunneladresse) auf `target`. `bc`: der Vorgang braucht Broadcasts
 * (Adressvergabe). Liefert in Wegreihenfolge
 * [{ proxy: '1.1.0', serial, partners: ['1.1.5', ...], ptp, bc }].
 */
function gates(project, link, target, bc = false) {
  if (!validPa(link) || !validPa(target)) return [];
  const on = path(project, lineOfPa(project, link), lineOfPa(project, target))
    .filter(d => active(project, d));
  return on.map((d, i) => {
    const c = config(project, d);
    // Hinter diesem Proxy: das Ziel und die weiteren Proxys, die erst noch zu öffnen sind
    const partners = [target, ...on.slice(i + 1).map(x => x.addr)];
    return { proxy: paStr(d.addr), serial: d.serial || '', partners: partners.map(paStr),
             ptp: c.ptp.includes(BLOCK), bc: bc && c.bc.includes(BLOCK) };
  }).filter(g => g.ptp || g.bc);
}

return { SEC_PRIM, SEC_SEC, CONF_AUTH, RULE, BLOCK,
         capable, isCoupler, active, config, analyse, translators, senders, gates };
})();

if (typeof module !== 'undefined') module.exports = KNXProxy;
