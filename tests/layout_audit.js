// Phase 3 — วัด layout ทุกหน้า ทุกความกว้างจอ   รัน: NODE_PATH=$(npm root -g) node tests/layout_audit.js $PWD /tmp/out   (ห้าม deploy)
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), crypto = require('crypto');
const { makeRuntime } = require('./gasmock'); const [, , DIR, OUT] = process.argv;
const { ctx, sheets } = makeRuntime(DIR + '/Code.gs');
const H = s => crypto.createHash('sha256').update(s + 'mgs-internal-2025').digest('hex');
const U = sheets['Users'], h = U.rows[0], c = n => h.indexOf(n);
[['gm', 'General Manager', 'GM'], ['sourcing1', 'Chatraporn', 'Sourcing']].forEach(([id, n, r]) => { const x = []; x[c('Id')] = id; x[c('Name')] = n; x[c('Role')] = r; x[c('Scope')] = 'all'; x[c('PassHash')] = H('pw123456'); x[c('Email')] = id + '@m.co'; U.rows.push(x); });
const post = p => JSON.parse(ctx.apiPost(JSON.stringify(p)));
const tS = post({ action: 'login', user: 'sourcing1', passHash: H('pw123456') }).token;
for (let k = 1; k <= 8; k++) {
  const q = { id: 'Q' + k, _v: 2, _pm: 2, _sv: 3, docType: k === 8 ? 'SR' : 'QT', docNo: 'QT-IN-2610-00' + k, status: ['In Progress', 'Submitted', 'Approved', 'Pending', 'Won', 'Partial Approved', 'Closed', 'Submitted'][k - 1], approvalRoles: [], approvals: [], releasedTo: [], auditLogs: [], globalExtras: [{ label: 'ค่าขนส่งรวม', amount: 12000, cur: 'THB' }], round: 1,
    header: { ref: 'P.IN2026' + k, title: 'Thaibev Solar Rooftop Phase ' + k + ' — Warehouse B (long project name for wrapping)', customer: 'Thai Beverage Public Company Limited', sales: 'BOSS', salesUserId: 'sales_boss', currency: k % 3 ? 'THB' : 'USD', priceTerm: 'Special price', incoterm: 'CIF at MGS', exrate: 36, rates: { USD: 36, CNY: 5 }, offerDate: '2026-10-09', validity: 30, groupType: 'Inverter', needBy: '2026-10-20' },
    lines: Array.from({ length: 14 }, (_, i) => ({ code: 'SG' + (110 + i) + 'CX-P2', desc: 'Sungrow string inverter ' + (110 + i) + 'kW, 3-phase, IP66, with WiFi dongle', group: 'INVERTER', comGroup: 'Inverter', uom: 'pcs', qty: 12 + i, up: 3456.78 + i, costCur: i % 2 ? 'USD' : 'CNY', dutyPct: 5, clearancePct: 2, opPct: 18.5, freep: 250, targetUp: i % 3 ? 0 : 150000 })), remarks: ['Price valid 30 days'] };
  post({ token: tS, action: 'save', id: q.id, docType: q.docType, docNo: q.docNo, status: q.status, salesUserId: 'sales_boss', currency: q.header.currency, total: 1e6, detail: JSON.stringify(q), salesDetail: '{}' });
}
const html = fs.readFileSync(DIR + '/Index.html', 'utf8');
const srv = http.createServer((a, b) => { b.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); b.end(html); }).listen(0);
(async () => {
  const b = await chromium.launch(); const issues = [];
  for (const who of ['sourcing1', 'gm']) for (const w of [1024, 1280, 1440, 1920, 390]) {
    const p = await (await b.newContext({ viewport: { width: w, height: 900 } })).newPage();
    await p.route('https://script.google.com/**', async rt => { const r = rt.request(); let body; if (r.method() === 'POST') body = ctx.apiPost(r.postData()); else { const u = new URL(r.url()); const g = k => u.searchParams.get(k) || ''; body = ctx.apiGet(g('type'), g('token'), g('id') || g('since')); } await rt.fulfill({ status: 200, contentType: 'application/json', body }); });
    await p.goto('http://localhost:' + srv.address().port + '/'); await p.waitForTimeout(400);
    await p.fill('#loginUser', who); await p.fill('#loginPass', 'pw123456'); await p.click('button:has-text("เข้าสู่ระบบ →")'); await p.waitForTimeout(2200);
    const routes = await p.evaluate(() => NAV.filter(n => n.id && routeAllowed(n.id)).map(n => n.id).concat(['preview']));
    for (const r of routes) {
      await p.evaluate(r => { closeModal(); if (r === 'new') editQuote('Q2'); else if (r === 'preview') openQuote('Q2'); else go(r, true); }, r); await p.waitForTimeout(r === 'new' ? 700 : 300);
      const m = await p.evaluate(() => {
        const out = { page: document.documentElement.scrollWidth - innerWidth, inner: [], off: [] };
        if (out.page > 1) document.querySelectorAll('#content *').forEach(e => { const r = e.getBoundingClientRect(); if (r.right > innerWidth + 1 && r.width && ![...e.children].some(k => k.getBoundingClientRect().right > innerWidth + 1) && !e.closest('.tw,.lines-desktop,.kanban')) out.off.push((e.tagName + '.' + (e.className || '').toString().split(' ')[0] + '#' + (e.id || '') + ' ' + (e.textContent || '').trim().slice(0, 30)) + ' r=' + Math.round(r.right)); });
        document.querySelectorAll('#content table').forEach(t => { const box = t.parentElement; if (t.offsetWidth > box.clientWidth + 2) out.inner.push(t.className || 'table'); });
        // แถวของฟอร์มข้อมูลโครงการ: ช่องกรอกในแถวเดียวกันต้องสูงเท่ากันและบรรทัดเดียวกัน
        const g = document.querySelector('#content .card .fgrid') || document.querySelector('#content .card .grid'); out.formRows = 0; out.misaligned = 0;
        if (g && document.querySelector('#lineTW')) {
          const rows = {}; [...g.children].forEach(cell => { const inp = cell.querySelector('.inp'); if (!inp) return; const top = Math.round(cell.getBoundingClientRect().top); (rows[top] = rows[top] || []).push(inp.getBoundingClientRect()); });
          Object.values(rows).forEach(list => { out.formRows++; const tops = list.map(x => Math.round(x.top)), hs = list.map(x => Math.round(x.height)); if (Math.max(...tops) - Math.min(...tops) > 2 || Math.max(...hs) - Math.min(...hs) > 2) out.misaligned++; });
          const th = document.querySelector('.cost-table thead th'); out.stickyHead = th ? getComputedStyle(th).position : '';
          out.contentW = Math.round(document.getElementById('content').getBoundingClientRect().width);
        }
        return out;
      });
      const bad = [];
      if (m.page > 1) bad.push('PAGE-HSCROLL +' + m.page + 'px  ⟵ ' + [...new Set(m.off)].slice(0, 6).join(' | '));
      if (m.inner.length) bad.push('table wider than box: ' + [...new Set(m.inner)].join(','));
      if (m.misaligned) bad.push(`form rows misaligned ${m.misaligned}/${m.formRows}`);
      if (r === 'new') bad.push(`[info] thead position=${m.stickyHead} content=${m.contentW}px`);
      if (bad.length) issues.push(`${who.padEnd(9)} ${String(w).padEnd(4)} ${r.padEnd(12)} ${bad.join(' · ')}`);
      if (r === 'new' && who === 'sourcing1' && OUT) await p.screenshot({ path: `${OUT}/layout_new_${w}.png`, fullPage: w === 390 });
      if (r === 'new' && w !== 390) {        // หัวตารางต้องติดอยู่เมื่อเลื่อนตารางลง + คอลัมน์สินค้าติดซ้ายเมื่อเลื่อนขวา
        const st = await p.evaluate(() => { const box = document.querySelector('.lines-desktop'); const th = document.querySelector('.cost-table thead tr:not(.zone-row) th'); const z = document.querySelector('.cost-table thead tr.zone-row th');
          const t0 = th.getBoundingClientRect().top; box.scrollTop = 400; box.scrollLeft = 300; const t1 = th.getBoundingClientRect().top; const td = document.querySelector('.cost-table tbody td');
          return { moved: Math.abs(t1 - t0), scrolled: box.scrollTop, gap: Math.round(th.getBoundingClientRect().top - z.getBoundingClientRect().bottom), pinLeft: Math.round(td.getBoundingClientRect().left - box.getBoundingClientRect().left) }; });
        if (st.scrolled > 0 && st.moved > 1) issues.push(`${who} ${w} new thead NOT sticky (moved ${st.moved}px)`);
        if (Math.abs(st.gap) > 1) issues.push(`${who} ${w} new header rows gap ${st.gap}px`);
        if (Math.abs(st.pinLeft) > 2) issues.push(`${who} ${w} new first column NOT pinned (${st.pinLeft}px)`);
        if (who === 'sourcing1') issues.push(`[info] ${w} sticky ok? scrolled=${st.scrolled} moved=${st.moved} gap=${st.gap} pin=${st.pinLeft}`);
      }
      if (r === 'new' && w === 390) {       // มือถือ: แถวย่อ → แตะ → แผ่นแก้ไข → แก้ %GP → ยอดในแถวย่อเปลี่ยน
        const before = await p.textContent('#mlt_0');
        await p.click('#mrow_0'); await p.waitForTimeout(150);
        const open = await p.isVisible('.lsheet'); await p.fill('#mop_0', '40'); await p.waitForTimeout(80);
        const sw = await p.evaluate(() => document.querySelector('.lsheet').scrollWidth - document.querySelector('.lsheet').clientWidth);
        if (who === 'sourcing1' && OUT) await p.screenshot({ path: `${OUT}/layout_sheet_390.png` });
        await p.click('.lsheet .sh-f .btn:has-text("เสร็จ")'); await p.waitForTimeout(100);
        const after = await p.textContent('#mlt_0'); const closed = !(await p.isVisible('.lsheet'));
        const kept = await p.evaluate(() => editing.lines[0].opPct);
        if (!open || !closed || before === after || kept !== 40 || sw > 1) issues.push(`${who} 390 sheet FAIL open=${open} closed=${closed} ${before}->${after} opPct=${kept} sheetHscroll=${sw}`);
        else issues.push(`[info] ${who} 390 sheet ok ${before} -> ${after}`);
      }
    }
    await p.context().close();
  }
  console.log(issues.join('\n') || 'no issues'); await b.close(); srv.close();
})();
