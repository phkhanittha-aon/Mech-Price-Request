// v5.10 — หน้าจอจริง: Sourcing กดส่งอนุมัติ → การ์ดกลุ่มผู้อนุมัติมียอด / กำไร / ค่าคอม ตรงกับที่หน้าเว็บคำนวณ · หน้าตั้งค่ามี Bot C
// รัน: NODE_PATH=$(npm root -g) node tests/e2e_v510.js $PWD [out-dir]   (ทดสอบบนเครื่องเท่านั้น ห้าม deploy)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), crypto = require('crypto');
const { makeRuntime } = require('./gasmock');
const [, , DIR, OUT] = process.argv;
const { ctx, sheets, props } = makeRuntime(DIR + '/Code.gs');
const H = s => crypto.createHash('sha256').update(s + 'mgs-internal-2025').digest('hex');
const U = sheets['Users'], uh = U.rows[0];
[['src', 'Chatraporn', 'Sourcing'], ['pm', 'Procure', 'Procurement Mgr'], ['bd', 'BD', 'BD Mgr'], ['adm', 'Admin', 'Admin'], ['boss', 'BOSS', 'Sales'], ['sales_non', 'NON', 'Sales']]
  .forEach(([id, n, r]) => { const x = []; x[uh.indexOf('Id')] = id; x[uh.indexOf('Name')] = n; x[uh.indexOf('Role')] = r; x[uh.indexOf('Scope')] = 'all'; x[uh.indexOf('PassHash')] = H('pw123456'); x[uh.indexOf('Email')] = id + '@m.co'; U.rows.push(x); });
const post = p => JSON.parse(ctx.apiPost(JSON.stringify(p)));
const tS = post({ action: 'login', user: 'src', passHash: H('pw123456') }).token;
const doc = { id: 'Q1', _v: 2, _pm: 2, _sv: 3, docType: 'QT', docNo: 'QT-IN-2610-001', status: 'In Progress', round: 1, approvalRoles: [], approvals: [], releasedTo: [],
  header: { ref: 'QT-IN-2610-001', title: 'SCG Rooftop', customer: 'SCG inter', salesUserId: 'boss', sales: 'BOSS', currency: 'THB', groupType: 'Inverter', rates: { USD: 36, CNY: 5 }, offerDate: '2026-10-14', validity: 30 },
  lines: [{ code: 'SG50CX-P2', desc: 'SUNGROW INVERTER 50KW', group: 'INVERTER', qty: 30, uom: 'pcs', up: 50000, costCur: 'THB', opPct: 15, dutyPct: 0, clearancePct: 0, freep: 0, extras: [] },
          { code: 'RAIL-4M', desc: 'Aluminium rail', group: 'MOUNTING', qty: 100, uom: 'pcs', up: 1000, costCur: 'THB', opPct: 25, dutyPct: 0, clearancePct: 0, freep: 0, extras: [] }],
  remarks: [], auditLogs: [], globalExtras: [] };
post({ token: tS, action: 'save', id: 'Q1', docType: 'QT', docNo: doc.docNo, status: 'In Progress', salesUserId: 'boss', sales: 'BOSS', title: 'SCG Rooftop', customer: 'SCG inter', detail: JSON.stringify(doc), salesDetail: JSON.stringify({ id: 'Q1', lines: [] }) });
Object.assign(props, { LARK_MODE: 'dryrun', LARK_APPROVAL_URL: 'https://open.larksuite.com/open-apis/bot/v2/hook/cccc1111-dddd-2222-eeee-3333ffff7c01' });

