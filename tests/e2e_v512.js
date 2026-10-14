// v5.12 — "ปิดการขายได้" / "ปิดแล้ว" ต้องตรงกับความจริง
//   1) ใบ Won ที่ไม่เคยปล่อยราคาให้ Sales (ตั้งด้วยมือก่อน v5.9) ไม่นับเป็นปิดการขาย
//   2) คำขอ (SR) ที่ทำเป็นใบเสนอราคาแล้ว ไม่ไปอยู่ "ปิดแล้ว" ทั้งที่ใบเสนอราคายังทำราคาอยู่ — แสดงเป็นงานเดียว (การ์ดใบเสนอราคา)
// รัน: NODE_PATH=$(npm root -g) node tests/e2e_v512.js $PWD [out-dir]   (ทดสอบบนเครื่องเท่านั้น ห้าม deploy)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), crypto = require('crypto');
const { makeRuntime } = require('./gasmock');
const { seedSave } = require('./seed');
const [, , DIR, OUT] = process.argv;
const { ctx, sheets } = makeRuntime(DIR + '/Code.gs');
const H = s => crypto.createHash('sha256').update(s + 'mgs-internal-2025').digest('hex');
const U = sheets['Users'], uh = U.rows[0];
[['rin', 'Rinyapat C.', 'Sales'], ['cw', 'Chaiwat P.', 'Sales Manager'], ['src', 'Chatraporn', 'Sourcing'], ['adm', 'Admin', 'Admin']]
  .forEach(([id, n, r]) => { const x = []; x[uh.indexOf('Id')] = id; x[uh.indexOf('Name')] = n; x[uh.indexOf('Role')] = r; x[uh.indexOf('Scope')] = 'all'; x[uh.indexOf('PassHash')] = H('pw123456'); x[uh.indexOf('Email')] = id + '@m.co'; U.rows.push(x); });
const post = p => JSON.parse(ctx.apiPost(JSON.stringify(p)));
const T = {}; ['rin', 'cw', 'src', 'adm'].forEach(u => { T[u] = post({ action: 'login', user: u, passHash: H('pw123456') }).token; });
const hd = (t, c) => ({ title: t, customer: c, salesUserId: 'rin', sales: 'Rinyapat C.', currency: 'THB', groupType: 'Inverter' });
// SR CNES → ทำเป็น QT แล้ว (QT ยังทำราคาอยู่)
seedSave(sheets, { id: 'SR1', docType: 'SR', docNo: 'SR-2610-001', status: 'Quoted', salesUserId: 'rin', sales: 'Rinyapat C.', title: 'CNES', customer: 'CNES', assignedTo: 'src',
  detail: JSON.stringify({ id: 'SR1', docType: 'SR', docNo: 'SR-2610-001', status: 'Quoted', quoteIds: ['Q1'], header: hd('CNES', 'CNES'), lines: [{ desc: 'Inverter', qty: 2 }] }),
  salesDetail: JSON.stringify({ id: 'SR1', docType: 'SR', docNo: 'SR-2610-001', status: 'Quoted', quoteIds: ['Q1'], header: hd('CNES', 'CNES'), lines: [{ desc: 'Inverter', qty: 2 }] }) });
seedSave(sheets, { id: 'Q1', docType: 'QT', docNo: 'QT-IN-2610-001', status: 'In Progress', salesUserId: 'rin', sales: 'Rinyapat C.', title: 'CNES', customer: 'CNES', assignedTo: 'src',
  detail: JSON.stringify({ id: 'Q1', docType: 'QT', status: 'In Progress', srId: 'SR1', header: hd('CNES', 'CNES'), lines: [{ code: 'A', qty: 2, up: 1 }] }), salesDetail: JSON.stringify({ id: 'Q1', srId: 'SR1', lines: [] }) });
