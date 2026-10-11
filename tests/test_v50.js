// v5.0/5.1 — คำขอราคาแบบ Food: ส่งถึง Sourcing ตามกลุ่มสินค้า · อนุมัติ 2 ฝ่าย (ก่อนหลังได้) · ขั้นตอน/ผู้ดำเนินการ/ครบกำหนด
// รัน: node tests/test_v50.js $PWD   (ทดสอบบนเครื่องเท่านั้น ห้าม deploy)
const fs = require('fs'), crypto = require('crypto');
const { makeRuntime } = require('./gasmock');
const DIR = process.argv[2] || '.';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 500) : '')); if (!c) fails++; };
const H = s => crypto.createHash('sha256').update(s + 'mgs-internal-2025').digest('hex');

function world(users) {
  const rt = makeRuntime(DIR + '/Code.gs'), { ctx, sheets } = rt;
  const U = sheets['Users'], uh = U.rows[0], c = n => uh.indexOf(n);
  (users || [
    ['src', 'Chatraporn', 'Sourcing', JSON.stringify(['INVERTER', 'BATTERY', 'Energy storage', 'EV Charger', 'Walkway', 'CONNECTOR', 'PV MODULE'])],
    ['src2', 'Napasorn', 'Sourcing', JSON.stringify(['MOUNTING', 'Carport', 'DC CABLE'])],
    ['pm', 'Procure', 'sourcing manager', 'all'], ['bd', 'BD', 'BD Manager', 'all'], ['gm', 'GM', 'GM', 'all'],
    ['boss', 'BOSS', 'Sales', 'all'], ['pair', 'PAIR', 'Sales', 'all'], ['sales_non', 'NON', 'Sales', 'all']
  ]).forEach(([id, n, r, sc, act]) => { const x = []; x[c('Id')] = id; x[c('Name')] = n; x[c('Role')] = r; x[c('Scope')] = sc; x[c('PassHash')] = H('pw123456'); x[c('Email')] = id + '@m.co'; if (act === false) x[c('Active')] = 'FALSE'; U.rows.push(x); });
  const post = p => JSON.parse(ctx.apiPost(JSON.stringify(p)));
  const get = (t, tok, a) => JSON.parse(ctx.apiGet(t, tok, a || ''));
  const tok = u => post({ action: 'login', user: u, passHash: H('pw123456') }).token;
  const T = {}; ['src', 'src2', 'pm', 'bd', 'gm', 'boss', 'pair', 'sales_non'].forEach(u => { try { T[u] = tok(u); } catch (e) {} });
  const QS = sheets['Quotations'], qh = QS.rows[0];
  const det = id => JSON.parse(QS.rows.find(x => x[qh.indexOf('Id')] === id)[qh.indexOf('Detail')]);
  const sr = (id, groupType, lines, status, tk) => post({ token: T[tk || 'boss'], action: 'saveSR', id, status: status || 'Submitted',
    detail: JSON.stringify({ status: status || 'Submitted', header: { title: 'Req ' + id, customer: 'CP', groupType }, lines: lines || [{ desc: 'x', qty: 1 }] }) });
  const qt = (id, status, extra) => post(Object.assign({ token: T.src, action: 'save', id, docType: 'QT', docNo: 'QT-' + id, title: 'T ' + id, customer: 'CP', sales: 'BOSS',
    salesUserId: 'boss', assignedTo: 'src', status, currency: 'THB', total: 1000, cost: 800, profit: 200, gp: 20, round: 1,
    detail: JSON.stringify({ id, docType: 'QT', status, approvalRoles: [], header: { currency: 'THB' }, lines: [{ up: 1, qty: 1 }] }),
    salesDetail: JSON.stringify({ id, status, total: 1000, lines: [{ unitPrice: 1000 }] }) }, extra || {}));
  return Object.assign(rt, { post, get, T, det, sr, qt });
}

