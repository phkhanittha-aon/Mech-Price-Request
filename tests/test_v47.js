// v5.0 — Lark กลุ่มเดียวแบบ Food Price Request (Bot A ทุกขั้นตอน + Bot B เตือนเกินกำหนด)   รัน: node tests/test_v47.js $PWD [docs-out-dir]
// ทดสอบบนเครื่องเท่านั้น ห้าม deploy · ไม่มีการยิง HTTP ออกจริง (UrlFetchApp ถูกจำลองและบันทึกทุกคำขอ)
// ไฟล์นี้เดิมทดสอบ Lark v4.7–v4.9 (แยกหลายกลุ่ม) — v5.0 เปลี่ยนโครงสร้างตามที่ผู้ใช้เลือก ("กลุ่มเดียวทุกคนแบบ Food")
// ทุกหัวข้อเดิมยังถูกทดสอบในรูปแบบใหม่ (ดูตารางเทียบใน CHANGELOG_v4.1.md หัวข้อ v5.0)
const fs = require('fs'), crypto = require('crypto');
const { makeRuntime } = require('./gasmock');
const DIR = process.argv[2] || '.', DOCS = process.argv[3] || '';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 500) : '')); if (!c) fails++; };
const H = s => crypto.createHash('sha256').update(s + 'mgs-internal-2025').digest('hex');
const HK = n => 'https://open.larksuite.com/open-apis/bot/v2/hook/' + n;

function world() {
  const rt = makeRuntime(DIR + '/Code.gs'), { ctx, sheets } = rt;
  const U = sheets['Users'], uh = U.rows[0], c = n => uh.indexOf(n);
  const mount = JSON.stringify(['MOUNTING', 'Carport', 'DC CABLE']), exceptMount = JSON.stringify(['INVERTER', 'BATTERY', 'Energy storage', 'EV Charger', 'Walkway', 'CONNECTOR']);
  [['src', 'Chatraporn', 'Sourcing', exceptMount], ['src2', 'Napasorn', 'Sourcing', mount], ['pm', 'Procure', 'Sourcing Manager', 'all'], ['bd', 'BD', 'BD Mgr', 'all'],
   ['gm', 'GM', 'GM', 'all'], ['boss', 'BOSS', 'Sales', 'all'], ['sales_non', 'NON', 'Sales', 'all']].forEach(([id, n, r, sc]) => {
    const x = []; x[c('Id')] = id; x[c('Name')] = n; x[c('Role')] = r; x[c('Scope')] = sc; x[c('PassHash')] = H('pw123456'); x[c('Email')] = id + '@m.co'; U.rows.push(x); });
  const post = p => JSON.parse(ctx.apiPost(JSON.stringify(p)));
  const tok = u => post({ action: 'login', user: u, passHash: H('pw123456') }).token;
  const T = { src: tok('src'), src2: tok('src2'), pm: tok('pm'), bd: tok('bd'), gm: tok('gm'), boss: tok('boss'), non: tok('sales_non') };
  const Q = () => { const sh = sheets['NotifyQueue']; const h = sh.rows[0]; return sh.rows.slice(1).map(r => { const o = {}; h.forEach((k, i) => o[k] = r[i]); return o; }); };
  const saveQT = (id, status, extra) => post(Object.assign({ token: T.src, action: 'save', id, docType: 'QT', docNo: 'QT-' + id, title: 'Rooftop ' + id, customer: 'CP Group', sales: 'BOSS',
    salesUserId: 'boss', assignedTo: 'src', status, currency: 'THB', total: 270000, cost: 220000, profit: 50000, gp: 18.5, round: 1,
    detail: JSON.stringify({ id, docType: 'QT', status, approvalRoles: [], header: { currency: 'THB' }, lines: [{ code: 'SG110CX', desc: 'Inverter 110kW', qty: 9, uom: 'pcs', up: 100 }] }),
    salesDetail: JSON.stringify({ id, status, total: 270000, header: { currency: 'THB' }, lines: [{ unitPrice: 270000, amount: 270000 }] }) }, extra || {}));
  const saveSR = (id, status, header, lines, tokenKey) => post({ token: T[tokenKey || 'boss'], action: 'saveSR', id, status,
    detail: JSON.stringify({ status, header: Object.assign({ title: 'Factory', customer: 'CP' }, header || {}), lines: lines || [{ desc: 'Inv', qty: 2, uom: 'set' }] }) });
  const card = x => JSON.parse(x.Payload);
  return Object.assign(rt, { post, T, Q, saveQT, saveSR, card });
}
const flat = o => JSON.stringify(o).replace(/\\n/g, '\n');

