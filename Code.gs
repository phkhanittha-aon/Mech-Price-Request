/*************************************************************
 * MGS PROJECT PRICING — APPS SCRIPT BACKEND  (v4.0 · RBAC)
 * ใช้คู่กับ  Index.html (build 4.0)  และ  Sales.html (build 4.0)
 *
 * สิ่งที่เปลี่ยนจาก v2.1 (สำคัญ — ต้องอัปเดต HTML ทั้ง 2 ไฟล์พร้อมกัน)
 *  1) ทุก request ต้องมี session token ที่ออกโดย server (action:'login')
 *  2) ข้อมูลถูก "ตัดฟิลด์ตาม role ตั้งแต่ฝั่ง server" (Data Projection)
 *     — role SALES จะไม่ได้รับ Detail / Cost / Profit / GP เลย
 *       ได้เฉพาะคอลัมน์ SalesDetail ที่ปลอดต้นทุน และเฉพาะใบที่ปล่อยราคาให้แล้ว
 *  3) Sales เขียนข้อมูลได้เฉพาะ field ของตัวเอง (salesPatch / saveSR / release)
 *     เขียนทับเอกสารทั้งใบไม่ได้อีกต่อไป
 *
 * ── ติดตั้ง ────────────────────────────────────────────────
 *  1) วางไฟล์นี้ทับ Code.gs
 *  2) ไฟล์ HTML:  Index (ระบบทำราคา)  และ  Sales (ติดตามงานขาย)
 *  3) รัน setup() หนึ่งครั้ง → สร้าง/อัปเกรดแท็บ + คอลัมน์ SalesDetail + แท็บ Sessions
 *  4) Deploy → Manage deployments → ✏️ → Version: New version → Deploy
 *  5) ในระบบหลัก (Admin) กด "สร้างข้อมูลสำหรับ Sales" หนึ่งครั้ง เพื่อ backfill ใบเก่า
 *************************************************************/

var SHEET_ID = '';
var DEFAULT_PAGE = '';
var TZ = 'Asia/Bangkok';
var MAX_RETURN_ROWS = 1500;
var CELL_LIMIT = 49000;
var LOG_KEEP_ROWS = 5000;
var SESSION_HOURS = 12;

var SH = {
  QUOTES:'Quotations', PRODUCTS:'Products', SETTINGS:'Settings',
  USERS:'Users', LOG:'Log', SESSIONS:'Sessions'
};

var HEADERS = {
  Quotations: ['Id','DocType','DocNo','Ref','Title','Customer','Sales','SalesUserId','AssignedTo',
               'Group','Round','Currency','Incoterm','PriceTerm','Exrate','OfferDate',
               'Stage','Status','FollowStatus','NeedsApproval','ReleasedTo','SalesNote',
               'Lines','Total','Cost','Profit','GP',
               'Updated','UpdatedAt','By','Deleted','DeletedAt','DeletedBy','Detail','SalesDetail'],
  Products:   ['Code','Desc','Group','ComGroup','Uom','Warranty','Duty','Supplier','Lead',
               'DefaultPrice','DefaultCur','BoiPrice','Updated','By'],
  Settings:   ['SettingsRev','SettingsUpdatedAt','By','Detail'],
  Users:      ['Id','Name','Role','Scope','PassHash','Updated'],
  Log:        ['Time','Action','Id','By','Note'],
  Sessions:   ['Token','UserId','Role','Name','Issued','ExpiresMs','Expires','Agent']
};

/* ============================================================ RBAC MATRIX */
/**
 * Role ของผู้ใช้ (คอลัมน์ Role ในแท็บ Users) → ชุดสิทธิ์
 * BUSINESS RULE: เพิ่ม role ใหม่ได้โดยเติมบรรทัดเดียวที่นี่
 *   viewCost      = เห็นต้นทุน / GP / กำไร / โครงสร้างราคาภายใน
 *   writeQuote    = สร้าง-แก้ใบเสนอราคาเต็มใบ
 *   approve       = อนุมัติราคา / ปล่อยราคาแทน gatekeeper
 *   manageUsers   = จัดการผู้ใช้ (เป็น role เดียวที่ได้รับ PassHash)
 *   manageSetting = แก้ค่า default / ตารางคอมมิชชั่น
 *   viewAllSales  = เห็นงานของ Sales ทุกคน
 */
var ROLE_MATRIX = {
  'GM':              {tier:'ADMIN',      viewCost:true,  writeQuote:true,  approve:true,  manageUsers:true,  manageSetting:true,  viewAllSales:true },
  'Admin':           {tier:'ADMIN',      viewCost:true,  writeQuote:true,  approve:true,  manageUsers:true,  manageSetting:true,  viewAllSales:true },
  'Procurement Mgr': {tier:'MANAGEMENT', viewCost:true,  writeQuote:true,  approve:true,  manageUsers:false, manageSetting:true,  viewAllSales:true },
  'BD Mgr':          {tier:'MANAGEMENT', viewCost:true,  writeQuote:true,  approve:true,  manageUsers:false, manageSetting:true,  viewAllSales:true },
  'Sourcing':        {tier:'INTERNAL',   viewCost:true,  writeQuote:true,  approve:false, manageUsers:false, manageSetting:false, viewAllSales:true },
  'Sales':           {tier:'SALES',      viewCost:false, writeQuote:false, approve:false, manageUsers:false, manageSetting:false, viewAllSales:false}
};
var DEFAULT_CAPS = ROLE_MATRIX['Sales'];   // role ที่ไม่รู้จัก → ได้สิทธิ์ต่ำสุดเสมอ

function capsOf_(role) { return ROLE_MATRIX[role] || DEFAULT_CAPS; }

/** คีย์ที่ห้ามหลุดไปหา role ที่ไม่มี viewCost — ตัดแบบ recursive ทั้งก่อนส่งออกและก่อนบันทึก */
var COST_KEYS = ['up','costcur','dutypct','clearancepct','freep','oppct','extras','exrate','rates',
  'cost','linecost','basecost','pricepc','duty','clearance','profit','lineprofit','op',
  'gp','gppct','gppercent','margin','purchasecost','supplierprice','supplier','landedcost',
  'internaldiscount','commission','comgroup','boiprice','defaultprice','needsapproval',
  'rawup','approvalroles','auditlogs','globalextras'];