/* ------------------------------------------------------------------ 1) role / ชื่อที่แสดง */
console.log('== 1) Sourcing Manager = Procurement Mgr ==');
let W = world();
ok('"sourcing manager" ในแท็บ Users → role มาตรฐาน Procurement Mgr (สิทธิ์ผู้จัดการครบ)', W.ctx.normRole_('Sourcing Manager') === 'Procurement Mgr' && W.ctx.normRole_('sourcing mgr') === 'Procurement Mgr' && W.ctx.capsOf_('Sourcing Manager').approve);
const me = W.post({ token: W.T.pm, action: 'whoami' }).user;
ok('ข้อมูลผู้ใช้ส่งชื่อที่แสดง roleLabel = Sourcing Manager (role ในชีทไม่เปลี่ยน)', me.role === 'Procurement Mgr' && me.roleLabel === 'Sourcing Manager', me);

/* ------------------------------------------------------------------ 2) routing */
console.log('== 2) คำขอราคาวิ่งถึง Sourcing ตามกลุ่มสินค้า ==');
const route = (id) => { const d = W.det(id); return [d.routedTo, d.routedWhy]; };
W.sr('R1', 'Mounting'); W.sr('R2', 'Inverter'); W.sr('R3', 'DC Cable'); W.sr('R4', 'ESS'); W.sr('R5', 'EV Charger'); W.sr('R6', 'Residential');
ok('Mounting → Napasorn · DC Cable → Napasorn (Scope MOUNTING / DC CABLE)', route('R1').join() === 'src2,scope' && route('R3').join() === 'src2,scope', [route('R1'), route('R3')]);
ok('Inverter / ESS / EV Charger / Residential → Chatraporn', ['R2', 'R4', 'R5', 'R6'].every(id => route(id).join() === 'src,scope'), ['R2', 'R4', 'R5', 'R6'].map(route));
ok('คำตอบของ saveSR บอกผู้รับ (แสดงให้ Sales เห็นทันที)', (r => r.routedTo === 'src2' && r.routedName === 'Napasorn')(W.sr('R7', 'Mounting')));
const pure = W.ctx.routeFor_;
const people = { list: [{ id: 'a', name: 'A', role: 'Sourcing', active: true, scope: 'all' }, { id: 'b', name: 'B', role: 'Sourcing', active: true, scope: 'all' }], byId: {}, routing: {} };
ok('Scope "ทุกกลุ่ม" 2 คนเท่ากัน → ส่งถึงทีม Sourcing (ไม่เดา)', pure('Inverter', [], people).why === 'pool');
people.list[1].scope = ['INVERTER'];
ok('คนที่ดูแลกลุ่มนั้นโดยตรงชนะคนที่ดูแลทุกกลุ่ม', pure('Inverter', [], people).id === 'b');
people.list[1].active = false;
ok('ผู้ใช้ที่ปิดบัญชี (Active = FALSE) ไม่ถูกเลือก', pure('Inverter', [], people).id === 'a');
ok('สินค้าในรายการช่วยตัดสิน (กลุ่มของรายการ +3)', pure('Mounting', ['PV MODULE', 'PV MODULE'], { list: [{ id: 'x', name: 'X', role: 'Sourcing', active: true, scope: ['PV MODULE'] }, { id: 'y', name: 'Y', role: 'Sourcing', active: true, scope: ['WALKWAY'] }], byId: {}, routing: {} }).id === 'x');
// override จาก Settings
const sv = W.post({ token: W.T.pm, action: 'saveSettings', settingsRev: 2, detail: JSON.stringify({ srRouting: { Inverter: 'src2', Mounting: 'boss' } }) });
W.sr('R8', 'Inverter'); W.sr('R9', 'Mounting');
ok('ตั้งผู้รับตามกลุ่มงานใน Settings.srRouting → ใช้ก่อน Scope', sv.ok && route('R8').join() === 'src2,setting', route('R8'));
ok('ตั้งผู้รับเป็น Sales (ผิด) → ไม่ใช้ กลับไปใช้ Scope', route('R9').join() === 'src2,scope', route('R9'));
const sset = W.get('settings', W.T.boss);
ok('Sales ไม่ได้รับค่า srRouting ใน settings (ข้อมูลภายใน)', sset.ok && sset.srRouting === undefined);
W.post({ token: W.T.pm, action: 'saveSettings', settingsRev: 3, detail: JSON.stringify({}) });
// Sales ปลอมผู้รับไม่ได้ / ร่างไม่ส่งถึงใคร / แก้คำขอคงผู้รับเดิม / เปลี่ยนกลุ่มคำนวณใหม่
W.post({ token: W.T.boss, action: 'saveSR', id: 'R10', status: 'Submitted', detail: JSON.stringify({ status: 'Submitted', routedTo: 'pm', routedManual: true, routedWhy: 'manual', header: { groupType: 'Mounting' }, lines: [] }) });
ok('Sales ส่ง routedTo / routedManual มาเอง → ไม่มีผล (server ตัดสิน)', route('R10').join() === 'src2,scope', route('R10'));
W.sr('R11', 'Mounting', null, 'Draft');
ok('ร่างคำขอ (Draft) → ยังไม่ส่งถึงใคร', !W.det('R11').routedTo && !W.det('R11').routedWhy);
W.sr('R11', 'Mounting'); const at1 = W.det('R11').routedAt;
W.sr('R11', 'Mounting', [{ desc: 'y', qty: 2 }]);
ok('Sales แก้คำขอ (กลุ่มเดิม) → ผู้รับเดิม เวลาเดิม', route('R11').join() === 'src2,scope' && W.det('R11').routedAt === at1);
W.sr('R11', 'Inverter');
ok('Sales เปลี่ยนกลุ่มงาน → ส่งถึงคนใหม่', route('R11').join() === 'src,scope');
// ส่งต่อโดยทีมภายใน (Index) — ต้องเป็นผู้ใช้ภายในที่ Active
const d12 = (W.sr('R12', 'Inverter'), W.det('R12'));
let r = W.post({ token: W.T.src, action: 'save', id: 'R12', docType: 'SR', docNo: d12.docNo, status: 'Submitted', salesUserId: 'boss', detail: JSON.stringify(Object.assign({}, d12, { routedTo: 'src2', routedManual: true })) });
ok('ทีมภายในส่งต่อคำขอ → routedWhy manual + ชื่อผู้ส่งต่อ', r.ok && route('R12').join() === 'src2,manual' && W.det('R12').routedBy === 'Chatraporn', W.det('R12'));
r = W.post({ token: W.T.src, action: 'save', id: 'R12', docType: 'SR', docNo: d12.docNo, status: 'Submitted', salesUserId: 'boss', detail: JSON.stringify(Object.assign({}, d12, { routedTo: 'boss', routedManual: true })) });
ok('ส่งต่อให้ Sales (ผิด) → ไม่เปลี่ยน คงผู้รับเดิม', route('R12').join() === 'src2,manual', route('R12'));
r = W.post({ token: W.T.src, action: 'save', id: 'R12', docType: 'SR', docNo: d12.docNo, status: 'Accepted', assignedTo: 'src', salesUserId: 'boss', detail: JSON.stringify(Object.assign({}, d12, { status: 'Accepted', assignedTo: 'src', routedTo: undefined })) });
ok('รับงาน (client ไม่ส่ง routed* มา) → ผู้รับเดิมยังอยู่ในเอกสาร', route('R12').join() === 'src2,manual');
ok('SR ยังเป็น SR (คนละเอกสารกับ QT) และไม่มีราคาใน Detail', W.det('R12').docType === 'SR' && !/"up":[1-9]|unitPrice/.test(JSON.stringify(W.det('R12'))));

