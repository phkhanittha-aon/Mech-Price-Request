// v5.8 — การ์ดเตือนงานเกินกำหนด (Reminder) วันละรอบเดียว จ.–ศ. · ตั้งเวลาได้ (Admin / GM)
// รัน: node tests/test_v58.js $PWD   (ทดสอบบนเครื่องเท่านั้น ห้าม deploy)
const crypto = require('crypto');
const { makeRuntime } = require('./gasmock');
const DIR = process.argv[2] || '.';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 400) : '')); if (!c) fails++; };
const H = s => crypto.createHash('sha256').update(s + 'mgs-internal-2025').digest('hex');
const { ctx, sheets, props, fetchLog } = makeRuntime(DIR + '/Code.gs');
const U = sheets['Users'], uh = U.rows[0], c = n => uh.indexOf(n);
[['adm', 'Admin', 'Admin', 'adm@m.co'], ['pm', 'Procure', 'Procurement Mgr', 'pm@m.co'], ['bd', 'BD', 'BD Mgr', 'bd@m.co'], ['src', 'Chatraporn', 'Sourcing', 'src@m.co'], ['boss', 'BOSS', 'Sales', 'boss@m.co']]
  .forEach(([id, n, r, e]) => { const x = []; x[c('Id')] = id; x[c('Name')] = n; x[c('Role')] = r; x[c('Scope')] = 'all'; x[c('PassHash')] = H('pw123456'); x[c('Email')] = e; U.rows.push(x); });
const post = p => JSON.parse(ctx.apiPost(JSON.stringify(p)));
const T = {}; ['adm', 'pm', 'src'].forEach(u => { T[u] = post({ action: 'login', user: u, passHash: H('pw123456') }).token; });
const HK = s => 'https://open.larksuite.com/open-apis/bot/v2/hook/' + s;
Object.assign(props, { LARK_MODE: 'live', LARK_BOT_URL: HK('botA-1111'), LARK_REMINDER_URL: HK('botB-2222') });
const QS = sheets['Quotations'], qh = QS.rows[0];
const saveQT = (id) => post({ token: T.src, action: 'save', id, docType: 'QT', docNo: 'QT-' + id, title: id, customer: 'CP', salesUserId: 'boss', assignedTo: 'src', status: 'Submitted',
  detail: JSON.stringify({ id, docType: 'QT', status: 'Submitted', approvalRoles: [], header: { currency: 'THB', groupType: 'Inverter' }, lines: [{ up: 1, qty: 1 }] }) });
const age = (id, days) => { const row = QS.rows.find(x => x[qh.indexOf('Id')] === id); const d = JSON.parse(row[qh.indexOf('Detail')]); const at = new Date(Date.now() - days * 86400000).toISOString(); d.statusChangedAt = at; d.statusLog = [{ s: d.status, at }]; row[qh.indexOf('Detail')] = JSON.stringify(d); };
saveQT('A'); saveQT('B'); age('A', 12); age('B', 9);
const reminders = () => sheets['NotifyQueue'].rows.slice(1).filter(r => r[sheets['NotifyQueue'].rows[0].indexOf('Event')] === 'SLA_REMINDER');
const bkk = ms => new Date(ms + 7 * 3600000);
let wk = Date.now() + 86400000; while ([0, 6].includes(bkk(wk).getUTCDay())) wk += 86400000;
const at = (base, hh, mm) => { const d = bkk(base); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hh, mm) - 7 * 3600000; };
delete props.LARK_REMIND_DAY; fetchLog.length = 0;