function stripCost_(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Object.prototype.toString.call(v) === '[object Array]') {
    var arr = [];
    for (var i = 0; i < v.length; i++) arr.push(stripCost_(v[i]));
    return arr;
  }
  var out = {};
  for (var k in v) {
    if (!v.hasOwnProperty(k)) continue;
    if (COST_KEYS.indexOf(String(k).toLowerCase()) >= 0) continue;
    out[k] = stripCost_(v[k]);
  }
  return out;
}

/* ============================================================ ENTRY POINTS */

function doGet(e) {
  var type = (e && e.parameter && e.parameter.type) || '';
  if (!type) {
    var page = String((e && e.parameter && e.parameter.app) || (e && e.parameter && e.parameter.page) || DEFAULT_PAGE).toLowerCase();
    var isSales = (page === 'sales');
    return HtmlService.createHtmlOutputFromFile(isSales ? 'Sales' : 'Index')
      .setTitle(isSales ? 'MGS Sales — ติดตามงานขาย' : 'MGS Project Pricing')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, viewport-fit=cover')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  var token = (e && e.parameter && e.parameter.token) || '';
  return json_(apiGetObj_(type, token));
}

function doPost(e) {
  var payload;
  try { payload = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ ok:false, error:'bad JSON: ' + err }); }
  return json_(handle_(payload));
}

function apiPost(jsonStr) {
  var payload;
  try { payload = JSON.parse(jsonStr || '{}'); }
  catch (err) { return JSON.stringify({ ok:false, error:'bad JSON: ' + err }); }
  return JSON.stringify(handle_(payload));
}

function apiGet(type, token) { return JSON.stringify(apiGetObj_(type, token)); }

/* ============================================================ SESSION / AUTH */

function newToken_() {
  return Utilities.getUuid().replace(/-/g, '') + Math.random().toString(36).slice(2, 10);
}

function login_(p) {
  var name = String(p.user || '').trim().toLowerCase();
  var hash = String(p.passHash || '');
  if (!name || !hash) return { ok:false, error:'AUTH_FAILED' };

  var sh = sheet_(SH.USERS), idx = headerIndex_(sh), last = sh.getLastRow();
  if (last < 2) return { ok:false, error:'AUTH_FAILED' };
  var data = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();

  var found = null;
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    if (String(cell_(r, idx, 'Id')).trim().toLowerCase() === name ||
        String(cell_(r, idx, 'Name')).trim().toLowerCase() === name) { found = r; break; }
  }
  // ข้อความเดียวกันทั้งกรณีไม่มีบัญชีและรหัสผิด — ไม่บอกใบ้ว่ามีบัญชีนี้อยู่จริงไหม
  if (!found) { logRow_('login-fail', '', name, '', 'no such user'); return { ok:false, error:'AUTH_FAILED' }; }
  var stored = String(cell_(found, idx, 'PassHash') || '');
  if (!stored || stored !== hash) { logRow_('login-fail', '', name, '', 'bad password'); return { ok:false, error:'AUTH_FAILED' }; }

  var role = String(cell_(found, idx, 'Role') || 'Sales');
  var caps = capsOf_(role);
  var token = newToken_(), now = new Date();
  var exp = new Date(now.getTime() + SESSION_HOURS * 3600000);

  var ss = sheet_(SH.SESSIONS), sidx = headerIndex_(ss);
  purgeSessions_(ss, sidx);
  writeRow_(ss, sidx, null, {
    Token:token, UserId:String(cell_(found, idx, 'Id')), Role:role,
    Name:String(cell_(found, idx, 'Name')), Issued:now.toISOString(),
    // C3 FIX: เก็บวันหมดอายุเป็นตัวเลข epoch ms
    //   เดิมเก็บเป็น ISO string แล้ว Sheets แปลงเป็น Date เอง พอ String(Date) ได้ "Wed Aug 12 2026..."
    //   เทียบแบบ string กับ "2026-..." จะมากกว่าเสมอ → เซสชันไม่เคยหมดอายุเลย (และ purge ก็ไม่ทำงาน)
    ExpiresMs:exp.getTime(),
    Expires:exp.toISOString(), Agent:String(p.agent || '').slice(0, 120)
  });
  logRow_('login', '', String(cell_(found, idx, 'Id')), String(cell_(found, idx, 'Name')), role);

  return { ok:true, token:token, expires:exp.toISOString(),
    user:{ id:String(cell_(found, idx, 'Id')), name:String(cell_(found, idx, 'Name')),
           role:role, tier:caps.tier, caps:caps } };
}

function auth_(token) {
  if (!token) return null;
  var ss = sheet_(SH.SESSIONS), idx = headerIndex_(ss);
  if (ss.getLastRow() < 2) return null;
  var row = findRow_(ss, idx, 'Token', token);
  if (!row) return null;
  var r = ss.getRange(row, 1, 1, ss.getLastColumn()).getValues()[0];
  var expMs = expiryMs_(r, idx);
  if (expMs && expMs < Date.now()) { ss.deleteRow(row); return null; }
  var role = String(cell_(r, idx, 'Role') || 'Sales');
  return { token:token, userId:String(cell_(r, idx, 'UserId')), name:String(cell_(r, idx, 'Name')),
           role:role, caps:capsOf_(role) };
}

function logout_(p) {
  var ss = sheet_(SH.SESSIONS), idx = headerIndex_(ss);
  var row = findRow_(ss, idx, 'Token', p.token || '');
  if (row) ss.deleteRow(row);
  return { ok:true };
}

/** อ่านวันหมดอายุแบบทนทาน: ใช้ ExpiresMs ก่อน ถ้าไม่มี (แถวเก่า) ค่อยแปลงจาก Expires
 *  ห้ามเทียบเวลาแบบ string ที่อ่านกลับมาจาก Sheet เด็ดขาด — Sheets แปลงเป็น Date เองได้ */
