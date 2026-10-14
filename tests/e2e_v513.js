// v5.13 — หน้าจอทำราคาจริง: ดีลให้ค่าคอมลูกค้า · ค่าใช้จ่ายปันเข้าราคา (เฉพาะรายการที่เลือก) · สรรพสามิต+มหาดไทย แบตเตอรี่
// รัน: NODE_PATH=$(npm root -g) node tests/e2e_v513.js $PWD [out-dir]   (ทดสอบบนเครื่องเท่านั้น ห้าม deploy)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), crypto = require('crypto');
const { makeRuntime } = require('./gasmock');
const [, , DIR, OUT] = process.argv;
const { ctx, sheets } = makeRuntime(DIR + '/Code.gs');
const H = s => crypto.createHash('sha256').update(s + 'mgs-internal-2025').digest('hex');
const U = sheets['Users'], uh = U.rows[0];
[['src', 'Chatraporn', 'Sourcing'], ['boss', 'BOSS', 'Sales']].forEach(([id, n, r]) => { const x = []; x[uh.indexOf('Id')] = id; x[uh.indexOf('Name')] = n; x[uh.indexOf('Role')] = r; x[uh.indexOf('Scope')] = 'all'; x[uh.indexOf('PassHash')] = H('pw123456'); x[uh.indexOf('Email')] = id + '@m.co'; U.rows.push(x); });
const post = p => JSON.parse(ctx.apiPost(JSON.stringify(p)));
const tS = post({ action: 'login', user: 'src', passHash: H('pw123456') }).token;
const L = o => Object.assign({ desc: 'x', uom: 'pcs', costCur: 'THB', dutyPct: 0, clearancePct: 0, opPct: 20, freep: 0, extras: [], qty: 10 }, o);
const doc = { id: 'Q1', _v: 2, _pm: 2, _sv: 3, docType: 'QT', docNo: 'QT-ES-2610-001', status: 'In Progress', round: 1, approvalRoles: [], approvals: [], releasedTo: [], remarks: [], auditLogs: [], globalExtras: [],
  header: { ref: 'QT-ES-2610-001', title: 'ESS Project', customer: 'CP', salesUserId: 'boss', sales: 'BOSS', currency: 'THB', incoterm: 'CIF at MGS', groupType: 'ESS', rates: { USD: 36, CNY: 5 }, offerDate: '2026-10-14', validity: 30 },
  lines: [L({ code: 'BAT-100', desc: 'LFP Battery 100kWh', group: 'BATTERY', up: 10000, lid: 'a' }), L({ code: 'INV-50', desc: 'Inverter 50kW', group: 'INVERTER', up: 30000, lid: 'b' }), L({ code: 'RACK', desc: 'Rack', group: 'MOUNTING', up: 1000, lid: 'c' })] };
post({ token: tS, action: 'save', id: 'Q1', docType: 'QT', docNo: doc.docNo, status: 'In Progress', salesUserId: 'boss', sales: 'BOSS', title: 'ESS Project', customer: 'CP', detail: JSON.stringify(doc), salesDetail: JSON.stringify({ id: 'Q1', lines: [] }) });

