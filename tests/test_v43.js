// v4.3 — Phase 1 (ผู้รับผิดชอบ + SLA) · C1 (สกุลเงิน) · C2 (รหัสผ่าน) · H4
// รัน: node tests/test_v43.js Code.gs        (ทดสอบบนเครื่องเท่านั้น ห้าม deploy)
const { makeRuntime } = require('./gasmock');
const crypto = require('crypto');
const { ctx, sheets } = makeRuntime(process.argv[2] || 'Code.gs');
const H = s => crypto.createHash('sha256').update(s + 'mgs-internal-2025').digest('hex');
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 400) : '')); if (!c) fails++; };
const post = p => JSON.parse(ctx.apiPost(JSON.stringify(p)));
const get = (t, tok, a) => JSON.parse(ctx.apiGet(t, tok, a));
const DAY = 86400000;

/* ---------- 1) followState_ ตารางกติกา (pure) ---------- */
console.log('\n== 1) ตารางผู้รับผิดชอบตามสถานะ ==');
const cfg = { sla: { SOURCING: 3, MANAGEMENT: 2, RELEASER: 1, REPAIR: 1 }, salesUpdateDays: 7 };
const now = Date.parse('2026-10-09T03:00:00Z');      // ศุกร์ 10:00 เวลาไทย
const base = { docType: 'QT', owner: 'u1', releasedTo: [], hasSalesCopy: false, updatedMs: now - DAY, statusLog: [], statusChangedAt: '', salesUpdatedAt: '', followUpDate: '', approvalRoles: [], quoteIds: [] };
const F = (o) => ctx.followState_(Object.assign({}, base, o), cfg, now);
const table = [
  ['Requested', {}, 'SOURCING'], ['In Progress', {}, 'SOURCING'],
  ['Submitted', {}, 'MANAGEMENT'], ['Partial Approved', { approvalRoles: ['Procurement Mgr'] }, 'MANAGEMENT'],
  ['Approved', { hasSalesCopy: true }, 'RELEASER'],
  ['Pending', { hasSalesCopy: false, releasedTo: [] }, 'REPAIR'],
  ['Pending', { hasSalesCopy: true, releasedTo: [] }, 'RELEASER'],
  ['Pending', { hasSalesCopy: true, releasedTo: ['u1'] }, 'SALES'],
  ['Won', {}, 'DONE'], ['Closed', {}, 'DONE']
];
table.forEach(([st, extra, want]) => { const f = F(Object.assign({ status: st }, extra)); ok(`QT ${st} ${JSON.stringify(extra)} → ${want}`, f.owner === want, f); });
[['Draft', 'SALES'], ['Submitted', 'SOURCING'], ['Accepted', 'SOURCING'], ['Quoted', 'DONE'], ['Cancelled', 'DONE']]
  .forEach(([st, want]) => ok(`SR ${st} → ${want}`, F({ docType: 'SR', status: st }).owner === want));
ok('SR ที่มี QT ผูกแล้ว → DONE แม้สถานะยังเป็น Submitted', F({ docType: 'SR', status: 'Submitted', quoteIds: ['Q9'] }).owner === 'DONE');
// v5.0 (ตั้งใจ): อนุมัติเรียงลำดับ ป้ายบอก "ระดับ" และชื่อที่แสดง BD Manager แทนชื่อ role ดิบ BD Mgr
ok('Partial Approved บอกว่ารอฝั่งไหน (ระดับ 2 BD Manager)', /รอ BD Manager อนุมัติ \(ระดับ 2\/2\)/.test(F({ status: 'Partial Approved', approvalRoles: ['Procurement Mgr'] }).label));

