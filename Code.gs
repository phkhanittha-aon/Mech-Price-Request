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
 *  H) v5.0 (คำขอราคาแบบ Food Price Request):
 *     · คำขอราคา (SR) วิ่งถึง Sourcing ตามกลุ่มสินค้าอัตโนมัติ — routeSR_() อ่าน Scope ของผู้ใช้ Sourcing ในแท็บ Users
 *       (ตั้งทับรายกลุ่มได้ที่ Settings.srRouting) เก็บใน Detail: routedTo / routedName / routedWhy / routedAt (ไม่มีคอลัมน์ใหม่)
 *     · อนุมัติ 2 ฝ่าย: Sourcing Manager (role Procurement Mgr) + BD Manager — ต้องครบทั้งคู่ กดก่อนหลังได้ (v5.1)
 *       GM อนุมัติแทนได้ทีละฝ่าย หรือทั้งหมด (p.all) — บันทึกว่า "อนุมัติแทน"
 *     · row.follow มี step / actor / due — ทุกหน้าจอแสดง "อยู่ขั้นไหน · รอใคร · ครบกำหนดเมื่อไร" จากค่าเดียวกัน
 *  I) v5.1: อนุมัติ 2 ฝ่ายกดก่อนหลังได้ · ล้างข้อมูลเหลือเฉพาะใบ Pending — exportPendingFile() → importUploadFile()
 *     (สำรองก่อนเสมอ · Settings.dataEpoch ใหม่ = ทุกเครื่องล้างสำเนาในเครื่องแล้วโหลดใหม่ · เครื่องเก่าส่งใบที่ถูกล้างกลับมาไม่ได้ = DATA_RESET)
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

var APP_VERSION = '5.1';   // ต้องตรงกับ APP_VERSION ใน Index.html / Sales.html (แสดงที่หน้า login และ ?diag=1)
var SHEET_ID = '';
var DEFAULT_PAGE = '';
var TZ = 'Asia/Bangkok';
var MAX_RETURN_ROWS = 1500;
var CELL_LIMIT = 49000;
var LOG_KEEP_ROWS = 5000;
var SESSION_HOURS = 12;

var SH = {
  QUOTES:'Quotations', PRODUCTS:'Products', SETTINGS:'Settings',
  USERS:'Users', LOG:'Log', SESSIONS:'Sessions', MASTER:'MasterData', NOTIFY:'NotifyQueue'
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
  Sessions:   ['Token','UserId','Role','Name','Issued','ExpiresMs','Expires','Agent'],
  MasterData: ['List','Value','IsDefault','Sort','Active','Updated','By'],     // v4.6: แท็บใหม่ (ไม่แตะแท็บเดิม)
  // v4.7: คิวแจ้งเตือน Lark (ไฟล์ Lark.gs) — ทุกข้อความที่จะส่ง/ส่งแล้ว/ส่งไม่ได้ อยู่ที่นี่ ตรวจย้อนหลังได้
  NotifyQueue:['Id','Event','DocId','DedupKey','Target','Title','Payload','Status','Tries','NextAt','CreatedAt','SentAt','LastError']
};

/* ============================================================ MASTER DATA (v4.6 Phase 4)
 * ตัวเลือกใน dropdown ที่เพิ่มได้โดยไม่ต้องแก้โค้ด — แท็บ MasterData หนึ่งแถว = หนึ่งตัวเลือก
 *   List      = ชื่อรายการ (คีย์ด้านล่าง)          Value  = ข้อความที่แสดง/บันทึกลงใบ
 *   IsDefault = TRUE ที่แถวไหน แถวนั้นเป็นค่าเริ่มต้นของใบใหม่    Sort = ลำดับ (น้อยขึ้นก่อน)
 *   Active    = FALSE เพื่อซ่อนตัวเลือก (ใบเก่าที่ใช้ค่านั้นอยู่ยังแสดงได้เหมือนเดิม)
 * add: ใครเพิ่มตัวเลือกใหม่ได้จากปุ่ม "อื่น ๆ (ระบุ)" — none = ห้ามเพิ่ม · internal = ทีมภายใน · any = ทุกคนที่ล็อกอิน
 * สกุลเงินห้ามเพิ่ม เพราะสูตรแปลงค่าเงินรองรับแค่ THB / USD / CNY (เลือกค่าเริ่มต้นได้)
 */
var MASTER_LISTS = {
  currency:    { label:'สกุลเงิน',          add:'none', fixed:['THB','USD','CNY'] },
  incoterm:    { label:'Incoterm',          add:'internal' },
  priceTerm:   { label:'Price Term',        add:'internal' },
  paymentTerm: { label:'เงื่อนไขชำระเงิน',   add:'internal' },
  validity:    { label:'ยืนราคา (วัน)',      add:'internal', numeric:true },
  uom:         { label:'หน่วยนับ',           add:'any' },
  expenseType: { label:'ประเภทค่าใช้จ่าย',    add:'internal' }
};
/* ค่าตั้งต้นตอนสร้างแท็บครั้งแรก (ตัวแรกของแต่ละรายการ = ค่าเริ่มต้น) — รวมกับรายการที่เคยตั้งไว้ใน Settings เดิมด้วย */
var MASTER_SEED = {
  currency:    ['THB','USD','CNY'],
  incoterm:    ['CIF at MGS','DDP at MGS','DDU at MGS','EXWORKS','FOB','CIF at port','DAP (Air)','DPP at site'],
  priceTerm:   ['Special price','MOU price','Standard Price'],
  paymentTerm: ['เงินสด / โอนก่อนส่งสินค้า','เครดิต 30 วัน','มัดจำ 30% ส่วนที่เหลือก่อนส่งสินค้า'],
  validity:    ['30','7','15','45','60','90'],
  uom:         ['pcs','set','M','Unit','kW','MW','MWH'],
  expenseType: ['ค่าขนส่ง','ค่าติดตั้ง','ค่าดำเนินการ','ค่าเดินพิธีการ','ค่าประกันภัยขนส่ง']
};
var MASTER_SETTINGS_KEY = { incoterm:'incoterms', priceTerm:'priceTerms', uom:'units' };

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
  'sourcing manager':'Procurement Mgr', 'sourcing mgr':'Procurement Mgr', 'sourcing mgr.':'Procurement Mgr',   // v5.0: ผู้อนุมัติระดับ 1
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
/** v5.0: ชื่อที่แสดงของ role (ค่าในชีทยังเป็นชื่อมาตรฐานเดิม) */
var ROLE_LABEL = { 'Procurement Mgr':'Sourcing Manager', 'BD Mgr':'BD Manager' };
function roleLabel_(role) { return ROLE_LABEL[role] || role; }

/** BUSINESS RULE: tier ที่ได้ข้อมูลเต็ม (Cost / Profit / GP / Detail) เสมอ ทุกสถานะ — ไม่มีการ strip
 *  เฉพาะ tier SALES เท่านั้นที่ถูกตัดต้นทุน */
var FULL_DATA_TIERS = ['ADMIN', 'MANAGEMENT', 'INTERNAL'];
function seesFullData_(sess) {
  return !!(sess && sess.caps && FULL_DATA_TIERS.indexOf(sess.caps.tier) >= 0 && sess.caps.viewCost);
}

/* ---- อนุมัติ 2 ฝ่าย (v5.1: กดก่อนหลังได้ ต้องครบทั้งคู่) — ต้องตรงกับ REQUIRED_APPROVAL_ROLES / APPROVAL_OVERRIDE_ROLES ใน Index.html
 * ลำดับใน array = ลำดับที่แสดง (Sourcing Manager ก่อน BD Manager) และฝ่ายที่ GM อนุมัติแทนก่อนเมื่อกดทีละฝ่าย
 * approvalRoles ในใบ = ระดับที่ผ่านแล้ว (ชื่อ role ของระดับนั้น) · approvals = ใครกดจริง (GM อนุมัติแทนมี onBehalfOf)
 * ข้อมูลเก่า: approvalRoles มี 'GM' = GM อนุมัติแทนครบทุกระดับ (รุ่น v4.x) ยังอ่านได้เหมือนเดิม */