function expiryMs_(rowArr, idx) {
  var ms = Number(cell_(rowArr, idx, 'ExpiresMs')) || 0;
  if (ms) return ms;
  var raw = cell_(rowArr, idx, 'Expires');
  if (raw instanceof Date) return raw.getTime();
  if (raw) { var d = new Date(raw); if (!isNaN(d.getTime())) return d.getTime(); }
  return 0;
}
function purgeSessions_(ss, idx) {
  var last = ss.getLastRow(); if (last < 2) return;
  var now = Date.now();
  var data = ss.getRange(2, 1, last - 1, ss.getLastColumn()).getValues();
  for (var i = data.length - 1; i >= 0; i--) {
    var ms = expiryMs_(data[i], idx);
    if (ms && ms < now) ss.deleteRow(i + 2);
  }
}

/* ============================================================ WRITE ROUTER */

function handle_(p) {
  var action = (p && p.action) || '';
  var lock = LockService.getScriptLock();
  try { lock.waitLock(25000); }
  catch (e) { return { ok:false, error:'busy — ระบบกำลังเขียนข้อมูลอยู่ ลองใหม่อีกครั้ง' }; }
  try {
    if (action === 'login') return login_(p);
    if (action === 'ping')  return { ok:true, pong:true, time:nowISO_(), version:'4.0' };

    var sess = auth_(p.token);
    if (!sess) return { ok:false, error:'AUTH_REQUIRED', code:401 };
    if (action === 'logout') return logout_(p);

    switch (action) {
      case 'whoami':       return { ok:true, user:{ id:sess.userId, name:sess.name, role:sess.role, caps:sess.caps } };
      case 'save':         return need_(sess,'writeQuote') || saveQuote_(p, sess);
      case 'saveSR':       return saveSR_(p, sess);
      case 'salesPatch':   return salesPatch_(p, sess);
      case 'release':      return release_(p, sess);
      case 'delete':       return deleteQuote_(p, sess);
      case 'saveProduct':  return need_(sess,'writeQuote') || saveProduct_(p, sess);
      case 'saveSettings': return need_(sess,'manageSetting') || saveSettings_(p, sess);
      case 'saveUsers':    return need_(sess,'manageUsers') || saveUsers_(p, sess);
      default:             return { ok:false, error:'unknown action: ' + action };
    }
  } catch (err) {
    logRow_('ERROR', action, (p && p.id) || '', (p && p.by) || '', String(err));
    return { ok:false, error:String(err) };
  } finally {
    lock.releaseLock();
  }
}

/** คืน error object ถ้าไม่มีสิทธิ์ / คืน null ถ้าผ่าน — ใช้แบบ  return need_(...) || doWork() */
function need_(sess, cap) {
  if (sess.caps[cap]) return null;
  logRow_('DENY', cap, sess.userId, sess.name, sess.role);
  return { ok:false, error:'ACCESS_DENIED', code:403, need:cap };
}

/* ============================================================ READ ROUTER */

function apiGetObj_(type, token) {
  try {
    var sess = auth_(token);
    if (!sess) return { ok:false, error:'AUTH_REQUIRED', code:401 };
    switch (type) {
      case 'quotations': return { ok:true, quotations:getQuotations_(sess), view:(sess.caps.viewCost ? 'internal' : 'sales') };
      case 'products':   return { ok:true, products:getProducts_(sess) };
      case 'settings':   return getSettings_(sess);
      case 'users':      return { ok:true, users:getUsers_(sess) };
      case 'whoami':     return { ok:true, user:{ id:sess.userId, name:sess.name, role:sess.role, caps:sess.caps } };
      default:           return { ok:false, error:'unknown type: ' + type };
    }
  } catch (err) { return { ok:false, error:String(err) }; }
}

/* ============================================================ QUOTATIONS */

function saveQuote_(p, sess) {
  if (!p.id) return { ok:false, error:'missing id' };
  var sh = sheet_(SH.QUOTES), idx = headerIndex_(sh);
  var row = findRow_(sh, idx, 'Id', p.id);
  var detail = safeDetail_(p.detail);
  var salesText = '';
  if (p.salesDetail) {
    try { salesText = safeDetail_(JSON.stringify(stripCost_(JSON.parse(p.salesDetail)))).text; }
    catch (e) { salesText = ''; }
  }
  var vals = {
    Id:p.id, DocType:p.docType || 'QT', DocNo:p.docNo || '', Ref:p.ref || '',
    Title:p.title || '', Customer:p.customer || '', Sales:p.sales || '',
    SalesUserId:p.salesUserId || '', AssignedTo:p.assignedTo || '',
    Group:p.group || '', Round:num_(p.round, 1), Currency:p.currency || '',
    Incoterm:p.incoterm || '', PriceTerm:p.priceTerm || '', Exrate:num_(p.exrate, 0),
    OfferDate:p.offerDate || '', Stage:p.stage || '', Status:p.status || '',
    FollowStatus:p.followStatus || '',
    NeedsApproval:(p.needsApproval == 1 || p.needsApproval === true) ? 'TRUE' : '',
    ReleasedTo:p.releasedTo || '', SalesNote:p.salesNote || '',
    Lines:num_(p.lines, 0), Total:num_(p.total, 0), Cost:num_(p.cost, 0),
    Profit:num_(p.profit, 0), GP:num_(p.gp, 0),
    Updated:p.updated || todayStr_(), UpdatedAt:nowISO_(), By:sess.name,
    Detail:detail.text
  };
  if (salesText) vals.SalesDetail = salesText;
  writeRow_(sh, idx, row, vals);
  logRow_('save', p.docNo || p.ref || '', p.id, sess.name, detail.note);
  return { ok:true, id:p.id, trimmed:detail.trimmed };
}

