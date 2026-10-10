// v4.7 — Phase 5: Lark notification layer (dry-run)   รัน: node tests/test_v47.js $PWD [docs-out-dir]
// ทดสอบบนเครื่องเท่านั้น ห้าม deploy · ไม่มีการยิง HTTP ออกจริง (UrlFetchApp ถูกจำลองและบันทึกทุกคำขอ)
const fs = require('fs'), crypto = require('crypto');
const { makeRuntime } = require('./gasmock');
const DIR = process.argv[2] || '.', DOCS = process.argv[3] || '';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 400) : '')); if (!c) fails++; };
const H = s => crypto.createHash('sha256').update(s + 'mgs-internal-2025').digest('hex');

function world() {
  const rt = makeRuntime(DIR + '/Code.gs'), { ctx, sheets } = rt;
  const U = sheets['Users'], uh = U.rows[0], c = n => uh.indexOf(n);
  [['src', 'Chatraporn', 'Sourcing'], ['pm', 'Procure', 'Procurement Mgr'], ['bd', 'BD', 'BD Mgr'], ['gm', 'GM', 'GM'], ['boss', 'BOSS', 'Sales'], ['sales_non', 'NON', 'Sales']].forEach(([id, n, r]) => {
    const x = []; x[c('Id')] = id; x[c('Name')] = n; x[c('Role')] = r; x[c('Scope')] = 'all'; x[c('PassHash')] = H('pw123456'); x[c('Email')] = id + '@m.co'; U.rows.push(x); });
  const post = p => JSON.parse(ctx.apiPost(JSON.stringify(p)));
  const tok = u => post({ action: 'login', user: u, passHash: H('pw123456') }).token;
  const T = { src: tok('src'), pm: tok('pm'), bd: tok('bd'), gm: tok('gm'), boss: tok('boss'), non: tok('sales_non') };
  const Q = () => { const sh = sheets['NotifyQueue']; const h = sh.rows[0]; return sh.rows.slice(1).map(r => { const o = {}; h.forEach((k, i) => o[k] = r[i]); return o; }); };
  const saveQT = (id, status, extra) => post(Object.assign({ token: T.src, action: 'save', id, docType: 'QT', docNo: 'QT-' + id, title: 'Rooftop ' + id, customer: 'CP Group', sales: 'BOSS',
    salesUserId: 'boss', status, currency: 'THB', total: 270000, cost: 220000, profit: 50000, gp: 18.5, round: 1,
    detail: JSON.stringify({ id, docType: 'QT', status, approvalRoles: [], header: { currency: 'THB' }, lines: [{ up: 100, qty: 1 }] }),
    salesDetail: JSON.stringify({ id, status, total: 270000, header: { currency: 'THB' }, lines: [{ unitPrice: 270000, amount: 270000 }] }) }, extra || {}));
  return Object.assign(rt, { post, T, Q, saveQT });
}

/* ------------------------------------------------------------------ 1) ตาราง event */
console.log('== 1) ตาราง event / การตั้งค่า ==');
let W = world();
const EV = W.ctx.LARK_EVENTS;
ok('มีครบ 7 event ตามที่กำหนด', ['SR_SUBMITTED', 'QT_SUBMITTED', 'QT_APPROVED', 'QT_RETURNED', 'PRICE_RELEASED', 'SLA_BREACH', 'DAILY_DIGEST'].every(k => EV[k]));
ok('ทุก event ระบุ ผู้รับ / ข้อความ / เมื่อไร / ปุ่ม / กันซ้ำกี่นาที / สี', Object.values(EV).every(e => e.th && e.to && e.when && e.button && e.dedupMin > 0 && e.color));
let cfg = W.ctx.larkValidateConfig_();
ok('ไม่ตั้งอะไรเลย = โหมด dryrun (ปลอดภัย) และไม่ ready ที่จะส่งจริง', cfg.mode === 'dryrun' && cfg.ready === false && cfg.via === 'none', cfg);
W.props.LARK_MODE = 'LIVEE'; W.props.LARK_APP_ID = 'abc'; W.props.LARK_CHAT_SALES = 'xx'; W.props.LARK_WEBHOOK_URL = 'http://evil';
cfg = W.ctx.larkValidateConfig_();
ok('ตรวจค่าผิด: LARK_MODE ผิด / APP_ID ไม่ขึ้นต้น cli_ / ไม่ได้ตั้งคู่ secret / chat_id ไม่ใช่ oc_ / webhook ไม่ใช่ของ Lark',
  cfg.mode === 'dryrun' && cfg.problems.length >= 5, cfg.problems);