/* ------------------------------------------------------------------ 1) ตาราง event / การตั้งค่า */
console.log('== 1) ตาราง event / การตั้งค่า ==');
let W = world();
const EV = W.ctx.LARK_EVENTS;
ok('มีครบ 10 event: ทุกขั้นตอนคำขอราคา (9) + เตือนเกินกำหนด (1)', ['SR_SUBMITTED', 'SR_FORWARDED', 'SR_ACCEPTED', 'SR_CANCELLED', 'QT_SUBMITTED', 'QT_PARTIAL_APPROVED', 'QT_APPROVED', 'QT_RETURNED', 'PRICE_RELEASED', 'SLA_REMINDER'].every(k => EV[k]) && Object.keys(EV).length === 10);
ok('ทุก event ระบุ บอท / ข้อความ / เมื่อไร / ใครถูกแท็ก / กันซ้ำกี่นาที / สี', Object.values(EV).every(e => e.th && e.when && (e.bot === 'A' || e.bot === 'B') && ['actor', 'requester', 'pricer'].includes(e.mention) && e.dedupMin > 0 && e.color));
ok('ไม่มีแจ้งเตือน follow-up ของ Sales / สรุปประจำวัน (v5.0 ตามที่ผู้ใช้กำหนด)', !EV.DAILY_DIGEST && !Object.keys(EV).some(k => /FOLLOW|DIGEST/.test(k)) && W.ctx.larkDailyDigest().disabled === true);
ok('Bot B (เตือน) ใช้กับงานเกินกำหนดเท่านั้น', Object.entries(EV).filter(([, e]) => e.bot === 'B').map(([k]) => k).join() === 'SLA_REMINDER');
let cfg = W.ctx.larkValidateConfig_();
ok('ไม่ตั้งอะไรเลย = โหมด dryrun (ปลอดภัย) และไม่ ready ที่จะส่งจริง', cfg.mode === 'dryrun' && cfg.ready === false && cfg.via === 'none', cfg);
Object.assign(W.props, { LARK_MODE: 'LIVEE', LARK_BOT_URL: 'http://evil', LARK_REMINDER_URL: 'https://example.com/hook/x', LARK_BOT_SECRET: 'has space' });
cfg = W.ctx.larkValidateConfig_();
ok('ตรวจค่าผิด: LARK_MODE ผิด / webhook ไม่ใช่ของ Lark (2 ตัว) / secret มีช่องว่าง', cfg.mode === 'dryrun' && cfg.problems.length >= 4, cfg.problems);
Object.assign(W.props, { LARK_MODE: 'live', LARK_BOT_URL: HK('botA-abc123'), LARK_BOT_SECRET: 'SuperSecretValue123', LARK_APP_ID: 'cli_old', LARK_CHAT_SALES: 'oc_old' }); delete W.props.LARK_REMINDER_URL;
cfg = W.ctx.larkValidateConfig_();
ok('ผลตรวจไม่เปิดเผย secret / URL เต็ม', !JSON.stringify(cfg).includes('SuperSecretValue123') && !JSON.stringify(cfg).includes('botA-abc123') && cfg.ready, cfg);
ok('ไม่ตั้ง Bot B → เตือนว่าการ์ดเตือนจะส่งผ่าน Bot A · ค่าของ v4.9 → เตือนว่าไม่ใช้แล้ว', cfg.warnings.some(w => /LARK_REMINDER_URL/.test(w)) && cfg.warnings.some(w => /LARK_APP_ID.*LARK_CHAT_SALES/.test(w)), cfg.warnings);
ok('Bot B ไม่ตั้ง = ใช้ปลายทางของ Bot A', W.ctx.larkBotDest_('B', W.props).url === HK('botA-abc123'));
ok('ใช้ LARK_WEBHOOK_REQUESTS (กลุ่มคำขอราคาของ v4.9) แทน Bot A ได้ชั่วคราว', (() => { const p = { LARK_WEBHOOK_REQUESTS: HK('req-old1'), LARK_WEBHOOK_REQUESTS_SECRET: 's' }; const d = W.ctx.larkBotDest_('A', p); return d.url === HK('req-old1') && d.secret === 's'; })());
ok('setup() บันทึกผลตรวจการตั้งค่าใน Log', W.sheets['Log'].rows.some(r => /lark-config/.test(r.join(' '))));
const dg = W.ctx.diagHtml_();
ok('?diag=1 แสดงสถานะ Lark (โหมด + ปัญหา) โดยไม่มี secret', dg.includes('Lark (Lark.gs v' + W.ctx.LARK_VERSION + ')') && /โหมด <b>live<\/b>/.test(dg) && !dg.includes('SuperSecretValue123'));

