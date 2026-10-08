const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), crypto = require('crypto');
const { makeRuntime } = require('./gasmock');
const [, , DIR, OUT] = process.argv;
const { ctx, sheets } = makeRuntime(DIR + '/Code.gs');
const H = s => crypto.createHash('sha256').update(s + 'mgs-internal-2025').digest('hex');
const U = sheets['Users'], h = U.rows[0];
const add = (id, name, role, email, pw) => { const r = []; r[h.indexOf('Id')] = id; r[h.indexOf('Name')] = name; r[h.indexOf('Role')] = role; r[h.indexOf('Scope')] = 'all'; r[h.indexOf('PassHash')] = H(pw || 'secret99'); r[h.indexOf('Email')] = email; U.rows.push(r); };
add('admin', 'Admin', 'Admin', 'admin@mgs.co'); add('sourcing1', 'Chatraporn', 'Sourcing', 'chat@mgs.co');
add('sales_boss', 'BOSS', 'Sales', 'boss@mgs.co', '1234'); add('sales_pair', 'PAIR', 'Sales', 'pair@mgs.co'); add('salesmgr', 'Tom', 'Sales Manager', 'tom@mgs.co');
const post = p => JSON.parse(ctx.apiPost(JSON.stringify(p)));
// a released QT for BOSS
const tS = post({ action: 'login', user: 'sourcing1', passHash: H('secret99') }).token;
const now = new Date().toISOString(), today = now.slice(0, 10);
const qd = { id: 'Q1', docType: 'QT', docNo: 'QT-IN-2610-001', status: 'Pending', releasedTo: ['sales_boss'], approvalRoles: ['Procurement Mgr', 'BD Mgr'], header: { title: 'Factory Rooftop', customer: 'CP Group', salesUserId: 'sales_boss', sales: 'BOSS', currency: 'THB', incoterm: 'CIF at MGS', validity: 30, groupType: 'Inverter' }, lines: [{ code: 'SG110CX', desc: 'Inverter', qty: 2, up: 3000, costCur: 'USD', opPct: 20 }], remarks: [], auditLogs: [] };
const sd = { id: 'Q1', docType: 'QT', docNo: 'QT-IN-2610-001', status: 'Pending', releasedTo: ['sales_boss'], header: qd.header, lines: [{ code: 'SG110CX', desc: 'Inverter 110kW', qty: 2, uom: 'pcs', unitPrice: 135000, amount: 270000, warranty: '10 YEAR' }], total: 270000, extrasTotal: 0, remarks: ['Price valid 30 days'] };
post({ token: tS, action: 'save', id: 'Q1', docNo: 'QT-IN-2610-001', status: 'Pending', salesUserId: 'sales_boss', releasedTo: 'sales_boss', title: 'Factory Rooftop', customer: 'CP Group', total: 270000, gp: 20, detail: JSON.stringify(qd), salesDetail: JSON.stringify(sd) });

