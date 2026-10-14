// v5.10 — การ์ด Lark: รายการสินค้าเป็นตาราง · กลุ่มผู้อนุมัติ (Bot C) เห็นยอด / กำไร / คอมเรท / ค่าคอม · ตัวเลขไม่หลุดไปกลุ่มอื่นหรือ Sales
// รัน: node tests/test_v510.js $PWD   (ทดสอบบนเครื่องเท่านั้น ห้าม deploy)
const crypto = require('crypto');
const { makeRuntime } = require('./gasmock');
const DIR = process.argv[2] || '.';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 500) : '')); if (!c) fails++; };
const H = s => crypto.createHash('sha256').update(s + 'mgs-internal-2025').digest('hex');
const URL_A = 'https://open.larksuite.com/open-apis/bot/v2/hook/aaaa1111-bbbb-2222-cccc-3333dddd52e1';
const URL_C = 'https://open.larksuite.com/open-apis/bot/v2/hook/cccc1111-dddd-2222-eeee-3333ffff7c01';

function world() {
  const rt = makeRuntime(DIR + '/Code.gs'), { ctx, sheets, props } = rt;
  const U = sheets['Users'], uh = U.rows[0], c = n => uh.indexOf(n);
  [['src', 'Chatraporn', 'Sourcing'], ['pm', 'Procure', 'Procurement Mgr'], ['bd', 'BD', 'BD Mgr'], ['gm', 'GM', 'GM'], ['adm', 'Admin', 'Admin'], ['boss', 'BOSS', 'Sales'], ['sales_non', 'NON', 'Sales'], ['smgr', 'SalesMgr', 'Sales Manager']]
    .forEach(([id, n, r]) => { const x = []; x[c('Id')] = id; x[c('Name')] = n; x[c('Role')] = r; x[c('Scope')] = 'all'; x[c('PassHash')] = H('pw123456'); x[c('Email')] = id + '@m.co'; U.rows.push(x); });
  const post = p => JSON.parse(ctx.apiPost(JSON.stringify(p)));
  const get = (t, tok, a) => JSON.parse(ctx.apiGet(t, tok, a || ''));
  const T = {}; ['src', 'pm', 'bd', 'gm', 'adm', 'boss', 'sales_non', 'smgr'].forEach(u => { T[u] = post({ action: 'login', user: u, passHash: H('pw123456') }).token; });
  const lines = n => Array.from({ length: n }, (_, i) => ({ code: 'MINV-SG50CX-P205-0' + i, desc: 'MINV-SG50CX-P205-0' + i + ' SG50CX-P2,SUNGROW INVERTER 50KW, WITH OPTIMIZER VERSION WARRANTY 5 YEAR', group: 'INVERTER', qty: 30, uom: 'Mw', up: 1000, costCur: 'THB', opPct: 20 }));
  const SUM = { cur: 'THB', total: 1250000, profit: 187500, gp: 15, comAmt: 12500, comRate: 1, at: '2026-10-14',
    byCat: [{ cat: 'Inverter', grade: 'B', rate: 1, comAmt: 10000, total: 1000000 }, { cat: 'Mounting', grade: 'A', rate: 1, comAmt: 2500, total: 250000 }] };
  const qt = (id, status, n, withSum) => post({ token: T.src, action: 'save', id, docType: 'QT', docNo: 'QT-' + id, status, salesUserId: 'boss', sales: 'BOSS', title: 'Rooftop ' + id, customer: 'SCG inter',
    currency: 'THB', total: 1250000, cost: 1062500, profit: 187500, gp: 15, detail: JSON.stringify(Object.assign({ id, docType: 'QT', docNo: 'QT-' + id, status, approvalRoles: [], approvals: [],
      header: { title: 'Rooftop ' + id, customer: 'SCG inter', salesUserId: 'boss', sales: 'BOSS', currency: 'THB' }, lines: lines(n || 3) }, withSum === false ? {} : { apprSummary: SUM })),
    salesDetail: JSON.stringify({ id, status, lines: [{ code: 'A', qty: 1, unitPrice: 1250000, amount: 1250000 }], total: 1250000 }) });
  const Q = () => { const sh = sheets['NotifyQueue']; const h = sh.rows[0]; return sh.rows.slice(1).map(r => { const o = {}; h.forEach((k, i) => o[k] = r[i]); return o; }); };
  Object.assign(props, { LARK_MODE: 'live', LARK_BOT_URL: URL_A, LARK_BOT_SECRET: 'SecA' });
  return Object.assign(rt, { post, get, T, qt, Q, SUM });
}
const card = x => JSON.parse(x.Payload).card;
const text = x => JSON.parse(x.Payload).text;

