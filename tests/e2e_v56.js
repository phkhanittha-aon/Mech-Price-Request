// v5.6 — หน้าตั้งค่า Lark Bot บนหน้าจอจริง (Admin) · ผู้จัดการไม่เห็นเมนู · มือถือไม่ล้นจอ
// รัน: NODE_PATH=$(npm root -g) node tests/e2e_v56.js $PWD [out-dir]   (ทดสอบบนเครื่องเท่านั้น ห้าม deploy)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), crypto = require('crypto');
const { makeRuntime } = require('./gasmock');
const [, , DIR, OUT] = process.argv;
const { ctx, sheets, props, fetchLog } = makeRuntime(DIR + '/Code.gs');
const H = s => crypto.createHash('sha256').update(s + 'mgs-internal-2025').digest('hex');
const U = sheets['Users'], uh = U.rows[0];
[['adm', 'Khanittha', 'Admin', 'adm@mglobalsourcing.net'], ['pm', 'Procure', 'Procurement Mgr', 'pm@m.co'], ['src', 'Chatraporn', 'Sourcing', '']]
  .forEach(([id, n, r, e]) => { const x = []; x[uh.indexOf('Id')] = id; x[uh.indexOf('Name')] = n; x[uh.indexOf('Role')] = r; x[uh.indexOf('Scope')] = 'all'; x[uh.indexOf('PassHash')] = H('pw123456'); x[uh.indexOf('Email')] = e; U.rows.push(x); });
const html = fs.readFileSync(DIR + '/Index.html', 'utf8');
const srv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(html); }).listen(0);
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 400) : '')); if (!c) fails++; };
const URL_A = 'https://open.larksuite.com/open-apis/bot/v2/hook/aaaa1111-bbbb-2222-cccc-3333dddd52e1', SEC_A = 'SuperSecretA_9xQ';
const seen = [];

