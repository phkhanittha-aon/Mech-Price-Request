// v5.9 — หน้าจอจริง: ไม่มีโค้ดแปลกปลอมรันจากข้อมูลในชีท · ปุ่ม/ตัวเลือกตรงกับกติกาของ server · server ปฏิเสธถาวร = ไม่เข้าคิวซ้ำ
// รัน: NODE_PATH=$(npm root -g) node tests/e2e_v59.js $PWD [out-dir]   (ทดสอบบนเครื่องเท่านั้น ห้าม deploy)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), crypto = require('crypto');
const { makeRuntime } = require('./gasmock');
const { seedSave } = require('./seed');
const [, , DIR, OUT] = process.argv;
const { ctx, sheets } = makeRuntime(DIR + '/Code.gs');
const H = s => crypto.createHash('sha256').update(s + 'mgs-internal-2025').digest('hex');
const U = sheets['Users'], uh = U.rows[0];
[['src', 'Chatraporn', 'Sourcing'], ['pm', 'Procure', 'Procurement Mgr'], ['bd', 'BD', 'BD Mgr'], ['gm', 'GM', 'GM'], ['boss', 'BOSS', 'Sales'], ['sales_non', 'NON', 'Sales'], ['smgr', 'SalesMgr', 'Sales Manager']]
  .forEach(([id, n, r]) => { const x = []; x[uh.indexOf('Id')] = id; x[uh.indexOf('Name')] = n; x[uh.indexOf('Role')] = r; x[uh.indexOf('Scope')] = 'all'; x[uh.indexOf('PassHash')] = H('pw123456'); x[uh.indexOf('Email')] = id + '@m.co'; U.rows.push(x); });
const post = p => JSON.parse(ctx.apiPost(JSON.stringify(p)));
const tok = u => post({ action: 'login', user: u, passHash: H('pw123456') }).token;
tok('src');
// ข้อมูลเดิมในชีท (ก่อน v5.9 ยังกรองไม่ได้) ที่มีโค้ดฝังอยู่ทุกช่อง รวมถึง id
const X = n => '<img src=x onerror="window.__xss=(window.__xss||0)+1;window.__w=(window.__w||[]).concat(' + n + ')">';
const EVIL = "e1');window.__xss=(window.__xss||0)+100;('";
const srDoc = id => ({ id, docType: 'SR', docNo: 'SR-2610-0' + id.length, status: 'Submitted', created: X(1), header: { title: 'SRX ' + id, customer: 'CP', salesUserId: 'boss', sales: 'BOSS', groupType: 'Inverter',
  needBy: X(2), reqDate: '"><img src=x onerror="window.__xss=(window.__xss||0)+1;window.__w=(window.__w||[]).concat(3)">', offerDate: X(4) }, lines: [{ desc: 'Inverter', qty: 1 }] });
seedSave(sheets, { id: 'SRX', docType: 'SR', docNo: 'SR-2610-001', status: 'Submitted', salesUserId: 'boss', sales: 'BOSS', title: 'SRX', customer: 'CP', detail: JSON.stringify(srDoc('SRX')), salesDetail: JSON.stringify(srDoc('SRX')) });
seedSave(sheets, { id: EVIL, docType: 'SR', docNo: 'SR-2610-002', status: 'Submitted', salesUserId: 'boss', sales: 'BOSS', title: 'EVILID', customer: 'CP', detail: JSON.stringify(Object.assign(srDoc(EVIL), { header: { title: 'EVILID', customer: 'CP', salesUserId: 'boss', groupType: 'Inverter' } })) });
const qd = (id, status, extra) => Object.assign({ id, _v: 2, _pm: 2, _sv: 3, docType: 'QT', docNo: 'QT-' + id, status, round: 1, approvalRoles: ['Procurement Mgr', 'BD Mgr'], approvals: [], releasedTo: status === 'Pending' ? ['boss'] : [],
  header: { ref: 'QT-' + id, title: 'Rooftop ' + id, customer: 'CP Group', salesUserId: 'boss', sales: 'BOSS', currency: 'THB', groupType: 'Inverter', rates: { USD: 36, CNY: 5 }, offerDate: '2026-10-14', validity: 30 },
  lines: [{ code: 'SG110CX', desc: 'Inverter', qty: 2, uom: 'pcs', up: 3000, costCur: 'THB', opPct: 20 }], remarks: [], auditLogs: [] }, extra || {});
const sd = (id, status) => JSON.stringify({ id, status, header: { title: 'Rooftop ' + id, salesUserId: 'boss' }, lines: [{ code: 'SG110CX', qty: 2, unitPrice: 3750, amount: 7500 }], total: 7500 });
seedSave(sheets, { id: 'QP', docType: 'QT', docNo: 'QT-QP', status: 'Pending', releasedTo: 'boss', salesUserId: 'boss', title: 'Rooftop QP', customer: 'CP Group', total: 7500, detail: JSON.stringify(qd('QP', 'Pending')), salesDetail: sd('QP', 'Pending') });
seedSave(sheets, { id: 'QA', docType: 'QT', docNo: 'QT-QA', status: 'Approved', salesUserId: 'boss', title: 'Rooftop QA', customer: 'CP Group', total: 7500, detail: JSON.stringify(qd('QA', 'Approved')), salesDetail: sd('QA', 'Approved') });
seedSave(sheets, { id: 'QI', docType: 'QT', docNo: 'QT-QI', status: 'In Progress', salesUserId: 'boss', title: 'Rooftop QI', customer: 'CP Group', total: 7500, detail: JSON.stringify(qd('QI', 'In Progress', { approvalRoles: [] })), salesDetail: sd('QI', 'In Progress') });