var REQUIRED_APPROVAL_ROLES = ['Procurement Mgr', 'BD Mgr'];
var APPROVAL_OVERRIDE_ROLES = ['GM'];      // GM อนุมัติแทนได้ทุกฝ่าย (ทีละฝ่าย หรือทั้งหมดในครั้งเดียว)
var APPROVAL_LEVEL_TH = { 'Procurement Mgr':'Sourcing Manager', 'BD Mgr':'BD Manager' };
/** สถานะการอนุมัติจาก approvalRoles → { done, missing (ฝ่ายที่ยังไม่อนุมัติ), next (ฝ่ายแรกที่ยังไม่อนุมัติ), approved (ฝ่ายที่ผ่านแล้ว), complete } */
function approvalStep_(roles) {
  roles = (Object.prototype.toString.call(roles) === '[object Array]') ? roles : [];
  var legacyOverride = roles.some(function (r) { return APPROVAL_OVERRIDE_ROLES.indexOf(r) >= 0; });
  var missing = legacyOverride ? [] : REQUIRED_APPROVAL_ROLES.filter(function (r) { return roles.indexOf(r) < 0; });
  var next = missing.length ? missing[0] : '';
  var approved = REQUIRED_APPROVAL_ROLES.filter(function (r) { return missing.indexOf(r) < 0; });
  return { done:roles.slice(), missing:missing, next:next, level:next ? REQUIRED_APPROVAL_ROLES.indexOf(next) + 1 : 0,
           approved:approved, complete:!missing.length, legacyOverride:legacyOverride };
}
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
        ' · ' + (c.indexOf(f[1]) > 0 ? 'เวอร์ชัน ' + f[1] : '<b style="color:#bb3b2f">ไม่ใช่เวอร์ชัน ' + APP_VERSION + ' — วางไฟล์ใหม่ทั้งไฟล์</b>') + (guard ? '' : ' · ไม่มี boot guard'));
    } catch (e) {
      add('ไฟล์ HTML "' + f[0] + '"', false, 'ไม่พบไฟล์ชื่อ <b>' + f[0] + '</b> (ต้องตั้งชื่อตรงตัวพิมพ์ ไม่ต้องใส่ .html) — ' + String(e));
    }
  });
  if (typeof larkValidateConfig_ === 'function') {
    try {
      var lc = larkValidateConfig_();
      add('Lark (Lark.gs v' + LARK_VERSION + ')', lc.problems.length === 0,
        'โหมด <b>' + lc.mode + '</b>' + (lc.mode === 'dryrun' ? ' (ไม่ส่งจริง — ดูข้อความในแท็บ NotifyQueue)' : '') + ' · ช่องทาง ' + lc.via +
        lc.problems.map(function (x) { return '<br><b style="color:#bb3b2f">✗ ' + x + '</b>'; }).join('') +
        lc.warnings.map(function (x) { return '<br>⚠ ' + x; }).join(''));
    } catch (e) { add('Lark', false, String(e)); }
  } else add('Lark', true, 'ยังไม่ได้เพิ่มไฟล์ Lark.gs (ระบบหลักทำงานได้ปกติ ไม่มีแจ้งเตือน)');
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
function meOf_(sess) { return { id:sess.userId, name:sess.name, email:sess.email || '', role:sess.role, roleLabel:roleLabel_(sess.role), tier:sess.caps.tier, caps:sess.caps }; }
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
      case 'addMaster':    return addMaster_(p, sess);
      case 'saveMaster':   return need_(sess,'manageSetting') || saveMaster_(p, sess);
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
    var withEpoch = function (o) { o.dataEpoch = dataEpoch_().epoch; return o; };   // v5.1: ผู้ดูแลล้างข้อมูลชุดใหม่ → เครื่องล้างสำเนาแล้วโหลดใหม่
    switch (type) {
      case 'quotations': return withEpoch({ ok:true, quotations:getQuotations_(sess), view:view, serverTime:serverTime, me:meOf_(sess) });
      case 'changes': {
        // Live polling: ส่งเฉพาะแถวที่ UpdatedAt ใหม่กว่า since (เบากว่าดึงทั้งชีททุก 30 วินาทีมาก)
        var sinceMs = toMs_(arg);
        if (!sinceMs) return { ok:false, error:'missing since' };
        return withEpoch({ ok:true, quotations:getQuotations_(sess, { sinceMs:sinceMs }), view:view, serverTime:serverTime, me:meOf_(sess) });
      }
      case 'quote': {
        // เปิดดู/แก้ใบเดียว → ดึงเวอร์ชันล่าสุดของใบนั้นจาก Sheet (ผ่านกฎ projection เดียวกันทุกประการ)
        if (!arg) return { ok:false, error:'missing id' };
        var one = getQuotations_(sess, { id:String(arg) });
        return { ok:true, quote:one.length ? one[0] : null, view:view, serverTime:serverTime };
      }
      case 'products':   return { ok:true, products:getProducts_(sess) };
      case 'settings':   { var st = getSettings_(sess); st.master = getMaster_(); return st; }
      case 'master':     return { ok:true, master:getMaster_() };
      case 'users':      return { ok:true, users:getUsers_(sess) };
      case 'whoami':     return { ok:true, user:meOf_(sess) };
      case 'salesview': {
        // แอป Sales: ทุก role ได้ "มุมมองปลอดต้นทุน" (SalesDetail) — role ภายในเห็นทุกคน + ยอด/GP สรุป
        var sv = toMs_(arg);
        return withEpoch({ ok:true, quotations:getQuotations_(sess, { salesView:true, sinceMs:sv || 0 }), view:'salesview', serverTime:serverTime, me:meOf_(sess) });
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
  if (!row && p.baseUpdatedAt) {
    // v5.1: ใบที่ client เคยเห็นบน Sheet (มี baseUpdatedAt) แต่ไม่มีแล้ว และถูกล้างไปตอนล้างข้อมูลชุดใหม่ → ห้ามสร้างกลับ
    var ep = dataEpoch_();
    if (ep.atMs && toMs_(p.baseUpdatedAt) <= ep.atMs) return { ok:false, error:'DATA_RESET', code:409, id:p.id, dataEpoch:ep.epoch };
  }
  var prevStatus = row ? String(sh.getRange(row, idx['Status']).getValue() || '') : '';   // v4.7: ใช้ตัดสินว่าต้องแจ้งเตือนไหม
  var stamp = nowISO_();
  var route = null;
  if (String(p.docType || '') === 'SR' && p.detail) {
    // v5.0: SR ที่บันทึกจากระบบทำราคา (รับงาน / ส่งต่อ / สร้างแทน Sales) — ผู้รับคำขอตัดสินที่ server เหมือน saveSR_
    try {
      var srDoc = JSON.parse(p.detail), srPrev = null;
      if (row && idx.Detail) { try { srPrev = JSON.parse(String(sh.getRange(row, idx.Detail).getValue() || '{}')); } catch (e) { srPrev = null; } }
      route = applyRoute_(srDoc, srPrev, sess, peopleCtx_());
      p.detail = JSON.stringify(srDoc);
    } catch (e) { route = null; }
  }
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
  var savedRow = writeRow_(sh, idx, row, vals);
  logRow_('save', p.docNo || p.ref || '', p.id, sess.name, detail.note + (p.force ? ' (force)' : ''));
  larkHook_(sh, idx, savedRow, prevStatus, vals.Status, sess, (route && route.forwarded && vals.Status === 'Submitted') ? { event:'SR_FORWARDED' } : null);
  var out = { ok:true, id:p.id, trimmed:detail.trimmed, updatedAt:stamp, follow:followForRow_(sh, idx, savedRow) };
  if (route) { try { var rd = JSON.parse(p.detail); out.routedTo = rd.routedTo || ''; out.routedName = rd.routedName || ''; out.routedWhy = rd.routedWhy || ''; } catch (e) {} }
  return out;
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
  if (!row && doc.docNo) {
    // v5.1: แก้คำขอที่มีเลขแล้วแต่ไม่อยู่ในชีท = ถูกล้างไปตอนล้างข้อมูลชุดใหม่ → ห้ามสร้างกลับ (คำขอใหม่ไม่มีเลข ส่งได้ตามปกติ)
    var ep0 = dataEpoch_();
    if (ep0.atMs) return { ok:false, error:'DATA_RESET', code:409, id:p.id, dataEpoch:ep0.epoch };
  }
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
      uom: L.uom || 'pcs', qty: num_(L.qty, 1) || 1,
      up: 0, costCur: (doc.header && doc.header.currency) || 'THB',
      dutyPct: 0, clearancePct: 0, opPct: 0, freep: 0, extras: [],
      targetUp: num_(L.targetUp, 0), salesNote: L.salesNote || '',
      warranty: L.warranty || '', lead: L.lead || ''
    };
  });
  var route = applyRoute_(doc, prev, sess, peopleCtx_());     // v5.0: ส่งถึง Sourcing ตามกลุ่มสินค้า (Sales ปลอมผู้รับไม่ได้)
  var stamp = nowISO_();
  doc.updatedAt = stamp;
  var d = safeDetail_(JSON.stringify(doc));
  var salesCopy = JSON.parse(JSON.stringify(doc)); delete salesCopy.auditLogs;
  var sd = safeDetail_(JSON.stringify(stripCost_(salesCopy)));

  var srRow = writeRow_(sh, idx, row, {
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
  larkHook_(sh, idx, srRow, prev ? (prev.status || '') : '', doc.status || 'Submitted', sess,
            (route.forwarded && doc.status === 'Submitted') ? { event:'SR_FORWARDED' } : null);
  return { ok:true, id:p.id, docNo:doc.docNo, updatedAt:stamp, follow:followForRow_(sh, idx, srRow),
           routedTo:doc.routedTo || '', routedName:doc.routedName || '', routedWhy:doc.routedWhy || '' };
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
  larkHook_(sh, idx, row, stNow, 'Pending', sess, { event:'PRICE_RELEASED' });
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

/** v4.7: แจ้งเตือน Lark เมื่อสถานะเปลี่ยน — อยู่ในไฟล์ Lark.gs (ไม่มีไฟล์นั้น = ข้ามเงียบ ๆ)
 *  เรียกหลังเขียนแถวสำเร็จแล้วเท่านั้น · แค่เข้าคิว ไม่ยิง HTTP ในธุรกรรมหลัก · ผิดพลาดอย่างไรก็ไม่ทำให้การบันทึกล้ม */
function larkHook_(sh, idx, row, prevStatus, newStatus, sess, extra) {
  try { if (typeof larkOnStatus_ === 'function' && row) return larkOnStatus_(sh, idx, row, prevStatus, newStatus, sess, extra); }
  catch (e) { try { logRow_('lark-hook-error', '', '', '-', String(e).slice(0, 300)); } catch (e2) {} }
  return null;
}

/** บันทึกเวลาเปลี่ยนสถานะ (ใช้นับวัน SLA แยกช่วง) — คีย์ใหม่แบบ optional ข้อมูลเก่าที่ไม่มีก็ยังอ่านได้ */
function stampStatus_(d, status, at) {
  d.statusChangedAt = at;
  if (Object.prototype.toString.call(d.statusLog) !== '[object Array]') d.statusLog = [];
  d.statusLog.push({ s:status, at:at });
  if (d.statusLog.length > 40) d.statusLog = d.statusLog.slice(-40);
}

/** อนุมัติ 2 ฝ่ายแบบ atomic (อยู่ใต้ ScriptLock ของ handle_) — v5.1
 *  Sourcing Manager (Procurement Mgr) + BD Manager ต้องครบทั้งคู่ · กดก่อนหลังได้ · ฝ่ายเดิมกดซ้ำไม่ได้ (ALREADY_APPROVED)
 *  GM อนุมัติแทนได้ทุกฝ่าย: ปกติ = ฝ่ายแรกที่ยังขาด 1 ฝ่าย · p.all = ทุกฝ่ายที่เหลือในครั้งเดียว — บันทึก onBehalfOf ทุกครั้ง
 *  อ่าน approvalRoles ล่าสุดจาก Sheet → เติมฝ่ายที่ผ่าน → คำนวณสถานะใหม่ → เขียนกลับในครั้งเดียว (กดพร้อมกันก็ไม่หาย) */
function approve_(p, sess) {
  if (!p.id) return { ok:false, error:'missing id' };
  var role = sess.role, isGM = APPROVAL_OVERRIDE_ROLES.indexOf(role) >= 0;
  if (REQUIRED_APPROVAL_ROLES.indexOf(role) < 0 && !isGM)
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
  var before = approvalStep_(roles);
  if (!isGM) {
    if (roles.indexOf(role) >= 0 || before.complete) return { ok:false, error:'ALREADY_APPROVED', code:409, approvalRoles:roles, serverStatus:status };
  }
  var fill = isGM ? (p.all ? before.missing.slice() : (before.next ? [before.next] : [])) : [role];
  var stamp = nowISO_();
  var approvals = (Object.prototype.toString.call(d.approvals) === '[object Array]') ? d.approvals.slice() : [];
  fill.forEach(function (lvRole) {
    if (roles.indexOf(lvRole) < 0) roles.push(lvRole);
    var a = { by:sess.name, userId:sess.userId, role:role, level:REQUIRED_APPROVAL_ROLES.indexOf(lvRole) + 1, levelRole:lvRole,
              act:isGM ? 'อนุมัติแทน ' + roleLabel_(lvRole) : 'อนุมัติ', at:stamp };
    if (isGM) a.onBehalfOf = lvRole;
    approvals.push(a);
  });
  var after = approvalStep_(roles), complete = after.complete;
  var newStatus = complete ? 'Approved' : 'Partial Approved';
  var patch = { approvalRoles:roles, approvals:approvals, status:newStatus, _sv:3,
                stage:complete ? 'Approved' : 'Submitted', followStatus:'Pending',
                rev:(Number(d.rev) || 0) + 1, updated:todayStr_() };
  if (complete) patch.needsApproval = false;
  var lvTxt = fill.map(roleLabel_).join(' + ');
  var audit = { timestamp:stamp, user:sess.name, role:role,
                action:(isGM ? 'GM อนุมัติแทน ' : 'Approved ') + lvTxt + ': ' + status + ' → ' + newStatus +
                       (complete ? '' : ' (รอ ' + after.missing.map(roleLabel_).join(', ') + ')') };
  var detailText = patchDetailCells_(sh, idx, row, patch, audit, stamp);
  var vals = { Status:newStatus, Stage:patch.stage, FollowStatus:'Pending',
               Updated:todayStr_(), UpdatedAt:stamp, By:sess.name };
  if (complete) vals.NeedsApproval = '';
  writeRow_(sh, idx, row, vals);
  logRow_('approve', String(cell_(cur, idx, 'DocNo') || ''), p.id, sess.name, role + ' [' + fill.join('+') + '] → ' + newStatus);
  larkHook_(sh, idx, row, status, newStatus, sess);
  return { ok:true, id:p.id, status:newStatus, approvalRoles:roles, missing:after.missing, approvedLevels:fill,
           next:after.next, nextLabel:after.next ? roleLabel_(after.next) : '', missingLabel:after.missing.map(roleLabel_).join(' + '), level:after.level,
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
  // 1) ค่าที่ตั้งไว้ ถ้าตรงกับผู้ใช้จริง → 2) ผู้ใช้ฝ่ายขายที่ชื่อ NON → 3) ค่าที่ตั้งไว้ (แม้หา user ไม่เจอ) หรือ default
  return gateFromList_(set, users);
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
  var people = peopleCtx_();                              // v5.0: อ่าน Users + Settings ครั้งเดียว ใช้ทั้งผู้ปล่อยราคาและชื่อผู้ดำเนินการ
  var gate = full ? '' : people.gate;
  var delegate = full ? '' : people.delegate;
  return { full:full, gate:gate, salesView:!!(opts && opts.salesView), people:people,
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
  base.follow = followActors_(followState_(fi, ctx.followCfg, ctx.nowMs), ctx.people);
  if (fi.docType === 'SR' && fi.routedTo !== undefined) {           // v5.0: SR ส่งถึงใคร (ไม่มีราคา — ทุก role เห็นได้)
    var det0 = String(cell_(r, idx, 'Detail') || '');
    base.routedTo = fi.routedTo; base.routedName = topStr_(det0, 'routedName'); base.routedWhy = topStr_(det0, 'routedWhy');
  }
  // ใบ Pending รุ่นเก่าที่มีราคาฉบับ Sales แล้วแต่ยังไม่ได้ปล่อยให้เจ้าของงาน → ผู้ปล่อยราคากดยืนยันได้
  var legacyRelease = base.follow.owner === 'RELEASER' && String(base.status) === 'Pending';

  if (ctx.full && ctx.salesView) {
    // แอป Sales เปิดโดย role ภายใน (ผู้จัดการดูหน้าของ Sales แต่ละคน): ใช้ SalesDetail เหมือน Sales เห็น
    // + ยอดรวม/GP สรุประดับใบ (ไม่ส่ง Detail/โครงสร้างต้นทุนรายบรรทัดออกไปที่แอปนี้)
    var st0 = String(base.status || ''), dt0 = String(base.docType || 'QT');
    base.salesDetail = salesSafe_(cell_(r, idx, 'SalesDetail') || (dt0 === 'SR' ? cell_(r, idx, 'Detail') : ''));
    base.salesValue = num_(cell_(r, idx, 'Total'));
    base.gp = num_(cell_(r, idx, 'GP'));
    base.priceLocked = false;
    base.canRelease = !!sess.caps.approve && (st0 === 'Approved' || legacyRelease) && dt0 !== 'SR';
    base.valueTHB = salesValueTHB_(r, idx);
    return base;
  }
  if (ctx.full) {
    base.needsApproval = String(cell_(r, idx, 'NeedsApproval')).toUpperCase() === 'TRUE';
    base.total  = num_(cell_(r, idx, 'Total'));
    base.cost   = num_(cell_(r, idx, 'Cost'));
    base.profit = num_(cell_(r, idx, 'Profit'));
    base.gp     = num_(cell_(r, idx, 'GP'));
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
    base.salesValue  = num_(cell_(r, idx, 'Total'));
    base.salesDetail = salesSafe_(cell_(r, idx, 'SalesDetail'));   // ห้ามใช้ Detail เด็ดขาด
    base.priceLocked = !fi.hasSalesCopy;                           // ใบรุ่นเก่ายังไม่มีราคาฉบับ Sales
    base.valueTHB = salesValueTHB_(r, idx);                        // แค่ยอดรวมเป็นบาท ไม่ส่งอัตราแลกเปลี่ยนออกไป
  } else {
    base.salesDetail = '';                                         // ยังไม่ปล่อยราคา → ไม่ส่งราคาออกไปเลย
    base.priceLocked = true;
  }
  return base;
}

/* ============================================================ ROUTING (v5.0) — คำขอราคาวิ่งถึง Sourcing ตามกลุ่มสินค้า
 * ใช้โครงสร้างที่มีอยู่แล้ว: คอลัมน์ Scope ของผู้ใช้ role Sourcing ในแท็บ Users (กลุ่มสินค้าที่แต่ละคนดูแล)
 * ลำดับการตัดสิน (routeFor_):
 *   1) Settings.srRouting[กลุ่มงาน] = Id ผู้ใช้ (ตั้งจากหน้า ⚙️ ตั้งค่า) — ใช้ก่อนเสมอถ้าผู้ใช้นั้นยัง Active และไม่ใช่ฝ่ายขาย
 *   2) คะแนนจาก Scope: กลุ่มหลักของกลุ่มงาน +10 · กลุ่มรอง +1 · กลุ่มสินค้าของรายการในคำขอ +3 ต่อรายการ · Scope "ทุกกลุ่ม" = 1
 *      ได้คะแนนสูงสุดคนเดียว → ส่งถึงคนนั้น · เสมอกัน/ไม่มีใครตรง → ส่งถึง "ทีม Sourcing" (ทุกคนเห็น ใครรับก่อนได้งาน)
 * ผลเก็บใน Detail ของ SR (ไม่มีคอลัมน์ใหม่): routedTo / routedName / routedWhy (setting|scope|manual|pool) / routedAt / routedBy */
var GROUP_TYPE_GROUPS = {
  'Inverter':    ['INVERTER', 'MICRO INVERTER', 'OPTIMIZER', 'DATA LOGGER', 'MONITORING', 'ENERGY METER', 'SENSOR', 'RAPID SHUTDOWN', 'SOLAREDGE', 'CURRENT TRANFORMER'],
  'Mounting':    ['MOUNTING', 'CARPORT', 'WALKWAY', 'FLOATING'],
  'DC Cable':    ['DC CABLE', 'CONNECTOR'],
  'EV Charger':  ['EV CHARGER', 'EV CHARGE'],
  'ESS':         ['ENERGY STORAGE', 'BATTERY'],
  'Residential': ['INVERTER', 'BATTERY', 'PV MODULE']
};
var ROUTE_WHY_TH = { setting:'ตั้งค่าผู้รับตามกลุ่มงาน', scope:'ตามกลุ่มสินค้าที่ดูแล', manual:'ส่งต่อโดยทีมภายใน', pool:'ส่งถึงทีม Sourcing' };
function upGroup_(g) { return String(g || '').toUpperCase().replace(/\s+/g, ' ').trim(); }
/** Scope ในชีท → 'all' หรือ array ของกลุ่ม (ตัวพิมพ์ใหญ่) — รองรับ JSON array / "all" / คั่นด้วยจุลภาค */
function parseScope_(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s || s.toLowerCase() === 'all' || s === '"all"') return 'all';
  var arr = null;
  try { var j = JSON.parse(s); if (Object.prototype.toString.call(j) === '[object Array]') arr = j; else if (j === 'all') return 'all'; } catch (e) {}
  if (!arr) arr = s.split(',');
  arr = arr.map(upGroup_).filter(function (x) { return x; });
  return arr.length ? arr : 'all';
}
/** ผู้ปล่อยราคาจากรายชื่อผู้ใช้ (กติกาเดียวกับ gatekeeperId_) */
function gateFromList_(set, users) {
  for (var a = 0; a < users.length; a++) if (set && users[a].id === set) return set;
  for (var b = 0; b < users.length; b++) if (users[b].role === 'Sales' && String(users[b].name).trim().toUpperCase() === 'NON') return users[b].id;
  return set || 'sales_non';
}
/** ผู้ใช้ทุกคน + การตั้งค่าที่ใช้ตัดสิน "ใครต้องทำต่อ" — อ่าน Users + Settings ครั้งเดียวต่อ request (ห้ามเรียกในลูป) */
function peopleCtx_() {
  var out = { list:[], byId:{}, routing:{}, gate:'', delegate:'' };
  try {
    var sh = sheet_(SH.USERS), idx = headerIndex_(sh), last = sh.getLastRow();
    if (last >= 2) sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues().forEach(function (r) {
      var id = String(cell_(r, idx, 'Id') || '').trim(); if (!id) return;
      var role = normRole_(cell_(r, idx, 'Role'));
      var u = { id:id, name:String(cell_(r, idx, 'Name') || id), role:role, tier:capsOf_(role).tier,
                email:String(cell_(r, idx, 'Email') || '').trim().toLowerCase(), active:isActiveUser_(r, idx),
                scope:parseScope_(cell_(r, idx, 'Scope')) };
      out.list.push(u); out.byId[id] = u;
    });
  } catch (e) {}
  var st = {}; try { st = getSettingsRaw_() || {}; } catch (e) {}
  out.routing = (st.srRouting && typeof st.srRouting === 'object') ? st.srRouting : {};
  out.gate = gateFromList_(String(st.releaseGatekeeperId || ''), out.list);
  out.delegate = String(st.releaseDelegateId || '');
  return out;
}
/** ผู้รับคำขอราคาของกลุ่มงานนี้ → { id, name, why } (id ว่าง = ส่งถึงทีม Sourcing) — pure (ไม่มี I/O) */
function routeFor_(groupType, lineGroups, people) {
  var gt = String(groupType || '').trim(), ov = String((people.routing || {})[gt] || '').trim();
  if (ov) {
    var o = people.byId[ov];
    if (o && o.active && o.tier !== 'SALES') return { id:o.id, name:o.name, why:'setting' };
  }
  var groups = GROUP_TYPE_GROUPS[gt] || [upGroup_(gt)], primary = groups[0];
  var lg = (lineGroups || []).map(upGroup_).filter(function (x) { return x; });
  var best = null, bestScore = 0, tie = false;
  people.list.forEach(function (u) {
    if (!u.active || u.role !== 'Sourcing') return;
    var sc = 0;
    if (u.scope === 'all') sc = 1;
    else {
      if (u.scope.indexOf(primary) >= 0) sc += 10;
      for (var i = 1; i < groups.length; i++) if (u.scope.indexOf(groups[i]) >= 0) sc += 1;
      lg.forEach(function (g) { if (u.scope.indexOf(g) >= 0) sc += 3; });
    }
    if (sc > bestScore) { best = u; bestScore = sc; tie = false; }
    else if (sc > 0 && sc === bestScore) tie = true;
  });
  if (best && !tie) return { id:best.id, name:best.name, why:'scope' };
  return { id:'', name:'ทีม Sourcing', why:'pool' };
}
/**
 * ใส่ผู้รับคำขอลงในเอกสาร SR (แก้ doc ตรง ๆ) — เรียกตอนบันทึก SR ทุกครั้ง
 *  · ร่าง (Draft) = ยังไม่ส่งถึงใคร · Sales ส่งค่า routed* มาเองไม่มีผล (ปลอมผู้รับไม่ได้)
 *  · ทีมภายใน "ส่งต่อ" ได้ด้วย doc.routedManual = true + doc.routedTo = Id ผู้รับ
 *  · กลุ่มงานเดิม = คงผู้รับเดิม · เปลี่ยนกลุ่มงาน = คำนวณใหม่
 * @return {{routed:boolean, forwarded:boolean}}
 */
var ROUTE_KEYS = ['routedTo', 'routedName', 'routedWhy', 'routedAt', 'routedBy'];
function applyRoute_(doc, prev, sess, people) {
  var res = { routed:false, forwarded:false }, incoming = doc.routedTo, manual = !!doc.routedManual;
  delete doc.routedManual;
  ROUTE_KEYS.forEach(function (k) { delete doc[k]; });
  if (String(doc.status || 'Submitted') === 'Draft') return res;
  var gt = String((doc.header || {}).groupType || '');
  if (sess.caps.writeQuote && manual && incoming) {
    var u = people.byId[String(incoming)];
    if (u && u.active && u.tier !== 'SALES') {
      doc.routedTo = u.id; doc.routedName = u.name; doc.routedWhy = 'manual'; doc.routedAt = nowISO_(); doc.routedBy = sess.name;
      res.routed = true; res.forwarded = !prev || String(prev.routedTo || '') !== u.id;
      return res;
    }
  }
  if (prev && prev.routedWhy && String((prev.header || {}).groupType || '') === gt) {
    ROUTE_KEYS.forEach(function (k) { if (prev[k] !== undefined) doc[k] = prev[k]; });
    return res;
  }
  var r = routeFor_(gt, (doc.lines || []).map(function (L) { return L && L.group; }), people);
  doc.routedTo = r.id; doc.routedName = r.name; doc.routedWhy = r.why; doc.routedAt = nowISO_(); doc.routedBy = 'auto';
  res.routed = true;
  return res;
}

/* ============================================================ FOLLOW-UP OWNERSHIP + SLA (v4.3)
 * ฟังก์ชันเดียวที่ตัดสินว่า "งานนี้รออยู่ที่ใคร" — ทั้งระบบทำราคาและแอป Sales ใช้ค่านี้ (row.follow) ห้ามคำนวณเองซ้ำ
 *   owner: SOURCING | MANAGEMENT | RELEASER | REPAIR | SALES | DONE
 *   REPAIR = ใบ Pending รุ่นเก่าที่ยังไม่มี "ราคาฉบับ Sales" (SalesDetail) → ต้องให้ทีมภายในกดสร้างข้อมูลสำหรับ Sales
 *   งานจะเป็น "งานค้างของ Sales" ได้ต่อเมื่อปล่อยราคาให้เจ้าของงานแล้ว และมีราคาฉบับ Sales จริงเท่านั้น
 * อ่านค่าจาก Detail ด้วย regex เฉพาะคีย์ระดับบน (ไม่ JSON.parse ทั้งก้อน) → เบาพอจะทำทุกแถวทุกครั้งที่โหลด */
var FOLLOW_LABEL = {
  SOURCING:'รอ Sourcing จัดทำราคา', MANAGEMENT:'รออนุมัติราคา (2 ระดับ)', RELEASER:'รอปล่อยราคา',
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
    quoteIds:topArr_(det, 'quoteIds') || [],
    assignedTo:String(cell_(r, idx, 'AssignedTo') || ''),       // v5.0: ผู้ทำราคา (Sourcing ที่รับงาน)
    routedTo:topStr_(det, 'routedTo')                           // v5.0: SR ส่งถึงใคร (routeSR)
  };
}
/* v5.0: ขั้นตอนของคำขอราคา (stepper ทุกหน้าจอใช้ชุดนี้)  0 ส่งคำขอ · 1 Sourcing ทำราคา · 2–3 อนุมัติ 2 ฝ่าย
 *       (Sourcing Manager + BD Manager · v5.1 กดก่อนหลังได้ → step = 2 + จำนวนฝ่ายที่ผ่าน, approvedRoles บอกว่าฝ่ายไหนผ่าน)
 *       4 ปล่อยราคา · 5 ได้ราคาแล้ว   (-1 = ยกเลิก)
 * actor = ใครต้องทำต่อ: {kind:'user', ids} | {kind:'roles', roles} | {kind:'releaser'} | {kind:'pool'} (ทีม Sourcing ทุกคน) */
var FLOW_STEPS = ['ส่งคำขอ', 'Sourcing ทำราคา', 'Sourcing Manager', 'BD Manager', 'ปล่อยราคา', 'ได้ราคาแล้ว'];
function stepOf_(f, owner) {
  var st = f.status;
  if (f.docType === 'SR') {
    if (owner === 'DONE') return ((f.quoteIds && f.quoteIds.length) || st === 'Quoted') ? { step:2, actor:null, handedOff:true } : { step:-1, actor:null };
    if (owner === 'SALES') return { step:0, actor:{ kind:'user', ids:[f.owner] } };
    var who = (st === 'Accepted' && f.assignedTo) ? f.assignedTo : (f.routedTo || f.assignedTo);
    return { step:1, actor:who ? { kind:'user', ids:[who] } : { kind:'pool' } };
  }
  if (owner === 'SOURCING') return { step:1, actor:f.assignedTo ? { kind:'user', ids:[f.assignedTo] } : { kind:'pool' } };
  if (owner === 'REPAIR') return { step:4, actor:f.assignedTo ? { kind:'user', ids:[f.assignedTo] } : { kind:'pool' } };
  if (owner === 'MANAGEMENT') {
    var a = approvalStep_(f.approvalRoles), miss = a.missing.length ? a.missing : REQUIRED_APPROVAL_ROLES.slice();
    return { step:Math.min(3, 2 + a.approved.length), actor:{ kind:'roles', roles:miss }, approvedRoles:a.approved };
  }
  if (owner === 'RELEASER') return { step:4, actor:{ kind:'releaser' } };
  if (owner === 'SALES') return { step:5, actor:{ kind:'user', ids:[f.owner] } };
  return { step:(st === 'Closed' && !(f.releasedTo && f.releasedTo.length)) ? -1 : 5, actor:null };
}
/** สถานะของ 5 จุดในแถบขั้นตอน ('done' | 'now' | 'todo') — ใช้ร่วมกันทั้งการ์ด Lark และหน้าจอ (ต้องตรงกับ flowDots() ใน HTML)
 *  ช่วงอนุมัติ (จุด 3–4) ดูรายฝ่ายจาก approvedRoles: ฝ่ายที่ผ่านแล้ว = done · ฝ่ายที่ยังรอ = now (รอพร้อมกันได้) */
function flowDots_(step, approvedRoles) {
  if (step == null || step < 0) return [];
  var ap = approvedRoles || [], out = [];
  for (var i = 0; i < 5; i++) {
    if (step >= 5) { out.push('done'); continue; }
    if (i === 2 || i === 3) {
      if (step >= 4) out.push('done');
      else if (step >= 2) out.push(ap.indexOf(REQUIRED_APPROVAL_ROLES[i - 2]) >= 0 ? 'done' : 'now');
      else out.push('todo');
      continue;
    }
    out.push(i < step ? 'done' : i === step ? 'now' : 'todo');
  }
  return out;
}
/** วันที่ครบกำหนด (yyyy-MM-dd ตามเวลาไทย) = วันทำการที่ n หลังวันเริ่ม — เลยวันนี้ไปแล้ว = เกินกำหนด (ตรงกับ slaBreached) */
function addBizDays_(fromMs, n) {
  var day = 86400000, off = 7 * 3600000, d = Math.floor((fromMs + off) / day), k = 0, guard = 0;
  while (k < n && guard++ < 400) { d++; var wd = (d + 4) % 7; if (wd !== 0 && wd !== 6) k++; }
  return new Date(d * day).toISOString().slice(0, 10);
}
/** ผู้ใช้ที่ต้องทำต่อ (สำหรับแสดงชื่อ / @mention ใน Lark) — pure */
function actorUsers_(actor, people) {
  if (!actor || !people) return [];
  var list = people.list || [], byId = people.byId || {};
  if (actor.kind === 'user') return (actor.ids || []).map(function (id) { return byId[id]; }).filter(function (u) { return !!u; });
  if (actor.kind === 'roles' || actor.kind === 'role') {
    var rs = actor.roles || [actor.role];
    return list.filter(function (u) { return u.active && rs.indexOf(u.role) >= 0; });
  }
  if (actor.kind === 'releaser') return [byId[people.gate], people.delegate ? byId[people.delegate] : null].filter(function (u) { return !!u; });
  if (actor.kind === 'pool') return list.filter(function (u) { return u.active && u.role === 'Sourcing'; });
  return [];
}
/** เติมชื่อผู้ดำเนินการลงใน follow (ไม่ส่งอีเมลออกไป) */
function followActors_(out, people) {
  var a = out && out.actor; if (!a || !people) return out;
  var names = actorUsers_(a, people).map(function (u) { return u.name; });
  a.names = names;
  a.label = (a.kind === 'roles' || a.kind === 'role') ? (a.roles || [a.role]).map(function (r) {
              var ns = actorUsers_({ kind:'roles', roles:[r] }, people).map(function (u) { return u.name; });
              return roleLabel_(r) + (ns.length ? ' · ' + ns.join(', ') : ''); }).join(' / ')
          : a.kind === 'pool' ? 'ทีม Sourcing' + (names.length ? ' (' + names.join(', ') + ')' : '')
          : a.kind === 'releaser' ? 'ผู้ปล่อยราคา · ' + (names.join(', ') || 'NON')
          : (names.join(', ') || (a.ids || []).join(', ') || '—');
  return out;
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
  var stp = stepOf_(f, owner);
  var out = { owner:owner, ownerLabel:FOLLOW_LABEL[owner], label:FOLLOW_LABEL[owner], actionable:false,
              waitingDays:0, slaDays:0, level:'ok', slaBreached:false, since:new Date(sinceMs).toISOString(),
              stageDays:stageDays, estimated:!log.length,
              step:stp.step, actor:stp.actor, due:'' };            // v5.0
  if (stp.handedOff) out.handedOff = true;
  if (stp.approvedRoles) out.approvedRoles = stp.approvedRoles;
  if (owner === 'DONE') {
    out.label = isSR ? ((f.quoteIds && f.quoteIds.length) || st === 'Quoted' ? 'จัดทำใบเสนอราคาแล้ว' : st === 'Cancelled' ? 'ยกเลิกคำขอ' : 'ปิดงานแล้ว')
                     : (st === 'Won' ? 'ปิดการขายได้' : 'ปิดงาน');
    out.ownerLabel = out.label;
    return out;
  }
  if (isSR && owner === 'SALES') { out.label = 'ร่างคำขอ — ยังไม่ได้ส่ง'; out.actionable = true; return out; }
  if (isSR && owner === 'SOURCING') out.label = (st === 'Accepted') ? 'Sourcing รับคำขอแล้ว · กำลังจัดทำราคา' : 'รอ Sourcing รับคำขอราคา';
  if (owner === 'MANAGEMENT') {
    // v5.1: อนุมัติ 2 ฝ่าย กดก่อนหลังได้ — บอกว่ายังรอฝ่ายไหน + ผ่านแล้วกี่ฝ่าย
    var ap = approvalStep_(f.approvalRoles), waitFor = ap.missing.length ? ap.missing : REQUIRED_APPROVAL_ROLES;
    out.label = 'รอ ' + waitFor.map(roleLabel_).join(' + ') + ' อนุมัติ (' + ap.approved.length + '/' + REQUIRED_APPROVAL_ROLES.length + ')';
    out.ownerLabel = out.label;
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
  if (out.slaDays > 0) out.due = addBizDays_(sinceMs, out.slaDays);
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
  if (rates && num_(rates[cur]) > 0) return num_(rates[cur]);
  var ex = num_(cell_(r, idx, 'Exrate'));                 // v4.6: เซลล์ที่เป็นข้อความ " 36.50" / "฿36.5" อ่านได้
  if (cur === 'USD' && ex > 0) return ex;
  return 0;
}
/** มูลค่าเป็นบาทของ "ราคาที่ Sales เห็นจริง" (total ใน SalesDetail) — ไม่ใช้คอลัมน์ Total กันตัวเลขสองแหล่งไม่ตรงกัน */
function salesValueTHB_(r, idx) {
  var m = /"total":(-?[0-9.]+)/.exec(String(cell_(r, idx, 'SalesDetail') || ''));
  var v = m ? num_(m[1]) : num_(cell_(r, idx, 'Total'));
  var rate = rowRateToTHB_(r, idx);
  return rate ? v * rate : null;
}
/** follow ของแถวเดียว (ใช้คืนค่าหลังบันทึก) */
function followForRow_(sh, idx, row) {
  var r = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
  return followActors_(followState_(followInfo_(r, idx), followCfg_(), Date.now()), peopleCtx_());
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
    Warranty:p.warranty||'', Duty:numOrBlank_(p.duty),
    Supplier:p.supplier||'', Lead:p.lead||'',
    DefaultPrice:numOrBlank_(p.defaultPrice),
    DefaultCur:p.defaultCur||'', BoiPrice:numOrBlank_(p.boiPrice),
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
  'companyInfo','releaseGatekeeperId','settingsRev','settingsUpdatedAt','groupTypes','dataEpoch'];
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
/**
 * อ่านตัวเลข/ยอดเงินแบบป้องกัน (v4.6 Phase 4) — ใช้แทน Number()/parseFloat ทุกจุดที่อ่านค่าจาก client หรือเซลล์ในชีท
 *   รับ: 1234.5 · "1,234.50" · " 1 234 " · "฿1,234" · "US$ 12" · "12 USD" · "(12)" = -12 · เซลล์ว่าง · ตัวเลขที่เก็บเป็นข้อความ
 *   อ่านไม่ได้ (ว่าง / ข้อความ / Date / NaN / Infinity) → คืน d (ไม่ส่ง = 0) ไม่เดาเด็ดขาด
 *   ลูกน้ำ/ช่องว่างต้องอยู่ตำแหน่งหลักพันจริง — "1,5" / "36,5" ถือว่าอ่านไม่ได้ (ไม่เดาว่าเป็น 15 หรือ 1.5)
 */
function num_(v, d) {
  var dv = (d === undefined) ? 0 : d;
  if (typeof v === 'number') return isFinite(v) ? v : dv;
  if (v === null || v === undefined || typeof v === 'boolean') return dv;
  if (Object.prototype.toString.call(v) === '[object Date]') return dv;
  var s = String(v).trim();
  if (!s) return dv;
  var neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/US\$|CN¥|THB|USD|CNY|บาท|[฿$¥]/gi, '').trim().replace(/[\s\u00a0\u202f']+/g, ',');
  // ลูกน้ำ/ช่องว่างต้องอยู่ตำแหน่งหลักพันจริง (1,234 / 1 234 567) — "1,5" / "36,5" อ่านไม่ได้ (ไม่เดาว่าเป็น 15 หรือ 1.5)
  if (s.indexOf(',') >= 0) { if (!/^[+-]?\d{1,3}(,\d{3})+(\.\d*)?$/.test(s)) return dv; s = s.replace(/,/g, ''); }
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(s)) return dv;
  var n = Number(s);
  if (!isFinite(n)) return dv;
  return neg ? -n : n;
}
/** ค่าว่าง/อ่านไม่ได้ → '' (ให้เซลล์ว่างเหมือนเดิม) */
function numOrBlank_(v) { var n = num_(v, null); return n === null ? '' : n; }
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

/** อ่านแท็บ MasterData ครั้งเดียวต่อ request → { lists:{ชื่อ:[ค่า…]}, defaults:{ชื่อ:ค่า}, labels, canAdd } */
function getMaster_() {
  var sh = sheet_(SH.MASTER);
  if (sh.getLastRow() < 2) seedMaster_(sh);
  var rows = masterRows_(sh), lists = {}, defaults = {}, labels = {}, add = {};
  for (var k in MASTER_LISTS) { lists[k] = []; labels[k] = MASTER_LISTS[k].label; add[k] = MASTER_LISTS[k].add; }
  var seen = {};
  rows.slice().sort(function (a, b) { return (a.sort - b.sort) || (a.i - b.i); }).forEach(function (r) {
    if (!lists[r.list] || !r.active || !r.value) return;
    var key = r.list + '|' + r.value.toLowerCase();
    if (seen[key]) return; seen[key] = 1;
    lists[r.list].push(r.value);
    if (r.isDefault && defaults[r.list] === undefined) defaults[r.list] = r.value;
  });
  lists.currency = MASTER_LISTS.currency.fixed.slice();          // สกุลเงินตายตัว (สูตร FX รองรับแค่ 3 สกุล)
  if (MASTER_LISTS.currency.fixed.indexOf(defaults.currency) < 0) defaults.currency = 'THB';
  for (var k2 in lists) if (defaults[k2] === undefined && lists[k2].length) defaults[k2] = lists[k2][0];
  return { lists:lists, defaults:defaults, labels:labels, canAdd:add };
}
function masterRows_(sh) {
  var last = sh.getLastRow(); if (last < 2) return [];
  var idx = headerIndex_(sh), data = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues(), out = [];
  for (var i = 0; i < data.length; i++) {
    var r = data[i], list = String(cell_(r, idx, 'List')).trim(), v = cell_(r, idx, 'Value');
    var val = (Object.prototype.toString.call(v) === '[object Date]') ? '' : String(v).trim();
    var def = MASTER_LISTS[list];
    if (def && def.numeric) { var n = num_(val, null); val = (n !== null && n > 0) ? String(n) : ''; }
    out.push({ i:i, row:i + 2, list:list, value:val,
               isDefault:String(cell_(r, idx, 'IsDefault')).toUpperCase() === 'TRUE',
               sort:num_(cell_(r, idx, 'Sort'), 9999),
               active:String(cell_(r, idx, 'Active')).toUpperCase() !== 'FALSE' });
  }
  return out;
}
/** สร้างแถวตั้งต้นครั้งแรก — รวมรายการเดิมจาก Settings (incoterms / priceTerms / units) ไม่ให้ของที่เคยเพิ่มไว้หาย */
function seedMaster_(sh) {
  var lock = LockService.getScriptLock(), mine = !lock.hasLock();   // POST ถือล็อกอยู่แล้ว → ห้ามปล่อยล็อกของ request หลัก
  if (mine && !lock.tryLock(5000)) return;
  try {
    if (sh.getLastRow() >= 2) return;
    var st = {}; try { st = getSettingsRaw_(); } catch (e) {}
    var idx = headerIndex_(sh), width = sh.getLastColumn(), out = [], stamp = nowISO_();
    for (var k in MASTER_SEED) {
      var vals = MASTER_SEED[k].slice(), sk = MASTER_SETTINGS_KEY[k];
      if (sk && Object.prototype.toString.call(st[sk]) === '[object Array]')
        st[sk].forEach(function (x) { x = String(x || '').trim(); if (x && vals.map(lc_).indexOf(lc_(x)) < 0) vals.push(x); });
      vals.forEach(function (v, n) {
        var row = new Array(width).fill('');
        row[idx['List'] - 1] = k; row[idx['Value'] - 1] = v; row[idx['IsDefault'] - 1] = n === 0 ? 'TRUE' : '';
        row[idx['Sort'] - 1] = (n + 1) * 10; row[idx['Active'] - 1] = 'TRUE';
        row[idx['Updated'] - 1] = stamp; row[idx['By'] - 1] = 'setup';
        out.push(row);
      });
    }
    if (out.length) sh.getRange(2, 1, out.length, width).setValues(out);   // เขียนครั้งเดียว ไม่เขียนในลูป
  } finally { if (mine) lock.releaseLock(); }
}
function lc_(x) { return String(x).toLowerCase(); }
/** ตรวจค่าที่ผู้ใช้พิมพ์เพิ่ม: ตัดช่องว่าง/อักขระควบคุม · ยาวไม่เกิน 60 · ห้ามขึ้นต้นด้วย = + - @ (กันสูตรในชีท) */
function cleanMasterValue_(list, v) {
  var s = String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (MASTER_LISTS[list] && MASTER_LISTS[list].numeric) {
    var n = num_(s, null);
    return (n !== null && n > 0 && n <= 365 && Math.floor(n) === n) ? String(n) : '';
  }
  if (!s || s.length > 60 || /^[=+\-@]/.test(s)) return '';
  return s;
}
/** ปุ่ม "อื่น ๆ (ระบุ)" — เพิ่มตัวเลือกใหม่เข้ารายการ (ซ้ำ = ใช้ของเดิม ไม่เพิ่มแถว) */
function addMaster_(p, sess) {
  var list = String(p.list || ''), def = MASTER_LISTS[list];
  if (!def || def.add === 'none') return { ok:false, error:'LIST_LOCKED' };
  if (def.add === 'internal' && !seesFullData_(sess)) return { ok:false, error:'ACCESS_DENIED', code:403 };
  var v = cleanMasterValue_(list, p.value);
  if (!v) return { ok:false, error:'BAD_VALUE' };
  var sh = sheet_(SH.MASTER);
  if (sh.getLastRow() < 2) seedMaster_(sh);
  var rows = masterRows_(sh).filter(function (r) { return r.list === list; });
  var same = rows.filter(function (r) { return lc_(r.value) === lc_(v); })[0];
  if (same) {
    if (!same.active) return { ok:false, error:'VALUE_HIDDEN', value:same.value };
    return { ok:true, value:same.value, existed:true, master:getMaster_() };
  }
  var maxSort = rows.reduce(function (m, r) { return Math.max(m, r.sort < 9999 ? r.sort : 0); }, 0);
  writeRow_(sh, headerIndex_(sh), null, { List:list, Value:v, IsDefault:'', Sort:maxSort + 10, Active:'TRUE', Updated:nowISO_(), By:sess.name });
  logRow_('addMaster', list, '', sess.name, v);
  return { ok:true, value:v, master:getMaster_() };
}
/** Admin: ตั้งค่าเริ่มต้น / ซ่อน / แสดง / เพิ่ม — แก้ทั้งแท็บในหน่วยความจำแล้วเขียนกลับครั้งเดียว */
function saveMaster_(p, sess) {
  var list = String(p.list || ''), op = String(p.op || ''), def = MASTER_LISTS[list];
  if (!def) return { ok:false, error:'BAD_LIST' };
  if (op === 'add') {
    if (def.add === 'none') return { ok:false, error:'LIST_LOCKED' };
    var r0 = addMaster_(p, sess);
    if (r0.ok || r0.error !== 'VALUE_HIDDEN') return r0;
    op = 'show'; p.value = r0.value;                              // เคยซ่อนไว้ → แสดงกลับ
  }
  if (['default', 'hide', 'show'].indexOf(op) < 0) return { ok:false, error:'BAD_OP' };
  if (op === 'hide' && list === 'currency') return { ok:false, error:'LIST_LOCKED' };
  var sh = sheet_(SH.MASTER), last = sh.getLastRow();
  if (last < 2) return { ok:false, error:'NOT_FOUND' };
  var idx = headerIndex_(sh), data = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  var target = lc_(String(p.value == null ? '' : p.value).trim()), hit = false;
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][idx['List'] - 1]).trim() !== list) continue;
    var isIt = lc_(String(data[i][idx['Value'] - 1]).trim()) === target;
    if (op === 'default') data[i][idx['IsDefault'] - 1] = isIt ? 'TRUE' : '';
    if (isIt) {
      hit = true;
      if (op === 'hide') { data[i][idx['Active'] - 1] = 'FALSE'; data[i][idx['IsDefault'] - 1] = ''; }
      if (op === 'show' || op === 'default') data[i][idx['Active'] - 1] = 'TRUE';
      data[i][idx['Updated'] - 1] = nowISO_(); data[i][idx['By'] - 1] = sess.name;
    }
  }
  if (!hit) return { ok:false, error:'NOT_FOUND' };
  sh.getRange(2, 1, data.length, data[0].length).setValues(data);
  logRow_('saveMaster', list, '', sess.name, op + ' ' + p.value);
  return { ok:true, master:getMaster_() };
}