W.props.LARK_MODE = 'live'; W.props.LARK_APP_ID = 'cli_a1b2'; W.props.LARK_APP_SECRET = 'SuperSecretValue123'; W.props.LARK_CHAT_SALES = 'oc_sales1'; delete W.props.LARK_WEBHOOK_URL;
cfg = W.ctx.larkValidateConfig_();
ok('ผลตรวจไม่เปิดเผย secret / chat_id เต็ม', !JSON.stringify(cfg).includes('SuperSecretValue123') && !JSON.stringify(cfg).includes('oc_sales1'), cfg.targets);
ok('กลุ่มที่ยังไม่ตั้ง chat → เตือนว่าจะถูกข้าม', cfg.warnings.some(w => /LARK_CHAT_SOURCING/.test(w)));
ok('RELEASE ไม่ตั้ง = ใช้กลุ่ม SALES', W.ctx.larkChatOf_('RELEASE', W.props) === 'oc_sales1');
ok('setup() บันทึกผลตรวจการตั้งค่าใน Log', W.sheets['Log'].rows.some(r => /lark-config/.test(r.join(' '))));
const dg = W.ctx.diagHtml_();
ok('?diag=1 แสดงสถานะ Lark (โหมด + ปัญหา) โดยไม่มี secret', /Lark \(Lark\.gs v4\.7\)/.test(dg) && /โหมด <b>live<\/b>/.test(dg) && !dg.includes('SuperSecretValue123'));

/* ------------------------------------------------------------------ 2) จุดเชื่อม + กันซ้ำ */
console.log('== 2) event จากการทำงานจริง (โหมด dryrun) ==');
W = world();
let r = W.post({ token: W.T.boss, action: 'saveSR', id: 'SR1', status: 'Draft', detail: JSON.stringify({ status: 'Draft', header: { title: 'Factory', customer: 'CP' }, lines: [{ desc: 'Inv' }] }) });
ok('SR ร่าง → ไม่แจ้ง', r.ok && W.Q().length === 0, W.Q());
r = W.post({ token: W.T.boss, action: 'saveSR', id: 'SR1', status: 'Submitted', detail: JSON.stringify({ status: 'Submitted', header: { title: 'Factory', customer: 'CP', needBy: '2026-10-20' }, lines: [{ desc: 'Inv' }, { desc: 'Cable' }] }) });
let q = W.Q();
ok('SR ส่งจริง → SR_SUBMITTED ถึงทีม Sourcing 1 รายการ (สถานะ PENDING)', r.ok && q.length === 1 && q[0].Event === 'SR_SUBMITTED' && q[0].Target === 'SOURCING' && q[0].Status === 'PENDING', q);
const srCard = JSON.parse(q[0].Payload);
ok('การ์ด SR มีเลขเอกสาร / ลูกค้า / จำนวนรายการ / วันที่ต้องการ / ปุ่มลิงก์ตรงไปที่เอกสาร',
  /SR-/.test(srCard.card.header.title.content) && /CP/.test(srCard.text) && /2 รายการ/.test(srCard.text) && /2026-10-20/.test(srCard.text) &&
  srCard.card.elements.some(e => e.tag === 'action' && e.actions[0].url === 'https://script.google.com/macros/s/TEST/exec?app=index&doc=SR1'), srCard);