const files = { '/': fs.readFileSync(DIR + '/Index.html', 'utf8'), '/sales': fs.readFileSync(DIR + '/Sales.html', 'utf8') };
const srv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(files[q.url.split('?')[0].split('#')[0]] || files['/']); }).listen(0);
const BASE = 'http://localhost:' + srv.address().port;
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 400) : '')); if (!c) fails++; };
const posts = [];
async function page(b, path, vp) {
  const p = await (await b.newContext({ viewport: vp || { width: 1366, height: 900 } })).newPage();
  p.on('pageerror', e => { console.log('PAGEERROR', e.message); fails++; });
  await p.route('https://script.google.com/**', async rt => { const r = rt.request(); let body;
    if (r.method() === 'POST') { posts.push(JSON.parse(r.postData())); body = ctx.apiPost(r.postData()); } else { const u = new URL(r.url()); const g = k => u.searchParams.get(k) || ''; body = ctx.apiGet(g('type'), g('token'), g('id') || g('since')); }
    await rt.fulfill({ status: 200, contentType: 'application/json', body }); });
  await p.goto(BASE + path); await p.waitForTimeout(300); return p;
}
async function loginIndex(b, user) {
  const s = await page(b, '/?app=index');
  await s.fill('#loginUser', user); await s.fill('#loginPass', 'pw123456'); await s.click('button:has-text("เข้าสู่ระบบ →")'); await s.waitForTimeout(1800); return s;
}
const xss = p => p.evaluate(() => ({ n: window.__xss || 0, w: window.__w || [] }));

