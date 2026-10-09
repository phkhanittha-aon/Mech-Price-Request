/*************************************************************
 * MGS PROJECT PRICING — APPS SCRIPT BACKEND  (v4.1 · RBAC + Live Sync)
 * ใช้คู่กับ  Index.html (build 4.1)  และ  Sales.html (build 4.0 ใช้ต่อได้ — API เดิมไม่เปลี่ยน)
 *
 * สิ่งที่เปลี่ยนใน v4.1
 *  A) Visibility: สิทธิ์เห็นต้นทุนตัดสินจาก "tier" ที่เดียว (seesFullData_)
 *     ADMIN / MANAGEMENT / INTERNAL = Full Data เสมอ ทุกสถานะ · เฉพาะ SALES เท่านั้นที่ถูกตัด
 *     + normRole_() — ชื่อ role ในแท็บ Users ที่สะกดต่าง/มีช่องว่าง (เช่น "BD Manager", "procurement mgr ")
 *       เดิมตกไปเป็นสิทธิ์ Sales ทั้งหมด → ผู้จัดการไม่เห็นต้นทุน  ตอนนี้แปลงเป็นชื่อมาตรฐานก่อนเสมอ
 *  B) Live Sync: type=quote&id=…  (ดึงใบเดียว) · type=changes&since=…  (ดึงเฉพาะแถวที่เปลี่ยน)
 *     ทุกคำตอบมี serverTime เพื่อให้ client ใช้นาฬิกาของ server เป็นเกณฑ์
 *  C) Conflict guard: action 'save' รับ baseUpdatedAt — ถ้าบน Sheet ใหม่กว่า ตอบ CONFLICT (409) ไม่เขียนทับ
 *  D) action 'approve' — อนุมัติ 2 ฝ่ายแบบ atomic ฝั่ง server (กัน Procurement/BD กดพร้อมกันแล้วทับกัน)
 *  E) v4.2 Sales App: ล็อกอินด้วยอีเมล (คอลัมน์ Email ในแท็บ Users) + Google Sign-in (ssoLogin)
 *     role ใหม่ 'Sales Manager' (เห็นงานทั้งทีมขาย แต่ไม่เห็นต้นทุน) · คอลัมน์ Active ปิดบัญชีได้
 *     เลข SR ออกโดย server (ไม่ชนกันข้ามเครื่อง) · type=salesview · action changePassword
 *  F) v4.3: ผู้รับผิดชอบงาน + SLA คำนวณที่ server ที่เดียว (followState_) · ส่งติดไปกับทุกแถวเป็น row.follow
 *     งานที่ยังไม่ปล่อยราคา "ไม่ใช่งานค้างของ Sales" อีกต่อไป · ใบ Pending รุ่นเก่าที่ยังไม่ปล่อยจริง → งานของผู้ปล่อยราคา
 *     รหัสผ่าน: เก็บแบบ v2$salt$hash (salt ต่อผู้ใช้ + วนซ้ำ) ค่าใน Sheet ใช้ล็อกอินแทนรหัสไม่ได้แล้ว · ผิด 5 ครั้งล็อก 15 นาที
 *     valueTHB: มูลค่าใบแปลงเป็นบาทด้วยอัตราที่ล็อกไว้ในใบ (ใช้รวมยอดข้ามสกุลเงิน)
 *     → หลังวางไฟล์ รัน setup() หนึ่งครั้ง (แปลง hash รหัสผ่านเดิมเป็น v2 ให้อัตโนมัติ ผู้ใช้ไม่ต้องตั้งรหัสใหม่)
 *  G) v4.4 (Phase 2 Login): ตัวตนมาจากอีเมล Google ของผู้ที่เปิดหน้าเว็บก่อน (Session.getActiveUser) แล้วค่อยใช้รหัสผ่าน
 *     · ไม่ใช้ getEffectiveUser() เป็นตัวตน — ถ้า Deploy แบบ "Execute as: Me" ค่านี้คืออีเมลเจ้าของสคริปต์เสมอ
 *       (ทุกคนจะกลายเป็นเจ้าของสคริปต์) จึงใช้ได้แค่แสดงผลวินิจฉัยเท่านั้น
 *     · ทุก request ดึง role / สถานะ Active ใหม่จากแท็บ Users (เดิมใช้ role ที่จำไว้ตอนล็อกอิน นานสุด 12 ชม.)
 *     · เปิดลิงก์หลัก (ไม่มี ?app=) → server เลือกหน้าให้ตามสิทธิ์ของอีเมลนั้น: Sales → แอป Sales, ทีมภายใน → ระบบทำราคา
 *  * v4.2: รัน setup() หนึ่งครั้ง เพื่อเพิ่มคอลัมน์ Email / Active ในแท็บ Users แล้ว Deploy → New version
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

var APP_VERSION = '4.5';   // ต้องตรงกับ APP_VERSION ใน Index.html / Sales.html (แสดงที่หน้า login และ ?diag=1)
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
  Users:      ['Id','Name','Role','Scope','PassHash','Updated','Email','Active'],
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
  'Sales Manager':   {tier:'SALES',      viewCost:false, writeQuote:false, approve:false, manageUsers:false, manageSetting:false, viewAllSales:true },
  'Sales':           {tier:'SALES',      viewCost:false, writeQuote:false, approve:false, manageUsers:false, manageSetting:false, viewAllSales:false}
};
var DEFAULT_CAPS = ROLE_MATRIX['Sales'];   // role ที่ไม่รู้จัก → ได้สิทธิ์ต่ำสุดเสมอ

/** ชื่อเรียกอื่นที่พบในแท็บ Users → ชื่อ role มาตรฐาน (คีย์เป็นตัวพิมพ์เล็ก เว้นวรรคเดียว) */
var ROLE_ALIASES = {
  'gm':'GM', 'general manager':'GM',
  'admin':'Admin', 'administrator':'Admin',
  'procurement mgr':'Procurement Mgr', 'procurement manager':'Procurement Mgr', 'procurement mgr.':'Procurement Mgr',
  'bd mgr':'BD Mgr', 'bd manager':'BD Mgr', 'bd mgr.':'BD Mgr', 'business development manager':'BD Mgr',
  'sourcing':'Sourcing', 'sales':'Sales',
  'sales manager':'Sales Manager', 'sales mgr':'Sales Manager', 'sales mgr.':'Sales Manager'
};
/** คืนชื่อ role มาตรฐานเสมอ — ไม่รู้จัก = 'Sales' (สิทธิ์ต่ำสุด) */
function normRole_(role) {
  var raw = String(role || '').trim();
  if (ROLE_MATRIX[raw]) return raw;
  return ROLE_ALIASES[raw.toLowerCase().replace(/\s+/g, ' ')] || 'Sales';
}
function capsOf_(role) { return ROLE_MATRIX[normRole_(role)] || DEFAULT_CAPS; }

/** BUSINESS RULE: tier ที่ได้ข้อมูลเต็ม (Cost / Profit / GP / Detail) เสมอ ทุกสถานะ — ไม่มีการ strip
 *  เฉพาะ tier SALES เท่านั้นที่ถูกตัดต้นทุน */
var FULL_DATA_TIERS = ['ADMIN', 'MANAGEMENT', 'INTERNAL'];
function seesFullData_(sess) {
  return !!(sess && sess.caps && FULL_DATA_TIERS.indexOf(sess.caps.tier) >= 0 && sess.caps.viewCost);
}

/* ---- dual approval (ต้องตรงกับ REQUIRED_APPROVAL_ROLES / APPROVAL_OVERRIDE_ROLES ใน Index.html) ---- */
var REQUIRED_APPROVAL_ROLES = ['Procurement Mgr', 'BD Mgr'];
var APPROVAL_OVERRIDE_ROLES = ['GM'];      // GM อนุมัติแทนได้ทั้ง 2 ขาในครั้งเดียว
var PRICE_STATES = ['Approved', 'Pending', 'Won', 'Closed'];

/* ============================================================ CONFIG — ค่าตั้งต้นรวมไว้ที่เดียว
 * SLA (วันทำการ จ.–ศ., ยังไม่รวมวันหยุดนักขัตฤกษ์) ต่อผู้รับผิดชอบ — แก้ได้ที่นี่ หรือใส่ Settings.sla = {...} ทับ
 *   เฝ้าระวัง = ถึงกำหนดวันนี้ · เกินกำหนด = เลยกำหนดแล้ว
 * salesUpdateDays (วันปฏิทิน) = Sales ต้องอัปเดตความคืบหน้าอย่างน้อยทุก N วัน หลังได้ราคา */
