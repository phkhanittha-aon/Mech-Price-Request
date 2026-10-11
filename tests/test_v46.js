// v4.6 — Phase 4: ตัวเงิน / MasterData / ถ้อยคำ   รัน: node tests/test_v46.js $PWD   (ทดสอบบนเครื่องเท่านั้น ห้าม deploy)
// พิมพ์ตาราง before/after ของการอ่านตัวเลขและ FX ทุกครั้ง (ข้อกำหนด: โค้ดที่แตะ FX ต้องมี test เทียบ before/after)
const fs = require('fs'), vm = require('vm'), crypto = require('crypto');
const { makeRuntime } = require('./gasmock');
const DIR = process.argv[2] || '.';
const { ctx, sheets } = makeRuntime(DIR + '/Code.gs');
const H = s => crypto.createHash('sha256').update(s + 'mgs-internal-2025').digest('hex');
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const post = p => JSON.parse(ctx.apiPost(JSON.stringify(p)));
const get = (t, tok, a) => JSON.parse(ctx.apiGet(t, tok, a));
const U = sheets['Users'], uh = U.rows[0], col = n => uh.indexOf(n);
[['admin', 'Admin', 'Admin'], ['src', 'Chatraporn', 'Sourcing'], ['s1', 'BOSS', 'Sales'], ['bd', 'BD', 'BD Mgr']].forEach(([id, n, r]) => {
  const x = []; x[col('Id')] = id; x[col('Name')] = n; x[col('Role')] = r; x[col('Scope')] = 'all'; x[col('PassHash')] = H('pw123456'); x[col('Email')] = id + '@m.co'; U.rows.push(x);
});
const tok = u => post({ action: 'login', user: u, passHash: H('pw123456') }).token;
const tA = tok('admin'), tS = tok('src'), tSa = tok('s1'), tB = tok('bd');
const pad = (s, n) => String(s).padEnd(n);

/* ------------------------------------------------------------------ 1) server num_ */
console.log('== 1) server num_ — อ่านตัวเลขแบบป้องกัน (เดิม Number(v)||0) ==');
const cases = [[1234.5, 1234.5], ['1,234.50', 1234.5], [' 1 234 ', 1234], ['฿1,234', 1234], ['US$ 12', 12], ['12 USD', 12],
  ['CN¥7.25', 7.25], ['(12)', -12], ['-5', -5], ['+.5', 0.5], ['', 0], [null, 0], [undefined, 0], ['abc', 0], ['1.2.3', 0],
  [Infinity, 0], [NaN, 0], [true, 0], [new Date(2026, 0, 1), 0], ['1,000,000.005', 1000000.005], ['บาท 100', 100], ['0', 0], ['1,5', 0], ['36,5', 0], ['12,34.5', 0], ['1 234 567', 1234567]];
console.log(pad('input', 26) + pad('เดิม Number()||0', 18) + 'ใหม่ num_()');
cases.forEach(([v, want]) => {
  const before = Number(v) || 0, after = ctx.num_(v);
  console.log(pad(JSON.stringify(v instanceof Date ? 'Date' : v === undefined ? 'undefined' : v), 26) + pad(before, 18) + after);
  ok('num_(' + (v instanceof Date ? 'Date' : String(v)) + ') = ' + want, Object.is(after, want) || after === want, after);
});
ok('num_ คืนค่า default ที่ส่งมาเมื่ออ่านไม่ได้', ctx.num_('', null) === null && ctx.num_('x', 7) === 7 && ctx.num_('5', 7) === 5);
ok('numOrBlank_: ว่าง/อ่านไม่ได้ = เซลล์ว่าง', ctx.numOrBlank_('') === '' && ctx.numOrBlank_('abc') === '' && ctx.numOrBlank_('1,500') === 1500);

