// Phase 6 — Smoke test ครบทุก role (server = ที่ตัดสินสิทธิ์จริง)
//   A) สิทธิ์ (caps) ต่อ role + หน้าที่ลิงก์หลักพาไป   B) ตารางอนุญาต/ปฏิเสธทุก action ต่อทุก role
//   C) price projection: สแกน "ทุก response" ที่ Sales / Sales Manager ได้รับ ต้องไม่มี field ต้นทุนแม้แต่ตัวเดียว
//   D) SR → QT (SR เป็นหลักฐาน ห้ามถูกเขียนทับ)   E) ลำดับอนุมัติ 2 ฝ่าย / GM แทน   F) ปล่อยราคา
//   G) follow-up: งานก่อนปล่อยราคา "ไม่" อยู่ในงานค้างของ Sales แต่ "อยู่" ที่เจ้าของจริง
// รัน: node tests/smoke_roles.js $PWD   (ทดสอบบนเครื่องเท่านั้น ห้าม deploy)
const crypto = require('crypto');
const { makeRuntime } = require('./gasmock');
const DIR = process.argv[2] || '.';
const { ctx, sheets } = makeRuntime(DIR + '/Code.gs');
const H = s => crypto.createHash('sha256').update(s + 'mgs-internal-2025').digest('hex');
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 400) : '')); if (!c) fails++; };
const U = sheets['Users'], uh = U.rows[0];
const USERS = [['admin', 'Admin', 'Admin'], ['gm', 'GM', 'GM'], ['pm', 'Procure', 'Procurement Mgr'], ['bd', 'BD', 'BD Mgr'], ['src', 'Chatraporn', 'Sourcing'],
  ['smgr', 'Tom', 'Sales Manager'], ['boss', 'BOSS', 'Sales'], ['pair', 'PAIR', 'Sales'], ['sales_non', 'NON', 'Sales']];
USERS.forEach(([id, n, r]) => { const x = []; x[uh.indexOf('Id')] = id; x[uh.indexOf('Name')] = n; x[uh.indexOf('Role')] = r; x[uh.indexOf('Scope')] = 'all'; x[uh.indexOf('PassHash')] = H('pw123456'); x[uh.indexOf('Email')] = id + '@m.co'; U.rows.push(x); });
const post = p => JSON.parse(ctx.apiPost(JSON.stringify(p)));
const get = (t, tok, a) => JSON.parse(ctx.apiGet(t, tok, a));
const T = {}; USERS.forEach(([id]) => { T[id] = post({ action: 'login', user: id, passHash: H('pw123456') }).token; });
const Q = sheets['Quotations'], qh = Q.rows[0], rowOf = id => Q.rows.find(r => r[qh.indexOf('Id')] === id), cellOf = (id, c) => (rowOf(id) || [])[qh.indexOf(c)];
const SALES_RESPONSES = [];                                    // ทุก response ที่ฝั่ง Sales ได้รับ → สแกนตอนท้าย
const asSales = (who, fn) => { const r = fn(); SALES_RESPONSES.push({ who, r }); return r; };
const qtDetail = (id, status, extra) => JSON.stringify(Object.assign({ id, docType: 'QT', docNo: 'QT-' + id, status, approvalRoles: [], approvals: [],
  header: { title: 'Rooftop ' + id, customer: 'CP Group', currency: 'USD', rates: { USD: 36, CNY: 5 }, exrate: 36, salesUserId: 'boss', sales: 'BOSS' },
  lines: [{ code: 'SG110CX', desc: 'Inverter', qty: 2, up: 3000, costCur: 'USD', dutyPct: 5, clearancePct: 2, opPct: 20, freep: 0 }], globalExtras: [], auditLogs: [{ action: 'x' }] }, extra || {}));
const salesCopy = (id, status) => JSON.stringify({ id, docType: 'QT', status, header: { title: 'Rooftop ' + id, customer: 'CP Group', currency: 'USD', salesUserId: 'boss' },
  lines: [{ code: 'SG110CX', desc: 'Inverter', qty: 2, uom: 'pcs', unitPrice: 141750, amount: 283500, up: 3000, opPct: 20 }], total: 283500 });   // ใส่ up/opPct ปลอมไว้ → server ต้องตัดทิ้ง