/* ------------------------------------------------------------------ 3) projection: ทุกคนเห็นว่าอยู่ที่ใคร (ไม่มีราคา) */
console.log('== 3) ทุก role เห็นสถานะ / ผู้ดำเนินการ ==');
const svBoss = W.get('salesview', W.T.boss).quotations, rowR1 = svBoss.find(x => x.id === 'R1');
ok('Sales เห็นว่าคำขอส่งถึงใคร (routedName) + ขั้นที่ 1 Sourcing ทำราคา + ชื่อผู้ดำเนินการ', rowR1 && rowR1.routedName === 'Napasorn' && rowR1.follow.step === 1 && rowR1.follow.actor.label === 'Napasorn', rowR1 && rowR1.follow);
ok('…ไม่มีอีเมลผู้ดำเนินการหลุดไปฝั่ง Sales', !/@m\.co/.test(JSON.stringify(svBoss.map(x => x.follow))));
ok('ครบกำหนด (due) เป็นวันที่ yyyy-MM-dd', /^\d{4}-\d{2}-\d{2}$/.test(rowR1.follow.due), rowR1.follow);
const iq = W.get('quotations', W.T.src).quotations.find(x => x.id === 'R1');
ok('ระบบทำราคาเห็น routedTo / routedWhy ของ SR', iq.routedTo === 'src2' && iq.routedWhy === 'scope');

