// v5.9 — ออดิตชุด 1 (ปิดรูด่วน): server ตัดสินสถานะ / การอนุมัติ / การปล่อยราคา / การลบ · SR ที่มี QT อ่านอย่างเดียว · กันฝังโค้ด
// รัน: node tests/test_v59.js $PWD   (ทดสอบบนเครื่องเท่านั้น ห้าม deploy)
const crypto = require('crypto');
const { makeRuntime } = require('./gasmock');
const { seedSave } = require('./seed');
const DIR = process.argv[2] || '.';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 400) : '')); if (!c) fails++; };
const H = s => crypto.createHash('sha256').update(s + 'mgs-internal-2025').digest('hex');

function world() {
  const rt = makeRuntime(DIR + '/Code.gs'), { ctx, sheets } = rt;
  const U = sheets['Users'], uh = U.rows[0], c = n => uh.indexOf(n);
  [['boss', 'BOSS', 'Sales'], ['pair', 'PAIR', 'Sales'], ['sales_non', 'NON', 'Sales'], ['smgr', 'SalesMgr', 'Sales Manager'],
   ['src', 'Chatraporn', 'Sourcing'], ['src2', 'Napasorn', 'Sourcing'], ['pm', 'Procure', 'Procurement Mgr'], ['bd', 'BD', 'BD Mgr'], ['gm', 'GM', 'GM'], ['adm', 'Admin', 'Admin']]
    .forEach(([id, n, r]) => { const x = []; x[c('Id')] = id; x[c('Name')] = n; x[c('Role')] = r; x[c('Scope')] = 'all'; x[c('PassHash')] = H('pw123456'); x[c('Email')] = id + '@m.co'; U.rows.push(x); });
  const post = p => JSON.parse(ctx.apiPost(JSON.stringify(p)));
  const get = (t, tok, a) => JSON.parse(ctx.apiGet(t, tok, a || ''));
  const T = {}; ['boss', 'pair', 'sales_non', 'smgr', 'src', 'src2', 'pm', 'bd', 'gm', 'adm'].forEach(u => { T[u] = post({ action: 'login', user: u, passHash: H('pw123456') }).token; });
  const QS = sheets['Quotations'], qh = () => QS.rows[0];
  const rowOf = id => QS.rows.find(x => x[qh().indexOf('Id')] === id);
  const col = (id, h) => { const r = rowOf(id); return r ? r[qh().indexOf(h)] : undefined; };
  const det = id => JSON.parse(col(id, 'Detail') || '{}');
  const doc = (id, status, extra) => Object.assign({ id, _v: 2, _pm: 2, _sv: 3, docType: 'QT', docNo: 'QT-' + id, status, round: 1, approvalRoles: [], approvals: [], releasedTo: [],
    header: { ref: 'QT-' + id, title: 'Proj ' + id, customer: 'CP', salesUserId: 'boss', sales: 'BOSS', currency: 'THB', groupType: 'Inverter', rates: { USD: 36, CNY: 5 }, offerDate: '2026-10-14' },
    lines: [{ code: 'SG110CX', desc: 'Inverter', qty: 2, uom: 'pcs', up: 1000, costCur: 'USD', opPct: 20 }], remarks: [], auditLogs: [] }, extra || {});
  const save = (tok, id, status, extra, dextra) => post(Object.assign({ token: T[tok], action: 'save', id, docType: 'QT', docNo: 'QT-' + id, title: 'Proj ' + id, customer: 'CP',
    sales: 'BOSS', salesUserId: 'boss', status, total: 45000, cost: 36000, profit: 9000, gp: 20, detail: JSON.stringify(doc(id, status, dextra)),
    salesDetail: JSON.stringify({ id, status, lines: [{ code: 'SG110CX', qty: 2, unitPrice: 22500, amount: 45000 }], total: 45000 }) }, extra || {}));
  const seed = (id, status, dextra, extra) => seedSave(sheets, Object.assign({ id, docType: 'QT', docNo: 'QT-' + id, status, salesUserId: 'boss', sales: 'BOSS', title: 'Proj ' + id, customer: 'CP',
    releasedTo: ['Pending', 'Won', 'Closed'].includes(status) ? 'boss' : '', detail: JSON.stringify(doc(id, status, Object.assign({ approvalRoles: ['Procurement Mgr', 'BD Mgr'],
      releasedTo: ['Pending', 'Won', 'Closed'].includes(status) ? ['boss'] : [], auditLogs: [{ timestamp: '2026-10-01T00:00:00.000Z', user: 'Chatraporn', action: 'Created' }] }, dextra || {}))),
    salesDetail: JSON.stringify({ id, status, header: { salesUserId: 'boss', sales: 'BOSS' }, lines: [{ code: 'SG110CX', qty: 2, unitPrice: 22500, amount: 45000 }], total: 45000 }) }, extra || {}));
  const sv = (u, id) => (get('salesview', T[u]).quotations || []).find(q => q.id === id);
  return Object.assign(rt, { post, get, T, rowOf, col, det, doc, save, seed, sv });
}