console.log('\n== 2) งานก่อนปล่อยราคา ต้องไม่เป็นงานค้างของ Sales (หัวใจ Phase 1) ==');
['Requested', 'In Progress', 'Submitted', 'Partial Approved', 'Approved'].forEach(st => {
  const f = F({ status: st, updatedMs: now - 60 * DAY });   // รอมานานมากแล้วก็ตาม
  ok(`${st} รอ 60 วัน → owner ≠ SALES และเป็นงานค้างของ ${f.owner}`, f.owner !== 'SALES' && f.actionable && f.level === 'over', f);
});
const legacy = F({ status: 'Pending', hasSalesCopy: false, updatedMs: now - 59 * DAY });
ok('Pending รุ่นเก่า (ไม่มีราคาฉบับ Sales) รอ 59 วัน → REPAIR ไม่ใช่ Sales', legacy.owner === 'REPAIR' && legacy.estimated, legacy);
const fresh = F({ status: 'Pending', hasSalesCopy: true, releasedTo: ['u1'], statusChangedAt: new Date(now - 2 * DAY).toISOString() });
ok('ได้ราคา 2 วัน → Sales ยังไม่ค้าง (actionable=false)', fresh.owner === 'SALES' && !fresh.actionable && fresh.level === 'ok', fresh);
const stale = F({ status: 'Pending', hasSalesCopy: true, releasedTo: ['u1'], statusChangedAt: new Date(now - 8 * DAY).toISOString() });
ok('ได้ราคา 8 วันไม่อัปเดต → งานค้างของ Sales', stale.owner === 'SALES' && stale.actionable && stale.level === 'over', stale);
const upd = F({ status: 'Pending', hasSalesCopy: true, releasedTo: ['u1'], statusChangedAt: new Date(now - 30 * DAY).toISOString(), salesUpdatedAt: new Date(now - DAY).toISOString() });
ok('อัปเดตเมื่อวาน → ไม่ค้าง', !upd.actionable, upd);
const overdue = F({ status: 'Pending', hasSalesCopy: true, releasedTo: ['u1'], salesUpdatedAt: new Date(now - DAY).toISOString(), followUpDate: '2026-10-01' });
ok('เลยวันนัดติดตาม → ค้าง แม้เพิ่งอัปเดต', overdue.actionable && /วันนัด/.test(overdue.label), overdue);

console.log('\n== 3) SLA วันทำการ + แยกช่วงตามสถานะ ==');
const fri = Date.parse('2026-10-09T03:00:00Z'), mon = Date.parse('2026-10-12T03:00:00Z'), tue = Date.parse('2026-10-13T03:00:00Z');
ok('ศุกร์ → จันทร์ = 1 วันทำการ (ข้ามเสาร์อาทิตย์)', ctx.businessDays_(fri, mon) === 1, ctx.businessDays_(fri, mon));
ok('ศุกร์ → อังคาร = 2 วันทำการ', ctx.businessDays_(fri, tue) === 2);
const sub3 = ctx.followState_(Object.assign({}, base, { status: 'Submitted', statusChangedAt: new Date(Date.parse('2026-10-06T03:00:00Z')).toISOString() }), cfg, fri);   // อังคาร→ศุกร์ = 3
ok('รออนุมัติ 3 วันทำการ (SLA 2) → เกินกำหนด', sub3.waitingDays === 3 && sub3.level === 'over' && sub3.slaBreached, sub3);
const sub2 = ctx.followState_(Object.assign({}, base, { status: 'Submitted', statusChangedAt: '2026-10-07T03:00:00.000Z' }), cfg, fri);
ok('รออนุมัติ 2 วันทำการ (SLA 2) → เฝ้าระวัง (watch)', sub2.waitingDays === 2 && sub2.level === 'watch', sub2);
const log = [{ s: 'In Progress', at: '2026-10-01T03:00:00.000Z' }, { s: 'Submitted', at: '2026-10-05T03:00:00.000Z' }, { s: 'Approved', at: '2026-10-07T03:00:00.000Z' }];
const withLog = ctx.followState_(Object.assign({}, base, { status: 'Approved', statusLog: log, statusChangedAt: '2026-10-07T03:00:00.000Z' }), cfg, fri);
ok('stageDays แยกช่วง: sourcing 2 · approval 2 · release 2', withLog.stageDays.sourcing === 2 && withLog.stageDays.approval === 2 && withLog.stageDays.release === 2, withLog.stageDays);
ok('มี statusLog → ไม่ใช่ค่าประมาณ', withLog.estimated === false);