(async () => {
  const b = await chromium.launch();
  const login = async (u, vp) => { const p = await (await b.newContext({ viewport: vp || { width: 1366, height: 900 } })).newPage();
    p.on('pageerror', e => { console.log('PAGEERROR', e.message); fails++; });
    await p.route('https://script.google.com/**', async rt => { const r = rt.request(); let out;
      if (r.method() === 'POST') out = ctx.apiPost(r.postData()); else { const q = new URL(r.url()); const g = k => q.searchParams.get(k) || ''; out = ctx.apiGet(g('type'), g('token'), g('id') || g('since')); }
      seen.push(out); await rt.fulfill({ status: 200, contentType: 'application/json', body: out }); });
    await p.goto('http://localhost:' + srv.address().port + '/?app=index');
    await p.fill('#loginUser', u); await p.fill('#loginPass', 'pw123456'); await p.click('button:has-text("เข้าสู่ระบบ →")'); await p.waitForTimeout(1800); return p; };

  console.log('== 1) Admin ==');
  const a = await login('adm');
  ok('มีเมนู "ตั้งค่า Lark Bot"', await a.locator('#nav .nav-item:has-text("ตั้งค่า Lark Bot")').count() === 1);
  await a.locator('#nav .nav-item:has-text("ตั้งค่า Lark Bot")').click(); await a.waitForTimeout(600);
  let txt = await a.textContent('#content');
  ok('หน้าแสดงวิธีสร้างบอท + โหมดทดสอบ + บอท 2 ตัว (ยังไม่ได้ตั้ง)', /วิธีสร้างบอท/.test(txt) && /MGS Price Request/.test(txt) && /MGS Reminder/.test(txt) && (txt.match(/ยังไม่ได้ตั้ง/g) || []).length >= 2 && /ทดสอบ — สร้างการ์ดเก็บไว้/.test(txt), txt.slice(0, 300));
  ok('ปุ่มส่งการ์ดทดสอบ/ลบค่า ปิดอยู่เมื่อยังไม่ตั้ง', await a.locator('#larkBotA button:has-text("ส่งการ์ดทดสอบ")').isDisabled());
  ok('เตือนผู้ใช้ที่ยังไม่มีอีเมล (Chatraporn)', /@แท็กไม่ได้/.test(txt) && /Chatraporn/.test(txt));
  await a.fill('#lkUrlA', 'https://example.com/hook/x'); await a.waitForTimeout(100);
  ok('พิมพ์ URL ผิดรูปแบบ → เตือนทันที', /ต้องขึ้นต้นด้วย https:\/\/open\.larksuite\.com/.test(await a.textContent('#lkHintA')));
  await a.click('#larkBotA button:has-text("บันทึก")'); await a.waitForTimeout(400);
  ok('กดบันทึก URL ผิด → ไม่ส่งไป server', !props.LARK_BOT_URL && /ไม่ถูกรูปแบบ/.test(await a.textContent('#larkBotA')));
  await a.fill('#lkUrlA', URL_A); await a.fill('#lkSecA', SEC_A);
  ok('ช่อง Secret ซ่อนตัวอักษร (password)', await a.getAttribute('#lkSecA', 'type') === 'password');
  await a.click('#larkBotA button:has-text("บันทึก")'); await a.waitForTimeout(800);
  txt = await a.textContent('#larkBotA');
  ok('บันทึกแล้ว: ✓ ตั้งแล้ว + URL ปิดบัง ••••52e1 + Secret (ซ่อนไว้)', /✓ ตั้งแล้ว/.test(txt) && /••••52e1/.test(txt) && /ซ่อนไว้/.test(txt) && /บันทึกแล้ว/.test(txt), txt.slice(0, 300));
  ok('ค่าอยู่ใน Script Properties · ช่องกรอกถูกล้าง', props.LARK_BOT_URL === URL_A && props.LARK_BOT_SECRET === SEC_A && await a.inputValue('#lkUrlA') === '' && await a.inputValue('#lkSecA') === '');
  ok('Secret ไม่เคยถูกส่งกลับมาที่หน้าเว็บ และไม่อยู่ใน localStorage', !seen.some(s => s.includes(SEC_A)) && !(await a.evaluate(s => JSON.stringify(localStorage).includes(s), SEC_A)) && !(await a.content()).includes(SEC_A));
  ok('Reminder ยังไม่ตั้ง → บอกว่าจะส่งผ่าน MGS Price Request', /จะส่งผ่าน MGS Price Request/.test(await a.textContent('#larkBotB')));
  fetchLog.length = 0;
  await a.click('#larkBotA button:has-text("ส่งการ์ดทดสอบ")'); await a.waitForTimeout(800);
  txt = await a.textContent('#larkBotA');
  ok('ส่งการ์ดทดสอบ → ยิง 1 ครั้ง · ขึ้น "ส่งสำเร็จ" + ส่งล่าสุด = ส่งการ์ดทดสอบ', fetchLog.length === 1 && /ส่งการ์ดทดสอบเข้ากลุ่มแล้ว/.test(txt) && /ส่งการ์ดทดสอบ · ส่งสำเร็จ/.test(txt), txt.slice(0, 400));
  await a.click('.lark-page button:has-text("ส่งจริง")'); await a.waitForTimeout(200);
  ok('เปิดส่งจริงต้องยืนยันก่อน', /เปิดส่งจริง\?/.test(await a.textContent('#modalRoot')) && props.LARK_MODE === undefined);
  await a.click('#modalRoot button:has-text("เปิดส่งจริง")'); await a.waitForTimeout(800);
  ok('ยืนยันแล้ว → LARK_MODE = live · ปุ่มส่งจริงถูกเลือก', props.LARK_MODE === 'live' && await a.locator('.lark-page .seg button.on:has-text("ส่งจริง")').count() === 1);
  await a.click('.lark-page button:has-text("ติดตั้งตอนนี้")'); await a.waitForTimeout(800);
  ok('ติดตั้งตัวส่งอัตโนมัติจากหน้าเว็บ → ✓ ติดตั้งแล้ว', /✓ ติดตั้งแล้ว/.test(await a.textContent('.lark-page')));
  if (OUT) await a.screenshot({ path: OUT + '/v56_larkbot.png', fullPage: true });
  await a.click('#larkBotA button:has-text("ลบค่า")'); await a.waitForTimeout(200);
  await a.click('#modalRoot button:has-text("ยืนยันลบค่า")'); await a.waitForTimeout(800);
  ok('ลบค่า (ยืนยัน) → ลบจาก Script Properties · หน้ากลับเป็นยังไม่ได้ตั้ง', !props.LARK_BOT_URL && /ยังไม่ได้ตั้ง/.test(await a.textContent('#larkBotA')));
  const m = await login('adm', { width: 390, height: 820 });
  await m.evaluate(() => go('larkbot')); await m.waitForTimeout(700);
  ok('มือถือ 390px: ไม่ล้นจอ', await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  if (OUT) await m.screenshot({ path: OUT + '/v56_larkbot_mobile.png', fullPage: true });

  console.log('== 2) ผู้จัดการ / Sourcing ==');
  const p = await login('pm');
  ok('Sourcing Manager ไม่เห็นเมนู Lark Bot', await p.locator('#nav .nav-item:has-text("ตั้งค่า Lark Bot")').count() === 0);
  await p.evaluate(() => go('larkbot')); await p.waitForTimeout(300);
  ok('เข้าตรง ๆ (พิมพ์ URL / เรียก go) → หน้า "ไม่มีสิทธิ์"', /Access Restricted|ไม่มีสิทธิ์/.test(await p.textContent('#content')));
  const s = await login('src');
  ok('Sourcing ไม่เห็นเมนู', await s.locator('#nav .nav-item:has-text("ตั้งค่า Lark Bot")').count() === 0);

  console.log(fails ? fails + ' FAILED' : 'ALL v5.6 E2E PASSED');
  await b.close(); srv.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL crash', e && e.stack); process.exit(1); });
