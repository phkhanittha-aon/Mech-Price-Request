const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), crypto = require('crypto');
const { makeRuntime } = require('./gasmock');
const [, , HTML, GS, OUT] = process.argv;
const { ctx, sheets } = makeRuntime(GS);
const H = s => crypto.createHash('sha256').update(s + 'mgs-internal-2025').digest('hex');
[['gm', 'General Manager', 'GM'], ['admin', 'Admin', 'Admin'], ['procurement', 'Procurement Manager', 'Procurement Mgr'],
 ['bd', 'BD Manager', 'BD Manager'], ['sourcing1', 'Chatraporn', 'Sourcing'], ['sales_non', 'NON', 'Sales'], ['sales_boss', 'BOSS', 'Sales']]
  .forEach(u => sheets['Users'].rows.push([u[0], u[1], u[2], 'all', H('1234'), '']));
const post = p => JSON.parse(ctx.apiPost(JSON.stringify(p)));
const tok = id => post({ action: 'login', user: id, passHash: H('1234') }).token;

// seed a realistic quote (as Sourcing) in Submitted
const now = new Date().toISOString(), today = now.slice(0, 10);
const mkQ = (id, no, title, gpPct) => ({ id, _v: 2, _pm: 2, _sv: 3, docType: 'QT', docNo: no, status: 'Submitted', srId: null, approvalRoles: [], approvals: [],
  releasedTo: [], auditLogs: [], globalExtras: [], createdBy: 'sourcing1', createdByName: 'Chatraporn', created: today, updated: today, updatedAt: now, rev: 1,
  stage: 'Submitted', followStatus: 'Pending', round: 1, parentId: null,
  header: { ref: no, title, customer: 'Thaibev', sales: 'BOSS', salesUserId: 'sales_boss', project: '', currency: 'THB', priceTerm: 'Special price',
    incoterm: 'CIF at MGS', exrate: 36, rates: { USD: 36, CNY: 5 }, offerDate: today, validity: 30, reqDate: today, groupType: 'Inverter' },
  lines: [{ code: 'SG110CX', desc: 'Inverter 110kW', group: 'INVERTER', comGroup: 'Inverter', uom: 'pcs', qty: 4, up: 3000, costCur: 'USD', dutyPct: 0, clearancePct: 2, opPct: gpPct, freep: 0, warranty: '10 YEAR' },
          { code: 'MNT-01', desc: 'Mounting kit', group: 'INVERTER', comGroup: 'Inverter', uom: 'set', qty: 10, up: 800, costCur: 'CNY', dutyPct: 5, clearancePct: 2, opPct: gpPct, freep: 0 }],
  remarks: ['Price valid 30 days'] });
const stok = tok('sourcing1');
[mkQ('Q1', 'QT-IN-0001', 'Thaibev Solar Rooftop', 22), mkQ('Q2', 'QT-IN-0002', 'Factory B EV', 9)].forEach(q =>
  console.log('seed', q.id, post({ token: stok, action: 'save', id: q.id, docType: 'QT', docNo: q.docNo, status: 'Submitted', salesUserId: 'sales_boss',
    title: q.header.title, customer: 'Thaibev', total: 1, cost: 1, profit: 0, gp: 0, lines: 2, detail: JSON.stringify(q), salesDetail: '{}' }).ok));

const html = fs.readFileSync(HTML, 'utf8');
const srv = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); }).listen(0);
const URL = 'http://localhost:' + srv.address().port + '/';
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && x !== undefined ? '  -> ' + String(x).slice(0, 300) : '')); if (!c) fails++; };