var FOLLOW_CFG = {
  sla: { SOURCING:3, MANAGEMENT:2, RELEASER:1, REPAIR:1 },
  salesUpdateDays: 7
};
var LOGIN_CFG = { maxFails:5, lockMinutes:15, hashRounds:1000 };

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
  var prm = (e && e.parameter) || {};
  var type = prm.type || '';
  if (prm.diag) return HtmlService.createHtmlOutput(diagHtml_()).setTitle('MGS — ตรวจระบบ');
  if (!type) {
    var page = String((e && e.parameter && e.parameter.app) || (e && e.parameter && e.parameter.page) || DEFAULT_PAGE).toLowerCase();
    var isSales = (page === 'sales');
    // v4.4: ลิงก์เดียวใช้ได้ทุกคน — ไม่ระบุ ?app= แล้วอีเมล Google เป็นของ Sales → เปิดแอป Sales ให้เลย (ใช้แค่เลือกหน้า ไม่ใช่การให้สิทธิ์)
    if (!page) {
      try { var who = googleIdentity_(); if (who.user && who.user.tier === 'SALES' && who.user.active) isSales = true; } catch (err) {}
    }
    return HtmlService.createHtmlOutputFromFile(isSales ? 'Sales' : 'Index')
      .setTitle(isSales ? 'MGS Sales — ติดตามงานขาย' : 'MGS Project Pricing')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, viewport-fit=cover')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  return json_(apiGetObj_(type, prm.token || '', prm.id || prm.since || ''));
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

/** google.script.run.apiGet(type, token, arg) — arg = id (type 'quote') หรือ since (type 'changes') */
function apiGet(type, token, arg) { return JSON.stringify(apiGetObj_(type, token, arg)); }

/** หน้าตรวจระบบ ( …/exec?diag=1 ) — ไม่ต้องล็อกอิน · ไม่แสดงข้อมูลผู้ใช้หรือราคา
 *  ใช้ตรวจอาการ "หน้าว่าง": ไฟล์ HTML มีครบไหม · ถูกวางไม่ครบ (ไม่มี </html> ท้ายไฟล์) ไหม · Deploy เวอร์ชันใหม่แล้วหรือยัง */
function diagHtml_() {
  var rows = [];
  var add = function (name, ok, detail) {
    rows.push('<tr><td>' + (ok ? '✅' : '❌') + '</td><td><b>' + name + '</b></td><td>' + detail + '</td></tr>');
  };
  add('Code.gs', true, 'version ' + APP_VERSION + ' · ' + nowISO_());
  var g = {}; try { g = googleIdentity_(); } catch (e) {}
  var eff = ''; try { eff = String(Session.getEffectiveUser().getEmail() || ''); } catch (e) {}
  add('อีเมล Google ของผู้เปิดหน้านี้', !!g.email, g.email ? (g.email + (g.user ? ' → ' + g.user.name + ' (' + g.user.role + (g.user.active ? '' : ' · ปิดใช้งาน') + ')' : ' — <b>ยังไม่มีในแท็บ Users</b>'))
      : 'อ่านไม่ได้ (ล็อกอินด้วยรหัสผ่านแทนได้) — ตรวจ Deploy: Who has access = ทุกคนในโดเมน · สคริปต์รันในนาม: ' + (eff || '-'));
  [['Index', "APP_VERSION='" + APP_VERSION + "'"], ['Sales', "APP_VERSION='" + APP_VERSION + "'"]].forEach(function (f) {
    try {
      var c = HtmlService.createHtmlOutputFromFile(f[0]).getContent();
      var tail = c.replace(/\s+$/, '').slice(-7).toLowerCase();
      var complete = tail === '</html>';
      var guard = c.indexOf('window.__booted=true') > 0;
      add('ไฟล์ HTML "' + f[0] + '"', complete && c.indexOf(f[1]) > 0,
        (c.length / 1024).toFixed(0) + ' KB · ' + (complete ? 'ครบถึง &lt;/html&gt;' : '<b style="color:#bb3b2f">ไม่ครบ — ไฟล์ถูกตัดท้าย ให้วางใหม่ทั้งไฟล์</b>') +
        ' · ' + (c.indexOf(f[1]) > 0 ? 'เวอร์ชัน ' + f[1] : '<b style="color:#bb3b2f">ไม่ใช่เวอร์ชัน 4.2</b>') + (guard ? '' : ' · ไม่มี boot guard'));
    } catch (e) {
      add('ไฟล์ HTML "' + f[0] + '"', false, 'ไม่พบไฟล์ชื่อ <b>' + f[0] + '</b> (ต้องตั้งชื่อตรงตัวพิมพ์ ไม่ต้องใส่ .html) — ' + String(e));
    }
  });
  try {
    var uh = headerIndex_(sheet_(SH.USERS));
    add('แท็บ Users', !!(uh.Email && uh.Active), uh.Email ? 'มีคอลัมน์ Email / Active' : 'ยังไม่มีคอลัมน์ Email → รัน setup() หนึ่งครั้ง');
  } catch (e) { add('Google Sheet', false, String(e)); }
  return '<meta name="viewport" content="width=device-width,initial-scale=1"><div style="font:14px/1.7 system-ui,sans-serif;max-width:760px;margin:24px auto;padding:0 16px">' +
    '<h2>MGS Pricing — ตรวจระบบ</h2><table cellpadding="8" style="border-collapse:collapse;width:100%">' + rows.join('') + '</table>' +
    '<p style="color:#8a7d6c;font-size:12.5px">ถ้าทุกข้อเป็น ✅ แต่หน้ายังว่าง: ลองเปิดในหน้าต่าง Incognito ที่ล็อกอิน Google บัญชีเดียว ' +
    '(Apps Script มักแสดงหน้าว่างเมื่อเบราว์เซอร์ล็อกอินหลายบัญชีพร้อมกัน)</p></div>';
}

/* ============================================================ SESSION / AUTH */

function newToken_() {
  return Utilities.getUuid().replace(/-/g, '') + Math.random().toString(36).slice(2, 10);
}

/** หาแถวผู้ใช้จาก Id / Name / Email (ไม่สนตัวพิมพ์เล็กใหญ่) */
function findUserRow_(key) {
  key = String(key || '').trim().toLowerCase();
  if (!key) return null;
  var sh = sheet_(SH.USERS), idx = headerIndex_(sh), last = sh.getLastRow();
  if (last < 2) return null;
  var data = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  var byEmail = key.indexOf('@') > 0;
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    if (byEmail ? String(cell_(r, idx, 'Email')).trim().toLowerCase() === key
                : (String(cell_(r, idx, 'Id')).trim().toLowerCase() === key ||
                   String(cell_(r, idx, 'Name')).trim().toLowerCase() === key)) return { r:r, idx:idx };
  }
  return null;
}
function isActiveUser_(r, idx) { return String(cell_(r, idx, 'Active')).trim().toUpperCase() !== 'FALSE'; }

/* ============================================================ PASSWORD STORAGE (v4.3)
 * client ส่ง clientHash = SHA-256(รหัส + salt กลาง) มาเหมือนเดิม (รหัสจริงไม่ออกจากเครื่อง)
 * server เก็บ  v2$<salt ต่อผู้ใช้>$<SHA-256 วนซ้ำ LOGIN_CFG.hashRounds รอบ ของ salt:clientHash>
 * → ค่าในคอลัมน์ PassHash เอาไปล็อกอินแทนรหัสไม่ได้ (เดิมได้ = pass-the-hash)
 * ค่าเก่า (64 hex) ยังล็อกอินได้ และถูกแปลงเป็น v2 ทันทีที่ล็อกอินสำเร็จ / หรือรัน migratePasswordHashes() */
function hex_(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) { var b = (bytes[i] + 256) % 256; out += (b < 16 ? '0' : '') + b.toString(16); }
  return out;
}
function pwDigest_(salt, clientHash) {
  var h = salt + ':' + clientHash;
  for (var i = 0; i < LOGIN_CFG.hashRounds; i++)
    h = hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + ':' + salt, Utilities.Charset.UTF_8));
  return h;
}
function pwWrap_(clientHash) {
  var salt = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  return 'v2$' + salt + '$' + pwDigest_(salt, clientHash);
}
/** คืน {ok, upgrade} — upgrade=true เมื่อเป็นค่าแบบเก่าที่ควรแปลงเป็น v2 */
function pwVerify_(stored, clientHash) {
  stored = String(stored || ''); clientHash = String(clientHash || '');
  if (!stored || !clientHash) return { ok:false };
  if (stored.indexOf('v2$') === 0) {
    var parts = stored.split('$');
    return { ok: parts.length === 3 && pwDigest_(parts[1], clientHash) === parts[2], upgrade:false };
  }
  return { ok: stored === clientHash, upgrade:true };   // legacy: เก็บ clientHash ตรง ๆ
}
/** แปลง hash รหัสผ่านแบบเก่าทั้งชีทเป็น v2 — ไม่ต้องรู้รหัสจริง (v2 ห่อ clientHash เดิมอีกชั้น) · รันซ้ำได้ปลอดภัย */
function migratePasswordHashes() {
  var sh = sheet_(SH.USERS), idx = headerIndex_(sh), last = sh.getLastRow(), n = 0;
  if (last < 2 || !idx.PassHash) return 0;
  var rng = sh.getRange(2, idx.PassHash, last - 1, 1), vals = rng.getValues();
  for (var i = 0; i < vals.length; i++) {
    var v = String(vals[i][0] || '');
    if (/^[0-9a-f]{64}$/.test(v)) { vals[i][0] = pwWrap_(v); n++; }
  }
  if (n) rng.setValues(vals);
  logRow_('migratePasswordHashes', '', '', '-', n + ' users');
  return n;
}

/* ---- จำกัดการกรอกรหัสผิด: ผิด maxFails ครั้งภายใน lockMinutes → ล็อกชั่วคราว (เก็บใน CacheService ไม่แตะชีท) ---- */
function loginLockKey_(key) { return 'loginfail:' + String(key || '').trim().toLowerCase().slice(0, 120); }
function loginLocked_(key) {
  try { var v = CacheService.getScriptCache().get(loginLockKey_(key)); return v ? JSON.parse(v) : { n:0 }; }
  catch (e) { return { n:0 }; }
}
function loginFail_(key) {
  var st = loginLocked_(key); st.n = (st.n || 0) + 1;
  if (st.n >= LOGIN_CFG.maxFails) st.until = Date.now() + LOGIN_CFG.lockMinutes * 60000;
  try { CacheService.getScriptCache().put(loginLockKey_(key), JSON.stringify(st), LOGIN_CFG.lockMinutes * 60); } catch (e) {}
  return st;
}
function loginClear_(key) { try { CacheService.getScriptCache().remove(loginLockKey_(key)); } catch (e) {} }