/* ------------------------------------------------------------------ 2) FX before/after */
console.log('== 2) FX: rowRateToTHB_ / salesValueTHB_ — before/after ==');
const Q = sheets['Quotations'], qh = Q.rows[0], qidx = {}; qh.forEach((h, i) => qidx[h] = i + 1);
const rowOf = o => { const r = new Array(qh.length).fill(''); for (const k in o) r[qidx[k] - 1] = o[k]; return r; };
const oldRate = (r) => {        // ตรรกะเดิม v4.5 (คัดลอกมาเพื่อเทียบ)
  const cur = String(r[qidx.Currency - 1] || 'THB').toUpperCase(); if (cur === 'THB' || !cur) return 1;
  let rates = null; const m = /"rates":(\{[^}]*\})/.exec(String(r[qidx.Detail - 1] || '')); if (m) { try { rates = JSON.parse(m[1]); } catch (e) { } }
  if (rates && +rates[cur] > 0) return +rates[cur];
  if (cur === 'USD' && +r[qidx.Exrate - 1] > 0) return +r[qidx.Exrate - 1];
  return 0;
};
const fx = [
  ['THB ไม่มีเรต', { Currency: 'THB' }, 1],
  ['USD rates ในใบ 36.5', { Currency: 'USD', Detail: '{"header":{"rates":{"USD":36.5,"CNY":5}}}' }, 36.5],
  ['CNY rates ในใบ 5 (เคสที่เคยพัง → ห้ามได้ 7.5/36)', { Currency: 'CNY', Detail: '{"header":{"rates":{"USD":36,"CNY":5}}}', Exrate: 36 }, 5],
  ['USD ไม่มี rates · Exrate ตัวเลข 35.8', { Currency: 'USD', Exrate: 35.8 }, 35.8],
  ['USD ไม่มี rates · Exrate ข้อความ " 36.50 "', { Currency: 'USD', Exrate: ' 36.50 ' }, 36.5],
  ['USD ไม่มี rates · Exrate "฿36.5"', { Currency: 'USD', Exrate: '฿36.5' }, 36.5],
  ['USD ไม่มี rates · Exrate ว่าง → 0 (ไม่เดา)', { Currency: 'USD', Exrate: '' }, 0],
  ['CNY ไม่มี rates → 0 (ไม่ใช้ Exrate ของ USD)', { Currency: 'CNY', Exrate: 36 }, 0],
  ['USD rates เป็นข้อความ "36.25"', { Currency: 'USD', Detail: '{"header":{"rates":{"USD":"36.25"}}}' }, 36.25]
];
console.log(pad('เคส', 52) + pad('เดิม', 8) + 'ใหม่');
fx.forEach(([n, o, want]) => {
  const r = rowOf(o), b = oldRate(r), a = ctx.rowRateToTHB_(r, qidx);
  console.log(pad(n, 52) + pad(b, 8) + a + (a !== b ? '   ← เปลี่ยน (อ่านข้อความได้แล้ว)' : ''));
  ok('FX ' + n + ' = ' + want, a === want, a);
});
const sv = rowOf({ Currency: 'USD', Exrate: 36, Total: 999, SalesDetail: '{"total":1000,"lines":[]}' });
ok('salesValueTHB_ USD 1,000 × 36 = 36,000 (ใช้ยอดฉบับ Sales ไม่ใช่คอลัมน์ Total)', ctx.salesValueTHB_(sv, qidx) === 36000);
ok('salesValueTHB_ ไม่รู้เรต → null (ไม่เดา)', ctx.salesValueTHB_(rowOf({ Currency: 'CNY', SalesDetail: '{"total":10}' }), qidx) === null);