/* ---------- 4) ผ่าน API จริง ---------- */
console.log('\n== 4) ผ่าน API: projection + release ใบรุ่นเก่า ==');
const Uh = sheets['Users'].rows[0];
const addU = (id, name, role) => { const r = []; r[Uh.indexOf('Id')] = id; r[Uh.indexOf('Name')] = name; r[Uh.indexOf('Role')] = role; r[Uh.indexOf('Scope')] = 'all'; r[Uh.indexOf('PassHash')] = H('pw123456'); r[Uh.indexOf('Email')] = id + '@mgs.co'; sheets['Users'].rows.push(r); };
addU('sourcing1', 'Chatraporn', 'Sourcing'); addU('sales_non', 'NON', 'Sales Manager'); addU('sales_boss', 'BOSS', 'Sales'); addU('admin', 'Admin', 'Admin'); addU('bd', 'BD Manager', 'BD Mgr'); addU('procurement', 'Procurement Manager', 'Procurement Mgr');
const login = id => post({ action: 'login', user: id, passHash: H('pw123456') }).token;
const tS = login('sourcing1'), tN = login('sales_non'), tB = login('sales_boss'), tA = login('admin');
const mk = (id, st, cur, rel, extra) => Object.assign({ id, docType: 'QT', docNo: id, status: st, releasedTo: rel, approvalRoles: [], header: { title: id, customer: 'C', salesUserId: 'sales_boss', currency: cur, rates: { USD: 36, CNY: 5 } }, lines: [] }, extra || {});
const save = (q, sd, total) => post({ token: tS, action: 'save', id: q.id, docNo: q.id, status: q.status, salesUserId: 'sales_boss', releasedTo: (q.releasedTo || []).join('|'), currency: q.header.currency, total: total || 1000, detail: JSON.stringify(q), salesDetail: sd || '' });
const SD = (id, cur, total) => JSON.stringify({ id, header: { currency: cur }, lines: [{ code: 'A', qty: 1, unitPrice: total, amount: total }], total });
save(mk('L1', 'Pending', 'THB', []), '');                                 // รุ่นเก่า ไม่มีราคาฉบับ Sales
save(mk('L2', 'Pending', 'THB', []), SD('L2', 'THB', 1000));               // มีราคาฉบับ Sales แต่ยังไม่ปล่อย
save(mk('U1', 'Pending', 'USD', ['sales_boss']), SD('U1', 'USD', 10000), 10000);   // ใบ USD ปล่อยแล้ว
save(mk('S1', 'Submitted', 'THB', []), '');
let vb = get('salesview', tB).quotations, byId = id => vb.find(r => r.id === id);
ok('BOSS: L1 → REPAIR (ไม่ใช่งานค้างของ Sales)', byId('L1').follow.owner === 'REPAIR' && !byId('L1').salesDetail, byId('L1').follow);
ok('BOSS: L2 → RELEASER (รอยืนยันปล่อยราคา)', byId('L2').follow.owner === 'RELEASER' && /รุ่นเก่า/.test(byId('L2').follow.label));
ok('BOSS: S1 → MANAGEMENT', byId('S1').follow.owner === 'MANAGEMENT');
ok('BOSS: U1 → SALES', byId('U1').follow.owner === 'SALES');
ok('follow ไม่มีคีย์ต้นทุน', !/"(cost|gp|up|exrate|rates|opPct)"/.test(JSON.stringify(vb.map(r => r.follow))));
ok('C1: U1 valueTHB = 10,000 USD × 36 = 360,000 (ไม่ส่งอัตราออกไป)', byId('U1').valueTHB === 360000 && !/"rates"/.test(byId('U1').salesDetail), byId('U1').valueTHB);
const vn = get('salesview', tN).quotations;
ok('NON เห็นปุ่มยืนยันปล่อยราคาใน L2 แต่ไม่เห็นใน L1 (ยังไม่มีราคาฉบับ Sales)', vn.find(r => r.id === 'L2').canRelease && !vn.find(r => r.id === 'L1').canRelease);
let r = post({ token: tN, action: 'release', id: 'L1' });
ok('ปล่อย L1 → NO_SALES_COPY (ต้องให้ Sourcing สร้างข้อมูลก่อน)', r.error === 'NO_SALES_COPY', r);
r = post({ token: tN, action: 'release', id: 'L2' });
ok('NON ยืนยันปล่อย L2 → สำเร็จ, follow กลายเป็น SALES, สถานะคง Pending', r.ok && r.follow.owner === 'SALES' && !r.detail, r);
ok('BOSS เห็นราคา L2 แล้ว', !!get('salesview', tB).quotations.find(x => x.id === 'L2').salesDetail);
const Qh = sheets['Quotations'].rows[0], row = id => sheets['Quotations'].rows.find(x => x[Qh.indexOf('Id')] === id);
ok('ปล่อยราคาไม่แก้สถานะ L2 (คง Pending) และ audit ระบุว่าเป็นใบรุ่นเก่า', row('L2')[Qh.indexOf('Status')] === 'Pending' && /legacy Pending/.test(row('L2')[Qh.indexOf('Detail')]));
// statusLog จาก approve_
const tPr = login('procurement'), tBd = login('bd');
post({ token: tPr, action: 'approve', id: 'S1' }); r = post({ token: tBd, action: 'approve', id: 'S1' });
const dS1 = JSON.parse(row('S1')[Qh.indexOf('Detail')]);
ok('approve_ บันทึก statusLog (Partial Approved → Approved) + follow = RELEASER', dS1.statusLog.map(e => e.s).join() === 'Partial Approved,Approved' && r.follow.owner === 'RELEASER', dS1.statusLog);
ok('write endpoints คืน follow (save)', !!save(mk('S2', 'In Progress', 'THB', [])).follow);

