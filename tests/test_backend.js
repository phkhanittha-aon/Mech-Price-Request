const { makeRuntime } = require('./gasmock');
const crypto = require('crypto');
const path = process.argv[2];
const { ctx, sheets } = makeRuntime(path);
const H = s => crypto.createHash('sha256').update(s + 'mgs-internal-2025').digest('hex');
let fails = 0;
const ok = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra && !cond ? '  -> ' + JSON.stringify(extra).slice(0, 300) : '')); if (!cond) fails++; };
const post = p => JSON.parse(ctx.apiPost(JSON.stringify(p)));
const get = (type, tok, arg) => JSON.parse(ctx.apiGet(type, tok, arg));
const sleep = ms => { const t = Date.now() + ms; while (Date.now() < t); };

// seed users — note deliberately messy role spellings
const users = [
  ['gm', 'General Manager', 'GM'], ['admin', 'Admin', 'Admin'],
  ['procurement', 'Procurement Manager', 'procurement mgr '], ['bd', 'BD Manager', 'BD Manager'],
  ['sourcing1', 'Chatraporn', 'Sourcing'], ['sales_non', 'NON', 'Sales'], ['sales_boss', 'BOSS', 'Sales']
];
const us = sheets['Users'];
users.forEach(u => us.rows.push([u[0], u[1], u[2], 'all', H('1234'), '']));

const tok = {};
users.forEach(u => { const r = post({ action: 'login', user: u[0], passHash: H('1234') }); tok[u[0]] = r.token; ok('login ' + u[0], r.ok, r);
  if (u[0] === 'procurement') ok('alias "procurement mgr " → Procurement Mgr (MANAGEMENT)', r.user.role === 'Procurement Mgr' && r.user.tier === 'MANAGEMENT', r.user);
  if (u[0] === 'bd') ok('alias "BD Manager" → BD Mgr (MANAGEMENT)', r.user.role === 'BD Mgr' && r.user.caps.viewCost, r.user); });

// Sourcing saves a quote in Submitted
const q = { id: 'Q1', docType: 'QT', docNo: 'QT-001', status: 'Submitted', approvalRoles: [], approvals: [], releasedTo: [],
  header: { ref: 'R1', title: 'Proj', customer: 'Cust', sales: 'BOSS', salesUserId: 'sales_boss', currency: 'THB', groupType: 'Inverter' },
  lines: [{ code: 'A', qty: 2, up: 100, costCur: 'USD', dutyPct: 5, opPct: 20 }], auditLogs: [] };
const salesDetail = { id: 'Q1', docType: 'QT', status: 'Submitted', header: q.header, lines: [{ code: 'A', qty: 2, unitPrice: 5000, amount: 10000 }], total: 10000 };
let r = post({ token: tok.sourcing1, action: 'save', id: 'Q1', docType: 'QT', docNo: 'QT-001', status: 'Submitted', salesUserId: 'sales_boss',
  total: 10000, cost: 8000, profit: 2000, gp: 20, lines: 1, detail: JSON.stringify(q), salesDetail: JSON.stringify(salesDetail) });
ok('sourcing save', r.ok && r.updatedAt, r);
let base1 = r.updatedAt;

// Visibility at Submitted
['gm', 'admin', 'procurement', 'bd', 'sourcing1'].forEach(u => {
  const d = get('quotations', tok[u]); const row = d.quotations.find(x => x.id === 'Q1');
  ok('[Submitted] ' + u + ' sees FULL data (detail+cost+gp)', d.view === 'internal' && row && row.detail && row.cost === 8000 && row.gp === 20, row);
});
['sales_non', 'sales_boss'].forEach(u => {
  const d = get('quotations', tok[u]); const row = d.quotations.find(x => x.id === 'Q1');
  ok('[Submitted] ' + u + ' gets NO price/cost', d.view === 'sales' && (!row || (!row.detail && row.cost === undefined && !row.salesDetail && row.priceLocked)), row);
});

// single quote + serverTime
let one = get('quote', tok.bd, 'Q1');
ok('type=quote returns the quote + serverTime', one.ok && one.quote && one.quote.id === 'Q1' && one.serverTime, one);

// Dual approval, "concurrent": both managers act from the same stale view
sleep(5);
r = post({ token: tok.procurement, action: 'approve', id: 'Q1' });
ok('Procurement approve → Partial Approved', r.ok && r.status === 'Partial Approved' && r.missing.join() === 'BD Mgr', r);
sleep(5);
r = post({ token: tok.bd, action: 'approve', id: 'Q1' });
ok('BD approve (stale client) keeps Procurement approval → Approved', r.ok && r.status === 'Approved' && r.approvalRoles.join() === 'Procurement Mgr,BD Mgr', r);
const det = JSON.parse(r.detail);
ok('approve returns full Detail with both approvals', det.approvalRoles.length === 2 && det.approvals.length === 2 && det.status === 'Approved');
r = post({ token: tok.bd, action: 'approve', id: 'Q1' });
ok('approve again → NOT_IN_APPROVAL (409)', !r.ok && r.error === 'NOT_IN_APPROVAL', r);
r = post({ token: tok.sourcing1, action: 'approve', id: 'Q1' });
ok('Sourcing cannot approve', !r.ok && r.error === 'ACCESS_DENIED', r);
// SalesDetail must not get approvalRoles from approve patch
const qs = sheets['Quotations'], hdr = qs.rows[0];
const sdRaw = qs.rows[1][hdr.indexOf('SalesDetail')];
ok('SalesDetail stays cost-free after approve patch (no approvalRoles)', sdRaw.indexOf('approvalRoles') < 0, sdRaw.slice(0, 200));

