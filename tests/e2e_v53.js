// v5.3 — ใบเสนอราคา "ดีลค่าคอมจาก Supplier": ไม่มี %GP · ขายราคาทุน · รายได้ = ค่าคอม Supplier · Commission Sales เกรด D
// รัน: NODE_PATH=$(npm root -g) node tests/e2e_v53.js $PWD [out-dir]   (ทดสอบบนเครื่องเท่านั้น ห้าม deploy)
// ข้อกำหนด FX: พิมพ์ตาราง before/after — ใบดีลปกติต้องได้ผลเท่ากับ v5.2 ทุกตัวเลข (รวม USD/CNY/Extras)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), crypto = require('crypto'), cp = require('child_process');
const { makeRuntime } = require('./gasmock');
const [, , DIR, OUT] = process.argv;
const { ctx, sheets } = makeRuntime(DIR + '/Code.gs');
const H = s => crypto.createHash('sha256').update(s + 'mgs-internal-2025').digest('hex');
const U = sheets['Users'], uh = U.rows[0];
[['src', 'Chatraporn', 'Sourcing'], ['pm', 'Procure', 'Procurement Mgr'], ['bd', 'BD', 'BD Mgr'], ['boss', 'BOSS', 'Sales']]
  .forEach(([id, n, r]) => { const x = []; x[uh.indexOf('Id')] = id; x[uh.indexOf('Name')] = n; x[uh.indexOf('Role')] = r; x[uh.indexOf('Scope')] = 'all'; x[uh.indexOf('PassHash')] = H('pw123456'); x[uh.indexOf('Email')] = id + '@m.co'; U.rows.push(x); });
const post = p => JSON.parse(ctx.apiPost(JSON.stringify(p)));
const get = (t, tok, a) => JSON.parse(ctx.apiGet(t, tok, a || ''));
const tok = u => post({ action: 'login', user: u, passHash: H('pw123456') }).token;
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 400) : '')); if (!c) fails++; };

// v5.2 (ก่อนแก้) สำหรับเทียบ before/after — อ่านจาก git ไม่ต้องเก็บสำเนาไว้ใน repo
let BEFORE = '';
try { BEFORE = cp.execSync('git show 5038a47:Index.html', { cwd: DIR, maxBuffer: 64 << 20 }).toString(); } catch (e) { BEFORE = ''; }
const files = { '/': fs.readFileSync(DIR + '/Index.html', 'utf8'), '/sales': fs.readFileSync(DIR + '/Sales.html', 'utf8'), '/before': BEFORE };
const srv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(files[q.url.split('?')[0].split('#')[0]] || files['/']); }).listen(0);
const BASE = 'http://localhost:' + srv.address().port;

// ชุดใบดีลปกติ (ตัวแทนข้อมูลจริง): THB/USD/CNY · ทุนต่างสกุล · Duty/Clearance · Extras · %GP ติดลบ
const NORMAL_CASES = () => {
  const L = (o) => _stLine(o);
  const mk = (title, hdr, lines, extras) => { const q = _stQuote({ created: '2026-01-01', updated: '2026-01-01', updatedAt: '2026-01-01T00:00:00Z' }); q.header.offerDate = q.header.reqDate = '2026-01-01'; q.docNo = title; Object.assign(q.header, hdr); q.lines = lines; q.globalExtras = extras || []; return q; };
  return [
    ['THB ทุน THB', mk('N1', {}, [L({ up: 1000, qty: 2, opPct: 20, dutyPct: 10 })])],
    ['THB ทุน USD + Extras', mk('N2', {}, [L({ up: 300, costCur: 'USD', qty: 3, opPct: 15, clearancePct: 2 }), L({ up: 80, qty: 10, opPct: 25, group: 'DC CABLE', comGroup: 'DC Cable' })], [{ label: 'ขนส่ง', amount: 5000, cur: 'THB' }])],
    ['THB ทุน CNY', mk('N3', {}, [L({ up: 2000, costCur: 'CNY', qty: 5, opPct: 12 })])],
    ['USD ใบ USD 35.2', mk('N4', { currency: 'USD', rates: { USD: 35.2, CNY: 5 }, exrate: 35.2 }, [L({ up: 1000, costCur: 'USD', qty: 1, opPct: 18 })], [{ label: 'x', amount: 100, cur: 'USD' }])],
    ['CNY ใบ CNY', mk('N5', { currency: 'CNY' }, [L({ up: 700, costCur: 'CNY', qty: 4, opPct: 9 })])],
    ['%GP ติดลบ', mk('N6', { incoterm: 'DDP at MGS' }, [L({ up: 500, qty: 1, opPct: -5, dutyPct: 10 })])],
  ];
};
const snap = () => NORMAL_CASES().map(([n, q]) => { stampComGrades(q); const t = computeQuote(q);
  return { n, cur: q.header.currency, total: t.total, cost: t.cost, profit: t.profit, gp: t.gp, gpProd: t.gpProd,
    grades: Object.entries(t.com).map(([c, v]) => c + ':' + v.grade + '/' + v.rate + '/' + Math.round(v.comAmt * 100) / 100).join(' '),
    lines: t.lines.map(o => [o.totalUP, o.lineTotal, Math.round(o.lineProfit * 1e6) / 1e6].join('|')).join(' '),
    thb: toTHB(q, t.total), agg: aggregateQuotes([q]).profit, proj: JSON.stringify(buildSalesProjection(q)) }; });

