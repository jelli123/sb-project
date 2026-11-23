/* ============================================================
   Test: Parameter inaktiver Zweige werden nicht geladen (knx-download.js)
   ============================================================ *
 * Nachbau eines MSA-Pins: Eingang und DHT liegen übereinander. Aktiv ist
 * der Eingang mit einer 2-Bit-Aktion in den unteren Bits von Oktett 2, der
 * DHT-Parameter (16 Bit ab Oktett 1, Vorgabe 60 = 00 3C) steht nur im
 * inaktiven Zweig. Früher landete 0x3C|3 = 0x3F im Gerät.
 *
 *   node test/knx-download-params.test.js                                 */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const dir = path.join(__dirname, '..');
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(dir, 'knx-download.js'), 'utf8') +
  '\nthis.KNXDownload = KNXDownload;', ctx, { filename: 'knx-download.js' });
const D = ctx.KNXDownload;
let fail = 0;
const ok = (n, c) => { console.log((c ? 'ok    ' : 'FAIL  ') + n); if (!c) fail++; };

const step = (n, a = {}) => ({ n, a });
const item = {
  id: 'msa',
  params: {
    'P-0_R-0':   { p: 'P-0', d: '2' },     // Funktion (2 = Eingang)
    'P-1_R-1':   { p: 'P-1', d: '20' },    // Entprellzeit
    'P-2_R-2':   { p: 'P-2', d: '2' },     // Aktion HIGH, 2 Bit
    'P-9_R-9':   { p: 'P-9', d: '60' },    // DHT-Vorbereitung, 16 Bit, inaktiv
    'P-7_R-7':   { p: 'P-7', d: '85' },    // DHT-Pause, 8 Bit, inaktiv, eigenes Oktett
    'P-8_R-8':   { p: 'P-8', d: '7' }      // interner Schalter, nicht im Baum
  },
  objs: {},
  types: { u8: { e: 'u', n: 8 }, u2: { e: 'u', n: 2 }, u16: { e: 'u', n: 16 } },
  dyn: [
    { p: 'P-0_R-0' },
    { c: 'P-0_R-0', w: [
      { t: '2', k: [{ p: 'P-1_R-1' }, { p: 'P-2_R-2' }] },
      { t: '4', k: [{ p: 'P-9_R-9' }, { p: 'P-7_R-7' }] }
    ] }
  ],
  prog: { mask: 'MV-0701', appNumber: 1, appVersion: 11, style: 'MergedProcedure', segments: [],
    dl: { manu: 0x13A, opt: {}, co: {}, lp: [],
      segs: { 'AS-4800': [0x4800, 16, '', null] },
      loc: {
        'P-0': { w: 's:AS-4800', o: 0,      t: 'u8',  d: '0' },
        'P-1': { w: 's:AS-4800', o: 8,      t: 'u8',  d: '20' },
        'P-2': { w: 's:AS-4800', o: 16 + 6, t: 'u2',  d: '2' },
        'P-9': { w: 's:AS-4800', o: 8,      t: 'u16', d: '60' },
        'P-7': { w: 's:AS-4800', o: 24,     t: 'u8',  d: '85' },
        'P-8': { w: 's:AS-4800', o: 40,     t: 'u8',  d: '7' }
      },
      mk: { v: 0x0701, mm: 'Bcu2', feat: {}, io: {}, hosts: [0x0701], procs: [
        { t: 'Load', s: 'all', k: [
          step('LdCtrlAbsSegment', { LsmIdx: '3', SegType: '0', Address: '18432', Size: '16',
                                     Access: '0', MemType: '3', SegFlags: '0' })] }] } } }
};
const project = {
  areas: [{ id: 'a1', addr: 1, lines: [{ id: 'l11', addr: 1 }] }],
  catalog: [item], groups: [],
  devices: [{ id: 'd', addr: 0x1103, lineId: 'l11', catalogId: 'msa', objs: [],
              params: { 'P-0_R-0': '2', 'P-2_R-2': '3' } }]
};

// Sichtbar wie bei KNX.resolveProduct: alle Referenzen der aktiven Zweige
const resolve = () => ({ objs: [], groups: [{ label: 'IO1', params: ['P-0_R-0', 'P-1_R-1', 'P-2_R-2'] }] });
const plan = D.plan(project, project.devices[0], item, { kind: 'all', resolve });
ok('keine Fehler: ' + plan.errors.join('; '), plan.errors.length === 0);

const writes = plan.steps.filter(s => s.op === 'writeMem');
const image = new Map();
writes.forEach(w => D.fromHex(w.data).forEach((b, i) => image.set(w.addr + i, b)));
const at = a => image.get(a);

ok('Funktion = 02', at(0x4800) === 0x02);
ok('Entprellzeit = 14 (sichtbar, gewinnt)', at(0x4801) === 0x14);
ok('Aktion HIGH = 03, ohne DHT-Reste (war 3F)', at(0x4802) === 0x03);
ok('interner Schalter außerhalb des Baums wird geladen', at(0x4805) === 0x07);
ok('Oktett nur des inaktiven Parameters wird nicht geschrieben', !image.has(0x4803));
ok('Zahl geschriebener Parameter = 4', plan.summary.params === 4);

// Ohne Sichtbarkeitsauflösung wird wie bisher alles geladen
const all = D.plan(project, project.devices[0], item, { kind: 'all', resolve: null });
ok('ohne Auflösung: alle 6 Parameter', all.summary.params === 6);

console.log(fail ? `\n${fail} Test(s) fehlgeschlagen` : '\nalle Tests bestanden');
process.exit(fail ? 1 : 0);