// Neoclean: ตั้ง Won ด้วยมือ ไม่เคยอนุมัติ / ปล่อยราคา
seedSave(sheets, { id: 'QW', docType: 'QT', docNo: 'P.IN20261206001', status: 'Won', salesUserId: 'rin', sales: 'Rinyapat C.', title: 'Neoclean', customer: 'Neoclean', total: 0,
  detail: JSON.stringify({ id: 'QW', docType: 'QT', status: 'Won', approvalRoles: [], releasedTo: [], header: hd('Neoclean', 'Neoclean'), lines: [{ code: 'B', qty: 1, up: 1 }] }), salesDetail: '' });
// ปิดการขายจริง: ปล่อยราคาแล้ว → Won
seedSave(sheets, { id: 'QR', docType: 'QT', docNo: 'QT-IN-2610-009', status: 'Won', releasedTo: 'rin', salesUserId: 'rin', sales: 'Rinyapat C.', title: 'Real Deal', customer: 'SCG', total: 500000,
  detail: JSON.stringify({ id: 'QR', docType: 'QT', status: 'Won', approvalRoles: ['Procurement Mgr', 'BD Mgr'], releasedTo: ['rin'], header: hd('Real Deal', 'SCG'), lines: [{ code: 'C', qty: 1, up: 1 }] }),
  salesDetail: JSON.stringify({ id: 'QR', status: 'Won', header: hd('Real Deal', 'SCG'), lines: [{ code: 'C', qty: 1, unitPrice: 500000, amount: 500000 }], total: 500000 }) });

let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 400) : '')); if (!c) fails++; };
console.log('== 0) server ==');
const sv = JSON.parse(ctx.apiGet('salesview', T.rin, '')).quotations, F = id => (sv.find(q => q.id === id) || {}).follow || {};
ok('Won ที่ไม่เคยปล่อยราคา → follow.unpricedWon = true · ป้าย "ปิดงาน — Won แต่ยังไม่เคยปล่อยราคา"', F('QW').unpricedWon === true && /ยังไม่เคยปล่อยราคา/.test(F('QW').label), F('QW'));
ok('Won ที่ปล่อยราคาแล้ว → unpricedWon = false · ป้าย "ปิดการขายได้"', F('QR').unpricedWon === false && F('QR').label === 'ปิดการขายได้', F('QR'));