(async () => {
  const b = await chromium.launch();
  const page = async (path, vp) => { const p = await (await b.newContext({ viewport: vp || { width: 1366, height: 900 } })).newPage();
    p.on('pageerror', e => { console.log('PAGEERROR', e.message); fails++; });
    await p.route('https://script.google.com/**', async rt => { const r = rt.request(); let body;
      if (r.method() === 'POST') body = ctx.apiPost(r.postData()); else { const u = new URL(r.url()); const g = k => u.searchParams.get(k) || ''; body = ctx.apiGet(g('type'), g('token'), g('id') || g('since')); }
      await rt.fulfill({ status: 200, contentType: 'application/json', body }); });
    await p.goto(BASE + path); await p.waitForTimeout(400); return p; };

  console.log('== 1) FX / ใบดีลปกติ: before (v5.2) vs after (v5.3) ต้องเท่ากันทุกตัวเลข ==');
  const now = await page('/');
  const after = await now.evaluate('(' + snap.toString().replace('NORMAL_CASES()', '(' + NORMAL_CASES.toString() + ')()') + ')()');
  if (BEFORE) {
    const old = await page('/before');
    const before = await old.evaluate('(' + snap.toString().replace('NORMAL_CASES()', '(' + NORMAL_CASES.toString() + ')()') + ')()');
    console.log('กรณี'.padEnd(22), 'สกุล', '| ยอด ก่อน → หลัง'.padEnd(30), '| กำไร ก่อน → หลัง'.padEnd(28), '| %GP ก่อน → หลัง', '| บาท ก่อน → หลัง');
    after.forEach((a, i) => { const x = before[i];
      console.log(a.n.padEnd(22), a.cur.padEnd(4), '|', (x.total.toFixed(2) + ' → ' + a.total.toFixed(2)).padEnd(28), '|', (x.profit.toFixed(2) + ' → ' + a.profit.toFixed(2)).padEnd(26), '|', x.gp.toFixed(3) + ' → ' + a.gp.toFixed(3), '|', x.thb.toFixed(2) + ' → ' + a.thb.toFixed(2));
      const same = ['total', 'cost', 'profit', 'gp', 'gpProd', 'grades', 'lines', 'thb', 'agg', 'proj'].filter(k => JSON.stringify(x[k]) !== JSON.stringify(a[k]));
      ok('ดีลปกติ "' + a.n + '" — ยอด/ต้นทุน/กำไร/%GP/เกรด/ยอดบาท/ฉบับ Sales เท่ากับ v5.2', same.length === 0, { diff: same, before: same.map(k => x[k]), after: same.map(k => a[k]) });
    });
  } else console.log('(ข้ามการเทียบ v5.2 — ไม่มี git history)');

  console.log('== 2) เครื่องคิดเลขดีลค่าคอม ==');
  const r = await now.evaluate(() => {
    const q = _stQuote({ docNo: 'COM1' }); q.header.sales = 'BOSS';
    q.lines = [_stLine({ code: 'A', up: 1000, qty: 2, opPct: 20, dutyPct: 10 }), _stLine({ code: 'B', group: 'DC CABLE', comGroup: 'DC Cable', up: 50, qty: 10, opPct: 30 })];
    const normal = computeQuote(q);
    q.header.dealType = 'commission'; q.header.supplierCom = { pct: 5, amount: 0, cur: 'THB', basis: 'supplier', supplier: 'Sungrow', note: '' };
    const t = computeQuote(q); const v = validateQuote(q);
    stampComGrades(q); const proj = buildSalesProjection(q);
    const sale = JSON.parse(JSON.stringify(q)); sale.header.supplierCom.basis = 'sale'; const ts = computeQuote(sale);
    const fixed = JSON.parse(JSON.stringify(q)); fixed.header.supplierCom = { pct: 0, amount: 100, cur: 'USD', basis: 'supplier' }; const tf = computeQuote(fixed);
    const none = JSON.parse(JSON.stringify(q)); none.header.supplierCom = { pct: 0, amount: 0 }; const vn = validateQuote(none);
    const noRate = JSON.parse(JSON.stringify(q)); noRate.header.supplierCom = { pct: 0, amount: 100, cur: 'EUR' }; const vr = validateQuote(noRate);
    const back = JSON.parse(JSON.stringify(q)); back.header.dealType = 'normal'; const tb = computeQuote(back);
    const usd = _stQuote({ docNo: 'COMUSD' }); usd.header.currency = 'USD'; usd.header.rates = { USD: 35, CNY: 5 }; usd.header.exrate = 35;
    usd.header.dealType = 'commission'; usd.header.supplierCom = { pct: 3, amount: 0, cur: 'USD', basis: 'sale' };
    usd.lines = [_stLine({ up: 1000, costCur: 'USD', qty: 1, opPct: 25 })]; const tu = computeQuote(usd);
    const agg = aggregateQuotes([q, usd]);
    return { normal: { total: normal.total, profit: normal.profit }, t: { total: t.total, cost: t.cost, profit: t.profit, gp: t.gp, isCommission: t.isCommission, supplierCom: t.supplierCom, supplierComPct: t.supplierComPct, base: t.supplierComBase,
      lines: t.lines.map(o => ({ up: o.totalUP, cost: o.baseCost, gpPct: o.gpPct })), com: t.com },
      v, lineGrades: q.lines.map(L => L.comGrade), comGrades: q.comGrades, opPctKept: q.lines.map(L => L.opPct),
      proj, projStr: JSON.stringify(proj), sale: ts.supplierCom, fixed: tf.supplierCom, vn, vr, back: { total: tb.total, isCommission: !!tb.isCommission },
      usd: { total: tu.total, com: tu.supplierCom, thb: toTHB(usd, tu.profit) }, agg: { profit: agg.profit, want: t.profit + toTHB(usd, tu.profit) } };
  });
  console.log('ใบตัวอย่าง: A ทุน 1,000 ×2 Duty 10% · B ทุน 50 ×10 · ค่าคอม Supplier 5% ของมูลค่าซื้อ');
  console.log('  ดีลปกติ  ยอด', r.normal.total, 'กำไร', r.normal.profit.toFixed(2), '|  ดีลค่าคอม ยอด', r.t.total, 'ต้นทุน', r.t.cost, 'ค่าคอม', r.t.supplierCom, '(' + r.t.supplierComPct.toFixed(2) + '% ของฐาน ' + r.t.base + ')');
  ok('ราคาขาย/หน่วย = ต้นทุน Landed ทุกบรรทัด (1,100 และ 50) · %GP บรรทัด = 0', r.t.lines[0].up === 1100 && r.t.lines[1].up === 50 && r.t.lines.every(l => l.gpPct === 0 && l.up === Math.round(l.cost * 100) / 100), r.t.lines);
  ok('ยอดเสนอ = ต้นทุนรวม (2,700) · ไม่บวกกำไร', r.t.total === 2700 && Math.abs(r.t.cost - 2700) < 1e-9, r.t);
  ok('ค่าคอม Supplier 5% × มูลค่าซื้อ 2,500 = 125 = กำไรของใบ', r.t.supplierCom === 125 && r.t.base === 2500 && Math.abs(r.t.profit - 125) < 1e-9 && r.t.isCommission === true, r.t);
  ok('คิดจากมูลค่าขาย: 5% × 2,700 = 135', r.sale === 135, r.sale);
  ok('จำนวนเงินคงที่ USD 100 × เรตในใบ 36 = 3,600 บาท', r.fixed === 3600, r.fixed);
  ok('Commission Sales = เกรด D อัตรา 0 ค่าคอม 0 ทุกหมวด', Object.values(r.t.com).every(c => c.grade === 'D' && c.rate === 0 && c.comAmt === 0) && Object.keys(r.t.com).length === 2, r.t.com);
  ok('ประทับเกรด D ลงทุกบรรทัด + หัวใบ (ตัวอักษรเท่านั้น)', r.lineGrades.every(g => g === 'D') && Object.values(r.comGrades).every(g => g === 'D'), r.comGrades);
  ok('%GP เดิมของแต่ละบรรทัดยังอยู่ (20 / 30) — สลับกลับเป็นดีลปกติได้ ยอดกลับเท่าเดิม', r.opPctKept.join() === '20,30' && r.back.total === r.normal.total && !r.back.isCommission, r);
  ok('ไม่ติดธง "ต่ำกว่าเกณฑ์ %GP" (ดีลค่าคอมไม่มี %GP) · ไม่มี error', !r.v.belowThreshold && r.v.errors.length === 0 && !r.v.warnings.some(w => /เกณฑ์/.test(w)), r.v);
  ok('ยังไม่ใส่ค่าคอม → เตือน (บันทึกต่อได้)', r.vn.errors.length === 0 && r.vn.warnings.some(w => /ยังไม่ได้ใส่/.test(w)), r.vn);
  ok('จำนวนเงินคงที่สกุลที่ไม่มีเรต → บล็อกการบันทึก (ห้ามคิดด้วยเรต 0)', r.vr.errors.some(e => /เรต/.test(e)), r.vr);
  ok('ฉบับ Sales: มีป้าย comDeal + เกรด D · ไม่มีตัวเลขค่าคอม Supplier / ต้นทุน', r.proj.comDeal === true && r.proj.salesComGrade === 'D' && r.proj.lines.every(l => l.comGrade === 'D') && !/supplierCom|"cost"|"profit"|"up"|opPct|"pct"|Sungrow/.test(r.projStr), r.projStr.slice(0, 300));
  ok('ใบ USD: ขาย 1,000 USD (ราคาทุน) · ค่าคอม 3% = 30 USD = 1,050 บาท', r.usd.total === 1000 && r.usd.com === 30 && r.usd.thb === 1050, r.usd);
  ok('สรุปรวม (aggregateQuotes) กำไร = Σ ค่าคอมแต่ละใบเป็นบาท', Math.abs(r.agg.profit - r.agg.want) < 0.01, r.agg);

  console.log('== 3) server: ค่าคอม Supplier ไม่หลุดไปหา Sales ==');
  const T = { src: tok('src'), pm: tok('pm'), bd: tok('bd'), boss: tok('boss') };
  ok('stripCost_ ตัด header.supplierCom', !('supplierCom' in ctx.stripCost_({ header: { supplierCom: { pct: 5 }, dealType: 'commission' } }).header));
  const det = { id: 'CQ1', _v: 2, docType: 'QT', docNo: 'QT-COM1', status: 'Pending', round: 1, approvals: [], releasedTo: ['boss'],
    header: { ref: 'QT-COM1', title: 'ดีลค่าคอม', customer: 'CP', salesUserId: 'boss', sales: 'BOSS', currency: 'THB', groupType: 'Inverter', dealType: 'commission', supplierCom: { pct: 5, amount: 0, cur: 'THB', basis: 'supplier', supplier: 'Sungrow', note: 'จ่ายหลังชำระ' } },
    lines: [{ code: 'A', desc: 'Inv', qty: 2, up: 1000, opPct: 20, costCur: 'THB' }], remarks: [], auditLogs: [], globalExtras: [] };
  const sv = post({ token: T.src, action: 'save', id: 'CQ1', docType: 'QT', docNo: 'QT-COM1', status: 'Pending', salesUserId: 'boss', releasedTo: 'boss', title: 'ดีลค่าคอม', customer: 'CP',
    total: 2000, cost: 2000, profit: 100, gp: 5, detail: JSON.stringify(det), salesDetail: JSON.stringify(Object.assign({}, r.proj, { id: 'CQ1', header: { title: 'ดีลค่าคอม', supplierCom: { pct: 5 } } })) });
  ok('บันทึกใบดีลค่าคอมได้ (ไม่ต้องมีคอลัมน์ใหม่)', sv.ok !== false, sv);
  const QS = sheets['Quotations'], qh = QS.rows[0];
  ok('Header ของแท็บ Quotations ไม่เปลี่ยน (ไม่มีคอลัมน์ใหม่)', !qh.some(h => /deal|supplier/i.test(h)), qh);
  QS.rows.find(x => x[0] === 'CQ1')[qh.indexOf('ReleasedTo')] = 'boss';
  const sd = String(QS.rows.find(x => x[0] === 'CQ1')[qh.indexOf('SalesDetail')]);
  ok('SalesDetail บนชีท: ตัด supplierCom ที่ client ส่งมาเกิน (server projection) แต่คงป้าย comDeal', !/supplierCom|Sungrow/.test(sd) && /"comDeal":true/.test(sd), sd.slice(0, 300));
  const bossRow = get('salesview', T.boss).quotations.find(x => x.id === 'CQ1') || {};
  const bossStr = JSON.stringify(bossRow);
  ok('Sales (salesview): เห็นราคา + ป้ายเกรด D · ไม่เห็นค่าคอม Supplier / กำไร / %GP', /unitPrice/.test(bossStr) && /salesComGrade/.test(bossStr) && !/supplierCom|Sungrow|จ่ายหลังชำระ|"profit"|"gp"/i.test(bossStr), bossStr.slice(0, 400));
  const qsBoss = get('quotations', T.boss); const bossQ = JSON.stringify(qsBoss);
  ok('Sales (quotations): ไม่มี supplierCom แม้ขอ endpoint ฝ่ายใน', !/supplierCom|Sungrow|จ่ายหลังชำระ/.test(bossQ), bossQ.slice(0, 300));
  const pmQ = JSON.stringify(get('quotations', T.pm));
  ok('ผู้จัดการ (ฝ่ายใน) ยังเห็นค่าคอม Supplier ครบ', /supplierCom/.test(pmQ) && /Sungrow/.test(pmQ));

  console.log('== 4) หน้าจอทำราคา ==');
  const s = await page('/');
  await s.fill('#loginUser', 'src'); await s.fill('#loginPass', 'pw123456'); await s.click('button:has-text("เข้าสู่ระบบ →")'); await s.waitForTimeout(1800);
  await s.evaluate(() => go('new')); await s.waitForTimeout(300);
  await s.evaluate(() => { editing.header.customer = 'CP'; editing.header.salesUserId = 'boss'; editing.header.sales = 'BOSS'; editing.lines.push(_stLine({ code: 'SG110CX', desc: 'Inverter', up: 1000, qty: 2, opPct: 20, dutyPct: 10 })); refreshLines(); });
  ok('มีช่อง "ประเภทดีล" ค่าเริ่มต้น = ปกติ', await s.evaluate(() => document.getElementById('dealSel') && document.getElementById('dealSel').value) === 'normal');
  await s.selectOption('#dealSel', 'commission'); await s.waitForTimeout(300);
  ok('เลือกดีลค่าคอม → มีกล่องค่าคอม Supplier + ป้าย "Sales เกรด D · ไม่มีค่าคอม"', await s.locator('#scomBox').count() === 1 && /Sales เกรด D · ไม่มีค่าคอม/.test(await s.textContent('#scomBox')));
  ok('ช่อง %GP และราคาขาย/หน่วยถูกล็อก · ราคาขาย = 1,100.00 (ทุน + Duty)', await s.evaluate(() => document.getElementById('op_0').disabled && document.getElementById('tu_0').disabled) && await s.inputValue('#tu_0') === '1,100.00', await s.inputValue('#tu_0'));
  ok('ใต้ราคาขายบอก "= ราคาทุน"', /ราคาทุน/.test(await s.textContent('#tum_0')));
  await s.fill('#scomBox input[type=number]', '5'); await s.waitForTimeout(150);
  await s.keyboard.press('Tab'); await s.waitForTimeout(150);
  const lb = await s.textContent('#liveBar'), sb = await s.textContent('#sumBox'), calc = await s.textContent('#scomCalc');
  ok('แถบสรุป: ค่าคอมจาก Supplier 100.00 · 5.0% · Sales เกรด D', /ค่าคอมจาก Supplier/.test(lb) && /100\.00/.test(lb) && /เกรด D/.test(lb) && !/%GP รวม/.test(lb), lb);
  ok("สรุปราคา: ต้นทุน = ราคาขาย · ค่าคอม 100 · Commission Sales เกรด D", /ต้นทุนรวม \(Landed\) = ราคาขาย/.test(sb) && /100\.00/.test(sb) && /เกรด D · ไม่มีค่าคอม/.test(sb), sb);
  ok('คำอธิบายสูตรใต้กล่อง: 5% × 2,000 · ราคาขายลูกค้า = ต้นทุน', /รายได้ MGS จากค่าคอม/.test(calc) && /2,000/.test(calc), calc);
  ok('ประวัติ: บันทึกการเปลี่ยนประเภทดีล + % ค่าคอม (ครั้งเดียว ไม่ใช่ทุกตัวอักษร)', await s.evaluate(() => { const a = editing.auditLogs.map(x => x.action);
    return a.some(x => /ประเภทดีล from .*ปกติ.* to ค่าคอมจาก Supplier/.test(x)) && a.filter(x => /ค่าคอม Supplier · %/.test(x)).length === 1; }), await s.evaluate(() => editing.auditLogs.map(x => x.action)));
  if (OUT) await s.screenshot({ path: OUT + '/v53_commission_costing.png', fullPage: true });
  await s.evaluate(() => saveQuote('Submitted')); await s.waitForTimeout(400);
  const modalTxt = await s.evaluate(() => (document.getElementById('modalRoot') || {}).textContent || '');
  ok('ส่งขออนุมัติ: ไม่มีคำเตือน %GP ต่ำกว่าเกณฑ์', !/ต่ำกว่าเกณฑ์/.test(modalTxt), modalTxt.slice(0, 300));
  await s.waitForTimeout(1500);
  const saved = QS.rows.find(x => String(x[qh.indexOf('Detail')]).indexOf('"dealType":"commission"') >= 0 && x[0] !== 'CQ1');
  ok('บันทึกขึ้นชีท: คอลัมน์ Profit = ค่าคอม 100 · Total = 2,200 · ไม่ติดธง NeedsApproval', !!saved && +saved[qh.indexOf('Profit')] === 100 && +saved[qh.indexOf('Total')] === 2200 && !+saved[qh.indexOf('NeedsApproval')], saved && [saved[qh.indexOf('Profit')], saved[qh.indexOf('Total')], saved[qh.indexOf('NeedsApproval')]]);
  ok('ฉบับ Sales ของใบที่บันทึก: ไม่มี supplierCom · มีเกรด D', !!saved && !/supplierCom/.test(String(saved[qh.indexOf('SalesDetail')])) && /"comGrade":"D"/.test(String(saved[qh.indexOf('SalesDetail')])));
  await s.evaluate(() => go('quotes')); await s.waitForTimeout(300);
  ok('หน้ารายการใบเสนอราคา: ใบดีลค่าคอมแสดง "คอม 5.0%" แทน %GP', /คอม 5(\.0)?%/.test(await s.textContent('#content')));
  // มือถือ: กล่องค่าคอมไม่ล้นจอ
  const m = await page('/', { width: 390, height: 800 });
  await m.fill('#loginUser', 'src'); await m.fill('#loginPass', 'pw123456'); await m.click('button:has-text("เข้าสู่ระบบ →")'); await m.waitForTimeout(1800);
  await m.evaluate(() => { go('new'); editing.lines.push(_stLine({ up: 1000, qty: 2 })); hsetDeal('commission'); }); await m.waitForTimeout(300);
  const ov = await m.evaluate(() => { const bx = document.getElementById('scomBox').getBoundingClientRect(); return { right: bx.right, w: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth }; });
  ok('มือถือ 390px: กล่องค่าคอมอยู่ในจอ ไม่มีเลื่อนซ้ายขวา', ov.right <= ov.w + 1 && ov.sw <= ov.w + 1, ov);
  if (OUT) await m.screenshot({ path: OUT + '/v53_commission_mobile.png', fullPage: true });

  console.log('== 5) แอป Sales ==');
  const sp = await page('/sales?app=sales');
  await sp.fill('#loginUser', 'boss@m.co'); await sp.fill('#loginPass', 'pw123456'); await sp.click('#loginBtn'); await sp.waitForTimeout(2000);
  await sp.evaluate(() => openDetail('CQ1')); await sp.waitForTimeout(300);
  const st = await sp.evaluate(() => (document.getElementById('modalRoot') || document.body).innerText + ' ##keys ' + Object.keys(S.rows || {}).join(','));
  ok('รายละเอียดใบ: ป้าย "ดีลค่าคอมจาก Supplier · Commission Sales เกรด D = ไม่มีค่าคอม" · ไม่มีตัวเลขค่าคอม Supplier', /ดีลค่าคอมจาก Supplier/.test(st) && /เกรด D/.test(st) && !/Sungrow|จ่ายหลังชำระ/.test(st), st.slice(0, 300));

  console.log(fails ? fails + ' FAILED' : 'ALL v5.3 TESTS PASSED');
  await b.close(); srv.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL crash', e && e.stack); process.exit(1); });
