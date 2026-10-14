// ออดิตฝั่ง server — เดินแทนผู้ใช้จริงทีละ role ด้วยข้อมูลจำลอง (ไม่แตะชีทจริง · ห้าม deploy ไฟล์นี้)
// รัน: node audit/audit_server.js $PWD   → พิมพ์ผล + เขียน audit/out/server_results.json
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const DIR = process.argv[2] || '.';
const { makeRuntime } = require(path.join(DIR, 'tests/gasmock.js'));
const { seedSave } = require(path.join(DIR, 'tests/seed.js'));   // v5.9: ใบที่อนุมัติ/ปล่อยแล้ว = ข้อมูลตั้งต้นในชีท (save ตั้งสถานะเหล่านี้ไม่ได้แล้ว)
const H = s => crypto.createHash('sha256').update(s + 'mgs-internal-2025').digest('hex');
const R = { matrix: {}, leaks: [], loop: [], bypass: [], idem: [], conc: [], auth: [], auditTrail: [], keys: [], config: [], growth: {} };
const log = (...a) => console.log(...a);

function world() {
  const rt = makeRuntime(path.join(DIR, 'Code.gs')), { ctx, sheets, props } = rt;
  const U = sheets['Users'], uh = U.rows[0], c = n => uh.indexOf(n);
  [['boss', 'BOSS', 'Sales', 'boss@m.co'], ['pair', 'PAIR', 'Sales', 'pair@m.co'], ['sales_non', 'NON', 'Sales', 'non@m.co'],
   ['smgr', 'SalesMgr', 'Sales Manager', 'smgr@m.co'], ['src', 'Chatraporn', 'Sourcing', 'src@m.co'], ['src2', 'Napasorn', 'Sourcing', 'src2@m.co'],
   ['pm', 'Procure', 'Procurement Mgr', 'pm@m.co'], ['bd', 'BD', 'BD Mgr', 'bd@m.co'], ['gm', 'GM', 'GM', 'gm@m.co'], ['adm', 'Admin', 'Admin', 'adm@m.co']]
    .forEach(([id, n, r, e]) => { const x = []; x[c('Id')] = id; x[c('Name')] = n; x[c('Role')] = r; x[c('Scope')] = 'all'; x[c('PassHash')] = H('pw123456'); x[c('Email')] = e; U.rows.push(x); });
  const post = p => JSON.parse(ctx.apiPost(JSON.stringify(p)));
  const get = (t, tok, a) => JSON.parse(ctx.apiGet(t, tok, a || ''));
  const T = {}; ['boss', 'pair', 'sales_non', 'smgr', 'src', 'src2', 'pm', 'bd', 'gm', 'adm'].forEach(u => { T[u] = post({ action: 'login', user: u, passHash: H('pw123456') }).token; });
  const QS = sheets['Quotations'], qh = QS.rows[0];
  const rowOf = id => QS.rows.find(x => x[qh.indexOf('Id')] === id);
  const col = (id, h) => { const r = rowOf(id); return r ? r[qh.indexOf(h)] : undefined; };
  const det = id => JSON.parse(col(id, 'Detail') || '{}');
  const seed = (id, status, extra, dextra) => seedSave(sheets, Object.assign({ id, docType: 'QT', docNo: 'QT-' + id, status, salesUserId: 'boss', sales: 'BOSS', title: 'Proj ' + id, customer: 'CP Group',
    releasedTo: ['Pending', 'Won'].includes(status) ? 'boss' : '', detail: qtDetail(id, status, Object.assign({ approvalRoles: ['Procurement Mgr', 'BD Mgr'], releasedTo: ['Pending', 'Won'].includes(status) ? ['boss'] : [] }, dextra || {})),
    salesDetail: JSON.stringify({ id, status, lines: [{ code: 'SG110CX', qty: 2, unitPrice: 22500, amount: 45000 }], total: 45000 }) }, extra || {}));
  return Object.assign(rt, { post, get, T, QS, qh, rowOf, col, det, seed });
}
const qtDetail = (id, status, extra) => JSON.stringify(Object.assign({ id, _v: 2, _pm: 2, _sv: 3, docType: 'QT', docNo: 'QT-' + id, status, round: 1, approvalRoles: [], approvals: [], releasedTo: [],
  header: { ref: 'QT-' + id, title: 'Proj ' + id, customer: 'CP Group', salesUserId: 'boss', sales: 'BOSS', currency: 'THB', groupType: 'Inverter', rates: { USD: 36, CNY: 5 } },
  lines: [{ code: 'SG110CX', desc: 'Inverter', group: 'INVERTER', qty: 2, uom: 'pcs', up: 1000, costCur: 'USD', dutyPct: 5, clearancePct: 2, opPct: 20, freep: 0 }], remarks: [], auditLogs: [], globalExtras: [] }, extra || {}));
const saveQT = (W, tok, id, status, extra, dextra) => W.post(Object.assign({ token: tok, action: 'save', id, docType: 'QT', docNo: 'QT-' + id, title: 'Proj ' + id, customer: 'CP Group', sales: 'BOSS', salesUserId: 'boss',
  status, total: 45000, cost: 36000, profit: 9000, gp: 20, round: 1, detail: qtDetail(id, status, dextra),
  salesDetail: JSON.stringify({ id, status, lines: [{ code: 'SG110CX', qty: 2, unitPrice: 22500, amount: 45000 }], total: 45000 }) }, extra || {}));