/* ------------------------------------------------------------------ 3) client MGS.fmt / MGS.parse */
console.log('== 3) client MGS.fmt / MGS.parse (โค้ดจริงจาก Index.html) ==');
const idxHtml = fs.readFileSync(DIR + '/Index.html', 'utf8'), salesHtml = fs.readFileSync(DIR + '/Sales.html', 'utf8');
const block = h => h.slice(h.indexOf('const MGS=window.MGS'), h.indexOf('const fmt=(n,d=2)=>MGS.fmt.num(n,d);'));
ok('Index.html กับ Sales.html ใช้โค้ด MGS ชุดเดียวกันทุกตัวอักษร (helper เดียวทั้งระบบ)', block(idxHtml).length > 500 && block(idxHtml) === block(salesHtml));
const handlers = {}, sandbox = { window: {}, document: { addEventListener: (t, f) => (handlers[t] = f), activeElement: null } };
vm.createContext(sandbox); vm.runInContext(block(idxHtml) + ';this.MGS=MGS;', sandbox);
const M = sandbox.MGS;
[['1,234.5', 1234.5], ['1234', 1234], [' 12 345.678 ', 12345.678], ['฿ 1,000', 1000], ['US$2,500.00', 2500], ['(1,000)', -1000],
 ['', 'D'], ['abc', 'D'], ['1,2,3', 'D'], ['36,5', 'D'], ['1.2.3', 'D'], [null, 'D'], [42, 42], ['12,345,678.9', 12345678.9]].forEach(([v, want]) => {
  const got = M.parse.num(v, 'D'); ok('MGS.parse.num(' + JSON.stringify(v) + ') = ' + JSON.stringify(want), got === want, got);
});
ok('MGS.fmt.money(1234.5,"USD") = US$1,234.50', M.fmt.money(1234.5, 'USD') === 'US$1,234.50', M.fmt.money(1234.5, 'USD'));
ok('MGS.fmt.money(24735218,"THB") = ฿24,735,218.00 (2 ตำแหน่งเสมอ)', M.fmt.money(24735218, 'THB') === '฿24,735,218.00');
ok('MGS.fmt.money(7.255,"CNY",{code:true}) = 7.26 CNY', M.fmt.money(7.255, 'CNY', { code: true }) === '7.26 CNY', M.fmt.money(7.255, 'CNY', { code: true }));
ok('ค่าว่างแสดง — ไม่ใช่ 0.00', M.fmt.money('', 'THB') === '—' && M.fmt.num(null) === '—');
ok('จำนวนสินค้าไม่บังคับทศนิยม (12 / 2.5)', M.fmt.qty(12) === '12' && M.fmt.qty('2.5') === '2.5');
ok('ช่องกรอกเงิน: แสดง 1,234.00 แต่เก็บค่าจริงใน data-raw', /data-raw="1234"/.test(M.moneyAttrs(1234)) && /value="1,234.00"/.test(M.moneyAttrs(1234)) && /inputmode="decimal"/.test(M.moneyAttrs(1234)));
ok('ช่องกรอกเงินว่าง = ว่าง', /value=""/.test(M.moneyAttrs('')));
// จำลองโฟกัส/พิมพ์/ออกจากช่อง
const el = { value: '1,234.00', dataset: { raw: '1234' }, matches: () => true, select() { } };
handlers.focusin({ target: el }); ok('โฟกัส → แสดงค่าจริงให้แก้ง่าย (1234)', el.value === '1234', el.value);
el.value = '12,500.5'; handlers.input({ target: el }); handlers.focusout({ target: el });
ok('พิมพ์ "12,500.5" แล้วออกจากช่อง → 12,500.50 / raw 12500.5', el.value === '12,500.50' && el.dataset.raw === '12500.5', el);
// hsetRate เดิม (+v||0) vs ใหม่ (MGS.parse.num) — FX ฝั่ง client
console.log(pad('อัตราที่พิมพ์', 16) + pad('เดิม +v||0', 12) + 'ใหม่');
[['36.5', 36.5], ['36', 36], ['', 0], ['0', 0], ['5.125', 5.125], [' 36.50 ', 36.5], ['36,5', 0]].forEach(([v, want]) => {
  const b = +v || 0, a = M.parse.num(v, 0);
  console.log(pad(JSON.stringify(v), 16) + pad(b, 12) + a + (a !== b ? '   ← ต่าง' : ''));
  ok('อัตรา ' + JSON.stringify(v) + ' → ' + want, a === want, a);
});
ok('ค่าอัตราที่พิมพ์ปกติ (ตัวเลขล้วน) ได้ผลเท่าเดิมทุกตัว', ['36.5', '36', '', '0', '5.125', '7.25', '100'].every(v => (+v || 0) === M.parse.num(v, 0)));