console.log('== 1) รายการสินค้าเป็นตาราง ==');
{
  const W = world();
  W.qt('T1', 'Submitted', 23);
  const it = W.Q().find(x => x.DocId === 'T1'), c = card(it), rows = c.elements.filter(e => e.tag === 'column_set');
  ok('มีหัวตาราง (พื้นเทา) # · รหัส · รายการ · จำนวน', rows[0] && rows[0].background_style === 'grey' && rows[0].columns.map(x => x.elements[0].content).join('|') === '**#**|**รหัส**|**รายการ**|**จำนวน**', rows[0]);
  ok('แสดงสูงสุด 8 แถว + บอกว่าเหลืออีก 15 รายการ', rows.length === 9 && /และอีก 15 รายการ/.test(text(it)), rows.length);
  const r1 = rows[1].columns.map(x => x.elements[0].content);
  ok('แถวสินค้า: ลำดับ · รหัส · ชื่อ (ตัดรหัสที่ซ้ำหน้าชื่อ · ไม่เกิน 60 ตัวอักษร) · จำนวน + หน่วย ชิดขวา', r1[0] === '1' && r1[1] === 'MINV-SG50CX-P205-00' && /^SG50CX-P2,SUNGROW INVERTER 50KW/.test(r1[2]) && r1[2].length <= 60 && r1[3] === '30 Mw' &&
    rows[1].columns[3].elements[0].text_align === 'right', r1);
  ok('ไม่มีรายการแบบบรรทัดยาว "• … — 30 Mw" แบบเดิม', !/• MINV/.test(text(it)));
}

console.log('== 2) Bot C ยังไม่ได้ตั้ง → การ์ดขออนุมัติเข้า Bot A แบบไม่มีตัวเลข (เหมือนเดิม) ==');
{
  const W = world();
  W.fetchLog.length = 0; W.qt('A1', 'Submitted');
  const it = W.Q().find(x => x.DocId === 'A1' && x.Event === 'QT_SUBMITTED');
  ok('Target = BOT · ส่งไป Bot A', it.Target === 'BOT' && W.fetchLog.length === 1 && W.fetchLog[0].url === URL_A, [it.Target, W.fetchLog.map(f => f.url)]);
  ok('ไม่มีตัวเลขการเงินเลย (ยอด / กำไร / ค่าคอม)', !/1,250,000|187,500|12,500|ค่าคอม|กำไร/.test(it.Payload) && /มีราคาแล้ว/.test(text(it)), text(it));
}

