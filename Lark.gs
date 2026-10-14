/*************************************************************
 * MGS PROJECT PRICING — LARK NOTIFICATIONS  (v5.0 · กลุ่มเดียวทุกคน แบบ Food Price Request)
 * ไฟล์แยกในโปรเจกต์ Apps Script เดียวกับ Code.gs (ไฟล์ → + → Script → ตั้งชื่อ "Lark")
 *
 * แนวคิด (เหมือนระบบขอราคา Food — FPR)
 *   · กลุ่ม Lark กลุ่มเดียว มีทุกคน (Sales · Sourcing · Sourcing Manager · BD Manager · GM · NON)
 *   · การ์ดบอก "สถานะ" อย่างเดียว: เลขที่ / ลูกค้า / ผู้ขอ / สถานะ / ผู้ดำเนินการ / ครบกำหนด / ขั้นตอน / รายการสินค้า
 *     ไม่มีราคา ต้นทุน %GP มูลค่า หรือชื่อผู้ขาย ในการ์ดเลย (ทุกคนในกลุ่มเห็นได้) — ราคาดูบนเว็บตามสิทธิ์เท่านั้น
 *   · @แท็ก (mention) คนที่ต้องทำต่อ จากอีเมลในแท็บ Users  (<at email=…></at>)
 *   · ไม่มีแจ้งเตือนงาน follow-up ของ Sales และไม่มีสรุปประจำวัน
 *
 * บอท 2 ตัว (Custom Bot ในกลุ่ม — ส่งการ์ด interactive + ปุ่มลิงก์ได้)
 *   Bot A  "MGS Price Request"  ทุกขั้นตอนของคำขอราคา              LARK_BOT_URL      + LARK_BOT_SECRET
 *   Bot B  "MGS Reminder"       เฉพาะงานที่เกินกำหนด (วันละรอบ · v5.8)   LARK_REMINDER_URL + LARK_REMINDER_SECRET
 *          ไม่ตั้ง Bot B = ใช้ Bot A ส่งการ์ดเตือนแทน · Custom Bot รับการกดปุ่มกลับไม่ได้ → อนุมัติ/ปล่อยราคาบนเว็บเท่านั้น
 *
 * โครงสร้าง (สร้างข้อความ ↔ ส่ง แยกกัน)
 *   1) EVENT TABLE   LARK_EVENTS — ทุกขั้นตอนอยู่ในตารางเดียว: หัวการ์ด / สี / ใครถูกแท็ก / กันส่งซ้ำกี่นาที
 *   2) BUILD         larkBuild_()  — pure function: ข้อมูลเอกสาร → การ์ด (ไม่มี I/O)
 *   3) QUEUE         larkEnqueueMany_() — เขียนลงแท็บ NotifyQueue (ไม่ส่งทันที) · ตัดตัวซ้ำ · ห้าม throw
 *   4) SEND          larkFlush()   — trigger ทุก 5 นาที: ส่งทั้งชุดด้วย UrlFetchApp.fetchAll ครั้งเดียว
 *                                    ล้มเหลว → ลองใหม่ตามระยะ 1/5/15/60/180 นาที แล้วบันทึก FAILED
 *   5) REMINDER      larkSlaScan() — รายชั่วโมง (เวลาทำงาน จ.–ศ.): หนึ่งการ์ดต่องานที่เกินกำหนด วันละไม่เกิน 1 ครั้งต่อขั้นตอน
 *
 * โหมด (Script Properties → LARK_MODE)
 *   off    = ไม่ทำอะไรเลย
 *   dryrun = ค่าเริ่มต้น — สร้างการ์ดเก็บในแท็บ NotifyQueue (Status = DRYRUN) แต่ไม่ยิงออก
 *   live   = ส่งจริง (เปิดเมื่อตรวจการ์ดใน dry-run แล้วเท่านั้น)
 *
 * Script Properties (ห้ามใส่ในโค้ดหรือในชีท · Project Settings → Script properties)
 *   LARK_MODE                off | dryrun | live
 *   LARK_BOT_URL             https://open.larksuite.com/open-apis/bot/v2/hook/…   (Bot A)
 *   LARK_BOT_SECRET          Signature verification ของ Bot A (แนะนำให้เปิด)
 *   LARK_REMINDER_URL        (ทางเลือก) Bot B — ไม่ตั้ง = ใช้ Bot A
 *   LARK_REMINDER_SECRET
 *   LARK_MENTION_REQUESTER   on (ค่าเริ่มต้น) | off — แท็ก Sales ผู้ขอในช่อง "ผู้ขอ" ทุกการ์ด
 *   LARK_SEND_NOW            on (ค่าเริ่มต้น · v5.7) = ส่งทันทีตอนบันทึก | off = เข้าคิวรอ trigger ทุก 5 นาที
 *   LARK_REMIND_HOUR         8–16 (ค่าเริ่มต้น 9 · v5.8) — เวลารอบเตือนงานเกินกำหนด วันละครั้ง จ.–ศ.
 *   LARK_REMIND_DAY          (ระบบเขียนเอง) วันที่ของรอบเตือนล่าสุด yyyy-MM-dd — กันเตือนซ้ำในวันเดียวกัน
 *   APP_URL                  URL /exec ของ Web App (ไม่ตั้ง = ใช้ ScriptApp.getService().getUrl())
 *   ค่าของ v4.9 (LARK_WEBHOOK_*, LARK_APP_ID, LARK_CHAT_*) ไม่ใช้แล้ว — ยกเว้น LARK_WEBHOOK_REQUESTS ใช้แทน Bot A ได้ชั่วคราว
 *************************************************************/

var LARK_VERSION = '5.13';

/* ============================================================ 1) EVENT TABLE */
/**
 * bot      = A (ทุกขั้นตอน) | B (เตือนเกินกำหนด)
 * approval = v5.10: การ์ดขออนุมัติ → Bot C (กลุ่มผู้อนุมัติ: Procurement Mgr / BD Mgr / GM) พร้อมยอด · กำไร · คอมเรท · ค่าคอม
 *            ยังไม่ได้ตั้ง Bot C = ส่งเข้า Bot A แบบไม่มีตัวเลขเหมือนเดิม (ห้ามส่งตัวเลขเข้ากลุ่มที่มี Sales)
 * mention  = ใครถูกแท็กในช่อง "ผู้ดำเนินการ": 'actor' = คนที่ต้องทำต่อตามสถานะปัจจุบัน (row.follow.actor)
 *            'requester' = Sales เจ้าของคำขอ · 'pricer' = Sourcing ผู้ทำราคา/ผู้รับคำขอ
 * dedupMin = ไม่ส่ง event เดิมของเอกสารเดิม (รอบเดิม) ซ้ำภายในกี่นาที
 * color    = สีหัวการ์ด (template ของ Lark)
 */
var LARK_EVENTS = {
  SR_SUBMITTED:       { bot:'A', th:'คำขอราคาใหม่ → Sourcing',          icon:'📥', color:'blue',      mention:'actor',     dedupMin:24 * 60,
                        when:'Sales ส่งคำขอราคา (SR) — วิ่งถึง Sourcing ที่ดูแลกลุ่มสินค้านั้นทันที' },
  SR_FORWARDED:       { bot:'A', th:'ส่งต่อคำขอราคา',                    icon:'🔀', color:'wathet',    mention:'actor',     dedupMin:60,
                        when:'ทีมภายในส่งต่อคำขอให้ Sourcing คนอื่น' },
  SR_ACCEPTED:        { bot:'A', th:'Sourcing รับงานแล้ว · กำลังทำราคา',   icon:'🔧', color:'indigo',    mention:'actor',     dedupMin:24 * 60,
                        when:'Sourcing กดรับคำขอ' },
  SR_CANCELLED:       { bot:'A', th:'ยกเลิกคำขอราคา',                    icon:'🚫', color:'grey',      mention:'pricer',    dedupMin:24 * 60,
                        when:'คำขอถูกยกเลิก' },
  QT_SUBMITTED:       { bot:'A', approval:true, th:'ทำราคาเสร็จ · รออนุมัติ 2 ฝ่าย', icon:'📊', color:'orange', mention:'actor', dedupMin:120,
                        when:'Sourcing กด “บันทึก & ส่งขออนุมัติ”' },
  QT_PARTIAL_APPROVED:{ bot:'A', approval:true, th:'อนุมัติแล้ว 1 ฝ่าย · รออีกฝ่าย', icon:'🏁', color:'purple', mention:'actor', dedupMin:120,
                        when:'Sourcing Manager อนุมัติแล้ว รอ BD Manager (v5.9 ลำดับ Sourcing Manager → BD · หรือ GM อนุมัติแทน 1 ฝ่าย)' },
  QT_APPROVED:        { bot:'A', th:'อนุมัติครบ 2 ฝ่าย · รอปล่อยราคา',    icon:'✅', color:'green',     mention:'actor',     dedupMin:24 * 60,
                        when:'ฝ่ายที่สองอนุมัติ (หรือ GM อนุมัติแทนครบ)' },
  QT_RETURNED:        { bot:'A', th:'ตีกลับแก้ราคา',                     icon:'↩️', color:'red',       mention:'actor',     dedupMin:120,
                        when:'ผู้อนุมัติส่งกลับให้ Sourcing แก้ (ต้องขออนุมัติใหม่ทั้ง 2 ฝ่าย)' },
  PRICE_RELEASED:     { bot:'A', th:'ปล่อยราคาแล้ว · Sales ดูราคาบนเว็บ',  icon:'🎉', color:'green',     mention:'requester', dedupMin:24 * 60,
                        when:'NON (ผู้ปล่อยราคา) กดปล่อยราคาให้ Sales เจ้าของงาน' },
  SLA_REMINDER:       { bot:'B', th:'งานค้างเกินกำหนด',                   icon:'⏰', color:'yellow',    mention:'actor',     dedupMin:20 * 60,
                        when:'วันละครั้ง (จ.–ศ. ค่าเริ่มต้น 09:00 · ตั้งได้ที่หน้าตั้งค่า Lark Bot): งานที่เกินกำหนด (ไม่รวมงานติดตามลูกค้าของ Sales) — วันละครั้งต่องานต่อขั้นตอน' }
};
var LARK_BOTS = {
  A: { th:'MGS Price Request', url:'LARK_BOT_URL',      secret:'LARK_BOT_SECRET' },
  B: { th:'MGS Reminder',      url:'LARK_REMINDER_URL', secret:'LARK_REMINDER_SECRET', fallback:'A' },
  // v5.10: กลุ่มผู้อนุมัติ — การ์ดมีตัวเลขการเงิน จึง "ไม่มี fallback" (ยังไม่ตั้ง = การ์ดขออนุมัติไปกลุ่ม A แบบไม่มีตัวเลข)
  C: { th:'MGS Approval',      url:'LARK_APPROVAL_URL', secret:'LARK_APPROVAL_SECRET', money:true }
};
/** Target ในแท็บ NotifyQueue ↔ บอท */
var LARK_TARGET = { A:'BOT', B:'REMINDER', C:'APPROVAL' };
function larkBotOfTarget_(t) { return t === 'REMINDER' ? 'B' : t === 'APPROVAL' ? 'C' : 'A'; }
var LARK_HOOK_RE = /^https:\/\/open\.(larksuite\.com|feishu\.cn)\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9_-]{8,}$/;
var LARK_EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
var LARK_LEGACY_PROPS = ['LARK_APP_ID', 'LARK_APP_SECRET', 'LARK_CHAT_SOURCING', 'LARK_CHAT_APPROVERS', 'LARK_CHAT_RELEASE', 'LARK_CHAT_SALES',
  'LARK_CHAT_REQUESTS', 'LARK_WEBHOOK_URL', 'LARK_WEBHOOK_SOURCING', 'LARK_WEBHOOK_APPROVERS', 'LARK_WEBHOOK_RELEASE', 'LARK_WEBHOOK_SALES'];