W.post({ token: W.T.boss, action: 'saveSR', id: 'SR1', status: 'Submitted', detail: JSON.stringify({ header: { title: 'Factory 2', customer: 'CP' }, lines: [] }) });
ok('แก้ SR ที่ส่งแล้ว (สถานะเดิม) → ไม่แจ้งซ้ำ', W.Q().length === 1);
r = W.saveQT('Q1', 'In Progress'); ok('QT กำลังทำราคา → ไม่แจ้ง', r.ok && W.Q().length === 1);
W.saveQT('Q1', 'Submitted'); q = W.Q();
const sub = q.find(x => x.Event === 'QT_SUBMITTED');
ok('ส่งขออนุมัติ → QT_SUBMITTED ถึงกลุ่มผู้อนุมัติ พร้อม %GP', sub && sub.Target === 'APPROVERS' && /%GP: 18\.5%/.test(JSON.parse(sub.Payload).text), sub);
ok('การ์ดผู้อนุมัติไม่มียอดต้นทุน/กำไรเป็นเงิน', !/220,000|50,000|ต้นทุน|กำไร/.test(sub.Payload));
W.saveQT('Q1', 'Submitted'); W.saveQT('Q1', 'In Progress'); q = W.Q();
ok('ส่งกลับแก้ (Submitted → In Progress) → QT_RETURNED ถึง Sourcing', q.some(x => x.Event === 'QT_RETURNED' && x.Target === 'SOURCING'));
W.saveQT('Q1', 'Submitted');
ok('ส่งขออนุมัติซ้ำภายใน 2 ชม. (รอบเดิม) → ไม่ส่งซ้ำ', W.Q().filter(x => x.Event === 'QT_SUBMITTED').length === 1);
W.saveQT('Q1', 'In Progress', { round: 2 }); W.saveQT('Q1', 'Submitted', { round: 2 });
ok('รอบใหม่ (R2) → แจ้งได้อีกครั้ง', W.Q().filter(x => x.Event === 'QT_SUBMITTED').length === 2);
r = W.post({ token: W.T.pm, action: 'approve', id: 'Q1' });
ok('อนุมัติฝ่ายเดียว (Partial) → ยังไม่แจ้ง', r.ok && r.status === 'Partial Approved' && !W.Q().some(x => x.Event === 'QT_APPROVED'));
r = W.post({ token: W.T.bd, action: 'approve', id: 'Q1' }); q = W.Q();
ok('อนุมัติครบ → QT_APPROVED ถึง Sourcing และผู้ปล่อยราคา (2 รายการ)', r.ok && r.status === 'Approved' && q.filter(x => x.Event === 'QT_APPROVED').map(x => x.Target).sort().join() === 'RELEASE,SOURCING');
r = W.post({ token: W.T.gm, action: 'release', id: 'Q1' }); q = W.Q();
const rel = q.find(x => x.Event === 'PRICE_RELEASED');
ok('ปล่อยราคา → PRICE_RELEASED ถึงทีมขาย ปุ่มเปิดในแอป Sales', r.ok && rel && rel.Target === 'SALES' && /app=sales&doc=Q1/.test(rel.Payload), rel);
ok('Price gate: การ์ดทีมขายไม่มี %GP / ต้นทุน / กำไร', !/GP|ต้นทุน|กำไร|220,000|50,000|18\.5/.test(rel.Payload), rel.Payload);
ok('การ์ดทีมขายใช้ยอดฉบับ Sales (฿270,000.00)', /฿270,000\.00/.test(rel.Payload));
ok('ธุรกรรมหลักไม่ยิง HTTP เลย (แค่เข้าคิว)', W.fetchLog.length === 0, W.fetchLog.length);

/* ------------------------------------------------------------------ 3) ส่งไม่สำเร็จต้องไม่ทำให้ธุรกรรมหลักล้ม */
console.log('== 3) ทนต่อความผิดพลาด ==');
const orig = W.ctx.larkBuild_; W.ctx.larkBuild_ = () => { throw new Error('boom in builder'); };
r = W.saveQT('Q2', 'Submitted');
ok('ตัวสร้างข้อความพัง → การบันทึกใบเสนอราคายังสำเร็จ', r.ok && W.sheets['Quotations'].rows.some(x => x.includes('Q2')), r);
ok('…และบันทึกปัญหาไว้ใน Log', W.sheets['Log'].rows.some(x => /lark-enqueue-error/.test(x.join(' ')) && /boom/.test(x.join(' '))));
W.ctx.larkBuild_ = orig;
const origSheet = W.ctx.sheet_; W.ctx.sheet_ = n => { if (n === 'NotifyQueue') throw new Error('sheet gone'); return origSheet(n); };
r = W.saveQT('Q3', 'Submitted'); W.ctx.sheet_ = origSheet;
ok('แท็บคิวเสียหาย → การบันทึกยังสำเร็จ', r.ok);
globalThis.__NO_LARK = true; const bare = makeRuntime(DIR + '/Code.gs'); globalThis.__NO_LARK = false;
ok('ไม่มีไฟล์ Lark.gs → Code.gs ทำงานได้ปกติ', typeof bare.ctx.larkOnStatus_ === 'undefined' && typeof bare.ctx.larkHook_ === 'function' && bare.ctx.larkHook_(null, {}, 2, 'a', 'b', null) === null);
W.props.LARK_MODE = 'off'; const n0 = W.Q().length; W.saveQT('Q4', 'Submitted');
ok('LARK_MODE=off → ไม่เข้าคิวเลย', W.Q().length === n0);
W.props.LARK_MODE = 'dryrun';
const evil = W.ctx.larkBuild_('QT_SUBMITTED', { id: 'X', docNo: 'QT-1', title: 'A <at user_id="all">ทุกคน</at>', customer: 'B\u0007C' }, 'APPROVERS', 'https://x/exec');
ok('กัน mention ทั้งกลุ่ม/อักขระควบคุมจากข้อความผู้ใช้', !/<at/.test(JSON.stringify(evil)) && !/\u0007/.test(JSON.stringify(evil)));

