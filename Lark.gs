/*************************************************************
 * MGS PROJECT PRICING — LARK NOTIFICATIONS  (v4.9 · webhook แยกกลุ่ม + กลุ่มคำขอราคา)
 * ไฟล์แยกในโปรเจกต์ Apps Script เดียวกับ Code.gs (ไฟล์ → + → Script → ตั้งชื่อ "Lark")
 *
 * โครงสร้าง (สร้างข้อความ ↔ ส่ง แยกกันคนละชั้น)
 *   1) EVENT TABLE   LARK_EVENTS — ทุก event อยู่ในตารางเดียว: ใครได้รับ / หัวข้อ / สี / กันส่งซ้ำกี่นาที
 *   2) BUILD         larkBuild_()  — pure function: ข้อมูลเอกสาร → การ์ด Lark + ข้อความธรรมดา (ไม่มี I/O)
 *   3) QUEUE         larkEnqueue_() — เขียนลงแท็บ NotifyQueue (ไม่ส่งทันที) · ตัดตัวซ้ำในช่วงเวลา · ห้าม throw
 *   4) SEND          larkFlush()   — trigger ทุก 5 นาที: ส่งทั้งชุดด้วย UrlFetchApp.fetchAll ครั้งเดียว
 *                                    ล้มเหลว → ลองใหม่ตามระยะ 1/5/15/60/180 นาที แล้วบันทึก FAILED
 *   5) SCHEDULE      larkSlaScan() (รายชั่วโมง) · larkDailyDigest() (ทุกเช้าวันทำการ)
 *
 * โหมด (Script Properties → LARK_MODE)
 *   off    = ไม่ทำอะไรเลย
 *   dryrun = ค่าเริ่มต้นของรอบนี้ — สร้างข้อความและเก็บในแท็บ NotifyQueue (Status = DRYRUN) แต่ไม่ยิงออก
 *   live   = ส่งจริง (เปิดเมื่อตรวจข้อความใน dry-run แล้วเท่านั้น)
 *
 * Script Properties (ห้ามใส่ในโค้ด · ตั้งที่ Project Settings → Script properties)
 *   LARK_MODE            off | dryrun | live
 *   LARK_DOMAIN          https://open.larksuite.com (ค่าเริ่มต้น) หรือ https://open.feishu.cn
 *   LARK_APP_ID          cli_xxx      ┐ Bot ของ Lark (Custom App) — ใช้ส่งการ์ด
 *   LARK_APP_SECRET      xxxx         ┘ ผ่าน tenant_access_token
 *   LARK_CHAT_SOURCING   oc_xxx  กลุ่มทีม Sourcing
 *   LARK_CHAT_APPROVERS  oc_xxx  กลุ่มผู้อนุมัติ (Procurement Mgr / BD Mgr / GM) — ต้องมีแต่ผู้จัดการ เพราะการ์ดมี %GP
 *   LARK_CHAT_RELEASE    oc_xxx  กลุ่ม/ผู้ปล่อยราคา (ไม่ตั้ง = ใช้กลุ่ม SALES)
 *   LARK_CHAT_SALES      oc_xxx  กลุ่มทีมขาย — การ์ดไม่มีต้นทุน/GP เด็ดขาด
 *   LARK_CHAT_REQUESTS   oc_xxx  (ทางเลือก) กลุ่มคำขอราคา Sales + Sourcing
 *
 *   — หรือใช้ Custom Bot webhook แยกทีละกลุ่ม (ข้อความธรรมดา ไม่มีการ์ด) — v4.9 —
 *   LARK_WEBHOOK_SOURCING   / LARK_WEBHOOK_SOURCING_SECRET    กลุ่มทีม Sourcing            (ภายใน)
 *   LARK_WEBHOOK_APPROVERS  / LARK_WEBHOOK_APPROVERS_SECRET   กลุ่มผู้อนุมัติ               (ภายใน — มี %GP)
 *   LARK_WEBHOOK_RELEASE    / LARK_WEBHOOK_RELEASE_SECRET     ผู้ปล่อยราคา (ไม่ตั้ง = ใช้ของ SALES)  (มี Sales)
 *   LARK_WEBHOOK_SALES      / LARK_WEBHOOK_SALES_SECRET       กลุ่มทีมขาย                  (มี Sales)
 *   LARK_WEBHOOK_REQUESTS   / LARK_WEBHOOK_REQUESTS_SECRET    กลุ่มคำขอราคา Sales+Sourcing (มี Sales)
 *   LARK_WEBHOOK_URL / LARK_WEBHOOK_SECRET  ตัวเดิม (v4.7) — ใช้แทนได้เฉพาะกลุ่ม "ภายใน" (Sourcing / ผู้อนุมัติ) เท่านั้น
 *
 *   กติกาความปลอดภัย (fail-closed): กลุ่มที่มี Sales ไม่ได้รับยอดเงิน/%GP เลย · ถ้าปลายทางของกลุ่มภายใน
 *   ตั้งเป็นกลุ่มเดียวกับกลุ่มที่มี Sales ข้อความของกลุ่มภายในจะถูกระงับ (SKIPPED) แม้ตั้งค่าผิด
 *   APP_URL              URL /exec ของ Web App (ไม่ตั้ง = ใช้ ScriptApp.getService().getUrl())
 *************************************************************/

var LARK_VERSION = '4.9';

/* ============================================================ 1) EVENT TABLE */
/**
 * to       = กลุ่มผู้รับ (SOURCING / APPROVERS / RELEASE / SALES) · 'owner' = กลุ่มของผู้รับผิดชอบงานตอนนั้น
 * dedupMin = ไม่ส่ง event เดิม (เอกสารเดิม รอบเดิม กลุ่มเดิม) ซ้ำภายในกี่นาที
 * color    = สีหัวการ์ด Lark (template) · icon = นำหน้าหัวข้อ
 * gp       = แสดง %GP ในการ์ดได้ไหม (เฉพาะกลุ่มผู้อนุมัติ)
 */
