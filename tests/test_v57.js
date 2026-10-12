// v5.7 — การ์ด Lark ถูกปฏิเสธทั้งใบเพราะ @อีเมลที่ไม่ใช่บัญชี Lark (code 11246 · ErrCode 100290) → ส่งซ้ำแบบไม่แท็ก · ตรวจอีเมลทีละคน
// รัน: node tests/test_v57.js $PWD   (ทดสอบบนเครื่องเท่านั้น ห้าม deploy)
const crypto = require('crypto');
const { makeRuntime } = require('./gasmock');
const DIR = process.argv[2] || '.';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 500) : '')); if (!c) fails++; };
const H = s => crypto.createHash('sha256').update(s + 'mgs-internal-2025').digest('hex');
const { ctx, sheets, props, fetchLog } = makeRuntime(DIR + '/Code.gs');
const U = sheets['Users'], uh = U.rows[0], c = n => uh.indexOf(n);
[['adm', 'Khanittha', 'Admin', 'khanittha.pho@mglobalsourcing.net'], ['pm', 'Procure', 'Procurement Mgr', 'pm@mglobalsourcing.net'],
 ['src', 'Chatraporn', 'Sourcing', 'chatraporn@gmail.com'], ['boss', 'BOSS', 'Sales', 'boss@mglobalsourcing.net'], ['kong', 'Kong', 'Sales', '']]
  .forEach(([id, n, r, e]) => { const x = []; x[c('Id')] = id; x[c('Name')] = n; x[c('Role')] = r; x[c('Scope')] = 'all'; x[c('PassHash')] = H('pw123456'); x[c('Email')] = e; U.rows.push(x); });
const post = p => JSON.parse(ctx.apiPost(JSON.stringify(p)));
const T = {}; ['adm', 'pm', 'boss'].forEach(u => { T[u] = post({ action: 'login', user: u, passHash: H('pw123456') }).token; });
const URL_A = 'https://open.larksuite.com/open-apis/bot/v2/hook/aaaa1111-bbbb-2222-cccc-3333dddd52e1';
props.LARK_BOT_URL = URL_A; props.LARK_BOT_SECRET = 'SecA'; props.LARK_MODE = 'live';
// Lark จริง: อีเมล gmail ไม่ใช่บัญชีในองค์กร → ปฏิเสธการ์ดทั้งใบ (ข้อความเดียวกับในแท็บ NotifyQueue ของ Aon)
const NOT_LARK = ['chatraporn@gmail.com'];
const REJECT = { code: 200, body: { code: 11246, msg: 'create card content failed: ErrCode: 100290; ErrMsg: There is an invalid user resource(at/person) in your card, please check whether the user ID value used in the at person, person and other components in the card is correct' } };
globalThis.__LARK_REPLY = (url, o) => { const s = String(o && o.payload || ''); return NOT_LARK.some(e => s.includes('<at email=' + e)) ? REJECT : { code: 200, body: { code: 0, msg: 'success' } }; };
const QN = sheets['NotifyQueue'], nh = QN.rows[0], col = h => nh.indexOf(h);
const rows = () => QN.rows.slice(1);