const files = { '/': fs.readFileSync(DIR + '/Index.html', 'utf8'), '/sales': fs.readFileSync(DIR + '/Sales.html', 'utf8') };
const srv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(files[q.url.split('?')[0].split('#')[0]] || files['/']); }).listen(0);
const BASE = 'http://localhost:' + srv.address().port;
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && x !== undefined ? '  -> ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
async function page(browser, path, vp) {
  const c = await browser.newContext({ viewport: vp || { width: 1366, height: 900 } }); const p = await c.newPage();
  p.on('pageerror', e => { console.log('PAGEERROR', e.message, (e.stack || '').split('\n')[1]); fails++; });
  await p.route('https://script.google.com/**', async route => { const r = route.request(); let body;
    if (r.method() === 'POST') body = ctx.apiPost(r.postData()); else { const u = new URL(r.url()); const g = k => u.searchParams.get(k) || ''; body = ctx.apiGet(g('type'), g('token'), g('id') || g('since')); }
    await route.fulfill({ status: 200, contentType: 'application/json', body }); });
  await p.goto(BASE + path); await p.waitForTimeout(300); return p;
}
async function salesLogin(p, email, pw) { await p.fill('#loginUser', email); await p.fill('#loginPass', pw); await p.click('#loginBtn'); await p.waitForTimeout(1200); }
(async () => {
  const b = await chromium.launch();
  // 1) Sales BOSS — email login
  const boss = await page(b, '/sales', { width: 390, height: 844 });
  await salesLogin(boss, 'BOSS@mgs.co', 'wrong'); ok('wrong password shows error', (await boss.textContent('#loginErr')).includes('ไม่ถูกต้อง'));
  await salesLogin(boss, 'BOSS@mgs.co', '1234');
  ok('factory password → forced change-password modal', (await boss.textContent('#modalRoot')).includes('ตั้งรหัสผ่านใหม่'));
  await boss.fill('#pw_new', 'bossPass9'); await boss.fill('#pw_new2', 'bossPass9'); await boss.click('#modalRoot button:has-text("บันทึก")'); await boss.waitForTimeout(500);
  ok('password changed on server', post({ action: 'login', user: 'boss@mgs.co', passHash: H('bossPass9') }).ok);
  let t = await boss.textContent('#main');
  ok('BOSS lands on "งานของฉัน"', t.includes('งานของฉัน') && t.includes('Factory Rooftop'), t.slice(0, 200));
  ok('released price visible on card (฿270,000)', t.includes('270,000'));
  await boss.screenshot({ path: OUT + '/s1_my_jobs_mobile.png', fullPage: true });
  await boss.click('button:has-text("ดูราคา")'); await boss.waitForTimeout(200);
  t = await boss.textContent('#modalRoot');
  ok('price modal: unit price + total, no cost', t.includes('135,000.00') && t.includes('270,000.00') && !/3,000|%GP|ต้นทุน/.test(t), t.slice(0, 300));
  await boss.click('#modalRoot button:has-text("ปิด")');
  // update progress
  await boss.click('button:has-text("อัปเดตความคืบหน้า")'); await boss.waitForTimeout(200);
  await boss.fill('#up_note', 'ลูกค้าขอลด 3%'); await boss.fill('#up_date', '2026-10-20'); await boss.click('#upBtn'); await boss.waitForTimeout(500);
  const qrow = sheets['Quotations'].rows.find(r => r[sheets['Quotations'].rows[0].indexOf('Id')] === 'Q1');
  const det = JSON.parse(qrow[sheets['Quotations'].rows[0].indexOf('Detail')]);
  ok('progress update stored via salesPatch (Detail.salesUpdate)', det.salesUpdate && det.salesUpdate.note === 'ลูกค้าขอลด 3%' && det.followUpDate === '2026-10-20', JSON.stringify(det.salesUpdate));
  // 2) new price request
  await boss.evaluate(() => newRequest()); await boss.waitForTimeout(300);
  await boss.fill('#f_customer', 'Thaibev'); await boss.fill('#main input[placeholder^="เช่น Thaibev"]', 'Thaibev Solar 1MW');
  await boss.fill('#lineBox input[list="prodList"]', 'MSSR-SGMeteo01'); await boss.dispatchEvent('#lineBox input[list="prodList"]', 'change'); await boss.waitForTimeout(150);
  ok('catalog pick fills description', (await boss.inputValue('#ld_0')).includes('Meteo'));
  await boss.click('button:has-text("+ เพิ่มรายการ")'); await boss.fill('#ld_1', 'Mounting kit custom'); 
  await boss.screenshot({ path: OUT + '/s2_request_form_mobile.png', fullPage: true });
  await boss.click('#btnSend'); await boss.waitForTimeout(1200);
  t = await boss.textContent('#main');
  const ym = new Date().toISOString().slice(2, 4) + new Date().toISOString().slice(5, 7);
  ok('SR created with server number and shown on my page', t.includes('SR-' + ym + '-001') && t.includes('รอ Sourcing รับคำขอราคา'), t.slice(0, 400));
  // guard: BOSS cannot open PAIR page
  await boss.evaluate(() => go('/sales/sales_pair')); await boss.waitForTimeout(200);
  ok('Sales cannot open another salesperson page (redirect to own)', (await boss.textContent('#main')).includes('งานของฉัน'));
  ok('Sales has no team tab', !(await boss.textContent('#bnav')).includes('ทีมขาย'));

  // 3) Sourcing in Index sees the SR and takes it
  const src = await page(b, '/');
  await src.fill('#loginUser', 'chat@mgs.co'); await src.fill('#loginPass', 'secret99'); await src.click('button:has-text("เข้าสู่ระบบ")'); await src.waitForTimeout(1800);
  ok('Index: Sourcing logs in by email (first time on this device)', await src.evaluate(() => !!CURRENT && CURRENT.id === 'sourcing1'));
  const srLocal = await src.evaluate(() => { const q = QUOTES.find(x => x.docType === 'SR' && x.header.customer === 'Thaibev'); return q ? { st: q.status, need: srAwaitingIntake(q), lines: q.lines.length, desc: q.lines[0].desc, owner: q.header.salesUserId } : null; });
  ok('SR appears in Sourcing queue with lines + owner', srLocal && srLocal.need && srLocal.lines === 2 && srLocal.desc.includes('Meteo') && srLocal.owner === 'sales_boss', JSON.stringify(srLocal));
  await src.evaluate(() => { closeModal(); takeSRAndCost(QUOTES.find(x => x.docType === 'SR' && x.header.customer === 'Thaibev').id); }); await src.waitForTimeout(1200);
  await boss.evaluate(() => poll(true)); await boss.waitForTimeout(800);
  t = await boss.textContent('#main');
  ok('Sales page shows SR picked up by Sourcing (live)', /ทำใบเสนอราคาแล้ว/.test(t) && t.includes('รอ Sourcing จัดทำราคา'), JSON.stringify(await boss.evaluate(() => Object.values(S.rows).map(r => [r.docNo, r.status, r.follow && r.follow.label, stageOf(r).key]))) + ' | filter=' + await boss.evaluate(() => S.filter));

  // 4) Sales Manager: team page + per-salesperson page
  const mgr = await page(b, '/sales');
  await salesLogin(mgr, 'tom@mgs.co', 'secret99');
  await mgr.evaluate(() => go('/team')); await mgr.waitForTimeout(300);
  t = await mgr.textContent('#main');
  ok('Sales Manager team page lists BOSS + PAIR', t.includes('BOSS') && t.includes('PAIR') && t.includes('boss@mgs.co'), t.slice(0, 300));
  await mgr.screenshot({ path: OUT + '/s3_team.png' });
  await mgr.click('.tcard:has-text("BOSS")'); await mgr.waitForTimeout(300);
  t = await mgr.textContent('#main');
  ok('opens BOSS page with his jobs', t.includes('หน้าของ BOSS') && t.includes('Factory Rooftop') && t.includes('Thaibev'));
  await mgr.screenshot({ path: OUT + '/s4_person_page.png', fullPage: true });

  // 5) Admin: Index users page with Email + roles + add user
  const adm = await page(b, '/');
  await adm.fill('#loginUser', 'admin@mgs.co'); await adm.fill('#loginPass', 'secret99'); await adm.click('button:has-text("เข้าสู่ระบบ")'); await adm.waitForTimeout(1800);
  await adm.evaluate(() => { closeModal(); go('users'); }); await adm.waitForTimeout(400);
  t = await adm.textContent('#content');
  ok('users page shows Email column + role groups', t.includes('อีเมล (ใช้ล็อกอิน)') && t.includes('Sales Manager') && t.includes('ผู้บริหาร (Manager)'));
  await adm.screenshot({ path: OUT + '/s5_users.png' });
  await adm.click('button:has-text("+ เพิ่มผู้ใช้")'); await adm.fill('#nu_name', 'Pim'); await adm.fill('#nu_email', 'boss@mgs.co'); await adm.click('#modalRoot button:has-text("เพิ่มผู้ใช้")'); await adm.waitForTimeout(300);
  ok('add user rejects duplicate email', (await adm.textContent('#nu_err')).includes('มีผู้ใช้อยู่แล้ว'));
  await adm.fill('#nu_email', 'pim@mgs.co'); await adm.click('#modalRoot button:has-text("เพิ่มผู้ใช้")'); await adm.waitForTimeout(800);
  ok('new Sales user saved to sheet with email', JSON.parse(ctx.apiGet('users', post({ action: 'login', user: 'admin', passHash: H('secret99') }).token, '')).users.some(u => u.id === 'pim' && u.email === 'pim@mgs.co' && u.role === 'Sales'));
  ok('new user can log in to Sales app by email', post({ action: 'login', user: 'pim@mgs.co', passHash: H('1234') }).ok);
  // Sales user trying the Index app → redirected to Sales app notice
  const s2 = await page(b, '/');
  await s2.fill('#loginUser', 'pair@mgs.co'); await s2.fill('#loginPass', 'secret99'); await s2.click('button:has-text("เข้าสู่ระบบ")'); await s2.waitForTimeout(1500);
  ok('Sales in Index → "use Sales app" notice, no session', (await s2.textContent('#modalRoot')).includes('แอป Sales') && await s2.evaluate(() => !CURRENT));
  console.log(fails ? '\n' + fails + ' FAILED' : '\nALL SALES E2E PASSED');
  await b.close(); srv.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