const saveQT = (tok, id, status, extra) => post(Object.assign({ token: tok, action: 'save', id, docType: 'QT', docNo: 'QT-' + id, status, salesUserId: 'boss', sales: 'BOSS',
  title: 'Rooftop ' + id, customer: 'CP Group', currency: 'USD', exrate: 36, total: 283500, cost: 236250, profit: 47250, gp: 16.7, detail: qtDetail(id, status), salesDetail: salesCopy(id, status) }, extra || {}));

/* ------------------------------------------------------------------ A) caps + routing */
console.log('== A) สิทธิ์ต่อ role (มาจาก server) + หน้าที่ลิงก์หลักพาไป ==');
const caps = {}; USERS.forEach(([id]) => { caps[id] = get('whoami', T[id]).user.caps; });
console.log('   role'.padEnd(22) + 'tier'.padEnd(12) + 'ต้นทุน เขียนใบ อนุมัติ ผู้ใช้ ตั้งค่า เห็นทีม  → หน้า');
USERS.forEach(([id, , r]) => { globalThis.__SSO_EMAIL = id + '@m.co'; const page = ctx.doGet({ parameter: {} }).file; const c = caps[id];
  console.log('   ' + r.padEnd(19) + c.tier.padEnd(12) + ['viewCost', 'writeQuote', 'approve', 'manageUsers', 'manageSetting', 'viewAllSales'].map(k => (c[k] ? '  ✓   ' : '  ·   ')).join('') + ' → ' + page); });
const pageFor = id => { globalThis.__SSO_EMAIL = id + '@m.co'; return ctx.doGet({ parameter: {} }).file; };
ok('Admin / GM / ผู้จัดการ / Sourcing → ระบบทำราคา (Index)', ['admin', 'gm', 'pm', 'bd', 'src'].every(id => pageFor(id) === 'Index'));
ok('Sales / Sales Manager → แอป Sales', ['boss', 'smgr', 'sales_non'].every(id => pageFor(id) === 'Sales'));
ok('tier: Admin/GM = ADMIN · PM/BD = MANAGEMENT · Sourcing = INTERNAL · Sales/Sales Mgr = SALES',
  caps.admin.tier === 'ADMIN' && caps.gm.tier === 'ADMIN' && caps.pm.tier === 'MANAGEMENT' && caps.bd.tier === 'MANAGEMENT' && caps.src.tier === 'INTERNAL' && caps.boss.tier === 'SALES' && caps.smgr.tier === 'SALES');
ok('Sales ไม่มีสิทธิ์ดูต้นทุน/เขียนใบ/อนุมัติ · Sales Manager เห็นทีมแต่ไม่เห็นต้นทุน', !caps.boss.viewCost && !caps.boss.writeQuote && !caps.boss.approve && caps.smgr.viewAllSales && !caps.smgr.viewCost);
ok('client ส่ง role ปลอมมาไม่มีผล (ใช้แต่ token)', post({ token: T.boss, role: 'GM', action: 'approve', id: 'x' }).error === 'ACCESS_DENIED');