/* ------------------------------------------------------------------ 4) flush: dryrun */
console.log('== 4) ส่ง (flush) ==');
let f = W.ctx.larkFlush();
ok('dryrun: ทุกรายการเปลี่ยนเป็น DRYRUN และไม่มี HTTP สักครั้ง', f.dryrun > 0 && W.Q().every(x => ['DRYRUN', 'GROUPED', 'SKIPPED'].includes(x.Status)) && W.fetchLog.length === 0, f);
ok('dryrun ซ้ำ → ไม่มีอะไรค้าง', W.ctx.larkFlush().dryrun === 0);

/* ------------------------------------------------------------------ 5) live (จำลอง API) */
W = world();
Object.assign(W.props, { LARK_MODE: 'live', LARK_APP_ID: 'cli_a1', LARK_APP_SECRET: 's3cret', LARK_CHAT_SOURCING: 'oc_src', LARK_CHAT_APPROVERS: 'oc_apv', LARK_CHAT_SALES: 'oc_sales' });
W.saveQT('L1', 'Submitted'); W.post({ token: W.T.boss, action: 'saveSR', id: 'SRL', status: 'Submitted', detail: JSON.stringify({ header: { title: 't' }, lines: [] }) });
ok('live: ธุรกรรมหลักยังไม่ยิง HTTP', W.fetchLog.length === 0);
f = W.ctx.larkFlush();
const tokenCalls = W.fetchLog.filter(x => /tenant_access_token/.test(x.url)), msgCalls = W.fetchLog.filter(x => /im\/v1\/messages/.test(x.url));
ok('live: ขอ token 1 ครั้ง + ส่งข้อความทั้งชุดด้วย fetchAll', f.sent === 2 && tokenCalls.length === 1 && msgCalls.length === 2, f);
const body = JSON.parse(msgCalls[0].o.payload);
ok('คำขอ Bot API: chat_id ถูกกลุ่ม · msg_type interactive · uuid = Id ในคิว (กันส่งซ้ำฝั่ง Lark) · Bearer token',
  ['oc_apv', 'oc_src'].includes(body.receive_id) && body.msg_type === 'interactive' && W.Q().some(x => x.Id === body.uuid) && msgCalls[0].o.headers.Authorization === 'Bearer t-xyz' && !!JSON.parse(body.content).header, body);