/** Sales สร้าง/แก้คำขอราคา (SR) ได้ — server บังคับเจ้าของงานและตัดฟิลด์ต้นทุนทิ้งเสมอ */
function saveSR_(p, sess) {
  if (!p.id) return { ok:false, error:'missing id' };
  var sh = sheet_(SH.QUOTES), idx = headerIndex_(sh);
  var row = findRow_(sh, idx, 'Id', p.id);

  var doc;
  try { doc = JSON.parse(p.detail || '{}'); } catch (e) { return { ok:false, error:'bad detail' }; }
  if (String(doc.docType || 'SR') !== 'SR') return { ok:false, error:'ACCESS_DENIED', code:403 };

  if (row) {
    var cur = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
    if (String(cell_(cur, idx, 'DocType')) !== 'SR') return { ok:false, error:'ACCESS_DENIED', code:403 };
    if (!sess.caps.writeQuote) {
      if (String(cell_(cur, idx, 'SalesUserId')) !== sess.userId) return { ok:false, error:'ACCESS_DENIED', code:403 };
      if (String(cell_(cur, idx, 'AssignedTo') || '')) return { ok:false, error:'SR_LOCKED', code:409 };
      var st = String(cell_(cur, idx, 'Status') || 'Submitted');
      if (st !== 'Draft' && st !== 'Submitted') return { ok:false, error:'SR_LOCKED', code:409 };
    }
  }
  if (!sess.caps.writeQuote) {
    doc.header = doc.header || {};
    doc.header.salesUserId = sess.userId;    // ปลอมเจ้าของงานไม่ได้
    doc.header.sales = sess.name;
    doc.assignedTo = null;
    doc.status = (doc.status === 'Draft') ? 'Draft' : 'Submitted';
  }
  doc = stripCost_(doc);
  // เติมโครงสร้างต้นทุนเริ่มต้นให้ครบฝั่งเซิร์ฟเวอร์ ฝั่ง Sales จึงไม่ต้องรู้จักฟิลด์เหล่านี้เลย
  doc.lines = (doc.lines || []).map(function (L) {
    return {
      code: L.code || '', desc: L.desc || '', group: L.group || '', comGroup: L.comGroup || '',
      uom: L.uom || 'pcs', qty: Number(L.qty) || 1,
      up: 0, costCur: (doc.header && doc.header.currency) || 'THB',
      dutyPct: 0, clearancePct: 0, opPct: 0, freep: 0, extras: [],
      targetUp: Number(L.targetUp) || 0, salesNote: L.salesNote || '',
      warranty: L.warranty || '', lead: L.lead || ''
    };
  });
  var d = safeDetail_(JSON.stringify(doc));

  writeRow_(sh, idx, row, {
    Id:p.id, DocType:'SR', DocNo:doc.docNo || '', Ref:(doc.header && doc.header.ref) || '',
    Title:(doc.header && doc.header.title) || '', Customer:(doc.header && doc.header.customer) || '',
    Sales:(doc.header && doc.header.sales) || '', SalesUserId:(doc.header && doc.header.salesUserId) || '',
    AssignedTo:doc.assignedTo || '', Group:(doc.header && doc.header.groupType) || '',
    Round:1, Currency:(doc.header && doc.header.currency) || '', Status:doc.status || 'Submitted',
    FollowStatus:doc.followStatus || 'Requested', SalesNote:doc.salesNote || '',
    Lines:(doc.lines || []).length, Total:0, Cost:0, Profit:0, GP:0,
    Updated:todayStr_(), UpdatedAt:nowISO_(), By:sess.name,
    Detail:d.text, SalesDetail:d.text
  });
  logRow_('saveSR', doc.docNo || '', p.id, sess.name, '');
  return { ok:true, id:p.id };
}

/** Sales อัปเดตเฉพาะ field ของตัวเอง — เขียนทับทั้งใบไม่ได้ */
var SALES_PATCH_FIELDS = ['salesNote','followUpDate','salesUpdate','salesUpdatedAt'];
function salesPatch_(p, sess) {
  if (!p.id) return { ok:false, error:'missing id' };
  var sh = sheet_(SH.QUOTES), idx = headerIndex_(sh);
  var row = findRow_(sh, idx, 'Id', p.id);
  if (!row) return { ok:false, error:'not found' };
  var cur = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];

  var owner = String(cell_(cur, idx, 'SalesUserId') || '');
  if (!sess.caps.viewAllSales && owner !== sess.userId) return { ok:false, error:'ACCESS_DENIED', code:403 };

  var patch;
  try { patch = JSON.parse(p.patch || '{}'); } catch (e) { return { ok:false, error:'bad patch' }; }

  var applied = {};
  for (var i = 0; i < SALES_PATCH_FIELDS.length; i++) {
    var k = SALES_PATCH_FIELDS[i];
    if (patch.hasOwnProperty(k)) applied[k] = stripCost_(patch[k]);
  }
  if (!Object.keys(applied).length) return { ok:false, error:'nothing to patch' };

  var audit = { timestamp:nowISO_(), user:sess.name, role:sess.role,
                action:String(p.note || 'Sales update').slice(0, 300) };
  patchDetailCells_(sh, idx, row, applied, audit);
  var vals = { Updated:todayStr_(), UpdatedAt:nowISO_(), By:sess.name };
  if (applied.salesNote !== undefined) vals.SalesNote = applied.salesNote;
  writeRow_(sh, idx, row, vals);
  logRow_('salesPatch', String(cell_(cur, idx, 'DocNo') || ''), p.id, sess.name, Object.keys(applied).join(','));
  return { ok:true, id:p.id };
}

