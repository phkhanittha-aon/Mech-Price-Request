// ออดิตบนหน้าจอจริง (playwright + server จำลอง) — ทีละ role · ข้อมูลจำลองเท่านั้น · ห้าม deploy ไฟล์นี้
// รัน: NODE_PATH=$(npm root -g) node audit/audit_browser.js $PWD [out-dir]
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const [, , DIR, OUT0] = process.argv;
const OUT = OUT0 || path.join(DIR, 'audit/out');
fs.mkdirSync(OUT, { recursive: true });
const { makeRuntime } = require(path.join(DIR, 'tests/gasmock.js'));
const { ctx, sheets } = makeRuntime(DIR + '/Code.gs');
const H = s => crypto.createHash('sha256').update(s + 'mgs-internal-2025').digest('hex');
const U = sheets['Users'], uh = U.rows[0];
const USERS = [['boss', 'BOSS', 'Sales', 'boss@m.co'], ['sales_non', 'NON', 'Sales', 'non@m.co'], ['smgr', 'SalesMgr', 'Sales Manager', 'smgr@m.co'],
  ['src', 'Chatraporn', 'Sourcing', 'src@m.co'], ['pm', 'Procure', 'Procurement Mgr', 'pm@m.co'], ['bd', 'BD', 'BD Mgr', 'bd@m.co'], ['gm', 'GM', 'GM', 'gm@m.co'], ['adm', 'Admin', 'Admin', 'adm@m.co']];
USERS.forEach(([id, n, r, e]) => { const x = []; x[uh.indexOf('Id')] = id; x[uh.indexOf('Name')] = n; x[uh.indexOf('Role')] = r; x[uh.indexOf('Scope')] = 'all'; x[uh.indexOf('PassHash')] = H('pw123456'); x[uh.indexOf('Email')] = e; U.rows.push(x); });
const post = p => JSON.parse(ctx.apiPost(JSON.stringify(p)));
const tok = u => post({ action: 'login', user: u, passHash: H('pw123456') }).token;

// ข้อมูลจำลอง: SR ที่มี payload XSS ในช่องข้อความ + QT ที่ปล่อยราคาแล้ว
const XSS = '<img src=x onerror="window.__xss=(window.__xss||0)+1">';
post({ token: tok('boss'), action: 'saveSR', id: 'XSR', status: 'Submitted', detail: JSON.stringify({ header: { title: 'T ' + XSS, customer: 'C ' + XSS, project: XSS, groupType: 'Inverter', note: XSS }, lines: [{ desc: 'D ' + XSS, qty: 1 }] }) });
const XSS2 = '<img src=x onerror="window.__xss2=(window.__xss2||0)+1">';
const R_pre = {};
R_pre.needBy = post({ token: tok('boss'), action: 'saveSR', id: 'XSR2', status: 'Submitted', detail: JSON.stringify({ header: { title: 'Needby test', customer: 'CP', groupType: 'Inverter', needBy: XSS2, reqDate: '"><img src=x onerror="window.__xss3=1">', offerDate: XSS2 }, lines: [{ desc: 'a', qty: 1 }] }) });
const EVIL_ID = "x');window.__xss4=1;('";
R_pre.evilId = post({ token: tok('boss'), action: 'saveSR', id: EVIL_ID, status: 'Submitted', detail: JSON.stringify({ header: { title: 'EvilId', customer: 'CP', groupType: 'Inverter' }, lines: [{ desc: 'a', qty: 1 }] }) });
const qd = { id: 'Q1', _v: 2, _pm: 2, _sv: 3, docType: 'QT', docNo: 'QT-IN-2610-001', status: 'Pending', releasedTo: ['boss'], approvalRoles: ['Procurement Mgr', 'BD Mgr'], approvals: [],
  header: { ref: 'QT-IN-2610-001', title: 'Rooftop ' + XSS, customer: 'CP ' + XSS, salesUserId: 'boss', sales: 'BOSS', currency: 'THB', groupType: 'Inverter', rates: { USD: 36, CNY: 5 }, validity: 30 },
  lines: [{ code: 'SG110CX', desc: 'Inverter ' + XSS, group: 'INVERTER', qty: 2, uom: 'pcs', up: 3000, costCur: 'USD', opPct: 20 }], remarks: [XSS], auditLogs: [] };