console.log('== 1) C-1: save ตั้งสถานะอนุมัติ / ปล่อยราคาเองไม่ได้ ==');
{
  const W = world();
  let r = W.save('src', 'N1', 'Approved');
  ok('ใบใหม่ status=Approved → STATUS_LOCKED (need approve) · ไม่มีแถวเกิดขึ้น', r.error === 'STATUS_LOCKED' && r.need === 'approve' && !W.rowOf('N1'), r);
  r = W.save('src', 'N2', 'Pending', { releasedTo: 'boss' });
  ok('ใบใหม่ status=Pending + releasedTo → STATUS_LOCKED (need release) · Sales ไม่เห็นอะไร', r.error === 'STATUS_LOCKED' && r.need === 'release' && !W.sv('boss', 'N2'), r);
  ok('Partial Approved ผ่าน save ก็ไม่ได้', W.save('src', 'N3', 'Partial Approved').error === 'STATUS_LOCKED');
  r = W.save('src', 'N4', 'In Progress', { releasedTo: 'boss' }, { approvalRoles: ['Procurement Mgr', 'BD Mgr'], approvals: [{ by: 'ปลอม', levelRole: 'BD Mgr' }], releasedTo: ['boss'] });
  ok('ใบ In Progress ที่ client แนบ approvalRoles / approvals / releasedTo มา → server ทิ้งทั้งหมด', r.ok && W.col('N4', 'ReleasedTo') === '' && W.det('N4').approvalRoles.length === 0 &&
    W.det('N4').approvals.length === 0 && W.det('N4').releasedTo.length === 0, W.det('N4'));
  ok('…และตอบ serverFixed + detail ฉบับในชีท ให้ client แทนที่ของในเครื่อง', r.serverFixed === true && JSON.parse(r.detail).approvalRoles.length === 0);
  W.save('src', 'P1', 'Submitted'); W.post({ token: W.T.pm, action: 'approve', id: 'P1' });
  r = W.save('src', 'P1', 'Partial Approved', {}, { approvalRoles: [], approvals: [] });
  ok('บันทึกใบที่อนุมัติไปแล้ว 1 ฝ่าย → การอนุมัติไม่หาย (เดิมล้างได้)', r.ok && W.det('P1').approvalRoles.join() === 'Procurement Mgr' && W.det('P1').approvals.some(a => a.levelRole === 'Procurement Mgr'), W.det('P1').approvals);
  r = W.save('src', 'P1', 'Submitted');
  ok('ส่งกลับไปส่งตรวจใหม่ (Partial → Submitted) = server ล้างการอนุมัติเอง · บันทึก "ส่งตรวจ"', r.ok && W.det('P1').approvalRoles.length === 0 && W.det('P1').approvals.slice(-1)[0].act === 'ส่งตรวจ');
  r = W.save('src', 'P1', 'Submitted', {}, { auditLogs: [{ timestamp: '2020-01-01', user: 'ปลอม', action: 'แก้ประวัติ' }] });
  const al = W.det('P1').auditLogs;
  ok('ประวัติในใบต่อท้ายได้อย่างเดียว: รายการย้อนหลังที่ปลอมมาไม่ถูกรับ · ของเดิม (การอนุมัติ) ไม่หาย', !al.some(a => a.user === 'ปลอม') && al.some(a => /Approved Sourcing Manager/.test(a.action)), al);
}

