// v5.13 — สูตรราคา: ก่อน / หลัง (FX) + ดีลค่าคอมลูกค้า + ค่าใช้จ่ายปันเข้าราคา + สรรพสามิต/มหาดไทย
// รัน: NODE_PATH=$(npm root -g) node tests/test_v513_pricing.js $PWD [ไฟล์ Index.html รุ่นก่อน]   (ทดสอบบนเครื่องเท่านั้น ห้าม deploy)
//   ไม่ระบุไฟล์รุ่นก่อน = ดึง Index.html ของ commit ก่อน v5.13 จาก git (685e831 = v5.12)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os'), { execSync } = require('child_process');
const DIR = process.argv[2] || '.';
let OLD = process.argv[3];
if (!OLD) { OLD = path.join(os.tmpdir(), 'Index.v512.html'); fs.writeFileSync(OLD, execSync('git show 685e831:Index.html', { cwd: DIR, maxBuffer: 64 << 20 })); }
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 500) : '')); if (!c) fails++; };

// ใบตัวอย่าง (ไม่มีฟิลด์ใหม่ของ v5.13) — ต้องได้ผลเหมือนรุ่นก่อนทุกตัวเลข
const FIXTURES = () => {
  const L = (o) => Object.assign({ code: 'X', desc: 'x', group: 'INVERTER', qty: 2, uom: 'pcs', up: 1000, costCur: 'USD', dutyPct: 5, clearancePct: 2, opPct: 20, freep: 0, extras: [] }, o);
  const Q = (H, lines, extra) => Object.assign({ id: 'F', _v: 2, _pm: 2, _sv: 3, docType: 'QT', status: 'In Progress', approvalRoles: [], approvals: [], releasedTo: [], remarks: [], auditLogs: [], globalExtras: [],
    header: Object.assign({ currency: 'THB', incoterm: 'CIF at MGS', rates: { USD: 36, CNY: 5 }, exrate: 36, groupType: 'Inverter' }, H), lines }, extra || {});
  return [
    ['THB · USD cost · CIF', Q({}, [L({}), L({ code: 'Y', up: 333.33, qty: 7, opPct: 17.5, freep: 120, group: 'BATTERY' })])],
    ['USD offer · rate 35.2', Q({ currency: 'USD', rates: { USD: 35.2, CNY: 5 }, exrate: 35.2 }, [L({ up: 1234.56, qty: 3 })])],
    ['CNY cost · rate 5', Q({}, [L({ costCur: 'CNY', up: 2000, qty: 11, opPct: 22.2 })])],
    ['DDP (duty ล็อก 0)', Q({ incoterm: 'DDP at MGS' }, [L({ dutyPct: 10 })])],
    ['ใบเก่าไม่มี rates', (() => { const q = Q({ currency: 'USD', exrate: 36.5 }, [L({ up: 999 })]); delete q.header.rates; return q; })()],
    ['ค่าใช้จ่ายรวม 2 ก้อน (THB+USD)', Q({}, [L({}), L({ code: 'Z', up: 50, qty: 100, group: 'MOUNTING', opPct: 12 })], { globalExtras: [{ label: 'ค่าขนส่ง', amount: 15000, cur: 'THB' }, { label: 'Storage', amount: 120, cur: 'USD' }] })],
    ['ดีลค่าคอม Supplier', Q({ dealType: 'commission', supplierCom: { pct: 5, amount: 1000, cur: 'THB', basis: 'supplier' } }, [L({}), L({ code: 'W', up: 10, qty: 500 })])],
    ['%GP ติดลบ + qty ทศนิยม', Q({}, [L({ opPct: -5, qty: 2.5, up: 77.77 })])],
    ['20 บรรทัด', Q({}, Array.from({ length: 20 }, (_, i) => L({ code: 'R' + i, up: 10 + i * 13.37, qty: 1 + (i % 7), opPct: 8 + (i % 9), costCur: ['USD', 'CNY', 'THB'][i % 3], freep: i % 4 ? 0 : 25.5 })),
      { globalExtras: [{ label: 'ค่าขนส่ง', amount: 8888, cur: 'THB' }] })],
  ];
};
const pick = t => ({ total: t.total, cost: t.cost, profit: t.profit, gp: t.gp, gpProd: t.gpProd, prodTotal: t.prodTotal, globalExtras: t.globalExtras,
  com: t.com, supplierCom: t.supplierCom, lines: t.lines.map(o => [o.totalUP, o.lineTotal, o.lineCost, o.lineProfit, o.baseCost, o.alloc, o.landedCost, o.gp]) });