const denied = r => !!r && (r.error === 'ACCESS_DENIED' || r.code === 403 || r.error === 'ROLE_CANNOT_APPROVE');

/* ======================================================= 1) เมทริกซ์สิทธิ์ (server จริง) */
log('\n== 1) เมทริกซ์สิทธิ์ที่ server ==');
{
  const W = world();
  saveQT(W, W.T.src, 'M1', 'Submitted');                                   // ใบที่รออนุมัติ
  W.post({ token: W.T.boss, action: 'saveSR', id: 'MSR', status: 'Submitted', detail: JSON.stringify({ header: { title: 'x', customer: 'CP', groupType: 'Inverter' }, lines: [{ desc: 'a', qty: 1 }] }) });
  const roles = ['boss', 'sales_non', 'smgr', 'src', 'pm', 'bd', 'gm', 'adm'];
  const acts = {
    'GET quotations (ทั้งชุด)': t => { const r = W.get('quotations', t); return r.ok ? (r.quotations.some(q => q.detail) ? 'R+cost' : 'R') : 'none'; },
    'GET salesview': t => { const r = W.get('salesview', t); return r.ok ? 'R' : 'none'; },
    'GET users': t => { const r = W.get('users', t); return r.ok ? (r.users.some(u => u.email && u.id !== 'boss') ? 'R+email' : 'R') : 'none'; },
    'GET settings': t => { const r = W.get('settings', t); return r.ok ? (r.commission || r.groups ? 'R+cost' : 'R') : 'none'; },
    'GET products': t => { const r = W.get('products', t); return r.ok ? 'R' : 'none'; },
    'POST saveSR (ของตัวเอง)': t => W.post({ token: t, action: 'saveSR', id: 'S_' + t.slice(0, 4), status: 'Submitted', detail: JSON.stringify({ header: { title: 'x', customer: 'C', groupType: 'Inverter' }, lines: [{ desc: 'a', qty: 1 }] }) }),
    'POST save QT': t => saveQT(W, t, 'Q_' + t.slice(0, 4), 'In Progress'),
    'POST approve': t => W.post({ token: t, action: 'approve', id: 'M1' }),
    'POST release': t => W.post({ token: t, action: 'release', id: 'M1' }),
    'POST delete QT': t => W.post({ token: t, action: 'delete', id: 'Q_dummy' }),
    'POST salesPatch (ของ boss)': t => W.post({ token: t, action: 'salesPatch', id: 'MSR', patch: JSON.stringify({ salesNote: 'n' }) }),
    'POST saveSettings': t => W.post({ token: t, action: 'saveSettings', settingsRev: 1, detail: '{}' }),
    'POST saveUsers': t => W.post({ token: t, action: 'saveUsers', users: [] }),
    'POST saveProduct': t => W.post({ token: t, action: 'saveProduct', code: 'ZZ-' + t.slice(0, 4), desc: 'x' }),
    'POST addMaster (uom)': t => W.post({ token: t, action: 'addMaster', list: 'uom', value: 'u' + t.slice(0, 3) }),
    'POST saveMaster': t => W.post({ token: t, action: 'saveMaster', list: 'uom', op: 'hide', value: 'pcs' }),
    'POST larkStatus': t => W.post({ token: t, action: 'larkStatus' }),
    'POST unlockUser': t => W.post({ token: t, action: 'unlockUser', id: 'boss' }),
  };
  for (const [a, fn] of Object.entries(acts)) {
    R.matrix[a] = {};
    for (const u of roles) {
      let r; try { r = fn(W.T[u]); } catch (e) { r = { error: String(e) }; }
      R.matrix[a][u] = typeof r === 'string' ? r : (denied(r) ? 'DENY' : (r && r.ok === false ? 'ERR:' + (r.error || '?') : 'ALLOW'));
    }
  }
  const pad = (s, n) => String(s).padEnd(n);
  log(pad('action', 30) + roles.map(r => pad(r, 11)).join(''));
  for (const [a, m] of Object.entries(R.matrix)) log(pad(a, 30) + roles.map(r => pad(m[r], 11)).join(''));
}