const sd = { id: 'Q1', docType: 'QT', docNo: 'QT-IN-2610-001', status: 'Pending', releasedTo: ['boss'], header: { title: qd.header.title, customer: qd.header.customer, salesUserId: 'boss', sales: 'BOSS', currency: 'THB', groupType: 'Inverter', validity: 30 },
  lines: [{ code: 'SG110CX', desc: 'Inverter ' + XSS, qty: 2, uom: 'pcs', unitPrice: 135000, amount: 270000 }], total: 270000, remarks: [XSS] };
post({ token: tok('src'), action: 'save', id: 'Q1', docType: 'QT', docNo: 'QT-IN-2610-001', status: 'Pending', salesUserId: 'boss', releasedTo: 'boss', title: qd.header.title, customer: qd.header.customer, total: 270000, gp: 20, detail: JSON.stringify(qd), salesDetail: JSON.stringify(sd) });

const files = { '/': fs.readFileSync(DIR + '/Index.html', 'utf8'), '/sales': fs.readFileSync(DIR + '/Sales.html', 'utf8') };
const srv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(files[q.url.split('?')[0].split('#')[0]] || files['/']); }).listen(0);
const BASE = 'http://localhost:' + srv.address().port;
const R = { roles: {}, xss: {}, sales: {}, expiry: {}, size: {} };
const COST = /"(up|costCur|dutyPct|clearancePct|opPct|freep|cost|profit|gp|margin|exrate|rates|auditLogs|approvalRoles|commission)"\s*:/;

async function open(b, url, vp, errs) {
  const c = await b.newContext({ viewport: vp || { width: 1366, height: 900 } }); const p = await c.newPage();
  const net = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.route('https://script.google.com/**', async rt => { const r = rt.request(); let out;
    if (r.method() === 'POST') out = ctx.apiPost(r.postData()); else { const q = new URL(r.url()); const g = k => q.searchParams.get(k) || ''; out = ctx.apiGet(g('type'), g('token'), g('id') || g('since')); }
    net.push(out); await rt.fulfill({ status: 200, contentType: 'application/json', body: out }); });
  await p.goto(BASE + url); await p.waitForTimeout(300);
  p._net = net; return p;
}