/* ------------------------------------------------------------------ 2) จุดเชื่อม: ทุกขั้นตอน + ใครถูกแท็ก */
console.log('== 2) event จากการทำงานจริง (โหมด dryrun) — ทุกการ์ดเข้า Bot A กลุ่มเดียว ==');
W = world();
let r = W.saveSR('SR1', 'Draft', { groupType: 'Mounting' });
ok('SR ร่าง → ไม่แจ้ง', r.ok && W.Q().length === 0, W.Q());
r = W.saveSR('SR1', 'Submitted', { groupType: 'Mounting', needBy: '2026-10-20' }, [{ code: 'RAIL-4M', desc: 'Aluminium rail', qty: 320, uom: 'pcs' }, { desc: 'Mid clamp', qty: 640, uom: 'pcs' }]);
let q = W.Q();
ok('SR ส่งจริง (กลุ่ม Mounting) → SR_SUBMITTED 1 ใบ เข้า Bot A (สถานะ PENDING)', r.ok && q.length === 1 && q[0].Event === 'SR_SUBMITTED' && q[0].Target === 'BOT' && q[0].Status === 'PENDING', q);
let c1 = W.card(q[0]), txt = c1.text;
ok('การ์ดแบบ Food: เลขที่ / ลูกค้า / ผู้ขอ / สถานะ / ผู้ดำเนินการ / ครบกำหนด', ['เลขที่', 'ลูกค้า', 'ผู้ขอ', 'สถานะ', 'ผู้ดำเนินการ', 'ครบกำหนด'].every(k => c1.card.elements[0].fields.some(f => f.text.content.startsWith('**' + k + '**'))), c1.card.elements[0]);
ok('@แท็ก Sourcing ที่ดูแลกลุ่ม Mounting (Napasorn) ในช่องผู้ดำเนินการ · @แท็ก Sales ผู้ขอ', /ผู้ดำเนินการ\*\*\n<at email=src2@m\.co><\/at>/.test(flat(c1.card)) && /ผู้ขอ\*\*\n<at email=boss@m\.co>/.test(flat(c1.card)), c1.card.elements[0]);
ok('รายการสินค้า (ไม่มีราคา) + แถบขั้นตอน (อยู่ที่ Sourcing ทำราคา) + ปุ่มเปิดรายการ', /RAIL-4M Aluminium rail — 320 pcs/.test(txt) && /✅ ส่งคำขอ +› +🔶 Sourcing ทำราคา/.test(txt) &&
  c1.card.elements.some(e => e.tag === 'action' && e.actions[0].url === 'https://script.google.com/macros/s/TEST/exec?doc=SR1'), txt);
ok('ลิงก์ไม่ระบุแอป (ระบบเลือกหน้าตามอีเมลผู้กด)', !/app=/.test(txt));
W.saveSR('SR1', 'Submitted', { groupType: 'Mounting', title: 'Factory 2' });
ok('แก้ SR ที่ส่งแล้ว (สถานะเดิม) → ไม่แจ้งซ้ำ', W.Q().length === 1);
const det1 = JSON.parse(W.sheets['Quotations'].rows.find(x => x[0] === 'SR1')[W.sheets['Quotations'].rows[0].indexOf('Detail')]);
r = W.post({ token: W.T.src, action: 'save', id: 'SR1', docType: 'SR', docNo: det1.docNo, status: 'Accepted', assignedTo: 'src', salesUserId: 'boss',
  detail: JSON.stringify(Object.assign({}, det1, { status: 'Accepted', assignedTo: 'src' })) });
