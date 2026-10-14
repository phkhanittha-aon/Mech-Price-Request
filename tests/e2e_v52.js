// v5.2 — "พร้อมเสนอลูกค้า" ต้องหมายถึง Sales เห็นราคาแล้วจริง (ใบ Pending รุ่นเก่าที่ยังไม่มีราคาฉบับ Sales แยกออกมา + ปุ่มซ่อม)
// รัน: NODE_PATH=$(npm root -g) node tests/e2e_v52.js $PWD [out-dir]   (ทดสอบบนเครื่องเท่านั้น ห้าม deploy)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), crypto = require('crypto');
const { makeRuntime } = require('./gasmock');
const { seedSave } = require('./seed');
const [, , DIR, OUT] = process.argv;
const { ctx, sheets, props } = makeRuntime(DIR + '/Code.gs');
const H = s => crypto.createHash('sha256').update(s + 'mgs-internal-2025').digest('hex');
const U = sheets['Users'], uh = U.rows[0];
[['src', 'Chatraporn', 'Sourcing'], ['pm', 'Procure', 'Procurement Mgr'], ['boss', 'BOSS', 'Sales'], ['sales_non', 'NON', 'Sales']]
  .forEach(([id, n, r]) => { const x = []; x[uh.indexOf('Id')] = id; x[uh.indexOf('Name')] = n; x[uh.indexOf('Role')] = r; x[uh.indexOf('Scope')] = 'all'; x[uh.indexOf('PassHash')] = H('pw123456'); x[uh.indexOf('Email')] = id + '@m.co'; U.rows.push(x); });
const post = p => JSON.parse(ctx.apiPost(JSON.stringify(p)));
const get = (t, tok, a) => JSON.parse(ctx.apiGet(t, tok, a || ''));
const tok = u => post({ action: 'login', user: u, passHash: H('pw123456') }).token;
const T = { src: tok('src'), pm: tok('pm'), boss: tok('boss') };
const hd = (t) => ({ ref: 'P.' + t, title: t, customer: t, salesUserId: 'boss', sales: 'BOSS', currency: 'THB', groupType: 'Inverter', reqDate: '2026-06-01' });
const line = { code: 'SG110CX', desc: 'Inverter 110kW', group: 'INVERTER', qty: 2, uom: 'pcs', up: 1000, costCur: 'THB', dutyPct: 0, clearancePct: 0, opPct: 20, freep: 0, extras: [] };
// ใบ Pending รุ่นเก่า: บันทึกโดย client เก่าที่ไม่ส่ง salesDetail → แท็บ SalesDetail ว่าง
// v5.9: save ตั้ง Pending เองไม่ได้แล้ว → ใบ Pending (รุ่นเก่า / ปล่อยแล้ว) ใส่ตรงลงชีทเป็นข้อมูลตั้งต้น
const save = (id, title, lines, extra) => seedSave(sheets, Object.assign({ token: T.src, action: 'save', id, docType: 'QT', docNo: 'P.' + title, status: 'Pending', salesUserId: 'boss', title, customer: title,
  detail: JSON.stringify({ id, _v: 2, _pm: 2, _sv: 3, docType: 'QT', docNo: 'P.' + title, status: 'Pending', round: 1, approvalRoles: [], approvals: [], releasedTo: [], header: hd(title), lines, remarks: [], auditLogs: [], globalExtras: [] }) }, extra || {}));
save('L1', 'ไทยเบฟ', [line]);                       // มีราคาในใบ → ซ่อมได้ด้วยปุ่ม
save('L2', 'KKE', []);                              // ไม่มีรายการราคาเลย → ต้องใส่ราคาเอง
save('L3', 'CNES', [], { salesDetail: JSON.stringify({ id: 'L3', status: 'Pending', lines: [], total: 0 }) });   // มีฉบับ Sales แต่ไม่มีราคา
save('R1', 'OR', [line], { releasedTo: 'boss', salesDetail: JSON.stringify({ id: 'R1', status: 'Pending', lines: [{ code: 'SG110CX', qty: 2, unitPrice: 1250, amount: 2500 }], total: 2500 }) });
const QS = sheets['Quotations'], qh = QS.rows[0];
QS.rows.find(r => r[0] === 'R1')[qh.indexOf('ReleasedTo')] = 'boss';
const files = { '/': fs.readFileSync(DIR + '/Index.html', 'utf8'), '/sales': fs.readFileSync(DIR + '/Sales.html', 'utf8') };
const srv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(files[q.url.split('?')[0].split('#')[0]] || files['/']); }).listen(0);
const BASE = 'http://localhost:' + srv.address().port;
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 400) : '')); if (!c) fails++; };