var LARK_RETRY_MIN = [1, 5, 15, 60, 180];        // ระยะรอก่อนลองใหม่ (นาที) · ครบแล้วยังไม่ได้ = FAILED
var LARK_FLUSH_MAX = 30;                          // ส่งได้สูงสุดต่อรอบ (กัน quota / timeout)
var LARK_QUEUE_KEEP = 3000;                       // เก็บประวัติในแท็บ NotifyQueue ล่าสุดกี่แถว
var LARK_DEDUP_SCAN = 1500;                       // ตรวจซ้ำย้อนหลังกี่แถว
var LARK_REMIND_MAX = 30;                         // การ์ดเตือนสูงสุดต่อรอบ (วันละรอบ · เกินกำหนดนานสุดก่อน)
var LARK_REMIND_HOUR_DEFAULT = 9;                 // v5.8: รอบเตือนงานเกินกำหนด วันละครั้ง (ชั่วโมง เวลาไทย)
var LARK_WORK = { start:8 * 60 + 30, end:17 * 60 + 30 };   // เวลาทำงาน (นาทีของวัน เวลาไทย) — เตือนเฉพาะช่วงนี้ จ.–ศ.
var LARK_ITEMS_MAX = 8;                           // รายการสินค้าในการ์ดสูงสุด
var LARK_DESC_MAX = 60;                           // v5.10: ตัดชื่อสินค้าในตาราง (ชื่อเต็มดูบนเว็บ)

/* ============================================================ CONFIG */
function larkProps_() {
  var all = {};
  try { all = PropertiesService.getScriptProperties().getProperties() || {}; } catch (e) { all = {}; }
  return all;
}
function larkMode_(props) {
  var m = String((props || larkProps_()).LARK_MODE || 'dryrun').toLowerCase().trim();
  return (m === 'off' || m === 'live' || m === 'dryrun') ? m : 'dryrun';
}
function larkAppUrl_(props) {
  var u = String((props || {}).APP_URL || '').trim();
  if (!u) { try { u = ScriptApp.getService().getUrl() || ''; } catch (e) { u = ''; } }
  return u;
}
/** webhook ของบอท: A → LARK_BOT_URL (สำรอง: LARK_WEBHOOK_REQUESTS ของ v4.9) · B → LARK_REMINDER_URL (สำรอง: Bot A) */
function larkBotDest_(bot, props) {
  var b = LARK_BOTS[bot]; if (!b) return null;
  var url = String(props[b.url] || '').trim(), secret = String(props[b.secret] || '').trim(), via = bot;
  if (!url && bot === 'A' && props.LARK_WEBHOOK_REQUESTS) {
    url = String(props.LARK_WEBHOOK_REQUESTS).trim(); secret = String(props.LARK_WEBHOOK_REQUESTS_SECRET || '').trim(); via = 'LARK_WEBHOOK_REQUESTS';
  }
  if (!url && b.fallback) { var f = larkBotDest_(b.fallback, props); if (f) { f.via = bot + '→' + f.via; return f; } }
  return url ? { url:url, secret:secret, via:via } : null;
}
/** v5.7: ส่งทันทีตอนบันทึก (ค่าเริ่มต้น on) · off = เข้าคิวรอ trigger ทุก 5 นาทีเหมือนเดิม */
function larkSendNow_(props) { return String((props || larkProps_()).LARK_SEND_NOW || 'on').toLowerCase().trim() !== 'off'; }
function larkMentionRequester_(props) { return String((props || {}).LARK_MENTION_REQUESTER || 'on').toLowerCase().trim() !== 'off'; }
/**
 * ตรวจการตั้งค่า (setup / ?diag=1 / ก่อนส่งทุกรอบ) — ไม่คืนค่า secret / URL เต็ม
 * @return {{mode:string, ready:boolean, problems:string[], warnings:string[], targets:Object, appUrl:string, via:string}}
 */
function larkValidateConfig_(props) {
  props = props || larkProps_();
  var mode = larkMode_(props), problems = [], warnings = [], targets = {};
  var raw = String(props.LARK_MODE || '').toLowerCase().trim();
  if (raw && ['off', 'dryrun', 'live'].indexOf(raw) < 0) problems.push('LARK_MODE ต้องเป็น off / dryrun / live (ตอนนี้ใช้ dryrun แทน)');
  ['LARK_BOT_URL', 'LARK_REMINDER_URL', 'LARK_APPROVAL_URL', 'LARK_WEBHOOK_REQUESTS'].forEach(function (k) {
    var v = String(props[k] || '').trim();
    if (v && !LARK_HOOK_RE.test(v)) problems.push(k + ' ไม่ใช่รูปแบบ webhook ของ Lark (https://open.larksuite.com/open-apis/bot/v2/hook/…)');
  });
  ['LARK_BOT_SECRET', 'LARK_REMINDER_SECRET', 'LARK_APPROVAL_SECRET'].forEach(function (k) {
    var v = String(props[k] || '');
    if (v && (/\s/.test(v) || v.length > 200)) problems.push(k + ' ไม่ถูกต้อง (คัดลอกใหม่จาก Security settings ของบอท)');
  });
  for (var b in LARK_BOTS) {
    var d = larkBotDest_(b, props);
    targets[b] = d ? 'webhook …' + d.url.slice(-6) + (d.secret ? ' (มีลายเซ็น)' : ' (ไม่มีลายเซ็น)') + (d.via !== b ? ' ผ่าน ' + d.via : '') : '';
  }
  var a = larkBotDest_('A', props);
  if (!a) (mode === 'live' ? problems : warnings).push('ยังไม่ได้ตั้ง LARK_BOT_URL (Bot A ในกลุ่มคำขอราคา) — ส่งจริงไม่ได้');
  else {
    if (!a.secret) warnings.push('Bot A ไม่ได้เปิด Signature verification — แนะนำให้เปิดแล้วใส่ LARK_BOT_SECRET');
    if (a.via !== 'A') warnings.push('ใช้ LARK_WEBHOOK_REQUESTS (v4.9) แทน Bot A อยู่ — ตั้ง LARK_BOT_URL แล้วลบค่าเก่าได้');
    if (!props.LARK_REMINDER_URL) warnings.push('ยังไม่ได้ตั้ง Bot B (LARK_REMINDER_URL) — การ์ดเตือนเกินกำหนดจะส่งผ่าน Bot A');
    if (!props.LARK_APPROVAL_URL) warnings.push('ยังไม่ได้ตั้ง Bot C (LARK_APPROVAL_URL) — การ์ดขออนุมัติส่งเข้า Bot A แบบไม่มียอด / กำไร / ค่าคอม');
  }
  var legacy = LARK_LEGACY_PROPS.filter(function (k) { return String(props[k] || '').trim(); });
  if (legacy.length) warnings.push('ค่าของ v4.9 ไม่ใช้แล้ว (ลบได้): ' + legacy.join(', '));
  var appUrl = larkAppUrl_(props);
  if (!appUrl) warnings.push('ยังไม่รู้ URL ของ Web App — ปุ่ม “เปิดรายการ” ในการ์ดจะไม่มีลิงก์ (ตั้ง APP_URL)');
  return { mode:mode, ready:mode === 'live' && problems.length === 0 && !!a, problems:problems, warnings:warnings,
           targets:targets, appUrl:appUrl, via:a ? 'webhook' : 'none' };
}