/** ปล่อยราคา — server ตัดสินเองว่าให้สิทธิ์ใคร โดยอ่านเจ้าของงานจากเอกสาร */
function release_(p, sess) {
  if (!p.id) return { ok:false, error:'missing id' };
  var sh = sheet_(SH.QUOTES), idx = headerIndex_(sh);
  var row = findRow_(sh, idx, 'Id', p.id);
  if (!row) return { ok:false, error:'not found' };
  var cur = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];

  if (!(sess.caps.approve || isReleaser_(sess.userId))) return { ok:false, error:'ACCESS_DENIED', code:403 };
  if (String(cell_(cur, idx, 'Status')) !== 'Approved') return { ok:false, error:'NOT_APPROVED', code:409 };

  var owner = String(cell_(cur, idx, 'SalesUserId') || '');
  if (!owner) return { ok:false, error:'NO_OWNER', code:409 };

  var rel = String(cell_(cur, idx, 'ReleasedTo') || '').split('|').filter(function (x) { return x; });
  if (rel.indexOf(owner) < 0) rel.push(owner);

  var audit = { timestamp:nowISO_(), user:sess.name, role:sess.role,
                action:'Released price — Approved → Pending · ให้สิทธิ์ ' + owner };
  patchDetailCells_(sh, idx, row, { status:'Pending', followStatus:'Sent', releasedTo:rel,
                                    releasedAt:nowISO_(), releasedBy:sess.userId }, audit);
  writeRow_(sh, idx, row, { Status:'Pending', FollowStatus:'Sent', ReleasedTo:rel.join('|'),
                            Updated:todayStr_(), UpdatedAt:nowISO_(), By:sess.name });
  logRow_('release', String(cell_(cur, idx, 'DocNo') || ''), p.id, sess.name, owner);
  return { ok:true, id:p.id, releasedTo:rel };
}

/** แก้ JSON ทั้ง Detail และ SalesDetail พร้อมกัน เพื่อให้สองมุมมองไม่หลุดจากกัน */
function patchDetailCells_(sh, idx, row, patch, audit) {
  ['Detail', 'SalesDetail'].forEach(function (col) {
    if (!idx[col]) return;
    var cellRange = sh.getRange(row, idx[col]);
    var raw = String(cellRange.getValue() || '');
    if (!raw) return;
    var d; try { d = JSON.parse(raw); } catch (e) { return; }
    for (var k in patch) if (patch.hasOwnProperty(k)) d[k] = patch[k];
    d.updatedAt = nowISO_();
    if (col === 'Detail') { if (audit) { if (!d.auditLogs) d.auditLogs = []; d.auditLogs.push(audit); } }
    else { delete d.auditLogs; }
    cellRange.setValue(safeDetail_(JSON.stringify(d)).text);
  });
}

function deleteQuote_(p, sess) {
  if (!p.id) return { ok:false, error:'missing id' };
  var sh = sheet_(SH.QUOTES), idx = headerIndex_(sh);
  var row = findRow_(sh, idx, 'Id', p.id);
  if (!row) return { ok:true, id:p.id, note:'not found' };
  var cur = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];

  if (!sess.caps.writeQuote) {
    if (String(cell_(cur, idx, 'DocType')) !== 'SR') return { ok:false, error:'ACCESS_DENIED', code:403 };
    if (String(cell_(cur, idx, 'SalesUserId')) !== sess.userId) return { ok:false, error:'ACCESS_DENIED', code:403 };
    if (String(cell_(cur, idx, 'AssignedTo') || '')) return { ok:false, error:'SR_LOCKED', code:409 };
  }
  var stamp = nowISO_();
  patchDetailCells_(sh, idx, row, { deleted:true, deletedAt:stamp, deletedBy:sess.name }, null);
  writeRow_(sh, idx, row, { Deleted:'TRUE', DeletedAt:stamp, DeletedBy:sess.name, UpdatedAt:stamp });
  logRow_('delete', '', p.id, sess.name, '');
  return { ok:true, id:p.id, deleted:true };
}

/* ---------------- projection ---------------- */

/** ผู้ปล่อยราคา (gatekeeper) ฝั่ง server — ต้องทนต่อกรณี id ใน Settings ไม่ตรงกับบัญชีจริง
 *  ลำดับ: ค่าใน Settings (ถ้ามี user จริง) → ผู้ใช้ Sales ที่ชื่อ NON → ค่า default
 *  ถ้าไม่ resolve ให้ถูก NON จะไม่ได้รับราคาจาก server เลย (อาการ: หน้าจอ "รอ NON ปล่อยราคา" ในมุมมองของ NON เอง) */
function gatekeeperId_() {
  var set = '';
  try { set = String(getSettingsRaw_().releaseGatekeeperId || ''); } catch (e) {}
  var users = [];
  try {
    var sh = sheet_(SH.USERS), idx = headerIndex_(sh), last = sh.getLastRow();
    if (last >= 2) {
      var rows = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
      for (var i = 0; i < rows.length; i++) {
        users.push({ id: String(cell_(rows[i], idx, 'Id') || ''),
                     name: String(cell_(rows[i], idx, 'Name') || ''),
                     role: String(cell_(rows[i], idx, 'Role') || '') });
      }
    }
  } catch (e) {}
  // 1) ค่าที่ตั้งไว้ ถ้าตรงกับผู้ใช้จริง
  for (var a = 0; a < users.length; a++) if (users[a].id === set && set) return set;
  // 2) ผู้ใช้ฝ่ายขายที่ชื่อ NON
  for (var b = 0; b < users.length; b++) {
    if (users[b].role === 'Sales' && users[b].name.trim().toUpperCase() === 'NON') return users[b].id;
  }
  // 3) ค่าที่ตั้งไว้ (แม้หา user ไม่เจอ) หรือ default
  return set || 'sales_non';
}

/** ผู้ปล่อยราคาสำรอง (delegate) — ใช้ตอน NON ลา ตั้งค่าจากหน้าตั้งค่าของแอปหลัก */
function releaseDelegateId_() {
  try { return String(getSettingsRaw_().releaseDelegateId || ''); }
  catch (e) { return ''; }
}
/** ผู้ที่มีสิทธิ์เห็นราคาก่อนปล่อย + กดปล่อยราคาได้ */
function isReleaser_(userId) {
  if (!userId) return false;
  return userId === gatekeeperId_() || (releaseDelegateId_() && userId === releaseDelegateId_());
}