/** ล็อกอินด้วย Username / ชื่อ / อีเมล + รหัสผ่าน */
function login_(p) {
  var name = String(p.user || '').trim().toLowerCase();
  var hash = String(p.passHash || '');
  if (!name || !hash) return { ok:false, error:'AUTH_FAILED' };
  var f = findUserRow_(name);
  var lockKey = f ? 'id:' + String(cell_(f.r, f.idx, 'Id')).toLowerCase() : 'key:' + name;
  var lk = loginLocked_(lockKey);
  if (lk.until && lk.until > Date.now()) {
    logRow_('login-locked', '', name, '', 'locked');
    return { ok:false, error:'ACCOUNT_LOCKED', minutes:Math.ceil((lk.until - Date.now()) / 60000) };
  }
  // ข้อความเดียวกันทั้งกรณีไม่มีบัญชีและรหัสผิด — ไม่บอกใบ้ว่ามีบัญชีนี้อยู่จริงไหม
  var v = f ? pwVerify_(cell_(f.r, f.idx, 'PassHash'), hash) : { ok:false };
  if (!v.ok) {
    var st = loginFail_(lockKey);
    logRow_('login-fail', '', name, '', (f ? 'bad password' : 'no such user') + ' #' + st.n);
    return st.until ? { ok:false, error:'ACCOUNT_LOCKED', minutes:LOGIN_CFG.lockMinutes }
                    : { ok:false, error:'AUTH_FAILED', left:Math.max(LOGIN_CFG.maxFails - st.n, 0) };
  }
  if (!isActiveUser_(f.r, f.idx)) { logRow_('login-fail', '', name, '', 'inactive'); return { ok:false, error:'ACCOUNT_DISABLED' }; }
  loginClear_(lockKey);
  if (v.upgrade) {   // แปลง hash เดิมเป็น v2 ทันที
    var ush = sheet_(SH.USERS), uidx = headerIndex_(ush), urow = findRow_(ush, uidx, 'Id', String(cell_(f.r, f.idx, 'Id')));
    if (urow && uidx.PassHash) ush.getRange(urow, uidx.PassHash).setValue(pwWrap_(hash));
  }
  return issueSession_(f.r, f.idx, p.agent, 'password');
}

/** อีเมล Google ของ "คนที่เปิดหน้าเว็บ" — Google ยืนยันให้ฝั่ง server (ปลอมจาก client ไม่ได้)
 *  ได้ค่าเมื่อ Deploy แบบ "Execute as: User accessing the web app"
 *  หรือ "Execute as: Me" + Who has access = ทุกคนในโดเมน (ผู้ใช้อยู่ใน Workspace เดียวกัน)
 *  Gmail ส่วนตัว / เปิดแบบไม่ล็อกอิน / WebView บางแอป → ได้ค่าว่าง → ใช้รหัสผ่านแทน
 *  ⚠ ห้ามใช้ getEffectiveUser() แทน: ใน "Execute as: Me" มันคืออีเมลเจ้าของสคริปต์สำหรับทุกคน */
function googleIdentity_() {
  var email = '';
  try { email = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase(); } catch (e) {}
  if (!email) return { email:'' };
  var f = findUserRow_(email);
  if (!f) return { email:email };
  var role = normRole_(cell_(f.r, f.idx, 'Role'));
  return { email:email, f:f, user:{ id:String(cell_(f.r, f.idx, 'Id')), name:String(cell_(f.r, f.idx, 'Name')),
           role:role, tier:capsOf_(role).tier, active:isActiveUser_(f.r, f.idx) } };
}
/** Google Sign-in — เส้นทางหลัก: ไม่ต้องกรอกอะไร ถ้าอีเมลตรงกับแท็บ Users และบัญชีเปิดใช้งาน */
function ssoLogin_(p) {
  var g = googleIdentity_();
  if (!g.email) return { ok:false, error:'SSO_UNAVAILABLE' };
  if (!g.f) { logRow_('sso-fail', '', g.email, '', 'no user with this email'); return { ok:false, error:'SSO_NO_USER', email:g.email }; }
  if (!g.user.active) { logRow_('sso-fail', '', g.email, g.user.name, 'inactive'); return { ok:false, error:'ACCOUNT_DISABLED', email:g.email }; }
  return issueSession_(g.f.r, g.f.idx, p.agent, 'google');
}

function issueSession_(found, idx, agent, method) {
  var role = normRole_(cell_(found, idx, 'Role'));   // ชื่อ role มาตรฐานเสมอ (กันสะกดต่าง → ตกเป็น Sales)
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
    Expires:exp.toISOString(), Agent:String(agent || '').slice(0, 120)
  });
  logRow_('login', '', String(cell_(found, idx, 'Id')), String(cell_(found, idx, 'Name')), role + ' · ' + (method || 'password'));

  return { ok:true, token:token, expires:exp.toISOString(),
    user:{ id:String(cell_(found, idx, 'Id')), name:String(cell_(found, idx, 'Name')),
           email:String(cell_(found, idx, 'Email') || ''), role:role, tier:caps.tier, caps:caps } };
}

/** ผู้ใช้เปลี่ยนรหัสผ่านของตัวเอง (เดิมต้องผ่าน saveUsers ซึ่งต้องมีสิทธิ์ manageUsers → คนทั่วไปเปลี่ยนรหัสไม่ได้จริง) */
function changePassword_(p, sess) {
  var oldH = String(p.oldHash || ''), newH = String(p.newHash || '');
  if (!/^[0-9a-f]{64}$/.test(newH)) return { ok:false, error:'BAD_HASH' };
  var sh = sheet_(SH.USERS), idx = headerIndex_(sh);
  var row = findRow_(sh, idx, 'Id', sess.userId);
  if (!row) return { ok:false, error:'not found' };
  var cur = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
  var stored = String(cell_(cur, idx, 'PassHash') || '');
  if (stored && !pwVerify_(stored, oldH).ok) { logRow_('changePassword-fail', '', sess.userId, sess.name, 'bad old password'); return { ok:false, error:'BAD_OLD_PASSWORD' }; }
  writeRow_(sh, idx, row, { PassHash:pwWrap_(newH), Updated:nowISO_() });
  logRow_('changePassword', '', sess.userId, sess.name, '');
  return { ok:true };
}

var AUTH_FAIL_ = '';   // เหตุผลที่ auth_ ล่าสุดไม่ผ่าน (ส่งให้ client แสดงข้อความถูกต้อง)
function authError_() { var r = AUTH_FAIL_ || 'NO_SESSION'; AUTH_FAIL_ = ''; return { ok:false, error:'AUTH_REQUIRED', code:401, reason:r }; }
function auth_(token) {
  AUTH_FAIL_ = '';
  if (!token) return null;
  var ss = sheet_(SH.SESSIONS), idx = headerIndex_(ss);
  if (ss.getLastRow() < 2) { AUTH_FAIL_ = 'SESSION_EXPIRED'; return null; }
  var row = findRow_(ss, idx, 'Token', token);
  // มี token แต่หาไม่เจอ = หมดอายุแล้ว (แถวถูกล้างโดย purgeSessions_ ตอนคนอื่นล็อกอิน) / ถูกเพิกถอน
  if (!row) { AUTH_FAIL_ = 'SESSION_EXPIRED'; return null; }
  var r = ss.getRange(row, 1, 1, ss.getLastColumn()).getValues()[0];
  var expMs = expiryMs_(r, idx);
  if (expMs && expMs < Date.now()) { ss.deleteRow(row); AUTH_FAIL_ = 'SESSION_EXPIRED'; return null; }
  // v4.4: role / สถานะ Active มาจากแท็บ Users "ทุก request" — Admin เปลี่ยนสิทธิ์หรือปิดบัญชีแล้วมีผลทันที
  var uid = String(cell_(r, idx, 'UserId'));
  var ush = sheet_(SH.USERS), uidx = headerIndex_(ush), urow = findRow_(ush, uidx, 'Id', uid);
  if (!urow) { ss.deleteRow(row); AUTH_FAIL_ = 'ACCOUNT_REMOVED'; return null; }
  var u = ush.getRange(urow, 1, 1, ush.getLastColumn()).getValues()[0];
  if (!isActiveUser_(u, uidx)) { ss.deleteRow(row); AUTH_FAIL_ = 'ACCOUNT_DISABLED'; logRow_('session-revoked', '', uid, '', 'inactive'); return null; }
  var role = normRole_(cell_(u, uidx, 'Role'));
  return { token:token, userId:uid, name:String(cell_(u, uidx, 'Name') || cell_(r, idx, 'Name')),
           email:String(cell_(u, uidx, 'Email') || ''), role:role, caps:capsOf_(role) };
}

