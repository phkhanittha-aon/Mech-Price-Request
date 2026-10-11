// v5.1 — ล้างข้อมูล เหลือเฉพาะใบ Pending: exportPendingFile() → importUploadFile() · data epoch · กันเครื่องเก่าส่งใบที่ถูกล้างกลับ
// รัน: node tests/test_v51.js $PWD   (ทดสอบบนเครื่องเท่านั้น ห้าม deploy)
const crypto = require('crypto');
const { makeRuntime } = require('./gasmock');
const DIR = process.argv[2] || '.';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 500) : '')); if (!c) fails++; };
const H = s => crypto.createHash('sha256').update(s + 'mgs-internal-2025').digest('hex');
const clone = x => JSON.parse(JSON.stringify(x));

const W = makeRuntime(DIR + '/Code.gs'), { ctx, sheets, files, driveLog } = W;
const U = sheets['Users'], uh = U.rows[0];
[['src', 'Chatraporn', 'Sourcing'], ['pm', 'Procure', 'Procurement Mgr'], ['gm', 'GM', 'GM'], ['boss', 'BOSS', 'Sales'], ['sales_non', 'NON', 'Sales']]
  .forEach(([id, n, r]) => { const x = []; x[uh.indexOf('Id')] = id; x[uh.indexOf('Name')] = n; x[uh.indexOf('Role')] = r; x[uh.indexOf('Scope')] = 'all'; x[uh.indexOf('PassHash')] = H('pw123456'); x[uh.indexOf('Email')] = id + '@m.co'; U.rows.push(x); });
const post = p => JSON.parse(ctx.apiPost(JSON.stringify(p)));
const get = (t, tok, a) => JSON.parse(ctx.apiGet(t, tok, a || ''));
const tok = u => post({ action: 'login', user: u, passHash: H('pw123456') }).token;
const T = { src: tok('src'), pm: tok('pm'), gm: tok('gm'), boss: tok('boss') };
const QS = sheets['Quotations'], qh = () => QS.rows[0], col = n => qh().indexOf(n);
const rowOf = id => QS.rows.find(r => r[0] === id);
const qt = (id, status, extra) => post(Object.assign({ token: T.src, action: 'save', id, docType: 'QT', docNo: 'QT-' + id, status, salesUserId: 'boss', title: 'T ' + id, customer: 'CP', total: 1000, gp: 20,
  releasedTo: status === 'Pending' ? 'boss' : '',
  detail: JSON.stringify(Object.assign({ id, docType: 'QT', docNo: 'QT-' + id, status, approvalRoles: [], releasedTo: status === 'Pending' ? ['boss'] : [], header: { currency: 'THB', salesUserId: 'boss' }, lines: [{ desc: 'x', qty: 1, up: 800 }] }, (extra && extra.d) || {})),
  salesDetail: JSON.stringify({ id, status, total: 1000, lines: [{ desc: 'x', qty: 1, unitPrice: 1000, amount: 1000 }] }) }, (extra && extra.p) || {}));

/* ---------------- ข้อมูลตั้งต้น ---------------- */
post({ token: T.boss, action: 'saveSR', id: 'SR1', status: 'Submitted', detail: JSON.stringify({ status: 'Submitted', header: { title: 'Req1', customer: 'CP', groupType: 'Inverter' }, lines: [{ desc: 'Inv', qty: 1 }] }) });
post({ token: T.boss, action: 'saveSR', id: 'SR2', status: 'Submitted', detail: JSON.stringify({ status: 'Submitted', header: { title: 'Req2', customer: 'CP', groupType: 'Inverter' }, lines: [{ desc: 'Inv', qty: 1 }] }) });
qt('P1', 'Pending', { d: { srId: 'SR1' } }); qt('P2', 'Pending'); qt('A1', 'Approved'); qt('W1', 'Won'); qt('IP', 'In Progress'); qt('D1', 'Pending');
post({ token: T.src, action: 'delete', id: 'D1' });
sheets['NotifyQueue'].rows.push(['n1', 'QT_SUBMITTED', 'A1', 'k', 'BOT', 't', '{}', 'PENDING', 0, '', '', '', '']);
const before = clone(QS.rows), usersBefore = clone(U.rows), productsBefore = clone(sheets['Products'].rows);
const sr2DocNo = JSON.parse(rowOf('SR2')[col('Detail')]).docNo;