/* ------------------------------------------------------------------ 4) server defensive parse in writes */
console.log('== 4) server: ค่าที่มีลูกน้ำ/ข้อความจาก client ==');
let r = post({ token: tS, action: 'saveProduct', code: 'T-1', desc: 'x', defaultPrice: '1,234.50', boiPrice: '', duty: '0.05' });
let P = sheets['Products'], ph = P.rows[0], prow = P.rows.find(x => x[ph.indexOf('Code')] === 'T-1');
ok('saveProduct ราคา "1,234.50" → 1234.5 · BOI ว่างยังว่าง', r.ok && prow[ph.indexOf('DefaultPrice')] === 1234.5 && prow[ph.indexOf('BoiPrice')] === '', prow);
r = post({ token: tSa, action: 'saveSR', id: 'SR-T1', status: 'Submitted', detail: JSON.stringify({ header: { title: 't', customer: 'c', currency: 'THB' }, lines: [{ desc: 'a', qty: '2', targetUp: '1,500' }, { desc: 'b', qty: '', targetUp: 'ถ้ามี' }] }) });
const srRow = Q.rows.find(x => x[qidx.Id - 1] === 'SR-T1'), srDet = srRow && JSON.parse(srRow[qidx.Detail - 1]);
ok('saveSR: qty "2" → 2 · targetUp "1,500" → 1500 · ค่าว่าง/ข้อความ → qty 1 / target 0', r.ok && srDet.lines[0].qty === 2 && srDet.lines[0].targetUp === 1500 && srDet.lines[1].qty === 1 && srDet.lines[1].targetUp === 0, srDet && srDet.lines);
r = post({ token: tS, action: 'save', id: 'Q-T1', docType: 'QT', docNo: 'QT-T1', status: 'In Progress', total: '1,000.50', cost: ' 800 ', profit: '฿200.5', gp: '20', exrate: '36.5', lines: '3', currency: 'USD', detail: JSON.stringify({ header: { currency: 'USD', paymentTerm: 'เครดิต 30 วัน' }, lines: [] }), salesDetail: JSON.stringify({ header: { paymentTerm: 'เครดิต 30 วัน' }, total: 1000.5, lines: [{ unitPrice: 1, amount: 1 }] }) });
const qRow = Q.rows.find(x => x[qidx.Id - 1] === 'Q-T1');
ok('save: Total "1,000.50" / Cost " 800 " / Profit "฿200.5" → ตัวเลขในชีท', r.ok && qRow[qidx.Total - 1] === 1000.5 && qRow[qidx.Cost - 1] === 800 && qRow[qidx.Profit - 1] === 200.5 && qRow[qidx.Exrate - 1] === 36.5, r);

/* ------------------------------------------------------------------ 5) MasterData */
console.log('== 5) MasterData ==');
const QH = ['Id','DocType','DocNo','Ref','Title','Customer','Sales','SalesUserId','AssignedTo','Group','Round','Currency','Incoterm','PriceTerm','Exrate','OfferDate','Stage','Status','FollowStatus','NeedsApproval','ReleasedTo','SalesNote','Lines','Total','Cost','Profit','GP','Updated','UpdatedAt','By','Deleted','DeletedAt','DeletedBy','Detail','SalesDetail'];
ok('header ชีทเดิมไม่เปลี่ยน (Quotations / Products / Settings / Users / Log / Sessions)',
  JSON.stringify(ctx.HEADERS.Quotations) === JSON.stringify(QH) &&
  JSON.stringify(ctx.HEADERS.Products) === JSON.stringify(['Code','Desc','Group','ComGroup','Uom','Warranty','Duty','Supplier','Lead','DefaultPrice','DefaultCur','BoiPrice','Updated','By']) &&
  JSON.stringify(ctx.HEADERS.Settings) === JSON.stringify(['SettingsRev','SettingsUpdatedAt','By','Detail']) &&
  JSON.stringify(ctx.HEADERS.Users) === JSON.stringify(['Id','Name','Role','Scope','PassHash','Updated','Email','Active']) &&
  JSON.stringify(ctx.HEADERS.Log) === JSON.stringify(['Time','Action','Id','By','Note']) &&
  JSON.stringify(ctx.HEADERS.Sessions) === JSON.stringify(['Token','UserId','Role','Name','Issued','ExpiresMs','Expires','Agent']));