/** ข้อมูลผู้ใช้ปัจจุบัน (role สด ๆ จากแท็บ Users) — แนบไปกับทุกคำตอบอ่านข้อมูล ให้ client รู้ทันทีถ้าสิทธิ์ถูกเปลี่ยน */
function meOf_(sess) { return { id:sess.userId, name:sess.name, email:sess.email || '', role:sess.role, tier:sess.caps.tier, caps:sess.caps }; }
/** Admin ปลดล็อกบัญชีที่กรอกรหัสผิดเกินกำหนด (ไม่ต้องตั้งรหัสใหม่) */
function unlockUser_(p, sess) {
  if (!p.id) return { ok:false, error:'missing id' };
  loginClear_('id:' + String(p.id).toLowerCase());
  logRow_('unlockUser', '', p.id, sess.name, '');
  return { ok:true, id:p.id };
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
    if (action === 'ssoLogin') return ssoLogin_(p);
    if (action === 'ping')  return { ok:true, pong:true, time:nowISO_(), version:APP_VERSION };

    if (action === 'logout') return logout_(p);
    var sess = auth_(p.token);
    if (!sess) return authError_();

    switch (action) {
      case 'whoami':       return { ok:true, user:meOf_(sess) };
      case 'unlockUser':   return need_(sess,'manageUsers') || unlockUser_(p, sess);
      case 'approve':      return need_(sess,'approve') || approve_(p, sess);
      case 'changePassword': return changePassword_(p, sess);
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

function apiGetObj_(type, token, arg) {
  try {
    var sess = auth_(token);
    if (!sess) return authError_();
    // serverTime ถูกจับ "ก่อน" อ่านข้อมูล → รอบ polling ถัดไปใช้ค่านี้เป็น since ได้โดยไม่พลาดแถวที่เขียนระหว่างอ่าน
    var serverTime = nowISO_();
    var view = seesFullData_(sess) ? 'internal' : 'sales';
    switch (type) {
      case 'quotations': return { ok:true, quotations:getQuotations_(sess), view:view, serverTime:serverTime, me:meOf_(sess) };
      case 'changes': {
        // Live polling: ส่งเฉพาะแถวที่ UpdatedAt ใหม่กว่า since (เบากว่าดึงทั้งชีททุก 30 วินาทีมาก)
        var sinceMs = toMs_(arg);
        if (!sinceMs) return { ok:false, error:'missing since' };
        return { ok:true, quotations:getQuotations_(sess, { sinceMs:sinceMs }), view:view, serverTime:serverTime, me:meOf_(sess) };
      }
      case 'quote': {
        // เปิดดู/แก้ใบเดียว → ดึงเวอร์ชันล่าสุดของใบนั้นจาก Sheet (ผ่านกฎ projection เดียวกันทุกประการ)
        if (!arg) return { ok:false, error:'missing id' };
        var one = getQuotations_(sess, { id:String(arg) });
        return { ok:true, quote:one.length ? one[0] : null, view:view, serverTime:serverTime };
      }
      case 'products':   return { ok:true, products:getProducts_(sess) };
      case 'settings':   return getSettings_(sess);
      case 'users':      return { ok:true, users:getUsers_(sess) };
      case 'whoami':     return { ok:true, user:meOf_(sess) };
      case 'salesview': {
        // แอป Sales: ทุก role ได้ "มุมมองปลอดต้นทุน" (SalesDetail) — role ภายในเห็นทุกคน + ยอด/GP สรุป
        var sv = toMs_(arg);
        return { ok:true, quotations:getQuotations_(sess, { salesView:true, sinceMs:sv || 0 }), view:'salesview', serverTime:serverTime, me:meOf_(sess) };
      }
      default:           return { ok:false, error:'unknown type: ' + type };
    }
  } catch (err) { return { ok:false, error:String(err) }; }
}

/* ============================================================ QUOTATIONS */

function saveQuote_(p, sess) {
  if (!p.id) return { ok:false, error:'missing id' };
  var sh = sheet_(SH.QUOTES), idx = headerIndex_(sh);
  var row = findRow_(sh, idx, 'Id', p.id);

  // CONFLICT GUARD (optimistic lock): client ส่ง baseUpdatedAt = UpdatedAt ของ Sheet ที่ตัวเองเห็นล่าสุด
  // ถ้าบน Sheet มีคนเขียนหลังจากนั้น (แก้ราคา / อนุมัติ / ปล่อยราคา / Sales อัปเดต) → ไม่เขียนทับ ตอบ 409
  // ไม่ส่ง baseUpdatedAt (ใบใหม่ / client รุ่นเก่า) = ข้ามการตรวจ เหมือนพฤติกรรมเดิม
  if (row && p.baseUpdatedAt && !p.force) {
    var cur = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
    var curRaw = cell_(cur, idx, 'UpdatedAt');
    var curMs = toMs_(curRaw), baseMs = toMs_(p.baseUpdatedAt);
    // ถ้า Sheets แปลง ISO string เป็น Date เอง ความละเอียดอาจหาย → เผื่อ 1 วินาทีกัน conflict หลอก
    // ถ้ายังเป็น string อยู่ → เทียบตรงระดับ ms
    var tol = (curRaw instanceof Date) ? 1000 : 0;
    if (curMs && baseMs && curMs > baseMs + tol) {
      logRow_('conflict', p.docNo || '', p.id, sess.name, 'base ' + p.baseUpdatedAt + ' < sheet ' + toIso_(cell_(cur, idx, 'UpdatedAt')));
      return { ok:false, error:'CONFLICT', code:409, id:p.id,
               serverUpdatedAt:toIso_(cell_(cur, idx, 'UpdatedAt')), serverBy:String(cell_(cur, idx, 'By') || ''),
               serverStatus:String(cell_(cur, idx, 'Status') || '') };
    }
  }
  var stamp = nowISO_();
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
    Updated:p.updated || todayStr_(), UpdatedAt:stamp, By:sess.name,
    Detail:detail.text
  };
  if (salesText) vals.SalesDetail = salesText;
  writeRow_(sh, idx, row, vals);
  logRow_('save', p.docNo || p.ref || '', p.id, sess.name, detail.note + (p.force ? ' (force)' : ''));
  return { ok:true, id:p.id, trimmed:detail.trimmed, updatedAt:stamp, follow:followForRow_(sh, idx, findRow_(sh, idx, 'Id', p.id)) };
}

/** Sales สร้าง/แก้คำขอราคา (SR) ได้ — server บังคับเจ้าของงานและตัดฟิลด์ต้นทุนทิ้งเสมอ */
function saveSR_(p, sess) {
  if (!p.id) return { ok:false, error:'missing id' };
  var sh = sheet_(SH.QUOTES), idx = headerIndex_(sh);
  var row = findRow_(sh, idx, 'Id', p.id);

  var doc;
  try { doc = JSON.parse(p.detail || '{}'); } catch (e) { return { ok:false, error:'bad detail' }; }
  if (String(doc.docType || 'SR') !== 'SR') return { ok:false, error:'ACCESS_DENIED', code:403 };

  var prev = null;
  if (row) {
    var cur = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
    if (String(cell_(cur, idx, 'DocType')) !== 'SR') return { ok:false, error:'ACCESS_DENIED', code:403 };
    try { prev = JSON.parse(String(cell_(cur, idx, 'Detail') || '{}')); } catch (e) { prev = null; }
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
  doc.header = doc.header || {};
  if (!row) {
    // v4.2: เลข SR ออกโดย server ใต้ ScriptLock — แอป Sales เห็นแค่งานของตัวเอง จึงสร้างเลขเองไม่ได้ (จะชนกัน)
    doc.docNo = nextDocNo_(sh, idx, 'SR');
    doc.header.ref = doc.docNo;
    doc.created = todayStr_(); doc.createdBy = sess.userId; doc.createdByName = sess.name;
    doc.auditLogs = [{ timestamp:nowISO_(), user:sess.name, role:sess.role, action:'Created request (' + (doc.status || 'Submitted') + ')' }];
  } else if (prev) {
    // แก้ใบเดิม: คงข้อมูลที่ผู้แก้ไม่มีสิทธิ์เปลี่ยน
    ['docNo', 'created', 'createdBy', 'createdByName', 'quoteIds'].forEach(function (k) { if (prev[k] !== undefined) doc[k] = prev[k]; });
    doc.header.ref = doc.docNo || doc.header.ref;
    doc.auditLogs = (prev.auditLogs || []).concat([{ timestamp:nowISO_(), user:sess.name, role:sess.role, action:'Edited request (' + (doc.status || '') + ')' }]).slice(-100);
  }
  doc.id = p.id; doc.docType = 'SR'; doc.updated = todayStr_();
  if (prev && Object.prototype.toString.call(prev.statusLog) === '[object Array]') doc.statusLog = prev.statusLog;
  else delete doc.statusLog;
  if (!prev || prev.status !== doc.status) stampStatus_(doc, doc.status || 'Submitted', nowISO_());
  else if (prev.statusChangedAt) doc.statusChangedAt = prev.statusChangedAt;
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
  var stamp = nowISO_();
  doc.updatedAt = stamp;
  var d = safeDetail_(JSON.stringify(doc));
  var salesCopy = JSON.parse(JSON.stringify(doc)); delete salesCopy.auditLogs;
  var sd = safeDetail_(JSON.stringify(stripCost_(salesCopy)));

  writeRow_(sh, idx, row, {
    Id:p.id, DocType:'SR', DocNo:doc.docNo || '', Ref:(doc.header && doc.header.ref) || '',
    Title:(doc.header && doc.header.title) || '', Customer:(doc.header && doc.header.customer) || '',
    Sales:(doc.header && doc.header.sales) || '', SalesUserId:(doc.header && doc.header.salesUserId) || '',
    AssignedTo:doc.assignedTo || '', Group:(doc.header && doc.header.groupType) || '',
    Round:1, Currency:(doc.header && doc.header.currency) || '', Status:doc.status || 'Submitted',
    FollowStatus:doc.followStatus || 'Requested', SalesNote:doc.salesNote || '',
    Lines:(doc.lines || []).length, Total:0, Cost:0, Profit:0, GP:0,
    Updated:todayStr_(), UpdatedAt:stamp, By:sess.name,
    Detail:d.text, SalesDetail:sd.text
  });
  logRow_('saveSR', doc.docNo || '', p.id, sess.name, '');
  return { ok:true, id:p.id, docNo:doc.docNo, updatedAt:stamp, follow:followForRow_(sh, idx, findRow_(sh, idx, 'Id', p.id)) };
}

/** เลขเอกสารถัดไป เช่น SR-2610-007 (อ่านจากคอลัมน์ DocNo ทั้งชีท — เรียกใต้ ScriptLock เท่านั้น) */
function nextDocNo_(sh, idx, type) {
  var ym = Utilities.formatDate(new Date(), TZ, 'yyMM');
  var pat = type + '-' + ym + '-', max = 0, last = sh.getLastRow();
  if (last >= 2 && idx.DocNo) {
    sh.getRange(2, idx.DocNo, last - 1, 1).getValues().forEach(function (v) {
      var s = String(v[0] || '');
      if (s.indexOf(pat) === 0) { var n = parseInt(s.slice(pat.length), 10); if (n > max) max = n; }
    });
  }
  return pat + ('00' + (max + 1)).slice(-3);
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
  var stamp = nowISO_();
  patchDetailCells_(sh, idx, row, applied, audit, stamp);
  var vals = { Updated:todayStr_(), UpdatedAt:stamp, By:sess.name };
  if (applied.salesNote !== undefined) vals.SalesNote = applied.salesNote;
  writeRow_(sh, idx, row, vals);
  logRow_('salesPatch', String(cell_(cur, idx, 'DocNo') || ''), p.id, sess.name, Object.keys(applied).join(','));
  return { ok:true, id:p.id, updatedAt:stamp, follow:followForRow_(sh, idx, row) };
}

/** ปล่อยราคา — server ตัดสินเองว่าให้สิทธิ์ใคร โดยอ่านเจ้าของงานจากเอกสาร */
function release_(p, sess) {
  if (!p.id) return { ok:false, error:'missing id' };
  var sh = sheet_(SH.QUOTES), idx = headerIndex_(sh);
  var row = findRow_(sh, idx, 'Id', p.id);
  if (!row) return { ok:false, error:'not found' };
  var cur = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];

  if (!(sess.caps.approve || isReleaser_(sess.userId))) return { ok:false, error:'ACCESS_DENIED', code:403 };
  var stNow = String(cell_(cur, idx, 'Status'));
  // v4.3: ใบ Pending รุ่นเก่าที่ยังไม่ได้ปล่อยให้เจ้าของงานจริง → ผู้ปล่อยราคากด "ยืนยันปล่อยราคา" ได้ (สถานะคง Pending)
  var fNow = followState_(followInfo_(cur, idx), followCfg_(), Date.now());
  var legacy = stNow === 'Pending' && fNow.owner === 'RELEASER';
  if (stNow !== 'Approved' && !legacy) {
    if (stNow === 'Pending' && fNow.owner === 'REPAIR') return { ok:false, error:'NO_SALES_COPY', code:409, serverStatus:stNow };
    return { ok:false, error:'NOT_APPROVED', code:409, serverStatus:stNow };
  }

  var owner = String(cell_(cur, idx, 'SalesUserId') || '');
  if (!owner) return { ok:false, error:'NO_OWNER', code:409 };

  var rel = String(cell_(cur, idx, 'ReleasedTo') || '').split('|').filter(function (x) { return x; });
  if (rel.indexOf(owner) < 0) rel.push(owner);

  var audit = { timestamp:nowISO_(), user:sess.name, role:sess.role,
                action:(legacy ? 'Confirmed release (legacy Pending)' : 'Released price — Approved → Pending') + ' · ให้สิทธิ์ ' + owner };
  var stamp = nowISO_();
  var detailText = patchDetailCells_(sh, idx, row, { status:'Pending', followStatus:'Sent', releasedTo:rel,
                                    releasedAt:stamp, releasedBy:sess.userId }, audit, stamp);
  writeRow_(sh, idx, row, { Status:'Pending', FollowStatus:'Sent', ReleasedTo:rel.join('|'),
                            Updated:todayStr_(), UpdatedAt:stamp, By:sess.name });
  logRow_('release', String(cell_(cur, idx, 'DocNo') || ''), p.id, sess.name, owner);
  var out = { ok:true, id:p.id, releasedTo:rel, updatedAt:stamp, follow:followForRow_(sh, idx, row) };
  if (seesFullData_(sess)) out.detail = detailText;      // Sales (NON) ไม่ได้รับ Detail ตัวเต็มเด็ดขาด
  return out;
}

/** แก้ JSON ทั้ง Detail และ SalesDetail พร้อมกัน เพื่อให้สองมุมมองไม่หลุดจากกัน
 *  - SalesDetail ถูกล้างฟิลด์ต้นทุนซ้ำ (stripCost_) ทุกครั้ง เผื่อ patch มีคีย์ภายใน เช่น approvalRoles
 *  - คืนข้อความ Detail ฉบับใหม่ (ให้ผู้เรียกส่งกลับ client ของ role ภายในได้ทันที ไม่ต้องดึงซ้ำ) */
function patchDetailCells_(sh, idx, row, patch, audit, stamp) {
  var detailOut = '';
  stamp = stamp || nowISO_();
  ['Detail', 'SalesDetail'].forEach(function (col) {
    if (!idx[col]) return;
    var cellRange = sh.getRange(row, idx[col]);
    var raw = String(cellRange.getValue() || '');
    if (!raw) return;
    var d; try { d = JSON.parse(raw); } catch (e) { return; }
    var prevStatus = d.status;
    for (var k in patch) if (patch.hasOwnProperty(k)) d[k] = patch[k];
    d.updatedAt = stamp;
    if (patch.status && patch.status !== prevStatus) stampStatus_(d, patch.status, stamp);
    if (col === 'Detail') { if (audit) { if (!d.auditLogs) d.auditLogs = []; d.auditLogs.push(audit); } }
    else { delete d.auditLogs; d = stripCost_(d); }
    var text = safeDetail_(JSON.stringify(d)).text;
    cellRange.setValue(text);
    if (col === 'Detail') detailOut = text;
  });
  return detailOut;
}

/** บันทึกเวลาเปลี่ยนสถานะ (ใช้นับวัน SLA แยกช่วง) — คีย์ใหม่แบบ optional ข้อมูลเก่าที่ไม่มีก็ยังอ่านได้ */
function stampStatus_(d, status, at) {
  d.statusChangedAt = at;
  if (Object.prototype.toString.call(d.statusLog) !== '[object Array]') d.statusLog = [];
  d.statusLog.push({ s:status, at:at });
  if (d.statusLog.length > 40) d.statusLog = d.statusLog.slice(-40);
}

/** อนุมัติ 2 ฝ่ายแบบ atomic (อยู่ใต้ ScriptLock ของ handle_)
 *  อ่าน approvalRoles ล่าสุดจาก Sheet → เติม role ของผู้กด → คำนวณสถานะใหม่ → เขียนกลับในครั้งเดียว
 *  แก้ปัญหา: Procurement กับ BD กดอนุมัติจากเครื่องตัวเองใกล้ ๆ กัน แล้วอีกฝ่ายเขียนทับ approvalRoles หายไป 1 ขา */
function approve_(p, sess) {
  if (!p.id) return { ok:false, error:'missing id' };
  var role = sess.role;
  if (REQUIRED_APPROVAL_ROLES.indexOf(role) < 0 && APPROVAL_OVERRIDE_ROLES.indexOf(role) < 0)
    return { ok:false, error:'ROLE_CANNOT_APPROVE', code:403, need:REQUIRED_APPROVAL_ROLES.concat(APPROVAL_OVERRIDE_ROLES) };
  var sh = sheet_(SH.QUOTES), idx = headerIndex_(sh);
  var row = findRow_(sh, idx, 'Id', p.id);
  if (!row) return { ok:false, error:'not found', code:404 };
  var cur = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
  var status = String(cell_(cur, idx, 'Status') || '');
  if (String(cell_(cur, idx, 'DocType') || 'QT') === 'SR') return { ok:false, error:'NOT_A_QUOTE', code:409 };
  if (status !== 'Submitted' && status !== 'Partial Approved')
    return { ok:false, error:'NOT_IN_APPROVAL', code:409, serverStatus:status };

  var d; try { d = JSON.parse(String(cell_(cur, idx, 'Detail') || '{}')); } catch (e) { d = null; }
  if (!d || !d.id || d._oversize) return { ok:false, error:'NO_DETAIL', code:409 };
  var roles = (Object.prototype.toString.call(d.approvalRoles) === '[object Array]') ? d.approvalRoles.slice() : [];
  if (roles.indexOf(role) >= 0) return { ok:false, error:'ALREADY_APPROVED', code:409, approvalRoles:roles, serverStatus:status };
  roles.push(role);

  var override = roles.some(function (r) { return APPROVAL_OVERRIDE_ROLES.indexOf(r) >= 0; });
  var missing = override ? [] : REQUIRED_APPROVAL_ROLES.filter(function (r) { return roles.indexOf(r) < 0; });
  var complete = missing.length === 0;
  var newStatus = complete ? 'Approved' : 'Partial Approved';
  var stamp = nowISO_();
  var approvals = (Object.prototype.toString.call(d.approvals) === '[object Array]') ? d.approvals.slice() : [];
  approvals.push({ by:sess.name, role:role, act:'อนุมัติ', at:stamp });

  var patch = { approvalRoles:roles, approvals:approvals, status:newStatus, _sv:3,
                stage:complete ? 'Approved' : 'Submitted', followStatus:'Pending',
                rev:(Number(d.rev) || 0) + 1, updated:todayStr_() };
  if (complete) patch.needsApproval = false;
  var audit = { timestamp:stamp, user:sess.name, role:role,
                action:'Approved by ' + role + ': ' + status + ' → ' + newStatus + (complete ? '' : ' (รอ ' + missing.join(', ') + ')') };
  var detailText = patchDetailCells_(sh, idx, row, patch, audit, stamp);
  var vals = { Status:newStatus, Stage:patch.stage, FollowStatus:'Pending',
               Updated:todayStr_(), UpdatedAt:stamp, By:sess.name };
  if (complete) vals.NeedsApproval = '';
  writeRow_(sh, idx, row, vals);
  logRow_('approve', String(cell_(cur, idx, 'DocNo') || ''), p.id, sess.name, role + ' → ' + newStatus);
  return { ok:true, id:p.id, status:newStatus, approvalRoles:roles, missing:missing,
           complete:complete, updatedAt:stamp, detail:detailText, follow:followForRow_(sh, idx, row) };
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
  patchDetailCells_(sh, idx, row, { deleted:true, deletedAt:stamp, deletedBy:sess.name }, null, stamp);
  writeRow_(sh, idx, row, { Deleted:'TRUE', DeletedAt:stamp, DeletedBy:sess.name, UpdatedAt:stamp });
  logRow_('delete', '', p.id, sess.name, '');
  return { ok:true, id:p.id, deleted:true, updatedAt:stamp };
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

/**
 * อ่านใบเสนอราคาตามสิทธิ์ของผู้เรียก — ใช้ร่วมกันทั้ง 3 แบบ: ทั้งชีท / เฉพาะที่เปลี่ยน (sinceMs) / ใบเดียว (id)
 * กฎ visibility ทั้งหมดอยู่ใน projectRow_() ที่เดียว ไม่มีเงื่อนไขกระจายอยู่หลายที่อีกต่อไป
 *   opts.sinceMs : คืนเฉพาะแถวที่ UpdatedAt > sinceMs   (Live polling)
 *   opts.id      : คืนเฉพาะใบนี้                       (เปิดดูรายละเอียด / เปิดแก้ไข)
 */
function getQuotations_(sess, opts) {
  opts = opts || {};
  var sh = sheet_(SH.QUOTES), last = sh.getLastRow();
  if (last < 2) return [];
  var idx = headerIndex_(sh);
  var data;
  if (opts.id) {
    var row = findRow_(sh, idx, 'Id', opts.id);
    if (!row) return [];
    data = [sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0]];
  } else {
    data = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  }
  var ctx = projectionCtx_(sess, opts);
  var out = [];
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    if (!cell_(r, idx, 'Id')) continue;
    if (opts.sinceMs && !(toMs_(cell_(r, idx, 'UpdatedAt')) > opts.sinceMs)) continue;
    var o = projectRow_(r, idx, sess, ctx);
    if (o) out.push(o);
  }
  out.sort(function (a, b) {
    return String(b.updatedAt || b.updated || '').localeCompare(String(a.updatedAt || a.updated || ''));
  });
  return out.slice(0, MAX_RETURN_ROWS);
}

