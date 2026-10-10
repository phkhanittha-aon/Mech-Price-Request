// v4.7 — ปุ่มในการ์ด Lark เปิดเอกสารตรง (?doc=<id>) ทั้งระบบทำราคาและแอป Sales
// รัน: NODE_PATH=$(npm root -g) node tests/e2e_v47.js $PWD   (ทดสอบบนเครื่องเท่านั้น ห้าม deploy)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), crypto = require('crypto');
const { makeRuntime } = require('./gasmock');
const [, , DIR] = process.argv;
const { ctx, sheets } = makeRuntime(DIR + '/Code.gs');
const H = s => crypto.createHash('sha256').update(s + 'mgs-internal-2025').digest('hex');
const U = sheets['Users'], uh = U.rows[0];
[['src', 'Chatraporn', 'Sourcing'], ['gm', 'GM', 'GM'], ['boss', 'BOSS', 'Sales'], ['pair', 'PAIR', 'Sales']].forEach(([id, n, r]) => { const x = []; x[uh.indexOf('Id')] = id; x[uh.indexOf('Name')] = n; x[uh.indexOf('Role')] = r; x[uh.indexOf('Scope')] = 'all'; x[uh.indexOf('PassHash')] = H('pw123456'); x[uh.indexOf('Email')] = id + '@m.co'; U.rows.push(x); });
const post = p => JSON.parse(ctx.apiPost(JSON.stringify(p)));
const tS = post({ action: 'login', user: 'src', passHash: H('pw123456') }).token;
const hd = { title: 'Factory Rooftop', customer: 'CP Group', salesUserId: 'boss', sales: 'BOSS', currency: 'THB' };
post({ token: tS, action: 'save', id: 'Q1', docType: 'QT', docNo: 'QT-IN-2610-001', status: 'Pending', releasedTo: 'boss', salesUserId: 'boss', title: 'Factory Rooftop', customer: 'CP Group', total: 270000, gp: 20,
  detail: JSON.stringify({ id: 'Q1', docType: 'QT', docNo: 'QT-IN-2610-001', status: 'Pending', releasedTo: ['boss'], header: hd, lines: [{ code: 'SG', desc: 'Inv', qty: 2, up: 3000, costCur: 'USD', opPct: 20 }] }),
  salesDetail: JSON.stringify({ id: 'Q1', status: 'Pending', header: hd, lines: [{ code: 'SG', desc: 'Inv', qty: 2, uom: 'pcs', unitPrice: 135000, amount: 270000 }], total: 270000 }) });
const files = { '/': fs.readFileSync(DIR + '/Index.html', 'utf8'), '/sales': fs.readFileSync(DIR + '/Sales.html', 'utf8') };
const srv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(files[q.url.split('?')[0].split('#')[0]] || files['/']); }).listen(0);
const BASE = 'http://localhost:' + srv.address().port;
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
async function page(b, path) {
  const p = await (await b.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
  p.on('pageerror', e => { console.log('PAGEERROR', e.message); fails++; });
  await p.route('https://script.google.com/**', async rt => { const r = rt.request(); let body;
    if (r.method() === 'POST') body = ctx.apiPost(r.postData()); else { const u = new URL(r.url()); const g = k => u.searchParams.get(k) || ''; body = ctx.apiGet(g('type'), g('token'), g('id') || g('since')); }
    await rt.fulfill({ status: 200, contentType: 'application/json', body }); });
  await p.goto(BASE + path); await p.waitForTimeout(300); return p;
}
(async () => {
  const b = await chromium.launch();
  const s = await page(b, '/?app=index&doc=Q1');
  await s.fill('#loginUser', 'src'); await s.fill('#loginPass', 'pw123456'); await s.click('button:has-text("เข้าสู่ระบบ →")'); await s.waitForTimeout(2000);
  ok('ระบบทำราคา: ลิงก์ ?doc=Q1 → ล็อกอินแล้วเปิดเอกสารนั้นทันที', await s.evaluate(() => route === 'preview' && previewId === 'Q1'), await s.evaluate(() => [route, typeof previewId !== 'undefined' && previewId]));
  const s2 = await page(b, '/?app=index&doc=NOPE');
  await s2.fill('#loginUser', 'src'); await s2.fill('#loginPass', 'pw123456'); await s2.click('button:has-text("เข้าสู่ระบบ →")'); await s2.waitForTimeout(2000);
  ok('ระบบทำราคา: เอกสารที่ไม่มี → อยู่หน้าแรกตามปกติ ไม่พัง', await s2.evaluate(() => route !== 'preview'));
  const sp = await page(b, '/sales?app=sales&doc=Q1');
  await sp.fill('#loginUser', 'boss@m.co'); await sp.fill('#loginPass', 'pw123456'); await sp.click('#loginBtn'); await sp.waitForTimeout(1800);
  ok('แอป Sales: ลิงก์ ?doc=Q1 → เปิดรายละเอียดราคาของงานนั้น', /Factory Rooftop/.test(await sp.textContent('#modalRoot')) && /270,000\.00/.test(await sp.textContent('#modalRoot')), await sp.textContent('#modalRoot'));
  const sp2 = await page(b, '/sales?app=sales&doc=Q1');
  await sp2.fill('#loginUser', 'pair@m.co'); await sp2.fill('#loginPass', 'pw123456'); await sp2.click('#loginBtn'); await sp2.waitForTimeout(1800);
  ok('แอป Sales: คนที่ไม่มีสิทธิ์เห็นงานนั้น เปิดลิงก์เดียวกัน → ไม่เห็นราคา (server ไม่ส่งมา) + แจ้งเหตุผล', !/270,000/.test(await sp2.textContent('body')) && /ไม่พบเอกสารนี้ในงานของคุณ/.test(await sp2.textContent('body')));
  await b.close(); srv.close();
  console.log(fails ? '\n' + fails + ' FAILED' : '\nALL v4.7 E2E PASSED'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