/* ------------------------------------------------------------------ 4) อนุมัติ 2 ฝ่าย (v5.1: กดก่อนหลังได้) */
// v5.1 (ตั้งใจ — ผู้ใช้แจ้ง "BD กดก่อน Sourcing Manager ได้"): เดิม v5.0 บังคับลำดับ (WAIT_PREVIOUS_LEVEL) → เปลี่ยนเป็นกดก่อนหลังได้ ต้องครบทั้งคู่
console.log('== 4) อนุมัติ 2 ฝ่าย: Sourcing Manager + BD Manager (ก่อนหลังได้) · GM แทนได้ทุกฝ่าย ==');
W.qt('A1', 'Submitted');
let f = W.get('quotations', W.T.pm).quotations.find(x => x.id === 'A1').follow;
ok('ส่งขออนุมัติ → ขั้นที่ 2 รอทั้ง 2 ฝ่าย (0/2) · ผู้ดำเนินการ = Sourcing Manager / BD Manager', f.step === 2 && f.label === 'รอ Sourcing Manager + BD Manager อนุมัติ (0/2)' &&
  f.actor.kind === 'roles' && f.actor.roles.join() === 'Procurement Mgr,BD Mgr' && /Sourcing Manager · Procure/.test(f.actor.label) && /BD Manager · BD/.test(f.actor.label), f);
r = W.post({ token: W.T.bd, action: 'approve', id: 'A1' });
ok('BD Manager กดก่อนได้ → Partial Approved · ยังรอ Sourcing Manager', r.ok && r.status === 'Partial Approved' && r.missing.join() === 'Procurement Mgr' && r.missingLabel === 'Sourcing Manager' && r.follow.step === 3, r);
ok('…ป้าย "รอ Sourcing Manager อนุมัติ (1/2)" · approvedRoles = BD', r.follow.label === 'รอ Sourcing Manager อนุมัติ (1/2)' && r.follow.approvedRoles.join() === 'BD Mgr' && r.follow.actor.roles.join() === 'Procurement Mgr', r.follow);
ok('BD กดซ้ำ → ALREADY_APPROVED', W.post({ token: W.T.bd, action: 'approve', id: 'A1' }).error === 'ALREADY_APPROVED');
f = W.get('salesview', W.T.boss).quotations.find(x => x.id === 'A1').follow;
ok('Sales เห็นว่ารอ Sourcing Manager อยู่ แต่ไม่เห็นราคา', f.label === 'รอ Sourcing Manager อนุมัติ (1/2)' && !W.get('salesview', W.T.boss).quotations.find(x => x.id === 'A1').salesDetail, f);
r = W.post({ token: W.T.pm, action: 'approve', id: 'A1' });
ok('Sourcing Manager อนุมัติทีหลัง → Approved · ขั้นที่ 4 รอปล่อยราคา (NON)', r.ok && r.status === 'Approved' && r.complete && r.follow.step === 4 && r.follow.actor.kind === 'releaser' && /NON/.test(r.follow.actor.label), r.follow);
let ap = W.det('A1').approvals;
ok('ประวัติอนุมัติ: ตามลำดับที่กดจริง (BD ก่อน แล้ว Sourcing Manager) พร้อมผู้กด', ap.map(a => a.role).join() === 'BD Mgr,Procurement Mgr' && ap.every(a => a.by && a.at), ap);
W.qt('A1b', 'Submitted'); W.post({ token: W.T.pm, action: 'approve', id: 'A1b' }); r = W.post({ token: W.T.bd, action: 'approve', id: 'A1b' });
ok('ลำดับปกติ (Sourcing Manager ก่อน) ก็ได้ผลเดียวกัน', r.ok && r.status === 'Approved' && W.det('A1b').approvalRoles.join() === 'Procurement Mgr,BD Mgr');
// GM
W.qt('A2', 'Submitted');
r = W.post({ token: W.T.gm, action: 'approve', id: 'A2' });
ok('GM อนุมัติแทน (ปกติ) = 1 ฝ่ายที่ยังขาด (Sourcing Manager) → Partial Approved · บันทึกว่าอนุมัติแทน', r.ok && r.status === 'Partial Approved' && r.approvedLevels.join() === 'Procurement Mgr' &&
  (a => a.role === 'GM' && a.onBehalfOf === 'Procurement Mgr' && /อนุมัติแทน Sourcing Manager/.test(a.act))(W.det('A2').approvals[0]), W.det('A2').approvals);