var LARK_EVENTS = {
  SR_SUBMITTED:   { th:'คำขอราคาใหม่เข้าคิว',        icon:'🆕', to:['SOURCING', 'REQUESTS'],             dedupMin:24 * 60, color:'orange',
                    when:'Sales ส่งคำขอราคา (SR) ใหม่ หรือส่งร่างที่ค้างไว้',  button:'เปิดคำขอราคา' },
  QT_SUBMITTED:   { th:'ใบเสนอราคารออนุมัติ',         icon:'🧾', to:['APPROVERS'],            dedupMin:120,     color:'yellow', gp:true,
                    when:'Sourcing กด “บันทึก & ส่งขออนุมัติ”',               button:'เปิดเพื่ออนุมัติ' },
  QT_APPROVED:    { th:'อนุมัติราคาครบแล้ว · รอปล่อยราคา', icon:'✅', to:['SOURCING', 'RELEASE'], dedupMin:24 * 60, color:'green',
                    when:'ผู้อนุมัติครบทุกฝ่าย (หรือ GM อนุมัติแทน)',          button:'เปิดใบเสนอราคา' },
  QT_RETURNED:    { th:'ไม่อนุมัติ · ส่งกลับแก้ราคา',   icon:'↩️', to:['SOURCING'],             dedupMin:120,     color:'red',
                    when:'ผู้จัดการส่งใบที่รออนุมัติกลับไปแก้ (สถานะกลับเป็นกำลังจัดทำราคา)', button:'เปิดใบเสนอราคา' },
  PRICE_RELEASED: { th:'ปล่อยราคาแล้ว · พร้อมเสนอลูกค้า', icon:'📤', to:['SALES', 'REQUESTS'],                dedupMin:24 * 60, color:'blue',
                    when:'ผู้ปล่อยราคากดปล่อยราคาให้ Sales เจ้าของงาน',        button:'เปิดในแอป Sales' },
  SLA_BREACH:     { th:'งานเกินกำหนด (SLA)',          icon:'⛔', to:'owner',                  dedupMin:24 * 60, color:'red',
                    when:'ตรวจทุกชั่วโมง: งานที่รอเกินจำนวนวันทำการที่กำหนด (รวมหลายงานเป็นการ์ดเดียวต่อกลุ่ม)', button:'เปิดระบบ' },
  DAILY_DIGEST:   { th:'สรุปงานค้างประจำวัน',          icon:'📋', to:['SOURCING', 'APPROVERS', 'RELEASE', 'SALES'], dedupMin:20 * 60, color:'indigo',
                    when:'ทุกเช้าวันทำการ 08:30 — หนึ่งการ์ดต่อกลุ่มต่อวัน (ไม่มีงานค้าง = ไม่ส่ง)', button:'เปิดระบบ' }
};
/**
 * กลุ่มผู้รับ · prop = chat_id (Bot) · hook = webhook ของกลุ่มนั้น (+ hook + '_SECRET')
 * audience: internal = มีแต่ทีมภายใน (เห็นยอดเงินได้) · sales = มี Sales อยู่ด้วย → ห้ามมียอดเงิน/%GP ในข้อความ
 * optional: ไม่ได้ตั้งปลายทาง = ไม่สร้างรายการในคิวเลย (ไม่รก)
 */
var LARK_GROUPS = {
  SOURCING:  { th:'ทีม Sourcing',   prop:'LARK_CHAT_SOURCING',  hook:'LARK_WEBHOOK_SOURCING',  audience:'internal' },
  APPROVERS: { th:'ผู้อนุมัติราคา',   prop:'LARK_CHAT_APPROVERS', hook:'LARK_WEBHOOK_APPROVERS', audience:'internal' },
  RELEASE:   { th:'ผู้ปล่อยราคา',     prop:'LARK_CHAT_RELEASE',   hook:'LARK_WEBHOOK_RELEASE',   audience:'sales', fallback:'SALES' },
  SALES:     { th:'ทีมขาย',          prop:'LARK_CHAT_SALES',     hook:'LARK_WEBHOOK_SALES',     audience:'sales' },
  REQUESTS:  { th:'กลุ่มคำขอราคา',    prop:'LARK_CHAT_REQUESTS',  hook:'LARK_WEBHOOK_REQUESTS',  audience:'sales', optional:true }
};
var LARK_HOOK_RE = /^https:\/\/open\.(larksuite\.com|feishu\.cn)\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9-]+$/;
/* ผู้รับผิดชอบงานตอนนี้ (followState_ ใน Code.gs) → กลุ่ม Lark */
var LARK_OWNER_GROUP = { SOURCING:'SOURCING', REPAIR:'SOURCING', MANAGEMENT:'APPROVERS', RELEASER:'RELEASE', SALES:'SALES' };
var LARK_RETRY_MIN = [1, 5, 15, 60, 180];        // ระยะรอก่อนลองใหม่ (นาที) · ครบแล้วยังไม่ได้ = FAILED
var LARK_FLUSH_MAX = 30;                          // ส่งได้สูงสุดต่อรอบ (กัน quota / timeout)
var LARK_QUEUE_KEEP = 3000;                       // เก็บประวัติในแท็บ NotifyQueue ล่าสุดกี่แถว
var LARK_DEDUP_SCAN = 1500;                       // ตรวจซ้ำย้อนหลังกี่แถว

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
function larkChatOf_(group, props) {
  var g = LARK_GROUPS[group]; if (!g) return '';
  var v = String(props[g.prop] || '').trim();
  if (!v && g.fallback) v = String(props[LARK_GROUPS[g.fallback].prop] || '').trim();
  return v;
}
function larkMask_(s) { s = String(s || ''); return s.length <= 6 ? (s ? '***' : '') : s.slice(0, 4) + '…' + s.slice(-2); }
function larkAudience_(group) { return (LARK_GROUPS[group] || {}).audience === 'internal' ? 'internal' : 'sales'; }
/**
 * ปลายทางจริงของกลุ่ม: Bot + chat_id (การ์ด) ก่อน → webhook ของกลุ่ม → webhook ของกลุ่มสำรอง (RELEASE → SALES)
 * → webhook ตัวเดิม LARK_WEBHOOK_URL (เฉพาะกลุ่มภายใน) · ไม่มี = null
 * @return {{kind:'chat'|'hook', id?:string, url?:string, secret?:string, key:string}|null}
 */