/* ---------------- 1) export ---------------- */
console.log('== 1) exportPendingFile() — สร้างไฟล์ ไม่แตะระบบ ==');
const ex = ctx.exportPendingFile();
const f = files[ex.fileId], fq = f && f.getSheetByName('Quotations');
ok('สร้างไฟล์ Google Sheet ใหม่ ชื่อ MGS_Pending_Upload_… (+ URL)', ex.ok && !!f && /^MGS_Pending_Upload_/.test(ex.name) && /docs\.google\.com\/spreadsheets\/d\//.test(ex.url), ex);
ok('ในไฟล์มีเฉพาะใบ Pending ที่ไม่ถูกลบ (P1, P2) + SR ต้นทางของ P1 (SR1) — ไม่มี Approved / Won / In Progress / ใบที่ลบ / SR ที่ไม่ผูก', ex.qt === 2 && ex.sr === 1 &&
  fq.rows.slice(1).map(r => r[0]).sort().join() === 'P1,P2,SR1', fq && fq.rows.map(r => r[0]));
ok('header ในไฟล์ = header ของระบบทุกคอลัมน์ (35)', JSON.stringify(fq.rows[0]) === JSON.stringify(before[0]) && fq.rows[0].length === 35);
ok('ค่าในไฟล์ = ค่าเดิมทุกคอลัมน์ (Detail / SalesDetail ไม่ถูกแปลง)', ['P1', 'P2', 'SR1'].every(id => JSON.stringify(fq.rows.find(r => r[0] === id)) === JSON.stringify(before.find(r => r[0] === id))));
ok('แท็บ "อ่านก่อน" มีจำนวน + วิธีใช้ + สรุปสถานะทั้งระบบ', (s => s && /ใบเสนอราคา Pending/.test(JSON.stringify(s.rows)) && /CLEAR_AND_IMPORT/.test(JSON.stringify(s.rows)) && /QT Won/.test(JSON.stringify(s.rows)))(f.getSheetByName('อ่านก่อน')));
ok('ระบบไม่ถูกแตะเลย (Quotations เหมือนเดิมทุกแถว)', JSON.stringify(QS.rows) === JSON.stringify(before));
ok('Log บันทึก export-pending', sheets['Log'].rows.some(r => /export-pending/.test(r.join(' '))));

/* ---------------- 2) ตรวจไฟล์ (ยังไม่ทำจริง) ---------------- */
console.log('== 2) importUploadFile(url) — รายงานอย่างเดียว ==');
let r = ctx.importUploadFile(ex.url);
ok('ไฟล์ถูกต้อง → ok · dryRun · บอกว่าจะเหลือ 3 แถว ลบ ' + (before.length - 1 - 3) + ' แถว', r.ok && r.dryRun && r.rowsInFile === 3 && r.qt === 2 && r.sr === 1 && r.willRemove === before.length - 1 - 3 && /CLEAR_AND_IMPORT/.test(r.next), r);
ok('…และไม่แตะข้อมูล', JSON.stringify(QS.rows) === JSON.stringify(before) && !driveLog.some(x => x.op === 'copy'));
const bad = (mut, label, re) => {
  const g = ctx.exportPendingFile(), s = files[g.fileId].getSheetByName('Quotations'); mut(s);
  const x = ctx.importUploadFile(g.fileId, 'CLEAR_AND_IMPORT');
  ok('ไฟล์ผิด (' + label + ') → ไม่ทำ แม้ยืนยันแล้ว · ระบบไม่ถูกแตะ', !x.ok && !x.done && x.problems.some(p => re.test(p)) && JSON.stringify(QS.rows) === JSON.stringify(before), x.problems);
};
bad(s => { s.rows[1][s.rows[0].indexOf('Status')] = 'Won'; if (s.rows[1][s.rows[0].indexOf('DocType')] === 'SR') s.rows[2][s.rows[0].indexOf('Status')] = 'Won'; }, 'สถานะไม่ใช่ Pending', /เฉพาะ Pending/);
bad(s => { s.rows.push(clone(before.find(x => x[0] === 'SR2'))); }, 'มี SR ที่ไม่ผูกกับใบ Pending', /SR นี้ไม่ได้เป็นต้นทาง/);
bad(s => { const i = s.rows.findIndex(x => x[0] === 'P2'); s.rows[i][s.rows[0].indexOf('Detail')] = '{broken'; }, 'Detail เสีย', /Detail อ่านไม่ได้/);
bad(s => { s.rows.push(clone(s.rows.find(x => x[0] === 'P2'))); }, 'Id ซ้ำ', /Id ซ้ำ/);
bad(s => { s.rows[0][s.rows[0].indexOf('Detail')] = 'รายละเอียด'; }, 'แก้ header', /header ไม่ครบ/);
ok('URL ผิด → ไม่ทำ', (x => !x.ok && x.problems.some(p => /ไม่ใช่ URL|เปิดไฟล์ไม่ได้/.test(p)))(ctx.importUploadFile('https://example.com/x', 'CLEAR_AND_IMPORT')));
ok('Id ไฟล์ที่ไม่มี → ไม่ทำ', (x => !x.ok && x.problems.some(p => /เปิดไฟล์ไม่ได้/.test(p)))(ctx.importUploadFile('1AbCdEfGhIjKlMnOpQrStUvWxYz012345', 'CLEAR_AND_IMPORT')));
ok('ยืนยันผิดคำ (ไม่ใช่ CLEAR_AND_IMPORT) → แค่รายงาน', (x => x.dryRun && !x.done)(ctx.importUploadFile(ex.url, 'yes')) && JSON.stringify(QS.rows) === JSON.stringify(before));
// ผู้ใช้ลบแถวที่ไม่ต้องการออกจากไฟล์ได้ (ลบ P2 ทั้งแถว / ล้างเนื้อหาแถวให้ว่าง)
const ex2 = ctx.exportPendingFile(), s2 = files[ex2.fileId].getSheetByName('Quotations');
s2.rows[s2.rows.findIndex(x => x[0] === 'P2')] = new Array(35).fill('');
ok('ลบเนื้อหาทั้งแถวในไฟล์ (แถวว่าง) → ข้ามแถวนั้น', (x => x.ok && x.rowsInFile === 2 && x.qt === 1)(ctx.importUploadFile(ex2.fileId)));

/* ---------------- 3) ทำจริง ---------------- */
console.log('== 3) importUploadFile(url, CLEAR_AND_IMPORT) ==');
const revBefore = Number(sheets['Settings'].rows[1] ? sheets['Settings'].rows[1][sheets['Settings'].rows[0].indexOf('SettingsRev')] : 0) || 0;
r = ctx.importUploadFile(ex.url, 'CLEAR_AND_IMPORT');
ok('ทำจริง → done · สำรองไฟล์ก่อน (BACKUP …)', r.ok && r.done && driveLog.some(x => x.op === 'copy' && /^BACKUP /.test(x.name)), [r, driveLog]);
ok('แท็บ Quotations เหลือ 3 แถว (SR1, P1, P2) · ค่าเดิมทุกคอลัมน์', QS.rows.length === 4 && ['P1', 'P2', 'SR1'].every(id => JSON.stringify(rowOf(id)) === JSON.stringify(before.find(x => x[0] === id))), QS.rows.map(x => x[0]));
ok('header ทุกแท็บไม่เปลี่ยน · Users / Products ไม่ถูกแตะ', JSON.stringify(QS.rows[0]) === JSON.stringify(before[0]) && JSON.stringify(U.rows) === JSON.stringify(usersBefore) && JSON.stringify(sheets['Products'].rows) === JSON.stringify(productsBefore));
ok('คิวแจ้งเตือนเก่าถูกล้าง (header ยังอยู่)', sheets['NotifyQueue'].rows.length === 1 && sheets['NotifyQueue'].rows[0][0] === 'Id');
const stRaw = ctx.getSettingsRaw_();
ok('Settings: dataEpoch + dataEpochAt ใหม่ · SettingsRev เพิ่ม (ทุกเครื่องดึงตั้งค่าใหม่) · ค่าอื่นยังอยู่', /^E/.test(stRaw.dataEpoch) && !!stRaw.dataEpochAt && stRaw.dataEpoch === r.dataEpoch &&
  Number(sheets['Settings'].rows[1][sheets['Settings'].rows[0].indexOf('SettingsRev')]) === revBefore + 1, stRaw);
ok('Log บันทึก data-reset', sheets['Log'].rows.some(x => /data-reset/.test(x.join(' '))));

/* ---------------- 4) หลังล้าง: ระบบใช้งานต่อได้ + เครื่องรู้ว่าต้องโหลดใหม่ ---------------- */
console.log('== 4) หลังล้าง ==');
const gq = get('quotations', T.pm), gs = get('salesview', T.boss), gc = get('changes', T.pm, new Date(Date.now() - 3600000).toISOString());
ok('ทุก response ของรายการเอกสารมี dataEpoch (ระบบทำราคา / changes / แอป Sales)', gq.dataEpoch === r.dataEpoch && gc.dataEpoch === r.dataEpoch && gs.dataEpoch === r.dataEpoch);
ok('Sales ได้ dataEpoch ใน settings ด้วย (ไม่มีข้อมูลภายในอื่นเพิ่ม)', (x => x.dataEpoch === r.dataEpoch && x.srRouting === undefined && x.commission === undefined)(get('settings', T.boss)));
ok('ระบบทำราคาเห็น 3 ใบ', gq.quotations.map(x => x.id).sort().join() === 'P1,P2,SR1');
const p1 = gs.quotations.find(x => x.id === 'P1');
ok('BOSS ยังเห็นราคาของ P1 (ปล่อยราคาแล้ว) และงานอยู่ที่ Sales ตามเดิม', p1 && /unitPrice/.test(p1.salesDetail) && p1.follow.owner === 'SALES', p1);
let s = post({ token: T.src, action: 'save', id: 'A1', docType: 'QT', docNo: 'QT-A1', status: 'Approved', baseUpdatedAt: new Date(Date.now() - 86400000).toISOString(),
  detail: JSON.stringify({ id: 'A1', docType: 'QT', status: 'Approved', header: {}, lines: [] }) });
ok('เครื่องเก่าส่งใบที่ถูกล้างกลับมา (มี baseUpdatedAt) → DATA_RESET · ไม่ถูกสร้างกลับ', !s.ok && s.error === 'DATA_RESET' && !rowOf('A1'), s);
s = post({ token: T.src, action: 'save', id: 'NEW1', docType: 'QT', docNo: 'QT-NEW1', status: 'In Progress', detail: JSON.stringify({ id: 'NEW1', docType: 'QT', status: 'In Progress', header: {}, lines: [] }) });
ok('ใบใหม่ (ไม่มี baseUpdatedAt) → บันทึกได้ตามปกติ', s.ok && !!rowOf('NEW1'));
s = post({ token: T.src, action: 'save', id: 'P2', docType: 'QT', docNo: 'QT-P2', status: 'Pending', releasedTo: 'boss', salesUserId: 'boss', baseUpdatedAt: get('quote', T.src, 'P2').quote.updatedAt,
  detail: JSON.stringify({ id: 'P2', docType: 'QT', status: 'Pending', header: {}, lines: [] }) });
ok('ใบที่ยังอยู่ (P2) แก้ต่อได้ตามปกติ', s.ok, s);
s = post({ token: T.boss, action: 'saveSR', id: 'SR2', status: 'Submitted', detail: JSON.stringify({ docNo: sr2DocNo, status: 'Submitted', header: { title: 'Req2' }, lines: [] }) });
ok('Sales แก้คำขอที่ถูกล้าง (มีเลข SR แล้ว) → DATA_RESET · ไม่ถูกสร้างกลับ', !s.ok && s.error === 'DATA_RESET' && !rowOf('SR2'), s);
s = post({ token: T.boss, action: 'saveSR', id: 'SR9', status: 'Submitted', detail: JSON.stringify({ status: 'Submitted', header: { title: 'ใหม่', customer: 'CP' }, lines: [{ desc: 'x', qty: 1 }] }) });
ok('Sales ส่งคำขอใหม่ → ได้ตามปกติ (เลข SR ใหม่)', s.ok && /^SR-/.test(s.docNo));
const r2 = ctx.importUploadFile(ctx.exportPendingFile().fileId, 'CLEAR_AND_IMPORT');
ok('ล้างซ้ำได้ (เช่น ตรวจแล้วอยากล้างอีกรอบ) — epoch เปลี่ยนทุกครั้ง', r2.done && r2.dataEpoch && r2.dataEpoch !== r.dataEpoch, [r.dataEpoch, r2.dataEpoch]);

console.log(fails ? '\n' + fails + ' FAILED' : '\nALL v5.1 RESET TESTS PASSED'); process.exit(fails ? 1 : 0);