// Settings เดิมมี incoterm ที่ผู้ใช้เคยเพิ่มเอง → ต้องไม่หายตอนสร้างแท็บ
post({ token: tA, action: 'saveSettings', settingsRev: 2, detail: JSON.stringify({ incoterms: ['CIF at MGS', 'EXW Shenzhen'], units: ['pcs', 'ม้วน'], commission: { x: 1 }, groups: { y: 1 } }) });
sheets['MasterData'].rows.length = 1;      // จำลอง: มี Settings เดิมอยู่แล้ว แล้วค่อยรัน setup() เวอร์ชันนี้ครั้งแรก
let m = get('master', tA).master;
ok('สร้างแท็บ MasterData ครั้งแรก พร้อมค่าตั้งต้นทุกรายการ', m && ['currency','incoterm','priceTerm','paymentTerm','validity','uom','expenseType'].every(k => m.lists[k].length > 0), m && m.lists);
ok('รวมค่าที่เคยตั้งใน Settings เดิมด้วย (EXW Shenzhen / ม้วน ไม่หาย)', m.lists.incoterm.includes('EXW Shenzhen') && m.lists.uom.includes('ม้วน'));
ok('ค่าเริ่มต้น: THB / CIF at MGS / Special price / 30 วัน / pcs', m.defaults.currency === 'THB' && m.defaults.incoterm === 'CIF at MGS' && m.defaults.priceTerm === 'Special price' && m.defaults.validity === '30' && m.defaults.uom === 'pcs', m.defaults);
const nRows = sheets['MasterData'].rows.length; get('master', tA);
ok('เปิดซ้ำไม่สร้างแถวซ้ำ', sheets['MasterData'].rows.length === nRows);
const sSet = get('settings', tSa);
ok('Sales ได้รายการตัวเลือก แต่ยังไม่ได้ตารางคอม/โครงสร้างราคา', !!sSet.master && sSet.commission === undefined && sSet.groups === undefined, Object.keys(sSet));
r = post({ token: tSa, action: 'addMaster', list: 'uom', value: '  ลัง  ' });
ok('Sales เพิ่มหน่วยนับใหม่ได้ (ตัดช่องว่าง)', r.ok && r.value === 'ลัง' && r.master.lists.uom.includes('ลัง'), r);
ok('เพิ่มซ้ำ (ตัวพิมพ์ต่าง) = ใช้ของเดิม ไม่เพิ่มแถว', (() => { const n = sheets['MasterData'].rows.length; const x = post({ token: tS, action: 'addMaster', list: 'uom', value: 'PCS' }); return x.ok && x.existed && x.value === 'pcs' && sheets['MasterData'].rows.length === n; })());
ok('Sales เพิ่ม Incoterm ไม่ได้ (ACCESS_DENIED)', post({ token: tSa, action: 'addMaster', list: 'incoterm', value: 'X' }).error === 'ACCESS_DENIED');
ok('Sourcing เพิ่ม Incoterm ได้', post({ token: tS, action: 'addMaster', list: 'incoterm', value: 'CIP Bangkok' }).ok);
ok('กันสูตรในชีท: ค่าขึ้นต้นด้วย = + - @ ถูกปฏิเสธ', ['=HYPERLINK("x")', '+1', '-2', '@a'].every(v => post({ token: tS, action: 'addMaster', list: 'paymentTerm', value: v }).error === 'BAD_VALUE'));
ok('ยาวเกิน 60 ตัวอักษรถูกปฏิเสธ', post({ token: tS, action: 'addMaster', list: 'paymentTerm', value: 'x'.repeat(61) }).error === 'BAD_VALUE');
ok('ยืนราคา: รับเฉพาะจำนวนวันเต็ม 1–365', post({ token: tS, action: 'addMaster', list: 'validity', value: '120' }).value === '120' && ['1.5', '0', '400', 'abc'].every(v => post({ token: tS, action: 'addMaster', list: 'validity', value: v }).error === 'BAD_VALUE'));
ok('สกุลเงินเพิ่มไม่ได้ (สูตร FX รองรับ 3 สกุล)', post({ token: tA, action: 'addMaster', list: 'currency', value: 'EUR' }).error === 'LIST_LOCKED' && post({ token: tA, action: 'saveMaster', list: 'currency', op: 'add', value: 'EUR' }).error === 'LIST_LOCKED');
ok('รายการที่ไม่รู้จักถูกปฏิเสธ', post({ token: tA, action: 'addMaster', list: 'evil', value: 'x' }).error === 'LIST_LOCKED');
ok('Sourcing แก้ค่าเริ่มต้น/ซ่อนไม่ได้ (ต้อง manageSetting)', post({ token: tS, action: 'saveMaster', list: 'uom', op: 'hide', value: 'pcs' }).error === 'ACCESS_DENIED');
r = post({ token: tB, action: 'saveMaster', list: 'incoterm', op: 'default', value: 'fob' });
ok('ผู้จัดการตั้งค่าเริ่มต้นใหม่ได้ (ไม่สนตัวพิมพ์)', r.ok && r.master.defaults.incoterm === 'FOB', r);
r = post({ token: tA, action: 'saveMaster', list: 'uom', op: 'hide', value: 'ลัง' });
ok('ซ่อนตัวเลือก → หายจากรายการ', r.ok && !r.master.lists.uom.includes('ลัง'));
ok('พิมพ์ค่าที่ถูกซ่อนผ่าน "อื่น ๆ" → แจ้ง VALUE_HIDDEN (ไม่สร้างแถวซ้ำ)', post({ token: tSa, action: 'addMaster', list: 'uom', value: 'ลัง' }).error === 'VALUE_HIDDEN');
r = post({ token: tA, action: 'saveMaster', list: 'uom', op: 'add', value: 'ลัง' });
ok('Admin เพิ่มค่าที่ถูกซ่อน = แสดงกลับ', r.ok && r.master.lists.uom.includes('ลัง'), r);
ok('ซ่อนค่าเริ่มต้น → ค่าเริ่มต้นย้ายไปตัวแรกที่เหลือ', (() => { const x = post({ token: tA, action: 'saveMaster', list: 'incoterm', op: 'hide', value: 'FOB' }); return x.ok && x.master.defaults.incoterm === x.master.lists.incoterm[0]; })());
ok('Admin แก้ในชีทตรง ๆ (Active=FALSE) ก็มีผล', (() => { const MD = sheets['MasterData'], h = MD.rows[0]; const row = MD.rows.find(x => x[h.indexOf('List')] === 'priceTerm' && x[h.indexOf('Value')] === 'MOU price'); row[h.indexOf('Active')] = 'FALSE'; return !get('master', tA).master.lists.priceTerm.includes('MOU price'); })());
ok('ทุกการเพิ่ม/แก้มีบันทึกใน Log', sheets['Log'].rows.some(x => /addMaster/.test(x.join(' '))) && sheets['Log'].rows.some(x => /saveMaster/.test(x.join(' '))));