(async () => {
  const b = await chromium.launch();
  console.log('== 1) ข้อมูลที่มีโค้ดฝัง (ข้อมูลเดิมในชีท) ไม่รันบนเครื่อง Sourcing ==');
  const s = await loginIndex(b, 'src');
  for (const r of ['dashboard', 'srqueue', 'quotes', 'followup']) { await s.evaluate(r => go(r), r); await s.waitForTimeout(250); }
  ok('ทุกหน้าหลัก: ไม่มีโค้ดรัน (needBy / reqDate / created)', (await xss(s)).n === 0, await xss(s));
  await s.evaluate(() => { go('srqueue'); srqMine = 'all'; render(); }); await s.waitForTimeout(300);
  const ev = s.locator('#content td:has-text("EVILID")').first();
  if (await ev.count()) { await ev.click(); await s.waitForTimeout(400); }
  ok('คลิกแถวที่ id มีโค้ด → เปิดใบตามปกติ ไม่มีโค้ดรัน', (await xss(s)).n === 0 && await s.evaluate(() => route) === 'preview', [await xss(s), await s.evaluate(() => route)]);
  await s.evaluate(() => openQuote('SRX')); await s.waitForTimeout(400);
  ok('เปิดดู SR (Offer / ต้องการภายใน) → ไม่มีโค้ดรัน · ข้อความแสดงเป็นตัวอักษร', (await xss(s)).n === 0 && /<img src=x/.test(await s.textContent('#content')), await xss(s));
  await s.evaluate(() => { try { createQTFromSR('SRX'); } catch (e) {} }); await s.waitForTimeout(600);
  ok('สร้าง QT จาก SR (วันที่ขอราคาในช่อง input) → ไม่มีโค้ดรัน', (await xss(s)).n === 0, await xss(s));
  if (OUT) await s.screenshot({ path: OUT + '/v59_srqueue_xss.png' });

  console.log('== 2) ปุ่ม / ตัวเลือกตรงกับกติกาของ server ==');
  await s.evaluate(() => { go('quotes'); }); await s.waitForTimeout(400);
  const opts = await s.evaluate(() => ({ P: allowedNextStatuses(QUOTES.find(q => q.id === 'QP')), A: allowedNextStatuses(QUOTES.find(q => q.id === 'QA')), I: allowedNextStatuses(QUOTES.find(q => q.id === 'QI')) }));
  ok('ตัวเลือกสถานะของ Sourcing: Pending → Won/Closed เท่านั้น · Approved → ไม่มี Won', opts.P.join() === 'Won,Closed' && !opts.A.includes('Won') && !opts.A.includes('Pending') && opts.I.includes('Submitted'), opts);
  const rowBtns = async id => s.evaluate(id => { const tr = [...document.querySelectorAll('#qListBody tr')].find(t => t.textContent.includes('QT-' + id)); return tr ? tr.innerText : ''; }, id);
  ok('รายการใบ: ใบ Pending / Approved ไม่มีปุ่ม "ขอลบ" · ใบ In Progress มี', !/ขอลบ/.test(await rowBtns('QP')) && !/ขอลบ/.test(await rowBtns('QA')) && /ขอลบ/.test(await rowBtns('QI')), [await rowBtns('QP'), await rowBtns('QI')]);
  await s.evaluate(() => openQuote('QP')); await s.waitForTimeout(400);
  ok('หน้าใบ Pending: "🔒 ลบไม่ได้" แทนปุ่มลบ · ไม่มีปุ่มปล่อยราคา', /🔒 ลบไม่ได้/.test(await s.textContent('#content')) && !(await s.locator('button:has-text("ปล่อยราคา")').count()));
  await s.evaluate(() => editQuote('QP')); await s.waitForTimeout(300);
  ok('กดแก้ใบที่ปล่อยราคาแล้ว → บอกว่าแก้ราคาไม่ได้ + ปุ่ม "ทำรอบใหม่" (ไม่เข้าหน้าแก้)', /ปล่อยราคาแล้ว — แก้ราคาไม่ได้/.test(await s.textContent('#modalRoot')) && await s.evaluate(() => route) !== 'new');
  await s.click('#modalRoot button:has-text("ทำรอบใหม่")'); await s.waitForTimeout(400);
  ok('…กด "ทำรอบใหม่" → เปิดใบรอบ 2 (In Progress) ให้แก้', await s.evaluate(() => route === 'new' && editing.round === 2 && editing.status === 'In Progress'));

  console.log('== 3) server ปฏิเสธถาวร → ไม่เข้าคิวซ้ำ · โหลดฉบับในชีทกลับ ==');
  await s.evaluate(() => { go('quotes'); });
  await s.evaluate(() => { const q = QUOTES.find(x => x.id === 'QI'); q.status = 'Pending'; q.releasedTo = ['boss']; q.isSynced = false; setQueue([{ payload: quotePayload(q), at: Date.now(), tries: 0 }]); return flushQueue(); });
  await s.waitForTimeout(1200);
  const st = await s.evaluate(() => ({ q: getQueue().length, status: QUOTES.find(x => x.id === 'QI').status, toast: document.body.innerText }));
  ok('ใบที่ถูกแก้สถานะเป็น Pending ในเครื่อง (เช่น ข้อมูลเก่า) → server ไม่รับ · คิวว่าง · กลับเป็น In Progress ตามชีท', st.q === 0 && st.status === 'In Progress' && /ระบบไม่รับ/.test(st.toast), { q: st.q, status: st.status });
  ok('…ในชีทยังเป็น In Progress · ReleasedTo ว่าง', String(sheets['Quotations'].rows.find(r => r[0] === 'QI')[sheets['Quotations'].rows[0].indexOf('Status')]) === 'In Progress');

  console.log('== 4) ปล่อยราคา: ผู้บริหารไม่มีปุ่ม · NON ปล่อยได้ ==');
  const g = await loginIndex(b, 'gm');
  await g.evaluate(() => openQuote('QA')); await g.waitForTimeout(400);
  ok('GM เปิดใบ Approved → ไม่มีปุ่ม "ปล่อยราคา" (เฉพาะ NON)', !(await g.locator('button:has-text("ปล่อยราคา")').count()));
  const n = await page(b, '/sales', { width: 390, height: 844 });
  await n.fill('#loginUser', 'sales_non'); await n.fill('#loginPass', 'pw123456'); await n.click('#loginBtn'); await n.waitForTimeout(1500);
  ok('แอป Sales (NON): ไม่มีโค้ดรันจากข้อมูลในชีท', (await xss(n)).n === 0, await xss(n));
  ok('v5.9: หน้า "งานของฉัน" ของ NON มีคิว "รอคุณปล่อยราคา (1)" (เดิมไม่แสดงงานของ Sales คนอื่นเลย)', /รอคุณปล่อยราคา \(1\)/.test(await n.textContent('body')));
  if (OUT) await n.screenshot({ path: OUT + '/v59_non_release_queue.png', fullPage: true });
  const nBtn = n.locator('button:has-text("ปล่อยราคา")').first();
  ok('NON เห็นปุ่มปล่อยราคาของใบ Approved', await nBtn.count() >= 1);
  await nBtn.click(); await n.waitForTimeout(300); await n.click('#relBtn'); await n.waitForTimeout(1200);
  ok('NON กดปล่อยราคา → ผ่าน action release ของ server → Pending', String(sheets['Quotations'].rows.find(r => r[0] === 'QA')[sheets['Quotations'].rows[0].indexOf('Status')]) === 'Pending' &&
    posts.some(p => p.action === 'release' && p.id === 'QA'));
  ok('ตลอดการทดสอบ ไม่มีการส่ง save ที่ตั้งสถานะ Approved / Pending สำเร็จ', !sheets['Log'].rows.some(r => /^save/.test(r[1]) && /→ (Approved|Pending|Partial Approved)/.test(r[4])));

  console.log(fails ? fails + ' FAILED' : 'ALL v5.9 E2E PASSED');
  await b.close(); srv.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL crash', e && e.stack); process.exit(1); });
