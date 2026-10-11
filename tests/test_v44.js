// v4.4 — Phase 2 Login (backend)   รัน: node tests/test_v44.js Code.gs   (ทดสอบบนเครื่องเท่านั้น ห้าม deploy)
const { makeRuntime } = require('./gasmock');
const crypto = require('crypto');
const { ctx, sheets } = makeRuntime(process.argv[2] || 'Code.gs');
const H = s => crypto.createHash('sha256').update(s + 'mgs-internal-2025').digest('hex');
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const post = p => JSON.parse(ctx.apiPost(JSON.stringify(p)));
const get = (t, tok, a) => JSON.parse(ctx.apiGet(t, tok, a));
const U = sheets['Users'], h = U.rows[0], col = n => h.indexOf(n);
const add = (id, name, role, email, active) => { const r = []; r[col('Id')] = id; r[col('Name')] = name; r[col('Role')] = role; r[col('Scope')] = 'all'; r[col('PassHash')] = H('pw123456'); r[col('Email')] = email; r[col('Active')] = active || ''; U.rows.push(r); };
add('admin', 'Admin', 'Admin', 'admin@mglobalsourcing.net'); add('bd', 'BD Manager', 'BD Mgr', 'bd@mglobalsourcing.net');
add('sourcing1', 'Chatraporn', 'Sourcing', 'chat@mglobalsourcing.net'); add('sales_boss', 'BOSS', 'Sales', 'boss@mglobalsourcing.net');
add('olduser', 'Old', 'Sourcing', 'old@mglobalsourcing.net', 'FALSE');
const urow = id => U.rows.find(r => r[col('Id')] === id);

console.log('== 1) เส้นทางที่ 1: อีเมล Google ==');
globalThis.__SSO_EMAIL = 'BD@mglobalsourcing.net';
let r = post({ action: 'ssoLogin' });
ok('อีเมลตรงกับแท็บ Users (ไม่สนตัวพิมพ์) → เข้าได้ทันที ไม่ต้องกรอกอะไร', r.ok && r.user.id === 'bd' && r.user.role === 'BD Mgr' && r.token, r);
const tBd = r.token;
globalThis.__SSO_EMAIL = 'old@mglobalsourcing.net'; r = post({ action: 'ssoLogin' });
ok('อีเมลพบแต่ปิดใช้งาน → ACCOUNT_DISABLED + บอกอีเมล', r.error === 'ACCOUNT_DISABLED' && r.email === 'old@mglobalsourcing.net', r);
globalThis.__SSO_EMAIL = 'stranger@gmail.com'; r = post({ action: 'ssoLogin' });
ok('อีเมลไม่มีในชีท → SSO_NO_USER + แสดงอีเมลที่ตรวจพบ', r.error === 'SSO_NO_USER' && r.email === 'stranger@gmail.com', r);
globalThis.__SSO_EMAIL = ''; globalThis.__EFFECTIVE_EMAIL = 'admin@mglobalsourcing.net';
r = post({ action: 'ssoLogin' });
ok('อ่านอีเมลผู้ใช้ไม่ได้ → SSO_UNAVAILABLE (ไม่ใช้ getEffectiveUser = เจ้าของสคริปต์แทน)', r.error === 'SSO_UNAVAILABLE' && !r.token, r);
const logs = sheets['Log'].rows.map(x => x.join(' '));
ok('บันทึก audit: login สำเร็จ (google) และ sso-fail', logs.some(l => /login/.test(l) && /google/.test(l)) && logs.some(l => /sso-fail/.test(l)));

console.log('== 2) role มาจากแท็บ Users ทุก request ==');
ok('whoami ได้ role + email สด', get('whoami', tBd).user.role === 'BD Mgr' && get('whoami', tBd).user.email === 'bd@mglobalsourcing.net');
urow('bd')[col('Role')] = 'Sourcing';                            // Admin เปลี่ยน role ในชีท
let q = get('quotations', tBd);
ok('เปลี่ยน role ในชีท → มีผลทันทีใน request ถัดไป (me.role = Sourcing)', q.ok && q.me.role === 'Sourcing' && q.me.caps.approve === false, q.me);
ok('สิทธิ์อนุมัติหายทันที (approve → ACCESS_DENIED)', post({ token: tBd, action: 'approve', id: 'x' }).error === 'ACCESS_DENIED');
urow('bd')[col('Role')] = 'Sales';
ok('ลดเป็น Sales → ข้อมูลกลายเป็นมุมมอง Sales ทันที (ไม่มี Detail)', get('quotations', tBd).view === 'sales');
urow('bd')[col('Role')] = 'BD Mgr';
urow('bd')[col('Active')] = 'FALSE';
r = get('quotations', tBd);
ok('ปิดบัญชีระหว่างใช้งาน → AUTH_REQUIRED reason=ACCOUNT_DISABLED', r.error === 'AUTH_REQUIRED' && r.reason === 'ACCOUNT_DISABLED', r);
urow('bd')[col('Active')] = '';
ok('session ที่ถูกเพิกถอนใช้ไม่ได้อีก แม้เปิดบัญชีคืน (ต้องล็อกอินใหม่)', get('quotations', tBd).reason === 'SESSION_EXPIRED');
ok('client ส่ง role มาเองไม่มีผล (ใช้แต่ token)', post({ token: 'x', role: 'GM', action: 'saveUsers', users: '[]' }).error === 'AUTH_REQUIRED');