async function newUser(browser, id) {
  const c = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const p = await c.newPage();
  p.on('pageerror', e => { console.log('PAGEERROR[' + id + ']', e.message, e.stack); fails++; });
  await p.route('https://script.google.com/**', async route => {
    const r = route.request();
    let body;
    if (r.method() === 'POST') body = ctx.apiPost(r.postData());
    else { const u = new globalThis.URL(r.url()); const g = k => u.searchParams.get(k) || ''; body = ctx.apiGet(g('type'), g('token'), g('id') || g('since')); }
    await route.fulfill({ status: 200, contentType: 'application/json', body });
  });
  await p.goto(URL);
  await p.waitForTimeout(400);
  await p.fill('#loginUser', id); await p.fill('#loginPass', '1234'); await p.click('button:has-text("เข้าสู่ระบบ")');
  await p.waitForTimeout(1500);
  await p.evaluate(() => closeModal());   // factory-password prompt
  return p;
}
(async () => {
  const browser = await chromium.launch();
  const proc = await newUser(browser, 'procurement');
  const bd = await newUser(browser, 'bd');
  // 1) dashboard approval cards
  let txt = await proc.textContent('#content');
  ok('Procurement dashboard shows approval queue', txt.includes('รออนุมัติราคา (2)'), txt.slice(0, 200));
  ok('badge: รอฝั่ง Procurement อนุมัติ', txt.includes('รอฝั่ง Procurement อนุมัติ'));
  ok('badge: รอฝั่ง BD อนุมัติ', txt.includes('รอฝั่ง BD อนุมัติ'));
  ok('big GP% visible on cards (22% & 9%)', (await proc.textContent('.agrid')).includes('22%') && (await proc.textContent('.agrid')).includes('9%'));
  ok('BD Manager (alias role) is a manager in UI', await bd.evaluate(() => perms().approve && canSeeCost(CURRENT) && CURRENT.role === 'BD Mgr'));
  await proc.screenshot({ path: OUT + '/1_dashboard_procurement.png', fullPage: false });

  // 2) Procurement approves from the card; BD must see it via auto-poll (no manual sync)
  await proc.click('.acard:has-text("QT-IN-0001") .ac-btn');
  await proc.waitForTimeout(800);
  ok('Procurement approve → Partial Approved locally', await proc.evaluate(() => statusOf(QUOTES.find(q => q.id === 'Q1')) === 'Partial Approved'));
  ok('BD still stale before poll', await bd.evaluate(() => statusOf(QUOTES.find(q => q.id === 'Q1')) === 'Submitted'));
  console.log('… waiting for 30s auto-poll on BD dashboard');
  await bd.waitForTimeout(+process.env.POLLWAIT||31500);
  ok('BD dashboard auto-updated (no sync click) → Partial Approved', await bd.evaluate(() => statusOf(QUOTES.find(q => q.id === 'Q1')) === 'Partial Approved'));
  txt = await bd.textContent('#content');
  ok('BD card shows ✓ Procurement อนุมัติแล้ว', txt.includes('Procurement อนุมัติแล้ว'));
  ok('live pill shows', (await bd.textContent('#liveTxt')).includes('Live'));
  await bd.screenshot({ path: OUT + '/2_dashboard_bd_after_poll.png' });

  // 3) BD approves from preview → Approved, both approvals kept
  await bd.evaluate(() => openQuote('Q1')); await bd.waitForTimeout(600);
  await bd.click('button:has-text("อนุมัติในนาม")'); await bd.waitForTimeout(800);
  ok('BD approve → Approved with BOTH roles', await bd.evaluate(() => { const q = QUOTES.find(q => q.id === 'Q1'); return q.status === 'Approved' && q.approvalRoles.join() === 'Procurement Mgr,BD Mgr'; }));

  // 4) Sourcing: internal view after approval + cost structure columns
  const src = await newUser(browser, 'sourcing1');
  await src.evaluate(() => openQuote('Q1')); await src.waitForTimeout(800);
  txt = await src.textContent('#content');
  ok('Sourcing (Approved) can still use internal view', txt.includes('ภายใน (มี %GP)'));
  ok('preview shows cost/unit + profit/unit columns', txt.includes('ต้นทุน/หน่วย') && txt.includes('กำไร/หน่วย'));
  ok('preview background refresh indicator', (await src.textContent('#qLive')).length > 0);
  await src.screenshot({ path: OUT + '/3_preview_sourcing_internal.png', fullPage: true });

  // 5) Pricing grid + live summary bar
  await src.evaluate(() => editQuote('Q2')); await src.waitForTimeout(800);
  ok('grid has 4 zone headers', (await src.$$('.cost-table tr.zone-row th')).length === 5);
  const before = await src.textContent('#liveBar .lb-pct b');
  await src.fill('#op_0', '30'); await src.waitForTimeout(150);
  const after = await src.textContent('#liveBar .lb-pct b');
  ok('live bar %GP updates while typing (' + before + ' → ' + after + ')', before !== after);
  ok('profit/unit cell updates while typing', (await src.textContent('#opu_0')) !== '0.00');
  await src.screenshot({ path: OUT + '/4_costing_grid.png', fullPage: false });
  await src.evaluate(() => window.scrollTo(0, 99999)); await src.waitForTimeout(200);
  await src.screenshot({ path: OUT + '/4b_costing_livebar.png', fullPage: false });

  // 6) Conflict: GM edits Q2 on the cloud while Sourcing has unsaved edits open
  const gmt = tok('gm');
  const cur = JSON.parse(ctx.apiGet('quote', gmt, 'Q2')).quote;
  const d = JSON.parse(cur.detail); d.header.title = 'Factory B EV (GM edit)';
  await new Promise(r => setTimeout(r, 20));
  console.log('GM cloud save', post({ token: gmt, action: 'save', id: 'Q2', docNo: 'QT-IN-0002', status: 'Submitted', salesUserId: 'sales_boss', detail: JSON.stringify(d), baseUpdatedAt: cur.updatedAt }).ok);
  await src.evaluate(() => liveTick()); await src.waitForTimeout(800);   // same call the 30s interval makes
  ok('editor shows conflict warning banner', (await src.textContent('#conflictBanner')).includes('ข้อมูลบน Cloud มีการเปลี่ยนแปลง'));
  await src.evaluate(() => window.scrollTo(0, 0));
  await src.screenshot({ path: OUT + '/5_conflict_banner.png' });
  await src.evaluate(() => saveQuote('Submitted')); await src.waitForTimeout(400);
  if (await src.$('button:has-text("บันทึกต่อไป")')) { await src.click('button:has-text("บันทึกต่อไป")'); }
  await src.waitForTimeout(900);
  const modalTxt = await src.textContent('#modalRoot');
  ok('save is rejected with conflict modal (no silent overwrite)', modalTxt.includes('ถูกแก้ไขโดยคนอื่น') && modalTxt.includes('General Manager'), modalTxt.slice(0, 200));
  ok('GM title still on cloud', JSON.parse(JSON.parse(ctx.apiGet('quote', gmt, 'Q2')).quote.detail).header.title.includes('GM edit'));
  await src.screenshot({ path: OUT + '/6_conflict_modal.png' });
  await src.click('button:has-text("ใช้เวอร์ชันบน Cloud")'); await src.waitForTimeout(800);
  ok('resolve → local copy is cloud version', await src.evaluate(() => QUOTES.find(q => q.id === 'Q2').header.title.includes('GM edit') && QUOTES.find(q => q.id === 'Q2').isSynced));

  // 7) self-test (includes legacy status/pricing migration)
  const st = await src.evaluate(() => { const r = runSelfTest(); closeModal(); return r.passed + '/' + r.total; });
  ok('runSelfTest ' + st, st === '6/6');
  const mig = await src.evaluate(() => ['Costing', 'Sent', 'Lost', 'Delivered', 'Done', 'Approved', 'xyz'].map(s => migrateQuote({ id: 'm' + s, docType: 'QT', status: s, header: { salesUserId: 'u1', currency: 'THB' }, lines: [] }).status).join());
  ok('legacy status migration map', mig === 'In Progress,Pending,Closed,Won,Won,Approved,In Progress', mig);
  const mig2 = await src.evaluate(() => { const q = migrateQuote({ id: 'lg', stage: 'Approved', followStatus: 'Pending', header: { salesUserId: 'u1', currency: 'THB' }, lines: [] }); return q.status + '|' + q.docType + '|' + q.approvalRoles.length; });
  ok('stage-only legacy record → Approved QT with 2 approvals', mig2 === 'Approved|QT|2', mig2);

  // 8) Admin: sees prices + manager nav
  const adm = await newUser(browser, 'gm');      // pull users first (admin not in default local list)
  await adm.evaluate(() => logout());
  await adm.fill('#loginUser', 'admin'); await adm.fill('#loginPass', '1234'); await adm.click('button:has-text("เข้าสู่ระบบ")');
  await adm.waitForTimeout(1500); await adm.evaluate(() => closeModal());
  ok('Admin can see price of every quote/status', await adm.evaluate(() => CURRENT.role === 'Admin' && QUOTES.filter(q => !q.deleted).every(q => canSeePrice(q)) && perms().margin));
  ok('Admin nav has สรุปยอดขาย/GP', (await adm.textContent('#nav')).includes('สรุปยอดขาย'));

  // 9) offline queue keeps working after session expiry: token is not baked into the queued payload
  const qtoken = await src.evaluate(() => { enqueueSync({ action: 'ping' }); const it = getQueue().slice(-1)[0]; return it.payload.token || ''; });
  ok('queued payload has no stale token baked in', qtoken === '');

  console.log(fails ? '\n' + fails + ' E2E FAILED' : '\nALL E2E TESTS PASSED');
  await browser.close(); srv.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