/* ======================================================= 2) Sales เห็นต้นทุนไหม (payload จริง) */
log('\n== 2) payload ของ Sales — สแกนคีย์ต้นทุนทุก endpoint ==');
{
  const W = world();
  saveQT(W, W.T.src, 'P1', 'Submitted', {}, { header: { ref: 'QT-P1', title: 'Proj', customer: 'CP', salesUserId: 'boss', sales: 'BOSS', currency: 'THB', groupType: 'Inverter', rates: { USD: 36 }, dealType: 'commission', supplierCom: { pct: 5, supplier: 'Sungrow' } } });
  W.post({ token: W.T.pm, action: 'approve', id: 'P1' }); W.post({ token: W.T.bd, action: 'approve', id: 'P1' });
  const rel = W.post({ token: W.T.sales_non, action: 'release', id: 'P1' });
  const COST = /^(up|costcur|dutypct|clearancepct|freep|oppct|extras|exrate|rates|cost|linecost|basecost|pricepc|duty|clearance|profit|lineprofit|op|gp|gppct|margin|purchasecost|supplierprice|supplier|landedcost|commission|comgroup|boiprice|defaultprice|needsapproval|rawup|approvalroles|auditlogs|globalextras|suppliercom|detail|groups)$/i;
  const scan = (o, p, hits) => { if (o && typeof o === 'object') for (const k in o) { if (COST.test(k)) hits.push(p + '.' + k); scan(o[k], p + '.' + k, hits); }
    else if (typeof o === 'string' && /^[\[{]/.test(o)) { try { scan(JSON.parse(o), p + '(json)', hits); } catch (e) {} } return hits; };
  for (const u of ['boss', 'sales_non', 'smgr']) {
    const t = W.T[u], outs = {
      quotations: W.get('quotations', t), changes: W.get('changes', t, new Date(Date.now() - 3600e3).toISOString()), quote: W.get('quote', t, 'P1'),
      salesview: W.get('salesview', t), settings: W.get('settings', t), products: W.get('products', t), users: W.get('users', t), whoami: W.get('whoami', t),
      saveSR: W.post({ token: t, action: 'saveSR', id: 'L_' + u, status: 'Submitted', detail: JSON.stringify({ header: { title: 'x', customer: 'C', groupType: 'Inverter' }, lines: [{ desc: 'a', qty: 1, up: 999, opPct: 50 }] }) }),
      salesPatch: W.post({ token: t, action: 'salesPatch', id: 'P1', patch: JSON.stringify({ salesNote: 'ok' }) }),
    };
    if (u === 'sales_non') outs.release = rel;
    for (const [k, v] of Object.entries(outs)) { const hits = scan(v, k, []); if (hits.length) R.leaks.push({ user: u, endpoint: k, keys: [...new Set(hits)].slice(0, 12) }); }
  }
  log(R.leaks.length ? R.leaks.map(l => `LEAK ${l.user} ${l.endpoint}: ${l.keys.join(', ')}`).join('\n') : 'ไม่พบคีย์ต้นทุนใน payload ของ Sales / Sales Manager / NON');
  const sd = String(W.col('P1', 'SalesDetail'));
  log('SalesDetail ในชีท (สิ่งที่ Sales ได้รับ):', sd.slice(0, 220));
}

/* ======================================================= 3) ทั้งลูป + เจ้าของงานแต่ละขั้น */
log('\n== 3) ทั้งลูป SR → QT → อนุมัติ → ปล่อยราคา → Pending → Won ==');
{
  const W = world();
  const who = (id, label) => { const q = W.get('quotations', W.T.adm).quotations.find(x => x.id === id) || {}; const f = q.follow || {};
    const step = { label, id, status: q.status, owner: f.owner, actor: f.actor && f.actor.kind, actorIds: (f.actor && f.actor.uids) || [], resp: f.resp || '' };
    R.loop.push(step); log(`  ${label.padEnd(34)} status=${String(step.status).padEnd(17)} owner=${String(step.owner).padEnd(10)} รอ: ${step.actorIds.join(',') || step.actor || '-'}  ผู้รับผิดชอบ=${step.resp || '-'}`); return step; };
  let r = W.post({ token: W.T.boss, action: 'saveSR', id: 'SR1', status: 'Submitted', detail: JSON.stringify({ header: { title: 'Factory 500kW', customer: 'CP Group', groupType: 'Inverter', currency: 'THB' }, lines: [{ desc: 'Inverter 110kW', group: 'INVERTER', qty: 4 }] }) });
  R.loop.push({ label: 'Sales ส่ง SR → ได้เลขที่', docNo: r.docNo, ok: r.ok }); log('  Sales ส่ง SR → docNo', r.docNo, 'routedTo', r.routedName);
  who('SR1', 'SR ส่งแล้ว (Submitted)');
  // Sourcing รับงาน (Index: takeSRAndCost → save SR Accepted + assignedTo) แล้วสร้าง QT
  const srd = W.det('SR1'); srd.status = 'Accepted'; srd.assignedTo = 'src';
  r = W.post({ token: W.T.src, action: 'save', id: 'SR1', docType: 'SR', docNo: srd.docNo, status: 'Accepted', assignedTo: 'src', salesUserId: 'boss', detail: JSON.stringify(srd) });
  who('SR1', 'SR รับงานแล้ว (Accepted)');
  r = saveQT(W, W.T.src, 'QT1', 'In Progress', { assignedTo: 'src' }, { srId: 'SR1' });
  who('QT1', 'QT กำลังทำราคา');
  // ผูก SR.quoteIds (Index ทำฝั่ง client แล้ว save SR อีกรอบ)
  const srd2 = W.det('SR1'); srd2.quoteIds = ['QT1']; srd2.status = 'Quoted';
  W.post({ token: W.T.src, action: 'save', id: 'SR1', docType: 'SR', docNo: srd2.docNo, status: 'Quoted', assignedTo: 'src', salesUserId: 'boss', detail: JSON.stringify(srd2) });
  who('SR1', 'SR หลังผูก QT');
  saveQT(W, W.T.src, 'QT1', 'Submitted', { assignedTo: 'src', baseUpdatedAt: W.col('QT1', 'UpdatedAt') }, { srId: 'SR1' });
  who('QT1', 'QT ส่งขออนุมัติ');
  r = W.post({ token: W.T.pm, action: 'approve', id: 'QT1' }); who('QT1', 'Sourcing Mgr อนุมัติก่อน');   // v5.9: ลำดับ Sourcing Manager → BD
  r = W.post({ token: W.T.bd, action: 'approve', id: 'QT1' }); who('QT1', 'BD อนุมัติครบ');
  r = W.post({ token: W.T.sales_non, action: 'release', id: 'QT1' }); who('QT1', 'NON ปล่อยราคา');
  const bossSees = W.get('salesview', W.T.boss).quotations.find(q => q.id === 'QT1');
  R.loop.push({ label: 'Sales เห็นราคา', ok: !!(bossSees && /unitPrice/.test(bossSees.salesDetail)) }); log('  Sales เห็นราคาหลังปล่อย:', !!(bossSees && /unitPrice/.test(bossSees.salesDetail)));
  // Sales ปิดงาน Won — Sales ทำเองได้ไหม?
  r = W.post({ token: W.T.boss, action: 'salesPatch', id: 'QT1', patch: JSON.stringify({ status: 'Won', salesUpdate: { stage: 'ปิดการขายได้' } }) });
  const st = W.col('QT1', 'Status');
  R.loop.push({ label: 'Sales กด Won เอง', status: st, note: 'salesPatch รับเฉพาะ ' + 'salesNote/followUpDate/salesUpdate' });
  log('  Sales ส่ง status=Won ผ่าน salesPatch → สถานะในชีท:', st, '(Won ต้องให้ฝ่ายในเปลี่ยนให้)');
  saveQT(W, W.T.src, 'QT1', 'Won', { assignedTo: 'src', releasedTo: 'boss', baseUpdatedAt: W.col('QT1', 'UpdatedAt') }, { srId: 'SR1', releasedTo: ['boss'] });
  who('QT1', 'Sourcing เปลี่ยนเป็น Won');
  const srAfter = W.det('SR1'), qtAfter = W.det('QT1');
  R.loop.push({ label: 'statusLog QT', entries: (qtAfter.statusLog || []).map(s => s.s) });
  log('  statusLog ของ QT:', (qtAfter.statusLog || []).map(s => s.s).join(' → '));
  log('  auditLogs ของ QT:', (qtAfter.auditLogs || []).length, 'รายการ · SR quoteIds:', JSON.stringify(srAfter.quoteIds), '· QT.srId:', qtAfter.srId);
  R.auditTrail.push({ logRows: W.sheets['Log'].rows.slice(1).map(r => r.slice(0, 5).map(String).join(' | ')) });
  log('  แท็บ Log (' + (W.sheets['Log'].rows.length - 1) + ' แถว) ตัวอย่าง:\n   ' + W.sheets['Log'].rows.slice(1, 9).map(r => r.slice(0, 5).map(x => String(x).slice(0, 40)).join(' | ')).join('\n   '));
}

/* ======================================================= 4) ข้ามขั้นตอน / แก้ประวัติ */
log('\n== 4) พยายามข้ามขั้นตอน / เขียนทับประวัติ ==');
{
  const W = world();
  const B = (name, cond, ev) => { R.bypass.push({ name, vulnerable: !!cond, ev }); log((cond ? '  ❌ เปิดช่อง  ' : '  ✓ กันได้    ') + name + (ev ? '  → ' + JSON.stringify(ev).slice(0, 160) : '')); };
  let r = saveQT(W, W.T.src, 'B1', 'Approved');
  B('Sourcing บันทึกใบใหม่เป็น "Approved" ตรง ๆ (ไม่ผ่านอนุมัติ 2 ฝ่าย)', W.col('B1', 'Status') === 'Approved', { ok: r.ok, status: W.col('B1', 'Status'), approvals: W.det('B1').approvals });
  r = saveQT(W, W.T.src, 'B2', 'Pending', { releasedTo: 'boss' }, { releasedTo: ['boss'] });
  const sv = W.get('salesview', W.T.boss).quotations.find(q => q.id === 'B2');
  B('Sourcing บันทึกเป็น "Pending" + releasedTo=Sales → Sales เห็นราคาโดยไม่มีใครอนุมัติ/ปล่อย', !!(sv && /unitPrice/.test(sv.salesDetail)), { status: W.col('B2', 'Status'), salesSees: !!(sv && /unitPrice/.test(sv.salesDetail)) });
  saveQT(W, W.T.src, 'B3', 'Submitted'); W.post({ token: W.T.pm, action: 'approve', id: 'B3' });
  r = saveQT(W, W.T.src, 'B3', 'Submitted', { baseUpdatedAt: W.col('B3', 'UpdatedAt') }, { approvalRoles: [], approvals: [] });
  B('Sourcing บันทึกใบที่อนุมัติไปแล้ว 1 ฝ่าย → ล้างการอนุมัติ/ประวัติอนุมัติทิ้งได้', W.det('B3').approvals.length === 0, { approvalsAfter: W.det('B3').approvals.length });
  r = saveQT(W, W.T.src, 'B4', 'Submitted', {}, { auditLogs: [{ timestamp: new Date().toISOString(), user: 'Chatraporn', action: 'ประวัติจริง' }] });
  saveQT(W, W.T.src, 'B4', 'Submitted', { baseUpdatedAt: W.col('B4', 'UpdatedAt') }, { auditLogs: [] });
  B('client ลบ / เขียนทับประวัติเดิมในใบ (auditLogs)', !W.det('B4').auditLogs.some(a => a.action === 'ประวัติจริง'), W.det('B4').auditLogs);
  saveQT(W, W.T.src, 'B4', 'Submitted', { baseUpdatedAt: W.col('B4', 'UpdatedAt') }, { auditLogs: [{ timestamp: '2099-01-01', user: 'ปลอม', action: 'เพิ่มประวัติปลอม' }] });
  B('client เพิ่มรายการประวัติปลอมต่อท้ายได้ (ประวัติยังมาจาก client — แก้จริงในชุด 2: แท็บ AuditTrail ที่ server เขียนเอง)', W.det('B4').auditLogs.some(a => a.user === 'ปลอม'), W.det('B4').auditLogs.slice(-1));
  // SR read-only หลังมี QT
  W.post({ token: W.T.boss, action: 'saveSR', id: 'SRX', status: 'Submitted', detail: JSON.stringify({ header: { title: 'Original', customer: 'CP', groupType: 'Inverter' }, lines: [{ desc: 'Inverter', qty: 4 }] }) });
  const d = W.det('SRX'); d.quoteIds = ['QTX']; d.status = 'Quoted'; d.assignedTo = 'src';
  W.post({ token: W.T.src, action: 'save', id: 'SRX', docType: 'SR', docNo: d.docNo, status: 'Quoted', assignedTo: 'src', salesUserId: 'boss', detail: JSON.stringify(d) });
  r = W.post({ token: W.T.boss, action: 'saveSR', id: 'SRX', status: 'Submitted', detail: JSON.stringify({ header: { title: 'Sales แก้ทีหลัง', customer: 'CP', groupType: 'Inverter' }, lines: [{ desc: 'x', qty: 99 }] }) });
  B('Sales แก้ SR หลังมี QT แล้ว', W.det('SRX').header.title === 'Sales แก้ทีหลัง', r);
  const d2 = W.det('SRX'); d2.header.title = 'Sourcing เขียนทับ'; d2.lines = [{ desc: 'เปลี่ยนสเปค', qty: 1 }];
  r = W.post({ token: W.T.src2, action: 'save', id: 'SRX', docType: 'SR', docNo: d2.docNo, status: 'Quoted', salesUserId: 'boss', detail: JSON.stringify(d2) });
  B('ฝ่ายใน (Sourcing อีกคน) เขียนทับ SR หลังมี QT แล้ว (หลักฐานคำขอลูกค้าถูกแก้)', W.det('SRX').header.title === 'Sourcing เขียนทับ', { ok: r.ok });
  r = W.post({ token: W.T.src, action: 'save', id: 'QT-OVR', docType: 'QT', status: 'In Progress', salesUserId: 'boss', detail: qtDetail('QT-OVR', 'In Progress') });
  r = W.post({ token: W.T.src, action: 'save', id: 'SRX', docType: 'QT', status: 'Approved', salesUserId: 'boss', detail: qtDetail('SRX', 'Approved') });
  B('ฝ่ายในเปลี่ยนชนิดเอกสาร SR → QT (Approved) ด้วย id เดิม', W.col('SRX', 'DocType') === 'QT', { docType: W.col('SRX', 'DocType'), status: W.col('SRX', 'Status') });
  W.seed('BA', 'Approved'); W.seed('BP', 'Pending');                         // v5.9: ใบอนุมัติแล้ว / ปล่อยแล้ว = ข้อมูลตั้งต้นในชีท
  r = W.post({ token: W.T.boss, action: 'saveSR', id: 'BA', status: 'Submitted', detail: JSON.stringify({ docType: 'SR', header: { title: 'x' }, lines: [] }) });
  B('Sales เขียนทับใบ QT ผ่าน saveSR', W.col('BA', 'DocType') !== 'QT', r);
  r = W.post({ token: W.T.pair, action: 'salesPatch', id: 'BP', patch: JSON.stringify({ salesNote: 'แอบแก้งานคนอื่น' }) });
  B('Sales คนอื่นแก้หมายเหตุงานของ BOSS', String(W.col('BP', 'SalesNote')) === 'แอบแก้งานคนอื่น', r);
  ['pm', 'bd', 'gm', 'adm'].forEach(u => { const x = W.post({ token: W.T[u], action: 'release', id: 'BA' }); B('ผู้บริหาร / Admin (' + u + ') ปล่อยราคาแทน NON', x.ok === true, x); });
  r = W.post({ token: W.T.pair, action: 'release', id: 'BA' });
  B('Sales ที่ไม่ใช่ผู้ปล่อยราคา กดปล่อยราคา', r.ok === true, r);
  r = W.post({ token: W.T.src, action: 'approve', id: 'B3' });
  B('Sourcing กดอนุมัติ', r.ok === true, r);
  r = W.post({ token: W.T.src, action: 'save', id: 'B5', docType: 'QT', status: 'In Progress', salesUserId: 'boss', total: 1, cost: 999999, profit: -999998, gp: -99, detail: qtDetail('B5', 'In Progress') });
  B('Total/Cost/Profit/GP ในชีทมาจาก client ทั้งหมด (server ไม่คำนวณ/ตรวจ) — ตัวเลขไม่ตรงกับรายการได้', +W.col('B5', 'Cost') === 999999, { Cost: W.col('B5', 'Cost'), GP: W.col('B5', 'GP') });
  // v5.9: ทางตรง (save เป็น Pending) ถูกปิดแล้ว → ทดสอบทางที่ยังเหลือ: ส่งราคาฉบับ Sales ปลอมตอนทำราคา แล้วผ่านอนุมัติ + ปล่อยตามปกติ
  r = W.post({ token: W.T.src, action: 'save', id: 'B6', docType: 'QT', status: 'Submitted', salesUserId: 'boss', detail: qtDetail('B6', 'Submitted'),
    salesDetail: JSON.stringify({ id: 'B6', lines: [{ code: 'X', unitPrice: 1, amount: 1 }], total: 1 }) });
  W.post({ token: W.T.pm, action: 'approve', id: 'B6' }); W.post({ token: W.T.bd, action: 'approve', id: 'B6' }); W.post({ token: W.T.sales_non, action: 'release', id: 'B6' });
  const sv6 = W.get('salesview', W.T.boss).quotations.find(q => q.id === 'B6');
  B('ราคาที่ Sales เห็น (SalesDetail) มาจาก client แยกจาก Detail — server ไม่ตรวจว่าตรงกับรายการจริง (แก้ในชุด 7: server คำนวณเอง)', sv6 && /"unitPrice":1/.test(sv6.salesDetail), { salesSees: sv6 && sv6.salesDetail });
}

/* ======================================================= 5) กดซ้ำ / ส่งซ้ำ */
log('\n== 5) กดซ้ำ / refresh แล้วส่งซ้ำ ==');
{
  const W = world();
  const sr = id => W.post({ token: W.T.boss, action: 'saveSR', id, status: 'Submitted', detail: JSON.stringify({ header: { title: 'Dup', customer: 'CP', groupType: 'Inverter' }, lines: [{ desc: 'Inverter', qty: 1 }] }) });
  const a = sr('D1'), b = sr('D1');
  const n1 = W.QS.rows.filter(r => r[0] === 'D1').length;
  R.idem.push({ case: 'กดส่ง 2 ครั้ง id เดิม (กดรัว)', rows: n1, docNos: [a.docNo, b.docNo] });
  log('  กดส่ง 2 ครั้ง id เดิม → แถว', n1, '· เลขที่', a.docNo, b.docNo);
  sr('D2'); sr('D3');
  R.idem.push({ case: 'refresh แล้วส่งใหม่ (id ใหม่ เนื้อหาเดิม)', rows: W.QS.rows.filter(r => /^D[23]$/.test(r[0])).length });
  log('  refresh แล้วส่งใหม่ (id ใหม่ เนื้อหาเดิม) → แถว', W.QS.rows.filter(r => /^D[23]$/.test(r[0])).length, '(ไม่มี clientKey กันซ้ำ)');
  const nNotify = (W.sheets['NotifyQueue'] ? W.sheets['NotifyQueue'].rows.length - 1 : 0);
  log('  การ์ด Lark ที่เข้าคิวจาก 4 ครั้ง:', nNotify);
  R.idem.push({ case: 'Lark cards from 4 submits', n: nNotify });
}

/* ======================================================= 6) สองคนแก้พร้อมกัน */
log('\n== 6) สองคนแก้ใบเดียวกันพร้อมกัน ==');
{
  const W = world();
  saveQT(W, W.T.src, 'C1', 'In Progress');
  const base = W.col('C1', 'UpdatedAt');
  const a = saveQT(W, W.T.src, 'C1', 'In Progress', { baseUpdatedAt: base }, { remarks: ['A'] });
  const b = saveQT(W, W.T.src2, 'C1', 'In Progress', { baseUpdatedAt: base }, { remarks: ['B'] });
  R.conc.push({ case: 'QT: base เดียวกัน 2 คน', first: a.ok, second: b.error || b.ok });
  log('  QT: คนแรก', a.ok, '· คนที่สอง (base เก่า) →', b.error || b.ok);
  const c = saveQT(W, W.T.src2, 'C1', 'In Progress', {}, { remarks: ['C ไม่ส่ง base'] });
  R.conc.push({ case: 'QT: ไม่ส่ง baseUpdatedAt', result: c.ok, remarks: W.det('C1').remarks });
  log('  QT: ไม่ส่ง baseUpdatedAt → เขียนทับได้', c.ok, W.det('C1').remarks);
  W.post({ token: W.T.boss, action: 'saveSR', id: 'C2', status: 'Submitted', detail: JSON.stringify({ header: { title: 'S', customer: 'CP', groupType: 'Inverter' }, lines: [{ desc: 'a', qty: 1 }] }) });
  const d = W.det('C2');
  const x = W.post({ token: W.T.src, action: 'save', id: 'C2', docType: 'SR', status: 'Accepted', assignedTo: 'src', salesUserId: 'boss', detail: JSON.stringify(Object.assign({}, d, { status: 'Accepted', assignedTo: 'src' })) });
  const y = W.post({ token: W.T.src2, action: 'save', id: 'C2', docType: 'SR', status: 'Accepted', assignedTo: 'src2', salesUserId: 'boss', detail: JSON.stringify(Object.assign({}, d, { status: 'Accepted', assignedTo: 'src2' })) });
  R.conc.push({ case: 'SR: 2 Sourcing กดรับงานพร้อมกัน', a: x.ok, b: y.ok || y.error, finalAssigned: W.col('C2', 'AssignedTo') });
  log('  SR: 2 Sourcing กดรับงานพร้อมกัน → คนแรก', x.ok, '· คนที่สอง', y.ok || y.error, '· ผู้รับงานสุดท้าย', W.col('C2', 'AssignedTo'));
  saveQT(W, W.T.src, 'C3', 'Submitted');
  const p1 = W.post({ token: W.T.pm, action: 'approve', id: 'C3' }), p2 = W.post({ token: W.T.bd, action: 'approve', id: 'C3' });
  R.conc.push({ case: 'อนุมัติ 2 ฝ่ายติดกัน', status: W.col('C3', 'Status'), roles: W.det('C3').approvalRoles });
  log('  อนุมัติ 2 ฝ่ายติดกัน → ', W.col('C3', 'Status'), W.det('C3').approvalRoles);
}

/* ======================================================= 7) token / บัญชี */
log('\n== 7) token หมดอายุ / ปิดบัญชีกลางทาง ==');
{
  const W = world();
  const S = W.sheets['Sessions'], sh = S.rows[0];
  S.rows.find(r => r[sh.indexOf('UserId')] === 'boss')[sh.indexOf('ExpiresMs')] = Date.now() - 1000;
  const r1 = W.get('salesview', W.T.boss);
  R.auth.push({ case: 'token หมดอายุ', resp: r1 }); log('  token หมดอายุ →', JSON.stringify(r1).slice(0, 120));
  W.sheets['Users'].rows.find(r => r[0] === 'src')[W.sheets['Users'].rows[0].indexOf('Active')] = 'FALSE';
  const r2 = W.post({ token: W.T.src, action: 'save', id: 'Z', docType: 'QT', status: 'In Progress', detail: qtDetail('Z', 'In Progress') });
  R.auth.push({ case: 'ปิดบัญชีระหว่างใช้งาน', resp: r2 }); log('  ปิดบัญชี Sourcing ระหว่างใช้งาน → บันทึก:', JSON.stringify(r2).slice(0, 120));
  log('  SESSION_HOURS =', W.ctx.SESSION_HOURS);
}

/* ======================================================= 8) คีย์เสถียร / header เปลี่ยน */
log('\n== 8) ชีทถูกเรียงใหม่ / แทรกคอลัมน์ / เปลี่ยนชื่อ header ==');
{
  const W = world();
  saveQT(W, W.T.src, 'K1', 'Submitted'); saveQT(W, W.T.src, 'K2', 'Submitted'); saveQT(W, W.T.src, 'K3', 'Submitted');
  const body = W.QS.rows.splice(1); body.reverse(); W.QS.rows.push(...body);         // เรียงใหม่
  const a = W.post({ token: W.T.pm, action: 'approve', id: 'K2' });
  R.keys.push({ case: 'เรียงแถวใหม่แล้วอนุมัติ K2', ok: a.ok && W.det('K2').approvalRoles.length === 1 && W.det('K1').approvalRoles.length === 0 });
  log('  เรียงแถวใหม่แล้วอนุมัติ K2 → ถูกใบ', R.keys[0].ok);
  // แทรกคอลัมน์กลางชีท (มนุษย์เพิ่มคอลัมน์ "หมายเหตุ" หลัง Customer)
  const ins = W.qh.indexOf('Customer') + 1; W.QS.rows.forEach((r, i) => r.splice(ins, 0, i === 0 ? 'หมายเหตุมนุษย์' : 'x'));
  const b = W.post({ token: W.T.bd, action: 'approve', id: 'K2' });
  const st = W.QS.rows.find(r => r[0] === 'K2')[W.QS.rows[0].indexOf('Status')];
  R.keys.push({ case: 'แทรกคอลัมน์กลางชีทแล้วอนุมัติ', ok: b.ok && st === 'Approved' });
  log('  แทรกคอลัมน์กลางชีทแล้วอนุมัติ → สถานะ', st, b.ok);
  // เปลี่ยนชื่อ header Status → สถานะ
  const hi = W.QS.rows[0].indexOf('Status'); W.QS.rows[0][hi] = 'สถานะ';
  const c = W.get('quotations', W.T.adm);
  const k2 = (c.quotations || []).find(q => q.id === 'K2') || {};
  const newCols = W.QS.rows[0].slice(-3);
  R.keys.push({ case: 'เปลี่ยนชื่อ header Status', statusRead: k2.status, headerTail: newCols });
  log('  เปลี่ยนชื่อ header "Status" → อ่านสถานะ K2 ได้:', JSON.stringify(k2.status), '· ท้ายชีทมีคอลัมน์:', newCols.join(','), '(ระบบเพิ่ม Status ใหม่ว่าง ๆ ต่อท้าย ไม่เตือน)');
}

/* ======================================================= 9) ค่าตั้งระบบหาย */
log('\n== 9) Script Properties / แท็บ / ค่าตั้งหาย ==');
{
  const W = world();
  W.sheets['Settings'].rows.splice(1);
  const a = W.get('settings', W.T.src), b = W.get('quotations', W.T.src);
  R.config.push({ case: 'Settings ว่าง', settings: a.ok, quotations: b.ok }); log('  แท็บ Settings ว่าง → settings', a.ok, '· quotations', b.ok);
  delete W.sheets['Log'];
  const c = saveQT(W, W.T.src, 'G1', 'In Progress');
  R.config.push({ case: 'แท็บ Log ถูกลบ', save: c.ok, recreated: !!W.sheets['Log'] }); log('  แท็บ Log ถูกลบ → บันทึกได้', c.ok, '· สร้างแท็บใหม่ให้', !!W.sheets['Log']);
  W.props.LARK_MODE = 'live';
  const d = saveQT(W, W.T.src, 'G2', 'Submitted');
  const q = W.sheets['NotifyQueue'].rows.slice(1).map(r => r[W.sheets['NotifyQueue'].rows[0].indexOf('Status')] + ':' + r[W.sheets['NotifyQueue'].rows[0].indexOf('LastError')]);
  R.config.push({ case: 'live แต่ไม่มี LARK_BOT_URL', save: d.ok, queue: q }); log('  โหมดส่งจริงแต่ไม่มี Webhook → บันทึกได้', d.ok, '· คิว:', q.join(' / '));
}

/* ======================================================= 10) ขนาดข้อมูล */
log('\n== 10) ขนาดข้อมูลต่อเอกสาร ==');
{
  const W = world();
  const lines = n => Array.from({ length: n }, (_, i) => ({ code: 'SG' + i, desc: 'SG110CX-P2 Inverter 110kW three phase ' + i, group: 'INVERTER', comGroup: 'Inverter', qty: 2, uom: 'pcs', up: 1000, costCur: 'USD', dutyPct: 5, clearancePct: 2, opPct: 20, freep: 0, extras: [], warranty: '10 YEAR', lead: '90 days after PO' }));
  const audits = n => Array.from({ length: n }, (_, i) => ({ timestamp: new Date().toISOString(), user: 'Chatraporn', role: 'Sourcing', action: 'Changed Unit Price of SG' + i + ' from 1000 to 1010' }));
  for (const [nl, na] of [[5, 20], [10, 60], [30, 100], [80, 100]]) {
    const id = 'S' + nl;
    saveQT(W, W.T.src, id, 'In Progress', {}, { lines: lines(nl), auditLogs: audits(na) });
    const dl = String(W.col(id, 'Detail')).length, sl = String(W.col(id, 'SalesDetail')).length, d = JSON.parse(W.col(id, 'Detail'));
    R.growth['QT_' + nl + 'lines_' + na + 'audit'] = { detailChars: dl, salesDetailChars: sl, auditKept: (d.auditLogs || []).length, oversize: !!d._oversize };
    log(`  QT ${nl} รายการ + ประวัติ ${na}: Detail ${dl} ตัวอักษร · SalesDetail ${sl} · เก็บประวัติไว้ ${(d.auditLogs || []).length} รายการ${d._oversize ? ' · ⚠ OVERSIZE (ข้อมูลใบหาย)' : ''}`);
  }
  log('  คอลัมน์ต่อแถว Quotations:', W.qh.length);
}

/* ======================================================= 11) ลบเอกสารที่มีอยู่จริง (soft delete) */
log('\n== 11) ลบเอกสารที่มีอยู่จริง ==');
R.del = {};
{
  for (const u of ['boss', 'smgr', 'src2', 'pm', 'adm']) {
    const W = world();
    W.seed('DQ', 'Approved');                                                 // QT ที่อนุมัติแล้ว (ข้อมูลตั้งต้นในชีท)
    W.post({ token: W.T.boss, action: 'saveSR', id: 'DSR', status: 'Submitted', detail: JSON.stringify({ header: { title: 'x', customer: 'CP', groupType: 'Inverter' }, lines: [{ desc: 'a', qty: 1 }] }) });
    W.post({ token: W.T.src, action: 'saveSR', id: 'DSR', status: 'Quoted', assignedTo: 'src', quoteIds: ['DQ'], detail: JSON.stringify({ header: { title: 'x', customer: 'CP', groupType: 'Inverter' }, lines: [{ desc: 'a', qty: 1 }], quoteIds: ['DQ'] }) });
    const a = W.post({ token: W.T[u], action: 'delete', id: 'DQ' }), b = W.post({ token: W.T[u], action: 'delete', id: 'DSR' });
    R.del[u] = { qtApproved: a.ok ? 'ลบได้' : a.error, srWithQt: b.ok ? 'ลบได้' : b.error, logged: W.sheets['Log'].rows.filter(r => r[1] === 'delete').length };
    log(`  ${u.padEnd(6)} ลบ QT ที่อนุมัติแล้วของคนอื่น: ${R.del[u].qtApproved.padEnd(14)} ลบ SR ที่มี QT แล้ว: ${R.del[u].srWithQt.padEnd(14)} แถว Log: ${R.del[u].logged}`);
  }
}

/* ======================================================= 12) ใบใหญ่จนเกินขนาดเซลล์ */
log('\n== 12) ใบใหญ่เกินขนาดเซลล์ (CELL_LIMIT) ==');
{
  const W = world();
  const lines = n => Array.from({ length: n }, (_, i) => ({ code: 'SG' + i, desc: 'SG110CX-P2 Inverter 110kW three phase grid-tie with AFCI, 10 MPPT, IP66 ' + i, group: 'INVERTER', comGroup: 'Inverter', qty: 2, uom: 'pcs', up: 1000, costCur: 'USD', dutyPct: 5, clearancePct: 2, opPct: 20, freep: 0, extras: [], warranty: '10 YEAR', lead: '90 days after PO' }));
  for (const nl of [120, 160, 220]) {
    const id = 'B' + nl;
    const r = saveQT(W, W.T.src, id, 'In Progress', {}, { lines: lines(nl), auditLogs: [] });
    const d = JSON.parse(W.col(id, 'Detail') || '{}');
    const g = W.get('quotation', W.T.src, id);
    R.growth['big_' + nl] = { saveOk: r.ok, note: r.note || r.warning || '', oversize: !!d._oversize, linesKept: (d.lines || []).length };
    log(`  ${nl} รายการ → บันทึก ok=${r.ok} ${JSON.stringify(r).slice(0, 120)} · ในชีท: ${d._oversize ? '⚠ OVERSIZE เหลือแค่ {id,_oversize}' : (d.lines || []).length + ' รายการ'} · เปิดใบ: ${g.ok === false ? g.error : 'ok'}`);
  }
}

fs.mkdirSync(path.join(DIR, 'audit/out'), { recursive: true });
fs.writeFileSync(path.join(DIR, 'audit/out/server_results.json'), JSON.stringify(R, null, 1));
log('\nบันทึกผล: audit/out/server_results.json');