r = W.post({ token: W.T.gm, action: 'approve', id: 'A2' });
ok('GM กดอีกครั้ง → แทน BD Manager → Approved', r.ok && r.status === 'Approved' && W.det('A2').approvals[1].onBehalfOf === 'BD Mgr');
W.qt('A3', 'Submitted');
r = W.post({ token: W.T.gm, action: 'approve', id: 'A3', all: true });
ok('GM "อนุมัติแทนทั้ง 2 ฝ่าย" (all) → Approved ในครั้งเดียว · ประวัติแยก 2 บรรทัด', r.ok && r.status === 'Approved' && W.det('A3').approvals.length === 2 && W.det('A3').approvals.every(a => a.role === 'GM' && a.onBehalfOf));
ok('Log บันทึกว่า GM อนุมัติแทน', (W.det('A3').auditLogs || []).some(a => /GM อนุมัติแทน Sourcing Manager \+ BD Manager/.test(a.action)), W.det('A3').auditLogs);
W.qt('A4', 'Submitted'); W.post({ token: W.T.bd, action: 'approve', id: 'A4' });
r = W.post({ token: W.T.gm, action: 'approve', id: 'A4' });
ok('BD ผ่านแล้ว GM กดแทน → แทนฝ่ายที่ยังขาด (Sourcing Manager) → Approved', r.ok && r.status === 'Approved' && W.det('A4').approvals[1].onBehalfOf === 'Procurement Mgr');
// ข้อมูลเก่า
W.qt('A5', 'Partial Approved', { detail: JSON.stringify({ id: 'A5', docType: 'QT', status: 'Partial Approved', approvalRoles: ['BD Mgr'], header: {}, lines: [] }) });
f = W.get('quotations', W.T.pm).quotations.find(x => x.id === 'A5').follow;
ok('ข้อมูลเก่า (v4.x BD อนุมัติก่อน) → รอ Sourcing Manager (1/2) · ขั้นที่ 3', f.label === 'รอ Sourcing Manager อนุมัติ (1/2)' && f.step === 3, f);
ok('…BD กดซ้ำไม่ได้ (ALREADY_APPROVED)', W.post({ token: W.T.bd, action: 'approve', id: 'A5' }).error === 'ALREADY_APPROVED');
r = W.post({ token: W.T.pm, action: 'approve', id: 'A5' });
ok('…Sourcing Manager อนุมัติ → ครบ → Approved', r.ok && r.status === 'Approved', r);
W.qt('A6', 'Approved', { detail: JSON.stringify({ id: 'A6', docType: 'QT', status: 'Approved', approvalRoles: ['GM'], header: {}, lines: [] }) });
ok('ข้อมูลเก่า approvalRoles = ["GM"] (GM แทนทั้ง 2 ขาแบบเดิม) ยังนับว่าครบ', W.ctx.approvalStep_(['GM']).complete === true);
ok('Sourcing / Sales อนุมัติไม่ได้', W.post({ token: W.T.src, action: 'approve', id: 'A6' }).error === 'ACCESS_DENIED' && W.post({ token: W.T.boss, action: 'approve', id: 'A6' }).error === 'ACCESS_DENIED');

