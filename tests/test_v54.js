// v5.4 — งานวิ่งตาม "หมวดสินค้า" (Settings.catOwner) ทั้ง SR และ QT · follow.resp / actor.uids สำหรับ "งานของฉัน"
// รัน: node tests/test_v54.js $PWD   (ทดสอบบนเครื่องเท่านั้น ห้าม deploy)
const crypto = require('crypto');
const { makeRuntime } = require('./gasmock');
const DIR = process.argv[2] || '.';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 500) : '')); if (!c) fails++; };
const H = s => crypto.createHash('sha256').update(s + 'mgs-internal-2025').digest('hex');

const rt = makeRuntime(DIR + '/Code.gs'), { ctx, sheets } = rt;
const U = sheets['Users'], uh = U.rows[0], c = n => uh.indexOf(n);
[['src', 'Chatraporn', 'Sourcing', JSON.stringify(['INVERTER', 'BATTERY', 'DATA LOGGER'])],
 ['src2', 'Napasorn', 'Sourcing', JSON.stringify(['MOUNTING', 'Carport', 'DC CABLE'])],
 ['src3', 'Ploy', 'Sourcing', 'all'],
 ['pm', 'Procure', 'Procurement Mgr', 'all'], ['bd', 'BD', 'BD Mgr', 'all'], ['boss', 'BOSS', 'Sales', 'all'], ['pair', 'PAIR', 'Sales', 'all'], ['sales_non', 'NON', 'Sales', 'all'],
 ['gone', 'Former', 'Sourcing', 'all', false]]
  .forEach(([id, n, r, sc, act]) => { const x = []; x[c('Id')] = id; x[c('Name')] = n; x[c('Role')] = r; x[c('Scope')] = sc; x[c('PassHash')] = H('pw123456'); x[c('Email')] = id + '@m.co'; if (act === false) x[c('Active')] = 'FALSE'; U.rows.push(x); });
const post = p => JSON.parse(ctx.apiPost(JSON.stringify(p)));
const get = (t, tok, a) => JSON.parse(ctx.apiGet(t, tok, a || ''));
const T = {}; ['src', 'src2', 'src3', 'pm', 'bd', 'boss', 'pair'].forEach(u => { T[u] = post({ action: 'login', user: u, passHash: H('pw123456') }).token; });
const QS = sheets['Quotations'], qh = QS.rows[0];
const det = id => JSON.parse(QS.rows.find(x => x[qh.indexOf('Id')] === id)[qh.indexOf('Detail')]);
const L = (group, n) => Array.from({ length: n || 1 }, (_, i) => ({ code: group + i, desc: group, group, qty: 1 }));
const sr = (id, groupType, lines, tk) => post({ token: T[tk || 'boss'], action: 'saveSR', id, status: 'Submitted',
  detail: JSON.stringify({ status: 'Submitted', header: { title: 'Req ' + id, customer: 'CP', groupType }, lines }) });
const qt = (id, lines, extra, dextra) => post(Object.assign({ token: T.src3, action: 'save', id, docType: 'QT', docNo: 'QT-' + id, title: 'T ' + id, customer: 'CP', sales: 'BOSS',
  salesUserId: 'boss', status: 'In Progress', currency: 'THB', total: 1000, cost: 800, profit: 200, gp: 20, round: 1,
  detail: JSON.stringify(Object.assign({ id, docType: 'QT', status: 'In Progress', approvalRoles: [], header: { currency: 'THB', groupType: 'Inverter' }, lines }, dextra || {})) }, extra || {}));
const route = id => { const d = det(id); return [d.routedTo, d.routedWhy, d.routedCat || ''].join(); };
const row = (id, tk) => get('quotations', T[tk || 'pm']).quotations.find(x => x.id === id);

console.log('== 1) ยังไม่ตั้งผู้รับผิดชอบตามหมวด → พฤติกรรมเดิม v5.0 (Scope) ==');
sr('A1', 'Mounting', L('MOUNTING'));
ok('Mounting → Napasorn ตาม Scope (เหมือนเดิม)', route('A1') === 'src2,scope,', route('A1'));