(async () => {
  const b = await chromium.launch();
  console.log('== A) Index.html ทีละ role: หน้าแรก · เมนู · ทุก route ==');
  for (const [id, , role] of USERS) {
    const errs = [];
    const p = await open(b, '/?app=index', null, errs);
    await p.fill('#loginUser', id); await p.fill('#loginPass', 'pw123456'); await p.click('button:has-text("เข้าสู่ระบบ →")'); await p.waitForTimeout(1800);
    const st = await p.evaluate(() => ({ cur: !!CURRENT, route: typeof route !== 'undefined' ? route : '', nav: [...document.querySelectorAll('#nav .nav-item span:first-of-type')].map(s => s.textContent.trim()),
      caps: typeof ROUTE_CAPS !== 'undefined' ? Object.keys(ROUTE_CAPS) : [], body: document.body.innerText.slice(0, 160) }));
    const routes = {};
    if (st.cur) for (const r of st.caps) {
      const res = await p.evaluate(r => { try { go(r); } catch (e) { return 'ERR ' + e.message; } const t = document.querySelector('#content') ? document.querySelector('#content').innerText : '';
        return /Access Restricted|ไม่มีสิทธิ์/.test(t) ? 'DENIED' : (t.trim() ? 'OPEN' : 'EMPTY'); }, r);
      routes[r] = res; await p.waitForTimeout(80);
    }
    if (st.cur) { await p.evaluate(() => go('dashboard')); await p.waitForTimeout(200); await p.screenshot({ path: OUT + '/idx_' + id + '.png' }); }
    const lsCost = await p.evaluate(() => Object.keys(localStorage).map(k => [k, (localStorage.getItem(k) || '').length]));
    R.roles[id] = { role, loggedIn: st.cur, landing: st.route, nav: st.nav, routes, pageErrors: errs.slice(0, 5), xssFired: await p.evaluate(() => window.__xss || 0), localStorage: lsCost, bodyIfNoLogin: st.cur ? '' : st.body };
    console.log(`  ${id.padEnd(9)} ${role.padEnd(16)} login=${st.cur} หน้าแรก=${st.route} เมนู=[${st.nav.join(', ')}]`);
    if (st.cur) console.log('            routes: ' + Object.entries(routes).map(([k, v]) => k + ':' + v).join(' '));
    if (!st.cur) console.log('            ' + st.body.replace(/\s+/g, ' ').slice(0, 140));
    if (errs.length) console.log('            ⚠ JS error: ' + errs.slice(0, 3).join(' | '));
    await p.context().close();
  }

  console.log('\n== B) XSS — เปิดใบที่มี <img onerror> ในทุกช่องข้อความ ==');
  {
    const errs = []; const p = await open(b, '/?app=index', null, errs);
    await p.fill('#loginUser', 'src'); await p.fill('#loginPass', 'pw123456'); await p.click('button:has-text("เข้าสู่ระบบ →")'); await p.waitForTimeout(1800);
    const seen = {};
    for (const r of ['dashboard', 'srqueue', 'quotes', 'followup', 'salesupdate', 'approvals']) { await p.evaluate(r => { try { go(r); } catch (e) {} }, r); await p.waitForTimeout(250); seen[r] = await p.evaluate(() => window.__xss || 0); }
    await p.evaluate(() => { try { const q = QUOTES.find(x => x.id === 'Q1'); if (q) { editQuote('Q1'); } } catch (e) {} }); await p.waitForTimeout(400);
    seen.editQT = await p.evaluate(() => window.__xss || 0);
    await p.evaluate(() => { try { openQuote('XSR'); } catch (e) {} }); await p.waitForTimeout(300);
    seen.openSR = await p.evaluate(() => window.__xss || 0);
    await p.evaluate(() => { try { openQuote('Q1'); } catch (e) {} }); await p.waitForTimeout(400);
    seen.preview = await p.evaluate(() => window.__xss || 0);
    await p.evaluate(() => go('srqueue')); await p.waitForTimeout(300);
    seen.needBy_in_srqueue = await p.evaluate(() => window.__xss2 || 0);
    const evil = p.locator('#content td:has-text("EvilId")').first();
    if (await evil.count()) { await evil.click(); await p.waitForTimeout(300); }
    seen.evilId_click = await p.evaluate(() => window.__xss4 || 0);
    await p.evaluate(() => { try { openQuote('XSR2'); } catch (e) {} }); await p.waitForTimeout(300);
    seen.offerDate_in_preview = await p.evaluate(() => window.__xss2 || 0);
    await p.evaluate(() => { try { createQTFromSR('XSR2'); } catch (e) {} }); await p.waitForTimeout(500);
    seen.reqDate_in_editor = await p.evaluate(() => window.__xss3 || 0);
    seen.serverAccepted = { needBy: R_pre.needBy.ok, evilId: R_pre.evilId.ok };
    R.xss.index = seen; console.log('  Index (Sourcing):', JSON.stringify(seen));
    await p.context().close();
    const e2 = []; const s = await open(b, '/sales', { width: 390, height: 844 }, e2);
    await s.fill('#loginUser', 'boss'); await s.fill('#loginPass', 'pw123456'); await s.click('#loginBtn'); await s.waitForTimeout(1500);
    const s1 = await s.evaluate(() => window.__xss || 0);
    const btn = s.locator('button:has-text("ดูราคา")').first(); if (await btn.count()) { await btn.click(); await s.waitForTimeout(400); }
    const s2 = await s.evaluate(() => window.__xss || 0);
    R.xss.sales = { list: s1, detail: s2, pageErrors: e2 }; console.log('  Sales (BOSS):', JSON.stringify(R.xss.sales));
    await s.screenshot({ path: OUT + '/sales_boss_xss.png', fullPage: true });

    console.log('\n== C) Sales มือถือ: payload / localStorage / ขนาด ==');
    const allNet = s._net.join('\n');
    const lsAll = await s.evaluate(() => JSON.stringify(localStorage));
    R.sales = { netHasCost: COST.test(allNet), lsHasCost: COST.test(lsAll), lsKeys: await s.evaluate(() => Object.keys(localStorage)), lsBytes: lsAll.length,
      overflowX: await s.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), text: (await s.textContent('body')).replace(/\s+/g, ' ').slice(0, 200) };
    console.log('  payload มีคีย์ต้นทุน:', R.sales.netHasCost, '· localStorage มีคีย์ต้นทุน:', R.sales.lsHasCost, '· keys:', R.sales.lsKeys.join(','), '· ล้นจอ:', R.sales.overflowX);

    console.log('\n== D) token หมดอายุระหว่างใช้งาน ==');
    const SS = sheets['Sessions'], sh = SS.rows[0];
    SS.rows.slice(1).forEach(r => { if (r[sh.indexOf('UserId')] === 'boss') { if (sh.indexOf('ExpiresMs') >= 0) r[sh.indexOf('ExpiresMs')] = Date.now() - 1000; if (sh.indexOf('Expires') >= 0) r[sh.indexOf('Expires')] = new Date(Date.now() - 1000).toISOString(); } });
    await s.evaluate(() => { try { loadAll(); } catch (e) {} }); await s.waitForTimeout(1500);
    const modal = (await s.evaluate(() => { const m = document.querySelector('#modalRoot'); return (m && m.innerText.trim()) ? 'MODAL: ' + m.innerText : 'NO-MODAL: ' + document.body.innerText; })).replace(/\s+/g, ' ');
    R.expiry.sales = { prompt: /^MODAL/.test(modal) && /หมดอายุ|ยืนยันตัวตน/.test(modal), text: modal.slice(0, 160) };
    console.log('  Sales เห็นข้อความให้ยืนยันตัวตนใหม่:', R.expiry.sales.prompt, '·', R.expiry.sales.text.slice(0, 100));
    await s.context().close();
  }

  console.log('\n== E) ขนาดไฟล์หน้าเว็บ ==');
  for (const f of ['Index.html', 'Sales.html', 'Code.gs', 'Lark.gs']) { const t = fs.readFileSync(path.join(DIR, f), 'utf8'); R.size[f] = { bytes: Buffer.byteLength(t), lines: t.split('\n').length }; console.log(`  ${f.padEnd(11)} ${(R.size[f].bytes / 1024).toFixed(0)} KB · ${R.size[f].lines} บรรทัด`); }
  const idx = files['/'];
  for (const k of ['CATALOG', 'LOGO', 'EXCEL_LEGACY_LINES']) { const m = idx.match(new RegExp('(?:const|let|var)\\s+' + k + '\\s*=([\\s\\S]*?)\\n')); R.size['blob_' + k] = m ? m[1].length : 0; console.log(`  blob ${k}: ${m ? (m[1].length / 1024).toFixed(0) + ' KB' : 'ไม่พบ'}`); }

  fs.writeFileSync(path.join(OUT, 'browser_results.json'), JSON.stringify(R, null, 1));
  console.log('\nบันทึกผล: ' + path.join(OUT, 'browser_results.json'));
  await b.close(); srv.close();
})().catch(e => { console.log('CRASH', e && e.stack); process.exit(1); });
