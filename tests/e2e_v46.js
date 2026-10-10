// v4.6 — Phase 4 ในเบราว์เซอร์: ช่องเงิน / margin สด / "อื่น ๆ (ระบุ)" / MasterData / ระดับเร่งด่วน / แอป Sales
// รัน: NODE_PATH=$(npm root -g) node tests/e2e_v46.js $PWD /tmp/out   (ทดสอบบนเครื่องเท่านั้น ห้าม deploy)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), crypto = require('crypto');
const { makeRuntime } = require('./gasmock');
const [, , DIR, OUT] = process.argv;
const { ctx, sheets } = makeRuntime(DIR + '/Code.gs');
const H = s => crypto.createHash('sha256').update(s + 'mgs-internal-2025').digest('hex');
const U = sheets['Users'], uh = U.rows[0];
const add = (id, name, role, email) => { const r = []; r[uh.indexOf('Id')] = id; r[uh.indexOf('Name')] = name; r[uh.indexOf('Role')] = role; r[uh.indexOf('Scope')] = 'all'; r[uh.indexOf('PassHash')] = H('pw123456'); r[uh.indexOf('Email')] = email; U.rows.push(r); };
add('sourcing1', 'Chatraporn', 'Sourcing', 'chat@mgs.co'); add('gm', 'GM', 'GM', 'gm@mgs.co'); add('sales_boss', 'BOSS', 'Sales', 'boss@mgs.co');
const post = p => JSON.parse(ctx.apiPost(JSON.stringify(p)));
// SR ที่ค้างที่ Sourcing มา 10 วันทำการ → ต้องขึ้น "เกินกำหนด" และอยู่บนสุด
const tB = post({ action: 'login', user: 'sales_boss', passHash: H('pw123456') }).token;
post({ token: tB, action: 'saveSR', id: 'SR-OLD', status: 'Submitted', detail: JSON.stringify({ header: { title: 'Old request', customer: 'CP', currency: 'THB' }, lines: [{ desc: 'Inverter', qty: 1 }] }) });
post({ token: tB, action: 'saveSR', id: 'SR-NEW', status: 'Submitted', detail: JSON.stringify({ header: { title: 'New request', customer: 'PTT', currency: 'THB' }, lines: [{ desc: 'Cable', qty: 1 }] }) });
const Q = sheets['Quotations'], qh = Q.rows[0], old = Q.rows.find(r => r[qh.indexOf('Id')] === 'SR-OLD');
const ago = new Date(Date.now() - 16 * 86400000).toISOString(), d = JSON.parse(old[qh.indexOf('Detail')]);
d.statusChangedAt = ago; d.statusLog = [{ s: 'Submitted', at: ago }]; old[qh.indexOf('Detail')] = JSON.stringify(d);

const files = { '/': fs.readFileSync(DIR + '/Index.html', 'utf8'), '/sales': fs.readFileSync(DIR + '/Sales.html', 'utf8') };
const srv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(files[q.url.split('?')[0].split('#')[0]] || files['/']); }).listen(0);
const BASE = 'http://localhost:' + srv.address().port;
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const mdHas = (list, v) => { const M = sheets['MasterData'], h = M.rows[0]; return M.rows.some(r => r[h.indexOf('List')] === list && r[h.indexOf('Value')] === v); };
async function page(b, path, vp) {
  const p = await (await b.newContext({ viewport: vp || { width: 1280, height: 900 } })).newPage();
  p.on('pageerror', e => { console.log('PAGEERROR', e.message); fails++; });
  await p.route('https://script.google.com/**', async rt => { const r = rt.request(); let body;
    if (r.method() === 'POST') body = ctx.apiPost(r.postData()); else { const u = new URL(r.url()); const g = k => u.searchParams.get(k) || ''; body = ctx.apiGet(g('type'), g('token'), g('id') || g('since')); }
    await rt.fulfill({ status: 200, contentType: 'application/json', body }); });
  await p.goto(BASE + path); await p.waitForTimeout(300); return p;
}
async function login(p, u) { await p.fill('#loginUser', u); await p.fill('#loginPass', 'pw123456'); await p.click('button:has-text("เข้าสู่ระบบ →")'); await p.waitForTimeout(1800); }