function larkDestOf_(group, props) {
  var g = LARK_GROUPS[group]; if (!g) return null;
  var chat = larkChatOf_(group, props);
  if (props.LARK_APP_ID && props.LARK_APP_SECRET && chat) return { kind:'chat', id:chat, key:'chat:' + chat };
  var url = String(props[g.hook] || '').trim(), secret = String(props[g.hook + '_SECRET'] || '').trim();
  if (!url && g.fallback) { var fg = LARK_GROUPS[g.fallback]; url = String(props[fg.hook] || '').trim(); secret = String(props[fg.hook + '_SECRET'] || '').trim(); }
  if (!url && g.audience === 'internal') { url = String(props.LARK_WEBHOOK_URL || '').trim(); secret = String(props.LARK_WEBHOOK_SECRET || '').trim(); }
  return url ? { kind:'hook', url:url, secret:secret, key:'hook:' + url } : null;
}
/** กลุ่มภายในที่ปลายทางเป็นกลุ่มเดียวกับกลุ่มที่มี Sales → คืนชื่อกลุ่มนั้น (ข้อความต้องถูกระงับ) · ไม่ชน = '' */
function larkSharedWithSales_(group, props) {
  if (larkAudience_(group) !== 'internal') return '';
  var d = larkDestOf_(group, props); if (!d) return '';
  var hit = [];
  for (var g in LARK_GROUPS) {
    if (larkAudience_(g) !== 'sales') continue;
    var o = larkDestOf_(g, props);
    if (o && o.key === d.key) hit.push(LARK_GROUPS[g].th);
  }
  return hit.join(' / ');
}
/**
 * ตรวจการตั้งค่าตอนเริ่มระบบ (setup / ?diag=1 / ก่อนส่งทุกรอบ) — ไม่คืนค่า secret
 * @return {{mode:string, ready:boolean, problems:string[], warnings:string[], targets:Object, appUrl:string, via:string}}
 */
function larkValidateConfig_(props) {
  props = props || larkProps_();
  var mode = larkMode_(props), problems = [], warnings = [], targets = {};
  var raw = String(props.LARK_MODE || '').toLowerCase().trim();
  if (raw && ['off', 'dryrun', 'live'].indexOf(raw) < 0) problems.push('LARK_MODE ต้องเป็น off / dryrun / live (ตอนนี้ใช้ dryrun แทน)');
  var domain = String(props.LARK_DOMAIN || 'https://open.larksuite.com');
  if (!/^https:\/\/open\.(larksuite\.com|feishu\.cn)$/.test(domain)) problems.push('LARK_DOMAIN ต้องเป็น https://open.larksuite.com หรือ https://open.feishu.cn');
  var hasApp = !!(props.LARK_APP_ID && props.LARK_APP_SECRET);
  var hook = String(props.LARK_WEBHOOK_URL || ''), anyHook = !!hook;
  for (var g0 in LARK_GROUPS) if (String(props[LARK_GROUPS[g0].hook] || '').trim()) anyHook = true;
  if (props.LARK_APP_ID && !/^cli_[A-Za-z0-9]+$/.test(String(props.LARK_APP_ID))) problems.push('LARK_APP_ID ควรขึ้นต้นด้วย cli_');
  if (!!props.LARK_APP_ID !== !!props.LARK_APP_SECRET) problems.push('ต้องตั้ง LARK_APP_ID และ LARK_APP_SECRET คู่กัน');
  if (hook && !LARK_HOOK_RE.test(hook)) problems.push('LARK_WEBHOOK_URL ไม่ใช่รูปแบบ webhook ของ Lark');
  for (var g in LARK_GROUPS) {
    var G = LARK_GROUPS[g], chat = larkChatOf_(g, props), gh = String(props[G.hook] || '').trim();
    if (gh && !LARK_HOOK_RE.test(gh)) problems.push(G.hook + ' ไม่ใช่รูปแบบ webhook ของ Lark');
    if (chat && !/^oc_[A-Za-z0-9]+$/.test(chat)) problems.push(G.prop + ' ควรเป็น chat_id ที่ขึ้นต้นด้วย oc_');
    var d = larkDestOf_(g, props);
    targets[g] = d ? (d.kind === 'chat' ? 'chat ' + larkMask_(d.id) : 'webhook …' + d.url.slice(-6)) : '';
    if (!d && !G.optional && (hasApp || anyHook))
      warnings.push('ยังไม่ได้ตั้งปลายทางของ ' + G.th + ' (' + G.prop + ' หรือ ' + G.hook + ') — การแจ้งเตือนถึงกลุ่มนี้จะถูกข้าม (SKIPPED)');
    var shared = larkSharedWithSales_(g, props);
    if (shared) warnings.push('ปลายทางของ ' + G.th + ' เป็นกลุ่มเดียวกับ ' + shared + ' ซึ่งมี Sales — ข้อความของ ' + G.th + ' (อาจมียอดเงิน/%GP) จะถูกระงับทั้งหมด');
  }
  var via = hasApp ? 'bot' : (anyHook ? 'webhook' : 'none');
  if (via === 'none') (mode === 'live' ? problems : warnings).push('ยังไม่ได้ตั้ง Bot (LARK_APP_ID/SECRET) หรือ webhook ของกลุ่มใดเลย — ส่งจริงไม่ได้');
  if (via === 'webhook') warnings.push('ใช้ webhook = ส่งได้แค่ข้อความธรรมดา (ไม่มีการ์ดสี/ปุ่ม แต่มีลิงก์เปิดเอกสารท้ายข้อความ)');
  var appUrl = larkAppUrl_(props);
  if (!appUrl) warnings.push('ยังไม่รู้ URL ของ Web App — ปุ่ม “เปิดเอกสาร” ในการ์ดจะไม่มีลิงก์ (ตั้ง APP_URL)');
  return { mode:mode, ready:mode === 'live' && problems.length === 0 && via !== 'none', problems:problems, warnings:warnings,
           targets:targets, appUrl:appUrl, via:via, domain:domain };
}

