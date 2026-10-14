// v5.11 — ค่าที่ Admin ซ่อนไว้ใน dropdown: ไม่เด้งป๊อปอัปแดง "…ถูก Admin ซ่อนไว้ — เลือกค่าอื่น หรือขอให้ Admin แสดงกลับที่หน้า ตั้งค่า" อีก
// รัน: NODE_PATH=$(npm root -g) node tests/e2e_v511.js $PWD   (ทดสอบบนเครื่องเท่านั้น ห้าม deploy)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), crypto = require('crypto');
const { makeRuntime } = require('./gasmock');
const [, , DIR] = process.argv;
const { ctx, sheets } = makeRuntime(DIR + '/Code.gs');
const H = s => crypto.createHash('sha256').update(s + 'mgs-internal-2025').digest('hex');
const U = sheets['Users'], uh = U.rows[0];
[['src', 'Chatraporn', 'Sourcing'], ['adm', 'Admin', 'Admin']].forEach(([id, n, r]) => { const x = []; x[uh.indexOf('Id')] = id; x[uh.indexOf('Name')] = n; x[uh.indexOf('Role')] = r; x[uh.indexOf('Scope')] = 'all'; x[uh.indexOf('PassHash')] = H('pw123456'); x[uh.indexOf('Email')] = id + '@m.co'; U.rows.push(x); });
const post = p => JSON.parse(ctx.apiPost(JSON.stringify(p)));
const tA = post({ action: 'login', user: 'adm', passHash: H('pw123456') }).token;
// Admin เพิ่มหน่วย "Mw" แล้วซ่อน
post({ token: tA, action: 'addMaster', list: 'uom', value: 'Mw' });
const hid = post({ token: tA, action: 'saveMaster', list: 'uom', op: 'hide', value: 'Mw' });
const html = fs.readFileSync(DIR + '/Index.html', 'utf8');
const srv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(html); }).listen(0);
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => {
  ok('(ตั้งต้น) Admin ซ่อนหน่วย "Mw" แล้ว', hid.ok !== false, hid);
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  p.on('pageerror', e => { console.log('PAGEERROR', e.message); fails++; });
  await p.route('https://script.google.com/**', async rt => { const r = rt.request(); let out;
    if (r.method() === 'POST') out = ctx.apiPost(r.postData()); else { const q = new URL(r.url()); const g = k => q.searchParams.get(k) || ''; out = ctx.apiGet(g('type'), g('token'), g('id') || g('since')); }
    await rt.fulfill({ status: 200, contentType: 'application/json', body: out }); });
  // จับทุกข้อความ toast ที่เคยขึ้น
  await p.addInitScript(() => { window.__toasts = []; const iv = setInterval(() => { const t = document.getElementById('toast'); if (t && !t.__w) { t.__w = 1; new MutationObserver(() => window.__toasts.push(t.className + ' | ' + t.textContent)).observe(t, { childList: true, characterData: true, subtree: true, attributes: true }); } }, 20); });
  await p.goto('http://localhost:' + srv.address().port + '/?app=index');
  await p.fill('#loginUser', 'src'); await p.fill('#loginPass', 'pw123456'); await p.click('button:has-text("เข้าสู่ระบบ →")'); await p.waitForTimeout(1800);
  const hidden = t => t.some(x => /ถูก Admin ซ่อนไว้|แสดงกลับที่หน้า/.test(x));
  // 1) งานเบื้องหลัง (พิมพ์หน่วยที่ถูกซ่อนในช่องหน่วยนับ → optLearn แบบเงียบ)
  await p.evaluate(() => optLearn('uom', 'Mw')); await p.waitForTimeout(800);
  ok('พิมพ์หน่วยที่ถูกซ่อน (เรียนรู้ค่าเบื้องหลัง) → ไม่มีป๊อปอัปแดง', !hidden(await p.evaluate(() => window.__toasts)), await p.evaluate(() => window.__toasts));
  // 2) ค่าในเครื่องรุ่นเก่าที่ส่งเข้ารายการตอนเปิดแอป
  await p.evaluate(() => { SETTINGS.units = (SETTINGS.units || []).concat(['Mw']); _localListsTried = {}; return migrateLocalLists(); }); await p.waitForTimeout(800);
  ok('ส่งค่าในเครื่องเข้ารายการตอนเปิดแอป (มีค่าที่ถูกซ่อน) → ไม่มีป๊อปอัปแดง', !hidden(await p.evaluate(() => window.__toasts)));
  // 3) กดเพิ่มเองในหน้าต่าง "อื่น ๆ (ระบุ)"
  await p.evaluate(() => { const el = document.createElement('select'); el.innerHTML = optOptions('uom', 'pcs'); document.body.appendChild(el); el.value = OPT_OTHER; optOther(el, 'uom'); }); await p.waitForTimeout(200);
  await p.fill('#optNewVal', 'Mw'); await p.click('#modalRoot button:has-text("เพิ่ม & เลือก")'); await p.waitForTimeout(800);
  const t3 = await p.evaluate(() => window.__toasts), hint = await p.textContent('#modalRoot');
  ok('กดเพิ่มค่าที่ถูกซ่อนเอง → ไม่มีป๊อปอัปแดง · บอกในหน้าต่างแทนว่าให้เลือกค่าอื่น', !hidden(t3) && /ถูกซ่อนจากรายการแล้ว — เลือกค่าอื่น/.test(hint), { t3, hint: hint.slice(0, 200) });
  await b.close(); srv.close();
  console.log(fails ? fails + ' FAILED' : 'ALL v5.11 E2E PASSED'); process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL crash', e && e.stack); process.exit(1); });