console.log('== 1) การ์ดที่แท็กอีเมลไม่ใช่บัญชี Lark ==');
// SR ส่งถึง Chatraporn (อีเมล gmail) → การ์ดแท็ก chatraporn@gmail.com · v5.7 ส่งทันทีในคำขอเดียวกับการบันทึก
fetchLog.length = 0;
const t0 = Date.now();
post({ token: T.boss, action: 'saveSR', id: 'SR1', status: 'Submitted', detail: JSON.stringify({ status: 'Submitted', header: { title: 'Factory', customer: 'CP', groupType: 'Inverter' }, lines: [{ desc: 'Inverter', group: 'INVERTER', qty: 1 }] }) });
ok('มีการ์ดเข้าคิว และในการ์ดแท็ก chatraporn@gmail.com', rows().length === 1 && rows()[0][col('Payload')].includes('<at email=chatraporn@gmail.com>'), rows().map(r => r[col('Status')]));
const st1 = rows()[0][col('Status')], err1 = rows()[0][col('LastError')];
ok('ส่งทันทีตอนบันทึก (ไม่รอ trigger 5 นาที) · เดิม RETRY ตลอด → ตอนนี้ SENT', st1 === 'SENT' && rows()[0][col('SentAt')] && Date.parse(rows()[0][col('SentAt')]) - t0 < 5000, [st1, err1]);
ok('trigger รอบถัดไปไม่ส่งซ้ำ', ctx.larkFlush().sent === 0);
ok('ส่ง 2 ครั้ง: ครั้งแรกถูกปฏิเสธ ครั้งที่สองไม่มี @แท็กเลย', fetchLog.length === 2 && /<at email/.test(fetchLog[0].o.payload) && !/<at email/.test(fetchLog[1].o.payload), fetchLog.map(x => x.o.payload.slice(0, 80)));
ok('การ์ดที่ส่งแทนแสดงชื่อคนแทนการแท็ก (Chatraporn / BOSS)', /Chatraporn/.test(fetchLog[1].o.payload) && /BOSS/.test(fetchLog[1].o.payload));
ok('LastError บอกว่าส่งแบบไม่แท็ก + อีเมลในการ์ด (อยู่ในชีท ไม่ออกกลุ่ม)', /ส่งแล้วแบบไม่แท็ก/.test(err1) && err1.includes('chatraporn@gmail.com') && !/@/.test(JSON.parse(fetchLog[1].o.payload).card ? '' : 'x'), err1);
ok('อีเมลไม่หลุดออกไปในการ์ดที่ส่งแทน', !fetchLog[1].o.payload.includes('chatraporn@gmail.com') && !fetchLog[1].o.payload.includes('boss@mglobalsourcing.net'));

console.log('== 2) แถวที่ค้าง RETRY จากรุ่นเดิม (เหมือนในชีทของ Aon) ==');
const r2 = rows()[0].slice(); r2[col('Id')] = 'OLD1'; r2[col('Status')] = 'RETRY'; r2[col('Tries')] = 1; r2[col('NextAt')] = new Date(Date.now() - 1000).toISOString(); r2[col('SentAt')] = ''; r2[col('LastError')] = REJECT.body.msg.slice(0, 100);
QN.rows.push(r2); fetchLog.length = 0;
ctx.larkFlush();
ok('รอบส่งถัดไปส่งแถวเก่าสำเร็จเอง (ไม่ต้องแก้ชีท)', QN.rows.find(r => r[col('Id')] === 'OLD1')[col('Status')] === 'SENT' && fetchLog.length === 2);
globalThis.__LARK_REPLY = () => ({ code: 200, body: { code: 19021, msg: 'sign match fail or timestamp is not within one hour from current time' } });
const r3 = rows()[0].slice(); r3[col('Id')] = 'SIG1'; r3[col('Status')] = 'PENDING'; r3[col('Tries')] = 0; r3[col('NextAt')] = new Date(Date.now() - 1000).toISOString(); QN.rows.push(r3); fetchLog.length = 0;
ctx.larkFlush();
const sig = QN.rows.find(r => r[col('Id')] === 'SIG1');
ok('error อื่น (Secret ผิด) ยังเป็น RETRY ตามเดิม · ไม่ส่งซ้ำแบบไม่แท็ก', sig[col('Status')] === 'RETRY' && /Secret ไม่ตรง/.test(sig[col('LastError')]) && fetchLog.length === 1, [sig[col('Status')], fetchLog.length]);

