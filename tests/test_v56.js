// v5.6 — หน้าตั้งค่า Lark Bot (server): สิทธิ์ Admin/GM · ไม่ส่ง Secret กลับ · ไม่ลงชีท/Log · ตรวจรูปแบบ · ส่งทดสอบ · โหมด · trigger
// รัน: node tests/test_v56.js $PWD   (ทดสอบบนเครื่องเท่านั้น ห้าม deploy)
const crypto = require('crypto');
const { makeRuntime } = require('./gasmock');
const DIR = process.argv[2] || '.';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 400) : '')); if (!c) fails++; };
const H = s => crypto.createHash('sha256').update(s + 'mgs-internal-2025').digest('hex');
const { ctx, sheets, props, fetchLog, triggers } = makeRuntime(DIR + '/Code.gs');
const U = sheets['Users'], uh = U.rows[0], c = n => uh.indexOf(n);
[['adm', 'Khanittha', 'Admin', 'adm@mglobalsourcing.net'], ['gm', 'GM', 'GM', 'gm@m.co'], ['pm', 'Procure', 'Procurement Mgr', 'pm@m.co'], ['src', 'Chatraporn', 'Sourcing', 'src@m.co'], ['boss', 'BOSS', 'Sales', 'boss@m.co']]
  .forEach(([id, n, r, e]) => { const x = []; x[c('Id')] = id; x[c('Name')] = n; x[c('Role')] = r; x[c('Scope')] = 'all'; x[c('PassHash')] = H('pw123456'); x[c('Email')] = e; U.rows.push(x); });
const post = p => JSON.parse(ctx.apiPost(JSON.stringify(p)));
const T = {}; ['adm', 'gm', 'pm', 'src', 'boss'].forEach(u => { T[u] = post({ action: 'login', user: u, passHash: H('pw123456') }).token; });
const URL_A = 'https://open.larksuite.com/open-apis/bot/v2/hook/aaaa1111-bbbb-2222-cccc-3333dddd52e1';
const URL_B = 'https://open.larksuite.com/open-apis/bot/v2/hook/bbbb1111-cccc-2222-dddd-4444eeeef598';
const SEC_A = 'SuperSecretA_9xQ', SEC_B = 'SuperSecretB_7kP';
const logText = () => JSON.stringify(sheets['Log'] ? sheets['Log'].rows : []);
const sheetText = () => JSON.stringify(Object.values(sheets).map(s => s.rows));

console.log('== 1) สิทธิ์ตัดสินที่ server ==');
['pm', 'src', 'boss'].forEach(u => ['larkStatus', 'larkSave', 'larkTest', 'larkMode', 'larkClear', 'larkTriggers'].forEach(a => {
  const r = post({ token: T[u], action: a, bot: 'A', url: URL_A, secret: SEC_A, mode: 'live' });
  if (r.error !== 'ACCESS_DENIED') ok(u + ' ' + a + ' ต้องถูกปฏิเสธ', false, r);
}));
ok('Sourcing Manager / Sourcing / Sales ใช้ทุกคำสั่ง Lark ไม่ได้ (ACCESS_DENIED) · ไม่มีค่าถูกตั้ง', !props.LARK_BOT_URL && !props.LARK_MODE);
ok('ไม่มี token = ปฏิเสธ', post({ action: 'larkStatus' }).ok === false);
let st = post({ token: T.adm, action: 'larkStatus' });
ok('Admin อ่านสถานะได้: ยังไม่ตั้ง · โหมดเริ่มต้น dryrun', st.ok && st.mode === 'dryrun' && !st.bots.A.urlSet && !st.bots.B.urlSet, st);
ok('GM ใช้ได้เหมือน Admin', post({ token: T.gm, action: 'larkStatus' }).ok === true);