q = W.Q(); const acc = q.find(x => x.Event === 'SR_ACCEPTED');
ok('Sourcing รับงาน (Chatraporn รับแทน) → SR_ACCEPTED แท็กคนที่รับงาน', r.ok && acc && /<at email=src@m\.co>/.test(acc.Payload), acc && W.card(acc).text);
r = W.saveQT('Q1', 'In Progress'); ok('QT กำลังทำราคา → ไม่แจ้ง', r.ok && !W.Q().some(x => x.DocId === 'Q1'));
W.saveQT('Q1', 'Submitted'); q = W.Q();
const sub = q.find(x => x.Event === 'QT_SUBMITTED');
// v5.1 (ตั้งใจ): อนุมัติก่อนหลังได้ → การ์ดรออนุมัติแท็กทั้ง 2 ฝ่ายพร้อมกัน (เดิมแท็กเฉพาะระดับ 1)
ok('ส่งขออนุมัติ → QT_SUBMITTED แท็กทั้ง Sourcing Manager และ BD Manager', sub && /<at email=pm@m\.co>/.test(sub.Payload) && /<at email=bd@m\.co>/.test(sub.Payload) && /2 ฝ่าย/.test(sub.Title), sub && W.card(sub).text);
ok('มีราคาแล้ว → "💰 มีราคาแล้ว — ดูราคาบนเว็บ" (ไม่มีตัวเลข)', /มีราคาแล้ว/.test(W.card(sub).text));
// v5.1 (ตั้งใจ): BD กดก่อน Sourcing Manager ได้ (เดิม v5.0 → WAIT_PREVIOUS_LEVEL)
r = W.post({ token: W.T.bd, action: 'approve', id: 'Q1' }); q = W.Q();
const l1 = q.find(x => x.Event === 'QT_PARTIAL_APPROVED');
ok('BD Manager อนุมัติก่อน → QT_PARTIAL_APPROVED แท็ก Sourcing Manager (ฝ่ายที่ยังขาด) · แถบขั้นตอน ✅ BD Manager / 🔶 Sourcing Manager', r.ok && r.status === 'Partial Approved' && l1 && /<at email=pm@m\.co>/.test(l1.Payload) && !/<at email=bd@m\.co>/.test(l1.Payload) &&
  /🔶 Sourcing Manager \+ ✅ BD Manager/.test(W.card(l1).text), l1 && W.card(l1).text);
r = W.post({ token: W.T.pm, action: 'approve', id: 'Q1' }); q = W.Q();
const ap = q.find(x => x.Event === 'QT_APPROVED');
ok('ฝ่ายที่สองอนุมัติ → QT_APPROVED แท็กผู้ปล่อยราคา (NON)', r.ok && r.status === 'Approved' && ap && /<at email=sales_non@m\.co>/.test(ap.Payload) && q.filter(x => x.Event === 'QT_APPROVED').length === 1, ap && W.card(ap).text);
r = W.post({ token: W.T.gm, action: 'release', id: 'Q1' }); q = W.Q();
const rel = q.find(x => x.Event === 'PRICE_RELEASED');
ok('ปล่อยราคา → PRICE_RELEASED แท็ก Sales ผู้ขอ + บอกให้ดูราคาบนเว็บ', r.ok && rel && /<at email=boss@m\.co>/.test(rel.Payload) && /ดูราคาได้แล้วบนเว็บ/.test(W.card(rel).text) && /✅ ปล่อยราคา/.test(W.card(rel).text), rel && W.card(rel).text);
W.saveQT('Q2', 'Submitted'); W.saveQT('Q2', 'In Progress'); q = W.Q();
const ret = q.find(x => x.Event === 'QT_RETURNED');
ok('ส่งกลับแก้ (Submitted → In Progress) → QT_RETURNED แท็ก Sourcing ผู้ทำราคา', ret && /<at email=src@m\.co>/.test(ret.Payload) && /ทั้ง 2 ฝ่าย/.test(W.card(ret).text), ret && W.card(ret).text);
W.saveQT('Q2', 'Submitted');
ok('ส่งขออนุมัติซ้ำภายใน 2 ชม. (รอบเดิม) → ไม่ส่งซ้ำ', W.Q().filter(x => x.Event === 'QT_SUBMITTED' && x.DocId === 'Q2').length === 1);
W.saveQT('Q2', 'In Progress', { round: 2 }); W.saveQT('Q2', 'Submitted', { round: 2 });
ok('รอบใหม่ (R2) → แจ้งได้อีกครั้ง', W.Q().filter(x => x.Event === 'QT_SUBMITTED' && x.DocId === 'Q2').length === 2);
// ส่งต่อคำขอ + ยกเลิก
W.saveSR('SR2', 'Submitted', { groupType: 'Inverter' });
const srDet = JSON.parse(W.sheets['Quotations'].rows.find(x => x[0] === 'SR2')[W.sheets['Quotations'].rows[0].indexOf('Detail')]);
ok('SR กลุ่ม Inverter วิ่งถึง Chatraporn (ตาม Scope)', srDet.routedTo === 'src' && srDet.routedWhy === 'scope', srDet);
r = W.post({ token: W.T.pm, action: 'save', id: 'SR2', docType: 'SR', docNo: srDet.docNo, status: 'Submitted', salesUserId: 'boss',
  detail: JSON.stringify(Object.assign({}, srDet, { routedTo: 'src2', routedManual: true })) });