console.log('== 2) ตั้ง Settings.catOwner (หมวด → ผู้รับผิดชอบ) ==');
const sv = post({ token: T.pm, action: 'saveSettings', settingsRev: 2, detail: JSON.stringify({ catOwner: { INVERTER: 'src', 'Data Logger': 'src3', MOUNTING: 'src2', BATTERY: 'gone', 'DC CABLE': 'boss' } }) });
ok('ผู้จัดการบันทึกการตั้งค่าได้', sv.ok !== false, sv);
const sales = post({ token: T.boss, action: 'saveSettings', settingsRev: 3, detail: JSON.stringify({ catOwner: { INVERTER: 'boss' } }) });
ok('Sales ตั้งผู้รับผิดชอบเองไม่ได้ (server ปฏิเสธ)', sales.ok === false, sales);
sr('B1', 'Inverter', L('INVERTER', 2).concat(L('DATA LOGGER', 1)));
ok('SR: รายการ INVERTER 2 + DATA LOGGER 1 → Chatraporn (เจ้าของหมวดของรายการส่วนใหญ่)', route('B1') === 'src,category,INVERTER', route('B1'));
sr('B2', 'Inverter', L('DATA LOGGER', 1).concat(L('INVERTER', 1)));
ok('เสมอกัน 1:1 → คนของรายการแรก (Ploy · DATA LOGGER) — ตัวพิมพ์เล็ก/ใหญ่ในชื่อหมวดไม่มีผล', route('B2') === 'src3,category,DATA LOGGER', route('B2'));
sr('B3', 'Inverter', L('MOUNTING', 1));
ok('หมวดสำคัญกว่ากลุ่มงาน: กลุ่มงาน Inverter แต่รายการเป็น MOUNTING → Napasorn', route('B3') === 'src2,category,MOUNTING', route('B3'));
sr('B4', 'ESS', L('BATTERY', 2));
ok('ผู้ดูแลหมวดที่ปิดบัญชีแล้ว → ไม่ใช้ ตกไปใช้ Scope (Chatraporn มี BATTERY)', route('B4') === 'src,scope,', route('B4'));
sr('B5', 'DC Cable', L('DC CABLE', 1));
ok('ผู้ดูแลหมวดเป็น Sales (ตั้งผิด) → ไม่ส่งถึง Sales ตกไป Scope (Napasorn)', route('B5') === 'src2,scope,', route('B5'));
sr('B6', 'Inverter', [{ desc: 'พิมพ์เอง ไม่มีหมวด', qty: 1 }]);
ok('รายการไม่มีหมวด → ใช้ผู้ดูแลหมวดหลักของกลุ่มงาน (Inverter → INVERTER → Chatraporn)', route('B6') === 'src,category,INVERTER', route('B6'));
ok('คำตอบตอนส่ง SR บอกชื่อผู้รับ (Sales เห็น)', sr('B7', 'Mounting', L('MOUNTING')).routedName === 'Napasorn');

console.log('== 3) แก้รายการ / ส่งต่อ ==');
sr('B1', 'Inverter', L('MOUNTING', 3));
ok('Sales แก้รายการเป็น MOUNTING ทั้งหมด (ยังไม่มีคนรับ) → คำนวณใหม่ → Napasorn', route('B1') === 'src2,category,MOUNTING', route('B1'));
sr('B1', 'Inverter', L('MOUNTING', 3));
ok('บันทึกซ้ำโดยหมวดเดิม → ผู้รับเดิม (ไม่คำนวณซ้ำ)', route('B1') === 'src2,category,MOUNTING');
const legacy = QS.rows.find(x => x[0] === 'A1'); const ld = JSON.parse(legacy[qh.indexOf('Detail')]); delete ld.routedSig; legacy[qh.indexOf('Detail')] = JSON.stringify(ld);
sr('A1', 'Mounting', L('INVERTER', 2));
ok('ใบรุ่นเก่า (ไม่มี routedSig) กลุ่มงานเดิม → คงผู้รับเดิม ไม่ย้ายงานที่ส่งไปแล้ว', route('A1') === 'src2,scope,', route('A1'));
const fw = post({ token: T.pm, action: 'save', id: 'B3', docType: 'SR', docNo: 'SR-B3', status: 'Submitted', salesUserId: 'boss',
  detail: JSON.stringify(Object.assign(det('B3'), { routedTo: 'src3', routedManual: true })) });
ok('ส่งต่อด้วยมือ → Ploy (manual)', fw.ok !== false && route('B3').startsWith('src3,manual'), route('B3'));