const files = { '/': fs.readFileSync(DIR + '/Index.html', 'utf8'), '/sales': fs.readFileSync(DIR + '/Sales.html', 'utf8') };
const srv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(files[q.url.split('?')[0].split('#')[0]] || files['/']); }).listen(0);
const BASE = 'http://localhost:' + srv.address().port;
async function page(b, path) {
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  p.on('pageerror', e => { console.log('PAGEERROR', e.message); fails++; });
  await p.route('https://script.google.com/**', async rt => { const r = rt.request(); let body;
    if (r.method() === 'POST') body = ctx.apiPost(r.postData()); else { const u = new URL(r.url()); const g = k => u.searchParams.get(k) || ''; body = ctx.apiGet(g('type'), g('token'), g('id') || g('since')); }
    await rt.fulfill({ status: 200, contentType: 'application/json', body }); });
  await p.goto(BASE + path); await p.waitForTimeout(300); return p;
}
(async () => {
  const b = await chromium.launch();
  console.log('== 1) แอป Sales — หน้าของ Rinyapat (มุมมองผู้จัดการทีมขาย) ==');
  const s = await page(b, '/sales');
  await s.fill('#loginUser', 'cw'); await s.fill('#loginPass', 'pw123456'); await s.click('#loginBtn'); await s.waitForTimeout(1500);
  await s.evaluate(() => go('/sales/rin')); await s.waitForTimeout(500);
  const kpi = async l => s.evaluate(l => { const k = [...document.querySelectorAll('.kpi')].find(x => x.textContent.includes(l)); return k ? k.querySelector('.v').textContent.trim() + ' | ' + k.querySelector('.s').textContent.trim() : ''; }, l);
  ok('"ปิดการขายได้" = 1 ใบ (เฉพาะใบที่ปล่อยราคาแล้ว) มูลค่า ฿500,000', /^1 \|/.test(await kpi('ปิดการขายได้')) && /500,000/.test(await kpi('ปิดการขายได้')), await kpi('ปิดการขายได้'));
  ok('"งานที่เปิดอยู่" = 1 (CNES นับครั้งเดียว — ใบเสนอราคาที่กำลังทำราคา)', /^1 \|/.test(await kpi('งานที่เปิดอยู่')), await kpi('งานที่เปิดอยู่'));
  await s.evaluate(() => { S.filter = 'done'; render(); }); await s.waitForTimeout(300);
  let txt = await s.textContent('#jobList');
  ok('ตัวกรอง "ปิดแล้ว": ไม่มีคำขอ CNES (ยังทำราคาอยู่) · Neoclean ขึ้นว่า "ปิดงาน — ยังไม่เคยปล่อยราคา" ไม่ใช่ "ปิดการขายได้"', !/CNES/.test(txt) && /Neoclean/.test(txt) && /ปิดงาน — ยังไม่เคยปล่อยราคา/.test(txt) &&
    !/Neoclean[\s\S]{0,80}ปิดการขายได้/.test(txt), txt.replace(/\s+/g, ' ').slice(0, 400));
  await s.evaluate(() => { S.filter = 'all'; render(); }); await s.waitForTimeout(300);
  txt = await s.textContent('#jobList');
  ok('CNES แสดงเป็นการ์ดใบเสนอราคาใบเดียว (กำลังทำราคา) พร้อมบอกว่า "จากคำขอ SR-2610-001"', (txt.match(/CNES/g) || []).length === 2 && /จากคำขอ SR-2610-001/.test(txt) && !/จัดทำใบเสนอราคาแล้ว/.test(txt), txt.replace(/\s+/g, ' ').slice(0, 400));
  if (OUT) await s.screenshot({ path: OUT + '/v512_sales_person.png', fullPage: true });
  await s.evaluate(() => go('/team')); await s.waitForTimeout(400);
  ok('หน้าทีมขาย: Rinyapat ปิดการขาย 1 ใบ (ไม่นับ Neoclean)', await s.evaluate(() => { const c = [...document.querySelectorAll('.tcard')].find(x => x.textContent.includes('Rinyapat')); return c ? c.textContent : ''; }).then(t => /(^|\D)1 ?Won/.test(t.replace(/\s+/g, ' '))),
    await s.evaluate(() => { const c = [...document.querySelectorAll('.tcard')].find(x => x.textContent.includes('Rinyapat')); return c ? c.textContent.replace(/\s+/g, ' ') : ''; }));

  console.log('== 2) ระบบทำราคา (Admin) ==');
  const a = await page(b, '/?app=index');
  await a.fill('#loginUser', 'adm'); await a.fill('#loginPass', 'pw123456'); await a.click('button:has-text("เข้าสู่ระบบ →")'); await a.waitForTimeout(1800);
  const r = await a.evaluate(() => ({ won: QUOTES.filter(isWonSale).map(q => q.id), warn: statusWarn(QUOTES.find(q => q.id === 'QW')), ball: ballOf(QUOTES.find(q => q.id === 'QW')).label,
    opts: allowedNextStatuses(QUOTES.find(q => q.id === 'QW')) }));
  ok('นับปิดการขายได้เฉพาะ QR · Neoclean ขึ้นป้ายเตือน "Won แต่ยังไม่เคยปล่อยราคา"', r.won.join() === 'QR' && /Won แต่ยังไม่เคยปล่อยราคา/.test(r.warn) && /ยังไม่เคยปล่อยราคา/.test(r.ball), r);
  ok('…เปลี่ยน Neoclean เป็น Closed ได้ (แก้ข้อมูล)', r.opts.includes('Closed'), r.opts);
  await b.close(); srv.close();
  console.log(fails ? fails + ' FAILED' : 'ALL v5.12 E2E PASSED'); process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL crash', e && e.stack); process.exit(1); });
