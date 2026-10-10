// Phase 6 — ความเข้ากันได้กับเวอร์ชัน production ปัจจุบัน (commit ec8c4ea: Index.html v2.1 + Code.gs v4.0)
// 1) เปิด "ไฟล์ production จริง" ในเบราว์เซอร์ + backend production → สร้างข้อมูลด้วยฟังก์ชันของ production เอง
//    (ใบ THB / USD / CNY, ใบที่ค้างในคิวออฟไลน์ syncQueue, ร่างที่ยังไม่บันทึก, ตั้งค่า, ราคา Default, สินค้าเพิ่มเอง)
// 2) ย้ายข้อมูลชีทของ production ไปให้ Code.gs ใหม่ + รัน setup() (เหมือนวาง Code.gs ใหม่บนชีทจริง)
// 3) เปิด Index.html ใหม่บน localStorage ชุดเดิม → ทุกอย่างต้องยังใช้ได้และยอดเงินเท่าเดิม
// รัน: NODE_PATH=$(npm root -g) node tests/compat_production.js $PWD [prod-ref]   (ทดสอบบนเครื่องเท่านั้น ห้าม deploy)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'), cp = require('child_process');
const { makeRuntime } = require('./gasmock');
const DIR = process.argv[2] || '.', REF = process.argv[3] || 'ec8c4ea';
const H = s => crypto.createHash('sha256').update(s + 'mgs-internal-2025').digest('hex');
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 400) : '')); if (!c) fails++; };

// ---------- production files (จาก git) ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mgs-prod-'));
const git = f => cp.execSync('git show ' + REF + ':' + f, { cwd: DIR, maxBuffer: 64 << 20 }).toString();
fs.writeFileSync(tmp + '/Code.gs', git('Code.gs')); const PROD_HTML = git('Index.html');
const prod = makeRuntime(tmp + '/Code.gs');                       // ไม่มี Lark.gs ในโฟลเดอร์นี้ = backend production ล้วน
{ const U = prod.sheets.Users, h = U.rows[0];
  [['sourcing1', 'Chatraporn', 'Sourcing'], ['gm', 'General Manager', 'GM'], ['procurement', 'Procurement Manager', 'Procurement Mgr'], ['bd', 'BD Manager', 'BD Mgr'], ['sales_boss', 'BOSS', 'Sales'], ['sales_non', 'NON', 'Sales']]
    .forEach(([id, n, r]) => { const x = []; x[h.indexOf('Id')] = id; x[h.indexOf('Name')] = n; x[h.indexOf('Role')] = r; x[h.indexOf('Scope')] = 'all'; x[h.indexOf('PassHash')] = H('1234'); U.rows.push(x); }); }

function serve(html) { return http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(html); }).listen(0); }
async function route(p, rt, state) {
  await p.route('https://script.google.com/**', async x => {
    if (state && state.offline) return x.abort('internetdisconnected');
    const r = x.request(); let body;
    if (r.method() === 'POST') body = rt.ctx.apiPost(r.postData()); else { const u = new URL(r.url()); const g = k => u.searchParams.get(k) || ''; body = rt.ctx.apiGet(g('type'), g('token'), g('id') || g('since')); }
    await x.fulfill({ status: 200, contentType: 'application/json', body });
  });
}