/* ---------- 5) รหัสผ่าน (C2) ---------- */
console.log('\n== 5) รหัสผ่าน: v2 + กัน pass-the-hash + ล็อก ==');
const stored = id => sheets['Users'].rows.find(x => x[Uh.indexOf('Id')] === id)[Uh.indexOf('PassHash')];
ok('ล็อกอินสำเร็จแล้ว hash เดิมถูกแปลงเป็น v2', /^v2\$[0-9a-f]{16}\$[0-9a-f]{64}$/.test(stored('sourcing1')), stored('sourcing1'));
ok('ค่าใน Sheet เอาไปล็อกอินแทนรหัสไม่ได้ (pass-the-hash)', post({ action: 'login', user: 'sourcing1', passHash: stored('sourcing1') }).error === 'AUTH_FAILED');
ok('salt ต่อผู้ใช้ไม่ซ้ำกัน', stored('sourcing1').split('$')[1] !== stored('sales_boss').split('$')[1]);
addU('legacy1', 'Legacy', 'Sales');
ok('migratePasswordHashes() แปลง hash แบบเก่าโดยไม่ต้องรู้รหัส', ctx.migratePasswordHashes() >= 1 && /^v2\$/.test(stored('legacy1')));
ok('หลัง migrate ผู้ใช้เดิมยังล็อกอินด้วยรหัสเดิมได้', post({ action: 'login', user: 'legacy1', passHash: H('pw123456') }).ok);
ok('migrate ซ้ำไม่กระทบค่าที่แปลงแล้ว', ctx.migratePasswordHashes() === 0);
let last;
for (let i = 1; i <= 5; i++) last = post({ action: 'login', user: 'sales_boss@mgs.co', passHash: H('wrong' + i) });
ok('ผิด 5 ครั้ง → ACCOUNT_LOCKED', last.error === 'ACCOUNT_LOCKED', last);
ok('ถูกล็อกแล้ว รหัสถูกก็เข้าไม่ได้', post({ action: 'login', user: 'sales_boss', passHash: H('pw123456') }).error === 'ACCOUNT_LOCKED');
ok('แจ้งจำนวนครั้งที่เหลือก่อนถูกล็อก', post({ action: 'login', user: 'admin', passHash: H('x') }).left === 4);
r = post({ token: tA, action: 'saveUsers', users: JSON.stringify([{ id: 'sales_boss', name: 'BOSS', role: 'Sales', passHash: H('newpass9') }]) });
ok('Admin ตั้งรหัสใหม่ = ปลดล็อก + เก็บเป็น v2', r.ok && post({ action: 'login', user: 'sales_boss', passHash: H('newpass9') }).ok && /^v2\$/.test(stored('sales_boss')));
ok('saveUsers ปฏิเสธค่า hash ที่ไม่ใช่รูปแบบ client hash', post({ token: tA, action: 'saveUsers', users: JSON.stringify([{ id: 'sales_boss', name: 'BOSS', role: 'Sales', passHash: 'v2$x$y' }]) }).error === 'BAD_HASH');
const us = get('users', tA).users;
ok('getUsers ไม่ส่ง hash ออกมาเลย (แม้ Admin) — ส่งแค่ hasPassword', us.every(u => u.passHash === undefined) && us.find(u => u.id === 'admin').hasPassword === true);
ok('changePassword ทำงานกับ v2', post({ token: login('sourcing1'), action: 'changePassword', oldHash: H('pw123456'), newHash: H('abc12345') }).ok &&
  post({ action: 'login', user: 'sourcing1', passHash: H('abc12345') }).ok);

/* ---------- 6) อัตราแลกเปลี่ยนต่อแถว (C1) ---------- */
console.log('\n== 6) rowRateToTHB_ ==');
const fx = (cur, det, ex) => { const r2 = []; r2[Qh.indexOf('Currency')] = cur; r2[Qh.indexOf('Detail')] = det; r2[Qh.indexOf('Exrate')] = ex || ''; return ctx.rowRateToTHB_(r2, ctx.headerIndex_(sheets['Quotations'])); };
ok('THB → 1', fx('THB', '{}') === 1);
ok('USD ใช้อัตราที่ล็อกในใบ (35.2)', fx('USD', '{"header":{"rates":{"USD":35.2,"CNY":5}}}') === 35.2);
ok('CNY ใช้อัตราที่ล็อกในใบ (5) — ไม่ใช่ 7.5', fx('CNY', '{"header":{"rates":{"USD":36,"CNY":5}}}') === 5);
ok('USD ไม่มี rates → ใช้คอลัมน์ Exrate', fx('USD', '{}', 36.5) === 36.5);
ok('CNY ไม่มีอัตรา → 0 (ไม่เดา, ไม่นับรวม)', fx('CNY', '{}', 36) === 0);

console.log(fails ? '\n' + fails + ' FAILED' : '\nALL v4.3 TESTS PASSED');
process.exit(fails ? 1 : 0);
