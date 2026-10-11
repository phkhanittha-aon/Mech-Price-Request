// v5.4 — หน้าจอ: ตั้งหมวดสินค้า → กลุ่มสินค้า → ผู้รับผิดชอบ · ติดตามงาน "งานของฉัน" · ผู้รับผิดชอบใบเสนอราคา
// รัน: NODE_PATH=$(npm root -g) node tests/e2e_v54.js $PWD [out-dir]   (ทดสอบบนเครื่องเท่านั้น ห้าม deploy)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), crypto = require('crypto');
const { makeRuntime } = require('./gasmock');
const [, , DIR, OUT] = process.argv;
const { ctx, sheets } = makeRuntime(DIR + '/Code.gs');
const H = s => crypto.createHash('sha256').update(s + 'mgs-internal-2025').digest('hex');
const U = sheets['Users'], uh = U.rows[0];
[['src', 'Chatraporn', 'Sourcing', JSON.stringify(['INVERTER', 'BATTERY', 'DATA LOGGER', 'PV MODULE'])],
 ['src2', 'Napasorn', 'Sourcing', JSON.stringify(['MOUNTING', 'Carport', 'DC CABLE'])],
 ['pm', 'Procure', 'Procurement Mgr', 'all'], ['bd', 'BD', 'BD Mgr', 'all'], ['boss', 'BOSS', 'Sales', 'all'], ['sales_non', 'NON', 'Sales', 'all']]
  .forEach(([id, n, r, sc]) => { const x = []; x[uh.indexOf('Id')] = id; x[uh.indexOf('Name')] = n; x[uh.indexOf('Role')] = r; x[uh.indexOf('Scope')] = sc; x[uh.indexOf('PassHash')] = H('pw123456'); x[uh.indexOf('Email')] = id + '@m.co'; U.rows.push(x); });
const post = p => JSON.parse(ctx.apiPost(JSON.stringify(p)));
const tok = u => post({ action: 'login', user: u, passHash: H('pw123456') }).token;
const T = { pm: tok('pm'), src: tok('src') };
post({ token: T.pm, action: 'saveSettings', settingsRev: 2, detail: JSON.stringify({ catOwner: { INVERTER: 'src', MOUNTING: 'src2' } }) });
const line = (group, comGroup) => ({ code: group + '-1', desc: group, group, comGroup, qty: 2, uom: 'pcs', up: 1000, costCur: 'THB', dutyPct: 0, clearancePct: 0, opPct: 20, freep: 0, extras: [] });
const qt = (id, title, status, lines, extra) => post(Object.assign({ token: T.pm, action: 'save', id, docType: 'QT', docNo: 'QT-' + title, title, customer: title, sales: 'BOSS', salesUserId: 'boss', status,
  detail: JSON.stringify({ id, _v: 2, _pm: 2, _sv: 3, docType: 'QT', docNo: 'QT-' + title, status, round: 1, approvalRoles: [], approvals: [], releasedTo: [],
    header: { ref: 'QT-' + title, title, customer: title, salesUserId: 'boss', sales: 'BOSS', currency: 'THB', groupType: 'Inverter', reqDate: '2026-10-01' }, lines, remarks: [], auditLogs: [], globalExtras: [] }) }, extra || {}));
qt('QI', 'INV', 'In Progress', [line('INVERTER', 'Inverter')]);           // → Chatraporn (หมวด INVERTER)
qt('QM', 'MNT', 'In Progress', [line('MOUNTING', 'Mounting')]);           // → Napasorn (หมวด MOUNTING)
qt('QA', 'APR', 'Submitted', [line('INVERTER', 'Inverter')]);             // → Chatraporn · รอ Sourcing Manager + BD อนุมัติ
qt('QX', 'OWN', 'In Progress', [line('MOUNTING', 'Mounting')], { assignedTo: 'src' });   // Chatraporn รับงานเองแล้ว (หมวด MOUNTING)

let BEFORE = ''; try { BEFORE = require('child_process').execSync('git show dcda638:Index.html', { cwd: DIR, maxBuffer: 64 << 20 }).toString(); } catch (e) { }   // v5.4 ก่อนย้าย Floating
const files = { '/': fs.readFileSync(DIR + '/Index.html', 'utf8'), '/before': BEFORE };
const srv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(files[q.url.split('?')[0]] || files['/']); }).listen(0);
const BASE = 'http://localhost:' + srv.address().port;
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 400) : '')); if (!c) fails++; };