console.log('== 2) บันทึก Webhook / Secret ==');
let r = post({ token: T.adm, action: 'larkSave', bot: 'A', url: 'https://example.com/hook/abc', secret: '' });
ok('URL ไม่ใช่ webhook ของ Lark → BAD_WEBHOOK และไม่บันทึก', r.error === 'BAD_WEBHOOK' && !props.LARK_BOT_URL, r);
r = post({ token: T.adm, action: 'larkSave', bot: 'A', url: '', secret: 'มี ช่องว่าง' });
ok('Secret มีช่องว่าง → BAD_SECRET', r.error === 'BAD_SECRET' && !props.LARK_BOT_SECRET, r);
ok('ไม่กรอกอะไร → NOTHING_TO_SAVE', post({ token: T.adm, action: 'larkSave', bot: 'A' }).error === 'NOTHING_TO_SAVE');
ok('bot ไม่รู้จัก → BAD_VALUE', post({ token: T.adm, action: 'larkSave', bot: 'Z', url: URL_A }).error === 'BAD_VALUE');
r = post({ token: T.adm, action: 'larkSave', bot: 'A', url: '  ' + URL_A + ' ', secret: SEC_A });
ok('บันทึกลง Script Properties (ตัดช่องว่างหัวท้าย)', props.LARK_BOT_URL === URL_A && props.LARK_BOT_SECRET === SEC_A, props);
ok('คำตอบ: ✓ ตั้งแล้ว + URL ปิดบัง (…/hook/••••52e1) · ไม่มี Secret / URL เต็มในคำตอบ', r.ok && r.bots.A.urlSet && r.bots.A.secretSet && r.bots.A.url === 'https://open.larksuite.com/…/hook/••••52e1' &&
  !JSON.stringify(r).includes(SEC_A) && !JSON.stringify(r).includes(URL_A), r.bots && r.bots.A);
ok('ไม่มีค่าลับในชีทใดเลย (รวม Log) — Log บอกแค่ว่าใครตั้งอะไร', !sheetText().includes(SEC_A) && !sheetText().includes('aaaa1111') && /ตั้ง webhook \+ secret/.test(logText()));
r = post({ token: T.adm, action: 'larkSave', bot: 'A', url: '', secret: 'NewSecretA2' });
ok('เว้นว่างช่อง URL = คงค่าเดิม เปลี่ยนแค่ Secret', props.LARK_BOT_URL === URL_A && props.LARK_BOT_SECRET === 'NewSecretA2');
ok('Bot B ยังไม่ตั้ง → สถานะบอกว่าส่งผ่าน Bot A', r.bots.B.urlSet === false && /A/.test(r.bots.B.via), r.bots.B);

console.log('== 3) ส่งการ์ดทดสอบ ==');
fetchLog.length = 0;
r = post({ token: T.adm, action: 'larkTest', bot: 'A' });
const sent = fetchLog[0] && JSON.parse(fetchLog[0].o.payload);
ok('ยิงจริง 1 ครั้งไปที่ Bot A (แม้โหมด dryrun) พร้อมลายเซ็น', fetchLog.length === 1 && fetchLog[0].url === URL_A && sent.sign && sent.timestamp, fetchLog.map(x => x.url));
ok('การ์ดขึ้นหัวว่า [ทดสอบจากหน้าตั้งค่า] และแท็กอีเมลของคนที่กด', /\[ทดสอบจากหน้าตั้งค่า\]/.test(JSON.stringify(sent)) && JSON.stringify(sent).includes('adm@mglobalsourcing.net'));
ok('ผล: ส่งสำเร็จ · ส่งล่าสุด = ส่งการ์ดทดสอบ', r.test && r.test.ok && r.bots.A.last && r.bots.A.last.status === 'SENT' && r.bots.A.last.whatTh === 'ส่งการ์ดทดสอบ', r.test);
ok('ทดสอบบอทที่ยังไม่ตั้ง → LARK_NOT_SET ไม่ยิง', post({ token: T.adm, action: 'larkTest', bot: 'B' }).error === 'LARK_NOT_SET' && fetchLog.length === 1);
globalThis.__LARK_REPLY = () => ({ code: 200, body: { code: 19021, msg: 'sign match fail or timestamp is not within one hour from current time' } });
r = post({ token: T.adm, action: 'larkTest', bot: 'A' });
globalThis.__LARK_REPLY = null;
ok('Secret ผิด → บอกเหตุผลเป็นภาษาไทย (คัดลอก Secret ใหม่)', r.test && !r.test.ok && /Secret ไม่ตรง/.test(r.test.err) && r.bots.A.last.status === 'FAILED', r.test);