ok('ส่งสำเร็จ → SENT + เวลา', W.Q().filter(x => x.Status === 'SENT').length === 2 && W.Q().every(x => x.SentAt));
W.ctx.larkFlush(); ok('token อยู่ใน cache (รอบถัดไปไม่ขอซ้ำ)', W.fetchLog.filter(x => /tenant_access_token/.test(x.url)).length === 1);
// ล้มเหลว → ลองใหม่ → FAILED
W.saveQT('L2', 'Submitted', { title: 'retry me' });
globalThis.__LARK_REPLY = u => ({ code: 500, body: { code: 99991400, msg: 'rate limit' } });
f = W.ctx.larkFlush(); let it = W.Q().find(x => x.DocId === 'L2');
ok('HTTP 500 → RETRY · Tries 1 · นัดใหม่อีก 1 นาที · เก็บข้อความ error', f.retry === 1 && it.Status === 'RETRY' && it.Tries === 1 && Date.parse(it.NextAt) - Date.now() > 50000 && /rate limit/.test(it.LastError), it);
ok('ยังไม่ถึงเวลา → ไม่ส่งซ้ำ', W.ctx.larkFlush().retry === 0);
const qs = W.sheets['NotifyQueue'], qh = qs.rows[0], rowL2 = qs.rows.find(x => x[qh.indexOf('DocId')] === 'L2');
for (let k = 0; k < 4; k++) { rowL2[qh.indexOf('NextAt')] = new Date(Date.now() - 1000).toISOString(); W.ctx.larkFlush(); }
it = W.Q().find(x => x.DocId === 'L2');
ok('ลองครบ 5 ครั้ง → FAILED + บันทึก lark-failed ใน Log (ไม่ลองต่อไม่รู้จบ)', it.Status === 'FAILED' && it.Tries === 5 && W.sheets['Log'].rows.some(x => /lark-failed/.test(x.join(' '))), it);
globalThis.__LARK_REPLY = null;
// กลุ่มที่ยังไม่ตั้ง chat ใน live → SKIPPED
delete W.props.LARK_CHAT_SALES;
W.saveQT('L3', 'Approved');
ok('live + ยังไม่ตั้งกลุ่ม → รายการของกลุ่มนั้น SKIPPED พร้อมเหตุผล (กลุ่มอื่นยังส่ง)', W.Q().some(x => x.DocId === 'L3' && x.Target === 'RELEASE' && x.Status === 'SKIPPED' && /LARK_CHAT_RELEASE/.test(x.LastError)) && W.Q().some(x => x.DocId === 'L3' && x.Target === 'SOURCING' && x.Status === 'PENDING'));
// ตั้งค่าผิดตอน live → ไม่ส่ง แต่ลองใหม่
W.props.LARK_APP_ID = 'bad'; f = W.ctx.larkFlush();
ok('live แต่ตั้งค่าผิด → ไม่ยิง · RETRY พร้อมบอกว่าตั้งค่าอะไรผิด', f.retry >= 1 && W.Q().some(x => /ตั้งค่าไม่ครบ/.test(x.LastError)));

/* ------------------------------------------------------------------ 6) webhook (ข้อความธรรมดา + ลายเซ็น) */
W = world();
Object.assign(W.props, { LARK_MODE: 'live', LARK_WEBHOOK_URL: 'https://open.larksuite.com/open-apis/bot/v2/hook/abc-123', LARK_WEBHOOK_SECRET: 'whsec' });
W.saveQT('W1', 'Submitted'); W.ctx.larkFlush();
const wh = W.fetchLog.find(x => /bot\/v2\/hook/.test(x.url)), wb = wh && JSON.parse(wh.o.payload);
const expectSign = wb && crypto.createHmac('sha256', wb.timestamp + '\nwhsec').update('').digest('base64');
ok('webhook: ส่งเฉพาะข้อความธรรมดา (msg_type text) ไม่มีการ์ด', wb && wb.msg_type === 'text' && /ผู้อนุมัติราคา/.test(wb.content.text) && !wb.card, wb);
ok('webhook: ลายเซ็นตรงตามสูตรของ Lark', wb && wb.sign === expectSign, wb && [wb.sign, expectSign]);