ok('ไม่ส่ง token เลย → reason NO_SESSION', get('quotations', '').reason === 'NO_SESSION');
console.log('== 3) เส้นทางที่ 2: รหัสผ่าน + หมดอายุ ==');
let t = post({ action: 'login', user: 'chat@mglobalsourcing.net', passHash: H('pw123456') }).token;
ok('ล็อกอินด้วยอีเมล + รหัสผ่าน', !!t);
const S = sheets['Sessions'], sh = S.rows[0], srow = S.rows.find(x => x[sh.indexOf('Token')] === t);
srow[sh.indexOf('ExpiresMs')] = Date.now() - 1000;
r = get('quotations', t);
ok('token หมดอายุ → AUTH_REQUIRED reason=SESSION_EXPIRED (client ใช้แสดงกล่องล็อกอินต่อ)', r.error === 'AUTH_REQUIRED' && r.reason === 'SESSION_EXPIRED', r);
const t2 = post({ action: 'login', user: 'sourcing1', passHash: H('pw123456') }).token;
const s2 = S.rows.find(x => x[sh.indexOf('Token')] === t2);
s2[sh.indexOf('ExpiresMs')] = ''; s2[sh.indexOf('Expires')] = new Date(Date.now() - 5000);   // แถวรุ่นเก่า: Sheets แปลงเป็น Date เอง
ok('แถวรุ่นเก่าที่เก็บเวลาเป็น Date object ก็หมดอายุถูกต้อง', get('quotations', t2).reason === 'SESSION_EXPIRED');
for (let i = 0; i < 5; i++) post({ action: 'login', user: 'admin', passHash: H('bad' + i) });
const tA = (globalThis.__SSO_EMAIL = 'admin@mglobalsourcing.net', post({ action: 'ssoLogin' }).token);
let us = get('users', tA).users;
ok('Admin เห็นสถานะถูกล็อก (lockedMinutes)', us.find(u => u.id === 'admin').lockedMinutes > 0, us.find(u => u.id === 'admin'));
ok('Admin ยังเข้าด้วย Google ได้แม้รหัสผ่านถูกล็อก', !!tA);
ok('unlockUser ปลดล็อกโดยไม่ต้องตั้งรหัสใหม่', post({ token: tA, action: 'unlockUser', id: 'admin' }).ok && post({ action: 'login', user: 'admin', passHash: H('pw123456') }).ok);
ok('unlockUser ต้องเป็น manageUsers', post({ token: post({ action: 'login', user: 'sourcing1', passHash: H('pw123456') }).token, action: 'unlockUser', id: 'admin' }).error === 'ACCESS_DENIED');

console.log('== 4) ลิงก์เดียว: server เลือกหน้าตามอีเมล ==');
const page = (email, app) => { globalThis.__SSO_EMAIL = email; return ctx.doGet({ parameter: app ? { app } : {} }).file; };
ok('Sales เปิดลิงก์หลัก → แอป Sales', page('boss@mglobalsourcing.net') === 'Sales');
ok('Sourcing เปิดลิงก์หลัก → ระบบทำราคา', page('chat@mglobalsourcing.net') === 'Index');
ok('อีเมลไม่รู้จัก / อ่านไม่ได้ → ระบบทำราคา (มีหน้า login)', page('x@gmail.com') === 'Index' && page('') === 'Index');
ok('?app=sales บังคับแอป Sales ได้เหมือนเดิม', page('chat@mglobalsourcing.net', 'sales') === 'Sales');
ok('?app=index บังคับระบบทำราคา (Sales จะเจอหน้าแนะนำแอป Sales เอง)', page('boss@mglobalsourcing.net', 'index') === 'Index');

console.log('== 5) diag ==');
globalThis.__SSO_EMAIL = 'stranger@gmail.com';
const dg = ctx.doGet({ parameter: { diag: '1' } }).html.replace(/<[^>]+>/g, ' ');
ok('?diag=1 แสดงอีเมลที่ตรวจพบ + บอกว่ายังไม่มีในแท็บ Users + เวอร์ชัน', /stranger@gmail\.com/.test(dg) && /ยังไม่มีในแท็บ Users/.test(dg) && new RegExp('version ' + ctx.APP_VERSION.replace('.', '\\.')).test(dg) && /^\d+\.\d+$/.test(ctx.APP_VERSION));   // v5.0 (ตั้งใจ): เดิมล็อกว่าเป็น 4.x — เลขเวอร์ชันขึ้น 5.0
globalThis.__SSO_EMAIL = '';
ok('?diag=1 ตอนอ่านอีเมลไม่ได้ บอกว่าสคริปต์รันในนามใคร (ช่วยตรวจการตั้งค่า Deploy)', /owner@|admin@/.test(ctx.doGet({ parameter: { diag: '1' } }).html));
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL v4.4 BACKEND TESTS PASSED'); process.exit(fails ? 1 : 0);