console.log('== 4) โหมด / trigger / ลบค่า ==');
ok('โหมดไม่ถูกต้อง → BAD_VALUE', post({ token: T.adm, action: 'larkMode', mode: 'yes' }).error === 'BAD_VALUE');
r = post({ token: T.adm, action: 'larkMode', mode: 'live' });
ok('เปิดส่งจริงได้เมื่อ Bot A ตั้งถูกต้อง', r.ok && r.mode === 'live' && props.LARK_MODE === 'live', r);
r = post({ token: T.adm, action: 'larkSave', bot: 'B', url: URL_B, secret: SEC_B });
ok('ตั้ง Bot B → ไม่ผ่าน A แล้ว', r.bots.B.urlSet && !r.bots.B.via && props.LARK_REMINDER_SECRET === SEC_B);
const QN = sheets['NotifyQueue'], nh = QN.rows[0], row = new Array(nh.length).fill('');
row[nh.indexOf('Id')] = 'N1'; row[nh.indexOf('Event')] = 'SLA_REMINDER'; row[nh.indexOf('Target')] = 'REMINDER'; row[nh.indexOf('Status')] = 'SENT'; row[nh.indexOf('SentAt')] = new Date(Date.now() + 1000).toISOString(); QN.rows.push(row);
r = post({ token: T.adm, action: 'larkStatus' });
ok('ส่งล่าสุดของ Reminder มาจากแท็บ NotifyQueue (งานค้างเกินกำหนด · ส่งสำเร็จ)', r.bots.B.last && r.bots.B.last.what === 'SLA_REMINDER' && r.bots.B.last.status === 'SENT' && /เกินกำหนด/.test(r.bots.B.last.whatTh), r.bots.B.last);
r = post({ token: T.adm, action: 'larkTriggers' });
ok('ติดตั้งตัวส่งอัตโนมัติจากหน้าเว็บ → larkFlush + larkSlaScan (ไม่ซ้อน)', r.ok && r.triggers.flush && r.triggers.sla && triggers.filter(t => t.getHandlerFunction() === 'larkFlush').length === 1, r.triggers);
post({ token: T.adm, action: 'larkTriggers' });
ok('กดซ้ำไม่สร้าง trigger ซ้อน', triggers.filter(t => t.getHandlerFunction() === 'larkFlush').length === 1);
r = post({ token: T.adm, action: 'larkClear', bot: 'A' });
ok('ลบค่า Bot A → ลบจาก Script Properties · โหมด live เหลือปัญหา "ยังไม่ได้ตั้ง"', !props.LARK_BOT_URL && !props.LARK_BOT_SECRET && r.problems.some(p => /LARK_BOT_URL/.test(p)), r.problems);
ok('เปิดส่งจริงไม่ได้ถ้า Bot A ยังไม่ตั้ง', post({ token: T.adm, action: 'larkMode', mode: 'dryrun' }).ok && post({ token: T.adm, action: 'larkMode', mode: 'live' }).error === 'LARK_NOT_READY');
ok('ค่าของ Bot B ไม่ถูกกระทบ', props.LARK_REMINDER_URL === URL_B && props.LARK_REMINDER_SECRET === SEC_B);
ok('ตลอดการทดสอบ ไม่มี Secret หลุดลงชีท', !sheetText().includes(SEC_B) && !sheetText().includes('NewSecretA2'));

console.log(fails ? fails + ' FAILED' : 'ALL v5.6 TESTS PASSED');
process.exit(fails ? 1 : 0);