function getQuotations_(sess) {
  var sh = sheet_(SH.QUOTES), last = sh.getLastRow();
  if (last < 2) return [];
  var idx = headerIndex_(sh);
  var data = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  var internal = !!sess.caps.viewCost;
  // PERF: resolve ครั้งเดียวก่อนเข้าลูป — เดิมเรียก isReleaser_() ต่อแถว ทำให้อ่าน Users sheet
  //       และ Settings ซ้ำหลายร้อยรอบต่อการโหลดหนึ่งครั้ง จนหน้าจอโหลดไม่ขึ้น
  var gate = internal ? '' : gatekeeperId_();
  var delegate = internal ? '' : releaseDelegateId_();
  var iAmReleaser = !internal && (sess.userId === gate || (delegate && sess.userId === delegate));
  var out = [];

  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    var id = cell_(r, idx, 'Id');
    if (!id) continue;

    var base = {
      id:String(id),
      docType:cell_(r, idx, 'DocType'), docNo:cell_(r, idx, 'DocNo'), ref:cell_(r, idx, 'Ref'),
      title:cell_(r, idx, 'Title'), status:cell_(r, idx, 'Status'),
      customer:cell_(r, idx, 'Customer'), sales:cell_(r, idx, 'Sales'),
      salesUserId:cell_(r, idx, 'SalesUserId'), assignedTo:cell_(r, idx, 'AssignedTo'),
      group:cell_(r, idx, 'Group'), round:cell_(r, idx, 'Round'), currency:cell_(r, idx, 'Currency'),
      releasedTo:cell_(r, idx, 'ReleasedTo'),
      updated:cell_(r, idx, 'Updated'), updatedAt:cell_(r, idx, 'UpdatedAt'),
      deleted:String(cell_(r, idx, 'Deleted')).toUpperCase() === 'TRUE'
    };

    if (internal) {
      base.needsApproval = String(cell_(r, idx, 'NeedsApproval')).toUpperCase() === 'TRUE';
      base.total  = Number(cell_(r, idx, 'Total'))  || 0;
      base.cost   = Number(cell_(r, idx, 'Cost'))   || 0;
      base.profit = Number(cell_(r, idx, 'Profit')) || 0;
      base.gp     = Number(cell_(r, idx, 'GP'))     || 0;
      base.detail = cell_(r, idx, 'Detail');
      out.push(base);
      continue;
    }

    /* ---------- SALES PROJECTION (ไม่มี cost / profit / gp / Detail เด็ดขาด) ---------- */
    // 1) row-level: เห็นเฉพาะงานของตัวเอง (gatekeeper / Sales Manager เห็นทั้งทีม)
    var owner = String(base.salesUserId || '');
    if (!sess.caps.viewAllSales && sess.userId !== gate && owner !== sess.userId) continue;

    // 2) field-level: ราคาออกไปได้ต่อเมื่อปล่อยราคาแล้วเท่านั้น
    //    ยกเว้น gatekeeper/ผู้รับมอบหมาย — ต้องเห็นราคาตั้งแต่ Approved เพื่อ "ตรวจก่อนปล่อย"
    //    (ถ้าไม่ยกเว้น จะเกิด deadlock: NON ต้องเห็นราคาถึงจะปล่อยได้ แต่ราคาถูกซ่อนเพราะยังไม่ปล่อย)
    var docType = String(base.docType || 'QT');
    var status  = String(base.status || '');
    var rel = String(base.releasedTo || '').split('|').filter(function (x) { return x; });
    var releaser = iAmReleaser;
    var released = (rel.indexOf(sess.userId) >= 0);
    var priceStates = ['Approved','Pending','Won','Closed'];
    var inPriceState = priceStates.indexOf(status) >= 0;
    var maySeePrice = (docType === 'SR') ? false
      : ((released && inPriceState) || (releaser && inPriceState));

    base.releasedTo = rel.join('|');
    base.canRelease = (!!releaser && status === 'Approved' && docType !== 'SR');   // ให้ฝั่ง Sales รู้ว่าปุ่มปล่อยราคาต้องขึ้นไหม
    if (docType === 'SR') {
      base.salesDetail = cell_(r, idx, 'SalesDetail') || cell_(r, idx, 'Detail');
      base.priceLocked = false;
    } else if (maySeePrice) {
      base.salesValue  = Number(cell_(r, idx, 'Total')) || 0;
      base.salesDetail = cell_(r, idx, 'SalesDetail');   // ห้ามใช้ Detail เด็ดขาด
      base.priceLocked = false;
    } else {
      base.salesDetail = '';                              // ยังไม่ปล่อยราคา → ไม่ส่งราคาออกไปเลย
      base.priceLocked = true;
    }
    out.push(base);
  }

  out.sort(function (a, b) {
    return String(b.updatedAt || b.updated || '').localeCompare(String(a.updatedAt || a.updated || ''));
  });
  return out.slice(0, MAX_RETURN_ROWS);
}

/* ============================================================ PRODUCTS */

function saveProduct_(p, sess) {
  if (!p.code) return { ok:false, error:'missing code' };
  var sh = sheet_(SH.PRODUCTS), idx = headerIndex_(sh);
  var row = findRow_(sh, idx, 'Code', p.code);
  writeRow_(sh, idx, row, {
    Code:p.code, Desc:p.desc||'', Group:p.group||'', ComGroup:p.comGroup||'', Uom:p.uom||'',
    Warranty:p.warranty||'', Duty:(p.duty===''||p.duty==null)?'':Number(p.duty),
    Supplier:p.supplier||'', Lead:p.lead||'',
    DefaultPrice:(p.defaultPrice===''||p.defaultPrice==null)?'':Number(p.defaultPrice),
    DefaultCur:p.defaultCur||'', BoiPrice:(p.boiPrice===''||p.boiPrice==null)?'':Number(p.boiPrice),
    Updated:nowISO_(), By:sess.name
  });
  return { ok:true, code:p.code };
}

