// v5.5 — เปิดหน้าใหม่ไม่ดึงทั้งชีท · ไม่ดึงซ้อน · บันทึกตั้งค่าไม่ทำให้ทุกเครื่องล้างข้อมูล (หน้ารีเฟรชเอง)
// รัน: NODE_PATH=$(npm root -g) node tests/e2e_v541.js $PWD   (ทดสอบบนเครื่องเท่านั้น ห้าม deploy)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), crypto = require('crypto');
const { makeRuntime } = require('./gasmock');
const [, , DIR] = process.argv;
const { ctx, sheets } = makeRuntime(DIR + '/Code.gs');
const H = s => crypto.createHash('sha256').update(s + 'mgs-internal-2025').digest('hex');
const U = sheets['Users'], uh = U.rows[0];
[['src', 'Chatraporn', 'Sourcing'], ['pm', 'Procure', 'Procurement Mgr'], ['boss', 'BOSS', 'Sales']]
  .forEach(([id, n, r]) => { const x = []; x[uh.indexOf('Id')] = id; x[uh.indexOf('Name')] = n; x[uh.indexOf('Role')] = r; x[uh.indexOf('Scope')] = 'all'; x[uh.indexOf('PassHash')] = H('pw123456'); x[uh.indexOf('Email')] = id + '@m.co'; U.rows.push(x); });
const post = p => JSON.parse(ctx.apiPost(JSON.stringify(p)));
const T = { pm: post({ action: 'login', user: 'pm', passHash: H('pw123456') }).token };
const det = (id, title, extra) => JSON.stringify(Object.assign({ id, _v: 2, _pm: 2, _sv: 3, docType: 'QT', docNo: 'QT-' + id, status: 'In Progress', round: 1, approvalRoles: [], approvals: [], releasedTo: [],
  header: { ref: 'QT-' + id, title, customer: 'CP', salesUserId: 'boss', sales: 'BOSS', currency: 'THB', groupType: 'Inverter' }, lines: [{ code: 'A', group: 'INVERTER', qty: 1, up: 100, costCur: 'THB', opPct: 20 }], remarks: [], auditLogs: [], globalExtras: [] }, extra || {}));
const save = (id, title) => post({ token: T.pm, action: 'save', id, docType: 'QT', docNo: 'QT-' + id, title, customer: 'CP', salesUserId: 'boss', status: 'In Progress', detail: det(id, title) });
for (let k = 0; k < 30; k++) save('Q' + k, 'Project ' + k);
const S = sheets['Settings'], sh = S.rows[0];
const html = fs.readFileSync(DIR + '/Index.html', 'utf8');
const srv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(html); }).listen(0);
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 400) : '')); if (!c) fails++; };
const reqs = [];

