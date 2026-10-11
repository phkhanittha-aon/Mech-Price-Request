// v5.0 — หน้าจอจริง: แถบขั้นตอน (มือถือ) · อนุมัติ 2 ระดับ · GM อนุมัติแทน · คำขอส่งถึง Sourcing ตามกลุ่มสินค้า
// รัน: NODE_PATH=$(npm root -g) node tests/e2e_v50.js $PWD [out-dir]   (ทดสอบบนเครื่องเท่านั้น ห้าม deploy)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), crypto = require('crypto');
const { makeRuntime } = require('./gasmock');
const [, , DIR, OUT] = process.argv;
const { ctx, sheets } = makeRuntime(DIR + '/Code.gs');
const H = s => crypto.createHash('sha256').update(s + 'mgs-internal-2025').digest('hex');
const U = sheets['Users'], uh = U.rows[0];
[['src', 'Chatraporn', 'Sourcing', JSON.stringify(['INVERTER', 'BATTERY', 'Energy storage', 'EV Charger'])], ['src2', 'Napasorn', 'Sourcing', JSON.stringify(['MOUNTING', 'Carport', 'DC CABLE'])],
 ['pm', 'Procure', 'Sourcing Manager', 'all'], ['bd', 'BD', 'BD Mgr', 'all'], ['gm', 'GM', 'GM', 'all'], ['boss', 'BOSS', 'Sales', 'all'], ['sales_non', 'NON', 'Sales', 'all']]
  .forEach(([id, n, r, sc]) => { const x = []; x[uh.indexOf('Id')] = id; x[uh.indexOf('Name')] = n; x[uh.indexOf('Role')] = r; x[uh.indexOf('Scope')] = sc; x[uh.indexOf('PassHash')] = H('pw123456'); x[uh.indexOf('Email')] = id + '@m.co'; U.rows.push(x); });
const post = p => JSON.parse(ctx.apiPost(JSON.stringify(p)));
const tok = u => post({ action: 'login', user: u, passHash: H('pw123456') }).token;
const T = { src: tok('src'), pm: tok('pm'), boss: tok('boss') };
post({ token: T.boss, action: 'saveSR', id: 'SR1', status: 'Submitted', detail: JSON.stringify({ status: 'Submitted', header: { title: 'Carport โรงงาน', customer: 'CP Group', groupType: 'Mounting', needBy: '2026-10-30' }, lines: [{ desc: 'Carport 2 คัน', qty: 4, uom: 'set' }] }) });
const hd = { title: 'Factory Rooftop', customer: 'CP Group', salesUserId: 'boss', sales: 'BOSS', currency: 'THB', groupType: 'Inverter' };
const qt = (id, status, roles) => post({ token: T.src, action: 'save', id, docType: 'QT', docNo: 'QT-IN-' + id, status, salesUserId: 'boss', assignedTo: 'src', title: 'Rooftop ' + id, customer: 'CP Group', total: 270000, gp: 20,
  detail: JSON.stringify({ id, _v: 2, _pm: 2, _sv: 3, docType: 'QT', docNo: 'QT-IN-' + id, status, approvalRoles: roles || [], approvals: [], releasedTo: [], header: Object.assign({}, hd, { title: 'Rooftop ' + id }), lines: [{ code: 'SG110CX', desc: 'Inverter', qty: 2, up: 3000, costCur: 'THB', opPct: 20 }], remarks: [], auditLogs: [] }),
  salesDetail: JSON.stringify({ id, status, header: hd, lines: [{ code: 'SG', desc: 'Inv', qty: 2, uom: 'pcs', unitPrice: 135000, amount: 270000 }], total: 270000 }) });