/* ------------------------------------------------------------------ 6) price gate ยังแน่น */
console.log('== 6) price gate ==');
const sv2 = get('salesview', tSa, ''); const leak = JSON.stringify(sv2).match(/"(cost|profit|gp|up|pricePC|baseCost|dutyPct|opPct|detail)"\s*:/gi);
ok('response ของ Sales ไม่มี field ต้นทุนเลย (หลังเพิ่ม paymentTerm)', !leak, leak);
ok('payment term ไปถึงฉบับ Sales ได้ (ไม่ใช่ข้อมูลต้นทุน)', JSON.stringify(ctx.salesSafe_(qRow[qidx.SalesDetail - 1])).includes('เครดิต 30 วัน'));

/* ------------------------------------------------------------------ 7) ถ้อยคำ */
console.log('== 7) ถ้อยคำ ==');
const allUi = idxHtml + salesHtml;
ok('ไม่มีคำเก่า "ครบกำหนดวันนี้" / "รอผู้บริหารตรวจ" / "รอ Sales ติดตาม" ในหน้าจอ', !/ครบกำหนดวันนี้|รอผู้บริหารตรวจ|รอ Sales ติดตาม|รอผู้บริหารอนุมัติ/.test(allUi));
// v5.0 (ตั้งใจ): "รอผู้จัดการอนุมัติ" แยกเป็น 2 ระดับ (รอ Sourcing Manager / BD Manager อนุมัติ) ตามขั้นตอนอนุมัติเรียงลำดับ
ok('ป้ายสถานะตรงกับ server: รอ Sourcing จัดทำราคา / รอ Sourcing Manager · BD Manager อนุมัติ (ระดับ) / รอปล่อยราคา / พร้อมเสนอลูกค้า',
  ['รอ Sourcing จัดทำราคา', 'รอปล่อยราคา', 'พร้อมเสนอลูกค้า'].every(t => fs.readFileSync(DIR + '/Code.gs', 'utf8').includes(t) && idxHtml.includes(t)) &&
  /อนุมัติ \(ระดับ '/.test(fs.readFileSync(DIR + '/Code.gs', 'utf8')) && /อนุมัติ \(ระดับ '/.test(idxHtml) && ['Sourcing Manager', 'BD Manager'].every(t => idxHtml.includes(t) && salesHtml.includes(t)) &&
  !/รอผู้จัดการอนุมัติ/.test(allUi));
ok('ระดับความเร่งด่วน 3 ระดับใช้คำเดียวกันทั้ง 2 แอป', /th:'เฝ้าระวัง'/.test(idxHtml) && /th:'เฝ้าระวัง'/.test(salesHtml) && /th:'เกินกำหนด'/.test(idxHtml) && /th:'เกินกำหนด'/.test(salesHtml));
ok('ไม่มี toast ที่โชว์รหัส error ดิบ ๆ แบบ "ไม่สำเร็จ: "+res.error', !/ไม่สำเร็จ: '\+\((res|r|d)\.error/.test(allUi) && !/ไม่สำเร็จ: '\+\(\(d&&d\.error\)/.test(allUi));
ok('ไม่มี parseFloat ดิบในทั้งสองแอป', !/parseFloat\(/.test(allUi.replace(/\/\*[\s\S]*?\*\//g, '')));

console.log(fails ? '\n' + fails + ' FAILED' : '\nALL v4.6 TESTS PASSED'); process.exit(fails ? 1 : 0);