function getProducts_(sess) {
  var sh = sheet_(SH.PRODUCTS), last = sh.getLastRow();
  if (last < 2) return [];
  var idx = headerIndex_(sh);
  var data = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  var internal = !!sess.caps.viewCost;
  var out = [];
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    if (!r[idx['Code'] - 1]) continue;
    var p = { code:String(cell_(r, idx, 'Code')), desc:cell_(r, idx, 'Desc'),
              group:cell_(r, idx, 'Group'), uom:cell_(r, idx, 'Uom'),
              warranty:cell_(r, idx, 'Warranty'), lead:cell_(r, idx, 'Lead') };
    if (internal) {
      p.comGroup = cell_(r, idx, 'ComGroup'); p.duty = cell_(r, idx, 'Duty');
      p.supplier = cell_(r, idx, 'Supplier'); p.defaultPrice = cell_(r, idx, 'DefaultPrice');
      p.defaultCur = cell_(r, idx, 'DefaultCur') || 'USD'; p.boiPrice = cell_(r, idx, 'BoiPrice');
    }
    out.push(p);
  }
  return out;
}

/* ============================================================ SETTINGS */

function saveSettings_(p, sess) {
  var sh = sheet_(SH.SETTINGS), idx = headerIndex_(sh);
  var d = safeDetail_(p.detail);
  var row = (sh.getLastRow() >= 2) ? 2 : null;
  writeRow_(sh, idx, row, { SettingsRev:num_(p.settingsRev,1),
    SettingsUpdatedAt:p.settingsUpdatedAt||nowISO_(), By:sess.name, Detail:d.text });
  logRow_('saveSettings', '', '', sess.name, 'rev ' + p.settingsRev);
  return { ok:true, settingsRev:num_(p.settingsRev,1) };
}

function getSettingsRaw_() {
  var sh = sheet_(SH.SETTINGS);
  if (sh.getLastRow() < 2) return {};
  var idx = headerIndex_(sh);
  var r = sh.getRange(2, 1, 1, sh.getLastColumn()).getValues()[0];
  try { return JSON.parse(String(cell_(r, idx, 'Detail') || '{}')); } catch (e) { return {}; }
}

/** ตารางคอมมิชชั่น / group defaults = โครงสร้างราคาภายใน → ห้ามส่งให้ role ที่ไม่มี viewCost */
var SETTINGS_SALES_ALLOW = ['currencies','priceTerms','incoterms','units','salesList',
  'companyInfo','releaseGatekeeperId','settingsRev','settingsUpdatedAt','groupTypes'];
function getSettings_(sess) {
  var sh = sheet_(SH.SETTINGS);
  if (sh.getLastRow() < 2) return { ok:true };
  var idx = headerIndex_(sh);
  var r = sh.getRange(2, 1, 1, sh.getLastColumn()).getValues()[0];
  var obj = {};
  try { obj = JSON.parse(String(cell_(r, idx, 'Detail') || '{}')); } catch (e) { obj = {}; }
  obj.settingsRev = Number(cell_(r, idx, 'SettingsRev')) || 0;
  obj.settingsUpdatedAt = cell_(r, idx, 'SettingsUpdatedAt');
  delete obj.cloudUrl;

  if (!sess.caps.viewCost) {
    var safe = { ok:true };
    for (var i = 0; i < SETTINGS_SALES_ALLOW.length; i++) {
      var k = SETTINGS_SALES_ALLOW[i];
      if (obj[k] !== undefined) safe[k] = obj[k];
    }
    return safe;
  }
  obj.ok = true;
  return obj;
}

/* ============================================================ USERS */

function saveUsers_(p, sess) {
  var users;
  try { users = (typeof p.users === 'string') ? JSON.parse(p.users) : (p.users || []); }
  catch (e) { return { ok:false, error:'bad users JSON: ' + e }; }
  if (!users.length) return { ok:false, error:'empty user list' };

  var sh = sheet_(SH.USERS), idx = headerIndex_(sh), stamp = nowISO_(), wrote = 0;
  for (var i = 0; i < users.length; i++) {
    var u = users[i];
    if (!u || !u.id) continue;
    if (u.pass !== undefined) delete u.pass;
    var row = findRow_(sh, idx, 'Id', u.id);
    var vals = { Id:u.id, Name:u.name||'', Role:u.role||'',
      Scope:(typeof u.scope === 'string') ? u.scope : JSON.stringify(u.scope || 'all'), Updated:stamp };
    if (u.passHash) vals.PassHash = u.passHash;   // ไม่ส่ง hash มา = ไม่แตะรหัสเดิม
    writeRow_(sh, idx, row, vals);
    wrote++;
  }
  logRow_('saveUsers', '', '', sess.name, wrote + ' users');
  return { ok:true, users:wrote };
}

function getUsers_(sess) {
  var sh = sheet_(SH.USERS), last = sh.getLastRow();
  if (last < 2) return [];
  var idx = headerIndex_(sh);
  var data = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  var out = [];
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    if (!r[idx['Id'] - 1]) continue;
    var u = { id:String(cell_(r, idx, 'Id')), name:cell_(r, idx, 'Name'), role:cell_(r, idx, 'Role') };
    if (sess.caps.viewCost) u.scope = cell_(r, idx, 'Scope') || 'all';
    if (sess.caps.manageUsers) u.passHash = cell_(r, idx, 'PassHash');   // เฉพาะ Admin เท่านั้น
    out.push(u);
  }
  return out;
}

/* ============================================================ SHEET HELPERS */

function ss_() { return SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActive(); }

function sheet_(name) {
  var ss = ss_(), sh = ss.getSheetByName(name), want = HEADERS[name] || [];
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, want.length).setValues([want]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, want.length).setFontWeight('bold').setBackground('#f5efe5');
    return sh;
  }
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, want.length).setValues([want]);
    sh.setFrozenRows(1);
    return sh;
  }
  var have = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0]
               .map(function (h) { return String(h).trim(); });
  var missing = want.filter(function (h) { return have.indexOf(h) < 0; });
  if (missing.length) {
    sh.getRange(1, have.length + 1, 1, missing.length).setValues([missing]);
    sh.getRange(1, 1, 1, have.length + missing.length).setFontWeight('bold');
  }
  return sh;
}