const fw = W.Q().find(x => x.Event === 'SR_FORWARDED');
ok('ส่งต่อคำขอให้คนอื่น → SR_FORWARDED แท็กผู้รับคนใหม่', r.ok && r.routedTo === 'src2' && fw && /<at email=src2@m\.co>/.test(fw.Payload) && /ส่งต่อให้ Napasorn/.test(W.card(fw).text), [r, fw && W.card(fw).text]);
r = W.post({ token: W.T.pm, action: 'save', id: 'SR2', docType: 'SR', docNo: srDet.docNo, status: 'Cancelled', salesUserId: 'boss', detail: JSON.stringify(Object.assign({}, srDet, { status: 'Cancelled', routedTo: 'src2' })) });
const cx = W.Q().find(x => x.Event === 'SR_CANCELLED');
ok('ยกเลิกคำขอ → SR_CANCELLED แท็กผู้รับคำขอ', cx && /<at email=src2@m\.co>/.test(cx.Payload), cx && W.card(cx).text);
// price gate ทั้งคิว
const allPayload = W.Q().map(x => x.Payload + x.Title).join('\n');
ok('Price gate: ไม่มีการ์ดใดมี ราคา / ต้นทุน / กำไร / %GP / มูลค่า (ทุกคนในกลุ่มเห็น)', !/270,?000|220,?000|50,?000|18\.5|%GP|\bGP\b|ต้นทุน|กำไร|฿|US\$|unitPrice|"up"/.test(allPayload), allPayload.slice(0, 300));
ok('ธุรกรรมหลักไม่ยิง HTTP เลย (แค่เข้าคิว)', W.fetchLog.length === 0, W.fetchLog.length);
W.props.LARK_MENTION_REQUESTER = 'off'; W.saveQT('Q9', 'Submitted');
ok('LARK_MENTION_REQUESTER=off → ช่องผู้ขอเป็นชื่อ ไม่แท็ก', (x => x && !/<at email=boss/.test(x.Payload) && /ผู้ขอ\*\*\nBOSS/.test(flat(W.card(x).card)))(W.Q().find(x => x.DocId === 'Q9')));
delete W.props.LARK_MENTION_REQUESTER;

/* ------------------------------------------------------------------ 3) ทนต่อความผิดพลาด */
console.log('== 3) ทนต่อความผิดพลาด ==');
const orig = W.ctx.larkBuild_; W.ctx.larkBuild_ = () => { throw new Error('boom in builder'); };
r = W.saveQT('Q3', 'Submitted');
ok('ตัวสร้างการ์ดพัง → การบันทึกใบเสนอราคายังสำเร็จ', r.ok && W.sheets['Quotations'].rows.some(x => x.includes('Q3')), r);
ok('…และบันทึกปัญหาไว้ใน Log', W.sheets['Log'].rows.some(x => /lark-enqueue-error/.test(x.join(' ')) && /boom/.test(x.join(' '))));
W.ctx.larkBuild_ = orig;
const origSheet = W.ctx.sheet_; W.ctx.sheet_ = n => { if (n === 'NotifyQueue') throw new Error('sheet gone'); return origSheet(n); };
r = W.saveQT('Q4', 'Submitted'); W.ctx.sheet_ = origSheet;
ok('แท็บคิวเสียหาย → การบันทึกยังสำเร็จ', r.ok);
globalThis.__NO_LARK = true; const bare = makeRuntime(DIR + '/Code.gs'); globalThis.__NO_LARK = false;
ok('ไม่มีไฟล์ Lark.gs → Code.gs ทำงานได้ปกติ', typeof bare.ctx.larkOnStatus_ === 'undefined' && typeof bare.ctx.larkHook_ === 'function' && bare.ctx.larkHook_(null, {}, 2, 'a', 'b', null) === null);
W.props.LARK_MODE = 'off'; const n0 = W.Q().length; W.saveQT('Q5', 'Submitted');
ok('LARK_MODE=off → ไม่เข้าคิวเลย', W.Q().length === n0);
W.props.LARK_MODE = 'dryrun';
const evil = W.ctx.larkBuild_('QT_SUBMITTED', { id: 'X', docNo: 'QT-1', title: 'A <at user_id="all">ทุกคน</at> **ตัวหนา**', customer: 'B\u0007C', requester: { name: '<at id=all>', email: 'bad email' }, actors: [{ name: 'x', email: 'a@b.co><at user_id="all"' }] }, 'https://x/exec');
const evilS = JSON.stringify(evil);
ok('กัน mention ทั้งกลุ่ม / markdown / อักขระควบคุมจากข้อความผู้ใช้ · อีเมลผิดรูปไม่ถูกแปลงเป็น @แท็ก', !/<at/.test(evilS) && !/user_id/.test(evilS) && !/\*\*ตัวหนา/.test(evilS) && !/\\u0007/.test(evilS) && !/<at email=a@b/.test(evilS), evilS.slice(0, 400));