/* ------------------------------------------------------------------ B) ตารางอนุญาต/ปฏิเสธ */
console.log('== B) ตารางอนุญาต (✓) / ปฏิเสธ (✗) ทุก action ==');
saveQT(T.src, 'BASE', 'In Progress');
post({ token: T.boss, action: 'saveSR', id: 'SR-PAIR', status: 'Submitted', detail: JSON.stringify({ status: 'Submitted', header: { title: 'pair req' }, lines: [{ desc: 'a' }] }) });
const denied = r => r && (r.error === 'ACCESS_DENIED' || r.error === 'ROLE_CANNOT_APPROVE');
const ACTIONS = {
  'save (เขียนใบเต็ม)':        (id) => post({ token: T[id], action: 'save', id: 'B-' + id, docType: 'QT', status: 'In Progress', detail: qtDetail('B-' + id, 'In Progress') }),
  'saveProduct':              (id) => post({ token: T[id], action: 'saveProduct', code: 'P-' + id, desc: 'x' }),
  'saveSettings':             (id) => post({ token: T[id], action: 'saveSettings', settingsRev: 1, detail: '{}' }),
  'saveUsers':                (id) => post({ token: T[id], action: 'saveUsers', users: '[]' }),
  'unlockUser':               (id) => post({ token: T[id], action: 'unlockUser', id: 'boss' }),
  'saveMaster (ตั้งค่าเริ่มต้น)': (id) => post({ token: T[id], action: 'saveMaster', list: 'uom', op: 'default', value: 'pcs' }),
  'addMaster incoterm':       (id) => post({ token: T[id], action: 'addMaster', list: 'incoterm', value: 'TEST ' + id }),
  'addMaster หน่วยนับ':        (id) => post({ token: T[id], action: 'addMaster', list: 'uom', value: 'u-' + id }),
  'approve':                  (id) => post({ token: T[id], action: 'approve', id: 'NOPE' }),
  'salesPatch งานของ BOSS':    (id) => post({ token: T[id], action: 'salesPatch', id: 'SR-PAIR', patch: JSON.stringify({ salesNote: 'n' }) }),
  'users (ดูรายชื่อ+hash)':     (id) => get('users', T[id])
};
const EXPECT = {   // true = อนุญาต
  'save (เขียนใบเต็ม)':        ['admin', 'gm', 'pm', 'bd', 'src'],
  'saveProduct':              ['admin', 'gm', 'pm', 'bd', 'src'],
  'saveSettings':             ['admin', 'gm', 'pm', 'bd'],
  'saveUsers':                ['admin', 'gm'],
  'unlockUser':               ['admin', 'gm'],
  'saveMaster (ตั้งค่าเริ่มต้น)': ['admin', 'gm', 'pm', 'bd'],
  'addMaster incoterm':       ['admin', 'gm', 'pm', 'bd', 'src'],
  'addMaster หน่วยนับ':        ['admin', 'gm', 'pm', 'bd', 'src', 'smgr', 'boss', 'pair', 'sales_non'],
  'approve':                  ['gm', 'pm', 'bd'],
  'salesPatch งานของ BOSS':    ['admin', 'gm', 'pm', 'bd', 'src', 'smgr', 'boss']
};
const ids = USERS.map(u => u[0]);
console.log('   ' + 'action'.padEnd(28) + ids.map(i => i.slice(0, 5).padEnd(6)).join(''));
let matrixOk = true;
Object.keys(EXPECT).forEach(a => {
  const row = ids.map(id => { const r = ACTIONS[a](id); if (['boss', 'pair', 'smgr', 'sales_non'].includes(id)) SALES_RESPONSES.push({ who: id, r }); const allowed = !denied(r); const want = EXPECT[a].includes(id); if (allowed !== want) { matrixOk = false; console.log('     ✗ ' + a + ' / ' + id + ' ได้ ' + JSON.stringify(r).slice(0, 120)); } return (allowed ? '✓' : '✗') + (allowed === want ? ' ' : '!'); });
  console.log('   ' + a.padEnd(28) + row.map(c => c.padEnd(6)).join(''));
});
ok('ทุกช่องตรงกับที่ออกแบบ (ไม่มี ! = ผิดจากที่คาด)', matrixOk);
const uAdmin = get('users', T.admin).users, uSrc = get('users', T.src).users;
ok('รายชื่อผู้ใช้: ไม่มีใครได้ PassHash กลับไปเลย (รวม Admin)', !JSON.stringify(uAdmin).includes('v2$') && !JSON.stringify(uSrc).includes('v2$') && !JSON.stringify(uAdmin).includes(H('pw123456')));