// Conflict guard: Sourcing still holds base1 (before the approvals)
r = post({ token: tok.sourcing1, action: 'save', id: 'Q1', status: 'Submitted', detail: JSON.stringify(q), baseUpdatedAt: base1 });
ok('stale save → CONFLICT 409 (approval NOT overwritten)', !r.ok && r.error === 'CONFLICT' && r.serverBy === 'BD Manager' && r.serverStatus === 'Approved', r);
ok('sheet still Approved after rejected save', qs.rows[1][hdr.indexOf('Status')] === 'Approved');

// Sales visibility at Approved: gatekeeper NON sees, owner BOSS not yet
let dn = get('quotations', tok.sales_non).quotations.find(x => x.id === 'Q1');
let db = get('quotations', tok.sales_boss).quotations.find(x => x.id === 'Q1');
ok('[Approved] NON (gatekeeper) sees SalesDetail to review before release', dn && dn.salesDetail && !dn.priceLocked && dn.canRelease, dn);
ok('[Approved] BOSS (owner) still locked until release', db && db.priceLocked && !db.salesDetail, db);
ok('[Approved] Sales never gets Detail/cost/gp', dn.detail === undefined && dn.cost === undefined && dn.gp === undefined);

// release by NON
sleep(5);
r = post({ token: tok.sales_non, action: 'release', id: 'Q1' });
ok('NON release → Pending, no full Detail returned to Sales', r.ok && !r.detail, r);
db = get('quotations', tok.sales_boss).quotations.find(x => x.id === 'Q1');
ok('[Pending] BOSS now sees SalesDetail', db && db.salesDetail && !db.priceLocked, db);
ok('[Pending] BOSS SalesDetail has no cost keys', !/"(up|cost|gp|opPct|dutyPct|approvalRoles|exrate)"/i.test(db.salesDetail), db.salesDetail);

// defense-in-depth: a legacy SalesDetail containing cost keys is sanitized on output
qs.rows[1][hdr.indexOf('SalesDetail')] = JSON.stringify({ id: 'Q1', lines: [{ code: 'A', up: 99, cost: 1, unitPrice: 5 }], gp: 30 });
db = get('quotations', tok.sales_boss).quotations.find(x => x.id === 'Q1');
const sd = JSON.parse(db.salesDetail);
ok('legacy SalesDetail with cost keys is stripped on output', sd.gp === undefined && sd.lines[0].up === undefined && sd.lines[0].cost === undefined && sd.lines[0].unitPrice === 5, sd);

// managers still see everything at Pending/Won/Closed
['Pending', 'Won', 'Closed'].forEach(st => {
  qs.rows[1][hdr.indexOf('Status')] = st;
  ['gm', 'admin', 'procurement', 'bd', 'sourcing1'].forEach(u => {
    const row = get('quotations', tok[u]).quotations.find(x => x.id === 'Q1');
    ok('[' + st + '] ' + u + ' full data', row && row.detail && row.cost === 8000);
  });
});

// changes since
const t0 = new Date(Date.now() + 5).toISOString(); sleep(10);
let ch = get('changes', tok.gm, t0);
ok('changes since now → 0 rows', ch.ok && ch.quotations.length === 0 && ch.serverTime, ch);
sleep(5);
const fresh = get('quote', tok.gm, 'Q1').quote.updatedAt;
r = post({ token: tok.gm, action: 'save', id: 'Q1', salesUserId: 'sales_boss', status: 'Pending', detail: JSON.stringify(q), baseUpdatedAt: fresh });
ok('save with fresh base → ok', r.ok, r);
ch = get('changes', tok.gm, t0);
ok('changes since t0 → returns the changed row', ch.ok && ch.quotations.length === 1 && ch.quotations[0].id === 'Q1');
r = post({ token: tok.sourcing1, action: 'save', id: 'Q1', salesUserId: 'sales_boss', status: 'Pending', detail: JSON.stringify(q), baseUpdatedAt: base1, force: true });
ok('force save overrides conflict (explicit user choice)', r.ok, r);
ok('no-base save (legacy client) still works', post({ token: tok.sourcing1, action: 'save', id: 'Q2', detail: JSON.stringify(Object.assign({}, q, { id: 'Q2' })) }).ok);

// Sales-patch (follow-up) unaffected
r = post({ token: tok.sales_boss, action: 'salesPatch', id: 'Q1', patch: JSON.stringify({ salesNote: 'called', followUpDate: '2026-10-20' }) });
ok('Sales follow-up salesPatch still works + returns updatedAt', r.ok && r.updatedAt, r);
// AUTH
ok('expired/unknown token → AUTH_REQUIRED', get('quotations', 'bogus').error === 'AUTH_REQUIRED');
ok('users list returns canonical roles', get('users', tok.admin).users.find(u => u.id === 'bd').role === 'BD Mgr');
console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL BACKEND TESTS PASSED');
process.exit(fails ? 1 : 0);
