// FX before/after — รวมยอดข้ามสกุลเงิน (C1) + ยืนยันเส้นทางต้นทุน CNY→THB = 5 (บั๊กเดิม 7.5)
// รัน: NODE_PATH=$(npm root -g) node tests/fx_test.js        (ทดสอบบนเครื่องเท่านั้น ห้าม deploy)
const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('file://' + path.resolve(__dirname, '../Index.html')); await p.waitForTimeout(600);
  const out = await p.evaluate(() => {
    const mk = (cur, rates, exrate, up, costCur) => { const q = _stQuote(); q.header.currency = cur; q.header.rates = rates; q.header.exrate = exrate;
      q.lines = [_stLine({ up, costCur, qty: 1, opPct: 20, dutyPct: 0, clearancePct: 0 })]; return q; };
    const cases = [
      ['THB ใบปกติ', mk('THB', { USD: 36, CNY: 5 }, 36, 1000, 'THB')],
      ['USD อัตราในใบ 35.2', mk('USD', { USD: 35.2, CNY: 5 }, 35.2, 1000, 'USD')],
      ['CNY อัตราในใบ 5', mk('CNY', { USD: 36, CNY: 5 }, 36, 1000, 'CNY')],
      ['USD ใบเก่าไม่มี rates (ใช้ exrate)', (() => { const q = mk('USD', null, 36.5, 1000, 'USD'); delete q.header.rates; return q; })()],
      ['CNY ใบเก่าไม่มี rates (ใช้ค่าตั้งค่า)', (() => { const q = mk('CNY', null, 36, 1000, 'CNY'); delete q.header.rates; return q; })()],
    ];
    const rows = cases.map(([n, q]) => { const t = computeQuote(q).total; return { n, cur: q.header.currency, total: t, before: t, rate: rateToTHB(q.header), after: toTHB(q, t) }; });
    const agg = aggregateQuotes(cases.map(c => c[1]));
    // เส้นทางต้นทุน: ใบ THB ซื้อของ CNY 100 → ต้องเป็น 500 บาท (ไม่ใช่ 750 / 3,600)
    const q = mk('THB', { USD: 36, CNY: 5 }, 36, 100, 'CNY'); const legacy = mk('THB', null, 36, 100, 'CNY'); delete legacy.header.rates;
    return { rows, aggBefore: rows.reduce((s, r) => s + r.before, 0), aggAfter: agg.total, noFx: agg.noFx,
      cny: computeLine(q.lines[0], q.header).pricePC, cnyLegacy: computeLine(legacy.lines[0], legacy.header).pricePC };
  });
  console.log('กรณี'.padEnd(36), 'สกุล', 'ยอดในใบ'.padStart(10), '| ก่อน (รวมดิบ)'.padStart(16), '| อัตรา', '| หลัง (บาท)'.padStart(14));
  out.rows.forEach(r => console.log(r.n.padEnd(36), r.cur.padEnd(4), r.total.toFixed(2).padStart(10), '|', r.before.toFixed(2).padStart(14), '|', String(r.rate).padStart(5), '|', r.after.toFixed(2).padStart(12)));
  console.log('ผลรวม  ก่อน:', out.aggBefore.toFixed(2), '  หลัง:', out.aggAfter.toFixed(2), out.noFx.length ? ' ไม่นับ: ' + out.noFx : '');
  const want = out.rows.reduce((s, r) => s + r.after, 0);
  let fails = 0; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails++; };
  ok('aggregate = Σ(ยอด × อัตราที่ล็อกในใบ)', Math.abs(out.aggAfter - want) < 0.01);
  ok('ใบ USD ถูกคูณ 35.2 (ไม่ใช่นับเป็นบาท)', Math.abs(out.rows[1].after - out.rows[1].total * 35.2) < 0.01);
  ok('ต้นทุน CNY 100 → 500 บาท (อัตรา 5)', Math.abs(out.cny - 500) < 0.01);
  ok('ใบเก่าไม่มี rates: CNY 100 → 500 บาท (ไม่ใช่ 750 หรือ 3,600)', Math.abs(out.cnyLegacy - 500) < 0.01);
  console.log(fails ? fails + ' FAILED' : 'ALL FX TESTS PASSED'); await b.close(); process.exit(fails ? 1 : 0);
})();