(async () => {
  const b = await chromium.launch();
  /* ================= 1) production สร้างข้อมูล ================= */
  const s1 = serve(PROD_HTML), st = { offline: false };
  const pc = await b.newContext({ viewport: { width: 1280, height: 860 } }), pp = await pc.newPage();
  const prodErrors = []; pp.on('pageerror', e => prodErrors.push(e.message));
  await route(pp, prod, st);
  await pp.goto('http://localhost:' + s1.address().port + '/'); await pp.waitForTimeout(700);
  await pp.fill('#loginUser', 'sourcing1'); await pp.fill('#loginPass', '1234');
  await pp.click('#login button.btn'); await pp.waitForTimeout(1500);
  ok('[production] ล็อกอินและเปิดแอปได้ (ใช้สร้างข้อมูลทดสอบ)', await pp.evaluate(() => !!CURRENT && CURRENT.id === 'sourcing1'));
  const mk = async (id, cur, rates, lines, offline) => {
    st.offline = !!offline;
    return pp.evaluate(([id, cur, rates, lines]) => {
      editing = blankQuote(); editing.id = id; Object.assign(editing.header, { title: 'Compat ' + id, customer: 'CP Group', currency: cur, rates, exrate: rates.USD, incoterm: 'CIF at MGS' });
      editing.header.sales = 'BOSS'; editing.header.salesUserId = 'sales_boss';
      editing.lines = lines; dirty = true; doSaveQuote('Draft', false);   // ขั้นบันทึกจริงของ production (หลังผู้ใช้กดยืนยันในกล่องตรวจข้อมูล)
      const q = QUOTES.find(x => x.id === id); const t = quoteTotals(q); return { total: t.total, cost: t.cost, profit: t.profit };
    }, [id, cur, rates, lines]);
  };
  const L = (code, up, cur, qty, op) => ({ code, desc: code + ' desc', group: 'INVERTER', comGroup: 'Inverter', uom: 'pcs', qty, up, costCur: cur, dutyPct: 5, clearancePct: 2, opPct: op, freep: 0, extras: [] });
  const want = {};
  want['CMP-THB'] = await mk('CMP-THB', 'THB', { USD: 36, CNY: 5 }, [L('SG110CX', 3456.78, 'USD', 12, 18), L('MOUNT-1', 1200, 'THB', 30, 25)]);
  want['CMP-USD'] = await mk('CMP-USD', 'USD', { USD: 36.5, CNY: 5 }, [L('SG250HX', 5000, 'USD', 4, 15), L('CBL-4', 80, 'CNY', 500, 20)]);
  await pp.waitForTimeout(600);
  want['CMP-CNY'] = await mk('CMP-CNY', 'CNY', { USD: 36, CNY: 5 }, [L('SG50CX', 9000, 'CNY', 3, 12)], true);     // ออฟไลน์ → ค้างใน syncQueue
  await pp.waitForTimeout(600);
  await pp.evaluate(() => {
    SETTINGS.exrate = 35.5; if (!SETTINGS.priceTerms.includes('Net 45 days')) SETTINGS.priceTerms.push('Net 45 days'); saveSettings();   // เส้นทางจริงของ production (ขึ้นชีทด้วย)
    setItemPrice('MSSR-SGMeteo01', 1234.5, 'USD');
    CUSTOM.push({ code: 'CUSTOM-XYZ', desc: 'Custom product from prod', group: 'INVERTER', uom: 'set' }); LS.set('customProducts', CUSTOM);
    editing = blankQuote(); editing.id = 'CMP-DRAFT'; editing.header.title = 'ร่างที่ยังไม่บันทึก'; dirty = true; autosaveDraft();
  });
  const prodLS = await pp.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; });
  const queued = JSON.parse(prodLS['syncQueue'] || '[]');            // คีย์จริงของคิว (ไม่มี prefix mgs_)
  ok('[production] สร้างข้อมูลครบ: 3 ใบ · 1 ใบค้างในคิวออฟไลน์ · ร่าง · ตั้งค่า · ราคา · สินค้าเพิ่มเอง',
    JSON.parse(prodLS.mgs_quotes).length >= 3 && queued.some(x => x.payload && x.payload.id === 'CMP-CNY') && !!prodLS.mgs_draft && !!prodLS.mgs_prices && !!prodLS.mgs_customProducts,
    { keys: Object.keys(prodLS), queued: queued.length });
  console.log('   localStorage ของ production: ' + Object.keys(prodLS).sort().join(', '));
  await pc.close(); s1.close();

  /* ================= 2) ชีทเดิม → Code.gs ใหม่ ================= */
  const neo = makeRuntime(DIR + '/Code.gs');
  ['Quotations', 'Products', 'Settings', 'Users', 'Log'].forEach(n => { neo.sheets[n].rows = JSON.parse(JSON.stringify(prod.sheets[n].rows)); });
  neo.sheets.MasterData.rows.length = 1; neo.sheets.NotifyQueue.rows.length = 1;   // แท็บใหม่ยังไม่เคยมีบนชีทจริง
  neo.ctx.setup();                                                 // วาง Code.gs ใหม่บนชีทเดิม → อัปเกรดคอลัมน์ + แปลง hash
  const QH = neo.sheets.Quotations.rows[0];
  ok('[ชีท] ใบที่ production ซิงค์ไว้ยังอยู่ (THB / USD)', ['CMP-THB', 'CMP-USD'].every(id => neo.sheets.Quotations.rows.some(r => r[QH.indexOf('Id')] === id)));
  ok('[ชีท] setup() เพิ่มคอลัมน์ Email / Active ในแท็บ Users โดยไม่ลบคอลัมน์เดิม', ['Id', 'Name', 'Role', 'Scope', 'PassHash', 'Updated', 'Email', 'Active'].every(h => neo.sheets.Users.rows[0].includes(h)));
  ok('[ชีท] รหัสผ่านเดิมถูกแปลงเป็น v2 (ไม่เก็บ hash ที่ใช้แทนรหัสได้)', neo.sheets.Users.rows.slice(1).every(r => /^v2\$/.test(String(r[neo.sheets.Users.rows[0].indexOf('PassHash')]))));
  const MD = neo.sheets.MasterData; const mdh = MD.rows[0];
  ok('[ชีท] แท็บ MasterData สร้างจากรายการใน Settings ของชีท (ไม่มีค่าเพิ่มเองเพราะ Sourcing บันทึก Settings ขึ้นชีทไม่ได้ — ค่าอยู่ในเครื่อง)', MD.rows.length > 30 && !MD.rows.some(r => r[mdh.indexOf('Value')] === 'Net 45 days'));

  /* ================= 3) Index.html ใหม่บน localStorage เดิม ================= */
  const s2 = serve(fs.readFileSync(DIR + '/Index.html', 'utf8'));
  const nc = await b.newContext({ viewport: { width: 1280, height: 860 } });
  await nc.addInitScript(ls => { if (!sessionStorage.getItem('__seeded')) { Object.keys(ls).forEach(k => localStorage.setItem(k, ls[k])); sessionStorage.setItem('__seeded', '1'); } }, prodLS);
  const np = await nc.newPage(); const errs = []; np.on('pageerror', e => errs.push(e.message));
  await route(np, neo, null);
  await np.goto('http://localhost:' + s2.address().port + '/'); await np.waitForTimeout(800);
  ok('[ใหม่] เปิดได้บนข้อมูล production — หน้า login แสดงชื่อผู้ใช้ล่าสุด', await np.inputValue('#loginUser') === 'Chatraporn' || await np.inputValue('#loginUser') === 'sourcing1', await np.inputValue('#loginUser'));
  await np.fill('#loginUser', 'sourcing1'); await np.fill('#loginPass', '1234'); await np.click('button:has-text("เข้าสู่ระบบ →")'); await np.waitForTimeout(3500);
  ok('[ใหม่] ล็อกอินด้วยรหัสเดิม (หลังแปลง hash ที่ server)', await np.evaluate(() => !!CURRENT && CURRENT.id === 'sourcing1'));
  const got = await np.evaluate(ids => ids.map(id => { const q = QUOTES.find(x => x.id === id); if (!q) return null; const t = quoteTotals(q); return { id, total: t.total, cost: t.cost, profit: t.profit, cur: curOf(q) }; }), Object.keys(want));
  console.log('   ยอดรวม: เดิม (production) → ใหม่');
  got.forEach((g, i) => { const k = Object.keys(want)[i], w = want[k]; console.log('   ' + k.padEnd(9) + ' total ' + String(w.total).padEnd(14) + '→ ' + (g && g.total) + '   cost ' + String(w.cost).padEnd(14) + '→ ' + (g && g.cost)); });
  ok('[ใหม่] ใบเดิมทุกใบยังอยู่ และยอดขาย/ต้นทุน/กำไร เท่าเดิมทุกใบ (รวมใบ CNY ที่เคยพัง)', got.every((g, i) => { const w = want[Object.keys(want)[i]]; return g && Math.abs(g.total - w.total) < 0.005 && Math.abs(g.cost - w.cost) < 0.005 && Math.abs(g.profit - w.profit) < 0.005; }), got);
  ok('[ใหม่] คิวออฟไลน์จาก production ถูกส่งขึ้นชีท (ใบ CMP-CNY) และคิวว่าง', neo.sheets.Quotations.rows.some(r => r[QH.indexOf('Id')] === 'CMP-CNY') && await np.evaluate(() => getQueue().length === 0),
    await np.evaluate(() => getQueue()));
  const cnyRow = neo.sheets.Quotations.rows.find(r => r[QH.indexOf('Id')] === 'CMP-CNY');
  ok('[ใหม่] ใบจากคิวเก่าได้ยอดฉบับ Sales (SalesDetail) ที่ไม่มีต้นทุน', cnyRow && !/"up"|"cost"|"opPct"/.test(String(cnyRow[QH.indexOf('SalesDetail')] || '')), cnyRow && String(cnyRow[QH.indexOf('SalesDetail')]).slice(0, 200));
  ok('[ใหม่] ตั้งค่าเดิมยังอยู่ (Ex-rate 35.5 · Price Term "Net 45 days" ที่เพิ่มเองในเครื่องยังเลือกได้ และถูกส่งเข้า MasterData ให้ทุกคน)', await np.evaluate(() => +SETTINGS.exrate === 35.5 && optList('priceTerm').includes('Net 45 days')) && neo.sheets.MasterData.rows.some(r => r[mdh.indexOf('List')] === 'priceTerm' && r[mdh.indexOf('Value')] === 'Net 45 days'));
  ok('[ใหม่] ราคา Default และสินค้าที่เพิ่มเองยังอยู่', await np.evaluate(() => PRICES['MSSR-SGMeteo01'] && PRICES['MSSR-SGMeteo01'].price === 1234.5 && allProducts().some(p => p.code === 'CUSTOM-XYZ')));
  await np.evaluate(() => go('new')); await np.waitForTimeout(300);
  ok('[ใหม่] ร่างที่ยังไม่บันทึกจาก production กู้คืนได้', /ร่างที่ยังไม่บันทึก|กู้คืน|ร่าง/.test(await np.textContent('#content')) && await np.evaluate(() => !!LS.get('draft', null)));
  await np.evaluate(() => { const q = QUOTES.find(x => x.id === 'CMP-USD'); editQuote('CMP-USD'); });
  await np.waitForTimeout(300);
  ok('[ใหม่] เปิดแก้ใบเก่าได้ (ฟอร์มใหม่ + ช่องเงินจัดรูปแบบ)', await np.evaluate(() => editing && editing.id === 'CMP-USD' && !!document.querySelector('#hdrGrid') && /,/.test(document.querySelector('#tu_0').value)));
  /* ---- บั๊ก %GP ของ production (พบใน Phase 6): ใบรุ่น %GP ไม่มีธง _pm → โหลดใหม่แล้วถูกแปลงเป็น markup ราคาลดเงียบ ๆ ---- */
  const gp = await np.evaluate(() => {
    const L = () => [{ code: 'X', desc: 'x', group: 'INVERTER', comGroup: 'Inverter', uom: 'pcs', qty: 1, up: 100000, costCur: 'THB', dutyPct: 0, clearancePct: 0, opPct: 18, freep: 0 }];
    const fresh = blankQuote(); fresh.lines = L();
    const noFlag = JSON.parse(JSON.stringify(fresh)); delete noFlag._pm;                 // แบบที่ production v2.1 บันทึกลงชีท
    const legacy = { id: 'LEG', header: { currency: 'THB', exrate: 36, incoterm: 'CIF at MGS' }, lines: [{ code: 'Y', qty: 1, up: 100000, costCur: 'THB', dutyPct: 0, clearancePct: 0, opPct: 18, freep: 0, extras: [] }], _v: 2 };   // ใบ markup รุ่นเก่าจริง (ไม่มี _sv)
    const t0 = quoteTotals(fresh).total, reloaded = migrateQuote(JSON.parse(JSON.stringify(fresh))), again = migrateQuote(noFlag), leg = migrateQuote(legacy);
    return { t0, freshPm: fresh._pm, reloaded: quoteTotals(reloaded).total, noFlagGp: again.lines[0].opPct, noFlag: quoteTotals(again).total, legGp: leg.lines[0].opPct, leg: quoteTotals(leg).total };
  });
  console.log('   %GP 18% · ใหม่ ' + gp.t0 + ' · โหลดซ้ำ ' + gp.reloaded + ' · ใบจาก production ไม่มีธง ' + gp.noFlag + ' (GP ' + gp.noFlagGp + ') · ใบ markup เก่า → GP ' + gp.legGp + ' ยอด ' + gp.leg);
  ok('[บั๊ก %GP] ใบใหม่ติดธง _pm:2 ตั้งแต่สร้าง และโหลดซ้ำแล้วราคาเท่าเดิม', gp.freshPm === 2 && gp.reloaded === gp.t0, gp);
  ok('[บั๊ก %GP] ใบจาก production ที่ไม่มีธง (_sv:3) ไม่ถูกแปลง — GP 18% คงเดิม ยอด 121,951.22', gp.noFlagGp === 18 && Math.abs(gp.noFlag - 121951.22) < 0.01, gp);
  ok('[บั๊ก %GP] ใบ markup รุ่นเก่าจริง (ไม่มี _sv) ยังแปลงเป็น %GP โดยยอดรวมเท่าเดิม (118,000)', Math.abs(gp.legGp - 15.254) < 0.001 && Math.abs(gp.leg - 118000) < 1, gp);
  const after = await np.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) o[localStorage.key(i)] = 1; return o; });
  const lost = Object.keys(prodLS).filter(k => !(k in after) && !['mgs_draft'].includes(k));
  ok('[ใหม่] ไม่มี key ของ production หายจาก localStorage', lost.length === 0, lost);
  const added = Object.keys(after).filter(k => !(k in prodLS));
  console.log('   key ที่เวอร์ชันใหม่เพิ่ม: ' + (added.join(', ') || '(ไม่มี)'));
  ok('[ใหม่] key ที่เพิ่มเป็นของที่ production ก็ใช้อยู่แล้ว (ไม่มี key ใหม่)', added.every(k => /^mgs_(token|caps|session|lastUser|syncQueue|summaryView|draft)$/.test(k)), added);
  ok('[ใหม่] ไม่มี JavaScript error ตลอดการทดสอบ', errs.length === 0, errs);
  await nc.close();

  /* ================= 4) ออฟไลน์: บัญชีที่เคยใช้บนเครื่องนี้ ================= */
  const oc = await b.newContext({ viewport: { width: 1280, height: 860 } });
  await oc.addInitScript(ls => { if (!sessionStorage.getItem('__seeded')) { Object.keys(ls).forEach(k => localStorage.setItem(k, ls[k])); sessionStorage.setItem('__seeded', '1'); } }, prodLS);
  const op = await oc.newPage(); const errs2 = []; op.on('pageerror', e => errs2.push(e.message));
  await route(op, neo, { offline: true });
  await op.goto('http://localhost:' + s2.address().port + '/'); await op.waitForTimeout(800);
  const resumed = !(await op.isVisible('#loginUser'));            // มี session เดิมของ production → เข้าต่อได้เลยโดยไม่ต้องกรอก
  if (!resumed) { await op.fill('#loginUser', 'sourcing1'); await op.fill('#loginPass', '1234'); await op.click('button:has-text("เข้าสู่ระบบ →")'); await op.waitForTimeout(3000); }
  console.log('   ออฟไลน์: ' + (resumed ? 'เข้าต่อจาก session เดิมของ production' : 'ล็อกอินด้วยบัญชีที่เคยใช้บนเครื่องนี้'));
  ok('[ออฟไลน์] เน็ตหลุด: ผู้ใช้ production บนเครื่องนี้ยังใช้งานได้และเห็นใบเดิม (ยอดเท่าเดิม)', await op.evaluate(w => !!CURRENT && QUOTES.some(q => q.id === 'CMP-THB' && Math.abs(quoteTotals(q).total - w) < 0.005), want['CMP-THB'].total), await op.evaluate(() => [!!CURRENT, $('#loginErr') && $('#loginErr').textContent]));
  ok('[ออฟไลน์] ไม่มี JavaScript error', errs2.length === 0, errs2);
  await b.close(); s2.close();
  console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PRODUCTION-COMPAT TESTS PASSED'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