/* ------------------------------------------------------------------ D) SR → QT */
console.log('== D) SR → QT ==');
let r = asSales('boss', () => post({ token: T.boss, action: 'saveSR', id: 'SR1', status: 'Submitted', detail: JSON.stringify({ status: 'Submitted', header: { title: 'Factory 1MW', customer: 'CP', salesUserId: 'pair' }, lines: [{ desc: 'Inverter 110kW', qty: 3, targetUp: '150,000', up: 999, opPct: 50 }] }) }));
const srDoc0 = JSON.parse(cellOf('SR1', 'Detail'));
ok('Sales ส่ง SR: server ออกเลข SR · บังคับเจ้าของงาน = ตัวเอง (ปลอมเป็น pair ไม่ได้) · ตัดค่าต้นทุนที่แนบมาทิ้ง',
  r.ok && /^SR-/.test(r.docNo) && cellOf('SR1', 'SalesUserId') === 'boss' && srDoc0.lines[0].up === 0 && srDoc0.lines[0].opPct === 0 && srDoc0.lines[0].targetUp === 150000, srDoc0.lines[0]);
r = post({ token: T.src, action: 'save', id: 'SR1', docType: 'SR', docNo: r.docNo, status: 'Accepted', assignedTo: 'src', salesUserId: 'boss',
  detail: JSON.stringify(Object.assign({}, srDoc0, { status: 'Accepted', assignedTo: 'src' })) });
ok('Sourcing รับงาน (Accepted)', r.ok && cellOf('SR1', 'Status') === 'Accepted');
r = asSales('boss', () => post({ token: T.boss, action: 'saveSR', id: 'SR1', status: 'Submitted', detail: JSON.stringify({ status: 'Submitted', header: { title: 'แก้หลังรับงาน' }, lines: [] }) }));
ok('Sales แก้ SR หลัง Sourcing รับงานไม่ได้ (SR_LOCKED)', r.error === 'SR_LOCKED');
r = saveQT(T.src, 'QT1', 'In Progress', { detail: qtDetail('QT1', 'In Progress', { srId: 'SR1' }) });
post({ token: T.src, action: 'save', id: 'SR1', docType: 'SR', docNo: srDoc0.docNo, status: 'Quoted', assignedTo: 'src', salesUserId: 'boss', detail: JSON.stringify(Object.assign({}, srDoc0, { status: 'Quoted', assignedTo: 'src', quoteIds: ['QT1'] })) });
const srDoc1 = JSON.parse(cellOf('SR1', 'Detail'));
ok('สร้าง QT ผูก SR → SR เป็น Quoted และรายการที่ Sales ขอยังเหมือนเดิม (ไม่ถูกเขียนทับด้วยราคา)', r.ok && cellOf('SR1', 'Status') === 'Quoted' && srDoc1.lines[0].desc === 'Inverter 110kW' && srDoc1.lines[0].targetUp === 150000 && !srDoc1.lines[0].unitPrice, srDoc1.lines[0]);
ok('SR กับ QT เป็นคนละแถว คนละเลขเอกสาร', rowOf('SR1') !== rowOf('QT1') && cellOf('SR1', 'DocType') === 'SR' && cellOf('QT1', 'DocType') === 'QT');