console.log('== 1) server: เหตุผลที่ Sales ยังไม่เห็นราคา ==');
const fo = id => get('quotations', T.pm).quotations.find(x => x.id === id).follow;
ok('Pending ไม่มีราคาฉบับ Sales แต่มีราคาในใบ → REPAIR · repair = NO_COPY (กดสร้างได้)', fo('L1').owner === 'REPAIR' && fo('L1').repair === 'NO_COPY', fo('L1'));
ok('ใบไม่มีรายการสินค้าเลย → repair = NO_PRICE (ป้ายตรงกับแถบซ่อม: ต้องใส่ราคา)', fo('L2').owner === 'REPAIR' && fo('L2').repair === 'NO_PRICE' && /ใส่ราคา/.test(fo('L2').label), fo('L2'));
ok('มีฉบับ Sales แต่ไม่มีราคา → repair = NO_PRICE · ป้ายบอกให้ Sourcing ใส่ราคา', fo('L3').owner === 'REPAIR' && fo('L3').repair === 'NO_PRICE' && /ใส่ราคา/.test(fo('L3').label), fo('L3'));
ok('ปล่อยราคาแล้ว + มีราคาฉบับ Sales → SALES (พร้อมเสนอลูกค้าจริง)', fo('R1').owner === 'SALES', fo('R1'));
const bossRows = get('salesview', T.boss).quotations;
ok('ฝั่ง Sales: ใบรุ่นเก่าไม่มีราคา (priceLocked) · R1 เห็นราคา', bossRows.filter(x => /^L/.test(x.id)).every(x => !x.salesValue) && /unitPrice/.test(bossRows.find(x => x.id === 'R1').salesDetail));
QS.rows.filter(r => /^L/.test(r[0])).forEach(r => { const d = JSON.parse(r[qh.indexOf('Detail')]); const at = new Date(Date.now() - 40 * 86400000).toISOString(); d.statusChangedAt = at; d.statusLog = [{ s: 'Pending', at }]; r[qh.indexOf('Detail')] = JSON.stringify(d); });
props.LARK_MODE = 'dryrun';
const sc = ctx.larkSlaScan({ nowMs: Date.now(), force: true });
ok('Lark Bot B ไม่เตือนงานซ่อมข้อมูลรุ่นเก่า (REPAIR) ในกลุ่ม', sc.reminded === 0, sc);