/* ============================================================ DATA RESET (v5.1) — ล้างข้อมูล เหลือเฉพาะใบ Pending
 * รันจาก Editor (เจ้าของสคริปต์) ตามลำดับ — ไม่มีปุ่มบนเว็บ เพราะเป็นงานที่ย้อนไม่ได้ถ้าไม่มีไฟล์สำรอง
 *  1) exportPendingFile()
 *       สร้างไฟล์ Google Sheet "MGS_Pending_Upload_<วันเวลา>" ไว้โฟลเดอร์เดียวกับชีทหลัก (ไม่แตะข้อมูลในระบบ)
 *       แท็บ Quotations = header เดียวกับระบบทุกคอลัมน์ + เฉพาะใบเสนอราคาสถานะ Pending (ไม่รวมใบที่ถูกลบ)
 *                         + SR ต้นทางของใบเหล่านั้น (หลักฐานคำขอของลูกค้า — ห้ามแยกจากใบเสนอราคา)
 *       แท็บ "อ่านก่อน" = จำนวน + รายการ · ลบทั้งแถวที่ไม่ต้องการได้ ห้ามแก้ header / Id / Detail
 *  2) importUploadFile('<URL หรือ Id ของไฟล์>')                     → ตรวจไฟล์และรายงานว่าจะเกิดอะไร (ยังไม่แตะข้อมูล)
 *  3) importUploadFile('<URL หรือ Id ของไฟล์>', 'CLEAR_AND_IMPORT')  → ทำจริง:
 *       สำรองทั้งไฟล์ (backupSpreadsheet) → ล้างแท็บ Quotations → ใส่แถวจากไฟล์ (ค่าเดิมทุกคอลัมน์) → ล้างคิว NotifyQueue
 *       → ตั้ง Settings.dataEpoch ใหม่ (ทุกเครื่องล้างสำเนาในเครื่อง สำรองไว้ แล้วโหลดใหม่เองในรอบซิงค์ถัดไป)
 *  ไม่แตะ: Users · Products · MasterData · Sessions · Log · Settings อื่น ๆ · header ทุกแท็บเหมือนเดิม
 */