/** ค่าที่ใช้ซ้ำทุกแถว — resolve ครั้งเดียวต่อ request
 *  PERF: เดิมเรียก isReleaser_() ต่อแถว ทำให้อ่าน Users/Settings ซ้ำหลายร้อยรอบ */
function projectionCtx_(sess, opts) {
  var full = seesFullData_(sess);
  var gate = full ? '' : gatekeeperId_();
  var delegate = full ? '' : releaseDelegateId_();
  return { full:full, gate:gate, salesView:!!(opts && opts.salesView),
           iAmReleaser:!full && (sess.userId === gate || (!!delegate && sess.userId === delegate)),
           followCfg:followCfg_(), nowMs:Date.now() };       // อ่าน Settings ครั้งเดียวต่อ request (ห้าม I/O ในลูป)
}

/**
 * VISIBILITY RULES (ตัวจริง — client เป็นแค่กระจกเงา)
 *  1) ADMIN / MANAGEMENT / INTERNAL (GM, Admin, Procurement Mgr, BD Mgr, Sourcing)
 *     → Full Data ทุกใบ ทุกสถานะ: Detail + Total/Cost/Profit/GP + NeedsApproval   (ไม่มีการ strip)
 *  2) SALES เท่านั้นที่ถูกตัด
 *     - row  : เห็นเฉพาะงานของตัวเอง (ยกเว้น viewAllSales / gatekeeper)
 *     - field: ไม่มี Detail / Cost / Profit / GP เด็ดขาด — ได้เฉพาะ SalesDetail (ผ่าน stripCost_ ซ้ำอีกชั้น)
 *     - ราคา : เฉพาะสถานะ Approved / Pending / Won / Closed  และต้อง (ถูกปล่อยราคาให้แล้ว หรือ เป็นผู้ปล่อยราคา)
 *              ผู้ปล่อยราคา (NON / delegate) ต้องเห็นตั้งแต่ Approved เพื่อ "ตรวจก่อนปล่อย" ไม่งั้นเกิด deadlock
 */
