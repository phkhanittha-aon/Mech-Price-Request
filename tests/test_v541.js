// v5.5 — แก้หน้ารีเฟรชเอง/โหลดช้า: ตั้งค่าไม่ทับ dataEpoch · SettingsRev ไม่ถอยหลัง · แคชการอ่านต่อ request · changes อ่านเฉพาะที่เปลี่ยน
// รัน: node tests/test_v541.js $PWD   (ทดสอบบนเครื่องเท่านั้น ห้าม deploy)
const crypto = require('crypto');
const { makeRuntime } = require('./gasmock');
const DIR = process.argv[2] || '.';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 400) : '')); if (!c) fails++; };
const H = s => crypto.createHash('sha256').update(s + 'mgs-internal-2025').digest('hex');
const { ctx, sheets } = makeRuntime(DIR + '/Code.gs');
const U = sheets['Users'], uh = U.rows[0], c = n => uh.indexOf(n);
[['src', 'Chatraporn', 'Sourcing'], ['pm', 'Procure', 'Procurement Mgr'], ['boss', 'BOSS', 'Sales'], ['tmp', 'Temp', 'Sourcing'], ['adm', 'Admin', 'Admin']]
  .forEach(([id, n, r]) => { const x = []; x[c('Id')] = id; x[c('Name')] = n; x[c('Role')] = r; x[c('Scope')] = 'all'; x[c('PassHash')] = H('pw123456'); x[c('Email')] = id + '@m.co'; U.rows.push(x); });
const post = p => JSON.parse(ctx.apiPost(JSON.stringify(p)));
const get = (t, tok, a) => JSON.parse(ctx.apiGet(t, tok, a || ''));
const T = {}; ['src', 'pm', 'boss', 'tmp', 'adm'].forEach(u => { T[u] = post({ action: 'login', user: u, passHash: H('pw123456') }).token; });
const S = sheets['Settings'], sh = S.rows[0];
const setRaw = (obj, rev) => { while (S.rows.length < 2) S.rows.push([]); S.rows[1][sh.indexOf('Detail')] = JSON.stringify(obj); S.rows[1][sh.indexOf('SettingsRev')] = rev; };
const raw = () => JSON.parse(S.rows[1][sh.indexOf('Detail')]);
const rev = () => +S.rows[1][sh.indexOf('SettingsRev')];

console.log('== 1) บันทึกตั้งค่าไม่ทับ dataEpoch (ต้นเหตุหน้ารีเฟรชเอง) ==');
setRaw({ dataEpoch: 'E261011-new', dataEpochAt: '2026-10-11T01:00:00Z', exrate: 36 }, 5);
const epochBefore = get('quotations', T.src).dataEpoch;
let r = post({ token: T.pm, action: 'saveSettings', settingsRev: 3, detail: JSON.stringify({ dataEpoch: 'E-old', dataEpochAt: '2020-01-01', exrate: 37 }) });
ok('เครื่องที่ถือ epoch เก่าบันทึกตั้งค่า → epoch บนชีทยังเป็นค่าใหม่', raw().dataEpoch === 'E261011-new' && raw().dataEpochAt === '2026-10-11T01:00:00Z' && raw().exrate === 37, raw());
ok('ทุกเครื่องเห็น epoch เดิม (ไม่ล้างสำเนา/ไม่โหลดใหม่ทั้งชุด)', get('quotations', T.src).dataEpoch === epochBefore && epochBefore === 'E261011-new');
r = post({ token: T.pm, action: 'saveSettings', settingsRev: 7, detail: JSON.stringify({ exrate: 38 }) });
ok('ไม่ส่ง epoch มาเลย → ยังคงค่าบนชีท', raw().dataEpoch === 'E261011-new' && raw().exrate === 38, raw());
ok('SettingsRev ไม่ถอยหลัง: ส่ง 3 ตอนชีทเป็น 5 → 6 · ส่ง 7 → 7 · คำตอบบอกเลขที่ใช้จริง', r.settingsRev === 7 && rev() === 7, [r, rev()]);
r = post({ token: T.pm, action: 'saveSettings', settingsRev: 2, detail: JSON.stringify({ exrate: 39 }) });
ok('ส่งเลขเก่า (2) → 8 (stored + 1) เครื่องอื่นยังดึงของใหม่ได้', r.settingsRev === 8 && rev() === 8, [r, rev()]);
setRaw({ exrate: 36 }, 9);
post({ token: T.pm, action: 'saveSettings', settingsRev: 10, detail: JSON.stringify({ dataEpoch: 'E-sneaky', exrate: 36 }) });
ok('ชีทยังไม่เคยล้างข้อมูล (ไม่มี epoch) → client ตั้ง epoch เองไม่ได้', raw().dataEpoch === undefined, raw());
ok('Sales บันทึกตั้งค่าไม่ได้ (เหมือนเดิม)', post({ token: T.boss, action: 'saveSettings', settingsRev: 99, detail: '{}' }).ok === false && rev() === 10);
ok('detail ไม่ใช่ JSON → ไม่เขียน', post({ token: T.pm, action: 'saveSettings', settingsRev: 11, detail: 'xx{' }).ok === false && rev() === 10);