/* ============================================================ 2) BUILD (pure — ไม่มี I/O) */
/** ข้อความจากผู้ใช้ → ปลอดภัยสำหรับ Lark: ตัด < > (กัน <at user_id="all">) · ตัดอักขระควบคุม · จำกัดความยาว */
function larkSafe_(s, max) {
  return String(s == null ? '' : s).replace(/[<>]/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 120);
}
function larkMoney_(n, cur) {
  var v = Number(n); if (!isFinite(v)) return '—';
  var s = v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  var sym = { THB:'฿', USD:'US$', CNY:'CN¥' }[cur || 'THB'] || ((cur || '') + ' ');
  return sym + s;
}
function larkLink_(appUrl, doc, target) {
  if (!appUrl) return '';
  var sep = appUrl.indexOf('?') >= 0 ? '&' : '?';
  if (target === 'REQUESTS') return doc ? appUrl + sep + 'doc=' + encodeURIComponent(doc) : appUrl;   // กลุ่มผสม: ไม่ระบุแอป ให้ระบบเลือกตามอีเมลผู้กด
  var app = (target === 'SALES' || target === 'RELEASE') ? 'sales' : 'index';
  return appUrl + sep + 'app=' + app + (doc ? '&doc=' + encodeURIComponent(doc) : '');
}
/**
 * สร้างข้อความของ event หนึ่งรายการสำหรับกลุ่มผู้รับหนึ่งกลุ่ม
 * @param {string} event  คีย์ใน LARK_EVENTS
 * @param {Object} info   { id, docNo, docType, title, customer, sales, currency, value, gp, round, by, note, waitingDays, slaDays, items[], counts{} }
 * @param {string} target กลุ่มผู้รับ
 * @param {string} appUrl URL ของ Web App (ทำปุ่มลิงก์)
 * @return {{title:string, card:Object, text:string}}
 */