var RESET_CONFIRM = 'CLEAR_AND_IMPORT';
/** epoch ปัจจุบันของข้อมูล (ว่าง = ยังไม่เคยล้าง) */
function dataEpoch_() {
  var st = {}; try { st = getSettingsRaw_() || {}; } catch (e) {}
  return { epoch:String(st.dataEpoch || ''), at:String(st.dataEpochAt || ''), atMs:toMs_(st.dataEpochAt) || 0 };
}
/** แถวที่จะเก็บ: ใบเสนอราคา Status = Pending (ไม่ถูกลบ) + SR ต้นทางของใบเหล่านั้น — pure (ไม่มี I/O) */
function pendingKeep_(data, idx) {
  var keep = [], srNeed = {}, out = { rows:[], qt:0, sr:0, byStatus:{}, total:0 };
  data.forEach(function (r) {
    if (!cell_(r, idx, 'Id')) return;
    out.total++;
    var del = String(cell_(r, idx, 'Deleted')).toUpperCase() === 'TRUE', dt = String(cell_(r, idx, 'DocType') || 'QT'), st = String(cell_(r, idx, 'Status') || '');
    var k = (dt === 'SR' ? 'SR ' : 'QT ') + (st || '(ว่าง)') + (del ? ' (ลบแล้ว)' : '');
    out.byStatus[k] = (out.byStatus[k] || 0) + 1;
    if (del || dt === 'SR' || st !== 'Pending') return;
    keep.push(r);
    var sr = topStr_(String(cell_(r, idx, 'Detail') || ''), 'srId'); if (sr) srNeed[sr] = 1;
  });
  data.forEach(function (r) {
    if (String(cell_(r, idx, 'DocType')) === 'SR' && srNeed[String(cell_(r, idx, 'Id'))] && String(cell_(r, idx, 'Deleted')).toUpperCase() !== 'TRUE') { out.rows.push(r); out.sr++; }
  });
  keep.forEach(function (r) { out.rows.push(r); out.qt++; });
  return out;
}
function fileIdOf_(x) {
  var m = /\/d\/([A-Za-z0-9_-]{20,})/.exec(String(x || '')) || /^([A-Za-z0-9_-]{20,})$/.exec(String(x || '').trim());
  return m ? m[1] : '';
}
/** ขั้น 1: สร้างไฟล์สำหรับอัปโหลด (เฉพาะใบ Pending) — ไม่แตะข้อมูลในระบบ */
function exportPendingFile() {
  var sh = sheet_(SH.QUOTES), last = sh.getLastRow(), idx = headerIndex_(sh), width = sh.getLastColumn();
  var head = sh.getRange(1, 1, 1, width).getValues()[0];
  var data = last >= 2 ? sh.getRange(2, 1, last - 1, width).getValues() : [];
  var k = pendingKeep_(data, idx);
  var name = 'MGS_Pending_Upload_' + Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd_HHmm');
  var out = SpreadsheetApp.create(name);
  var q = out.getSheets()[0]; q.setName(SH.QUOTES);
  var rows = [head].concat(k.rows);
  q.getRange(1, 1, rows.length, width).setValues(rows);              // เขียนครั้งเดียว · ค่าเดิมทุกคอลัมน์ (Detail / SalesDetail ไม่ถูกแปลง)
  q.setFrozenRows(1);
  var info = out.insertSheet('อ่านก่อน');
  var lines = [['MGS Pricing — ไฟล์สำหรับอัปโหลด (เฉพาะใบ Pending)', ''],
    ['สร้างเมื่อ', nowISO_()], ['จากชีท', ss_().getName ? ss_().getName() : ''],
    ['ใบเสนอราคา Pending', k.qt], ['SR ต้นทางของใบเหล่านั้น', k.sr], ['แถวทั้งหมดในระบบตอนนี้', k.total], ['', ''],
    ['วิธีใช้', '1) ตรวจแท็บ Quotations — ลบทั้งแถวที่ไม่ต้องการได้ · ห้ามแก้ header / Id / Detail'],
    ['', '2) Apps Script → รัน importUploadFile(\'' + out.getUrl() + '\') เพื่อดูรายงาน (ยังไม่แตะข้อมูล)'],
    ['', '3) รัน importUploadFile(\'<URL เดิม>\', \'' + RESET_CONFIRM + '\') เพื่อล้างระบบแล้วใส่ข้อมูลชุดนี้ (สำรองให้อัตโนมัติก่อน)'],
    ['', ''], ['จำนวนในระบบตอนนี้แยกตามสถานะ', '']];
  Object.keys(k.byStatus).sort().forEach(function (s) { lines.push([s, k.byStatus[s]]); });
  info.getRange(1, 1, lines.length, 2).setValues(lines);
  try {                                                               // ย้ายไฟล์ไปไว้ข้างชีทหลัก (ไม่ได้ = อยู่ใน My Drive)
    var main = DriveApp.getFileById(ss_().getId()), folder = main.getParents().hasNext() ? main.getParents().next() : null;
    if (folder) DriveApp.getFileById(out.getId()).moveTo(folder);
  } catch (e) {}
  logRow_('export-pending', '', out.getId(), '-', k.qt + ' QT Pending + ' + k.sr + ' SR · ' + out.getUrl());
  var res = { ok:true, fileId:out.getId(), url:out.getUrl(), name:name, qt:k.qt, sr:k.sr, totalInSystem:k.total, byStatus:k.byStatus };
  Logger.log(JSON.stringify(res, null, 2));
  return res;
}
/** ตรวจไฟล์อัปโหลด → { ok, rows (เรียงตาม header ของระบบ), qt, sr, problems[] } — ไม่แตะข้อมูลในระบบ */
function readUploadFile_(fileIdOrUrl, sysHead) {
  var id = fileIdOf_(fileIdOrUrl), problems = [], res = { ok:false, rows:[], qt:0, sr:0, problems:problems, fileId:id };
  if (!id) { problems.push('ไม่ใช่ URL / Id ของ Google Sheet'); return res; }
  var f; try { f = SpreadsheetApp.openById(id); } catch (e) { problems.push('เปิดไฟล์ไม่ได้: ' + e); return res; }
  var sh = f.getSheetByName(SH.QUOTES);
  if (!sh || sh.getLastRow() < 1) { problems.push('ไม่พบแท็บชื่อ "' + SH.QUOTES + '" ในไฟล์'); return res; }
  var w = sh.getLastColumn(), head = sh.getRange(1, 1, 1, w).getValues()[0].map(function (h) { return String(h).trim(); });
  var col = {}; head.forEach(function (h, i) { if (h) col[h] = i; });
  var missing = HEADERS.Quotations.filter(function (h) { return col[h] === undefined; });
  if (missing.length) { problems.push('header ไม่ครบ (ขาด ' + missing.join(', ') + ') — ห้ามแก้แถวหัวตาราง'); return res; }
  var last = sh.getLastRow(), data = last >= 2 ? sh.getRange(2, 1, last - 1, w).getValues() : [];
  var ids = {}, srIds = {}, qtSr = [];
  data.forEach(function (r, i) {
    var id0 = String(r[col.Id] || '').trim(); if (!id0) return;     // แถวว่าง (ลบเนื้อหาออก) = ข้าม
    var n = 'แถว ' + (i + 2) + ' (' + (r[col.DocNo] || id0) + ')';
    if (ids[id0]) problems.push(n + ': Id ซ้ำ'); ids[id0] = 1;
    var dt = String(r[col.DocType] || 'QT'), st = String(r[col.Status] || '');
    if (String(r[col.Deleted]).toUpperCase() === 'TRUE') problems.push(n + ': เป็นใบที่ถูกลบแล้ว');
    var d = null; try { d = JSON.parse(String(r[col.Detail] || '')); } catch (e) { d = null; }
    if (!d || typeof d !== 'object') problems.push(n + ': คอลัมน์ Detail อ่านไม่ได้ (ห้ามแก้ Detail)');
    else if (String(d.id || id0) !== id0) problems.push(n + ': Id ไม่ตรงกับ Detail');
    if (dt === 'SR') { srIds[id0] = n; res.sr++; }
    else { if (st !== 'Pending') problems.push(n + ': สถานะ ' + (st || '(ว่าง)') + ' — ไฟล์นี้รับเฉพาะ Pending'); res.qt++; if (d && d.srId) qtSr.push(String(d.srId)); }
    res.rows.push(sysHead.map(function (h) { return col[h] === undefined ? '' : r[col[h]]; }));
  });
  Object.keys(srIds).forEach(function (sid) { if (qtSr.indexOf(sid) < 0) problems.push(srIds[sid] + ': SR นี้ไม่ได้เป็นต้นทางของใบ Pending ในไฟล์'); });
  if (!res.qt) problems.push('ไม่มีใบเสนอราคาในไฟล์เลย');
  res.ok = problems.length === 0;
  return res;
}
/**
 * ขั้น 2–3: ตรวจไฟล์ / ล้างระบบแล้วใส่ข้อมูลจากไฟล์
 * @param {string} fileIdOrUrl URL หรือ Id ของไฟล์จาก exportPendingFile()
 * @param {string=} confirm    'CLEAR_AND_IMPORT' = ทำจริง · ไม่ใส่ = รายงานอย่างเดียว (ไม่แตะข้อมูล)
 */
