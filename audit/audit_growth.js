// ออดิตการโตของข้อมูล — จำลองเอกสารตามปริมาณงาน แล้ววัดขนาด payload / เวลา / จำนวนเซลล์ (ข้อมูลจำลอง · ห้าม deploy)
// รัน: node audit/audit_growth.js $PWD
const path = require('path'), fs = require('fs'), crypto = require('crypto');
const DIR = process.argv[2] || '.';
const { makeRuntime } = require(path.join(DIR, 'tests/gasmock.js'));
const H = s => crypto.createHash('sha256').update(s + 'mgs-internal-2025').digest('hex');
const out = [];
for (const N of [100, 500, 1500]) {                     // จำนวน QT สะสม (SR อีก 0.7 เท่า)
  const { ctx, sheets } = makeRuntime(path.join(DIR, 'Code.gs'));
  const U = sheets['Users'], uh = U.rows[0];
  [['src', 'Src', 'Sourcing'], ['boss', 'BOSS', 'Sales'], ['adm', 'Adm', 'Admin']].forEach(([id, n, r]) => { const x = []; x[uh.indexOf('Id')] = id; x[uh.indexOf('Name')] = n; x[uh.indexOf('Role')] = r; x[uh.indexOf('Scope')] = 'all'; x[uh.indexOf('PassHash')] = H('pw123456'); U.rows.push(x); });
  const post = p => JSON.parse(ctx.apiPost(JSON.stringify(p)));
  const T = u => post({ action: 'login', user: u, passHash: H('pw123456') }).token;
  const ts = T('src'), tb = T('boss');
  for (let i = 0; i < N; i++) {
    const nl = 4 + (i % 12), na = 10 + (i % 40);
    const d = { id: 'Q' + i, _v: 2, _pm: 2, _sv: 3, docType: 'QT', docNo: 'QT-' + i, status: i % 3 ? 'Pending' : 'Won', releasedTo: ['boss'], approvals: [], approvalRoles: [],
      header: { ref: 'QT-' + i, title: 'Solar rooftop project ' + i, customer: 'บริษัท ลูกค้า จำกัด ' + i, salesUserId: 'boss', sales: 'BOSS', currency: 'THB', groupType: 'Inverter', rates: { USD: 36, CNY: 5 } },
      lines: Array.from({ length: nl }, (_, k) => ({ code: 'SG' + k, desc: 'SG110CX-P2 Inverter 110kW ' + k, group: 'INVERTER', qty: 2, uom: 'pcs', up: 1000, costCur: 'USD', dutyPct: 5, clearancePct: 2, opPct: 20, warranty: '10 YEAR' })),
      auditLogs: Array.from({ length: na }, (_, k) => ({ timestamp: '2026-10-13T00:00:00Z', user: 'Src', role: 'Sourcing', action: 'Changed Unit Price of SG' + k + ' from 1000 to 1010' })) };
    post({ token: ts, action: 'save', id: 'Q' + i, docType: 'QT', docNo: 'QT-' + i, status: d.status, salesUserId: 'boss', releasedTo: 'boss', total: 1, detail: JSON.stringify(d),
      salesDetail: JSON.stringify({ id: 'Q' + i, status: d.status, lines: d.lines.map(l => ({ code: l.code, desc: l.desc, qty: 2, unitPrice: 1, amount: 2 })), total: 2 }) });
  }
  for (let i = 0; i < Math.round(N * 0.7); i++) post({ token: tb, action: 'saveSR', id: 'S' + i, status: 'Submitted', detail: JSON.stringify({ header: { title: 'Req ' + i, customer: 'CP', groupType: 'Inverter' }, lines: [{ desc: 'a', qty: 1 }, { desc: 'b', qty: 2 }] }) });
  let t0 = Date.now(); const full = ctx.apiGet('quotations', ts, ''); const tFull = Date.now() - t0;
  t0 = Date.now(); const sv = ctx.apiGet('salesview', tb, ''); const tSv = Date.now() - t0;
  const QS = sheets['Quotations'];
  const cells = Object.values(sheets).reduce((a, s) => a + s.rows.length * (s.rows[0] || []).length, 0);
  const detailChars = QS.rows.slice(1).reduce((a, r) => a + String(r[QS.rows[0].indexOf('Detail')] || '').length + String(r[QS.rows[0].indexOf('SalesDetail')] || '').length, 0);
  const r = { QT: N, SR: Math.round(N * 0.7), quotationRows: QS.rows.length - 1, cellsAllTabs: cells, detailMB: +(detailChars / 1048576).toFixed(2),
    fullPullMB: +(full.length / 1048576).toFixed(2), fullPullMs_mock: tFull, salesViewKB: Math.round(sv.length / 1024), salesViewMs_mock: tSv,
    localStorageEstMB: +(full.length * 2 / 1048576).toFixed(2) };
  out.push(r); console.log(JSON.stringify(r));
}
fs.writeFileSync(path.join(DIR, 'audit/out/growth_results.json'), JSON.stringify(out, null, 1));