function larkBuild_(event, info, target, appUrl) {
  var ev = LARK_EVENTS[event]; if (!ev) throw new Error('unknown event ' + event);
  info = info || {};
  var showGp = !!ev.gp && target === 'APPROVERS';          // price gate: %GP เฉพาะกลุ่มผู้อนุมัติ · ต้นทุนไม่ออกไปที่ไหนเลย
  var showMoney = larkAudience_(target) === 'internal';      // v4.9: กลุ่มที่มี Sales ไม่ได้รับยอดเงินเลย (Sales แต่ละคนเห็นเฉพาะงานตัวเองในแอป)
  var title = ev.icon + ' ' + ev.th + (info.docNo ? ' · ' + larkSafe_(info.docNo, 40) : '');
  var fields = [], lines = [];
  var add = function (label, value) {
    if (value === '' || value == null) return;
    var v = larkSafe_(value, 160);
    fields.push({ is_short:true, text:{ tag:'plain_text', content:label + ': ' + v } });
    lines.push(label + ': ' + v);
  };
  var elements = [];
  if (event === 'SLA_BREACH' || event === 'DAILY_DIGEST') {
    var c = info.counts || {};
    title = ev.icon + ' ' + ev.th + ' · ' + (LARK_GROUPS[target] ? LARK_GROUPS[target].th : target);
    if (event === 'DAILY_DIGEST') {
      add('งานค้างทั้งหมด', (c.total || 0) + ' งาน');
      add('⛔ เกินกำหนด', (c.over || 0) + ' งาน');
      add('⚠ เฝ้าระวัง', (c.watch || 0) + ' งาน');
    } else add('งานที่เพิ่งเกินกำหนด', (info.items || []).length + ' งาน');
    elements.push({ tag:'div', fields:fields });
    var list = (info.items || []).slice(0, 10).map(function (it) {
      var lv = it.level === 'over' ? '⛔' : it.level === 'watch' ? '⚠' : '•';
      return lv + ' ' + larkSafe_(it.docNo || '—', 30) + ' · ' + larkSafe_(it.title || it.customer || '', 60) +
             ' · ' + larkSafe_(it.label || '', 40) + (it.waitingDays != null ? ' (' + it.waitingDays + ' วัน)' : '');
    });
    if (list.length) {
      elements.push({ tag:'hr' });
      elements.push({ tag:'div', text:{ tag:'plain_text', content:list.join('\n') } });
      lines.push(list.join('\n'));
    }
    if ((info.items || []).length > 10) elements.push({ tag:'note', elements:[{ tag:'plain_text', content:'และอีก ' + (info.items.length - 10) + ' งาน — ดูทั้งหมดในระบบ' }] });
  } else {
    add('โครงการ', info.title);
    add('ลูกค้า', info.customer);
    add('Sales', info.sales);
    if (event === 'SR_SUBMITTED') add('จำนวนรายการ', info.lines ? info.lines + ' รายการ' : '');
    else if (showMoney) add('มูลค่า', info.value != null && info.value !== '' ? larkMoney_(info.value, info.currency) : '');
    if (showGp && info.gp != null && info.gp !== '') add('%GP', (Math.round(Number(info.gp) * 10) / 10) + '%');
    if (info.round > 1) add('รอบ', 'R' + info.round);
    add('โดย', info.by);
    if (info.needBy) add('ต้องการราคาภายใน', info.needBy);
    elements.push({ tag:'div', fields:fields });
    if (!showMoney && event === 'PRICE_RELEASED' && !info.note) info = Object.assign({}, info, { note:'ราคาอยู่ในแอป Sales — เห็นเฉพาะ Sales เจ้าของงานและผู้จัดการ' });
    if (info.note) { elements.push({ tag:'note', elements:[{ tag:'plain_text', content:larkSafe_(info.note, 200) }] }); lines.push(larkSafe_(info.note, 200)); }
  }
  var url = larkLink_(appUrl, (event === 'SLA_BREACH' || event === 'DAILY_DIGEST') ? '' : info.id, target);
  if (url) elements.push({ tag:'action', actions:[{ tag:'button', type:'primary', text:{ tag:'plain_text', content:ev.button }, url:url }] });
  var card = { config:{ wide_screen_mode:true }, header:{ template:ev.color, title:{ tag:'plain_text', content:title } }, elements:elements };
  var text = title + '\n' + lines.join('\n') + (url ? '\n' + url : '');
  return { title:title, card:card, text:text };
}
/** ข้อมูลของเอกสารจากแถวในชีท (ใช้คอลัมน์ + SalesDetail ที่ไม่มีต้นทุน) */
function larkInfoFromRow_(r, idx) {
  var sd = String(cell_(r, idx, 'SalesDetail') || ''), m = /"total":(-?[0-9.]+)/.exec(sd);
  var det = String(cell_(r, idx, 'Detail') || '');
  var nLines = 0; try { var d = JSON.parse(det); nLines = (d.lines || []).length; } catch (e) {}
  return {
    id:String(cell_(r, idx, 'Id') || ''), docNo:String(cell_(r, idx, 'DocNo') || cell_(r, idx, 'Ref') || ''),
    docType:String(cell_(r, idx, 'DocType') || 'QT'), title:String(cell_(r, idx, 'Title') || ''),
    customer:String(cell_(r, idx, 'Customer') || ''), sales:String(cell_(r, idx, 'Sales') || ''),
    currency:String(cell_(r, idx, 'Currency') || 'THB'),
    value:m ? num_(m[1]) : num_(cell_(r, idx, 'Total')), gp:num_(cell_(r, idx, 'GP'), ''),
    round:num_(cell_(r, idx, 'Round'), 1), lines:nLines, needBy:topStr_(det, 'needBy')
  };
}

/* ============================================================ 3) QUEUE + DEDUP */
/** คีย์กันส่งซ้ำ: event + เอกสาร + รอบ + กลุ่ม (digest ใช้วันที่แทนเอกสาร) */
function larkDedupKey_(event, info, target, dayStr) {
  if (event === 'DAILY_DIGEST') return event + '|' + target + '|' + dayStr;
  if (event === 'SLA_BREACH') return event + '|' + (info.id || '') + '|' + (info.owner || '') + '|' + target;
  return event + '|' + (info.id || '') + '|R' + (info.round || 1) + '|' + target;
}
/** คีย์ที่ส่ง/เข้าคิวไปแล้ว → เวลาล่าสุด (อ่านแท็บครั้งเดียว) */
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
 * @param {Array<{event:string, info:Object, targets?:string[]}>} items
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
    items.forEach(function (it) {
      var ev = LARK_EVENTS[it.event]; if (!ev) return;
      var targets = it.targets || (ev.to === 'owner' ? [] : ev.to), destSeen = {};
      targets.forEach(function (target) {
        var G = LARK_GROUPS[target]; if (!G) return;
        var dest = larkDestOf_(target, props);
        if (!dest && G.optional) return;                                   // กลุ่มเสริมที่ไม่ได้ตั้ง = ไม่สร้างรายการ
        var shared = larkSharedWithSales_(target, props);
        if (dest && !shared && destSeen[dest.key]) { out.deduped++; return; }  // หลายกลุ่มชี้ไปกลุ่ม Lark เดียวกัน → ส่งครั้งเดียว
        var key = larkDedupKey_(it.event, it.info || {}, target, day);
        if (recent[key] && now - recent[key] < ev.dedupMin * 60000) { out.deduped++; return; }
        recent[key] = now;
        var msg = larkBuild_(it.event, it.info || {}, target, appUrl);
        var r = new Array(width).fill('');
        var set = function (h, v) { if (idx[h]) r[idx[h] - 1] = v; };
        set('Id', Utilities.getUuid()); set('Event', it.event); set('DocId', (it.info && it.info.id) || '');
        set('DedupKey', key); set('Target', target); set('Title', msg.title);
        set('Payload', JSON.stringify({ card:msg.card, text:msg.text }).slice(0, CELL_LIMIT));
        set('Status', 'PENDING'); set('Tries', 0); set('NextAt', stamp); set('CreatedAt', stamp);
        var missing = 'ยังไม่ได้ตั้งปลายทาง ' + G.prop + ' / ' + G.hook;
        if (shared) { set('Status', 'SKIPPED'); set('LastError', 'ระงับ: ปลายทางของ ' + G.th + ' เป็นกลุ่มเดียวกับ ' + shared + ' ซึ่งมี Sales (ข้อความนี้อาจมียอดเงิน/%GP)'); out.skipped++; }
        else if (!dest && mode === 'live') { set('Status', 'SKIPPED'); set('LastError', missing); out.skipped++; }
        else { out.queued++; if (!dest) set('LastError', missing + ' (dry-run: ไม่กระทบ)'); else destSeen[dest.key] = 1; }
        rows.push(r);
      });
    });
    if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, width).setValues(rows);   // เขียนครั้งเดียว
  } catch (e) {
    out.error = String(e);
    try { logRow_('lark-enqueue-error', '', '', '-', String(e).slice(0, 300)); } catch (e2) {}
  }
  return out;
}
function larkEnqueue_(event, info, targets) { return larkEnqueueMany_([{ event:event, info:info, targets:targets }]); }