/* ------------------------------------------------------------------ 4) flush: dryrun */
console.log('== 4) ส่ง (flush) ==');
let f = W.ctx.larkFlush();
ok('dryrun: ทุกรายการเปลี่ยนเป็น DRYRUN และไม่มี HTTP สักครั้ง', f.dryrun > 0 && W.Q().every(x => ['DRYRUN', 'SKIPPED'].includes(x.Status)) && W.fetchLog.length === 0, f);
ok('dryrun ซ้ำ → ไม่มีอะไรค้าง', W.ctx.larkFlush().dryrun === 0);

/* ------------------------------------------------------------------ 5) live: webhook การ์ด + ลายเซ็น */
W = world();
Object.assign(W.props, { LARK_MODE: 'live', LARK_BOT_URL: HK('botA-1234'), LARK_BOT_SECRET: 'whsecA', LARK_REMINDER_URL: HK('botB-1234'), LARK_REMINDER_SECRET: 'whsecB' });
W.saveQT('L1', 'Submitted'); W.saveSR('SRL', 'Submitted', { groupType: 'Inverter' });
ok('live: ธุรกรรมหลักยังไม่ยิง HTTP', W.fetchLog.length === 0);
f = W.ctx.larkFlush();
const calls = W.fetchLog.filter(x => x.url === HK('botA-1234')), b0 = calls[0] && JSON.parse(calls[0].o.payload);
ok('live: ส่งทั้งชุดด้วย fetchAll ไป Bot A (2 การ์ด)', f.sent === 2 && calls.length === 2 && W.fetchLog.length === 2, f);
ok('webhook: msg_type interactive + การ์ดเต็ม (หัวสี + ปุ่ม)', b0 && b0.msg_type === 'interactive' && b0.card && b0.card.header && b0.card.elements.some(e => e.tag === 'action'), b0);
ok('webhook: ลายเซ็นตรงตามสูตรของ Lark (secret ของ Bot A)', b0 && b0.sign === crypto.createHmac('sha256', b0.timestamp + '\nwhsecA').update('').digest('base64'));
ok('ส่งสำเร็จ → SENT + เวลา', W.Q().filter(x => x.Status === 'SENT').length === 2 && W.Q().every(x => x.SentAt));
W.saveQT('L2', 'Submitted', { title: 'retry me' });
globalThis.__LARK_REPLY = () => ({ code: 200, body: { code: 19021, msg: 'sign match fail or timestamp is not within one hour from current time' } });
f = W.ctx.larkFlush(); let it = W.Q().find(x => x.DocId === 'L2');
ok('Lark ตอบ error → RETRY · Tries 1 · นัดใหม่อีก 1 นาที · เก็บ error + คำแนะนำ (Secret ไม่ตรง)', f.retry === 1 && it.Status === 'RETRY' && it.Tries === 1 && Date.parse(it.NextAt) - Date.now() > 50000 && /sign/.test(it.LastError) && /Secret ไม่ตรง/.test(it.LastError), it);
ok('ยังไม่ถึงเวลา → ไม่ส่งซ้ำ', W.ctx.larkFlush().retry === 0);
const qs = W.sheets['NotifyQueue'], qh = qs.rows[0], rowL2 = qs.rows.find(x => x[qh.indexOf('DocId')] === 'L2');
for (let k = 0; k < 4; k++) { rowL2[qh.indexOf('NextAt')] = new Date(Date.now() - 1000).toISOString(); W.ctx.larkFlush(); }
it = W.Q().find(x => x.DocId === 'L2');
ok('ลองครบ 5 ครั้ง → FAILED + บันทึก lark-failed ใน Log (ไม่ลองต่อไม่รู้จบ)', it.Status === 'FAILED' && it.Tries === 5 && W.sheets['Log'].rows.some(x => /lark-failed/.test(x.join(' '))), it);
globalThis.__LARK_REPLY = null;
delete W.props.LARK_BOT_URL; delete W.props.LARK_REMINDER_URL;
W.saveQT('L3', 'Submitted');
ok('live + ยังไม่ตั้ง Bot A → รายการ SKIPPED พร้อมเหตุผล', W.Q().some(x => x.DocId === 'L3' && x.Status === 'SKIPPED' && /LARK_BOT_URL/.test(x.LastError)));
W.props.LARK_BOT_URL = 'https://bad.example/x'; W.saveQT('L4', 'Submitted');
f = W.ctx.larkFlush();
ok('live แต่ตั้งค่าผิด → ไม่ยิง · RETRY พร้อมบอกว่าตั้งค่าอะไรผิด', f.retry >= 1 && W.Q().some(x => /ตั้งค่าไม่ครบ/.test(x.LastError)) && !W.fetchLog.some(x => /bad\.example/.test(x.url)), f);