console.log('== 2) แคชการอ่านภายใน request เดียว ==');
const QS = sheets['Quotations'], qh = QS.rows[0];
const old = new Date(Date.now() - 86400000).toISOString();
for (let k = 0; k < 60; k++) { const row = new Array(qh.length).fill(''); const set = (h, v) => { row[qh.indexOf(h)] = v; };
  set('Id', 'Q' + k); set('DocType', 'QT'); set('DocNo', 'QT-' + k); set('Status', 'In Progress'); set('SalesUserId', 'boss'); set('UpdatedAt', old);
  set('Detail', JSON.stringify({ id: 'Q' + k, docType: 'QT', status: 'In Progress', header: { currency: 'THB' }, lines: [{ group: 'INVERTER', qty: 1 }], pad: 'x'.repeat(2000) })); QS.rows.push(row); }
const proto = Object.getPrototypeOf(QS), orig = proto.getRange; let cnt = null;
proto.getRange = function (a, b, nr, nc) { const rg = orig.call(this, a, b, nr, nc), gv = rg.getValues.bind(rg), nm = this.name;
  rg.getValues = () => { const v = gv(); if (cnt) { cnt.reads++; cnt[nm] = (cnt[nm] || 0) + 1; cnt.bytes += v.reduce((s, x) => s + x.reduce((t, y) => t + String(y).length, 0), 0); } return v; };
  rg.getValue = () => rg.getValues()[0][0]; return rg; };
const measure = fn => { cnt = { reads: 0, bytes: 0 }; const out = fn(); const m = cnt; cnt = null; return [out, m]; };
let [full, m1] = measure(() => get('quotations', T.src));
ok('ดึงทั้งชุด: อ่านชีท Users / Settings ไม่เกิน 2 ครั้ง (header + ข้อมูล · เดิม 7 / 3)', m1.Users <= 2 && m1.Settings <= 2 && m1.reads <= 9 && full.quotations.length === 60, m1);
const since = new Date(Date.now() - 60000).toISOString();
let [ch0, m2] = measure(() => get('changes', T.src, since));
ok('polling ไม่มีอะไรเปลี่ยน: ไม่อ่าน Detail ทั้งชีท (อ่าน < 5 KB) · ได้ 0 แถว', ch0.ok && ch0.quotations.length === 0 && m2.bytes < 5000, m2);
QS.rows[10][qh.indexOf('UpdatedAt')] = new Date().toISOString(); QS.rows[40][qh.indexOf('UpdatedAt')] = new Date().toISOString();
let [ch2, m3] = measure(() => get('changes', T.src, since));
const ids = ch2.quotations.map(x => x.id).sort();
ok('มี 2 ใบเปลี่ยน (แถว 10, 40) → ได้ครบ 2 ใบ ข้อมูลตรงกับการดึงทั้งชุด', ids.join() === 'Q39,Q9' &&
  ch2.quotations.every(x => JSON.stringify(x) === JSON.stringify(get('quotations', T.src).quotations.find(y => y.id === x.id))), ids);
ok('อ่านเฉพาะช่วงแถวที่เปลี่ยน (น้อยกว่าทั้งชีท)', m3.bytes < m1.bytes, [m3.bytes, m1.bytes]);
const [sv, m4] = measure(() => get('salesview', T.boss, since));
ok('แอป Sales แบบ since ใช้ทางลัดเดียวกัน', sv.ok && sv.quotations.length === 2 && m4.bytes < m1.bytes, m4);
ok('แคชปิดหลังจบ request (trigger / editor อ่านสดเหมือนเดิม)', ctx.MEMO_ === null || ctx.MEMO_ === undefined);

console.log('== 3) สิทธิ์ยังตัดสินสดทุก request ==');
U.rows.find(x => x[0] === 'tmp')[c('Active')] = 'FALSE';
const g1 = get('quotations', T.tmp);
ok('ปิดบัญชีแล้ว request ถัดไปถูกปฏิเสธทันที (ACCOUNT_DISABLED)', g1.ok === false && /DISABLED/.test(JSON.stringify(g1)), g1);
U.rows.find(x => x[0] === 'src')[c('Role')] = 'Sales';
const g2 = get('quotations', T.src);
ok('เปลี่ยน role ในชีท → request ถัดไปได้มุมมองใหม่ทันที (Sales ไม่เห็น Detail)', g2.ok && g2.quotations.every(x => !x.detail), g2.quotations && g2.quotations[0]);
U.rows.find(x => x[0] === 'src')[c('Role')] = 'Sourcing';
const sv2 = post({ token: T.adm, action: 'saveUsers', users: [{ id: 'src', name: 'Chatraporn K.', role: 'Sourcing', scope: 'all' }] });
ok('บันทึกผู้ใช้แล้วอ่านใน request เดียวกัน/ถัดไปได้ค่าใหม่ (แคชถูกล้าง)', sv2.ok && get('quotations', T.src).me.name === 'Chatraporn K.', sv2);

console.log(fails ? fails + ' FAILED' : 'ALL v5.5 TESTS PASSED');
process.exit(fails ? 1 : 0);
