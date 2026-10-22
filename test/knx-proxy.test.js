/* ============================================================
   Test: Security Proxy (knx-proxy.js)
   ============================================================ *
 * Welche Gruppenadressen ein Koppler übersetzt, wo die Planung nicht aufgeht
 * und welche Proxys sich beim Programmieren öffnen müssen. Ohne Browser und
 * ohne Abhängigkeiten:
 *
 *   node test/knx-proxy.test.js                                           */
'use strict';
const P = require(require('path').join(__dirname, '..', 'knx-proxy.js'));
let fail = 0;
const ok = (name, c) => { console.log((c ? 'ok    ' : 'FAIL  ') + name); if (!c) fail++; };
const pa = s => { const [a, l, d] = s.split('.').map(Number); return (a << 12) | (l << 8) | d; };

function project(devs, groups = [{ id: 'g1', raw: 0x0A03, secure: true }]) {
  return {
    areas: [
      { id: 'a0', addr: 0, backbone: true, lines: [{ id: 'l00', addr: 0 }] },
      { id: 'a1', addr: 1, lines: [{ id: 'l10', addr: 0 }, { id: 'l11', addr: 1 }, { id: 'l12', addr: 2 }] }
    ],
    catalog: [{ id: 'cp', proxy: { gk: 128 }, secure: { ia: 32 } }, { id: 'cc' }],
    groups,
    devices: devs.map((d, i) => ({ id: 'd' + i, objs: d.ga ? [{ gas: [d.ga] }] : [], ...d,
                                   addr: pa(d.pa), lineId: d.line }))
  };
}
const dev = (p, line, extra = {}) => ({ pa: p, line, ...extra });
const router = (p, line, secure = true, extra = {}) => dev(p, line, { catalogId: 'cp', secure, serial: '00FA00000001', ...extra });

// 1: IP router 1.1.0 as proxy, plain TP devices behind it, secure device on main line
let pr = project([router('1.1.0', 'l11'), dev('1.1.5', 'l11', { ga: 'g1' }), dev('1.1.6', 'l11', { ga: 'g1' }),
                  dev('1.0.7', 'l10', { ga: 'g1', secure: true })]);
let an = P.analyse(pr);
let e = an.proxies.get('d0').entries;
ok('plain TP behind secure main line: one entry', e.length === 1 && e[0].raw === 0x0A03);
ok('  Sec@Prim set, Sec@Sec clear, conf+auth', e[0].settings === (P.SEC_PRIM | P.CONF_AUTH));
ok('  nothing blocked or mixed', !an.blocked.length && !an.mixed.length);
ok('  router sends secured: translator', P.translators(pr, 'g1', an).join() === String(pa('1.1.0')));
ok('  proxy IA table holds the secure sender', P.senders(pr, pr.devices[0], an).join() === String(pa('1.0.7')));

// 2: same, router not commissioned secure -> blocked
pr = project([router('1.1.0', 'l11', false), dev('1.1.5', 'l11', { ga: 'g1' }), dev('1.0.7', 'l10', { ga: 'g1', secure: true })]);
an = P.analyse(pr);
ok('router without secure: blocked at 1.1.0', an.blocked.length === 1 && an.blocked[0].pa === pa('1.1.0') && an.blocked[0].side === 'sec');

// 3: plain visu on main line, secure on 1.2 behind proxy, plain on 1.1 behind ordinary coupler
pr = project([dev('1.1.0', 'l11', { catalogId: 'cc' }), router('1.2.0', 'l12'),
              dev('1.0.9', 'l10', { ga: 'g1' }), dev('1.1.5', 'l11', { ga: 'g1' }), dev('1.2.5', 'l12', { ga: 'g1', secure: true })]);
an = P.analyse(pr);
e = an.proxies.get('d1').entries;
ok('secure line behind proxy, plain elsewhere: Sec@Sec', e.length === 1 && e[0].settings === (P.SEC_SEC | P.CONF_AUTH));
ok('  plain line 1.1 needs nothing', !an.blocked.length && !an.mixed.length);

// 4: mixed on one line
pr = project([dev('1.1.5', 'l11', { ga: 'g1' }), dev('1.1.6', 'l11', { ga: 'g1', secure: true })]);
an = P.analyse(pr);
ok('mixed line: the plain device is reported', an.mixed.length === 1 && an.mixed[0].dev.id === 'd0');

// 5: no coupler device at the boundary
pr = project([dev('1.1.5', 'l11', { ga: 'g1' }), dev('1.0.7', 'l10', { ga: 'g1', secure: true })]);
an = P.analyse(pr);
ok('missing coupler: blocked without device', an.blocked.length === 1 && an.blocked[0].dev === null);

// 6: all plain, secure flag only
pr = project([dev('1.1.5', 'l11', { ga: 'g1' }), dev('1.0.7', 'l10', { ga: 'g1' })]);
an = P.analyse(pr);
ok('no secure device anywhere: nothing to translate', !an.blocked.length && !an.mixed.length);

// 7: secure device on backbone side, plain area: area coupler is the boundary
pr = project([router('1.0.0', 'l10'), dev('1.1.0', 'l11', { catalogId: 'cc' }), dev('1.1.5', 'l11', { ga: 'g1' }),
              dev('0.0.5', 'l00', { ga: 'g1', secure: true })]);
an = P.analyse(pr);
e = an.proxies.get('d0').entries;
ok('backbone secure, area plain: area coupler translates', e.length === 1 && e[0].settings === (P.SEC_PRIM | P.CONF_AUTH));
ok('  line coupler 1.1.0 sees plain on both sides', !an.blocked.length);

// 8: gates
pr = project([router('1.1.0', 'l11'), router('1.2.0', 'l12', true, { serial: '00FA00000002' })]);
let g = P.gates(pr, pa('1.1.250'), pa('1.2.5'));
ok('two proxies on the way: two gates in path order', g.length === 2 && g[0].proxy === '1.1.0' && g[1].proxy === '1.2.0');
ok('  first gate also opens the way to the second proxy', g[0].partners.join() === '1.2.5,1.2.0' && g[1].partners.join() === '1.2.5');
ok('  ptp only, no broadcast for a download', g.every(x => x.ptp && !x.bc));
ok('same line: no gate', P.gates(pr, pa('1.1.250'), pa('1.1.5')).length === 0);
pr.devices[0].proxy = { ptp: ['rule', 'rule'], bc: ['rule', 'block'] };
g = P.gates(pr, pa('1.1.250'), pa('1.2.5'), true);
ok('assignment: broadcast gate where broadcast is blocked', g.length === 2 && g[0].bc && !g[0].ptp && g[1].bc && g[1].ptp);
ok('config defaults to block for an active proxy', P.config(pr, pr.devices[1]).ptp.join() === 'block,block');
ok('config of an ordinary coupler is rule', P.config(project([dev('1.1.0', 'l11', { catalogId: 'cc' })]), { addr: pa('1.1.0'), lineId: 'l11', catalogId: 'cc' }).bc.join() === 'rule,rule');

console.log(fail ? `\nFAILED: ${fail}` : '\nPASSED');
process.exit(fail ? 1 : 0);