/* ------------------------------------------------------------------ G1) follow-up ระหว่างทำราคา */
console.log('== E/F/G) อนุมัติ · ปล่อยราคา · follow-up ==');
const svFor = (who) => asSales(who, () => get('salesview', T[who], '')).quotations || [];
const fol = (who, id) => { const x = svFor(who).find(q => q.id === id); return x && x.follow; };
let f = fol('boss', 'QT1');
ok('ระหว่าง Sourcing ทำราคา: งานของ BOSS อยู่ที่ Sourcing (ไม่ใช่งานค้างของ Sales)', f && f.owner === 'SOURCING' && !(f.owner === 'SALES' && f.actionable), f);
ok('…และ Sales ยังไม่เห็นราคา', !svFor('boss').find(q => q.id === 'QT1').salesDetail);
r = saveQT(T.src, 'QT1', 'Submitted', { detail: qtDetail('QT1', 'Submitted', { srId: 'SR1' }) });
f = fol('boss', 'QT1');
// v5.0 (ตั้งใจ): ป้ายบอกระดับที่รอ (อนุมัติเรียงลำดับ) แทน "รอผู้จัดการอนุมัติ"
ok('ส่งขออนุมัติ: งานอยู่ที่ผู้จัดการ (MANAGEMENT) ไม่ใช่ Sales — รอ Sourcing Manager ระดับ 1', f.owner === 'MANAGEMENT' && f.label === 'รอ Sourcing Manager อนุมัติ (ระดับ 1/2)' && f.step === 2, f);
ok('ฝั่งผู้จัดการ (quotations): ใบนี้อยู่ในคิวของผู้อนุมัติ', (get('quotations', T.pm).quotations.find(q => q.id === 'QT1') || {}).follow.owner === 'MANAGEMENT');
ok('ปล่อยราคาก่อนอนุมัติไม่ได้ (NOT_APPROVED)', post({ token: T.gm, action: 'release', id: 'QT1' }).error === 'NOT_APPROVED');
ok('Sourcing อนุมัติไม่ได้', denied(post({ token: T.src, action: 'approve', id: 'QT1' })));
r = post({ token: T.pm, action: 'approve', id: 'QT1' });
ok('Procurement อนุมัติก่อน → Partial Approved (รอ BD)', r.ok && r.status === 'Partial Approved' && r.missing.join() === 'BD Mgr', r);
ok('Procurement กดซ้ำ → ALREADY_APPROVED (ไม่นับซ้ำ)', post({ token: T.pm, action: 'approve', id: 'QT1' }).error === 'ALREADY_APPROVED');
f = fol('boss', 'QT1'); ok('อนุมัติบางส่วน: ยังไม่ใช่งานของ Sales — รอ BD Manager ระดับ 2', f.owner === 'MANAGEMENT' && /รอ BD Manager/.test(f.label) && f.step === 3, f);
r = post({ token: T.bd, action: 'approve', id: 'QT1' });
ok('BD อนุมัติครบ → Approved', r.ok && r.status === 'Approved' && r.complete);
f = fol('boss', 'QT1'); ok('อนุมัติแล้วแต่ยังไม่ปล่อย: งานอยู่ที่ผู้ปล่อยราคา · Sales ยังไม่เห็นราคา', f.owner === 'RELEASER' && !svFor('boss').find(q => q.id === 'QT1').salesDetail, f);
ok('Sales อื่น (PAIR) ปล่อยราคาไม่ได้', denied(asSales('pair', () => post({ token: T.pair, action: 'release', id: 'QT1' }))));
r = asSales('sales_non', () => post({ token: T.sales_non, action: 'release', id: 'QT1' }));
ok('ผู้ปล่อยราคา (NON) ปล่อยราคา → Pending + ให้สิทธิ์ BOSS', r.ok && cellOf('QT1', 'Status') === 'Pending' && String(cellOf('QT1', 'ReleasedTo')).split('|').includes('boss'), r);
ok('response ของการปล่อยราคา (ฝั่ง Sales) ไม่มี Detail ตัวเต็ม', !r.detail);
const bossQ = svFor('boss').find(q => q.id === 'QT1');
f = bossQ.follow;
ok('หลังปล่อย: เป็นงานของ BOSS (SALES · พร้อมเสนอลูกค้า) และ BOSS เห็นราคาฉบับ Sales', f.owner === 'SALES' && f.label === 'พร้อมเสนอลูกค้า' && /283500/.test(bossQ.salesDetail), f);
ok('PAIR (Sales อื่น) ไม่เห็นใบนี้เลย', !svFor('pair').some(q => q.id === 'QT1'));
ok('Sales Manager เห็นใบของทีม (ไม่เห็นต้นทุน)', svFor('smgr').some(q => q.id === 'QT1'));
// GM อนุมัติแทน
saveQT(T.src, 'QT2', 'Submitted');
// v5.0 (ตั้งใจ): GM อนุมัติแทน "ทีละระดับ" เป็นค่าปกติ · ทั้ง 2 ระดับในครั้งเดียวต้องส่ง all:true (ปุ่ม "อนุมัติแทนทั้ง 2 ระดับ")
r = post({ token: T.gm, action: 'approve', id: 'QT2' });
ok('GM อนุมัติแทนระดับที่รออยู่ (ระดับ 1) → Partial Approved', r.ok && r.status === 'Partial Approved' && r.next === 'BD Mgr', r);
r = post({ token: T.gm, action: 'approve', id: 'QT2' });
ok('GM กดอีกครั้งแทนระดับ 2 → Approved', r.ok && r.status === 'Approved' && r.complete);
saveQT(T.src, 'QT2b', 'Submitted'); r = post({ token: T.gm, action: 'approve', id: 'QT2b', all: true });
ok('GM อนุมัติแทนทั้ง 2 ระดับในครั้งเดียว (all)', r.ok && r.status === 'Approved' && r.complete);
// อนุมัติพร้อมกัน 2 ฝ่าย (atomic) — ลำดับสลับ
// v5.0 (ตั้งใจ): ผู้ใช้กำหนดให้อนุมัติเรียงลำดับ — BD กดก่อน Sourcing Manager ไม่ได้อีกต่อไป (เดิมลำดับสลับได้)
saveQT(T.src, 'QT3', 'Submitted'); r = post({ token: T.bd, action: 'approve', id: 'QT3' });
ok('ลำดับสลับ (BD ก่อน Sourcing Manager) → ไม่ได้ (WAIT_PREVIOUS_LEVEL) · ไม่มีอะไรเปลี่ยน', !r.ok && r.error === 'WAIT_PREVIOUS_LEVEL' && cellOf('QT3', 'Status') === 'Submitted', r);
post({ token: T.pm, action: 'approve', id: 'QT3' }); r = post({ token: T.bd, action: 'approve', id: 'QT3' });
ok('ตามลำดับ → Approved · approvalRoles ครบไม่หาย', r.ok && r.status === 'Approved' && r.approvalRoles.join() === 'Procurement Mgr,BD Mgr');
// follow-up ต่อ: ไม่อัปเดตเกินกำหนด → งานค้างของ Sales
const det = JSON.parse(cellOf('QT1', 'Detail')); const old = new Date(Date.now() - 10 * 86400000).toISOString();
det.statusChangedAt = old; det.statusLog = (det.statusLog || []).concat([{ s: 'Pending', at: old }]); rowOf('QT1')[qh.indexOf('Detail')] = JSON.stringify(det);
f = fol('boss', 'QT1');
ok('ปล่อยแล้ว 10 วันไม่อัปเดต → กลายเป็นงานค้างของ Sales (เกินกำหนด)', f.owner === 'SALES' && f.actionable && f.level === 'over', f);
r = asSales('boss', () => post({ token: T.boss, action: 'salesPatch', id: 'QT1', patch: JSON.stringify({ salesUpdate: { at: new Date().toISOString(), stage: 'ลูกค้ากำลังเทียบราคา', note: 'โทรแล้ว' }, salesUpdatedAt: new Date().toISOString(), up: 1, cost: 1 }) }));
f = fol('boss', 'QT1');
ok('Sales อัปเดตความคืบหน้า → หายจากงานค้าง · ฟิลด์อื่นที่แนบมา (up / cost) ถูกตัดทิ้ง', r.ok && !f.actionable && f.level === 'ok' && JSON.parse(cellOf('QT1', 'Detail')).lines[0].up === 3000, f);
// ใบรุ่นเก่า Pending ที่ไม่มีฉบับ Sales
saveQT(T.src, 'QT4', 'Pending', { salesDetail: '' });
ok('ใบรุ่นเก่า Pending ไม่มีราคาฉบับ Sales → งานของ Sourcing (REPAIR) ไม่ใช่งานค้างของ Sales', (fol('boss', 'QT4') || {}).owner === 'REPAIR');

