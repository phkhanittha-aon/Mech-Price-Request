// v4.4 — Phase 2 Login ในเบราว์เซอร์ (จำลองการเปิดผ่าน /exec ด้วย gas_shim)
// รัน: NODE_PATH=$(npm root -g) node tests/e2e_login.js $PWD /tmp      (ทดสอบบนเครื่องเท่านั้น ห้าม deploy)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), crypto = require('crypto');
const { makeRuntime } = require('./gasmock');
const { installGasShim } = require('./gas_shim');
const [, , DIR, OUT] = process.argv;
const { ctx, sheets } = makeRuntime(DIR + '/Code.gs');
const H = s => crypto.createHash('sha256').update(s + 'mgs-internal-2025').digest('hex');
const U = sheets['Users'], h = U.rows[0], col = n => h.indexOf(n);
const add = (id, name, role, email) => { const r = []; r[col('Id')] = id; r[col('Name')] = name; r[col('Role')] = role; r[col('Scope')] = 'all'; r[col('PassHash')] = H('pw123456'); r[col('Email')] = email; U.rows.push(r); };
add('bd', 'BD Manager', 'BD Mgr', 'bd@mglobalsourcing.net'); add('sourcing1', 'Chatraporn', 'Sourcing', 'chat@mglobalsourcing.net');
add('sales_boss', 'BOSS', 'Sales', 'boss@mglobalsourcing.net'); add('admin', 'Admin', 'Admin', 'admin@mglobalsourcing.net');
const urow = id => U.rows.find(r => r[col('Id')] === id);
const post = p => JSON.parse(ctx.apiPost(JSON.stringify(p)));
// ใบตัวอย่างสำหรับหน้าแก้ไข
const tS = post({ action: 'login', user: 'sourcing1', passHash: H('pw123456') }).token;
const q = { id: 'Q1', _v: 2, _pm: 2, _sv: 3, docType: 'QT', docNo: 'QT-1', status: 'Submitted', approvalRoles: [], approvals: [], releasedTo: [], auditLogs: [], globalExtras: [], round: 1,
  header: { ref: 'QT-1', title: 'Factory Rooftop', customer: 'CP', sales: 'BOSS', salesUserId: 'sales_boss', currency: 'THB', priceTerm: 'Special price', incoterm: 'CIF at MGS', exrate: 36, rates: { USD: 36, CNY: 5 }, offerDate: '2026-10-09', validity: 30, groupType: 'Inverter' },
  lines: [{ code: 'SG110CX', desc: 'Inverter', group: 'INVERTER', comGroup: 'Inverter', uom: 'pcs', qty: 2, up: 3000, costCur: 'USD', dutyPct: 0, clearancePct: 2, opPct: 20, freep: 0 }], remarks: [] };
post({ token: tS, action: 'save', id: 'Q1', docNo: 'QT-1', status: 'Submitted', salesUserId: 'sales_boss', detail: JSON.stringify(q), salesDetail: '{}' });
const killSessions = () => { const S = sheets['Sessions']; S.rows.splice(1); };   // จำลอง "token หมดอายุทุกใบ"