const html = fs.readFileSync(DIR + '/Index.html', 'utf8');
const srv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(html); }).listen(0);
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 500) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const login = async (u, vp) => { const p = await (await b.newContext({ viewport: vp || { width: 1366, height: 900 } })).newPage();
    p.on('pageerror', e => { console.log('PAGEERROR', e.message); fails++; });
    await p.route('https://script.google.com/**', async rt => { const r = rt.request(); let out;
      if (r.method() === 'POST') out = ctx.apiPost(r.postData()); else { const q = new URL(r.url()); const g = k => q.searchParams.get(k) || ''; out = ctx.apiGet(g('type'), g('token'), g('id') || g('since')); }
      await rt.fulfill({ status: 200, contentType: 'application/json', body: out }); });
    await p.goto('http://localhost:' + srv.address().port + '/?app=index');
    await p.fill('#loginUser', u); await p.fill('#loginPass', 'pw123456'); await p.click('button:has-text("เข้าสู่ระบบ →")'); await p.waitForTimeout(1800); return p; };

  console.log('== 1) Sourcing ส่งอนุมัติ → หน้าเว็บคำนวณสรุปไว้ในใบ ==');
  const s = await login('src');
  const want = await s.evaluate(() => { editQuote('Q1'); const t = computeQuote(editing); const cats = Object.keys(t.com);
    return { total: t.total, profit: t.profit, gp: t.gp, com: cats.reduce((a, k) => a + t.com[k].comAmt, 0), cats: cats.map(k => [k, t.com[k].grade, t.com[k].rate]) }; });
  await s.waitForTimeout(400);
  await s.evaluate(() => doSaveQuote('Submitted', false)); await s.waitForTimeout(1500);
  const QS = sheets['Quotations'], qh = QS.rows[0], det = JSON.parse(QS.rows.find(r => r[0] === 'Q1')[qh.indexOf('Detail')]);
  const a = det.apprSummary || {};
  ok('Detail.apprSummary มียอด / กำไร / GP / ค่าคอม ตรงกับ computeQuote ของหน้าเว็บ', Math.abs(a.total - want.total) < 0.01 && Math.abs(a.profit - want.profit) < 0.01 && Math.abs(a.gp - want.gp) < 0.01 &&
    Math.abs(a.comAmt - want.com) < 0.01 && Math.abs(a.comRate - want.com / want.total * 100) < 0.01, { a, want });
  ok('คอมเรทแยกตามกลุ่มสินค้า (Inverter / Mounting) พร้อมเกรด', (a.byCat || []).length === want.cats.length && want.cats.every(([k, g, r]) => a.byCat.some(c => c.cat === k && c.grade === g && c.rate === r)), a.byCat);
  const sdRaw = String(QS.rows.find(r => r[0] === 'Q1')[qh.indexOf('SalesDetail')]);
  ok('SalesDetail (ฉบับ Sales) ไม่มี apprSummary', !/apprSummary|comRate/.test(sdRaw));
  const nq = sheets['NotifyQueue'], nh = nq.rows[0], card = nq.rows.slice(1).map(r => ({ ev: r[nh.indexOf('Event')], tg: r[nh.indexOf('Target')], p: r[nh.indexOf('Payload')] })).find(x => x.ev === 'QT_SUBMITTED');
  const txt = card ? JSON.parse(card.p).text : '';
  const fmt = n => Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  ok('การ์ดขออนุมัติ → กลุ่มผู้อนุมัติ (APPROVAL) · มูลค่าทั้งโครงการ + กำไร + ค่าคอม ตรงกับหน้าเว็บ', card && card.tg === 'APPROVAL' && txt.includes('มูลค่าทั้งโครงการ ' + fmt(want.total) + ' THB') &&
    txt.includes('ค่าคอม Sales ' + fmt(want.com) + ' THB') && txt.includes('กำไรรวม ' + fmt(want.profit) + ' THB'), txt);
  ok('…รายการสินค้าเป็นตาราง (SG50CX-P2 · 30 pcs)', /SG50CX-P2 \| · SUNGROW INVERTER 50KW \| · 30 pcs/.test(txt), txt);

  console.log('== 2) หน้าตั้งค่า Lark Bot มี Bot C ==');
  const ad = await login('adm');
  await ad.evaluate(() => go('larkbot')); await ad.waitForTimeout(800);
  const t2 = await ad.textContent('#content');
  ok('มีการ์ด "MGS Approval" + คำเตือนให้ตั้งในกลุ่มเฉพาะ Procurement Mgr · BD Mgr · GM', await ad.locator('#larkBotC').count() === 1 && /MGS Approval/.test(t2) && /เฉพาะ Procurement Mgr · BD Mgr · GM/.test(await ad.textContent('#larkBotC')), t2.slice(0, 200));
  ok('Bot C ตั้งแล้ว (ตั้งใน Script Properties) → ✓ ตั้งแล้ว', /✓ ตั้งแล้ว/.test(await ad.textContent('#larkBotC')));
  if (OUT) await ad.screenshot({ path: OUT + '/v510_larkbot.png', fullPage: true });
  const m = await login('adm', { width: 390, height: 820 });
  await m.evaluate(() => go('larkbot')); await m.waitForTimeout(700);
  ok('มือถือ 390px: หน้าตั้งค่าไม่ล้นจอ', await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

  console.log(fails ? fails + ' FAILED' : 'ALL v5.10 E2E PASSED');
  await b.close(); srv.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL crash', e && e.stack); process.exit(1); });