function importUploadFile(fileIdOrUrl, confirm) {
  var lock = LockService.getScriptLock(), mine = !lock.hasLock();
  if (mine && !lock.tryLock(30000)) return { ok:false, error:'busy — มีคนกำลังบันทึกอยู่ ลองใหม่อีกครั้ง' };
  try {
    var sh = sheet_(SH.QUOTES), width = sh.getLastColumn(), sysHead = sh.getRange(1, 1, 1, width).getValues()[0].map(String);
    var f = readUploadFile_(fileIdOrUrl, sysHead), before = Math.max(0, sh.getLastRow() - 1);
    var report = { ok:f.ok, dryRun:confirm !== RESET_CONFIRM, rowsInFile:f.rows.length, qt:f.qt, sr:f.sr, rowsInSystemNow:before,
                   willRemove:Math.max(0, before - f.rows.length), problems:f.problems };
    if (!f.ok || confirm !== RESET_CONFIRM) {
      report.next = f.ok ? 'ตรวจแล้วไม่มีปัญหา — รัน importUploadFile(\'' + fileIdOrUrl + '\', \'' + RESET_CONFIRM + '\') เพื่อทำจริง' : 'แก้ไฟล์ตามรายการ problems แล้วตรวจใหม่';
      Logger.log(JSON.stringify(report, null, 2));
      return report;
    }
    try { backupSpreadsheet(); report.backup = 'สำรองแล้ว (ไฟล์ BACKUP … ในโฟลเดอร์เดียวกับชีท)'; }
    catch (e) { report.ok = false; report.problems.push('สำรองข้อมูลไม่สำเร็จ — ยกเลิก ไม่ได้ล้างอะไร: ' + e); Logger.log(JSON.stringify(report, null, 2)); return report; }
    if (before > 0) sh.deleteRows(2, before);
    if (f.rows.length) sh.getRange(2, 1, f.rows.length, width).setValues(f.rows);   // เขียนครั้งเดียว
    var nq = sheet_(SH.NOTIFY), nqRows = nq.getLastRow() - 1;
    if (nqRows > 0) nq.deleteRows(2, nqRows);                                         // การแจ้งเตือนเก่าอ้างเอกสารที่ไม่มีแล้ว
    var st = getSettingsRaw_() || {}, stamp = nowISO_();
    st.dataEpoch = 'E' + Utilities.formatDate(new Date(), TZ, 'yyMMdd') + '-' + Date.now().toString(36);   // ไม่ซ้ำแม้ล้าง 2 ครั้งในวันเดียว
    st.dataEpochAt = stamp;
    var ssh = sheet_(SH.SETTINGS), sidx = headerIndex_(ssh), rev = 0;
    if (ssh.getLastRow() >= 2) rev = num_(ssh.getRange(2, sidx.SettingsRev).getValue(), 0);
    writeRow_(ssh, sidx, ssh.getLastRow() >= 2 ? 2 : null, { SettingsRev:rev + 1, SettingsUpdatedAt:stamp, By:'importUploadFile', Detail:safeDetail_(JSON.stringify(st)).text });
    logRow_('data-reset', '', fileIdOf_(fileIdOrUrl), '-', 'ล้าง ' + before + ' แถว → ใส่ ' + f.rows.length + ' แถว (' + f.qt + ' QT Pending + ' + f.sr + ' SR) · epoch ' + st.dataEpoch);
    report.done = true; report.dataEpoch = st.dataEpoch; report.removed = Math.max(0, before - f.rows.length);
    report.next = 'Deploy ไม่ต้องทำใหม่ · แจ้งทุกคนให้เปิดหน้าใหม่ (เครื่องที่เปิดค้างจะล้างสำเนาและโหลดใหม่เองในรอบซิงค์ถัดไป)';
    Logger.log(JSON.stringify(report, null, 2));
    return report;
  } finally { if (mine) lock.releaseLock(); }
}

