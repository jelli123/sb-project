/* ============================================================
   Test: Downloadplan eines Security Proxys (knx-download.js)
   ============================================================ *
 * Ein Koppler mit Proxy: PID 80/82 auf beiden Router-Objekten und die
 * Proxy-Gruppenschlüsseltabelle vor dem Abschluss des Router-Objekts, die
 * gesicherten Absender in seiner Sicherheits-IA-Tabelle. Die Skripte laufen
 * wie im Browser in einem gemeinsamen Kontext:
 *
 *   node test/knx-download-proxy.test.js                                  */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const dir = path.join(__dirname, '..');
const ctx = { console };
vm.createContext(ctx);
for (const f of ['knx-proxy.js', 'knx-download.js'])
  vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8') + '\nthis.KNXProxy = typeof KNXProxy !== "undefined" ? KNXProxy : this.KNXProxy; this.KNXDownload = typeof KNXDownload !== "undefined" ? KNXDownload : undefined;', ctx, { filename: f });
const D = ctx.KNXDownload;
let fail = 0;
const ok = (n, c) => { console.log((c ? 'ok    ' : 'FAIL  ') + n); if (!c) fail++; };
const pa = s => { const [a, l, d] = s.split('.').map(Number); return (a << 12) | (l << 8) | d; };

const step = (n, a = {}) => ({ n, a });
const item = {
  id: 'cp', proxy: { gk: 128 }, secure: { ia: 32 }, params: {}, objs: {}, types: {},
  prog: { mask: 'MV-091A', appNumber: 1, appVersion: 4, style: 'MergedProcedure', segments: [],
    dl: { manu: 0xFA, segs: {}, lp: [], loc: {}, co: {}, opt: {},
      mk: { v: 0x091A, mm: 'Bcu1', feat: {}, io: {}, hosts: [0x091A], procs: [
        { t: 'Load', s: 'all', k: [step('LdCtrlUnload', { ObjType: '6' }), step('LdCtrlLoad', { ObjType: '6' }),
                                   step('LdCtrlLoadCompleted', { ObjType: '6' })] }] } } }
};
const project = {
  areas: [{ id: 'a0', addr: 0, backbone: true, lines: [{ id: 'l00', addr: 0 }] },
          { id: 'a1', addr: 1, lines: [{ id: 'l10', addr: 0 }, { id: 'l11', addr: 1 }] }],
  catalog: [item],
  groups: [{ id: 'g1', raw: 0x0A03, secure: true }],
  devices: [
    { id: 'r', addr: pa('1.1.0'), lineId: 'l11', catalogId: 'cp', secure: true, serial: '00FA00000001', objs: [], params: {} },
    { id: 'p', addr: pa('1.1.5'), lineId: 'l11', objs: [{ num: 1, gas: ['g1'], flags: {} }], params: {} },
    { id: 's', addr: pa('1.0.7'), lineId: 'l10', secure: true, serial: '00FA00000002', objs: [{ num: 1, gas: ['g1'], flags: {} }], params: {} }
  ]
};
const status = { unlocked: true, devices: { '00FA00000001': { toolKey: true } } };
const plan = D.plan(project, project.devices[0], item, { kind: 'all', secure: status, resolve: () => ({ objs: [], groups: [] }) });
console.log('errors:', plan.errors, 'warnings:', plan.warnings);
const ops = plan.steps.map(s => s.op + (s.pid ? ':' + s.pid + '/' + (s.occ || 0) : '') + (s.event ? ':' + s.event : ''));
console.log(ops.join(' '));
const keys = plan.steps.findIndex(s => s.op === 'proxyGroupKeys');
const done = plan.steps.findIndex(s => s.op === 'lsm' && s.event === 2 && s.ot === 6);
ok('proxy table before the router object completes', keys > 0 && keys < done);
ok('one entry, Sec@Prim', plan.steps[keys].entries.length === 1 && plan.steps[keys].entries[0].settings === 0x83);
ok('PID 80/82 on both router objects, blocked', plan.steps.filter(s => s.op === 'writeProp' && s.ot === 6 && (s.pid === 80 || s.pid === 82)).every(s => s.data === '00')
   && plan.steps.filter(s => s.op === 'writeProp' && s.ot === 6 && s.occ === 1).length === 2);
const ia = plan.steps.find(s => s.op === 'writeProp' && s.ot === 17 && s.pid === 54 && s.start === 1);
ok('proxy IA table holds the secure sender 1.0.7', ia && ia.data.startsWith('1007'));
ok('summary counts the table', plan.summary.proxy === 1);

// The secure sender's own IA table gets the proxy
const sitem = { ...item, id: 'cs', proxy: null };
project.catalog.push(sitem);
project.devices[2].catalogId = 'cs';
const fp1 = D.fingerprint(project, project.devices[0], item);
project.devices[0].proxy = { ptp: ['rule', 'rule'] };
const fp2 = D.fingerprint(project, project.devices[0], item);
ok('fingerprint follows the proxy configuration', fp1.grp !== fp2.grp);
ok('gates: none on the router line', D.gates(project, '1.1.250', '1.1.5').length === 0);
console.log(fail ? `\nFAILED: ${fail}` : '\nPASSED');
process.exit(fail ? 1 : 0);