qt('A1', 'Submitted'); qt('A2', 'Submitted'); post({ token: T.pm, action: 'approve', id: 'A2' });
const files = { '/': fs.readFileSync(DIR + '/Index.html', 'utf8'), '/sales': fs.readFileSync(DIR + '/Sales.html', 'utf8') };
const srv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(files[q.url.split('?')[0].split('#')[0]] || files['/']); }).listen(0);
const BASE = 'http://localhost:' + srv.address().port;
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const PHONE = { width: 375, height: 812 };
async function page(b, path, vp) {
  const p = await (await b.newContext({ viewport: vp || { width: 1280, height: 860 } })).newPage();
  p.on('pageerror', e => { console.log('PAGEERROR', e.message); fails++; });
  await p.route('https://script.google.com/**', async rt => { const r = rt.request(); let body;
    if (r.method() === 'POST') body = ctx.apiPost(r.postData()); else { const u = new URL(r.url()); const g = k => u.searchParams.get(k) || ''; body = ctx.apiGet(g('type'), g('token'), g('id') || g('since')); }
    await rt.fulfill({ status: 200, contentType: 'application/json', body }); });
  await p.goto(BASE + path); await p.waitForTimeout(300); return p;
}
async function loginIndex(b, user, vp) {
  const s = await page(b, '/?app=index', vp);
  await s.fill('#loginUser', user); await s.fill('#loginPass', 'pw123456'); await s.click('button:has-text("เข้าสู่ระบบ →")'); await s.waitForTimeout(2000); return s;
}
const noHScroll = p => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const shot = async (p, n) => { if (OUT) await p.screenshot({ path: OUT + '/v50_' + n + '.png', fullPage: false }); };
(async () => {
  const b = await chromium.launch();
  console.log('== แอป Sales (มือถือ 375px) ==');
  const sp = await page(b, '/sales?app=sales', PHONE);
  await sp.fill('#loginUser', 'boss@m.co'); await sp.fill('#loginPass', 'pw123456'); await sp.click('#loginBtn'); await sp.waitForTimeout(1800);
  const srCard = sp.locator('.job', { hasText: 'Carport โรงงาน' });
  ok('การ์ดคำขอ: มีแถบขั้นตอน · อยู่ขั้นที่ 2 (Sourcing ทำราคา) · บอกว่าส่งถึง Napasorn + ผู้ดำเนินการ + ครบกำหนด', await srCard.locator('.flow-steps li').count() === 5 && await srCard.locator('.flow-steps li.now').count() === 1 &&
    await srCard.locator('.flow-steps li').nth(1).evaluate(e => e.classList.contains('now')) && /ส่งถึง Napasorn/.test(await srCard.textContent()) && /👤 Napasorn/.test(await srCard.textContent()) && /ครบกำหนด/.test(await srCard.textContent()), await srCard.textContent());
  const a2 = sp.locator('.job', { hasText: 'Rooftop A2' });
  ok('การ์ดใบเสนอราคา: อยู่ขั้น BD Manager · ไม่มีราคา (ยังไม่ปล่อย)', await a2.locator('.flow-steps li').nth(3).evaluate(e => e.classList.contains('now')) && /รอ BD Manager อนุมัติ/.test(await a2.textContent()) && !/270,000/.test(await a2.textContent()), await a2.textContent());
  ok('มือถือ: ไม่มีเลื่อนซ้าย-ขวา', await noHScroll(sp));
  await shot(sp, 'sales_phone_list');
  await a2.locator('button:has-text("ดูรายละเอียด")').click(); await sp.waitForTimeout(300);
  const md = await sp.textContent('#modalRoot');
  ok('รายละเอียด: แถบขั้นตอนเต็ม (ชื่อขั้น) + ผู้ดำเนินการ BD + ยังไม่เห็นราคา', /Sourcing Manager/.test(md) && /BD Manager/.test(md) && /👤 BD Manager · BD/.test(md) && !/270,000/.test(md), md.slice(0, 300));
  ok('รายละเอียดบนมือถือไม่ล้นจอ', await noHScroll(sp));
  await shot(sp, 'sales_phone_detail');

  console.log('== ระบบทำราคา: อนุมัติ 2 ระดับ (มือถือ 375px) ==');
  const bd = await loginIndex(b, 'bd', PHONE);
  let txt = await bd.textContent('#content');
  ok('BD: หน้ารออนุมัติ — A2 (ผ่านระดับ 1 แล้ว) อยู่ใน "รอคุณ" · A1 (ยังรอระดับ 1) อยู่ใน "อยู่ระหว่างอนุมัติ" ไม่มีปุ่ม', /รอคุณอนุมัติ \(1\)/.test(txt) && /อยู่ระหว่างอนุมัติ \(1\)/.test(txt) &&
    await bd.locator('.acard', { hasText: 'QT-IN-A1' }).locator('button').count() === 0, txt.slice(0, 300));
  ok('มือถือ: การ์ดอนุมัติไม่ล้นจอ · ปุ่มเต็มความกว้าง', await noHScroll(bd) && await bd.locator('.acard', { hasText: 'QT-IN-A2' }).locator('.ac-acts .btn').evaluate(e => e.getBoundingClientRect().width > 200));
  await shot(bd, 'index_phone_approvals');
  await bd.locator('.acard', { hasText: 'QT-IN-A2' }).locator('button:has-text("อนุมัติ ระดับ 2")').click(); await bd.waitForTimeout(900);
  ok('BD กดอนุมัติระดับ 2 → Approved (server)', String(sheets['Quotations'].rows.find(r => r[0] === 'A2')[uh.length ? sheets['Quotations'].rows[0].indexOf('Status') : 0]) === 'Approved');
  await bd.evaluate(() => openQuote('A1')); await bd.waitForTimeout(600);
  txt = await bd.textContent('#content');
  ok('BD เปิด A1: ไม่มีปุ่มอนุมัติ · บอกว่ารอ Sourcing Manager (ระดับ 1) ก่อน · มีแถบขั้นตอน', !(await bd.locator('button:has-text("อนุมัติ ระดับ")').count()) && /รอ Sourcing Manager \(ระดับ 1\) ก่อน/.test(txt) && await bd.locator('.flow-steps li.now').count() === 1, txt.slice(0, 300));

  console.log('== GM อนุมัติแทน ==');
  const gm = await loginIndex(b, 'gm');
  await gm.evaluate(() => openQuote('A1')); await gm.waitForTimeout(600);
  ok('GM เห็นปุ่ม "อนุมัติแทน ระดับ 1" และ "แทนทั้ง 2 ระดับ"', await gm.locator('button:has-text("อนุมัติแทน ระดับ 1")').count() === 1 && await gm.locator('button:has-text("แทนทั้ง 2 ระดับ")').count() === 1);
  await gm.locator('button:has-text("แทนทั้ง 2 ระดับ")').click(); await gm.waitForTimeout(900);
  const dA1 = JSON.parse(sheets['Quotations'].rows.find(r => r[0] === 'A1')[sheets['Quotations'].rows[0].indexOf('Detail')]);
  ok('GM แทนทั้ง 2 ระดับ → Approved · ประวัติ 2 บรรทัด "อนุมัติแทน"', dA1.status === 'Approved' && dA1.approvals.length === 2 && dA1.approvals.every(a => a.onBehalfOf), dA1.approvals);

  console.log('== คิวคำขอราคาของ Sourcing ==');
  const s2 = await loginIndex(b, 'src2');
  await s2.evaluate(() => go('srqueue')); await s2.waitForTimeout(500);
  txt = await s2.textContent('#content');
  ok('Napasorn: คิวเริ่มที่ "ส่งถึงฉัน" · เห็น SR1 พร้อมป้าย "ส่งถึงคุณ" + ปุ่มส่งต่อ', /ส่งถึงฉัน \(1\)/.test(txt) && /ส่งถึงคุณ/.test(txt) && /Carport โรงงาน/.test(txt) && await s2.locator('button:has-text("ส่งต่อ")').count() >= 1, txt.slice(0, 400));
  const s1 = await loginIndex(b, 'src');
  await s1.evaluate(() => go('srqueue')); await s1.waitForTimeout(500);
  ok('Chatraporn: "ส่งถึงฉัน" ว่าง (คำขอ Mounting ไม่ได้ส่งถึง) · กด "ทั้งหมด" แล้วเห็น', /ไม่มีคำขอที่ส่งถึงคุณ/.test(await s1.textContent('#content')) &&
    (await s1.evaluate(() => { srqMine = 'all'; render(); return /Carport โรงงาน/.test(document.getElementById('content').textContent) && /Napasorn/.test(document.getElementById('content').textContent); })));
  await s2.locator('button:has-text("ส่งต่อ")').first().click(); await s2.waitForTimeout(200);
  await s2.selectOption('#fwdTo', 'src'); await s2.click('#modalRoot button:has-text("ส่งต่อ")'); await s2.waitForTimeout(1200);
  const dSR = JSON.parse(sheets['Quotations'].rows.find(r => r[0] === 'SR1')[sheets['Quotations'].rows[0].indexOf('Detail')]);
  ok('ส่งต่อให้ Chatraporn → server บันทึก routedTo=src (manual)', dSR.routedTo === 'src' && dSR.routedWhy === 'manual', [dSR.routedTo, dSR.routedWhy]);

  console.log('== ตั้งค่าผู้รับตามกลุ่มงาน ==');
  const pm = await loginIndex(b, 'pm');
  await pm.evaluate(() => go('settings')); await pm.waitForTimeout(500);
  txt = await pm.textContent('#content');
  ok('หน้า ⚙️ ตั้งค่า: ตาราง "คำขอราคาส่งถึงใคร" · Mounting → Napasorn · Inverter → Chatraporn', /คำขอราคาส่งถึงใคร/.test(txt) &&
    await pm.evaluate(() => autoRouteOf('Mounting').name === 'Napasorn' && autoRouteOf('Inverter').name === 'Chatraporn'), txt.slice(0, 200));
  ok('ชื่อที่แสดง: Sourcing Manager (role Procurement Mgr)', await pm.evaluate(() => roleTH(CURRENT.role) === 'Sourcing Manager'));
  await b.close(); srv.close();
  console.log(fails ? '\n' + fails + ' FAILED' : '\nALL v5.0 E2E PASSED'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