/* ------------------------------------------------------------------ 5) ขั้นตอนครบวงจร (step) */
console.log('== 5) ขั้นตอน 0–5 ==');
const F = (o) => W.ctx.followState_(Object.assign({ docType: 'QT', owner: 'boss', releasedTo: [], hasSalesCopy: true, updatedMs: Date.now(), statusLog: [], statusChangedAt: '', salesUpdatedAt: '', followUpDate: '', approvalRoles: [], quoteIds: [], assignedTo: '', routedTo: '' }, o), W.ctx.followCfg_(), Date.now());
const steps = [
  [{ docType: 'SR', status: 'Draft' }, 0], [{ docType: 'SR', status: 'Submitted', routedTo: 'src2' }, 1], [{ docType: 'SR', status: 'Accepted', assignedTo: 'src' }, 1],
  [{ docType: 'SR', status: 'Quoted', quoteIds: ['q'] }, 2], [{ docType: 'SR', status: 'Cancelled' }, -1],
  [{ status: 'In Progress', assignedTo: 'src' }, 1], [{ status: 'Submitted' }, 2], [{ status: 'Partial Approved', approvalRoles: ['Procurement Mgr'] }, 3], [{ status: 'Partial Approved', approvalRoles: ['BD Mgr'] }, 3],
  [{ status: 'Approved' }, 4], [{ status: 'Pending', releasedTo: ['boss'] }, 5], [{ status: 'Won', releasedTo: ['boss'] }, 5]
];
ok('ทุกสถานะ → ขั้นตอนที่ถูกต้อง (0 ส่งคำขอ … 5 ได้ราคาแล้ว)', steps.every(([o, s]) => F(o).step === s), steps.map(([o]) => o.status + ':' + F(o).step));
ok('ผู้ดำเนินการ: SR ส่งแล้ว = ผู้รับคำขอ · รับงานแล้ว = คนที่รับ · ไม่มีผู้รับ = ทีม Sourcing', F({ docType: 'SR', status: 'Submitted', routedTo: 'src2' }).actor.ids[0] === 'src2' &&
  F({ docType: 'SR', status: 'Accepted', assignedTo: 'src', routedTo: 'src2' }).actor.ids[0] === 'src' && F({ docType: 'SR', status: 'Submitted' }).actor.kind === 'pool');
ok('FLOW_STEPS 6 ขั้น (stepper ทุกหน้าจอใช้ชุดเดียวกัน)', W.ctx.FLOW_STEPS.join('|') === 'ส่งคำขอ|Sourcing ทำราคา|Sourcing Manager|BD Manager|ปล่อยราคา|ได้ราคาแล้ว');
ok('flowDots_: ช่วงอนุมัติแสดงรายฝ่าย (BD ผ่าน → จุด BD เขียว · จุด Sourcing Manager ยังรอ) · ปล่อยแล้ว = เขียวหมด',
  W.ctx.flowDots_(3, ['BD Mgr']).join() === 'done,done,now,done,todo' && W.ctx.flowDots_(2, []).join() === 'done,done,now,now,todo' &&
  W.ctx.flowDots_(4, []).join() === 'done,done,done,done,now' && W.ctx.flowDots_(5, []).every(x => x === 'done') && W.ctx.flowDots_(-1).length === 0);
ok('addBizDays_: ศุกร์ + 1 วันทำการ = จันทร์', W.ctx.addBizDays_(Date.parse('2026-10-09T03:00:00Z'), 1) === '2026-10-12');

/* ------------------------------------------------------------------ 6) ไม่แตะโครงสร้างเดิม */
console.log('== 6) ความเข้ากันได้ ==');
ok('header ของทุกแท็บเดิมไม่เปลี่ยน (ไม่มีคอลัมน์ใหม่ใน v5.0)', JSON.stringify(W.ctx.HEADERS.Quotations) === JSON.stringify(['Id','DocType','DocNo','Ref','Title','Customer','Sales','SalesUserId','AssignedTo','Group','Round','Currency','Incoterm','PriceTerm','Exrate','OfferDate','Stage','Status','FollowStatus','NeedsApproval','ReleasedTo','SalesNote','Lines','Total','Cost','Profit','GP','Updated','UpdatedAt','By','Deleted','DeletedAt','DeletedBy','Detail','SalesDetail']) &&
  JSON.stringify(W.ctx.HEADERS.Users) === JSON.stringify(['Id','Name','Role','Scope','PassHash','Updated','Email','Active']) && Object.keys(W.ctx.HEADERS).length === 8);
ok('APP_VERSION ตรงกันทั้ง 3 ไฟล์', ['Index.html', 'Sales.html'].every(fn => fs.readFileSync(DIR + '/' + fn, 'utf8').includes("APP_VERSION='" + W.ctx.APP_VERSION + "'")), W.ctx.APP_VERSION);
ok('ผู้ปล่อยราคา (gatekeeperId_) ยังทำงานเหมือนเดิมหลัง refactor', W.ctx.gatekeeperId_() === 'sales_non');

console.log(fails ? '\n' + fails + ' FAILED' : '\nALL v5.0 TESTS PASSED'); process.exit(fails ? 1 : 0);