console.log('== 2) ใบที่อนุมัติแล้ว: ตรึงราคา ==');
{
  const W = world();
  W.seed('A1', 'Approved');
  let r = W.save('src', 'A1', 'Approved', {}, { lines: [{ code: 'SG110CX', qty: 2, up: 1, opPct: 90 }], header: { salesUserId: 'pair', sales: 'PAIR', title: 'แก้ชื่อ' } });
  ok('save ใบ Approved สถานะเดิม = mode frozen · ราคา/รายการคงตามชีท', r.ok && r.mode === 'frozen' && W.det('A1').lines[0].up === 1000 && W.det('A1').lines[0].opPct === 20, W.det('A1').lines);
  ok('…ผูกเจ้าของงานใหม่ได้ (header.salesUserId) · ชื่อโครงการไม่ถูกแก้', W.det('A1').header.salesUserId === 'pair' && W.col('A1', 'SalesUserId') === 'pair' && W.det('A1').header.title === 'Proj A1');
  ok('…approvalRoles ยังครบ', W.det('A1').approvalRoles.join() === 'Procurement Mgr,BD Mgr');
  r = W.save('src', 'A1', 'In Progress');
  ok('Approved → In Progress (ส่งกลับไปแก้) ได้ · การอนุมัติถูกล้าง', r.ok && W.det('A1').approvalRoles.length === 0 && W.col('A1', 'Status') === 'In Progress');
  ok('Approved → Won ข้ามการปล่อยราคา → STATUS_LOCKED', (W.seed('A2', 'Approved'), W.save('src', 'A2', 'Won')).error === 'STATUS_LOCKED');
  W.seed('PD', 'Pending');
  ok('Pending → In Progress (แก้ราคาหลังปล่อย) → STATUS_LOCKED', W.save('src', 'PD', 'In Progress').error === 'STATUS_LOCKED');
  r = W.save('src', 'PD', 'Won', {}, { lines: [{ code: 'X', qty: 1, up: 1 }] });
  ok('Pending → Won ได้ (Sourcing ปิดการขาย) · รายการไม่ถูกแก้ · ReleasedTo คงเดิม', r.ok && W.col('PD', 'Status') === 'Won' && W.det('PD').lines[0].code === 'SG110CX' && W.col('PD', 'ReleasedTo') === 'boss', W.det('PD'));
  ok('…SalesDetail อัปเดตแค่สถานะ (ราคาเดิม)', JSON.parse(W.col('PD', 'SalesDetail')).status === 'Won' && JSON.parse(W.col('PD', 'SalesDetail')).total === 45000);
  ok('…Sales ยังเห็นราคาเหมือนเดิม', /22500/.test((W.sv('boss', 'PD') || {}).salesDetail || ''));
  ok('Closed → Pending / Won → STATUS_LOCKED', (W.seed('CL', 'Closed'), W.save('src', 'CL', 'Pending')).error === 'STATUS_LOCKED' && W.save('src', 'CL', 'Won').error === 'STATUS_LOCKED');
  ok('In Progress → Closed (ปิดงานกลางทาง) ได้', (W.save('src', 'IP', 'In Progress'), W.save('src', 'IP', 'Closed')).ok);
  // ใบรุ่นเก่าที่คอลัมน์ Status เป็นชื่อเก่า (หน้าเว็บแปลง Sent → Pending / Costing → In Progress ก่อนส่ง)
  W.seed('LG1', 'Sent', { status: 'Sent' }); W.seed('LG2', 'Costing', { status: 'Costing', approvalRoles: [] });
  ok('ใบรุ่นเก่า Status = Sent → บันทึกเป็น Pending ได้ (ถือเป็นใบปล่อยราคาแล้ว → ตรึงราคา) · ปิดเป็น Won ได้', W.save('src', 'LG1', 'Pending').mode === 'frozen' && W.save('src', 'LG1', 'Won').ok);
  ok('ใบรุ่นเก่า Status = Costing → บันทึกเป็น In Progress / ส่งอนุมัติได้ตามปกติ', W.save('src', 'LG2', 'In Progress').mode === 'full' && W.save('src', 'LG2', 'Submitted').ok);
  ok('ใบรุ่นเก่า Status = Sent → ย้อนเป็น In Progress ไม่ได้ (เหมือน Pending)', (W.seed('LG3', 'Sent', { status: 'Sent' }), W.save('src', 'LG3', 'In Progress')).error === 'STATUS_LOCKED');
  // ยกเลิกคำขอลบค้างบนใบที่อนุมัติแล้ว
  W.seed('DR', 'Approved', { deleteRequest: { by: 'Chatraporn', at: '2026-10-01' } });
  ok('(ตั้งต้น) ใบ Approved มีคำขอลบค้าง', !!W.det('DR').deleteRequest);
  ok('ใบ Approved ที่มีคำขอลบค้าง → ผู้บริหารกด "ยกเลิกคำขอลบ" (หน้าเว็บลบ key ทิ้ง) → ถูกล้างในชีท', W.save('pm', 'DR', 'Approved').ok && !W.det('DR').deleteRequest, W.det('DR').deleteRequest);
  // ใบรุ่นเก่าที่ยังไม่มี SalesDetail (REPAIR) → รับฉบับ Sales จาก client ได้ (ปุ่มซ่อมข้อมูล)
  W.seed('RP', 'Pending', {}, { salesDetail: '' });
  r = W.save('src', 'RP', 'Pending');
  ok('ใบ Pending รุ่นเก่าที่ไม่มีฉบับ Sales → บันทึกฉบับ Sales ได้ (ซ่อมข้อมูล)', r.ok && /22500/.test(W.col('RP', 'SalesDetail')), W.col('RP', 'SalesDetail'));
}