/* ------------------------------------------------------------------ 7) SLA + สรุปประจำวัน */
console.log('== 7) SLA / สรุปประจำวัน ==');
W = world();
W.saveQT('S1', 'Submitted'); W.saveQT('S2', 'Submitted'); W.saveQT('S3', 'In Progress');
const QS = W.sheets['Quotations'], qhh = QS.rows[0];
const age = (id, days) => { const row = QS.rows.find(x => x[qhh.indexOf('Id')] === id); const d = JSON.parse(row[qhh.indexOf('Detail')]); const at = new Date(Date.now() - days * 86400000).toISOString(); d.statusChangedAt = at; d.statusLog = [{ s: d.status, at }]; row[qhh.indexOf('Detail')] = JSON.stringify(d); };
age('S1', 12); age('S2', 9); age('S3', 1);
let s1 = W.ctx.larkSlaScan(); q = W.Q().filter(x => x.Event === 'SLA_BREACH' && x.Status === 'PENDING');
ok('งานเกินกำหนด 2 งาน (กลุ่มผู้อนุมัติ) → รวมเป็นการ์ดเดียว', s1.newBreaches === 2 && q.length === 1 && q[0].Target === 'APPROVERS', [s1, q.map(x => x.Title)]);
const slaText = JSON.parse(q[0].Payload).text;
ok('การ์ด SLA เรียงรอนานสุดก่อน (S1 ก่อน S2) และบอกจำนวนวัน', slaText.indexOf('QT-S1') >= 0 && slaText.indexOf('QT-S1') < slaText.indexOf('QT-S2') && /วัน\)/.test(slaText), slaText);
ok('งานที่ยังไม่เกิน (S3) ไม่อยู่ในการ์ด', !/QT-S3/.test(slaText));
W.ctx.larkSlaScan();
ok('ตรวจซ้ำชั่วโมงถัดไป → ไม่แจ้งงานเดิมซ้ำ', W.Q().filter(x => x.Event === 'SLA_BREACH' && x.Status === 'PENDING').length === 1);
// วันทำการ/วันหยุด: ใช้เวลาจำลอง (วันนี้ +/- n วัน) ให้เทสต์ผลเหมือนกันทุกวัน
const dayOf = ms => new Date(ms + 7 * 3600000).getUTCDay();
let wkMs = Date.now(); while ([0, 6].includes(dayOf(wkMs))) wkMs -= 86400000;
let weMs = Date.now(); while (dayOf(weMs) !== 6) weMs += 86400000;
ok('วันหยุด (เสาร์) → ไม่ส่งสรุป', W.ctx.larkDailyDigest({ nowMs: weMs }).skipped === 'weekend');
W.ctx.larkDailyDigest({ nowMs: wkMs }); q = W.Q().filter(x => x.Event === 'DAILY_DIGEST');
ok('สรุปประจำวัน: 1 การ์ดต่อกลุ่มที่มีงานค้าง (Sourcing + ผู้อนุมัติ)', q.map(x => x.Target).sort().join() === 'APPROVERS,SOURCING', q.map(x => x.Target));
ok('สรุปประจำวันบอกจำนวน เกินกำหนด / เฝ้าระวัง', /เกินกำหนด: 2 งาน/.test(JSON.parse(q.find(x => x.Target === 'APPROVERS').Payload).text));
W.ctx.larkDailyDigest({ nowMs: wkMs });
ok('รันซ้ำวันเดียวกัน → ไม่ส่งซ้ำ', W.Q().filter(x => x.Event === 'DAILY_DIGEST').length === 2);
ok('trigger ส่ง event object (ไม่มี nowMs) → ใช้เวลาจริง ไม่พัง', (() => { const x = W.ctx.larkDailyDigest({ authMode: 'FULL', triggerUid: '1' }); return !!x && !x.error; })());

/* ------------------------------------------------------------------ 8) trigger + เครื่องมือ admin */
W.ctx.larkInstallTriggers(); W.ctx.larkInstallTriggers();
ok('ติดตั้ง trigger ซ้ำได้ ไม่ซ้อน (3 ตัว)', W.triggers.length === 3 && W.triggers.map(t => t.getHandlerFunction()).sort().join() === 'larkDailyDigest,larkFlush,larkSlaScan');
const demo = W.ctx.larkDryRunDemo();
ok('larkDryRunDemo(): ตัวอย่างครบทุก event ไม่เขียนชีท ไม่ยิง HTTP', demo.length === 8 && new Set(demo.map(d => d.event)).size === 7 && W.fetchLog.length === 0);
ok('NotifyQueue เป็นแท็บใหม่ — header ชีทเดิมไม่เปลี่ยน', JSON.stringify(W.ctx.HEADERS.NotifyQueue) === JSON.stringify(['Id','Event','DocId','DedupKey','Target','Title','Payload','Status','Tries','NextAt','CreatedAt','SentAt','LastError']) &&
  JSON.stringify(W.ctx.HEADERS.Quotations.slice(0, 3)) === '["Id","DocType","DocNo"]' && W.ctx.HEADERS.Quotations.length === 35);
const larkSrc = fs.readFileSync(DIR + '/Lark.gs', 'utf8');
ok('ไม่มี secret/chat id ฝังในโค้ด', !/cli_[A-Za-z0-9]{6,}|oc_[A-Za-z0-9]{6,}|hook\/[A-Za-z0-9-]{8,}/.test(larkSrc));
ok('HTTP ใช้ fetchAll ทั้งชุด (ไม่มี UrlFetchApp.fetch ในลูปส่งข้อความ)', (larkSrc.match(/UrlFetchApp\.fetch\(/g) || []).length === 1 && /UrlFetchApp\.fetchAll\(/.test(larkSrc));

if (DOCS) {     // ส่งมอบ: ตัวอย่าง payload การ์ดจริงของทุก event
  fs.writeFileSync(DOCS + '/lark_payload_samples.json', JSON.stringify(demo, null, 2));
  console.log('wrote ' + DOCS + '/lark_payload_samples.json');
}
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL v4.7 LARK TESTS PASSED'); process.exit(fails ? 1 : 0);