/* ------------------------------------------------------------------ 6) Bot B: เตือนเกินกำหนด */
console.log('== 6) Bot B เตือนงานเกินกำหนด (ไม่รวม follow-up ของ Sales) ==');
W = world();
Object.assign(W.props, { LARK_BOT_URL: HK('botA-5678'), LARK_REMINDER_URL: HK('botB-5678') });
W.saveQT('S1', 'Submitted'); W.saveQT('S2', 'Submitted'); W.saveQT('S3', 'In Progress'); W.saveQT('S4', 'Pending', { releasedTo: 'boss' });
const QS = W.sheets['Quotations'], qhh = QS.rows[0];
const age = (id, days) => { const row = QS.rows.find(x => x[qhh.indexOf('Id')] === id); const d = JSON.parse(row[qhh.indexOf('Detail')]); const at = new Date(Date.now() - days * 86400000).toISOString(); d.statusChangedAt = at; d.statusLog = [{ s: d.status, at }]; row[qhh.indexOf('Detail')] = JSON.stringify(d); };
age('S1', 12); age('S2', 9); age('S3', 0); age('S4', 30);
QS.rows.find(x => x[0] === 'S4')[qhh.indexOf('SalesDetail')] = JSON.stringify({ id: 'S4', total: 1, lines: [{ unitPrice: 1 }] });
const bkk = ms => new Date(ms + 7 * 3600000);
let wk = Date.now(); while ([0, 6].includes(bkk(wk).getUTCDay())) wk += 86400000;
const at = (base, hh, mm) => { const d = bkk(base); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hh, mm) - 7 * 3600000; };
const morning = at(wk, 10, 0), night = at(wk, 20, 0);
let sat = Date.now(); while (bkk(sat).getUTCDay() !== 6) sat += 86400000;
ok('นอกเวลาทำงาน (20:00) → ไม่เตือน', W.ctx.larkSlaScan({ nowMs: night }).skipped === 'outside-working-hours');
ok('วันเสาร์ → ไม่เตือน', W.ctx.larkSlaScan({ nowMs: at(sat, 10, 0) }).skipped === 'outside-working-hours');
ok('trigger ส่ง event object มา (ไม่มี nowMs) → ใช้เวลาจริง ไม่พัง', (() => { const x = W.ctx.larkSlaScan({ authMode: 'FULL', triggerUid: '1' }); return !!x && !x.error; })());
W.sheets['NotifyQueue'].rows.splice(1);
const s1 = W.ctx.larkSlaScan({ nowMs: morning }); q = W.Q().filter(x => x.Event === 'SLA_REMINDER');
ok('งานเกินกำหนด 2 งาน (รออนุมัติ) → การ์ดเตือนงานละ 1 ใบ เข้า Bot B', s1.reminded === 2 && q.length === 2 && q.every(x => x.Target === 'REMINDER'), [s1, q.map(x => x.Title)]);
ok('เรียงเกินกำหนดนานสุดก่อน (S1 ก่อน S2)', q[0].DocId === 'S1' && q[1].DocId === 'S2');
const rc = W.card(q[0]);
ok('การ์ดเตือน: หัวเหลือง · แท็ก Sourcing Manager · บอกขั้นที่ค้าง + เกินกำหนดกี่วัน + วันครบกำหนด', rc.card.header.template === 'yellow' && /<at email=pm@m\.co>/.test(q[0].Payload) && /ค้างที่ขั้น “อนุมัติ 2 ฝ่าย”/.test(rc.text) && /เกินกำหนด \d+ วันทำการ/.test(rc.text) && /ครบกำหนด \d\d\/\d\d\/\d{4}/.test(rc.text), rc.text);
ok('งานที่ยังไม่เกิน (S3) และงานติดตามลูกค้าของ Sales (S4) ไม่ถูกเตือน', !q.some(x => x.DocId === 'S3' || x.DocId === 'S4'));
W.ctx.larkSlaScan({ nowMs: morning + 3600000 });
ok('ชั่วโมงถัดไปวันเดียวกัน → ไม่เตือนงานเดิมซ้ำ', W.Q().filter(x => x.Event === 'SLA_REMINDER').length === 2);
let nextWk = morning + 86400000; while ([0, 6].includes(bkk(nextWk).getUTCDay())) nextWk += 86400000;
W.ctx.larkSlaScan({ nowMs: nextWk });
ok('วันทำการถัดไป → เตือนอีกครั้ง (วันละครั้งต่องานต่อขั้นตอน)', W.Q().filter(x => x.Event === 'SLA_REMINDER').length === 4);
W.ctx.larkFlush();
ok('dryrun: การ์ดเตือนไม่ยิง HTTP', W.fetchLog.length === 0);
W.props.LARK_MODE = 'live'; W.sheets['NotifyQueue'].rows.splice(1); W.ctx.larkSlaScan({ nowMs: morning }); W.ctx.larkFlush();
ok('live: การ์ดเตือนส่งผ่าน Bot B (webhook แยก)', W.fetchLog.length >= 2 && W.fetchLog.every(x => x.url === HK('botB-5678')), W.fetchLog.map(x => x.url));