console.log('== 3) SR = หลักฐานคำขอลูกค้า ==');
{
  const W = world();
  W.post({ token: W.T.boss, action: 'saveSR', id: 'SR1', status: 'Submitted', detail: JSON.stringify({ header: { title: 'คำขอจริง', customer: 'CP', groupType: 'Inverter' }, lines: [{ desc: 'Inverter 110kW', qty: 3 }] }) });
  const sr = W.det('SR1');
  let r = W.post({ token: W.T.src, action: 'save', id: 'SR1', docType: 'SR', status: 'Quoted', assignedTo: 'src', salesUserId: 'boss',
    detail: JSON.stringify(Object.assign({}, sr, { status: 'Quoted', assignedTo: 'src', quoteIds: ['QT1'] })) });
  ok('ผูก QT ครั้งแรก (Accepted → Quoted) ได้', r.ok && W.det('SR1').quoteIds.join() === 'QT1');
  r = W.post({ token: W.T.src2, action: 'save', id: 'SR1', docType: 'SR', status: 'Quoted', salesUserId: 'boss',
    detail: JSON.stringify(Object.assign({}, sr, { status: 'Quoted', quoteIds: ['QT2'], header: Object.assign({}, sr.header, { customer: 'ลูกค้าปลอม' }), lines: [{ desc: 'แก้แล้ว', qty: 99 }] })) });
  ok('ฝ่ายในบันทึกทับ SR ที่มี QT → mode srLinked · ลูกค้า/รายการคงเดิม · QT ผูกสะสม (QT1 + QT2)', r.ok && r.mode === 'srLinked' && W.det('SR1').header.customer === 'CP' &&
    W.det('SR1').lines[0].desc === 'Inverter 110kW' && W.det('SR1').quoteIds.join() === 'QT1,QT2', W.det('SR1'));
  ok('SR ที่มี QT ย้อนสถานะเป็น Accepted / Submitted → SR_LOCKED', W.post({ token: W.T.src, action: 'save', id: 'SR1', docType: 'SR', status: 'Submitted', detail: JSON.stringify(sr) }).error === 'SR_LOCKED');
  ok('ฝ่ายในใช้ saveSR บน SR ที่มี QT → SR_LOCKED (เดิมกันเฉพาะ Sales)', W.post({ token: W.T.src, action: 'saveSR', id: 'SR1', detail: JSON.stringify(sr) }).error === 'SR_LOCKED');
  r = W.post({ token: W.T.src, action: 'save', id: 'SR1', docType: 'QT', status: 'In Progress', detail: JSON.stringify(W.doc('SR1', 'In Progress')) });
  ok('เปลี่ยนชนิดเอกสาร SR → QT ด้วย id เดิม → DOC_TYPE_LOCKED', r.error === 'DOC_TYPE_LOCKED' && W.col('SR1', 'DocType') === 'SR', r);
  W.post({ token: W.T.boss, action: 'saveSR', id: 'SR2', status: 'Submitted', detail: JSON.stringify({ header: { title: 'ยังไม่มี QT', customer: 'CP', groupType: 'Inverter' }, lines: [{ desc: 'x', qty: 1 }] }) });
  ok('SR ที่ยังไม่มี QT ฝ่ายในยังแก้ได้ตามเดิม', W.post({ token: W.T.src, action: 'save', id: 'SR2', docType: 'SR', status: 'Accepted', assignedTo: 'src', detail: JSON.stringify(Object.assign(W.det('SR2'), { status: 'Accepted', assignedTo: 'src' })) }).ok);
}