function projectRow_(r, idx, sess, ctx) {
  var base = {
    id:String(cell_(r, idx, 'Id')),
    docType:cell_(r, idx, 'DocType'), docNo:cell_(r, idx, 'DocNo'), ref:cell_(r, idx, 'Ref'),
    title:cell_(r, idx, 'Title'), status:cell_(r, idx, 'Status'),
    customer:cell_(r, idx, 'Customer'), sales:cell_(r, idx, 'Sales'),
    salesUserId:cell_(r, idx, 'SalesUserId'), assignedTo:cell_(r, idx, 'AssignedTo'),
    group:cell_(r, idx, 'Group'), round:cell_(r, idx, 'Round'), currency:cell_(r, idx, 'Currency'),
    releasedTo:cell_(r, idx, 'ReleasedTo'),
    updated:cell_(r, idx, 'Updated'), updatedAt:toIso_(cell_(r, idx, 'UpdatedAt')),
    by:String(cell_(r, idx, 'By') || ''),
    deleted:String(cell_(r, idx, 'Deleted')).toUpperCase() === 'TRUE'
  };
  var fi = followInfo_(r, idx);
  base.follow = followState_(fi, ctx.followCfg, ctx.nowMs);
  // ใบ Pending รุ่นเก่าที่มีราคาฉบับ Sales แล้วแต่ยังไม่ได้ปล่อยให้เจ้าของงาน → ผู้ปล่อยราคากดยืนยันได้
  var legacyRelease = base.follow.owner === 'RELEASER' && String(base.status) === 'Pending';

  if (ctx.full && ctx.salesView) {
    // แอป Sales เปิดโดย role ภายใน (ผู้จัดการดูหน้าของ Sales แต่ละคน): ใช้ SalesDetail เหมือน Sales เห็น
    // + ยอดรวม/GP สรุประดับใบ (ไม่ส่ง Detail/โครงสร้างต้นทุนรายบรรทัดออกไปที่แอปนี้)
    var st0 = String(base.status || ''), dt0 = String(base.docType || 'QT');
    base.salesDetail = salesSafe_(cell_(r, idx, 'SalesDetail') || (dt0 === 'SR' ? cell_(r, idx, 'Detail') : ''));
    base.salesValue = Number(cell_(r, idx, 'Total')) || 0;
    base.gp = Number(cell_(r, idx, 'GP')) || 0;
    base.priceLocked = false;
    base.canRelease = !!sess.caps.approve && (st0 === 'Approved' || legacyRelease) && dt0 !== 'SR';
    base.valueTHB = salesValueTHB_(r, idx);
    return base;
  }
  if (ctx.full) {
    base.needsApproval = String(cell_(r, idx, 'NeedsApproval')).toUpperCase() === 'TRUE';
    base.total  = Number(cell_(r, idx, 'Total'))  || 0;
    base.cost   = Number(cell_(r, idx, 'Cost'))   || 0;
    base.profit = Number(cell_(r, idx, 'Profit')) || 0;
    base.gp     = Number(cell_(r, idx, 'GP'))     || 0;
    base.detail = cell_(r, idx, 'Detail');
    return base;
  }

  /* ---------- SALES PROJECTION ---------- */
  var owner = String(base.salesUserId || '');
  if (!sess.caps.viewAllSales && sess.userId !== ctx.gate && owner !== sess.userId) return null;

  var docType = String(base.docType || 'QT');
  var status  = String(base.status || '');
  var rel = String(base.releasedTo || '').split('|').filter(function (x) { return x; });
  var inPriceState = PRICE_STATES.indexOf(status) >= 0;
  // Sales Manager (viewAllSales): เห็นราคาของทีมเมื่อปล่อยราคาแล้ว (Pending / Won / Closed)
  var teamReleased = !!sess.caps.viewAllSales && ['Pending', 'Won', 'Closed'].indexOf(status) >= 0;
  var maySeePrice = docType !== 'SR' && inPriceState && (rel.indexOf(sess.userId) >= 0 || ctx.iAmReleaser || teamReleased);

  base.releasedTo = rel.join('|');
  base.canRelease = (ctx.iAmReleaser && (status === 'Approved' || legacyRelease) && docType !== 'SR');
  if (docType === 'SR') {
    base.salesDetail = salesSafe_(cell_(r, idx, 'SalesDetail') || cell_(r, idx, 'Detail'));
    base.priceLocked = false;
  } else if (maySeePrice) {
    base.salesValue  = Number(cell_(r, idx, 'Total')) || 0;
    base.salesDetail = salesSafe_(cell_(r, idx, 'SalesDetail'));   // ห้ามใช้ Detail เด็ดขาด
    base.priceLocked = !fi.hasSalesCopy;                           // ใบรุ่นเก่ายังไม่มีราคาฉบับ Sales
    base.valueTHB = salesValueTHB_(r, idx);                        // แค่ยอดรวมเป็นบาท ไม่ส่งอัตราแลกเปลี่ยนออกไป
  } else {
    base.salesDetail = '';                                         // ยังไม่ปล่อยราคา → ไม่ส่งราคาออกไปเลย
    base.priceLocked = true;
  }
  return base;
}