(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  p.on('pageerror', e => { console.log('PAGEERROR', e.message); fails++; });
  await p.route('https://script.google.com/**', async rt => { const r = rt.request(); let body;
    if (r.method() === 'POST') body = ctx.apiPost(r.postData()); else { const u = new URL(r.url()); const g = k => u.searchParams.get(k) || ''; body = ctx.apiGet(g('type'), g('token'), g('id') || g('since')); }
    await rt.fulfill({ status: 200, contentType: 'application/json', body }); });
  await p.goto(BASE + '/?app=index'); await p.waitForTimeout(300);
  await p.fill('#loginUser', 'pm'); await p.fill('#loginPass', 'pw123456'); await p.click('button:has-text("เข้าสู่ระบบ →")'); await p.waitForTimeout(2000);
  // v5.4: หน้าติดตามงานเริ่มที่ "งานของฉัน" — เทสต์นี้ตรวจภาพรวมทั้งทีมจึงสลับเป็น "ทั้งทีม" (ผู้จัดการทำได้)
  await p.evaluate(() => { fWho = 'all'; fStatus = 'Pending'; go('followup'); }); await p.waitForTimeout(500);
  let txt = await p.textContent('#content');
  console.log('== 2) หน้าติดตามงาน ==');
  const tb = await p.textContent('#content tbody');
  ok('แท็บ "พร้อมเสนอลูกค้า" = เฉพาะใบที่ Sales เห็นราคาแล้ว (OR) — ไม่มีใบรุ่นเก่าในตาราง', /1 งาน/.test(txt) && /P\.OR/.test(tb) && !/P\.ไทยเบฟ|P\.KKE|P\.CNES/.test(tb), tb.slice(0, 300));
  ok('มีแท็บ "⚠ Sales ยังไม่เห็นราคา (3)"', /Sales ยังไม่เห็นราคา \(3\)/.test(txt));
  ok('KPI พร้อมเสนอลูกค้า = 1 และบอกว่าอีก 3 ใบ Sales ยังไม่เห็นราคา', /อีก 3 ใบ Sales ยังไม่เห็นราคา/.test(txt));
  ok('แถบซ่อมบนหน้านี้: 1 ใบสร้างได้เลย · 2 ใบไม่มีราคาในใบ (ลิงก์เปิดใบ)', /มี 3 ใบ/.test(txt) && /1 ใบสร้างราคาฉบับ Sales ได้เลย/.test(txt) && /2 ใบไม่มีราคาในใบ/.test(txt) && await p.locator('button:has-text("สร้างราคาฉบับ Sales 1 ใบ")').count() === 1, txt.slice(0, 600));
  await p.evaluate(() => { fStatus = 'NOPRICE'; render(); }); await p.waitForTimeout(200);
  txt = await p.textContent('#content');
  ok('แท็บ Sales ยังไม่เห็นราคา: 3 ใบ พร้อมป้ายเตือนข้างสถานะ', /3 งาน/.test(txt) && (txt.match(/Sales ยังไม่เห็นราคา|ยังไม่มีราคาในใบ/g) || []).length >= 4 && /ยังไม่มีราคาในใบ/.test(txt), txt.slice(0, 400));
  const tb2 = await p.textContent('#content tbody');
  ok('คอลัมน์ "รออยู่ที่" ตรงกับแถบซ่อม: 2 ใบที่ไม่มีราคา = "Sourcing ต้องใส่ราคา" · 1 ใบ = "รอสร้างข้อมูลราคาสำหรับ Sales"', (tb2.match(/Sourcing ต้องใส่ราคา/g) || []).length === 2 && (tb2.match(/รอสร้างข้อมูลราคาสำหรับ Sales/g) || []).length === 1, tb2.slice(0, 400));
  if (OUT) await p.screenshot({ path: OUT + '/v52_followup_noprice.png' });
  await p.locator('button:has-text("สร้างราคาฉบับ Sales 1 ใบ")').click(); await p.waitForTimeout(1500);
  const sd = String(QS.rows.find(r => r[0] === 'L1')[qh.indexOf('SalesDetail')]);
  ok('กดสร้าง → L1 มีราคาฉบับ Sales บน server (ไม่มีต้นทุน)', /unitPrice/.test(sd) && !/"up":|"opPct"|"cost"/.test(sd), sd.slice(0, 200));
  ok('L1 ย้ายไป "อนุมัติแล้ว · รอปล่อยราคา" (NON ต้องยืนยันปล่อยราคา) — ยังไม่ขึ้นพร้อมเสนอเอง', fo('L1').owner === 'RELEASER');
  await p.evaluate(() => pollChanges(true)); await p.waitForTimeout(800);
  await p.evaluate(() => { fStatus = 'Approved'; render(); }); await p.waitForTimeout(200);
  txt = await p.textContent('#content');
  ok('หน้าจอ: L1 อยู่ในแท็บรอปล่อยราคา พร้อมป้าย "ยังไม่ปล่อยให้ Sales"', /P\.ไทยเบฟ/.test(txt) && /ยังไม่ปล่อยให้ Sales/.test(txt), txt.slice(0, 300));
  await p.evaluate(() => { fStatus = 'NOPRICE'; render(); }); await p.waitForTimeout(200);
  txt = await p.textContent('#content');
  ok('เหลือ 2 ใบที่ต้องใส่ราคาเอง (ไม่มีปุ่มสร้างให้แล้ว)', /2 งาน/.test(txt) && await p.locator('button:has-text("สร้างราคาฉบับ Sales")').count() === 0);
  console.log('== 3) ข้อมูลอัปเดตเอง (Live / ซิงค์) แล้วจอต้องไม่เด้ง ==');
  const ph = await (await b.newContext({ viewport: { width: 390, height: 760 } })).newPage();
  ph.on('pageerror', e => { console.log('PAGEERROR', e.message); fails++; });
  await ph.route('https://script.google.com/**', async rt => { const r = rt.request(); let body;
    if (r.method() === 'POST') body = ctx.apiPost(r.postData()); else { const u = new URL(r.url()); const g = k => u.searchParams.get(k) || ''; body = ctx.apiGet(g('type'), g('token'), g('id') || g('since')); }
    await rt.fulfill({ status: 200, contentType: 'application/json', body }); });
  await ph.goto(BASE + '/?app=index'); await ph.fill('#loginUser', 'pm'); await ph.fill('#loginPass', 'pw123456'); await ph.click('button:has-text("เข้าสู่ระบบ →")'); await ph.waitForTimeout(2000);
  await ph.evaluate(() => { fWho = 'all'; fStatus = 'all'; go('followup'); }); await ph.waitForTimeout(500);   // v5.4: ดูทั้งทีม (เหมือนเดิม)
  const pos = () => ph.evaluate(() => { const t = document.querySelector('#content .tw'); return { y: window.scrollY, l: t ? t.scrollLeft : -1 }; });
  await ph.evaluate(() => { window.scrollTo(0, 300); const t = document.querySelector('#content .tw'); if (t) t.scrollLeft = 260; });
  const p0 = await pos();
  save('L9', 'SCG', [line]);                                                        // มีคนบันทึกใบใหม่จากอีกเครื่อง
  await ph.evaluate(() => initializeData()); await ph.waitForTimeout(800);
  const p1 = await pos();
  ok('ซิงค์ข้อมูลใหม่ระหว่างอ่านตาราง (มือถือ) → หน้าและตารางที่เลื่อนข้างไว้ไม่เด้งกลับ', p0.l > 0 && p1.l === p0.l && p1.y === p0.y, [p0, p1]);
  await b.close(); srv.close();
  console.log(fails ? '\n' + fails + ' FAILED' : '\nALL v5.2 E2E PASSED'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