console.log('== 4) ลบ ==');
{
  const W = world();
  W.save('src', 'D1', 'In Progress'); W.seed('D2', 'Approved'); W.seed('D3', 'Pending');
  ok('Sourcing ลบเอง → APPROVE_REQUIRED (ต้องขอลบให้ผู้บริหารอนุมัติ)', W.post({ token: W.T.src, action: 'delete', id: 'D1' }).error === 'APPROVE_REQUIRED' && W.col('D1', 'Deleted') !== 'TRUE');
  ok('ผู้บริหารลบใบ Approved → DELETE_LOCKED', W.post({ token: W.T.pm, action: 'delete', id: 'D2' }).error === 'DELETE_LOCKED');
  ok('GM / Admin ลบใบ Pending → DELETE_LOCKED', W.post({ token: W.T.gm, action: 'delete', id: 'D3' }).error === 'DELETE_LOCKED' && W.post({ token: W.T.adm, action: 'delete', id: 'D3' }).error === 'DELETE_LOCKED');
  ok('ผู้บริหารลบใบ In Progress ได้ (อนุมัติคำขอลบ)', W.post({ token: W.T.pm, action: 'delete', id: 'D1' }).ok && W.col('D1', 'Deleted') === 'TRUE');
  ok('…Log บอกเลขที่ + สถานะตอนลบ', W.sheets['Log'].rows.some(r => /^delete/.test(r[1]) && /QT-D1/.test(r.join(' ')) && /In Progress/.test(r.join(' '))));
  W.post({ token: W.T.boss, action: 'saveSR', id: 'S1', status: 'Submitted', detail: JSON.stringify({ header: { title: 'x', customer: 'CP', groupType: 'Inverter' }, lines: [{ desc: 'a', qty: 1 }] }) });
  W.post({ token: W.T.src, action: 'save', id: 'S1', docType: 'SR', status: 'Quoted', assignedTo: 'src', detail: JSON.stringify(Object.assign(W.det('S1'), { status: 'Quoted', assignedTo: 'src', quoteIds: ['D2'] })) });
  ok('SR ที่มี QT → SR_HAS_QT (ทุก role)', W.post({ token: W.T.gm, action: 'delete', id: 'S1' }).error === 'SR_HAS_QT');
  W.post({ token: W.T.boss, action: 'saveSR', id: 'S2', status: 'Submitted', detail: JSON.stringify({ header: { title: 'y', customer: 'CP', groupType: 'Inverter' }, lines: [{ desc: 'a', qty: 1 }] }) });
  ok('Sales ลบคำขอของตัวเองที่ยังไม่มีคนรับ → ได้ตามเดิม', W.post({ token: W.T.boss, action: 'delete', id: 'S2' }).ok);
}