function setup() {
  [SH.QUOTES, SH.PRODUCTS, SH.SETTINGS, SH.USERS, SH.LOG, SH.SESSIONS, SH.MASTER, SH.NOTIFY].forEach(function (n) { sheet_(n); });
  if (typeof larkValidateConfig_ === 'function') {          // v4.7: ตรวจการตั้งค่า Lark ตอนเริ่มระบบ (ไม่แสดง secret)
    try { var lc = larkValidateConfig_(); logRow_('lark-config', '', '', '-', 'mode ' + lc.mode + ' · ' + (lc.problems.concat(lc.warnings).join(' / ') || 'ok').slice(0, 400)); } catch (e) {}
  }
  try { getMaster_(); } catch (e) {}      // v4.6: สร้างตัวเลือกตั้งต้นในแท็บ MasterData (ครั้งแรกเท่านั้น)
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

/**
 * v4.8 (Phase 6) — ตรวจใบเสนอราคาที่ "น่าจะ" ถูกบั๊กเดิมของ production v2.1 ลดราคาไปแล้ว — อ่านอย่างเดียว ไม่แก้ข้อมูล
 * บั๊ก: ใบรุ่น %GP ที่ไม่มีธง _pm ถูกแปลง %GP เป็น markup ซ้ำทุกครั้งที่โหลดใหม่ (GP 18% → 15.254%) แล้วถูกบันทึกทับเมื่อมีคนกดบันทึก
 * วิธีเดา: %GP ในบรรทัดไม่ใช่เลขกลม (ไม่ลง 0.5) แต่ถ้าแปลงย้อนกลับ x/(100−x) แล้วได้เลขกลม → น่าจะเป็นค่าที่ถูกแปลงมา
 * รันจาก Editor → ดูผลใน Execution log · ให้ Sourcing/ผู้จัดการตรวจและแก้ %GP เองในหน้าใบเสนอราคา
 * @return {Array<{docNo:string,id:string,status:string,lines:Array}>}
 */
function auditPricingDrift() {
  var sh = sheet_(SH.QUOTES), last = sh.getLastRow(), out = [], atRisk = 0;
  if (last < 2) { Logger.log('ไม่มีใบเสนอราคา'); return out; }
  var idx = headerIndex_(sh), data = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  var round05 = function (v) { return Math.abs(v * 2 - Math.round(v * 2)) < 0.004; };
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    if (String(cell_(r, idx, 'DocType') || 'QT') === 'SR' || String(cell_(r, idx, 'Deleted')).toUpperCase() === 'TRUE') continue;
    var d; try { d = JSON.parse(String(cell_(r, idx, 'Detail') || '{}')); } catch (e) { continue; }
    if (d._sv === 3 && d._pm !== 2) { atRisk++; continue; }     // ยังไม่โดนแปลง — v4.8 อ่านถูกแล้ว ไม่ต้องทำอะไร
    if (d._pm !== 2) continue;
    var hits = (d.lines || []).map(function (L) {
      var x = Number(L.opPct); if (!isFinite(x) || x <= 0 || x >= 99 || round05(x)) return null;
      var m = x / (100 - x) * 100;                                // ค่าก่อนถูกแปลง (ถ้าใช่)
      return round05(m) ? { code:L.code || L.desc || '', gpNow:x, gpLikely:Math.round(m * 2) / 2 } : null;
    }).filter(function (h) { return h; });
    if (hits.length) out.push({ docNo:String(cell_(r, idx, 'DocNo') || ''), id:String(cell_(r, idx, 'Id')), status:String(cell_(r, idx, 'Status') || ''), lines:hits });
  }
  Logger.log('ใบที่ยังไม่ถูกแปลง (ปลอดภัยหลังอัปเดต v4.8): %s ใบ', atRisk);
  Logger.log('ใบที่น่าจะถูกลด %GP ไปแล้ว: %s ใบ', out.length);
  out.forEach(function (o) {
    Logger.log('%s (%s) — %s', o.docNo, o.status, o.lines.map(function (h) { return h.code + ': %GP ตอนนี้ ' + h.gpNow + '% (น่าจะตั้งใจ ' + h.gpLikely + '%)'; }).join(' · '));
  });
  return out;
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