function headerIndex_(sh) {
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0], idx = {};
  for (var i = 0; i < head.length; i++) { var h = String(head[i]).trim(); if (h) idx[h] = i + 1; }
  return idx;
}
function cell_(rowArr, idx, header) {
  var c = idx[header]; if (!c) return '';
  var v = rowArr[c - 1];
  return (v === null || v === undefined) ? '' : v;
}
function findRow_(sh, idx, keyHeader, keyVal) {
  var col = idx[keyHeader]; if (!col) return null;
  var last = sh.getLastRow(); if (last < 2) return null;
  var keys = sh.getRange(2, col, last - 1, 1).getValues(), target = String(keyVal);
  for (var i = 0; i < keys.length; i++) if (String(keys[i][0]) === target) return i + 2;
  return null;
}
function writeRow_(sh, idx, row, obj) {
  var width = sh.getLastColumn(), isNew = !row;
  if (isNew) row = sh.getLastRow() + 1;
  var current = isNew ? new Array(width).fill('') : sh.getRange(row, 1, 1, width).getValues()[0];
  for (var k in obj) { var c = idx[k]; if (c) current[c - 1] = obj[k]; }
  sh.getRange(row, 1, 1, width).setValues([current]);
  return row;
}
function safeDetail_(text) {
  var t = String(text || '');
  if (t.length <= CELL_LIMIT) return { text:t, trimmed:false, note:'' };
  try {
    var d = JSON.parse(t);
    if (d.auditLogs && d.auditLogs.length > 20) d.auditLogs = d.auditLogs.slice(-20);
    t = JSON.stringify(d);
    if (t.length <= CELL_LIMIT) return { text:t, trimmed:true, note:'auditLogs trimmed' };
    d.auditLogs = [];
    t = JSON.stringify(d);
    if (t.length <= CELL_LIMIT) return { text:t, trimmed:true, note:'auditLogs dropped' };
    return { text:JSON.stringify({ id:d.id, _oversize:true }), trimmed:true, note:'OVERSIZE' };
  } catch (e) {
    return { text:t.substring(0, CELL_LIMIT), trimmed:true, note:'raw truncated' };
  }
}
function logRow_(action, docNo, id, by, note) {
  try {
    var sh = sheet_(SH.LOG);
    sh.appendRow([nowISO_(), action + (docNo ? ' ' + docNo : ''), id || '', by || '', note || '']);
    var last = sh.getLastRow();
    if (last > LOG_KEEP_ROWS + 1) sh.deleteRows(2, last - LOG_KEEP_ROWS - 1);
  } catch (e) {}
}
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function num_(v, d) { var n = Number(v); return isNaN(n) ? (d || 0) : n; }
function nowISO_() { return new Date().toISOString(); }
function todayStr_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }

/* ============================================================ MAINTENANCE */

function setup() {
  [SH.QUOTES, SH.PRODUCTS, SH.SETTINGS, SH.USERS, SH.LOG, SH.SESSIONS].forEach(function (n) { sheet_(n); });
  logRow_('setup', '', '', Session.getActiveUser().getEmail() || '-', 'schema v4.0 (RBAC)');
  SpreadsheetApp.getActive().toast('ติดตั้ง/อัปเกรดแท็บเรียบร้อย (schema v4.0 · RBAC)', 'MGS Pricing', 8);
}

/** ตรวจว่าใบไหนยังไม่มี SalesDetail — ใบเหล่านั้น Sales จะยังไม่เห็นราคา */
function healthCheck() {
  var q = sheet_(SH.QUOTES), idx = headerIndex_(q), rows = Math.max(q.getLastRow() - 1, 0);
  var noSales = 0, del = 0;
  if (rows > 0) {
    q.getRange(2, 1, rows, q.getLastColumn()).getValues().forEach(function (r) {
      if (String(cell_(r, idx, 'Deleted')).toUpperCase() === 'TRUE') { del++; return; }
      if (!String(cell_(r, idx, 'SalesDetail') || '')) noSales++;
    });
  }
  Logger.log('Quotations: %s แถว (ลบแล้ว %s)', rows, del);
  Logger.log('ยังไม่มี SalesDetail: %s ใบ → กด "สร้างข้อมูลสำหรับ Sales" ในระบบหลัก', noSales);
  Logger.log('Session ที่ยังไม่หมดอายุ: %s', Math.max(sheet_(SH.SESSIONS).getLastRow() - 1, 0));
}

function revokeAllSessions() {
  var ss = sheet_(SH.SESSIONS), last = ss.getLastRow();
  if (last > 1) ss.deleteRows(2, last - 1);
  logRow_('revokeAllSessions', '', '', '-', 'manual');
  Logger.log('เพิกถอน session ทั้งหมดแล้ว — ทุกคนต้องล็อกอินใหม่');
}

function purgeDeleted(days) {
  days = days || 365;
  var cut = new Date(Date.now() - days * 86400000).toISOString();
  var sh = sheet_(SH.QUOTES), idx = headerIndex_(sh), last = sh.getLastRow();
  if (last < 2) return;
  var data = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues(), removed = 0;
  for (var i = data.length - 1; i >= 0; i--) {
    var r = data[i];
    if (String(cell_(r, idx, 'Deleted')).toUpperCase() === 'TRUE' &&
        String(cell_(r, idx, 'DeletedAt') || '') < cut) { sh.deleteRow(i + 2); removed++; }
  }
  logRow_('purgeDeleted', '', '', '-', removed + ' rows');
  Logger.log('ลบถาวร %s แถว', removed);
}

function backupSpreadsheet() {
  var file = DriveApp.getFileById(ss_().getId());
  var name = 'BACKUP ' + Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HHmm') + ' — ' + file.getName();
  var folder = file.getParents().hasNext() ? file.getParents().next() : DriveApp.getRootFolder();
  file.makeCopy(name, folder);
  logRow_('backup', '', '', '-', name);
}