const html = fs.readFileSync(DIR + '/Index.html', 'utf8');
const srv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(html); }).listen(0);
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 500) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  p.on('pageerror', e => { console.log('PAGEERROR', e.message); fails++; });
  await p.route('https://script.google.com/**', async rt => { const r = rt.request(); let out;
    if (r.method() === 'POST') out = ctx.apiPost(r.postData()); else { const q = new URL(r.url()); const g = k => q.searchParams.get(k) || ''; out = ctx.apiGet(g('type'), g('token'), g('id') || g('since')); }
    await rt.fulfill({ status: 200, contentType: 'application/json', body: out }); });
  await p.goto('http://localhost:' + srv.address().port + '/?app=index');
  await p.fill('#loginUser', 'src'); await p.fill('#loginPass', 'pw123456'); await p.click('button:has-text("เข้าสู่ระบบ →")'); await p.waitForTimeout(1800);
  await p.evaluate(() => editQuote('Q1')); await p.waitForTimeout(600);

  console.log('== 1) สรรพสามิต + มหาดไทย (แบตเตอรี่) ==');
  await p.evaluate(() => toggleDet(0)); await p.waitForTimeout(150);
  const exBox = p.locator('#det_0 input[type=checkbox]');
  ok('แถวรายละเอียดมีช่อง "สรรพสามิต + มหาดไทย (แบตเตอรี่)"', await exBox.count() === 1 && /สรรพสามิต \+ มหาดไทย/.test(await p.textContent('#det_0')));
  await exBox.check(); await p.waitForTimeout(300);
  let s = await p.evaluate(() => ({ L: editing.lines[0], r: computeLine(editing.lines[0], editing.header), rates: editing.header.exciseRates, hint: document.getElementById('dex_0').textContent, sum: document.getElementById('sumBox').textContent }));
  ok('ติ๊กแล้ว: ต้นทุน 10,000 → 10,880 (สรรพสามิต 800 + มหาดไทย 80) · ราคาขาย 13,600 · ตรึงอัตรา 8% / 10% ในใบ', s.L.excise === true && Math.round(s.r.baseCost) === 10880 && s.r.totalUP === 13600 && s.rates.rate === 8 && s.rates.interior === 10 && /880/.test(s.hint), s);
  ok('สรุปด้านข้างแสดง "สรรพสามิต + มหาดไทย (รวมในต้นทุน)" 8,800', /สรรพสามิต \+ มหาดไทย \(รวมในต้นทุน\)\s*฿?8,800/.test(s.sum.replace(/\s+/g, ' ')), s.sum.replace(/\s+/g, ' ').slice(0, 400));
  const auto = await p.evaluate(() => { pickProduct({ code: 'BAT-NEW', desc: 'New battery', group: 'BATTERY', uom: 'pcs' }); const L = editing.lines[editing.lines.length - 1]; const r = { excise: L.excise, lid: !!L.lid }; editing.lines.pop(); refreshLines(); return r; });
  ok('เพิ่มสินค้ากลุ่ม BATTERY ใหม่ → เปิดสรรพสามิตให้อัตโนมัติ (ปิดได้) + มีรหัสบรรทัด', auto.excise === true && auto.lid, auto);

  console.log('== 2) ดีลให้ค่าคอมลูกค้า ==');
  await p.evaluate(() => hsetDeal('custcom')); await p.waitForTimeout(400);
  ok('เลือกประเภทดีล "ให้ค่าคอมลูกค้า" → มีกล่องตั้งค่า % + เลือกรายการ', await p.locator('#ccomBox').count() === 1 && await p.locator('#ccLines input[type=checkbox]').count() === 3);
  await p.fill('#ccomBox input[type=number]', '5'); await p.waitForTimeout(300);
  await p.locator('#ccLines input[type=checkbox]').nth(2).uncheck(); await p.waitForTimeout(300);     // RACK ไม่ให้ค่าคอม
  s = await p.evaluate(() => { const t = computeQuote(editing); return { u: t.lines.map(o => o.totalUP), gp: t.lines.map(o => Math.round(o.gp * 100) / 100), cc: t.customerCom, calc: document.getElementById('ccCalc').textContent, x1: document.getElementById('xtra_1').textContent }; });
  ok('INV-50: ต้นทุน 30,000 · GP 20% + ค่าคอม 5% → ราคา 40,000 · %GP ของเรายัง 20%', s.u[1] === 40000 && s.gp[1] === 20, s);
  ok('RACK (ไม่เลือก) ราคา 1,250 ตามปกติ · ใต้ราคาขาย INV-50 บอก "รวมค่าคอมลูกค้า 5%"', s.u[2] === 1250 && /รวมค่าคอมลูกค้า 5/.test(s.x1), s);
  ok('สรุปค่าคอมลูกค้า = 5% × (13,600×1.0667… + 40,000) × 10', /ค่าคอมลูกค้ารวม/.test(s.calc) && Math.abs(s.cc - (s.u[0] + s.u[1]) * 10 * 0.05) < 0.5, s);
  // แก้ราคาขายเอง → %GP ย้อนกลับต้องหัก %ค่าคอมด้วย
  await p.evaluate(() => totalEdit(1, '50000', null)); await p.waitForTimeout(200);
  ok('แก้ราคาขาย INV-50 เป็น 50,000 → %GP = 1 − 30,000/50,000 − 5% = 35%', await p.evaluate(() => editing.lines[1].opPct) === 35);

  console.log('== 3) ค่าใช้จ่ายปันเข้าราคา เฉพาะรายการที่เลือก ==');
  await p.evaluate(() => { addGlobalExtra(); editing.globalExtras[0].label = 'Storage'; editing.globalExtras[0].amount = 2000; editing.globalExtras[0].cur = 'THB'; renderGlobalExtras(); }); await p.waitForTimeout(200);
  ok('แต่ละค่าใช้จ่ายมีตัวเลือก "แยกบรรทัด / ปันเข้าราคาสินค้า" + ปุ่ม "ใช้กับทุกรายการ"', await p.locator('#gExtraInputs select option[value=embed]').count() === 1 && /ใช้กับทุกรายการ/.test(await p.textContent('#gExtraInputs')));
  await p.locator('#gExtraInputs select').nth(1).selectOption('embed'); await p.waitForTimeout(300);
  await p.click('#gExtraInputs button:has-text("ใช้กับทุกรายการ")'); await p.waitForTimeout(200);
  await p.locator('#modalRoot .gxl').nth(1).uncheck(); await p.locator('#modalRoot .gxl').nth(2).uncheck();     // ปันเฉพาะแบตเตอรี่
  await p.click('#modalRoot button:has-text("บันทึก")'); await p.waitForTimeout(400);
  s = await p.evaluate(() => { const t = computeQuote(editing); return { u: t.lines.map(o => o.totalUP), before: t.lines[0].priceBeforeEmbed, emb: t.extrasEmbedded, sep: t.globalExtras, lab: document.getElementById('gExtraInputs').textContent, alloc: document.getElementById('gAllocBox').textContent }; });
  ok('Storage 2,000 ปันเข้าราคาเฉพาะ BAT-100 (10 หน่วย) → +200/หน่วย · ไม่มีบรรทัดค่าใช้จ่ายแยก', Math.abs(s.u[0] - s.before - 200) < 0.01 && s.sep === 0 && Math.abs(s.emb - 2000) < 0.05 && /ใช้กับ 1 รายการ/.test(s.lab), s);
  ok('ตารางปันส่วนแสดง "ก่อนปัน" และราคาขายใหม่', /ก่อนปัน/.test(s.alloc) && /\+200/.test(s.alloc), s.alloc.slice(0, 300));
  if (OUT) await p.screenshot({ path: OUT + '/v513_editor.png', fullPage: true });

  console.log('== 4) บันทึก → ฉบับ Sales / ใบสำหรับลูกค้า ==');
  await p.evaluate(() => doSaveQuote('Draft', false)); await p.waitForTimeout(1500);
  const QS = sheets['Quotations'], qh = QS.rows[0], row = QS.rows.find(r => r[0] === 'Q1');
  const det = JSON.parse(row[qh.indexOf('Detail')]), sd = String(row[qh.indexOf('SalesDetail')]);
  ok('Detail ในชีทเก็บ dealType=custcom · customerCom 5% · L.excise · exciseRates · extras mode/lines', det.header.dealType === 'custcom' && det.header.customerCom.pct === 5 && det.lines[0].excise === true &&
    det.header.exciseRates.rate === 8 && det.globalExtras[0].mode === 'embed' && det.globalExtras[0].lines.join() === 'a', det.header);
  ok('ฉบับ Sales ไม่มีค่าคอมลูกค้า / สรรพสามิต / การปัน — มีแค่ราคาขาย (รวมทุกอย่างแล้ว)', !/customerCom|custCom|excise|embed|apprSummary/i.test(sd) && /"unitPrice"/.test(sd), sd.slice(0, 300));
  ok('Lark (กลุ่มผู้อนุมัติ): สรุปมีค่าคอมลูกค้า + สรรพสามิต', det.apprSummary && det.apprSummary.custCom > 0 && det.apprSummary.excise > 0, det.apprSummary);
  await p.evaluate(() => { openQuote('Q1'); previewMode = 'cust'; render(); }); await p.waitForTimeout(500);
  const cust = (await p.textContent('#content')).replace(/\s+/g, ' ');
  ok('ใบสำหรับลูกค้า: ราคาต่อหน่วยรวมค่าใช้จ่ายที่ปันแล้ว · ไม่มีคำว่าค่าคอม / สรรพสามิต / Extra Costs', !/ค่าคอม|สรรพสามิต|Extra Costs/.test(cust), cust.slice(0, 300));
  if (OUT) await p.screenshot({ path: OUT + '/v513_customer.png', fullPage: true });
  await p.evaluate(() => { previewMode = 'mgmt'; render(); }); await p.waitForTimeout(400);
  ok('ใบภายใน: แสดงค่าคอมลูกค้า + สรรพสามิต+มหาดไทย + ค่าใช้จ่ายปันเข้าราคา', /ค่าคอมลูกค้า 5/.test(await p.textContent('#content')) && /สรรพสามิต\+มหาดไทย/.test(await p.textContent('#content')) && /ค่าใช้จ่ายปันเข้าราคา/.test(await p.textContent('#content')));
  await b.close(); srv.close();
  console.log(fails ? fails + ' FAILED' : 'ALL v5.13 E2E PASSED'); process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL crash', e && e.stack); process.exit(1); });