(async () => {
  const b = await chromium.launch();
  const run = async (file, fn, arg) => { const p = await b.newPage(); await p.goto('file://' + path.resolve(file)); await p.waitForTimeout(500);
    const r = await p.evaluate(fn, arg); await p.close(); return r; };
  const fx = FIXTURES.toString();
  const evalAll = new Function('fx', 'pick', `return (() => { const FIXTURES = (${fx}); const pick = (${pick.toString()}); return FIXTURES().map(([n, q]) => [n, pick(computeQuote(q)), q.header.currency]); })`)();
  const code = `(() => { const FIXTURES = (${fx}); const pick = (${pick.toString()}); return FIXTURES().map(([n, q]) => [n, pick(computeQuote(q)), q.header.currency, toTHB(q, computeQuote(q).total)]); })()`;
  const before = await run(OLD, c => eval(c), code), after = await run(DIR + '/Index.html', c => eval(c), code);

  console.log('== 1) ก่อน / หลัง (ใบที่ไม่มีฟิลด์ใหม่ — ต้องเท่ากันทุกตัวเลข) ==');
  console.log('กรณี'.padEnd(34), 'สกุล', 'รวม (ก่อน)'.padStart(16), 'รวม (หลัง)'.padStart(16), 'บาท (ก่อน)'.padStart(16), 'บาท (หลัง)'.padStart(16), ' ผล');
  before.forEach((r, i) => {
    const a = after[i], same = JSON.stringify(r[1]) === JSON.stringify(a[1]) && r[3] === a[3];
    console.log(r[0].padEnd(34), r[2].padEnd(4), r[1].total.toFixed(2).padStart(16), a[1].total.toFixed(2).padStart(16), r[3].toFixed(2).padStart(16), a[3].toFixed(2).padStart(16), same ? ' เท่ากัน' : ' ✗ ต่าง');
    ok('ก่อน = หลัง ทุกตัวเลข (ราย บรรทัด / ต้นทุน / กำไร / %GP / ค่าคอม Sales / แปลงเป็นบาท): ' + r[0], same, { before: r[1], after: a[1] });
  });

  console.log('\n== 2) ฟีเจอร์ใหม่ (คำนวณมือเทียบ) ==');
  const nw = await run(DIR + '/Index.html', () => {
    const L = o => Object.assign({ code: 'X', desc: 'x', group: 'INVERTER', qty: 1, uom: 'pcs', up: 0, costCur: 'THB', dutyPct: 0, clearancePct: 0, opPct: 20, freep: 0, extras: [] }, o);
    const Q = (H, lines, ex) => Object.assign({ id: 'N', docType: 'QT', lines, globalExtras: [], header: Object.assign({ currency: 'THB', incoterm: 'CIF at MGS', rates: { USD: 36, CNY: 5 }, exrate: 36 }, H) }, ex || {});
    const out = {};
    // สรรพสามิต: ตัวอย่างของ Aon ฐาน 10,000 → 800 + 80 = 880
    out.ex1 = computeLine(L({ up: 10000, excise: true }), Q({}, []).header);
    // USD 100 × 36 = 3,600 · อากร 5% = 180 · ค่าขนส่ง 20 → ฐาน 3,800 · สรรพสามิต 304 · มหาดไทย 30.4 · Clearance 2% (ไม่อยู่ในฐาน) = 72
    out.ex2 = computeLine(L({ up: 100, costCur: 'USD', dutyPct: 5, clearancePct: 2, freep: 20, excise: true }), Q({}, []).header);
    out.exOff = computeLine(L({ up: 10000 }), Q({}, []).header);
    out.exRates = computeLine(L({ up: 10000, excise: true }), Q({ exciseRates: { rate: 10, interior: 10 } }, []).header);
    // ค่าคอมลูกค้า 5% · ต้นทุน 1,000 · GP 20% → ราคา 1,000 / 0.75 = 1,333.33
    const qc = Q({ dealType: 'custcom', customerCom: { pct: 5 } }, [L({ code: 'A', up: 1000, qty: 3 }), L({ code: 'B', up: 1000, qty: 1, custCom: false })]);
    out.cc = computeQuote(qc);
    // ปันค่าใช้จ่ายเข้าราคา 400 บาท เฉพาะ A และ B (C ไม่ปัน) · ยอด A 1,250 · B 3,750 (GP 20%) → ปัน 100 / 300
    const qe = Q({}, [L({ code: 'A', up: 100, qty: 10, lid: 'a' }), L({ code: 'B', up: 300, qty: 10, lid: 'b' }), L({ code: 'C', up: 100, qty: 10, lid: 'c' })],
      { globalExtras: [{ label: 'Storage', amount: 400, cur: 'THB', mode: 'embed', lines: ['a', 'b'] }, { label: 'ค่าขนส่ง', amount: 500, cur: 'THB', lines: ['c'] }] });
    out.em = computeQuote(qe);
    out.emSales = buildSalesProjection(Object.assign({}, qe, { header: Object.assign({}, qe.header, { title: 't' }) }));
    return JSON.parse(JSON.stringify(out, (k, v) => k === 'L' ? undefined : v));
  });
  const r2 = n => Math.round(n * 100) / 100;
  console.log('สรรพสามิต (ฐาน 10,000):', 'ภาษี', r2(nw.ex1.excise), '+ มหาดไทย', r2(nw.ex1.interiorTax), '= ต้นทุน/หน่วย', r2(nw.ex1.baseCost), '· ราคาขาย (GP 20%)', nw.ex1.totalUP);
  ok('ฐาน 10,000 → สรรพสามิต 800 + มหาดไทย 80 = 880 · ต้นทุน 10,880 · ราคา 13,600', r2(nw.ex1.excise) === 800 && r2(nw.ex1.interiorTax) === 80 && r2(nw.ex1.baseCost) === 10880 && nw.ex1.totalUP === 13600, nw.ex1);
  console.log('สรรพสามิต (USD 100 · อากร 5% · ขนส่ง 20 · Clearance 2%):', 'ฐาน', r2(nw.ex2.exciseBase), 'ภาษี', r2(nw.ex2.excise), 'มหาดไทย', r2(nw.ex2.interiorTax), 'ต้นทุน', r2(nw.ex2.baseCost));
  ok('ฐาน = ราคาซื้อ 3,600 + อากร 180 + ขนส่ง 20 = 3,800 (ไม่รวม Clearance) · 304 + 30.40 · ต้นทุน 4,206.40', r2(nw.ex2.exciseBase) === 3800 && r2(nw.ex2.excise) === 304 && r2(nw.ex2.interiorTax) === 30.4 && r2(nw.ex2.baseCost) === 4206.4, nw.ex2);
  ok('ไม่เปิดสรรพสามิต → ต้นทุน 10,000 (เหมือนเดิม)', nw.exOff.baseCost === 10000 && nw.exOff.excise === undefined);
  ok('อัตราที่ตรึงไว้ในใบ (10% / 10%) ถูกใช้แทนค่ากลาง → 1,000 + 100', r2(nw.exRates.excise) === 1000 && r2(nw.exRates.interiorTax) === 100);
  const A = nw.cc.lines[0], Bl = nw.cc.lines[1];
  console.log('ค่าคอมลูกค้า 5%:', 'ราคา A', A.totalUP, 'ค่าคอม/หน่วย', r2(A.custComU), 'กำไร/หน่วย', r2(A.op), '%GP', r2(A.gp), '· B (ไม่ให้ค่าคอม) ราคา', Bl.totalUP, '· รวมค่าคอม', r2(nw.cc.customerCom));
  ok('A: ราคา 1,333.33 · ค่าคอม 66.67 · %GP ของเรายังเป็น 20%', A.totalUP === 1333.33 && r2(A.custComU) === 66.67 && Math.abs(A.gp - 20) < 0.01, A);
  ok('B (ไม่เลือก): ราคา 1,250 ตามปกติ · ไม่มีค่าคอม', Bl.totalUP === 1250 && !Bl.custComPct);
  ok('ค่าคอมลูกค้ารวม = 66.67 × 3 = 200.00 · กำไรรวม = 20% ของยอดขาย', r2(nw.cc.customerCom) === 200 && Math.abs(nw.cc.profit / nw.cc.prodTotal * 100 - 20) < 0.01, nw.cc);
  const [ea, eb, ec] = nw.em.lines;
  console.log('ปันค่าใช้จ่าย 400 (A,B):', 'A', ea.priceBeforeEmbed, '→', ea.totalUP, '· B', eb.priceBeforeEmbed, '→', eb.totalUP, '· C', ec.totalUP, '· แยกบรรทัด (C)', nw.em.globalExtras, '· รวม', nw.em.total);
  ok('A ราคา 125 → 135 (+10/หน่วย) · B 375 → 405 (+30/หน่วย) · C 125 ไม่ปัน', ea.totalUP === 135 && eb.totalUP === 405 && ec.totalUP === 125, [ea.totalUP, eb.totalUP, ec.totalUP]);
  ok('ปันแบบราคาทุน: กำไรไม่เปลี่ยน (A 250 · B 750 · C 250)', r2(ea.lineProfit) === 250 && r2(eb.lineProfit) === 750 && r2(ec.lineProfit) === 250);
  ok('ค่าขนส่ง 500 "แยกบรรทัด" ปันคิด %GP เฉพาะ C · ยอดรวม = 1,350 + 4,050 + 1,250 + 500 = 7,150', r2(ec.alloc) === 500 && ea.alloc === 0 && r2(nw.em.total) === 7150, nw.em.total);
  ok('ฉบับ Sales: ราคาต่อหน่วยรวมค่าใช้จ่ายที่ปันแล้ว · ค่าใช้จ่ายแยกบรรทัด 500', nw.emSales.lines[0].unitPrice === 135 && nw.emSales.extrasTotal === 500 && !JSON.stringify(nw.emSales).includes('embed'), nw.emSales.lines);
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'ALL v5.13 PRICING TESTS PASSED'); process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL crash', e && e.stack); process.exit(1); });