(async () => {
  const b = await chromium.launch(); const c = await b.newContext({ viewport: { width: 1366, height: 900 } }); const p = await c.newPage();
  p.on('pageerror', e => { console.log('PAGEERROR', e.message); fails++; });
  await p.route('https://script.google.com/**', async rt => { const r = rt.request(); let out;
    if (r.method() === 'POST') { const pj = JSON.parse(r.postData()); reqs.push('POST ' + pj.action); out = ctx.apiPost(r.postData()); }
    else { const u = new URL(r.url()); const g = k => u.searchParams.get(k) || ''; reqs.push('GET ' + g('type')); out = ctx.apiGet(g('type'), g('token'), g('id') || g('since')); }
    await new Promise(z => setTimeout(z, 120));                    // หน่วงเหมือนเครือข่ายจริง ให้เห็นการขอซ้อน
    await rt.fulfill({ status: 200, contentType: 'application/json', body: out }); });
  const has = id => p.evaluate(i => QUOTES.some(q => q.id === i), id);
  const titleOf = id => p.evaluate(i => (QUOTES.find(q => q.id === i) || { header: {} }).header.title, id);
  const loaded = () => p.waitForFunction(() => typeof QUOTES !== 'undefined' && QUOTES.filter(q => /^Q\d/.test(q.id)).length >= 30 && !_initInFlight, null, { timeout: 30000 });

  console.log('== 1) ล็อกอินครั้งแรก = ดึงทั้งชุด (ครั้งเดียว ไม่ซ้อน) ==');
  await p.goto('http://localhost:' + srv.address().port + '/?app=index');
  await p.fill('#loginUser', 'src'); await p.fill('#loginPass', 'pw123456'); await p.click('button:has-text("เข้าสู่ระบบ →")');
  await loaded(); await p.evaluate(() => go('dashboard')); await p.waitForTimeout(800);
  ok('ดึงทั้งชุด 1 ครั้ง · ผู้ใช้/ตั้งค่า/ใบ ขอพร้อมกัน', reqs.filter(x => x === 'GET quotations').length === 1 && reqs.includes('GET users') && reqs.includes('GET settings'), reqs);
  ok('มีเครื่องหมายซิงค์ของผู้ใช้นี้ (ใช้ตอนเปิดหน้าใหม่)', await p.evaluate(() => { const m = LS.get('syncMark', null); return !!(m && m.uid === 'src' && m.serverTime && m.fullAt); }));

  console.log('== 2) เปิดหน้าใหม่ = ขอเฉพาะใบที่เปลี่ยน ==');
  await p.waitForTimeout(1100); save('Q5', 'แก้จากอีกเครื่อง'); save('QNEW', 'ใบใหม่จากอีกเครื่อง');
  reqs.length = 0; await p.reload(); await loaded(); await p.waitForTimeout(800);
  ok('ไม่ดึงทั้งชีท — ใช้ type=changes แทน', !reqs.includes('GET quotations') && reqs.includes('GET changes'), reqs);
  ok('ได้ใบที่แก้และใบใหม่จากเครื่องอื่นครบ', await titleOf('Q5') === 'แก้จากอีกเครื่อง' && await has('QNEW'));
  ok('ใบเดิมอื่นยังอยู่ครบ', await p.evaluate(() => QUOTES.filter(q => /^Q\d/.test(q.id)).length) >= 30);

  console.log('== 3) บันทึกตั้งค่าไม่ทำให้ทุกเครื่องล้างข้อมูล ==');
  while (S.rows.length < 2) S.rows.push(new Array(sh.length).fill(''));
  S.rows[1][sh.indexOf('Detail')] = JSON.stringify(Object.assign(JSON.parse(S.rows[1][sh.indexOf('Detail')] || '{}'), { dataEpoch: 'E1', dataEpochAt: new Date(Date.now() - 86400000).toISOString() }));
  reqs.length = 0; await p.evaluate(() => manualSync()); await p.waitForTimeout(1200);
  ok('ปุ่ม 🔄 ซิงค์ = ดึงทั้งชุด (และรับ epoch ปัจจุบัน)', reqs.includes('GET quotations') && await p.evaluate(() => LS.get('dataEpoch', '')) === 'E1', reqs);
  const n0 = await p.evaluate(() => QUOTES.length);
  // อีกเครื่อง (ผู้จัดการ) ถือ epoch เก่าแล้วกดบันทึกตั้งค่า — เดิมทำให้ทุกเครื่องล้างข้อมูลแล้วโหลดใหม่ทั้งชุด
  post({ token: T.pm, action: 'saveSettings', settingsRev: 1, detail: JSON.stringify({ dataEpoch: 'E0-old', exrate: 36.5 }) });
  ok('อีกเครื่องที่ถือ epoch เก่าบันทึกตั้งค่า → epoch บนชีทไม่เปลี่ยน', JSON.parse(S.rows[1][sh.indexOf('Detail')]).dataEpoch === 'E1');
  reqs.length = 0; await p.evaluate(() => pollChanges(true)); await p.waitForTimeout(600);
  ok('รอบซิงค์ถัดไปไม่ล้างข้อมูลในเครื่อง (ไม่รีเฟรชเอง · ไม่ดึงทั้งชุด)', await p.evaluate(() => QUOTES.length) === n0 && await p.evaluate(() => LS.get('dataEpoch', '')) === 'E1' && !reqs.includes('GET quotations'), reqs);

  console.log('== 4) ล้างข้อมูลชุดใหม่ / เปลี่ยนผู้ใช้ = ดึงทั้งชุด ==');
  S.rows[1][sh.indexOf('Detail')] = JSON.stringify(Object.assign(JSON.parse(S.rows[1][sh.indexOf('Detail')]), { dataEpoch: 'E2' }));
  reqs.length = 0; await p.reload(); await p.waitForFunction(() => typeof _initInFlight !== 'undefined' && !_initInFlight && LS.get('dataEpoch', '') === 'E2', null, { timeout: 30000 }); await p.waitForTimeout(500);
  ok('epoch ใหม่ระหว่างปิดหน้า → ขอ changes แล้วสลับเป็นดึงทั้งชุด', reqs.includes('GET changes') && reqs.includes('GET quotations') && await has('QNEW'), reqs);
  await p.evaluate(() => logout()); await p.waitForTimeout(300);
  reqs.length = 0; await p.fill('#loginUser', 'pm'); await p.fill('#loginPass', 'pw123456'); await p.click('button:has-text("เข้าสู่ระบบ →")'); await loaded(); await p.waitForTimeout(500);
  ok('ผู้ใช้คนอื่นบนเครื่องเดียวกัน → ดึงทั้งชุด (ไม่ใช้เครื่องหมายของคนก่อน)', reqs.includes('GET quotations'), reqs);
  await p.evaluate(() => { SETTINGS.dataEpoch = 'E0-old'; SETTINGS.settingsRev = 1; SETTINGS.exrate = 36.6; saveSettings(); }); await p.waitForTimeout(600);
  ok('ผู้จัดการบันทึกตั้งค่า (ในเครื่องถือ epoch เก่า / rev เก่า) → epoch บนชีทคงเดิม · rev ในเครื่องตามที่ server ใช้จริง',
    JSON.parse(S.rows[1][sh.indexOf('Detail')]).dataEpoch === 'E2' && await p.evaluate(() => SETTINGS.settingsRev) === +S.rows[1][sh.indexOf('SettingsRev')] && +S.rows[1][sh.indexOf('SettingsRev')] > 1,
    [await p.evaluate(() => SETTINGS.settingsRev), S.rows[1][sh.indexOf('SettingsRev')]]);

  console.log(fails ? fails + ' FAILED' : 'ALL v5.5 E2E PASSED');
  await b.close(); srv.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL crash', e && e.stack); process.exit(1); });