console.log('== 3) ตั้ง Bot C → การ์ดขออนุมัติไปกลุ่มผู้อนุมัติ พร้อมตัวเลข ==');
{
  const W = world();
  Object.assign(W.props, { LARK_APPROVAL_URL: URL_C, LARK_APPROVAL_SECRET: 'SecC' });
  W.fetchLog.length = 0; W.qt('C1', 'Submitted');
  let it = W.Q().find(x => x.DocId === 'C1' && x.Event === 'QT_SUBMITTED'), t = text(it);
  ok('ส่งขออนุมัติ → Target APPROVAL · ยิงไป Bot C เท่านั้น (ไม่เข้า Bot A)', it.Target === 'APPROVAL' && W.fetchLog.length === 1 && W.fetchLog[0].url === URL_C, [it.Target, W.fetchLog.map(f => f.url)]);
  ok('มูลค่าทั้งโครงการ 1,250,000.00 THB · กำไรรวม 187,500.00 · GP 15.00%', /มูลค่าทั้งโครงการ 1,250,000\.00 THB/.test(t) && /กำไรรวม 187,500\.00 THB · GP 15\.00%/.test(t), t);
  ok('ค่าคอม Sales 12,500.00 · คอมเรทเฉลี่ย 1.00% · กำไรหลังหักค่าคอม 175,000.00', /ค่าคอม Sales 12,500\.00 THB · คอมเรทเฉลี่ย 1\.00%/.test(t) && /กำไรหลังหักค่าคอม 175,000\.00 THB/.test(t), t);
  ok('ตารางคอมเรทตามกลุ่มสินค้า: Inverter B 1.00% 10,000.00 · Mounting A 1.00% 2,500.00', /Inverter \| · B \| · 1\.00% \| · 10,000\.00/.test(t) && /Mounting \| · A \| · 1\.00% \| · 2,500\.00/.test(t), t);
  ok('ผู้ดำเนินการแท็ก Sourcing Manager + BD Manager', /<at email=pm@m\.co>/.test(it.Payload) && /<at email=bd@m\.co>/.test(it.Payload));
  W.fetchLog.length = 0; W.post({ token: W.T.pm, action: 'approve', id: 'C1' });
  it = W.Q().find(x => x.DocId === 'C1' && x.Event === 'QT_PARTIAL_APPROVED');
  ok('Sourcing Manager อนุมัติแล้ว → การ์ดรอ BD ไป Bot C พร้อมตัวเลข', it && it.Target === 'APPROVAL' && /1,250,000\.00/.test(text(it)) && W.fetchLog.every(f => f.url === URL_C), it && it.Target);
  W.fetchLog.length = 0; W.post({ token: W.T.bd, action: 'approve', id: 'C1' });
  it = W.Q().find(x => x.DocId === 'C1' && x.Event === 'QT_APPROVED');
  ok('อนุมัติครบ (แจ้ง NON) → Bot A · ไม่มีตัวเลข', it && it.Target === 'BOT' && !/1,250,000|187,500|12,500/.test(it.Payload) && W.fetchLog.every(f => f.url === URL_A), it && it.Target);
  W.post({ token: W.T.sales_non, action: 'release', id: 'C1' });
  it = W.Q().find(x => x.DocId === 'C1' && x.Event === 'PRICE_RELEASED');
  ok('ปล่อยราคา → Bot A · ไม่มีตัวเลข', it && it.Target === 'BOT' && !/1,250,000|187,500/.test(it.Payload));
  // ใบจากหน้าเว็บรุ่นเก่า (ไม่มี apprSummary)
  W.qt('C2', 'Submitted', 2, false);
  it = W.Q().find(x => x.DocId === 'C2' && x.Event === 'QT_SUBMITTED'); t = text(it);
  ok('ใบที่ไม่มีสรุปจากหน้าเว็บ → ใช้คอลัมน์ Total / Profit / GP · ค่าคอมขึ้น "—" พร้อมบอกวิธีแก้', /1,250,000\.00 THB/.test(t) && /GP 15\.00%/.test(t) && /ค่าคอม Sales — \(ใบนี้บันทึกจากหน้าเว็บรุ่นเก่า/.test(t), t);
}

console.log('== 4) ตัวเลขไม่หลุด ==');
{
  const W = world();
  Object.assign(W.props, { LARK_APPROVAL_URL: URL_C, LARK_SEND_NOW: 'off' });
  W.qt('L1', 'Submitted');
  delete W.props.LARK_APPROVAL_URL;                                   // ลบ Bot C หลังการ์ดเข้าคิวแล้ว
  W.fetchLog.length = 0; const f = W.ctx.larkFlush();
  const it = W.Q().find(x => x.DocId === 'L1');
  ok('การ์ดที่มีตัวเลขค้างในคิว แต่ Bot C ถูกลบ → SKIPPED (ไม่ส่งไป Bot A แทน)', it.Status === 'SKIPPED' && /LARK_APPROVAL_URL/.test(it.LastError) && !W.fetchLog.some(x => x.url === URL_A), [it.Status, it.LastError, W.fetchLog.map(x => x.url)]);
  const leaks = ['boss', 'sales_non', 'smgr'].map(u => [u, JSON.stringify([W.get('salesview', W.T[u]), W.get('quotations', W.T[u]), W.get('quote', W.T[u], 'L1')])]).filter(([, s]) => /apprSummary|comRate|12500|187500/.test(s));
  ok('Sales / NON / Sales Manager ไม่ได้รับ apprSummary หรือตัวเลขค่าคอม/กำไรในทุก endpoint', !leaks.length, leaks.map(x => x[0]));
  ok('SalesDetail ในชีทไม่มี apprSummary', !/apprSummary/.test(String(W.sheets['Quotations'].rows.find(r => r[0] === 'L1')[W.sheets['Quotations'].rows[0].indexOf('SalesDetail')])));
  ok('ฝ่ายใน (Procurement Mgr) ยังเห็น apprSummary ใน Detail', /apprSummary/.test(JSON.stringify(W.get('quote', W.T.pm, 'L1'))));
}

console.log('== 5) หน้าตั้งค่า: Bot C ==');
{
  const W = world();
  let st = W.post({ token: W.T.adm, action: 'larkStatus' });
  ok('สถานะมี Bot C (MGS Approval) · ยังไม่ได้ตั้ง', st.ok && st.bots.C && st.bots.C.urlSet === false && st.bots.C.urlKey === 'LARK_APPROVAL_URL' && !st.bots.C.via, st.bots && st.bots.C);
  ok('คำเตือน: ยังไม่ได้ตั้ง Bot C → การ์ดขออนุมัติไม่มีตัวเลข', (st.warnings || []).some(w => /LARK_APPROVAL_URL/.test(w)));
  ok('Sourcing Manager ตั้ง Bot C ไม่ได้', W.post({ token: W.T.pm, action: 'larkSave', bot: 'C', url: URL_C }).error === 'ACCESS_DENIED' && !W.props.LARK_APPROVAL_URL);
  st = W.post({ token: W.T.adm, action: 'larkSave', bot: 'C', url: URL_C, secret: 'SecretC9' });
  ok('Admin ตั้ง Bot C → Script Properties · คำตอบไม่มี URL เต็ม / Secret', W.props.LARK_APPROVAL_URL === URL_C && W.props.LARK_APPROVAL_SECRET === 'SecretC9' && st.bots.C.urlSet && !JSON.stringify(st).includes('SecretC9') && !JSON.stringify(st).includes(URL_C));
  W.fetchLog.length = 0; st = W.post({ token: W.T.adm, action: 'larkTest', bot: 'C' });
  const sent = W.fetchLog[0] && W.fetchLog[0].o.payload;
  ok('ส่งการ์ดทดสอบ Bot C → ยิงไป URL ของ C · มีตัวเลขตัวอย่างสำหรับผู้อนุมัติ', st.test && st.test.ok && W.fetchLog.length === 1 && W.fetchLog[0].url === URL_C && /ตัวเลขสำหรับผู้อนุมัติ/.test(sent) && /2,430,000\.00/.test(sent), st.test);
  st = W.post({ token: W.T.adm, action: 'larkClear', bot: 'C' });
  ok('ลบค่า Bot C ได้ · Bot A ไม่ถูกกระทบ', !W.props.LARK_APPROVAL_URL && W.props.LARK_BOT_URL === URL_A);
}

console.log(fails ? fails + ' FAILED' : 'ALL v5.10 TESTS PASSED');
process.exit(fails ? 1 : 0);