console.log('== 1) วันละรอบ (ค่าเริ่มต้น 09:00) ==');
let r = ctx.larkSlaScan({ nowMs: at(wk, 8, 40) });
ok('08:40 (ก่อนเวลารอบ) → ยังไม่เตือน', r.skipped === 'before-remind-hour' && reminders().length === 0, r);
r = ctx.larkSlaScan({ nowMs: at(wk, 9, 5) });
ok('09:05 รอบแรกของวัน → เตือนทุกงานที่เกินกำหนดพร้อมกัน (2 ใบ) · ส่งทันทีผ่าน Reminder', r.reminded === 2 && reminders().length === 2 && fetchLog.length === 2 && fetchLog.every(x => x.url === HK('botB-2222')), [r, fetchLog.length]);
saveQT('C'); age('C', 8); fetchLog.length = 2;   // การ์ด "ส่งขออนุมัติ" ของ C ส่งทันที (v5.7) — นับเฉพาะการ์ดเตือน
for (const hh of [10, 11, 13, 15, 17]) { const x = ctx.larkSlaScan({ nowMs: at(wk, hh, 5) }); if (hh < 17 && x.skipped !== 'already-today') ok(hh + ':05 ต้องข้าม', false, x); }
ok('ชั่วโมงอื่นของวันเดียวกัน → ไม่เตือนเลย (แม้มีงานใหม่เพิ่งเกินกำหนด C)', reminders().length === 2 && fetchLog.length === 2, reminders().length);
let nx = wk + 86400000; while ([0, 6].includes(bkk(nx).getUTCDay())) nx += 86400000;
r = ctx.larkSlaScan({ nowMs: at(nx, 9, 10) });
ok('วันทำการถัดไป 09:10 → เตือนรอบใหม่ (A, B, C = 3 ใบ)', r.reminded === 3 && reminders().length === 5, r);
let sat = Date.now(); while (bkk(sat).getUTCDay() !== 6) sat += 86400000;
ok('วันเสาร์ → ไม่เตือน', ctx.larkSlaScan({ nowMs: at(sat, 9, 10) }).skipped === 'outside-working-hours');
ok('trigger ส่ง event object (เวลาจริง) → ไม่พัง', (() => { const x = ctx.larkSlaScan({ authMode: 'FULL' }); return !!x && !x.error; })());

console.log('== 2) ตั้งเวลารอบเตือน ==');
ok('Sourcing Manager ตั้งไม่ได้ (Admin / GM เท่านั้น)', post({ token: T.pm, action: 'larkRemindHour', hour: 10 }).error === 'ACCESS_DENIED');
ok('เวลานอกช่วง 8–16 → BAD_VALUE', post({ token: T.adm, action: 'larkRemindHour', hour: 18 }).error === 'BAD_VALUE' && post({ token: T.adm, action: 'larkRemindHour', hour: 'x' }).error === 'BAD_VALUE');
r = post({ token: T.adm, action: 'larkRemindHour', hour: 13 });
ok('ตั้ง 13:00 → บันทึกใน Script Properties · สถานะบอกเวลา + รอบล่าสุด', r.ok && props.LARK_REMIND_HOUR === '13' && r.remindHour === 13 && !!r.remindDay, [r.remindHour, r.remindDay]);
let nx2 = nx + 86400000; while ([0, 6].includes(bkk(nx2).getUTCDay())) nx2 += 86400000;
ok('ตั้ง 13:00 แล้ว: 09:10 ยังไม่เตือน · 13:05 เตือน', ctx.larkSlaScan({ nowMs: at(nx2, 9, 10) }).skipped === 'before-remind-hour' && ctx.larkSlaScan({ nowMs: at(nx2, 13, 5) }).reminded === 3);
const fz = ctx.larkSlaScan({ nowMs: at(nx2, 14, 0), force: true });
ok('ปุ่ม/เทสต์ force → ข้ามเวลาและวัน (ใช้ทดสอบ) · งานเดิมวันเดียวกันไม่ซ้ำ', typeof fz.skipped !== 'string' && fz.overdue === 3 && fz.reminded === 0, fz);

console.log(fails ? fails + ' FAILED' : 'ALL v5.8 TESTS PASSED');
process.exit(fails ? 1 : 0);