/**
 * จุดเชื่อมจาก Code.gs: สถานะเอกสารเปลี่ยน → แปลงเป็น event (ถ้ามี) แล้วเข้าคิว
 * เรียกหลังเขียนแถวสำเร็จแล้วเท่านั้น · ไม่ throw · ไม่ส่ง HTTP ในธุรกรรมหลัก
 */
function larkOnStatus_(sh, idx, row, prevStatus, newStatus, sess, extra) {
  try {
    prevStatus = String(prevStatus || ''); newStatus = String(newStatus || '');
    var r = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
    var info = larkInfoFromRow_(r, idx); info.by = sess ? sess.name : '';
    if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) info[k] = extra[k];
    var event = larkEventFor_(info.docType, prevStatus, newStatus, extra && extra.event);
    if (!event) return null;
    if (event === 'QT_RETURNED' && !info.note) info.note = 'ส่งกลับให้ Sourcing แก้ราคา — ต้องขออนุมัติใหม่ทั้งสองฝ่าย';
    return larkEnqueue_(event, info);
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
  if (docType === 'SR') return next === 'Submitted' ? 'SR_SUBMITTED' : null;
  if (next === 'Submitted' && !inApproval(prev)) return 'QT_SUBMITTED';
  if (next === 'Approved') return 'QT_APPROVED';
  if (inApproval(prev) && (next === 'In Progress' || next === 'Requested')) return 'QT_RETURNED';
  return null;
}