/* ------------------------------------------------------------------ C) price projection scan */
console.log('== C) price projection: สแกนทุก response ที่ฝั่ง Sales ได้รับ ==');
['boss', 'smgr', 'sales_non', 'pair'].forEach(who => {
  ['quotations', 'salesview', 'products', 'settings', 'users', 'whoami', 'master'].forEach(t => SALES_RESPONSES.push({ who, r: get(t, T[who], '') }));
  SALES_RESPONSES.push({ who, r: get('quote', T[who], 'QT1') }); SALES_RESPONSES.push({ who, r: get('changes', T[who], new Date(Date.now() - 864e5).toISOString()) });
});
const COST = new Set(ctx.COST_KEYS.concat(['detail', 'passhash', 'commission', 'groups', 'cost', 'profit']));
let scanned = 0; const leaks = [];
const walk = (v, path, who) => {
  if (v && typeof v === 'object') { for (const k in v) { scanned++; if (COST.has(k.toLowerCase())) leaks.push(who + ':' + path + '.' + k); walk(v[k], path + '.' + k, who); } }
  else if (typeof v === 'string' && /^[{[]/.test(v)) { try { walk(JSON.parse(v), path + '(json)', who); } catch (e) { } }   // SalesDetail เป็น JSON ซ้อนในสตริง
};
SALES_RESPONSES.forEach(x => walk(x.r, '', x.who));
console.log('   สแกน ' + SALES_RESPONSES.length + ' responses · ' + scanned + ' fields (รวม JSON ที่ซ้อนในสตริง)');
ok('ไม่พบ field ต้นทุน/GP/กำไร/Detail/PassHash แม้แต่ตัวเดียวใน response ฝั่ง Sales', leaks.length === 0, [...new Set(leaks)].slice(0, 20));
ok('ฝั่งภายใน (Sourcing) ยังได้ข้อมูลเต็มตามปกติ (มี Detail / cost)', (() => { const x = get('quotations', T.src).quotations.find(q => q.id === 'QT1'); return x && !!x.detail && x.cost > 0; })());

/* ------------------------------------------------------------------ H) เครื่องมือตรวจบั๊ก %GP เดิม (อ่านอย่างเดียว) */
console.log('== H) auditPricingDrift() ==');
const put = (id, d) => saveQT(T.src, id, 'In Progress', { detail: JSON.stringify(Object.assign({ id, docType: 'QT', docNo: 'QT-' + id, status: 'In Progress', header: { currency: 'THB' } }, d)) });
put('DR1', { _sv: 3, _pm: 2, lines: [{ code: 'A', opPct: 15.254 }, { code: 'B', opPct: 20 }] });     // 18% ที่ถูกแปลงแล้ว
put('DR2', { _sv: 3, lines: [{ code: 'C', opPct: 18 }] });                                           // ยังไม่ถูกแปลง (ปลอดภัยหลังอัปเดต)
put('DR3', { _sv: 3, _pm: 2, lines: [{ code: 'D', opPct: 22.5 }] });                                  // เลขกลม = ตั้งใจ
const snap = JSON.stringify(Q.rows);
const drift = ctx.auditPricingDrift();
const d1 = drift.find(x => x.id === 'DR1');
ok('ตรวจพบใบที่น่าจะถูกลด %GP (15.254% → น่าจะตั้งใจ 18%)', d1 && d1.lines.length === 1 && d1.lines[0].code === 'A' && d1.lines[0].gpLikely === 18, drift);
ok('ไม่ฟ้องผิด: %GP เลขกลม และใบที่ยังไม่ถูกแปลง', !drift.some(x => x.id === 'DR2' || x.id === 'DR3'));
ok('อ่านอย่างเดียว — ชีทไม่เปลี่ยนแม้แต่ช่องเดียว', JSON.stringify(Q.rows) === snap);

console.log(fails ? '\n' + fails + ' FAILED' : '\nALL ROLE SMOKE TESTS PASSED'); process.exit(fails ? 1 : 0);