/* ============================================================ 2) BUILD (pure — ไม่มี I/O) */
/** ข้อความจากผู้ใช้ → ปลอดภัยสำหรับ Lark: ตัด < > (กัน <at user_id="all">) · ตัด * _ ~ ` [ ] (กัน markdown) · อักขระควบคุม · ความยาว */
function larkSafe_(s, max) {
  return String(s == null ? '' : s).replace(/[<>*_~`\[\]]/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 120);
}
/** @mention จากอีเมล (เฉพาะอีเมลรูปแบบถูกต้อง) · ไม่มีอีเมล = ชื่อธรรมดา */
function larkMention_(u) {
  if (!u) return '';
  var em = String(u.email || '').trim().toLowerCase();
  if (em && LARK_EMAIL_RE.test(em)) return '<at email=' + em + '></at>';
  return larkSafe_(u.name || u.id || '', 60);
}
function larkLink_(appUrl, doc) {
  if (!appUrl) return '';
  var sep = appUrl.indexOf('?') >= 0 ? '&' : '?';
  return doc ? appUrl + sep + 'doc=' + encodeURIComponent(doc) : appUrl;   // ไม่ระบุแอป: ระบบเลือกหน้าให้ตามอีเมลผู้กด
}
/** แถบขั้นตอน: ✅ ผ่านแล้ว · 🔶 อยู่ตรงนี้ · ⚪ ยังไม่ถึง — ช่วงอนุมัติ 2 ฝ่ายแสดงรายฝ่าย (คั่นด้วย + เพราะกดก่อนหลังได้) */
function larkStepper_(step, approvedRoles) {
  var dots = flowDots_(step, approvedRoles); if (!dots.length) return '';
  var ic = { done:'✅', now:'🔶', todo:'⚪' };
  var t = function (i) { return ic[dots[i]] + ' ' + FLOW_STEPS[i]; };
  return [t(0), t(1), t(2) + ' + ' + t(3), t(4)].join('  ›  ');
}
function larkDateTH_(ymd) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
  return m ? m[3] + '/' + m[2] + '/' + m[1] : '';
}
function larkUserKey_(u) { return String(u && (u.email || u.name || u.id) || '').toLowerCase(); }
/** ตัวเลขมีคอมมา · dec = ทศนิยม · trim = ตัด .00 ทิ้ง (ใช้กับจำนวนสินค้า) */
function larkNum_(n, dec, trim) {
  var x = Number(n); if (n === null || n === undefined || n === '' || !isFinite(x)) return '-';
  var s = x.toFixed(dec == null ? 2 : dec);
  if (trim) s = s.replace(/\.?0+$/, '');
  var parts = s.split('.'); parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}
/** แถวตารางในการ์ด (column_set) — cells = [{w, md, right}] · head = แถวหัวตาราง (พื้นเทา) */
function larkRow_(cells, head) {
  return { tag:'column_set', flex_mode:'none', background_style:head ? 'grey' : 'default', horizontal_spacing:'small',
           columns:cells.map(function (c) { return { tag:'column', width:'weighted', weight:c.w, vertical_align:'top',
             elements:[{ tag:'markdown', content:head ? '**' + c.md + '**' : c.md, text_align:c.right ? 'right' : 'left' }] }; }) };
}
/** v5.10: รายการสินค้าเป็นตาราง (# · รหัส · รายการ · จำนวน) แทนบรรทัดยาวต่อกัน — items = [{code, desc, qty, uom}] (ข้อมูลเก่าที่เป็นข้อความก็ได้) */
function larkItemsTable_(items) {
  items = items || [];
  var list = items.slice(0, LARK_ITEMS_MAX), rest = items.length - list.length;
  if (!list.length) return [];
  var out = [{ tag:'markdown', content:'**สินค้า** (' + items.length + ' รายการ)' },
             larkRow_([{ w:1, md:'#' }, { w:3, md:'รหัส' }, { w:6, md:'รายการ' }, { w:2, md:'จำนวน', right:true }], true)];
  list.forEach(function (x, i) {
    var it = typeof x === 'string' ? { desc:x } : (x || {});
    var code = larkSafe_(it.code || '', 30), desc = larkSafe_(it.desc || '', 200);
    if (code && desc.toUpperCase().indexOf(code.toUpperCase()) === 0) desc = desc.slice(code.length).replace(/^[\s,·:-]+/, '');   // ชื่อที่ขึ้นต้นด้วยรหัสซ้ำ
    if (desc.length > LARK_DESC_MAX) desc = desc.slice(0, LARK_DESC_MAX - 1) + '…';
    var q = Number(it.qty), qty = isFinite(q) && q > 0 ? larkNum_(q, 2, true) + (it.uom ? ' ' + larkSafe_(it.uom, 12) : '') : '-';
    out.push(larkRow_([{ w:1, md:String(i + 1) }, { w:3, md:code || '-' }, { w:6, md:desc || '-' }, { w:2, md:qty, right:true }]));
  });
  if (rest > 0) out.push({ tag:'note', elements:[{ tag:'plain_text', content:'… และอีก ' + rest + ' รายการ — ดูทั้งหมดบนเว็บ' }] });
  return out;
}
/** v5.10: ตัวเลขการเงินของโครงการ — ใช้เฉพาะการ์ดของ Bot C (กลุ่มผู้อนุมัติ) เท่านั้น
 *  m = { cur, total, profit, gp, comAmt, comRate, byCat:[{cat, grade, rate, comAmt, total}], comDeal, supplierCom, supplierComPct, lowGp } */
function larkMoneyBlock_(m) {
  if (!m) return [];
  var cur = larkSafe_(m.cur || 'THB', 6), money = function (n) { return larkNum_(n, 2) + ' ' + cur; };
  var pct = function (n) { return larkNum_(n, 2) + '%'; };
  var field = function (label, value) { return { is_short:true, text:{ tag:'lark_md', content:'**' + label + '**\n' + value } }; };
  var hasCom = m.comAmt !== null && m.comAmt !== undefined && m.comAmt !== '';
  var fields = [field('มูลค่าทั้งโครงการ', money(m.total)),
                field(m.comDeal ? 'รายได้ (ค่าคอม Supplier)' : 'กำไรรวม', money(m.profit) + ' · ' + (m.comDeal ? pct(m.supplierComPct) : 'GP ' + pct(m.gp)) + (m.lowGp ? ' ⚠ ต่ำกว่าเกณฑ์' : ''))];
  if (m.comDeal) fields.push(field('ค่าคอม Sales', 'ไม่มี (ดีลค่าคอม Supplier · เกรด D)'));
  else if (hasCom) {
    fields.push(field('ค่าคอม Sales', money(m.comAmt) + ' · คอมเรทเฉลี่ย ' + pct(m.comRate)));
    fields.push(field('กำไรหลังหักค่าคอม', money(Number(m.profit) - Number(m.comAmt))));
  } else fields.push(field('ค่าคอม Sales', '— (ใบนี้บันทึกจากหน้าเว็บรุ่นเก่า · เปิดใบแล้วบันทึกอีกครั้งเพื่อคำนวณ)'));
  if (Number(m.custCom) > 0) fields.push(field('ค่าคอมให้ลูกค้า', money(m.custCom) + ' · ' + pct(m.custComPct) + ' (บวกในราคาขายแล้ว)'));   // v5.13
  if (Number(m.excise) > 0) fields.push(field('สรรพสามิต + มหาดไทย', money(m.excise) + ' (รวมในต้นทุน)'));
  var out = [{ tag:'hr' }, { tag:'markdown', content:'💰 **ตัวเลขสำหรับผู้อนุมัติ** (กลุ่มนี้เท่านั้น)' }, { tag:'div', fields:fields }];
  var cats = (m.byCat || []).filter(function (c) { return c && c.cat; });
  if (cats.length && !m.comDeal) {
    out.push(larkRow_([{ w:4, md:'กลุ่มสินค้า' }, { w:2, md:'เกรด' }, { w:2, md:'คอมเรท', right:true }, { w:4, md:'ค่าคอม', right:true }], true));
    cats.slice(0, 8).forEach(function (c) {
      out.push(larkRow_([{ w:4, md:larkSafe_(c.cat, 30) }, { w:2, md:larkSafe_(c.grade || '-', 4) }, { w:2, md:pct(c.rate), right:true }, { w:4, md:larkNum_(c.comAmt, 2), right:true }]));
    });
  }
  return out;
}
/**
 * สร้างการ์ดของ event หนึ่งรายการ (pure)
 * @param {string} event  คีย์ใน LARK_EVENTS
 * @param {Object} info   { id, docNo, title, customer, requester:{name,email}, actors:[{name,email}], actorLabel,
 *                          statusLabel, step, due, late, items:[string], priced, round, by, note }
 * @param {string} appUrl URL ของ Web App
 * @param {Object=} opt   { mentionRequester:boolean, money:boolean (v5.10: แสดงตัวเลขการเงิน — Bot C เท่านั้น) }
 * @return {{title:string, card:Object, text:string}}
 */
function larkBuild_(event, info, appUrl, opt) {
  var ev = LARK_EVENTS[event]; if (!ev) throw new Error('unknown event ' + event);
  info = info || {}; opt = opt || {};
  var tagReq = opt.mentionRequester !== false;
  var no = larkSafe_(info.docNo || '—', 40);
  var title = ev.icon + ' ' + ev.th + ' — ' + no;
  var field = function (label, value) { return { is_short:true, text:{ tag:'lark_md', content:'**' + label + '**\n' + value } }; };
  var req = info.requester || null, reqKey = larkUserKey_(req);
  var seen = {}, actors = (info.actors || []).filter(function (u) { var k = larkUserKey_(u); if (!k || seen[k]) return false; seen[k] = 1; return true; });
  // ผู้ขอถูกแท็กในช่อง "ผู้ขอ" แล้ว → ไม่แท็กซ้ำในช่อง "ผู้ดำเนินการ" (ยกเว้นผู้ขอเป็นคนเดียวที่ต้องทำต่อ)
  var doers = actors.filter(function (u) { return !(tagReq && reqKey && larkUserKey_(u) === reqKey); });
  var doerText = doers.map(larkMention_).filter(String).join(' ');
  if (!doerText && actors.length) doerText = 'ผู้ขอ (ช่องด้านซ้าย)';
  if (!doerText) doerText = larkSafe_(info.actorLabel || '-', 80) || '-';
  var reqText = req ? (tagReq ? larkMention_(req) : larkSafe_(req.name, 60)) : '-';
  var cust = larkSafe_(info.customer || '-', 80), proj = larkSafe_(info.title || '', 80);
  var fields = [field('เลขที่', no + (info.round > 1 ? ' · R' + info.round : '')),
                field('ลูกค้า', cust + (proj && proj !== cust ? ' · ' + proj : '')),
                field('ผู้ขอ', reqText || '-'), field('สถานะ', larkSafe_(info.statusLabel || '-', 80)),
                field('ผู้ดำเนินการ', doerText)];
  if (info.due) fields.push(field('ครบกำหนด', larkDateTH_(info.due) + (info.late ? ' · ⛔ ' + larkSafe_(info.late, 60) : '')));
  var elements = [{ tag:'div', fields:fields }];
  var stp = larkStepper_(info.step, info.approved);
  if (stp) elements.push({ tag:'div', text:{ tag:'lark_md', content:'**ขั้นตอน**\n' + stp } });
  elements = elements.concat(larkItemsTable_(info.items));                              // v5.10: ตารางแทนบรรทัดยาว
  // v5.10: ตัวเลขการเงินแสดงเฉพาะเมื่อผู้เรียกระบุ opt.money (การ์ดของ Bot C กลุ่มผู้อนุมัติ) — กลุ่มอื่นเห็นแค่ "มีราคาแล้ว"
  if (opt.money && info.money) elements = elements.concat(larkMoneyBlock_(info.money));
  else if (info.priced) elements.push({ tag:'div', text:{ tag:'lark_md', content:'💰 **มีราคาแล้ว** — ดูราคาบนเว็บ (เห็นเฉพาะผู้มีสิทธิ์ · Sales เห็นเมื่อปล่อยราคาแล้ว)' } });
  var notes = [info.note ? larkSafe_(info.note, 200) : '', info.by ? 'โดย ' + larkSafe_(info.by, 60) : ''].filter(String);
  if (notes.length) elements.push({ tag:'note', elements:notes.map(function (t) { return { tag:'plain_text', content:t }; }) });
  var url = larkLink_(appUrl, info.id);
  if (/^https:\/\//.test(url)) elements.push({ tag:'action', actions:[{ tag:'button', type:'primary', text:{ tag:'plain_text', content:'เปิดรายการ ' + no }, url:url }] });
  var card = { config:{ wide_screen_mode:true }, header:{ template:ev.color, title:{ tag:'plain_text', content:title.slice(0, 120) } }, elements:elements };
  return { title:title, card:card, text:larkCardText_(card) };
}
/** ข้อความทั้งหมดในการ์ด (เก็บในคิว — ตรวจย้อนหลังได้ว่ากลุ่มเห็นอะไร) */
function larkCardText_(card) {
  var out = [card.header.title.content];
  card.elements.forEach(function (e) {
    if (e.text) out.push(e.text.content);
    if (e.tag === 'markdown') out.push(e.content);
    (e.fields || []).forEach(function (f) { out.push(f.text.content); });
    (e.elements || []).forEach(function (n) { out.push(n.content); });
    (e.columns || []).forEach(function (c, i) { (c.elements || []).forEach(function (n) { out.push((i ? '· ' : '') + n.content); }); });   // แถวตาราง
    (e.actions || []).forEach(function (a) { if (a.url) out.push(a.url); });
  });
  return out.join(' | ').replace(/\*\*/g, '').replace(/\n/g, ' ');
}
/**
 * ข้อมูลของการ์ดจากแถวในชีท — ใช้คอลัมน์ทั่วไป + รายการสินค้า (รหัส/ชื่อ/จำนวน/หน่วย) เท่านั้น ไม่อ่านราคาใด ๆ
 * @param {Array} r  แถวในชีท Quotations   @param {Object} idx header index
 * @param {Object} people peopleCtx_()      @param {Object} follow followActors_(followState_()) ของแถวนี้
 */
function larkInfoFromRow_(r, idx, people, follow) {
  var d = {};
  try { d = JSON.parse(String(cell_(r, idx, 'Detail') || '{}')) || {}; } catch (e) { d = {}; }
  var docType = String(cell_(r, idx, 'DocType') || 'QT');
  var owner = String(cell_(r, idx, 'SalesUserId') || ''), reqU = people.byId[owner] || null;
  var items = (d.lines || []).map(function (L) {                                     // v5.10: เก็บเป็นช่อง (ตาราง) ไม่ต่อเป็นบรรทัดเดียว
    if (!L || !(L.code || L.desc)) return null;
    return { code:String(L.code || ''), desc:String(L.desc || ''), qty:L.qty, uom:String(L.uom || '') };
  }).filter(function (x) { return !!x; });
  var f = follow || {}, pricerId = String(cell_(r, idx, 'AssignedTo') || '') || String(d.routedTo || '');
  var pick = function (u) { return { name:u.name, email:u.email, id:u.id }; };
  return {
    id:String(cell_(r, idx, 'Id') || ''), docNo:String(cell_(r, idx, 'DocNo') || cell_(r, idx, 'Ref') || ''), docType:docType,
    title:String(cell_(r, idx, 'Title') || ''), customer:String(cell_(r, idx, 'Customer') || ''),
    requester:reqU ? pick(reqU) : { name:String(cell_(r, idx, 'Sales') || '-'), email:'', id:owner },
    actors:actorUsers_(f.actor, people).map(pick), actorLabel:(f.actor && f.actor.label) || '',
    pricer:people.byId[pricerId] ? [pick(people.byId[pricerId])] : [],
    statusLabel:f.label || String(cell_(r, idx, 'Status') || ''), step:f.step, due:f.due || '',
    owner:f.owner || '', level:f.level || 'ok', waitingDays:f.waitingDays, slaDays:f.slaDays,
    items:items, priced:docType !== 'SR' && f.step >= 2, round:num_(cell_(r, idx, 'Round'), 1), approved:f.approvedRoles || []
  };
}

/** v5.10: ตัวเลขการเงินของใบ (เฉพาะการ์ด Bot C กลุ่มผู้อนุมัติ) — หน้าเว็บคำนวณไว้ใน Detail.apprSummary ตอนบันทึก
 *  (สูตรค่าคอมอยู่ฝั่งหน้าเว็บ) · ใบที่บันทึกจากหน้าเว็บรุ่นเก่า = ใช้คอลัมน์ Total / Profit / GP และไม่มีค่าคอม */
function larkMoneyFromRow_(r, idx) {
  var d = {};
  try { d = JSON.parse(String(cell_(r, idx, 'Detail') || '{}')) || {}; } catch (e) { d = {}; }
  var s = (d.apprSummary && typeof d.apprSummary === 'object') ? d.apprSummary : null, H = d.header || {};
  var lowGp = String(cell_(r, idx, 'NeedsApproval') || '').toUpperCase() === 'TRUE';
  if (s) return { cur:s.cur || H.currency || 'THB', total:s.total, profit:s.profit, gp:s.gp, comAmt:s.comAmt, comRate:s.comRate, byCat:s.byCat || [],
                  comDeal:!!s.comDeal, supplierCom:s.supplierCom, supplierComPct:s.supplierComPct, lowGp:lowGp,
                  custCom:s.custCom, custComPct:s.custComPct, excise:s.excise };                           // v5.13
  return { cur:String(cell_(r, idx, 'Currency') || H.currency || 'THB'), total:num_(cell_(r, idx, 'Total'), 0), profit:num_(cell_(r, idx, 'Profit'), 0),
           gp:num_(cell_(r, idx, 'GP'), 0), comAmt:null, comRate:null, byCat:[], lowGp:lowGp };
}

/* ============================================================ 3) QUEUE + DEDUP */
/** คีย์กันส่งซ้ำ: event + เอกสาร + รอบ (+ ผู้รับ สำหรับการส่งต่อ · + ขั้นตอน/วัน สำหรับการเตือน) */
function larkDedupKey_(event, info, dayStr) {
  if (event === 'SLA_REMINDER') return event + '|' + (info.id || '') + '|S' + info.step + '|' + (info.owner || '') + '|' + dayStr;
  if (event === 'SR_FORWARDED') return event + '|' + (info.id || '') + '|' + ((info.actors && info.actors[0] && info.actors[0].id) || '');
  return event + '|' + (info.id || '') + '|R' + (info.round || 1);
}
/** คีย์ที่เข้าคิวไปแล้ว → เวลาล่าสุด (อ่านแท็บครั้งเดียว) */
function larkRecentKeys_(sh) {
  var last = sh.getLastRow(), map = {};
  if (last < 2) return map;
  var idx = headerIndex_(sh), from = Math.max(2, last - LARK_DEDUP_SCAN + 1);
  var data = sh.getRange(from, 1, last - from + 1, sh.getLastColumn()).getValues();
  for (var i = 0; i < data.length; i++) {
    var k = String(cell_(data[i], idx, 'DedupKey') || ''), st = String(cell_(data[i], idx, 'Status') || '');
    if (!k || st === 'SKIPPED') continue;
    var t = toMs_(cell_(data[i], idx, 'CreatedAt'));
    if (!map[k] || t > map[k]) map[k] = t;
  }
  return map;
}
/**
 * เข้าคิวหลายรายการในครั้งเดียว (อ่าน 1 ครั้ง + เขียน 1 ครั้ง) — ห้าม throw: ผิดพลาดแค่ไหนธุรกรรมหลักต้องผ่าน
 * @param {Array<{event:string, info:Object, key?:string}>} items
 * @return {{queued:number, deduped:number, skipped:number, mode:string, error?:string}}
 */
function larkEnqueueMany_(items) {
  var out = { queued:0, deduped:0, skipped:0, mode:'off' };
  try {
    var props = larkProps_(), mode = larkMode_(props); out.mode = mode;
    if (mode === 'off' || !items || !items.length) return out;
    var sh = sheet_(SH.NOTIFY), idx = headerIndex_(sh), width = sh.getLastColumn();
    var recent = larkRecentKeys_(sh), now = Date.now(), stamp = new Date(now).toISOString();
    var appUrl = larkAppUrl_(props), day = Utilities.formatDate(new Date(now), TZ, 'yyyy-MM-dd'), rows = [];
    var opt = { mentionRequester:larkMentionRequester_(props) };
    items.forEach(function (it) {
      var ev = LARK_EVENTS[it.event]; if (!ev) return;
      var info = it.info || {}, key = it.key || larkDedupKey_(it.event, info, day);   // การเตือนส่งคีย์ของวันที่ตรวจมาเอง
      if (recent[key] && now - recent[key] < ev.dedupMin * 60000) { out.deduped++; return; }
      recent[key] = now;
      // v5.10: การ์ดขออนุมัติ → Bot C (กลุ่มผู้อนุมัติ) พร้อมตัวเลข · ยังไม่ตั้ง Bot C → Bot A แบบไม่มีตัวเลข
      var bot = (ev.approval && larkBotDest_('C', props)) ? 'C' : ev.bot;
      var msg = larkBuild_(it.event, info, appUrl, Object.assign({}, opt, { money:bot === 'C' })), dest = larkBotDest_(bot, props);
      var r = new Array(width).fill('');
      var set = function (h, v) { if (idx[h]) r[idx[h] - 1] = v; };
      set('Id', Utilities.getUuid()); set('Event', it.event); set('DocId', info.id || '');
      set('DedupKey', key); set('Target', LARK_TARGET[bot]); set('Title', msg.title);
      set('Payload', JSON.stringify({ card:msg.card, text:msg.text }).slice(0, CELL_LIMIT));
      set('Status', 'PENDING'); set('Tries', 0); set('NextAt', stamp); set('CreatedAt', stamp);
      var missing = 'ยังไม่ได้ตั้ง ' + LARK_BOTS[bot].url;
      if (!dest && mode === 'live') { set('Status', 'SKIPPED'); set('LastError', missing); out.skipped++; }
      else { out.queued++; if (!dest) set('LastError', missing + ' (dry-run: ไม่กระทบ)'); }
      rows.push(r);
    });
    if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, width).setValues(rows);   // เขียนครั้งเดียว
  } catch (e) {
    out.error = String(e);
    try { logRow_('lark-enqueue-error', '', '', '-', String(e).slice(0, 300)); } catch (e2) {}
  }
  return out;
}
function larkEnqueue_(event, info) { return larkEnqueueMany_([{ event:event, info:info }]); }

/**
 * จุดเชื่อมจาก Code.gs: สถานะเอกสารเปลี่ยน → แปลงเป็น event (ถ้ามี) แล้วเข้าคิว
 * เรียกหลังเขียนแถวสำเร็จแล้วเท่านั้น · ไม่ throw · ไม่ส่ง HTTP ในธุรกรรมหลัก
 */
function larkOnStatus_(sh, idx, row, prevStatus, newStatus, sess, extra) {
  try {
    prevStatus = String(prevStatus || ''); newStatus = String(newStatus || '');
    var r = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
    var event = larkEventFor_(String(cell_(r, idx, 'DocType') || 'QT'), prevStatus, newStatus, extra && extra.event);
    if (!event) return null;
    if (larkMode_() === 'off') return { mode:'off', queued:0 };
    var people = peopleCtx_();
    var follow = followActors_(followState_(followInfo_(r, idx), followCfg_(), Date.now()), people);
    var info = larkInfoFromRow_(r, idx, people, follow), ev = LARK_EVENTS[event];
    info.by = sess ? sess.name : '';
    if (ev.approval) info.money = larkMoneyFromRow_(r, idx);       // v5.10: ใช้เฉพาะเมื่อการ์ดไป Bot C (larkBuild_ ตรวจ opt.money)
    if (ev.mention === 'requester') info.actors = [info.requester];
    if (ev.mention === 'pricer') info.actors = info.pricer;
    if (event === 'QT_RETURNED') info.note = 'ส่งกลับให้ Sourcing แก้ราคา — ต้องขออนุมัติใหม่ทั้ง 2 ฝ่าย';
    if (event === 'PRICE_RELEASED') info.note = 'Sales เจ้าของงานเปิดดูราคาได้แล้วบนเว็บ (ราคาไม่แสดงในกลุ่ม)';
    if (event === 'SR_FORWARDED') info.note = 'ส่งต่อให้ ' + ((info.actors[0] && info.actors[0].name) || 'ทีม Sourcing');
    var q = larkEnqueue_(event, info);
    // v5.7: โหมดส่งจริง = ส่งทันทีในคำขอเดียวกับการบันทึก (เดิมรอ trigger ทุก 5 นาที + Google หน่วงอีก = การ์ดมาช้ามาก)
    //       ไม่สำเร็จ = ค้างในคิวเป็น RETRY ให้ trigger ลองใหม่ตามเดิม · ห้ามทำให้การบันทึกใบล้ม
    if (q && q.queued && q.mode === 'live' && larkSendNow_()) { try { q.flush = larkFlush(); } catch (e) { try { logRow_('lark-send-now-error', '', '', '-', String(e).slice(0, 300)); } catch (e2) {} } }
    return q;
  } catch (e) {
    try { logRow_('lark-hook-error', '', '', '-', String(e).slice(0, 300)); } catch (e2) {}
    return null;
  }
}
/** กติกาเลือก event จากการเปลี่ยนสถานะ (pure — ทดสอบได้) */
function larkEventFor_(docType, prev, next, forced) {
  if (forced) return forced;
  if (prev === next) return null;
  var inApproval = function (s) { return s === 'Submitted' || s === 'Partial Approved'; };
  if (docType === 'SR') return next === 'Submitted' ? 'SR_SUBMITTED' : next === 'Accepted' ? 'SR_ACCEPTED' : next === 'Cancelled' ? 'SR_CANCELLED' : null;
  if (next === 'Submitted' && !inApproval(prev)) return 'QT_SUBMITTED';
  if (prev === 'Submitted' && next === 'Partial Approved') return 'QT_PARTIAL_APPROVED';
  if (next === 'Approved') return 'QT_APPROVED';
  if (inApproval(prev) && (next === 'In Progress' || next === 'Requested')) return 'QT_RETURNED';
  return null;
}

/* ============================================================ 4) SEND */
/** ลายเซ็น webhook ของ Lark: base64(HmacSHA256(key = timestamp + "\n" + secret, message = "")) */
function larkSign_(timestamp, secret) {
  return Utilities.base64Encode(Utilities.computeHmacSha256Signature('', timestamp + '\n' + secret));
}
/** การ์ดหนึ่งใบ → request ของ UrlFetchApp (ยังไม่ยิง) */
function larkHookRequest_(dest, card) {
  var body = { msg_type:'interactive', card:card };
  if (dest.secret) { var ts = String(Math.floor(Date.now() / 1000)); body.timestamp = ts; body.sign = larkSign_(ts, dest.secret); }
  return { url:dest.url, method:'post', muteHttpExceptions:true, contentType:'application/json; charset=utf-8', payload:JSON.stringify(body) };
}
function larkRequestFor_(item, props) {
  var p = JSON.parse(item.payload || '{}');
  var dest = larkBotDest_(larkBotOfTarget_(item.target), props);   // APPROVAL → Bot C เท่านั้น (ไม่มี fallback: การ์ดมีตัวเลข)
  return dest && p.card ? larkHookRequest_(dest, p.card) : null;
}
/* v5.7: Lark ปฏิเสธการ์ด "ทั้งใบ" ถ้ามี @อีเมลที่ไม่ใช่บัญชีในองค์กร Lark
 *   code 11246 · ErrCode 100290 · "There is an invalid user resource(at/person) in your card"
 *   → ส่งซ้ำทันทีแบบไม่แท็ก (แสดงชื่อแทน) ให้การ์ดถึงกลุ่มเสมอ แล้วบันทึกอีเมลที่อยู่ในการ์ดไว้ใน LastError (ในชีท ไม่ออกกลุ่ม) */
function larkBadMention_(j) {
  var m = String((j && (j.msg || j.StatusMessage)) || '');
  return /100290|invalid user resource/i.test(m);
}
function larkMentionEmails_(card) {
  var out = [], seen = {}, re = /<at email=([^>]*)><\/at>/g, s = JSON.stringify(card || {}), m;
  while ((m = re.exec(s))) { var e = String(m[1]).toLowerCase(); if (!seen[e]) { seen[e] = 1; out.push(e); } }
  return out;
}
/** การ์ดเดิมแต่เปลี่ยน <at email=…></at> เป็นชื่อธรรมดา (ชื่อจากแท็บ Users · ไม่มี = ส่วนหน้าของอีเมล) */
function larkStripMentions_(card, nameByEmail) {
  var s = JSON.stringify(card || {}).replace(/<at email=([^>]*)><\/at>/g, function (_, em) {
    var e = String(em).toLowerCase(); return larkSafe_((nameByEmail || {})[e] || e.split('@')[0], 60);
  });
  return JSON.parse(s);
}
function larkNameByEmail_() {
  var map = {};
  try { peopleCtx_().list.forEach(function (u) { if (u.email) map[String(u.email).toLowerCase()] = u.name; }); } catch (e) {}
  return map;
}
/** คำแนะนำจากข้อความ error ของ Lark (แบบเดียวกับระบบ Food) */
function larkHint_(j) {
  var m = String((j && (j.msg || j.StatusMessage)) || '');
  if (larkBadMention_(j)) return ' → มีอีเมลใน @แท็กที่ไม่ใช่บัญชี Lark ในองค์กร — ตรวจคอลัมน์ Email ในแท็บ Users (หน้าตั้งค่า Lark Bot → ตรวจอีเมลทีละคน)';
  if (/sign/i.test(m)) return ' → Secret ไม่ตรงกับบอท (หรือเวลาเครื่องคลาดเคลื่อน) — คัดลอก Secret ใหม่จาก Security settings';
  if (/keyword/i.test(m)) return ' → บอทตั้ง Custom keywords ไว้ — ปิด keywords ใช้ Signature verification อย่างเดียว';
  if (/\bip\b/i.test(m)) return ' → บอทจำกัด IP — ปิด IP whitelist';
  return '';
}
/**
 * ส่งรายการที่ถึงเวลาในคิว (trigger ทุก 5 นาที) — dryrun = ไม่ยิงออก แค่เปลี่ยนสถานะเป็น DRYRUN
 * ขั้นตอน: ล็อก → จองแถว (SENDING) → ปล่อยล็อก → fetchAll ครั้งเดียว → ล็อก → เขียนผลครั้งเดียว
 */
function larkFlush() {
  var props = larkProps_(), mode = larkMode_(props), result = { mode:mode, sent:0, dryrun:0, retry:0, failed:0, skipped:0 };
  if (mode === 'off') return result;
  var lock = LockService.getScriptLock(), mine = !lock.hasLock();   // ถือล็อกอยู่แล้ว (เรียกซ้อน) → ห้ามปล่อยล็อกของผู้เรียก
  if (mine && !lock.tryLock(20000)) return result;
  var sh, idx, picked = [];
  try {
    sh = sheet_(SH.NOTIFY); idx = headerIndex_(sh);
    var last = sh.getLastRow(); if (last < 2) return result;
    var data = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues(), now = Date.now();
    for (var i = 0; i < data.length && picked.length < LARK_FLUSH_MAX; i++) {
      var st = String(cell_(data[i], idx, 'Status'));
      var stale = st === 'SENDING' && now - toMs_(cell_(data[i], idx, 'NextAt')) > 10 * 60000;   // ค้างจากรอบที่ล้ม
      if ((st === 'PENDING' || st === 'RETRY' || stale) && toMs_(cell_(data[i], idx, 'NextAt')) <= now) {
        data[i][idx['Status'] - 1] = 'SENDING'; data[i][idx['NextAt'] - 1] = new Date(now).toISOString();
        picked.push({ i:i, id:String(cell_(data[i], idx, 'Id')), target:String(cell_(data[i], idx, 'Target')),
                      payload:String(cell_(data[i], idx, 'Payload')), tries:num_(cell_(data[i], idx, 'Tries')) });
      }
    }
    if (picked.length) sh.getRange(2, 1, data.length, data[0].length).setValues(data);
  } finally { if (mine) lock.releaseLock(); }
  if (!picked.length) return result;

  // ---- ส่ง (นอกล็อก) ----
  var outcome = picked.map(function () { return { status:'DRYRUN', err:'' }; });
  if (mode === 'live') {
    var check = larkValidateConfig_(props), reqs = [], map = [];
    if (check.problems.length) outcome = picked.map(function () { return { status:'RETRY', err:'ตั้งค่าไม่ครบ: ' + check.problems[0] }; });
    else {
      picked.forEach(function (it, k) {
        var rq = null; try { rq = larkRequestFor_(it, props); } catch (e) { rq = null; }
        if (rq) { reqs.push(rq); map.push(k); }
        else outcome[k] = { status:'SKIPPED', err:'ไม่มีปลายทาง (' + (it.target === 'REMINDER' ? 'LARK_REMINDER_URL / LARK_BOT_URL' : it.target === 'APPROVAL' ? 'LARK_APPROVAL_URL' : 'LARK_BOT_URL') + ')' };
      });
      var resps = [];
      try { resps = reqs.length ? UrlFetchApp.fetchAll(reqs) : []; }                // HTTP ครั้งเดียวทั้งชุด
      catch (e) { resps = []; map.forEach(function (k) { outcome[k] = { status:'RETRY', err:String(e).slice(0, 200) }; }); }
      var again = [];                                                              // v5.7: ถูกปฏิเสธเพราะ @แท็ก → ส่งซ้ำแบบไม่แท็ก
      resps.forEach(function (res, n) {
        var k = map[n], code = res.getResponseCode(), j = {};
        try { j = JSON.parse(res.getContentText()); } catch (e) {}
        var okLark = code === 200 && (j.code === 0 || j.StatusCode === 0);
        if (!okLark && larkBadMention_(j)) { again.push(k); return; }
        outcome[k] = okLark ? { status:'SENT', err:'' }
          : { status:'RETRY', err:('HTTP ' + code + ' code ' + (j.code != null ? j.code : j.StatusCode) + ' ' + (j.msg || j.StatusMessage || '') + larkHint_(j)).slice(0, 240) };
      });
      if (again.length) {
        var names = larkNameByEmail_(), reqs2 = [], map2 = [];
        again.forEach(function (k) {
          try {
            var p = JSON.parse(picked[k].payload || '{}'), dest = larkBotDest_(picked[k].target === 'REMINDER' ? 'B' : 'A', props);
            reqs2.push(larkHookRequest_(dest, larkStripMentions_(p.card, names)));
            map2.push({ k:k, emails:larkMentionEmails_(p.card) });
          } catch (e) { outcome[k] = { status:'RETRY', err:'ส่งแบบไม่แท็กไม่ได้: ' + String(e).slice(0, 150) }; }
        });
        var resps2 = [];
        try { resps2 = reqs2.length ? UrlFetchApp.fetchAll(reqs2) : []; }
        catch (e) { map2.forEach(function (x) { outcome[x.k] = { status:'RETRY', err:String(e).slice(0, 200) }; }); }
        resps2.forEach(function (res, n) {
          var x = map2[n], code = res.getResponseCode(), j = {};
          try { j = JSON.parse(res.getContentText()); } catch (e) {}
          var ok2 = code === 200 && (j.code === 0 || j.StatusCode === 0);
          outcome[x.k] = ok2 ? { status:'SENT', err:('ส่งแล้วแบบไม่แท็ก — มีอีเมลที่ไม่ใช่บัญชี Lark อยู่ในนี้: ' + x.emails.join(', ')).slice(0, 240) }
            : { status:'RETRY', err:('HTTP ' + code + ' code ' + (j.code != null ? j.code : j.StatusCode) + ' ' + (j.msg || j.StatusMessage || '') + larkHint_(j)).slice(0, 240) };
        });
      }
    }
  }
  // ---- เขียนผล (ใต้ล็อก ครั้งเดียว) ----
  if (mine && !lock.tryLock(20000)) return result;
  try {
    var last2 = sh.getLastRow(), data2 = sh.getRange(2, 1, last2 - 1, sh.getLastColumn()).getValues(), now2 = Date.now(), byId = {};
    for (var r = 0; r < data2.length; r++) byId[String(cell_(data2[r], idx, 'Id'))] = r;
    picked.forEach(function (it, k) {
      var r = byId[it.id]; if (r === undefined) return;
      var o = outcome[k], set = function (h, v) { data2[r][idx[h] - 1] = v; };
      if (o.status === 'RETRY') {
        var tries = it.tries + 1;
        set('Tries', tries); set('LastError', o.err);
        if (tries >= LARK_RETRY_MIN.length) { set('Status', 'FAILED'); result.failed++; logRow_('lark-failed', '', it.id, '-', o.err); }
        else { set('Status', 'RETRY'); set('NextAt', new Date(now2 + LARK_RETRY_MIN[tries - 1] * 60000).toISOString()); result.retry++; }
      } else {
        set('Status', o.status); set('SentAt', new Date(now2).toISOString()); set('LastError', o.err);
        result[o.status === 'SENT' ? 'sent' : o.status === 'DRYRUN' ? 'dryrun' : 'skipped']++;
      }
    });
    sh.getRange(2, 1, data2.length, data2[0].length).setValues(data2);
    if (last2 - 1 > LARK_QUEUE_KEEP) sh.deleteRows(2, last2 - 1 - LARK_QUEUE_KEEP);   // เก็บประวัติล่าสุดพอ
  } finally { if (mine) lock.releaseLock(); }
  return result;
}

/* ============================================================ 5) REMINDER (Bot B) */
/** ตอนนี้อยู่ในเวลาทำงานไหม (จ.–ศ. 08:30–17:30 เวลาไทย) */
function larkWorkingTime_(ms) {
  var d = new Date(ms + 7 * 3600000), wd = d.getUTCDay(), min = d.getUTCHours() * 60 + d.getUTCMinutes();
  return wd !== 0 && wd !== 6 && min >= LARK_WORK.start && min < LARK_WORK.end;
}
/** trigger ไม่ได้ถือ ScriptLock → ต้องล็อกก่อนเขียนคิว (กันชนแถวกับการบันทึกของผู้ใช้ที่เข้าคิวพร้อมกัน) */
function larkWithLock_(fn) {
  var lock = LockService.getScriptLock(), mine = !lock.hasLock();
  if (mine && !lock.tryLock(25000)) return { busy:true };
  try { return fn(); } finally { if (mine) lock.releaseLock(); }
}
/** งานที่ Bot B เตือน: เกินกำหนดและไม่ใช่งานติดตามลูกค้าของ Sales (SALES) / งานปิดแล้ว (DONE)
 *  v5.2: ไม่เตือนงานซ่อมข้อมูลรุ่นเก่า (REPAIR) ในกลุ่ม — แก้ได้ทีเดียวด้วยปุ่มในระบบ ไม่ใช่งานของคนในกลุ่ม */
var LARK_REMIND_OWNERS = ['SOURCING', 'MANAGEMENT', 'RELEASER'];
/** v5.8: เวลารอบเตือน (8–16 · ค่าเริ่มต้น 9) */
function larkRemindHour_(props) {
  var h = parseInt(String((props || larkProps_()).LARK_REMIND_HOUR || ''), 10);
  return (h >= 8 && h <= 16) ? h : LARK_REMIND_HOUR_DEFAULT;
}
/** v5.8 วันละรอบ: trigger ยังเรียกทุกชั่วโมง (trigger เดิมใช้ต่อได้ ไม่ต้องติดตั้งใหม่) แต่ทำงานจริงแค่รอบแรกตั้งแต่เวลาที่ตั้งไว้ของวันทำการ
 *  แล้วจดวันไว้ใน LARK_REMIND_DAY — ชั่วโมงอื่น ๆ ของวันนั้นออกทันทีโดยไม่อ่านชีท · งานที่เพิ่งเกินกำหนดระหว่างวัน = เตือนรอบเช้าวันทำการถัดไป
 *  opts.nowMs / opts.force ใช้ในเทสต์และปุ่มทดสอบ (force = ไม่ดูเวลา/วัน) · trigger ส่ง event object มา = ใช้เวลาจริง */
function larkSlaScan(opts) { return larkWithLock_(function () { return larkSlaScan_(opts); }); }
function larkSlaScan_(opts) {
  var props = larkProps_(); if (larkMode_(props) === 'off') return { mode:'off' };
  var now = (opts && typeof opts.nowMs === 'number') ? opts.nowMs : Date.now(), force = !!(opts && opts.force === true);
  if (!force && !larkWorkingTime_(now)) return { skipped:'outside-working-hours' };
  var today = Utilities.formatDate(new Date(now), TZ, 'yyyy-MM-dd');
  if (!force) {
    var hourTH = new Date(now + 7 * 3600000).getUTCHours();
    if (hourTH < larkRemindHour_(props)) return { skipped:'before-remind-hour', hour:larkRemindHour_(props) };
    if (String(props.LARK_REMIND_DAY || '') === today) return { skipped:'already-today' };
  }
  try { PropertiesService.getScriptProperties().setProperty('LARK_REMIND_DAY', today); } catch (e) {}   // จดก่อนส่ง: ล้มกลางทางก็ไม่ส่งซ้ำทั้งวัน
  var sh = sheet_(SH.QUOTES), last = sh.getLastRow(); if (last < 2) return { reminded:0, overdue:0 };
  var idx = headerIndex_(sh), data = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  var cfg = followCfg_(), people = peopleCtx_(), cand = [];
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    if (!cell_(r, idx, 'Id') || String(cell_(r, idx, 'Deleted')).toUpperCase() === 'TRUE') continue;
    var f = followState_(followInfo_(r, idx), cfg, now);
    if (f.level !== 'over' || LARK_REMIND_OWNERS.indexOf(f.owner) < 0) continue;
    cand.push({ r:r, f:f });
  }
  cand.sort(function (a, b) { return (b.f.waitingDays - b.f.slaDays) - (a.f.waitingDays - a.f.slaDays); });
  var day = Utilities.formatDate(new Date(now), TZ, 'yyyy-MM-dd');
  var recent = larkRecentKeys_(sheet_(SH.NOTIFY)), items = [];
  for (var k = 0; k < cand.length && items.length < LARK_REMIND_MAX; k++) {
    var c = cand[k], info = larkInfoFromRow_(c.r, idx, people, followActors_(c.f, people));
    var key = larkDedupKey_('SLA_REMINDER', info, day);
    if (recent[key]) continue;                                          // เตือนขั้นนี้ของงานนี้ไปแล้ววันนี้
    info.late = 'เกินกำหนด ' + (c.f.waitingDays - c.f.slaDays) + ' วันทำการ';
    info.note = 'ค้างที่ขั้น “' + (c.f.owner === 'MANAGEMENT' ? 'อนุมัติ 2 ฝ่าย' : (FLOW_STEPS[c.f.step] || c.f.label)) + '” มาแล้ว ' + c.f.waitingDays + ' วันทำการ (กำหนด ' + c.f.slaDays + ' วัน)';
    items.push({ event:'SLA_REMINDER', info:info, key:key });
  }
  var res = larkEnqueueMany_(items);
  res.overdue = cand.length; res.reminded = items.length;
  if (res.queued && res.mode === 'live' && larkSendNow_()) { try { res.flush = larkFlush(); } catch (e) {} }   // v5.7: ส่งการ์ดเตือนทันที ไม่รอรอบ 5 นาที
  return res;
}
/** v4.9 เคยมีสรุปประจำวัน — v5.0 ยกเลิก (ไม่มีแจ้งเตือน follow-up) · คงชื่อไว้ให้ trigger เก่าไม่ error จนกว่าจะรัน larkInstallTriggers() ใหม่ */
function larkDailyDigest() { return { disabled:true, reason:'v5.0 ไม่มีสรุปงานค้างประจำวัน — รัน larkInstallTriggers() เพื่อลบ trigger นี้' }; }

/* ============================================================ ADMIN TOOLS (รันจาก Editor) */
/** ติดตั้ง trigger: ส่งคิวทุก 5 นาที · เตือนเกินกำหนดทุกชั่วโมง (รันซ้ำได้ ไม่ซ้อน · ลบ trigger สรุปประจำวันของ v4.9) */
function larkInstallTriggers() {   // v5.8: larkSlaScan ยังรันทุกชั่วโมง แต่เตือนจริงวันละรอบ (larkSlaScan_ ตัดสินเอง)
  var names = ['larkFlush', 'larkSlaScan', 'larkDailyDigest'];
  ScriptApp.getProjectTriggers().forEach(function (t) { if (names.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('larkFlush').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('larkSlaScan').timeBased().everyHours(1).create();
  Logger.log('ติดตั้ง trigger แล้ว (larkFlush ทุก 5 นาที · เตือนงานเกินกำหนดวันละครั้ง %s:00 น.) · โหมดตอนนี้ = %s (dryrun = ไม่ส่งจริง)', larkRemindHour_(), larkMode_());
}
/** ตรวจการตั้งค่า Lark (ไม่แสดง secret) + ผู้ใช้ที่ยังไม่มีอีเมล (แท็กไม่ได้) */
function larkCheckConfig() {
  var c = larkValidateConfig_();
  try {
    var noEmail = peopleCtx_().list.filter(function (u) { return u.active && !LARK_EMAIL_RE.test(u.email || ''); }).map(function (u) { return u.name; });
    if (noEmail.length) c.warnings.push('ผู้ใช้ที่ยังไม่มีอีเมลในแท็บ Users (@แท็กไม่ได้ จะแสดงเป็นชื่อธรรมดา): ' + noEmail.join(', '));
  } catch (e) {}
  Logger.log(JSON.stringify(c, null, 2));
  return c;
}
/** ข้อมูลตัวอย่างของการ์ด (ใช้ทั้ง demo และการทดสอบส่ง) */
function larkSampleInfo_(me) {
  var u = me || { name:'ผู้ทดสอบ', email:'' };
  return {
    sr: { id:'SR-DEMO', docNo:'SR-2610-003', title:'Factory Rooftop 500 kW', customer:'CP Group', requester:{ name:'BOSS', email:u.email },
          actors:[{ name:'Napasorn', email:u.email }], statusLabel:'รอ Sourcing รับคำขอราคา', step:1, due:'2026-10-14',
          items:[{ code:'MOUNTING-RAIL', desc:'Aluminium rail 4.2 m', qty:320, uom:'pcs' }, { code:'MID-CLAMP', desc:'Mid clamp 35mm', qty:640, uom:'pcs' }], priced:false, by:'BOSS' },
    qt: { id:'Q-DEMO', docNo:'QT-IN-2610-007', title:'Thaibev Solar Rooftop 1MW', customer:'Thai Beverage PCL', requester:{ name:'BOSS', email:u.email },
          actors:[{ name:u.name, email:u.email }], statusLabel:'รอ Sourcing Manager + BD Manager อนุมัติ (0/2)', step:2, approved:[], due:'2026-10-13',
          items:[{ code:'SG110CX-P2', desc:'Inverter 110 kW', qty:9, uom:'pcs' }, { code:'Logger3000', desc:'Data logger', qty:1, uom:'pcs' }], priced:true, round:2, by:'Chatraporn',
          money:{ cur:'THB', total:2430000, profit:388800, gp:16, comAmt:24300, comRate:1, byCat:[{ cat:'Inverter', grade:'B', rate:1, comAmt:24300, total:2430000 }] } }
  };
}
/**
 * ทดสอบแบบไม่ส่งจริง: สร้างการ์ดของทุก event จากข้อมูลตัวอย่าง แล้วพิมพ์ payload ที่จะส่ง (Logger)
 * ไม่เขียนชีท ไม่เรียก HTTP — รันได้ปลอดภัยทุกเวลา
 */
function larkDryRunDemo() {
  var appUrl = larkAppUrl_(larkProps_()) || 'https://script.google.com/macros/s/APP/exec', out = [];
  var s = larkSampleInfo_({ name:'Procure', email:'sourcing.manager@example.com' });
  var demo = [
    ['SR_SUBMITTED', s.sr], ['SR_FORWARDED', Object.assign({}, s.sr, { note:'ส่งต่อให้ Napasorn' })], ['SR_ACCEPTED', s.sr],
    ['SR_CANCELLED', Object.assign({}, s.sr, { step:-1, statusLabel:'ยกเลิกคำขอ', due:'' })],
    ['QT_SUBMITTED', s.qt], ['QT_PARTIAL_APPROVED', Object.assign({}, s.qt, { step:3, approved:['BD Mgr'], statusLabel:'รอ Sourcing Manager อนุมัติ (1/2)' })],
    ['QT_APPROVED', Object.assign({}, s.qt, { step:4, statusLabel:'รอปล่อยราคา' })],
    ['QT_RETURNED', Object.assign({}, s.qt, { step:1, priced:false, statusLabel:'รอ Sourcing จัดทำราคา', note:'ส่งกลับให้ Sourcing แก้ราคา — ต้องขออนุมัติใหม่ทั้ง 2 ฝ่าย' })],
    ['PRICE_RELEASED', Object.assign({}, s.qt, { step:5, statusLabel:'พร้อมเสนอลูกค้า', due:'', note:'Sales เจ้าของงานเปิดดูราคาได้แล้วบนเว็บ (ราคาไม่แสดงในกลุ่ม)' })],
    ['SLA_REMINDER', Object.assign({}, s.qt, { late:'เกินกำหนด 2 วันทำการ', note:'ค้างที่ขั้น “อนุมัติ 2 ฝ่าย” มาแล้ว 4 วันทำการ (กำหนด 2 วัน)' })]
  ];
  demo.forEach(function (d) {
    var m = larkBuild_(d[0], d[1], appUrl), ev = LARK_EVENTS[d[0]];
    out.push({ event:d[0], bot:ev.bot === 'B' ? 'Bot B ' + LARK_BOTS.B.th : 'Bot A ' + LARK_BOTS.A.th, title:m.title,
               webhookBody:{ msg_type:'interactive', card:'(ดู card ด้านล่าง)', timestamp:'<unix seconds>', sign:'<base64 HmacSHA256(timestamp + "\\n" + secret)>' },
               card:m.card, text:m.text });
  });
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}
/**
 * ส่งการ์ดทดสอบจริงเข้ากลุ่ม (Bot A 2 ใบ + Bot B 1 ใบ) โดยแท็กอีเมลของผู้รัน — ส่งทันทีไม่สนโหมด (ตั้งใจทดสอบ)
 * ถ้าชื่อคุณในช่อง “ผู้ดำเนินการ” เป็นสีฟ้า = @แท็กทำงาน (อีเมลบัญชี Lark ตรงกับอีเมลในแท็บ Users)
 */
function larkTestSend() {
  var props = larkProps_(), me = '';
  try { me = String(Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || '').toLowerCase(); } catch (e) {}
  var s = larkSampleInfo_({ name:me || 'ผู้ทดสอบ', email:me }), appUrl = larkAppUrl_(props), reqs = [], names = [];
  var add = function (ev, info) {
    var dest = larkBotDest_(LARK_EVENTS[ev].bot, props);
    if (!dest) { names.push({ ev:ev, miss:true }); return; }
    var card = larkBuild_(ev, Object.assign({}, info, { docNo:'TEST-' + info.docNo }), appUrl).card;
    card.header.title.content = '[ทดสอบ] ' + card.header.title.content;
    reqs.push(larkHookRequest_(dest, card)); names.push({ ev:ev });
  };
  add('SR_SUBMITTED', s.sr); add('QT_SUBMITTED', s.qt); add('SLA_REMINDER', Object.assign({}, s.qt, { late:'เกินกำหนด 1 วันทำการ' }));
  var res = reqs.length ? UrlFetchApp.fetchAll(reqs) : [], out = [], k = 0;
  names.forEach(function (n) {
    if (n.miss) { out.push(n.ev + ': ไม่มีปลายทาง (ตั้ง LARK_BOT_URL)'); return; }
    var x = res[k++], j = {}; try { j = JSON.parse(x.getContentText()); } catch (e) {}
    out.push(n.ev + ': ' + (x.getResponseCode() === 200 && (j.code === 0 || j.StatusCode === 0) ? 'ส่งสำเร็จ'
      : 'ไม่สำเร็จ HTTP ' + x.getResponseCode() + ' ' + (j.msg || j.StatusMessage || '') + larkHint_(j)));
  });
  Logger.log(out.join('\n'));
  return out;
}
/** ดูคิวล่าสุด (สถานะ/ข้อผิดพลาด) */
function larkQueueReport(n) {
  var sh = sheet_(SH.NOTIFY), last = sh.getLastRow(); if (last < 2) { Logger.log('คิวว่าง'); return []; }
  var idx = headerIndex_(sh), from = Math.max(2, last - (n || 20) + 1);
  var rows = sh.getRange(from, 1, last - from + 1, sh.getLastColumn()).getValues().map(function (r) {
    return [cell_(r, idx, 'CreatedAt'), cell_(r, idx, 'Event'), cell_(r, idx, 'Target'), cell_(r, idx, 'Status'), cell_(r, idx, 'Title'), cell_(r, idx, 'LastError')].join(' | ');
  });
  Logger.log(rows.join('\n'));
  return rows;
}

/* ============================================================ 6) หน้าตั้งค่า Lark Bot ในเว็บ (v5.6)
 * ให้ Admin / GM ใส่ Webhook + Secret จากหน้าเว็บได้ — ค่าเก็บใน Script Properties ที่เดิม (ไม่ลงชีท ไม่ลง Log)
 *   · สิทธิ์ตัดสินที่ server (need_ 'manageUsers' ใน handle_) — client ซ่อนเมนูอย่างเดียวไม่พอ
 *   · ไม่ส่ง Secret กลับไปที่หน้าเว็บเลย · URL แสดงแบบปิดบัง (…/hook/••••xxxx)
 *   · เว้นว่าง = ไม่เปลี่ยนค่าเดิม · "ลบค่า" = ลบออกจาก Script Properties
 *   · ส่งการ์ดทดสอบ = ยิงจริงทันที (ไม่สนโหมด) ไปที่บอทตัวนั้นตัวเดียว แท็กอีเมลของคนที่กด */
var LARK_ADMIN_ACTIONS = ['larkStatus', 'larkSave', 'larkClear', 'larkTest', 'larkMode', 'larkTriggers', 'larkCheckEmails', 'larkRemindHour'];
function larkMaskUrl_(u) {
  u = String(u || ''); if (!u) return '';
  var m = /^(https:\/\/[^\/]+)\/.*\/hook\/(.*)$/.exec(u);
  return m ? m[1] + '/…/hook/••••' + m[2].slice(-4) : '••••' + u.slice(-4);
}
/** การส่งล่าสุดของบอทจากแท็บ NotifyQueue (อ่านครั้งเดียว ย้อนหลังไม่เกิน LARK_DEDUP_SCAN แถว) */
function larkLastFromQueue_() {
  var out = { A:null, B:null, C:null };
  try {
    var sh = sheet_(SH.NOTIFY), last = sh.getLastRow(); if (last < 2) return out;
    var idx = headerIndex_(sh), from = Math.max(2, last - LARK_DEDUP_SCAN + 1);
    var data = sh.getRange(from, 1, last - from + 1, sh.getLastColumn()).getValues();
    for (var i = data.length - 1; i >= 0 && (!out.A || !out.B || !out.C); i--) {
      var st = String(cell_(data[i], idx, 'Status'));
      if (['SENT', 'FAILED', 'RETRY', 'DRYRUN', 'SKIPPED'].indexOf(st) < 0) continue;
      var b = larkBotOfTarget_(String(cell_(data[i], idx, 'Target')));
      if (out[b]) continue;
      out[b] = { at:toIso_(cell_(data[i], idx, 'SentAt') || cell_(data[i], idx, 'NextAt') || cell_(data[i], idx, 'CreatedAt')),
                 what:String(cell_(data[i], idx, 'Event')), status:st, err:String(cell_(data[i], idx, 'LastError') || '').slice(0, 200) };
    }
  } catch (e) {}
  return out;
}
function larkTriggerState_() {
  var s = { flush:false, sla:false, known:true };
  try { ScriptApp.getProjectTriggers().forEach(function (t) { var f = t.getHandlerFunction(); if (f === 'larkFlush') s.flush = true; if (f === 'larkSlaScan') s.sla = true; }); }
  catch (e) { s.known = false; }
  return s;
}
function larkStatus_() {
  var props = larkProps_(), check = larkValidateConfig_(props), q = larkLastFromQueue_(), bots = {};
  for (var b in LARK_BOTS) {
    var def = LARK_BOTS[b], url = String(props[def.url] || '').trim(), test = null;
    try { test = props['LARK_LAST_TEST_' + b] ? JSON.parse(props['LARK_LAST_TEST_' + b]) : null; } catch (e) { test = null; }
    var last = q[b];
    if (test && (!last || String(test.at) > String(last.at))) last = test;
    if (last) last.whatTh = last.what === 'test' ? 'ส่งการ์ดทดสอบ' : ((LARK_EVENTS[last.what] || {}).th || last.what);
    var dest = larkBotDest_(b, props);
    bots[b] = { name:def.th, urlKey:def.url, secretKey:def.secret, urlSet:!!url, url:larkMaskUrl_(url), secretSet:!!String(props[def.secret] || '').trim(),
                via:dest && dest.via !== b ? dest.via : '', last:last };
  }
  var noEmail = [];
  try { noEmail = peopleCtx_().list.filter(function (u) { return u.active && !LARK_EMAIL_RE.test(u.email || ''); }).map(function (u) { return u.name; }); } catch (e) {}
  return { ok:true, mode:larkMode_(props), remindHour:larkRemindHour_(props), remindDay:String(props.LARK_REMIND_DAY || ''),
           problems:check.problems, warnings:check.warnings, bots:bots,
           triggers:larkTriggerState_(), noEmail:noEmail, appUrl:!!larkAppUrl_(props) };
}
function larkAdmin_(action, p, sess) {
  var P = PropertiesService.getScriptProperties(), bot = String(p.bot || ''), def = LARK_BOTS[bot];
  if (action === 'larkStatus') return larkStatus_();
  if (action === 'larkCheckEmails') return larkCheckEmails_(sess);
  if (action === 'larkRemindHour') {                                       // v5.8: เวลารอบเตือนวันละครั้ง
    var h = parseInt(String(p.hour), 10);
    if (!(h >= 8 && h <= 16)) return { ok:false, error:'BAD_VALUE' };
    P.setProperty('LARK_REMIND_HOUR', String(h));
    logRow_('lark-config', 'remind-hour', String(h), sess.name, '');
    return larkStatus_();
  }
  if (action === 'larkMode') {
    var m = String(p.mode || '').toLowerCase();
    if (['off', 'dryrun', 'live'].indexOf(m) < 0) return { ok:false, error:'BAD_VALUE' };
    if (m === 'live') {
      var c = larkValidateConfig_(Object.assign(larkProps_(), { LARK_MODE:'live' }));
      if (c.problems.length) return { ok:false, error:'LARK_NOT_READY', problems:c.problems };
    }
    P.setProperty('LARK_MODE', m);
    logRow_('lark-config', 'mode', m, sess.name, '');
    return larkStatus_();
  }
  if (action === 'larkTriggers') {
    try { larkInstallTriggers(); } catch (e) { return { ok:false, error:'TRIGGER_FAILED', detail:String(e).slice(0, 200) }; }
    logRow_('lark-config', 'triggers', '', sess.name, 'installed');
    return larkStatus_();
  }
  if (!def) return { ok:false, error:'BAD_VALUE' };
  if (action === 'larkSave') {
    var url = String(p.url || '').trim(), secret = String(p.secret || '').trim(), changed = [];
    if (!url && !secret) return { ok:false, error:'NOTHING_TO_SAVE' };
    if (url && !LARK_HOOK_RE.test(url)) return { ok:false, error:'BAD_WEBHOOK' };
    if (secret && (/\s/.test(secret) || secret.length > 200)) return { ok:false, error:'BAD_SECRET' };
    if (url) { P.setProperty(def.url, url); changed.push('webhook'); }
    if (secret) { P.setProperty(def.secret, secret); changed.push('secret'); }
    logRow_('lark-config', 'bot ' + bot, '', sess.name, 'ตั้ง ' + changed.join(' + '));   // ห้ามบันทึกค่าจริง
    return larkStatus_();
  }
  if (action === 'larkClear') {
    P.deleteProperty(def.url); P.deleteProperty(def.secret); P.deleteProperty('LARK_LAST_TEST_' + bot);
    logRow_('lark-config', 'bot ' + bot, '', sess.name, 'ลบค่า');
    return larkStatus_();
  }
  if (action === 'larkTest') {
    var props = larkProps_(), u = String(props[def.url] || '').trim();
    if (!u) return { ok:false, error:'LARK_NOT_SET' };
    var dest = { url:u, secret:String(props[def.secret] || '').trim() };
    var s = larkSampleInfo_({ name:sess.name, email:String(sess.email || '').toLowerCase() });
    var ev = bot === 'B' ? 'SLA_REMINDER' : 'QT_SUBMITTED';
    var info = Object.assign({}, s.qt, { docNo:'TEST-' + s.qt.docNo }, bot === 'B' ? { late:'เกินกำหนด 1 วันทำการ' } : {});
    var card = larkBuild_(ev, info, larkAppUrl_(props), { money:!!def.money }).card;   // v5.10: Bot C ทดสอบพร้อมตัวเลขตัวอย่าง
    card.header.title.content = '[ทดสอบจากหน้าตั้งค่า] ' + card.header.title.content;
    var res, code = 0, j = {}, err = '';
    // fetchAll เท่านั้น (กติกาของไฟล์นี้)
    try { res = UrlFetchApp.fetchAll([larkHookRequest_(dest, card)])[0]; code = res.getResponseCode(); try { j = JSON.parse(res.getContentText()); } catch (e) {} }
    catch (e) { err = String(e).slice(0, 200); }
    var okLark = !err && code === 200 && (j.code === 0 || j.StatusCode === 0), noTag = false;
    if (!okLark && !err && larkBadMention_(j)) {                                  // v5.7: อีเมลของคนที่กดไม่ใช่บัญชี Lark → ส่งซ้ำแบบไม่แท็ก (ตรวจ webhook ได้)
      try { var r2 = UrlFetchApp.fetchAll([larkHookRequest_(dest, larkStripMentions_(card, larkNameByEmail_()))])[0], j2 = {};
            try { j2 = JSON.parse(r2.getContentText()); } catch (e) {}
            okLark = r2.getResponseCode() === 200 && (j2.code === 0 || j2.StatusCode === 0); noTag = okLark; if (!okLark) j = j2; }
      catch (e) { err = String(e).slice(0, 200); }
    }
    if (!okLark && !err) err = ('HTTP ' + code + ' ' + (j.msg || j.StatusMessage || '') + larkHint_(j)).slice(0, 240);
    if (noTag) err = 'ส่งแล้วแบบไม่แท็ก — อีเมล ' + String(sess.email || '') + ' ไม่ใช่บัญชี Lark ในองค์กร';
    var rec = { at:nowISO_(), what:'test', status:okLark ? 'SENT' : 'FAILED', err:err };
    P.setProperty('LARK_LAST_TEST_' + bot, JSON.stringify(rec));
    logRow_('lark-test', 'bot ' + bot, '', sess.name, okLark ? 'ส่งสำเร็จ' : err);
    var st = larkStatus_(); st.test = { bot:bot, ok:okLark, err:err, noTag:noTag, mentioned:!noTag && !!LARK_EMAIL_RE.test(String(sess.email || '')) };
    return st;
  }
  return { ok:false, error:'unknown action: ' + action };
}

/** v5.7: ตรวจว่าอีเมลของผู้ใช้แต่ละคน @แท็กใน Lark ได้ไหม — ส่งการ์ดเล็ก 1 ใบต่อคน (fetchAll ครั้งเดียว) ผ่านบอทตัวแรก
 *  อีเมลที่ไม่ใช่บัญชี Lark → Lark ปฏิเสธ (ไม่มีอะไรขึ้นกลุ่ม) · ที่ถูกต้อง → การ์ด "[ตรวจอีเมล]" ขึ้นกลุ่มพร้อมแท็กคนนั้น
 *  Custom Bot ค้นหาผู้ใช้จากอีเมลไม่ได้ จึงต้องตรวจด้วยการส่งจริง */
function larkCheckEmails_(sess) {
  var props = larkProps_(), u = String(props[LARK_BOTS.A.url] || '').trim();
  if (!u) return { ok:false, error:'LARK_NOT_SET' };
  var dest = { url:u, secret:String(props[LARK_BOTS.A.secret] || '').trim() }, list = [], reqs = [];
  peopleCtx_().list.forEach(function (x) {
    if (!x.active) return;
    var e = String(x.email || '').trim().toLowerCase();
    if (!LARK_EMAIL_RE.test(e)) { list.push({ name:x.name, email:e, result:'NO_EMAIL' }); return; }
    if (reqs.length >= 40) { list.push({ name:x.name, email:e, result:'SKIPPED' }); return; }
    var card = { config:{ wide_screen_mode:true }, header:{ template:'grey', title:{ tag:'plain_text', content:'[ตรวจอีเมล @แท็ก] ไม่ต้องตอบกลับ' } },
                 elements:[{ tag:'div', text:{ tag:'lark_md', content:'<at email=' + e + '></at> — ระบบทำราคาทดสอบการแท็กชื่อคุณ' } },
                           { tag:'note', elements:[{ tag:'plain_text', content:'สั่งตรวจโดย ' + larkSafe_(sess.name, 60) }] }] };
    reqs.push(larkHookRequest_(dest, card)); list.push({ name:x.name, email:e, result:'PENDING' });
  });
  var resps = [];
  try { resps = reqs.length ? UrlFetchApp.fetchAll(reqs) : []; } catch (e) { return { ok:false, error:'SEND_FAILED', detail:String(e).slice(0, 200) }; }
  var k = 0;
  list.forEach(function (x) {
    if (x.result !== 'PENDING') return;
    var res = resps[k++], j = {}; try { j = JSON.parse(res.getContentText()); } catch (e) {}
    x.result = res.getResponseCode() === 200 && (j.code === 0 || j.StatusCode === 0) ? 'OK' : larkBadMention_(j) ? 'NOT_LARK' : 'ERROR';
    if (x.result === 'ERROR') x.err = (String(j.msg || j.StatusMessage || '') + larkHint_(j)).slice(0, 200);
  });
  logRow_('lark-check-emails', '', '', sess.name, list.filter(function (x) { return x.result !== 'OK'; }).length + ' ไม่ผ่าน / ' + list.length);
  return { ok:true, emails:list };
}