/* ============================================================ 4) SEND */
/** tenant_access_token (เก็บใน cache จนใกล้หมดอายุ) */
function larkToken_(props) {
  var cache = CacheService.getScriptCache(), key = 'lark:tat:' + String(props.LARK_APP_ID || '');
  var hit = cache.get(key); if (hit) return hit;
  var domain = String(props.LARK_DOMAIN || 'https://open.larksuite.com');
  var res = UrlFetchApp.fetch(domain + '/open-apis/auth/v3/tenant_access_token/internal', {
    method:'post', contentType:'application/json; charset=utf-8', muteHttpExceptions:true,
    payload:JSON.stringify({ app_id:props.LARK_APP_ID, app_secret:props.LARK_APP_SECRET }) });
  var j = {}; try { j = JSON.parse(res.getContentText()); } catch (e) {}
  if (j.code !== 0 || !j.tenant_access_token) throw new Error('ขอ tenant_access_token ไม่สำเร็จ (code ' + j.code + ' ' + (j.msg || res.getResponseCode()) + ')');
  cache.put(key, j.tenant_access_token, Math.max(60, Math.min(21600, (j.expire || 7200) - 300)));
  return j.tenant_access_token;
}
/** ลายเซ็น webhook ของ Lark: base64(HmacSHA256(key = timestamp + "\n" + secret, message = "")) */
function larkSign_(timestamp, secret) {
  return Utilities.base64Encode(Utilities.computeHmacSha256Signature('', timestamp + '\n' + secret));
}
/** แปลงรายการในคิว → request ของ UrlFetchApp (ยังไม่ยิง) */
function larkRequestFor_(item, props, token) {
  var domain = String(props.LARK_DOMAIN || 'https://open.larksuite.com'), p = JSON.parse(item.payload || '{}');
  var shared = larkSharedWithSales_(item.target, props);   // ตรวจซ้ำตอนส่ง เผื่อตั้งค่าเปลี่ยนหลังเข้าคิว (fail-closed)
  if (shared) return { skip:'ระงับ: ปลายทางของ ' + ((LARK_GROUPS[item.target] || {}).th || item.target) + ' เป็นกลุ่มเดียวกับ ' + shared + ' ซึ่งมี Sales' };
  var dest = larkDestOf_(item.target, props);
  if (!dest) return null;
  if (dest.kind === 'chat') {
    if (!token) return null;
    return { url:domain + '/open-apis/im/v1/messages?receive_id_type=chat_id', method:'post', muteHttpExceptions:true,
             contentType:'application/json; charset=utf-8', headers:{ Authorization:'Bearer ' + token },
             payload:JSON.stringify({ receive_id:dest.id, msg_type:'interactive', content:JSON.stringify(p.card), uuid:item.id }) };
  }
  // webhook = ข้อความธรรมดาเท่านั้น · ลายเซ็นด้วย secret ของกลุ่มนั้น
  var body = { msg_type:'text', content:{ text:'[' + (LARK_GROUPS[item.target] ? LARK_GROUPS[item.target].th : item.target) + '] ' + p.text } };
  if (dest.secret) { var ts = String(Math.floor(Date.now() / 1000)); body.timestamp = ts; body.sign = larkSign_(ts, dest.secret); }
  return { url:dest.url, method:'post', muteHttpExceptions:true, contentType:'application/json; charset=utf-8', payload:JSON.stringify(body) };
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
    var check = larkValidateConfig_(props), token = '', reqs = [], map = [];
    if (check.problems.length) outcome = picked.map(function () { return { status:'RETRY', err:'ตั้งค่าไม่ครบ: ' + check.problems[0] }; });
    else {
      try { if (check.via === 'bot') token = larkToken_(props); }
      catch (e) { outcome = picked.map(function () { return { status:'RETRY', err:String(e).slice(0, 200) }; }); token = null; }
      if (token !== null) {
        picked.forEach(function (it, k) {
          var rq = larkRequestFor_(it, props, token);
          if (rq && rq.skip) outcome[k] = { status:'SKIPPED', err:rq.skip };
          else if (rq) { reqs.push(rq); map.push(k); } else outcome[k] = { status:'SKIPPED', err:'ไม่มีปลายทางของกลุ่ม ' + it.target };
        });
        var resps = [];
        try { resps = reqs.length ? UrlFetchApp.fetchAll(reqs) : []; }                // HTTP ครั้งเดียวทั้งชุด
        catch (e) { resps = []; map.forEach(function (k) { outcome[k] = { status:'RETRY', err:String(e).slice(0, 200) }; }); }
        resps.forEach(function (res, n) {
          var k = map[n], code = res.getResponseCode(), j = {};
          try { j = JSON.parse(res.getContentText()); } catch (e) {}
          var okLark = code === 200 && (j.code === 0 || j.StatusCode === 0);
          outcome[k] = okLark ? { status:'SENT', err:'' } : { status:'RETRY', err:('HTTP ' + code + ' code ' + (j.code != null ? j.code : j.StatusCode) + ' ' + (j.msg || j.StatusMessage || '')).slice(0, 200) };
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

/* ============================================================ 5) SCHEDULE: SLA + DAILY DIGEST */
/** อ่านงานที่ยังเปิดอยู่ทั้งหมดครั้งเดียว → [{info, follow, group}] (คำนวณในหน่วยความจำ ไม่มี I/O ในลูป) */
function larkOpenWork_(nowMs) {
  var sh = sheet_(SH.QUOTES), last = sh.getLastRow(); if (last < 2) return [];
  var idx = headerIndex_(sh), data = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues(), cfg = followCfg_(), out = [];
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    if (String(cell_(r, idx, 'Deleted')).toUpperCase() === 'TRUE') continue;
    var f = followState_(followInfo_(r, idx), cfg, nowMs), group = LARK_OWNER_GROUP[f.owner];
    if (!group) continue;
    var info = larkInfoFromRow_(r, idx);
    info.owner = f.owner; info.level = f.level; info.label = f.label; info.waitingDays = f.waitingDays;
    out.push({ info:info, follow:f, group:group });
  }
  return out;
}
/** trigger ไม่ได้ถือ ScriptLock → ต้องล็อกก่อนเขียนคิว (กันชนแถวกับการบันทึกของผู้ใช้ที่เข้าคิวพร้อมกัน) */
function larkWithLock_(fn) {
  var lock = LockService.getScriptLock(), mine = !lock.hasLock();
  if (mine && !lock.tryLock(25000)) return { busy:true };
  try { return fn(); } finally { if (mine) lock.releaseLock(); }
}
/** รายชั่วโมง: งานที่เกินกำหนด → การ์ดเดียวต่อกลุ่ม (เฉพาะงานที่ยังไม่เคยแจ้งใน 24 ชม.) */
function larkSlaScan() { return larkWithLock_(larkSlaScan_); }
function larkSlaScan_() {
  var props = larkProps_(); if (larkMode_(props) === 'off') return { mode:'off' };
  var now = Date.now(), work = larkOpenWork_(now).filter(function (w) { return w.follow.level === 'over'; });
  var sh = sheet_(SH.NOTIFY), recent = larkRecentKeys_(sh), byGroup = {}, perDoc = [];
  work.forEach(function (w) {
    var key = larkDedupKey_('SLA_BREACH', w.info, w.group);
    if (recent[key] && now - recent[key] < LARK_EVENTS.SLA_BREACH.dedupMin * 60000) return;
    (byGroup[w.group] = byGroup[w.group] || []).push(w.info);
    perDoc.push(key);
  });
  var items = Object.keys(byGroup).map(function (g) {
    var list = byGroup[g].sort(function (a, b) { return (b.waitingDays || 0) - (a.waitingDays || 0); });
    return { event:'SLA_BREACH', info:{ id:'', items:list, owner:g + '|' + list.map(function (x) { return x.id; }).join(',') }, targets:[g] };
  });
  var res = larkEnqueueMany_(items);
  if (perDoc.length) larkMarkKeys_(sh, perDoc);             // จำรายเอกสาร: ชั่วโมงหน้าไม่แจ้งงานเดิมซ้ำ
  res.newBreaches = perDoc.length;
  return res;
}
/** บันทึกคีย์รายเอกสารว่าแจ้งไปแล้ว (แถว Status=GROUPED ไม่ถูกส่ง) — เขียนครั้งเดียว */
function larkMarkKeys_(sh, keys) {
  var idx = headerIndex_(sh), width = sh.getLastColumn(), stamp = nowISO_();
  var rows = keys.map(function (k) {
    var r = new Array(width).fill('');
    r[idx['Id'] - 1] = Utilities.getUuid(); r[idx['Event'] - 1] = 'SLA_BREACH'; r[idx['DedupKey'] - 1] = k;
    r[idx['DocId'] - 1] = k.split('|')[1] || ''; r[idx['Target'] - 1] = k.split('|')[3] || '';
    r[idx['Status'] - 1] = 'GROUPED'; r[idx['CreatedAt'] - 1] = stamp; r[idx['Title'] - 1] = 'รวมอยู่ในการ์ดสรุป SLA';
    return r;
  });
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, width).setValues(rows);
}
/** ทุกเช้าวันทำการ: สรุปงานค้าง 1 การ์ดต่อกลุ่มต่อวัน (ไม่มีงาน = ไม่ส่ง) */
function larkDailyDigest(opts) { return larkWithLock_(function () { return larkDailyDigest_(opts); }); }
function larkDailyDigest_(opts) {
  var props = larkProps_(); if (larkMode_(props) === 'off') return { mode:'off' };
  // trigger ส่ง event object มา (ไม่มี nowMs) → ใช้เวลาจริง · opts.nowMs ใช้เฉพาะเทสต์
  var now = (opts && typeof opts.nowMs === 'number') ? opts.nowMs : Date.now(), wd = new Date(now + 7 * 3600000).getUTCDay();
  if (wd === 0 || wd === 6) return { skipped:'weekend' };
  var rank = { over:2, watch:1, ok:0 }, work = larkOpenWork_(now), byGroup = {};
  work.forEach(function (w) { (byGroup[w.group] = byGroup[w.group] || []).push(w.info); });
  var items = Object.keys(byGroup).map(function (g) {
    var list = byGroup[g].sort(function (a, b) { return (rank[b.level] - rank[a.level]) || ((b.waitingDays || 0) - (a.waitingDays || 0)); });
    var counts = { total:list.length, over:list.filter(function (x) { return x.level === 'over'; }).length,
                   watch:list.filter(function (x) { return x.level === 'watch'; }).length };
    return { event:'DAILY_DIGEST', info:{ id:'', items:list, counts:counts }, targets:[g] };
  });
  return larkEnqueueMany_(items);
}

/* ============================================================ ADMIN TOOLS (รันจาก Editor) */
/** ติดตั้ง trigger: ส่งคิวทุก 5 นาที · ตรวจ SLA ทุกชั่วโมง · สรุปทุกเช้า 08:30 (รันซ้ำได้ ไม่ซ้อน) */
function larkInstallTriggers() {
  var names = ['larkFlush', 'larkSlaScan', 'larkDailyDigest'];
  ScriptApp.getProjectTriggers().forEach(function (t) { if (names.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('larkFlush').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('larkSlaScan').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('larkDailyDigest').timeBased().atHour(8).nearMinute(30).everyDays(1).inTimezone(TZ).create();
  Logger.log('ติดตั้ง trigger แล้ว · โหมดตอนนี้ = %s (dryrun = ไม่ส่งจริง)', larkMode_());
}
/** ตรวจการตั้งค่า Lark (ไม่แสดง secret) */
function larkCheckConfig() {
  var c = larkValidateConfig_();
  Logger.log(JSON.stringify(c, null, 2));
  return c;
}
/**
 * ทดสอบแบบไม่ส่งจริง: สร้างการ์ดของทุก event จากข้อมูลตัวอย่าง แล้วพิมพ์ payload ที่จะส่ง (Logger)
 * ไม่เขียนชีท ไม่เรียก HTTP — รันได้ปลอดภัยทุกเวลา
 */
function larkDryRunDemo() {
  var appUrl = larkAppUrl_(larkProps_()) || 'https://script.google.com/macros/s/APP/exec', out = [];
  var qt = { id:'Q-DEMO', docNo:'QT-IN-2610-007', docType:'QT', title:'Thaibev Solar Rooftop 1MW', customer:'Thai Beverage PCL',
             sales:'BOSS', currency:'USD', value:128450.5, gp:18.6, round:2, by:'Chatraporn' };
  var sr = { id:'SR-DEMO', docNo:'SR-2610-003', docType:'SR', title:'Factory Rooftop', customer:'CP Group', sales:'BOSS', lines:4, by:'BOSS', needBy:'2026-10-20' };
  var items = [
    { info:{ id:'Q1', docNo:'QT-IN-2610-001', title:'PTT EV Station', label:'รอผู้จัดการอนุมัติ', level:'over', waitingDays:4 } },
    { info:{ id:'Q2', docNo:'QT-IN-2610-004', title:'SCG Warehouse', label:'รอผู้จัดการอนุมัติ', level:'watch', waitingDays:2 } }
  ].map(function (x) { return x.info; });
  var demo = [
    ['SR_SUBMITTED', sr, 'SOURCING'], ['QT_SUBMITTED', qt, 'APPROVERS'], ['QT_APPROVED', qt, 'SOURCING'], ['QT_APPROVED', qt, 'RELEASE'],
    ['QT_RETURNED', Object.assign({}, qt, { note:'ส่งกลับให้ Sourcing แก้ราคา — ต้องขออนุมัติใหม่ทั้งสองฝ่าย' }), 'SOURCING'],
    ['PRICE_RELEASED', qt, 'SALES'], ['SR_SUBMITTED', sr, 'REQUESTS'], ['SLA_BREACH', { items:items.slice(0, 1) }, 'APPROVERS'],
    ['DAILY_DIGEST', { items:items, counts:{ total:2, over:1, watch:1 } }, 'APPROVERS']
  ];
  demo.forEach(function (d) {
    var m = larkBuild_(d[0], d[1], d[2], appUrl);
    out.push({ event:d[0], target:d[2], title:m.title,
               botRequest:{ url:'POST /open-apis/im/v1/messages?receive_id_type=chat_id',
                            body:{ receive_id:'oc_<' + (LARK_GROUPS[d[2]] || {}).prop + '>', msg_type:'interactive',
                                   content:'JSON.stringify(card) — ดู card ด้านล่าง', uuid:'<Id ของแถวในแท็บ NotifyQueue>' } },
               card:m.card,
               webhookText:m.text });
  });
  Logger.log(JSON.stringify(out, null, 2));
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