console.log('== 5) อนุมัติ: Sourcing Manager → BD Manager · BD แทนได้ ==');
{
  const W = world();
  W.save('src', 'Q1', 'Submitted');
  let r = W.post({ token: W.T.pm, action: 'approve', id: 'Q1' });
  ok('Sourcing Manager อนุมัติ → Partial Approved รอ BD', r.status === 'Partial Approved' && r.next === 'BD Mgr');
  r = W.post({ token: W.T.bd, action: 'approve', id: 'Q1' });
  ok('BD อนุมัติต่อ → Approved (ไม่มีรายการแทน)', r.status === 'Approved' && r.approvedLevels.join() === 'BD Mgr' && !W.det('Q1').approvals.some(a => a.onBehalfOf));
  W.save('src', 'Q2', 'Submitted');
  r = W.post({ token: W.T.bd, action: 'approve', id: 'Q2' });
  ok('BD กดก่อน → อนุมัติแทน Sourcing Manager + ของตัวเอง → Approved', r.status === 'Approved' && r.approvedLevels.join() === 'Procurement Mgr,BD Mgr');
  const a = W.det('Q2').approvals.filter(x => x.levelRole);
  ok('…ประวัติ: BD อนุมัติแทน Sourcing Manager (onBehalfOf) + BD อนุมัติ · ผู้กดเป็น BD ทั้งคู่', a.length === 2 && a.every(x => x.userId === 'bd') && a[0].onBehalfOf === 'Procurement Mgr' && !a[1].onBehalfOf, a);
  W.save('src', 'Q3', 'Submitted');
  r = W.post({ token: W.T.pm, action: 'approve', id: 'Q3' });
  ok('Sourcing Manager อนุมัติแทน BD ไม่ได้ (ได้แค่ขั้นของตัวเอง)', r.status === 'Partial Approved' && r.approvedLevels.join() === 'Procurement Mgr');
  ok('Admin อนุมัติไม่ได้ (Aon: ไม่ใช่ผู้อนุมัติสำรอง)', W.post({ token: W.T.adm, action: 'approve', id: 'Q3' }).error === 'ROLE_CANNOT_APPROVE');
  ok('Sourcing / Sales อนุมัติไม่ได้', W.post({ token: W.T.src, action: 'approve', id: 'Q3' }).error === 'ACCESS_DENIED' && W.post({ token: W.T.boss, action: 'approve', id: 'Q3' }).error === 'ACCESS_DENIED');
}

console.log('== 6) ปล่อยราคา: NON คนเดียว ==');
{
  const W = world();
  W.save('src', 'R1', 'Submitted'); W.post({ token: W.T.pm, action: 'approve', id: 'R1' }); W.post({ token: W.T.bd, action: 'approve', id: 'R1' });
  ['pm', 'bd', 'gm', 'adm', 'src', 'smgr', 'boss'].forEach(u => {
    const r = W.post({ token: W.T[u], action: 'release', id: 'R1' });
    if (r.error !== 'ACCESS_DENIED') ok(u + ' ปล่อยราคาต้องถูกปฏิเสธ', false, r);
  });
  ok('ผู้บริหาร / Admin / Sourcing / Sales อื่น ปล่อยราคาไม่ได้ (ACCESS_DENIED) · สถานะยัง Approved', W.col('R1', 'Status') === 'Approved');
  // ผู้ปล่อยราคาสำรองที่ตั้งไว้ใน Settings เดิม → ไม่มีผลแล้ว
  const st = W.get('settings', W.T.gm).settings || {};
  W.post({ token: W.T.gm, action: 'saveSettings', settingsRev: (st.rev || 0) + 1, detail: JSON.stringify(Object.assign({}, st, { releaseDelegateId: 'pair', rev: (st.rev || 0) + 1 })) });
  ok('ค่าเดิม releaseDelegateId (PAIR) ยังเก็บไว้ใน Settings (ไม่ลบข้อมูล)', W.ctx.getSettingsRaw_().releaseDelegateId === 'pair', W.ctx.getSettingsRaw_());
  ok('…แต่ PAIR ปล่อยราคาไม่ได้ และไม่เห็นราคาก่อนปล่อย', W.post({ token: W.T.pair, action: 'release', id: 'R1' }).error === 'ACCESS_DENIED' && !(W.sv('pair', 'R1') || {}).salesDetail);
  const r = W.post({ token: W.T.sales_non, action: 'release', id: 'R1' });
  ok('NON ปล่อยราคา → Pending · BOSS เห็นราคา', r.ok && W.col('R1', 'Status') === 'Pending' && /22500/.test((W.sv('boss', 'R1') || {}).salesDetail || ''));
}