console.log('== 3) ส่งการ์ดทดสอบจากหน้าตั้งค่า ==');
globalThis.__LARK_REPLY = (url, o) => { const s = String(o && o.payload || ''); return /<at email=khanittha/.test(s) ? REJECT : { code: 200, body: { code: 0, msg: 'success' } }; };
let r = post({ token: T.adm, action: 'larkTest', bot: 'A' });
ok('อีเมลของคนกดไม่ใช่บัญชี Lark → ยังส่งถึงกลุ่ม (Webhook ใช้ได้) และบอกว่าไม่ได้แท็ก', r.test && r.test.ok && r.test.noTag && /ไม่ใช่บัญชี Lark/.test(r.test.err) && r.bots.A.last.status === 'SENT', r.test);

console.log('== 4) ส่งทันที: สวิตช์ / โหมด ==');
globalThis.__LARK_REPLY = null;
const save2 = (id) => post({ token: T.boss, action: 'saveSR', id, status: 'Submitted', detail: JSON.stringify({ status: 'Submitted', header: { title: 'P ' + id, customer: 'CP', groupType: 'Inverter' }, lines: [{ desc: 'x', qty: 1 }] }) });
const stOf = id => QN.rows.find(x => x[col('DocId')] === id);
props.LARK_SEND_NOW = 'off'; fetchLog.length = 0; save2('SR2');
ok('LARK_SEND_NOW=off → เข้าคิวรอ trigger (แบบเดิม)', stOf('SR2')[col('Status')] === 'PENDING' && fetchLog.length === 0);
delete props.LARK_SEND_NOW; props.LARK_MODE = 'dryrun'; fetchLog.length = 0; save2('SR3');
ok('โหมดทดสอบ → ไม่ยิงตอนบันทึก (คงเป็น PENDING ให้ trigger เปลี่ยนเป็น DRYRUN)', stOf('SR3')[col('Status')] === 'PENDING' && fetchLog.length === 0);
props.LARK_MODE = 'live';
globalThis.__LARK_REPLY = () => { throw new Error('Address unavailable'); };
const sv = save2('SR4');
ok('Lark ล่ม/เน็ตหลุดตอนส่งทันที → การบันทึก SR ยังสำเร็จ · การ์ดค้าง RETRY ให้ trigger ลองใหม่', sv.ok !== false && stOf('SR4')[col('Status')] === 'RETRY', [sv.ok, stOf('SR4')[col('Status')]]);
globalThis.__LARK_REPLY = null;

console.log('== 5) ตรวจอีเมลทีละคน ==');
globalThis.__LARK_REPLY = (url, o) => { const s = String(o && o.payload || ''); return NOT_LARK.some(e => s.includes('<at email=' + e)) ? REJECT : { code: 200, body: { code: 0, msg: 'success' } }; };
ok('Sourcing Manager ใช้ไม่ได้ (Admin / GM เท่านั้น)', post({ token: T.pm, action: 'larkCheckEmails' }).error === 'ACCESS_DENIED');
fetchLog.length = 0;
r = post({ token: T.adm, action: 'larkCheckEmails' });
const by = {}; (r.emails || []).forEach(x => { by[x.name] = x.result; });
ok('ผล: Chatraporn = ไม่ใช่บัญชี Lark · Kong = ไม่มีอีเมล · คนอื่นแท็กได้', by.Chatraporn === 'NOT_LARK' && by.Kong === 'NO_EMAIL' && by.Khanittha === 'OK' && by.BOSS === 'OK' && by.Procure === 'OK', r.emails);
ok('ส่งครั้งเดียวแบบ fetchAll · 1 การ์ดต่อคนที่มีอีเมล · การ์ดแท็กแค่คนนั้น', fetchLog.length === 4 && fetchLog.every(x => (x.o.payload.match(/<at email=/g) || []).length === 1), fetchLog.length);
ok('ตรวจโดยยังไม่ตั้งบอท → LARK_NOT_SET', (() => { delete props.LARK_BOT_URL; const x = post({ token: T.adm, action: 'larkCheckEmails' }); props.LARK_BOT_URL = URL_A; return x.error === 'LARK_NOT_SET'; })());
globalThis.__LARK_REPLY = null;

console.log(fails ? fails + ' FAILED' : 'ALL v5.7 TESTS PASSED');
process.exit(fails ? 1 : 0);