(async () => {
  const b = await chromium.launch();
  /* ---------------- Sourcing: ใบใหม่ ---------------- */
  const s = await page(b, '/'); await login(s, 'sourcing1');
  await s.evaluate(() => go('new')); await s.waitForTimeout(300);
  const H0 = await s.evaluate(() => editing.header);
  ok('ใบใหม่ได้ค่าเริ่มต้นจาก MasterData: THB / CIF at MGS / ยืนราคา 30 / เงื่อนไขชำระเงิน', H0.currency === 'THB' && H0.incoterm === 'CIF at MGS' && H0.validity === 30 && !!H0.paymentTerm, H0);
  ok('ยืนราคาเป็น dropdown (มีตัวเลือก "อื่น ๆ")', await s.evaluate(() => [...document.querySelectorAll('#hdrGrid select')].some(x => [...x.options].some(o => o.value === '120' || o.value === '90') && [...x.options].some(o => o.value === OPT_OTHER))));
  await s.evaluate(() => { editing.lines.push({ code: 'SG110CX', desc: 'Inverter', group: 'INVERTER', comGroup: 'Inverter', uom: 'pcs', qty: 2, up: 0, costCur: 'THB', dutyPct: 0, clearancePct: 0, opPct: 20, freep: 0 }); refreshLines(); });
  const up = '#row_0 input[data-money]';
  await s.click(up); await s.fill(up, '1,234.5'); await s.keyboard.press('Tab'); await s.waitForTimeout(100);
  ok('พิมพ์ทุน "1,234.5" → ออกจากช่องแล้วแสดง 1,234.50', await s.inputValue(up) === '1,234.50', await s.inputValue(up));
  ok('ค่าที่เก็บในใบ = ตัวเลข 1234.5 (ไม่ใช่ข้อความ)', await s.evaluate(() => editing.lines[0].up) === 1234.5);
  await s.focus(up); ok('โฟกัสกลับ → แสดงค่าจริงให้แก้ 1234.5', await s.inputValue(up) === '1234.5', await s.inputValue(up)); await s.keyboard.press('Tab');
  ok('audit บันทึกค่าจริง (0 → 1234.5) ไม่ใช่ข้อความที่จัดรูปแบบ', await s.evaluate(() => /Unit Price of SG110CX from 0 to 1234\.5$/.test(editing.auditLogs.slice(-1)[0].action)), await s.evaluate(() => editing.auditLogs.slice(-1)[0]));
  const sell = await s.inputValue('#tu_0');
  ok('ราคาขายแสดงคั่นหลักพัน 2 ตำแหน่ง (1,543.13)', sell === '1,543.13', sell);
  ok('margin สดใต้ราคาขาย: ✓/⚠/⛔ GP x%', /GP 20%/.test(await s.textContent('#tum_0')), await s.textContent('#tum_0'));
  await s.click('#tu_0'); await s.fill('#tu_0', '1,000'); await s.keyboard.press('Tab'); await s.waitForTimeout(100);
  ok('แก้ราคาขาย "1,000" ต่ำกว่าทุน → ⛔ ขาดทุน ทันที', /ขาดทุน/.test(await s.textContent('#tum_0')), await s.textContent('#tum_0'));
  ok('%GP คิดย้อนกลับจาก 1,000 ถูก (−23.45%)', await s.evaluate(() => Math.abs(editing.lines[0].opPct - (-23.45)) < 0.01), await s.evaluate(() => editing.lines[0].opPct));
  ok('ยอดรวมแถบสรุปมีหลักพัน + 2 ตำแหน่ง', /2,000\.00/.test(await s.textContent('#liveBar')), await s.textContent('#liveBar'));
  // หน่วยนับใหม่ → จำเข้ารายการ
  await s.fill('#row_0 input[list="uomList"]', 'ลัง'); await s.keyboard.press('Tab'); await s.waitForTimeout(400);
  ok('พิมพ์หน่วยนับใหม่ "ลัง" → เพิ่มเข้าแท็บ MasterData ให้อัตโนมัติ', mdHas('uom', 'ลัง'));
  // Incoterm: อื่น ๆ (ระบุ)
  const inco = '#hdrGrid select[onchange*="incoterm"]';
  await s.selectOption(inco, '__other__'); await s.waitForTimeout(150);
  ok('เลือก "อื่น ๆ (ระบุ)" → เปิดช่องพิมพ์', await s.isVisible('#optNewVal'));
  await s.fill('#optNewVal', 'CIP Bangkok'); await s.click('#modalRoot button:has-text("เพิ่ม & เลือก")'); await s.waitForTimeout(400);
  ok('ค่าใหม่ถูกเลือกในใบทันที', await s.evaluate(() => editing.header.incoterm) === 'CIP Bangkok' && await s.inputValue(inco) === 'CIP Bangkok');
  ok('ค่าใหม่ถูกบันทึกในแท็บ MasterData (คนอื่นเลือกได้ต่อ)', mdHas('incoterm', 'CIP Bangkok'));
  await s.selectOption(inco, '__other__'); await s.waitForTimeout(100); await s.click('#modalRoot button:has-text("ยกเลิก")');
  ok('กดยกเลิก → ค่าเดิมยังอยู่ ไม่ค้างที่ "อื่น ๆ"', await s.inputValue(inco) === 'CIP Bangkok' && await s.evaluate(() => editing.header.incoterm) === 'CIP Bangkok');
  // Global extra (ช่องเงิน)
  await s.evaluate(() => addGlobalExtra()); await s.waitForTimeout(100);
  const ge = '#gExtraBox input[data-money]';
  await s.fill(ge, '12,000'); await s.keyboard.press('Tab'); await s.waitForTimeout(100);
  ok('ค่าใช้จ่ายรวม "12,000" → 12,000.00 และเก็บ 12000', await s.inputValue(ge) === '12,000.00' && await s.evaluate(() => editing.globalExtras[0].amount) === 12000);
  ok('ประเภทค่าใช้จ่ายมีรายการให้เลือก (datalist)', await s.evaluate(() => document.querySelectorAll('#expenseList option').length >= 5));
  /* ---------------- ระดับเร่งด่วน ---------------- */
  await s.evaluate(() => { dirty = false; go('srqueue', true); }); await s.waitForTimeout(300);
  ok('คิว SR: สรุปเหนือตาราง "⛔ เกินกำหนด 1"', /เกินกำหนด 1/.test(await s.textContent('.lv-sum')), await s.textContent('.lv-sum'));
  ok('คิว SR: งานเกินกำหนดอยู่แถวแรก + แถบแดงซ้าย + ป้ายไอคอน', await s.evaluate(() => { const tr = document.querySelector('#content tbody tr'); return tr.classList.contains('lv-over') && /Old request/.test(tr.textContent) && /⛔ เกินกำหนด/.test(tr.textContent); }));
  ok('คิว SR: สถานะเป็นคำไทยแบบคำขอราคา (ไม่โชว์ Submitted)', await s.evaluate(() => /รอ Sourcing รับคำขอ/.test(document.querySelector('#content tbody').textContent) && !/>Submitted</.test(document.querySelector('#content tbody').innerHTML)));
  if (OUT) await s.screenshot({ path: OUT + '/v46_srqueue.png' });
  /* ---------------- Admin: MasterData ---------------- */
  const g = await page(b, '/'); await login(g, 'gm');
  await g.evaluate(() => go('settings', true)); await g.waitForTimeout(300);
  ok('หน้าตั้งค่ามีส่วน "ตัวเลือกใน Dropdown" พร้อมค่า CIP Bangkok ที่เพิ่งเพิ่ม', /CIP Bangkok/.test(await g.textContent('#masterBox')));
  await g.evaluate(() => { const i = optList('incoterm').indexOf('FOB'); masterOp('incoterm', 'default', i); }); await g.waitForTimeout(400);
  ok('ตั้ง FOB เป็นค่าเริ่มต้น → ใบใหม่ได้ FOB', await g.evaluate(() => optDefault('incoterm')) === 'FOB' && await g.evaluate(() => blankQuote().header.incoterm) === 'FOB');
  if (OUT) await g.screenshot({ path: OUT + '/v46_settings.png', fullPage: true });
  /* ---------------- แอป Sales ---------------- */
  const sp = await page(b, '/sales', { width: 390, height: 840 });
  await sp.fill('#loginUser', 'boss@mgs.co'); await sp.fill('#loginPass', 'pw123456'); await sp.click('#loginBtn'); await sp.waitForTimeout(1500);
  ok('แอป Sales: การ์ดงานใช้คำ "เกินกำหนด"/"เฝ้าระวัง" ไม่มี "ครบกำหนดวันนี้"', !/ครบกำหนดวันนี้/.test(await sp.textContent('body')));
  await sp.evaluate(() => newRequest()); await sp.waitForTimeout(300);
  ok('ฟอร์มขอราคา: ยืนราคาเป็น dropdown ค่าเริ่มต้น 30', await sp.evaluate(() => { const s = [...document.querySelectorAll('select')].find(x => /validity/.test(x.getAttribute('onchange') || '')); return !!s && s.value === '30'; }));
  ok('ฟอร์มขอราคา: หน่วยนับมี "ลัง" ที่ Sourcing เพิ่งเพิ่ม', await sp.evaluate(() => [...document.querySelectorAll('#uomList option')].some(o => o.value === 'ลัง')));
  const tgt = '#lineBox input[data-money]';
  await sp.fill(tgt, '1,500'); await sp.keyboard.press('Tab'); await sp.waitForTimeout(100);
  ok('ราคาเป้าหมาย "1,500" → 1,500.00 + หัวข้อบอกสกุลเงิน (THB)', await sp.inputValue(tgt) === '1,500.00' && /ราคาเป้าหมาย\/หน่วย \(THB\)/.test(await sp.textContent('#lineBox')));
  await sp.fill('#lu_0', 'ม้วนใหญ่'); await sp.keyboard.press('Tab'); await sp.waitForTimeout(400);
  ok('Sales พิมพ์หน่วยนับใหม่ → เข้าแท็บ MasterData ให้ทุกคน', mdHas('uom', 'ม้วนใหญ่'));
  if (OUT) await sp.screenshot({ path: OUT + '/v46_sales_form.png', fullPage: true });
  await b.close(); srv.close();
  console.log(fails ? '\n' + fails + ' FAILED' : '\nALL v4.6 E2E PASSED'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