/* ============================================================ FOLLOW-UP OWNERSHIP + SLA (v4.3)
 * ฟังก์ชันเดียวที่ตัดสินว่า "งานนี้รออยู่ที่ใคร" — ทั้งระบบทำราคาและแอป Sales ใช้ค่านี้ (row.follow) ห้ามคำนวณเองซ้ำ
 *   owner: SOURCING | MANAGEMENT | RELEASER | REPAIR | SALES | DONE
 *   REPAIR = ใบ Pending รุ่นเก่าที่ยังไม่มี "ราคาฉบับ Sales" (SalesDetail) → ต้องให้ทีมภายในกดสร้างข้อมูลสำหรับ Sales
 *   งานจะเป็น "งานค้างของ Sales" ได้ต่อเมื่อปล่อยราคาให้เจ้าของงานแล้ว และมีราคาฉบับ Sales จริงเท่านั้น
 * อ่านค่าจาก Detail ด้วย regex เฉพาะคีย์ระดับบน (ไม่ JSON.parse ทั้งก้อน) → เบาพอจะทำทุกแถวทุกครั้งที่โหลด */
var FOLLOW_LABEL = {
  SOURCING:'รอ Sourcing จัดทำราคา', MANAGEMENT:'รอผู้จัดการอนุมัติ', RELEASER:'รอปล่อยราคา',
  REPAIR:'รอสร้างข้อมูลราคาสำหรับ Sales', SALES:'พร้อมเสนอลูกค้า', DONE:'ปิดงานแล้ว'
};
var STAGE_BUCKET = { 'Requested':'sourcing', 'In Progress':'sourcing', 'Submitted':'approval', 'Partial Approved':'approval',
  'Approved':'release', 'Pending':'sales', 'Draft':'sales', 'Accepted':'sourcing' };   // ใช้แยกช่วงวันรอ

function followCfg_() {
  var cfg = { sla:{}, salesUpdateDays:FOLLOW_CFG.salesUpdateDays };
  for (var k in FOLLOW_CFG.sla) cfg.sla[k] = FOLLOW_CFG.sla[k];
  try {
    var s = getSettingsRaw_();
    if (s && s.sla) for (var k2 in s.sla) if (+s.sla[k2] > 0 && cfg.sla.hasOwnProperty(k2)) cfg.sla[k2] = +s.sla[k2];
    if (s && +s.salesUpdateDays > 0) cfg.salesUpdateDays = +s.salesUpdateDays;
  } catch (e) {}
  return cfg;
}
/** จำนวนวันทำการ (จ.–ศ.) ระหว่าง fromMs ถึง toMs — นับเป็นวันเต็มตามเวลาไทย */
function businessDays_(fromMs, toMs) {
  if (!fromMs || !toMs || toMs <= fromMs) return 0;
  var day = 86400000, off = 7 * 3600000;                  // Asia/Bangkok = UTC+7 (ไม่มี DST)
  var a = Math.floor((fromMs + off) / day), b = Math.floor((toMs + off) / day), n = 0;
  if (b - a > 800) a = b - 800;                           // กันลูปยาวผิดปกติ
  for (var d = a + 1; d <= b; d++) { var wd = (d + 4) % 7; if (wd !== 0 && wd !== 6) n++; }   // 1970-01-01 = พฤหัส
  return n;
}
function topStr_(json, key) {
  var m = new RegExp('"' + key + '":"([^"]*)"').exec(json || '');
  return m ? m[1] : '';
}
function topArr_(json, key) {
  var m = new RegExp('"' + key + '":(\\[[^\\]]*\\])').exec(json || '');
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch (e) { return null; }
}
/** ข้อมูลที่ใช้คำนวณ follow — จากคอลัมน์ + Detail (ไม่ส่ง Detail ออกไปไหน) */
function followInfo_(r, idx) {
  var det = String(cell_(r, idx, 'Detail') || ''), sd = String(cell_(r, idx, 'SalesDetail') || '');
  return {
    docType:String(cell_(r, idx, 'DocType') || 'QT'), status:String(cell_(r, idx, 'Status') || ''),
    owner:String(cell_(r, idx, 'SalesUserId') || ''),
    releasedTo:String(cell_(r, idx, 'ReleasedTo') || '').split('|').filter(function (x) { return x; }),
    hasSalesCopy:sd.indexOf('"unitPrice"') >= 0,
    updatedMs:toMs_(cell_(r, idx, 'UpdatedAt')) || toMs_(cell_(r, idx, 'Updated')),
    statusLog:topArr_(det, 'statusLog') || [],
    statusChangedAt:topStr_(det, 'statusChangedAt'),
    salesUpdatedAt:topStr_(det, 'salesUpdatedAt'),
    followUpDate:topStr_(det, 'followUpDate'),
    approvalRoles:topArr_(det, 'approvalRoles') || [],
    quoteIds:topArr_(det, 'quoteIds') || []
  };
}
/** หัวใจของ Phase 1 — pure function (ทดสอบได้โดยไม่ต้องมีชีท) */
function followState_(f, cfg, nowMs) {
  var st = f.status, isSR = f.docType === 'SR', owner;
  if (isSR) {
    owner = (f.quoteIds && f.quoteIds.length) ? 'DONE'            // มีใบเสนอราคาผูกแล้ว = คำขอนี้จบแล้ว
          : (st === 'Draft') ? 'SALES' : (st === 'Submitted' || st === 'Accepted') ? 'SOURCING' : 'DONE';
  } else if (st === 'Requested' || st === 'In Progress' || !st) owner = 'SOURCING';
  else if (st === 'Submitted' || st === 'Partial Approved') owner = 'MANAGEMENT';
  else if (st === 'Approved') owner = 'RELEASER';
  else if (st === 'Pending') {
    var released = !!f.owner && f.releasedTo.indexOf(f.owner) >= 0;
    owner = !f.hasSalesCopy ? 'REPAIR' : !released ? 'RELEASER' : 'SALES';
  } else owner = 'DONE';

  // ช่วงเวลาตามสถานะ (วันทำการ) — จาก statusLog ถ้ามี, ไม่งั้นใช้เวลาแก้ไขล่าสุดเป็นจุดเริ่ม (ข้อมูลรุ่นเก่า)
  var log = (f.statusLog || []).filter(function (e) { return e && e.at; });
  var sinceMs = toMs_(f.statusChangedAt) || (log.length ? toMs_(log[log.length - 1].at) : 0) || f.updatedMs || nowMs;
  var stageDays = { sourcing:0, approval:0, release:0, sales:0 };
  for (var i = 0; i < log.length; i++) {
    var b = STAGE_BUCKET[log[i].s]; if (!b) continue;
    var end = (i + 1 < log.length) ? toMs_(log[i + 1].at) : nowMs;
    stageDays[b] += businessDays_(toMs_(log[i].at), end);
  }
  var out = { owner:owner, ownerLabel:FOLLOW_LABEL[owner], label:FOLLOW_LABEL[owner], actionable:false,
              waitingDays:0, slaDays:0, level:'ok', slaBreached:false, since:new Date(sinceMs).toISOString(),
              stageDays:stageDays, estimated:!log.length };
  if (owner === 'DONE') {
    out.label = isSR ? ((f.quoteIds && f.quoteIds.length) || st === 'Quoted' ? 'จัดทำใบเสนอราคาแล้ว' : st === 'Cancelled' ? 'ยกเลิกคำขอ' : 'ปิดงานแล้ว')
                     : (st === 'Won' ? 'ปิดการขายได้' : 'ปิดงาน');
    out.ownerLabel = out.label;
    return out;
  }
  if (isSR && owner === 'SALES') { out.label = 'ร่างคำขอ — ยังไม่ได้ส่ง'; out.actionable = true; return out; }
  if (isSR && owner === 'SOURCING') out.label = (st === 'Accepted') ? 'Sourcing รับคำขอแล้ว · กำลังจัดทำราคา' : 'รอ Sourcing รับคำขอราคา';
  if (owner === 'MANAGEMENT' && st === 'Partial Approved') {
    var miss = REQUIRED_APPROVAL_ROLES.filter(function (r) { return (f.approvalRoles || []).indexOf(r) < 0; });
    out.label = 'อนุมัติแล้วบางส่วน · รอ ' + miss.join(' / ');
  }
  if (owner === 'RELEASER' && st === 'Pending') out.label = 'รอยืนยันปล่อยราคา (ข้อมูลรุ่นเก่า)';

  if (owner === 'SALES') {
    // Sales: นับจากการอัปเดตล่าสุด (หรือวันที่ได้ราคา) เป็นวันปฏิทิน + วันนัดที่เลยกำหนด
    var lastMs = toMs_(f.salesUpdatedAt) || sinceMs;
    out.waitingDays = Math.floor((nowMs - lastMs) / 86400000);
    out.slaDays = cfg.salesUpdateDays;
    var overdueFollow = !!f.followUpDate && f.followUpDate < Utilities.formatDate(new Date(nowMs), TZ, 'yyyy-MM-dd');
    out.slaBreached = out.waitingDays >= cfg.salesUpdateDays || overdueFollow;
    out.level = out.slaBreached ? 'over' : (out.waitingDays >= cfg.salesUpdateDays - 1 ? 'watch' : 'ok');
    out.actionable = out.slaBreached;                     // งานค้างของ Sales = ถึงเวลาต้องอัปเดตแล้วเท่านั้น
    out.label = out.slaBreached ? (overdueFollow ? 'เลยวันนัดติดตาม' : 'ถึงเวลาอัปเดตความคืบหน้า') : 'พร้อมเสนอลูกค้า';
    return out;
  }
  out.waitingDays = businessDays_(sinceMs, nowMs);
  out.slaDays = cfg.sla[owner] || 0;
  out.slaBreached = out.slaDays > 0 && out.waitingDays > out.slaDays;
  out.level = out.slaBreached ? 'over' : (out.slaDays > 0 && out.waitingDays >= out.slaDays ? 'watch' : 'ok');
  out.actionable = true;                                  // อยู่ในคิวของเจ้าของงานเสมอ
  return out;
}
/** อัตราแปลงสกุลเงินของใบ → บาท (อัตราที่ล็อกไว้ในใบ) — ใช้รวมมูลค่าข้ามสกุลเงิน · 0 = ไม่รู้อัตรา */
function rowRateToTHB_(r, idx) {
  var cur = String(cell_(r, idx, 'Currency') || 'THB').toUpperCase();
  if (cur === 'THB' || !cur) return 1;
  var rates = null, m = /"rates":(\{[^}]*\})/.exec(String(cell_(r, idx, 'Detail') || ''));
  if (m) { try { rates = JSON.parse(m[1]); } catch (e) {} }
  if (rates && +rates[cur] > 0) return +rates[cur];
  if (cur === 'USD' && +cell_(r, idx, 'Exrate') > 0) return +cell_(r, idx, 'Exrate');
  return 0;
}
/** มูลค่าเป็นบาทของ "ราคาที่ Sales เห็นจริง" (total ใน SalesDetail) — ไม่ใช้คอลัมน์ Total กันตัวเลขสองแหล่งไม่ตรงกัน */
function salesValueTHB_(r, idx) {
  var m = /"total":(-?[0-9.]+)/.exec(String(cell_(r, idx, 'SalesDetail') || ''));
  var v = m ? Number(m[1]) : (Number(cell_(r, idx, 'Total')) || 0);
  var rate = rowRateToTHB_(r, idx);
  return rate ? v * rate : null;
}
/** follow ของแถวเดียว (ใช้คืนค่าหลังบันทึก) */
function followForRow_(sh, idx, row) {
  var r = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
  return followState_(followInfo_(r, idx), followCfg_(), Date.now());
}