console.log('== 4) ใบเสนอราคา (QT) วิ่งตามหมวดเช่นกัน ==');
qt('Q1', L('MOUNTING', 2));
ok('QT ยังไม่มีผู้รับงาน → ผู้ดูแลหมวด (Napasorn) · ผู้ทำต่อ = Napasorn ไม่ใช่ทั้งทีม', route('Q1') === 'src2,category,MOUNTING' && row('Q1').follow.actor.kind === 'user' && row('Q1').follow.actor.uids.join() === 'src2', row('Q1').follow);
ok('follow.resp = src2 · respName = Napasorn · respCat = MOUNTING', row('Q1').follow.resp === 'src2' && row('Q1').follow.respName === 'Napasorn' && row('Q1').follow.respCat === 'MOUNTING', row('Q1').follow);
qt('Q2', L('MOUNTING', 2), { assignedTo: 'src' });
ok('QT มีผู้รับงานแล้ว (AssignedTo) → ผู้รับงานสำคัญกว่าหมวด · respWhy = assigned', row('Q2').follow.resp === 'src' && row('Q2').follow.respWhy === 'assigned' && row('Q2').follow.actor.uids.join() === 'src', row('Q2').follow);
qt('Q3', [{ desc: 'x', qty: 1 }], {}, { header: { currency: 'THB', groupType: 'Residential' } });
ok('ไม่มีผู้ดูแลเลย (Residential → INVERTER owner มี) → Chatraporn', row('Q3').follow.resp === 'src', row('Q3').follow);
const old = QS.rows.find(x => x[0] === 'Q2'); const qd = JSON.parse(old[qh.indexOf('Detail')]); ['routedTo', 'routedWhy', 'routedSig', 'routedCat', 'routedName', 'routedAt', 'routedBy'].forEach(k => delete qd[k]);
old[qh.indexOf('Detail')] = JSON.stringify(qd); old[qh.indexOf('AssignedTo')] = '';
ok('QT รุ่นเก่า (ไม่มีข้อมูลส่งงาน · ไม่มีผู้รับ) → ทีม Sourcing เหมือนเดิม (ไม่ย้ายเอง)', row('Q2').follow.actor.kind === 'pool' && row('Q2').follow.resp === '', row('Q2').follow);
post({ token: T.src3, action: 'save', id: 'Q1', docType: 'QT', docNo: 'QT-Q1', status: 'Submitted', salesUserId: 'boss', title: 'T', customer: 'CP',
  detail: JSON.stringify(Object.assign(det('Q1'), { status: 'Submitted' })) });
const f1 = row('Q1').follow;
ok('ส่งขออนุมัติ → ผู้ทำต่อ = Sourcing Manager + BD (uids = pm, bd) · ผู้รับผิดชอบยังเป็น Napasorn', f1.owner === 'MANAGEMENT' && f1.actor.uids.sort().join() === 'bd,pm' && f1.resp === 'src2', f1);
ok('Lark: ไม่มีเหตุการณ์ "ส่งต่อคำขอ" จากการบันทึก QT', !(sheets['NotifyQueue'] ? sheets['NotifyQueue'].rows : []).some(r => /SR_FORWARDED/.test(JSON.stringify(r)) && /Q1/.test(JSON.stringify(r))));

console.log('== 5) ข้อมูลเดิมไม่เปลี่ยน ==');
ok('ไม่มีคอลัมน์ใหม่ในแท็บ Quotations / Users', !qh.some(h => /owner|route|cat/i.test(h)) && uh.join() === ['Id', 'Name', 'Role', 'Scope', 'PassHash', 'Updated', 'Email', 'Active'].join(), [qh, uh]);
ok('Scope ในแท็บ Users ไม่ถูกแก้', U.rows.find(r => r[0] === 'src2')[c('Scope')] === JSON.stringify(['MOUNTING', 'Carport', 'DC CABLE']));
const sv2 = get('salesview', T.boss).quotations;
const sb = get('settings', T.boss), sp = get('settings', T.pm);
ok('Sales ไม่ได้รับ catOwner ในการตั้งค่า (ฝ่ายในได้รับ)', sb.ok === true && sb.settingsRev === 2 && !/catOwner/.test(JSON.stringify(sb)) && /catOwner/.test(JSON.stringify(sp)), [sb.ok, sb.settingsRev]);
ok('Sales เห็นชื่อผู้รับคำขอของตัวเอง (SR) ตามเดิม', sv2.some(r => r.id === 'B7' && r.routedName === 'Napasorn'), sv2.map(r => [r.id, r.routedName]));

console.log(fails ? fails + ' FAILED' : 'ALL v5.4 TESTS PASSED');
process.exit(fails ? 1 : 0);