const files = { '/': fs.readFileSync(DIR + '/Index.html', 'utf8'), '/sales': fs.readFileSync(DIR + '/Sales.html', 'utf8') };
const srv = http.createServer((rq, rs) => { rs.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); rs.end(files[rq.url.split('?')[0].split('#')[0]] || files['/']); }).listen(0);
const B = 'http://localhost:' + srv.address().port;
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && x !== undefined ? '  -> ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
async function open(b, path, email, vp) {
  globalThis.__SSO_EMAIL = email || '';
  const c = await b.newContext({ viewport: vp || { width: 1366, height: 860 } }); const p = await c.newPage();
  p.on('pageerror', e => { console.log('PAGEERROR', e.message); fails++; });
  await installGasShim(p, ctx);
  await p.goto(B + path); await p.waitForTimeout(1600); return p;
}
const appShown = p => p.evaluate(() => !document.getElementById('app').classList.contains('hidden'));
(async () => {
  const b = await chromium.launch();
  console.log('== Index: เส้นทาง Google ==');
  let p = await open(b, '/', 'bd@mglobalsourcing.net');
  ok('BD Mgr เปิดหน้า → เข้าระบบอัตโนมัติด้วยอีเมล Google (ไม่ต้องกรอก)', await appShown(p) && await p.evaluate(() => CURRENT && CURRENT.id === 'bd'));
  // v5.1: อนุมัติก่อนหลังได้ → กลับเป็นค่าเดิมของ v4.x (BD เห็นใบที่รอตัวเอง 1 ใบ)
  ok('หน้าแรกของผู้อนุมัติ = รออนุมัติ', await p.evaluate(() => route) === 'approvals' && (await p.textContent('#content')).includes('รอคุณอนุมัติ (1)'));
  await p.screenshot({ path: OUT + '/p2_approvals_home.png' });
  // role เปลี่ยนกลางทาง
  urow('bd')[col('Role')] = 'Sourcing';
  await p.evaluate(() => pollChanges(true)); await p.waitForTimeout(700);
  ok('Admin เปลี่ยน role → หน้าจอปรับทันที (เมนูรออนุมัติหายไป, ย้ายออกจากหน้าที่ไม่มีสิทธิ์)', await p.evaluate(() => CURRENT.role === 'Sourcing' && route !== 'approvals') && !(await p.textContent('#nav')).includes('รออนุมัติ'));
  urow('bd')[col('Role')] = 'BD Mgr';
  // ปิดบัญชีกลางทาง
  urow('bd')[col('Active')] = 'FALSE';
  await p.evaluate(() => pollChanges(true)); await p.waitForTimeout(700);
  ok('ปิดบัญชีระหว่างใช้งาน → แจ้ง "บัญชีถูกปิดใช้งาน" (ไม่ใช่จอว่าง)', (await p.textContent('#modalRoot')).includes('ถูกปิดใช้งาน'));
  urow('bd')[col('Active')] = '';

  p = await open(b, '/', 'chat@mglobalsourcing.net');
  ok('Sourcing → หน้าแรก = คิวคำขอราคา', await p.evaluate(() => route) === 'srqueue');

  console.log('== Index: หน้า login + fallback รหัสผ่าน ==');
  p = await open(b, '/', 'stranger@gmail.com');
  const who = await p.textContent('#loginWho');
  ok('อีเมลไม่มีสิทธิ์ → หน้า login แสดงอีเมลที่ตรวจพบ + วิธีแก้', !(await appShown(p)) && who.includes('stranger@gmail.com') && who.includes('ยังไม่มีสิทธิ์'), who);
  ok('หน้า login แสดง APP_VERSION + build', /v\d+\.\d/.test(await p.textContent('#buildStamp'))   /* v5.0 (ตั้งใจ): เดิมล็อก v4.x */);
  await p.screenshot({ path: OUT + '/p2_login_unknown_email.png' });
  await p.fill('#loginUser', 'sourcing1'); await p.fill('#loginPass', 'pw123456'); await p.click('button:has-text("เข้าสู่ระบบ →")'); await p.waitForTimeout(1500);
  ok('เข้าด้วยชื่อผู้ใช้ + รหัสผ่านแทนได้', await appShown(p) && await p.evaluate(() => CURRENT.id === 'sourcing1'));

  console.log('== Index: token หมดอายุกลางงาน (ต้องไม่เสียงานที่กรอกค้าง) ==');
  await p.evaluate(() => { closeModal(); editQuote('Q1'); }); await p.waitForTimeout(800);
  await p.fill('#op_0', '27'); await p.waitForTimeout(100);
  globalThis.__SSO_EMAIL = '';                          // ไม่มีอีเมล Google → ต้องขอรหัสผ่าน
  killSessions();
  await p.evaluate(() => liveTick()); await p.waitForTimeout(900);
  let m = await p.textContent('#modalRoot');
  ok('หมดอายุ → กล่องยืนยันตัวตนในหน้าเดิม (ไม่ใช่จอว่าง / ไม่ออกจากหน้า)', m.includes('ยืนยันตัวตนอีกครั้ง') && await p.evaluate(() => route === 'new' && dirty && editing.lines[0].opPct === 27), m.slice(0, 120));
  await p.screenshot({ path: OUT + '/p2_reauth_modal.png' });
  await p.fill('#ra_pass', 'wrongpass'); await p.click('#modalRoot button:has-text("ทำงานต่อ")'); await p.waitForTimeout(500);
  ok('รหัสผิด → บอกในกล่องเดิม', (await p.textContent('#ra_err')).length > 0);
  await p.fill('#ra_pass', 'pw123456'); await p.click('#modalRoot button:has-text("ทำงานต่อ")'); await p.waitForTimeout(900);
  ok('รหัสถูก → ทำงานต่อ งานที่กรอกค้างยังอยู่ (%GP 27)', !(await p.textContent('#modalRoot')) && await p.evaluate(() => route === 'new' && dirty && editing.lines[0].opPct === 27 && !!SESSION_TOKEN));
  killSessions(); globalThis.__SSO_EMAIL = 'chat@mglobalsourcing.net';
  await p.evaluate(() => liveTick()); await p.waitForTimeout(1200);
  ok('หมดอายุอีกครั้ง แต่มีอีเมล Google → ต่อให้อัตโนมัติ ไม่มีกล่องให้กรอก', !(await p.textContent('#modalRoot')) && await p.evaluate(() => !!SESSION_TOKEN && editing.lines[0].opPct === 27));
  killSessions(); globalThis.__SSO_EMAIL = 'bd@mglobalsourcing.net';
  await p.evaluate(() => liveTick()); await p.waitForTimeout(1200);
  m = await p.textContent('#modalRoot');
  ok('อีเมล Google เป็นคนละคน → ไม่สลับบัญชีเงียบ ๆ (ขอรหัสของคนเดิม)', m.includes('ยืนยันตัวตนอีกครั้ง') && await p.evaluate(() => CURRENT.id === 'sourcing1'));

  console.log('== Index: เปิดหน้าใหม่ ==');
  p = await open(b, '/', '');
  await p.fill('#loginUser', 'admin'); await p.fill('#loginPass', 'pw123456'); await p.click('button:has-text("เข้าสู่ระบบ →")'); await p.waitForTimeout(1500);
  const ctx2 = p.context(); const p2 = await ctx2.newPage(); await installGasShim(p2, ctx);
  await p2.goto(B + '/'); await p2.waitForTimeout(1500);
  ok('เปิดหน้าใหม่ token ยังใช้ได้ → เข้าเลย (ตรวจกับ server แล้ว)', await appShown(p2) && await p2.evaluate(() => CURRENT.id === 'admin'));
  killSessions();
  const p3 = await ctx2.newPage(); await installGasShim(p3, ctx); globalThis.__SSO_EMAIL = '';
  await p3.goto(B + '/'); await p3.waitForTimeout(1500);
  ok('token หมดอายุก่อนเปิดหน้า → ขึ้นหน้า login (เดิมเปิดเข้าแอปค้างไว้ทั้งที่ใช้งานไม่ได้)', !(await appShown(p3)));

  console.log('== Sales app ==');
  let s = await open(b, '/sales', 'boss@mglobalsourcing.net', { width: 390, height: 844 });
  ok('Sales เปิดแอป → เข้าอัตโนมัติด้วยอีเมล Google', await s.evaluate(() => S.user && S.user.id === 'sales_boss') && (await s.textContent('#main')).includes('งานของฉัน'));
  await s.evaluate(() => newRequest()); await s.waitForTimeout(300);
  await s.fill('#f_customer', 'Thaibev'); await s.fill('#ld_0', 'Inverter 110kW'); await s.waitForTimeout(100);
  killSessions(); globalThis.__SSO_EMAIL = '';
  await s.click('#btnSend'); await s.waitForTimeout(1200);
  ok('ส่งคำขอตอน token หมดอายุ → กล่องยืนยันตัวตน ฟอร์มยังอยู่', (await s.textContent('#modalRoot')).includes('ยืนยันตัวตนอีกครั้ง') && await s.evaluate(() => S.form && S.form.header.customer === 'Thaibev'));
  await s.fill('#ra_pass', 'pw123456'); await s.click('#modalRoot button:has-text("ทำงานต่อ")'); await s.waitForTimeout(800);
  await s.click('#btnSend'); await s.waitForTimeout(1300);
  ok('ยืนยันแล้วกดส่งซ้ำ → คำขอถูกบันทึก ไม่ต้องกรอกใหม่', sheets['Quotations'].rows.some(r => String(r.join('|')).includes('Thaibev')));
  s = await open(b, '/sales', 'stranger@gmail.com', { width: 390, height: 844 });
  ok('แอป Sales: อีเมลไม่มีสิทธิ์ → แสดงอีเมลที่ตรวจพบ', (await s.textContent('#ssoWho')).includes('stranger@gmail.com'));
  s = await open(b, '/sales', 'chat@mglobalsourcing.net');
  ok('Sourcing เปิดแอป Sales → หน้าแรก = ทีมขาย', await s.evaluate(() => S.route.page) === 'team');
  console.log(fails ? '\n' + fails + ' FAILED' : '\nALL LOGIN E2E PASSED');
  await b.close(); srv.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