(async () => {
  const b = await chromium.launch();
  const login = async (u, vp) => { const p = await (await b.newContext({ viewport: vp || { width: 1366, height: 900 } })).newPage();
    p.on('pageerror', e => { console.log('PAGEERROR', e.message); fails++; });
    await p.route('https://script.google.com/**', async rt => { const r = rt.request(); let body;
      if (r.method() === 'POST') body = ctx.apiPost(r.postData()); else { const u2 = new URL(r.url()); const g = k => u2.searchParams.get(k) || ''; body = ctx.apiGet(g('type'), g('token'), g('id') || g('since')); }
      await rt.fulfill({ status: 200, contentType: 'application/json', body }); });
    await p.goto(BASE + '/?app=index'); await p.waitForTimeout(300);
    await p.fill('#loginUser', u); await p.fill('#loginPass', 'pw123456'); await p.click('button:has-text("เข้าสู่ระบบ →")'); await p.waitForTimeout(2000); return p; };
  const docs = async p => (await p.textContent('#content tbody').catch(() => '')).match(/QT-[A-Z]+/g) || [];

  console.log('== 1) Sourcing: ติดตามงานเห็นเฉพาะงานของตัวเอง ==');
  const s1 = await login('src');
  await s1.evaluate(() => go('followup')); await s1.waitForTimeout(400);
  let d = (await docs(s1)).sort();
  ok('Chatraporn เห็น INVERTER 2 ใบ (ตามหมวด) + ใบที่รับงานเอง 1 ใบ — ไม่เห็นใบ MOUNTING ของ Napasorn', d.join() === 'QT-APR,QT-INV,QT-OWN', d);
  ok('Sourcing ไม่มีปุ่ม "ทั้งทีม" (เห็นเฉพาะของตัวเอง)', await s1.locator('button:has-text("ทั้งทีม")').count() === 0 && /แสดงเฉพาะใบที่คุณรับผิดชอบ/.test(await s1.textContent('#content')));
  const tb = await s1.textContent('#content tbody');
  ok('คอลัมน์ผู้รับผิดชอบ: "คุณ" + เหตุผล (ตามหมวด INVERTER / รับงานแล้ว)', /👤 คุณ/.test(tb) && /ตามหมวดสินค้าที่ดูแล · INVERTER/.test(tb) && /รับงานแล้ว/.test(tb), tb.slice(0, 400));
  const s2 = await login('src2', { width: 390, height: 800 });
  await s2.evaluate(() => go('followup')); await s2.waitForTimeout(400);
  d = await docs(s2);
  ok('Napasorn (มือถือ) เห็นเฉพาะ QT-MNT', d.join() === 'QT-MNT', d);
  ok('มือถือ: หน้าไม่เลื่อนซ้ายขวา', await s2.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

  console.log('== 2) ผู้จัดการ: งานของฉัน = รอฉันอนุมัติ · สลับทั้งทีม / รายคนได้ ==');
  const m = await login('pm');
  await m.evaluate(() => go('followup')); await m.waitForTimeout(400);
  d = await docs(m);
  ok('Sourcing Manager — งานของฉัน = ใบที่รออนุมัติ (QT-APR)', d.join() === 'QT-APR', d);
  await m.click('button:has-text("ทั้งทีม")'); await m.waitForTimeout(300);
  d = (await docs(m)).sort();
  ok('ทั้งทีม = ครบ 4 ใบ', d.join() === 'QT-APR,QT-INV,QT-MNT,QT-OWN', d);
  await m.selectOption('.who-bar select', 'src2'); await m.waitForTimeout(300);
  d = await docs(m);
  ok('เลือกดูงานของ Napasorn → QT-MNT', d.join() === 'QT-MNT', d);
  if (OUT) await m.screenshot({ path: OUT + '/v54_followup_team.png' });

  console.log('== 3) ตั้งค่า: หมวดสินค้า → กลุ่มสินค้า → ผู้รับผิดชอบ ==');
  await m.evaluate(() => go('settings')); await m.waitForTimeout(500);
  const st = await m.textContent('#catSetup');
  ok('มีการ์ด "หมวดสินค้า · กลุ่มสินค้า · ผู้รับผิดชอบ" + โครงสร้างกลุ่ม (INVERTER · Chatraporn อยู่ใต้ Inverter)', /หมวดสินค้า · กลุ่มสินค้า · ผู้รับผิดชอบ/.test(st) &&
    await m.evaluate(() => [...document.querySelectorAll('.cat-tree-g')].some(g => /^Inverter/.test(g.textContent.trim()) && /INVERTER · Chatraporn/.test(g.textContent))));
  ok('ไม่แสดงแถวหัวตาราง Excel "Sub Group" เป็นหมวด', !/Sub Group/.test(st));
  // v5.5 (ตั้งใจเปลี่ยน): Floating ย้ายเข้ากลุ่ม Mounting เป็นค่าตั้งต้น — เดิม v5.4 ตรวจว่ายังอยู่กติกาเดิม + มีปุ่มแนะนำ (1)
  const SNAP = '(() => { const q = _stQuote(); q.lines = [_stLine({ group: "Floating", comGroup: "", up: 1000, qty: 1, opPct: 30 })]; const t = computeQuote(q);' +
    ' return { map: Object.fromEntries(catList().map(c => [c, comCategory(c)])), grade: Object.entries(t.com).map(([k, v]) => k + ":" + v.grade + "/" + v.rate + "%").join() }; })()';
  const after = await m.evaluate(SNAP);
  if (BEFORE) {
    const bp = await b.newPage(); await bp.goto(BASE + '/before'); await bp.waitForTimeout(400);
    const before = await bp.evaluate(SNAP);
    const diff = Object.keys(after.map).filter(c => after.map[c] !== before.map[c]);
    console.log('หมวด'.padEnd(20), '| กลุ่มค่าคอม v5.4 → v5.5'); diff.forEach(c => console.log(c.padEnd(20), '|', before.map[c], '→', after.map[c]));
    console.log('รายการ Floating ที่ยังไม่บันทึกกลุ่ม (%GP 30):', before.grade, '→', after.grade);
    ok('เทียบ v5.4: เปลี่ยนเฉพาะ Floating (Inverter → Mounting) หมวดอื่นเหมือนเดิมทั้งหมด', diff.join() === 'Floating' && before.map.Floating === 'Inverter' && after.map.Floating === 'Mounting', diff);
  }
  ok('Floating อยู่ใต้กลุ่ม Mounting ในโครงสร้าง · ไม่มีปุ่ม "ใช้กลุ่มที่แนะนำ" แล้ว', after.map.Floating === 'Mounting' &&
    await m.evaluate(() => [...document.querySelectorAll('.cat-tree-g')].some(g => /^Mounting/.test(g.textContent.trim()) && /Floating/.test(g.textContent))) && !/ใช้กลุ่มที่แนะนำ/.test(st));
  ok('รายการที่บันทึกกลุ่มค่าคอมไว้แล้ว (Floating + Inverter) ไม่เปลี่ยน', await m.evaluate(() => { const q = _stQuote(); q.lines = [_stLine({ group: 'Floating', comGroup: 'Inverter' })]; return !!computeQuote(q).com.Inverter; }));
  await m.evaluate(() => catOwnersFromScope()); await m.waitForTimeout(300);
  const own = await m.evaluate(() => ({ dl: catOwnerId('DATA LOGGER'), pv: catOwnerId('PV MODULE'), cp: catOwnerId('Carport'), inv: catOwnerId('INVERTER') }));
  ok('"ตั้งจากสิทธิ์กลุ่มเดิม" → DATA LOGGER/PV MODULE = Chatraporn · Carport = Napasorn · หมวดที่ตั้งไว้แล้วไม่ถูกทับ', own.dl === 'src' && own.pv === 'src' && own.cp === 'src2' && own.inv === 'src', own);
  const sset = JSON.parse(sheets['Settings'].rows[1][sheets['Settings'].rows[0].indexOf('Detail')] || '{}');
  ok('บันทึกขึ้นชีท (Settings.catOwner) — server ใช้ส่งงานรอบถัดไป', sset.catOwner && sset.catOwner['Carport'] === 'src2', sset.catOwner);
  const selSel = await m.evaluate(() => { const tr = [...document.querySelectorAll('#catSetup tbody tr')].find(r => /^PV MODULE/.test(r.cells[0].textContent.trim())); return tr ? tr.querySelectorAll('select')[1].value : null; });
  ok('ตารางแสดงผู้รับผิดชอบที่ตั้งแล้ว (PV MODULE → src)', selSel === 'src', selSel);
  // เปลี่ยนกลุ่มค่าคอม: มีใบเปิดที่บรรทัดยังไม่บันทึกกลุ่ม → ต้องยืนยันก่อน
  await m.evaluate(() => { const q = QUOTES.find(x => x.id === 'QI'); q.lines[0].comGroup = ''; q.lines[0].group = 'PV MODULE'; setCatGroup('PV MODULE', 'Residential'); }); await m.waitForTimeout(200);
  const cm = await m.evaluate(() => document.getElementById('modalRoot').textContent);
  ok('เปลี่ยนกลุ่มของหมวดที่มีใบเปิดอยู่ → เตือนจำนวนใบที่กระทบก่อน', /1 ใบ/.test(cm) && /QT-INV/.test(cm), cm.slice(0, 200));
  await m.click('#modalRoot button:has-text("ยืนยันเปลี่ยนกลุ่ม")'); await m.waitForTimeout(200);
  ok('ยืนยันแล้ว: PV MODULE → Residential (หมวดอื่นยังเป็นกติกาเดิม)', await m.evaluate(() => comCategory('PV MODULE') === 'Residential' && comCategory('pv module') === 'Residential' && comCategory('INVERTER') === 'Inverter'));
  ok('บรรทัดที่บันทึกกลุ่มค่าคอมไว้แล้วไม่เปลี่ยน (ใบ QT-APR ยัง Inverter)', await m.evaluate(() => computeQuote(QUOTES.find(x => x.id === 'QA')).com.Inverter !== undefined));
  const fr = await m.evaluate(() => { const q = _stQuote(); q.lines = [_stLine({ group: 'PV MODULE', comGroup: '' })]; stampComGrades(q); return q.lines[0].comGroup; });
  ok('บันทึกใบ → ตรึงกลุ่มค่าคอมลงบรรทัด (เปลี่ยนการจัดกลุ่มภายหลังไม่ย้อนแก้ใบนั้น)', fr === 'Residential', fr);
  if (OUT) await m.screenshot({ path: OUT + '/v54_settings_categories.png', fullPage: true });

  console.log('== 4) ใบเสนอราคา: ผู้รับผิดชอบตามหมวด + เปลี่ยน/รับงาน ==');
  await s1.evaluate(() => { go('new'); editing.lines.push(_stLine({ group: 'MOUNTING', comGroup: 'Mounting' })); render(); }); await s1.waitForTimeout(300);
  const hdr = await s1.textContent('.resp-box');
  ok('ใบใหม่รายการ MOUNTING → หัวใบบอก "Napasorn · ตามหมวดสินค้าที่ดูแล · MOUNTING"', /Napasorn/.test(hdr) && /MOUNTING/.test(hdr), hdr);
  await s1.click('.resp-box button:has-text("เปลี่ยน")'); await s1.waitForTimeout(200)
  await s1.selectOption('#asgTo', 'src'); await s1.click('#modalRoot button:has-text("ตกลง")'); await s1.waitForTimeout(200);
  ok('รับงานเอง → assignedTo = src · หัวใบ "คุณ · รับงานแล้ว" · บันทึกประวัติ', await s1.evaluate(() => editing.assignedTo === 'src' && /ผู้รับผิดชอบ from อัตโนมัติตามหมวด to Chatraporn/.test(editing.auditLogs.slice(-1)[0].action)) && /คุณ/.test(await s1.textContent('.resp-box')));

  console.log(fails ? fails + ' FAILED' : 'ALL v5.4 E2E PASSED');
  await b.close(); srv.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL crash', e && e.stack); process.exit(1); });