/** defense-in-depth: ล้างคีย์ต้นทุนออกจาก SalesDetail อีกชั้นก่อนส่งออก (เผื่อแถวเก่าที่บันทึกก่อนมี stripCost_) */
function salesSafe_(raw) {
  if (!raw) return '';
  try { return JSON.stringify(stripCost_(JSON.parse(String(raw)))); }
  catch (e) { return ''; }
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
  var internal = seesFullData_(sess);
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

  if (!seesFullData_(sess)) {
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
  // อีเมลต้องไม่ซ้ำกันระหว่างผู้ใช้ (ใช้เป็นตัวตนตอนล็อกอิน)
  var owner = {}, last = sh.getLastRow();
  if (last >= 2) sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues().forEach(function (r) {
    var em = String(cell_(r, idx, 'Email') || '').trim().toLowerCase();
    if (em) owner[em] = String(cell_(r, idx, 'Id'));
  });
  for (var j = 0; j < users.length; j++) {
    var em2 = String((users[j] && users[j].email) || '').trim().toLowerCase();
    if (!em2) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em2)) return { ok:false, error:'BAD_EMAIL', email:em2 };
    if (owner[em2] && owner[em2] !== users[j].id) return { ok:false, error:'DUPLICATE_EMAIL', email:em2 };
    owner[em2] = users[j].id;
  }
  for (var i = 0; i < users.length; i++) {
    var u = users[i];
    if (!u || !u.id) continue;
    if (u.pass !== undefined) delete u.pass;
    var row = findRow_(sh, idx, 'Id', u.id);
    var vals = { Id:u.id, Name:u.name||'', Role:normRole_(u.role),
      Scope:(typeof u.scope === 'string') ? u.scope : JSON.stringify(u.scope || 'all'), Updated:stamp };
    if (u.email !== undefined) vals.Email = String(u.email || '').trim().toLowerCase();
    if (u.active !== undefined) vals.Active = (u.active === false || String(u.active).toUpperCase() === 'FALSE') ? 'FALSE' : '';
    if (u.passHash) {                              // ไม่ส่ง hash มา = ไม่แตะรหัสเดิม
      if (!/^[0-9a-f]{64}$/.test(String(u.passHash))) return { ok:false, error:'BAD_HASH', id:u.id };
      vals.PassHash = pwWrap_(String(u.passHash));
      loginClear_('id:' + String(u.id).toLowerCase());   // Admin ตั้งรหัสใหม่ = ปลดล็อกด้วย
    }
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
    var u = { id:String(cell_(r, idx, 'Id')), name:cell_(r, idx, 'Name'), role:normRole_(cell_(r, idx, 'Role')),
              active:isActiveUser_(r, idx) };
    // อีเมลเห็นได้เฉพาะ role ภายใน / ผู้จัดการทีมขาย / เจ้าของบัญชีเอง
    if (seesFullData_(sess) || sess.caps.viewAllSales || u.id === sess.userId) u.email = String(cell_(r, idx, 'Email') || '');
    if (seesFullData_(sess)) u.scope = cell_(r, idx, 'Scope') || 'all';
    // v4.3: ไม่ส่งค่า hash ออกจาก server อีกเลย (แม้แต่ Admin) — บอกแค่ว่าตั้งรหัสแล้วหรือยัง
    if (sess.caps.manageUsers) u.hasPassword = !!String(cell_(r, idx, 'PassHash') || '');
    out.push(u);
  }
  if (sess.caps.manageUsers) {
    // สถานะถูกล็อก (กรอกรหัสผิดเกินกำหนด) — อ่าน cache ครั้งเดียวทั้งชุด (ห้าม I/O ในลูป)
    var keys = out.map(function (u) { return loginLockKey_('id:' + u.id.toLowerCase()); }), got = {};
    try { got = CacheService.getScriptCache().getAll(keys) || {}; } catch (e) {}
    out.forEach(function (u, i) {
      var v = got[keys[i]]; if (!v) return;
      try { var st = JSON.parse(v); if (st.until && st.until > Date.now()) u.lockedMinutes = Math.ceil((st.until - Date.now()) / 60000); } catch (e) {}
    });
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
/** แปลงเวลาเป็น epoch ms แบบทนทาน — รับได้ทั้ง Date (Sheets แปลงเอง), ISO string, ตัวเลข
 *  ห้ามเทียบเวลาแบบ string กับค่าที่อ่านจาก Sheet (ดู C3 FIX ที่ login_) */
function toMs_(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  var t = Date.parse(String(v));
  return isNaN(t) ? 0 : t;
}
function toIso_(v) { var ms = toMs_(v); return ms ? new Date(ms).toISOString() : ''; }
function nowISO_() { return new Date().toISOString(); }
function todayStr_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }

/* ============================================================ MAINTENANCE */

function setup() {
  [SH.QUOTES, SH.PRODUCTS, SH.SETTINGS, SH.USERS, SH.LOG, SH.SESSIONS].forEach(function (n) { sheet_(n); });
  migratePasswordHashes();   // v4.3: แปลง hash รหัสผ่านเดิมเป็น v2 (รันซ้ำได้ ไม่กระทบค่าที่แปลงแล้ว)
  logRow_('setup', '', '', Session.getActiveUser().getEmail() || '-', 'schema v4.2 (RBAC + Live Sync + Email login)');
  SpreadsheetApp.getActive().toast('ติดตั้ง/อัปเกรดแท็บเรียบร้อย (schema v4.2 · เพิ่มคอลัมน์ Email / Active ในแท็บ Users)', 'MGS Pricing', 8);
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