/* ------------------------------------------------------------------ 7) trigger + เครื่องมือ admin */
console.log('== 7) trigger / เครื่องมือ ==');
W.triggers.push({ getHandlerFunction: () => 'larkDailyDigest' });
W.ctx.larkInstallTriggers(); W.ctx.larkInstallTriggers();
ok('ติดตั้ง trigger ซ้ำได้ ไม่ซ้อน (2 ตัว) และลบ trigger สรุปประจำวันของ v4.9', W.triggers.length === 2 && W.triggers.map(t => t.getHandlerFunction()).sort().join() === 'larkFlush,larkSlaScan');
const nF = W.fetchLog.length;
const demo = W.ctx.larkDryRunDemo();
ok('larkDryRunDemo(): ตัวอย่างครบทุก event (10) ไม่ยิง HTTP', demo.length === 10 && new Set(demo.map(d => d.event)).size === 10 && W.fetchLog.length === nF);
ok('ตัวอย่างการ์ดไม่มีราคา/GP', !/%GP|ต้นทุน|฿|\d{2,3},\d{3}\.\d\d/.test(JSON.stringify(demo)));
globalThis.__SSO_EMAIL = 'aon@m.co';
const ts = W.ctx.larkTestSend();
ok('larkTestSend(): ส่งการ์ดทดสอบ 3 ใบ (Bot A 2 + Bot B 1) แท็กอีเมลผู้รัน', ts.length === 3 && ts.every(x => /ส่งสำเร็จ/.test(x)) && W.fetchLog.slice(nF).some(x => /<at email=aon@m\.co>/.test(x.o.payload)) && W.fetchLog.slice(nF).some(x => x.url === HK('botB-5678')), ts);
globalThis.__SSO_EMAIL = '';
ok('NotifyQueue — header ชีทเดิมไม่เปลี่ยน', JSON.stringify(W.ctx.HEADERS.NotifyQueue) === JSON.stringify(['Id','Event','DocId','DedupKey','Target','Title','Payload','Status','Tries','NextAt','CreatedAt','SentAt','LastError']) &&
  JSON.stringify(W.ctx.HEADERS.Quotations.slice(0, 3)) === '["Id","DocType","DocNo"]' && W.ctx.HEADERS.Quotations.length === 35);
const larkSrc = fs.readFileSync(DIR + '/Lark.gs', 'utf8');
ok('ไม่มี secret / webhook ฝังในโค้ด', !/cli_[A-Za-z0-9]{6,}|oc_[A-Za-z0-9]{6,}|hook\/[A-Za-z0-9-]{8,}/.test(larkSrc));
ok('HTTP ใช้ fetchAll ทั้งชุดเท่านั้น (ไม่มี UrlFetchApp.fetch ทีละรายการ)', !/UrlFetchApp\.fetch\(/.test(larkSrc) && /UrlFetchApp\.fetchAll\(/.test(larkSrc));

if (DOCS) {     // ส่งมอบ: ตัวอย่าง payload การ์ดจริงของทุก event
  fs.writeFileSync(DOCS + '/lark_payload_samples.json', JSON.stringify(demo, null, 2));
  console.log('wrote ' + DOCS + '/lark_payload_samples.json');
}
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL v5.0 LARK TESTS PASSED'); process.exit(fails ? 1 : 0);