console.log('== 7) กันฝังโค้ด (id / วันที่) ==');
{
  const W = world();
  let r = W.post({ token: W.T.boss, action: 'saveSR', id: "x');alert(1);('", status: 'Submitted', detail: JSON.stringify({ header: { title: 't', customer: 'c', groupType: 'Inverter' }, lines: [{ desc: 'a', qty: 1 }] }) });
  ok('Sales ส่งคำขอที่ id มีอักขระพิเศษ → BAD_ID · ไม่มีแถวเกิด', r.error === 'BAD_ID' && W.sheets['Quotations'].rows.length === 1, r);
  ok('save ใบใหม่ id มีอักขระพิเศษ → BAD_ID', W.save('src', 'a"b', 'In Progress').error === 'BAD_ID');
  r = W.post({ token: W.T.boss, action: 'saveSR', id: 'XSS1', status: 'Submitted', detail: JSON.stringify({ header: { title: 't', customer: 'c', groupType: 'Inverter',
    needBy: '<img src=x onerror=alert(1)>', reqDate: '"><img src=x>', offerDate: '2026-10-30' }, lines: [{ desc: 'a', qty: 1 }] }) });
  const h = W.det('XSS1').header;
  ok('ช่องวันที่ที่มีโค้ด → ล้างเป็นค่าว่าง · วันที่จริงคงเดิม', r.ok && h.needBy === '' && h.reqDate === '' && h.offerDate === '2026-10-30', h);
  ok('ช่องข้อความ (ชื่อ/ลูกค้า) ไม่ถูกตัด — หน้าเว็บ escape ตอนแสดง', W.post({ token: W.T.boss, action: 'saveSR', id: 'T2', status: 'Submitted', detail: JSON.stringify({ header: { title: 'A <b>&</b> B', customer: 'c', groupType: 'Inverter' }, lines: [] }) }).ok &&
    W.det('T2').header.title === 'A <b>&</b> B');
  // ข้อมูลเดิมในชีทที่ id แปลก ๆ (ก่อน v5.9) ยังบันทึกต่อได้ — ตรวจเฉพาะใบใหม่
  W.seed('old.id#1', 'In Progress');
  ok('ใบเดิมในชีทที่ id นอกรูปแบบ (ข้อมูลก่อน v5.9) ยังบันทึกต่อได้', W.save('src', 'old.id#1', 'In Progress').ok);
}

console.log('== 8) Log บอก ก่อน → หลัง ==');
{
  const W = world();
  W.save('src', 'L1', 'In Progress'); W.save('src', 'L1', 'Submitted');
  const rows = W.sheets['Log'].rows.filter(r => /^save/.test(r[1]) && r[2] === 'L1').map(r => r[4]);
  ok('แถว save ใน Log มีสถานะ ก่อน → หลัง', rows.some(n => /ใหม่ → In Progress/.test(n)) && rows.some(n => /In Progress → Submitted/.test(n)), rows);
}

console.log(fails ? fails + ' FAILED' : 'ALL v5.9 TESTS PASSED');
process.exit(fails ? 1 : 0);
