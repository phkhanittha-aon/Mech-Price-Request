// Minimal in-memory Google Apps Script runtime for testing Code.gs
const fs = require('fs'), vm = require('vm'), crypto = require('crypto');

function makeRuntime(codePath) {
  const sheets = {};
  function Sheet(name) { this.name = name; this.rows = []; }
  Sheet.prototype.getLastRow = function () { return this.rows.length; };
  Sheet.prototype.getLastColumn = function () { return this.rows.reduce((m, r) => Math.max(m, r.length), 0); };
  Sheet.prototype.getRange = function (r, c, nr, nc) {
    const sh = this; nr = nr || 1; nc = nc || 1;
    return {
      getValues() { const out = []; for (let i = 0; i < nr; i++) { const row = sh.rows[r - 1 + i] || []; const o = []; for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]); out.push(o); } return out; },
      setValues(v) { for (let i = 0; i < nr; i++) { while (sh.rows.length < r + i) sh.rows.push([]); const row = sh.rows[r - 1 + i]; for (let j = 0; j < nc; j++) row[c - 1 + j] = v[i][j]; } return this; },
      getValue() { return this.getValues()[0][0]; },
      setValue(v) { return this.setValues([[v]]); },
      setFontWeight() { return this; }, setBackground() { return this; }
    };
  };
  Sheet.prototype.setFrozenRows = function () {};
  Sheet.prototype.setName = function (n) { this.name = n; };
  Sheet.prototype.deleteRow = function (r) { this.rows.splice(r - 1, 1); };
  Sheet.prototype.deleteRows = function (r, n) { this.rows.splice(r - 1, n); };
  Sheet.prototype.appendRow = function (a) { this.rows.push(a.slice()); };
  const cacheStore = {}, props = {}, fetchLog = [], triggers = [];
  // ตอบแทน Lark API: ค่าเริ่มต้น = สำเร็จ · เทสต์เปลี่ยนพฤติกรรมได้ผ่าน globalThis.__LARK_REPLY(url, opts) → {code, body}
  const fakeResp = (url, o) => { const r = (globalThis.__LARK_REPLY || (u => /tenant_access_token/.test(u) ? { code: 200, body: { code: 0, tenant_access_token: 't-xyz', expire: 7200 } } : { code: 200, body: { code: 0, msg: 'success' } }))(url, o);
    return { getResponseCode: () => r.code, getContentText: () => JSON.stringify(r.body) }; };
  const cache = { get: k => (k in cacheStore ? cacheStore[k] : null), put: (k, v) => { cacheStore[k] = String(v); }, remove: k => { delete cacheStore[k]; },
    getAll: ks => { const o = {}; ks.forEach(k => { if (k in cacheStore) o[k] = cacheStore[k]; }); return o; } };
  const ss = { getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = new Sheet(n)), getId: () => 'x', getName: () => 'MGS Pricing DB', toast() {} };
  // v5.1: ไฟล์ Google Sheet อื่น (exportPendingFile / importUploadFile) + DriveApp (สำรองไฟล์) — เก็บในหน่วยความจำ
  const files = { x: ss }, driveLog = [];
  const makeSS = (name) => { const id = 'F' + crypto.randomBytes(12).toString('hex'), own = {};
    const o = { id, name, sheets: own, getId: () => id, getName: () => name, getUrl: () => 'https://docs.google.com/spreadsheets/d/' + id + '/edit',
      getSheetByName: n => Object.values(own).find(x => x.name === n) || null,
      insertSheet: n => { const x = new Sheet(n); own[n + '#' + Object.keys(own).length] = x; return x; },
      getSheets: () => Object.values(own), toast() {} };
    o.insertSheet('Sheet1'); files[id] = o; return o; };
  const driveFile = id => ({ getName: () => (files[id] ? files[id].getName() : id), getParents: () => ({ hasNext: () => false }),
    makeCopy: (name) => { driveLog.push({ op: 'copy', id, name }); return {}; }, moveTo: () => { driveLog.push({ op: 'move', id }); } });
  const ctx = {
    SpreadsheetApp: { getActive: () => ss, openById: id => { if (files[id]) return files[id]; throw new Error('Exception: Unexpected error while getting the method or property openById'); }, create: name => makeSS(name) },
    // ล็อกเดียวต่อ execution (เหมือน Apps Script): hasLock บอกว่าถืออยู่แล้วหรือยัง
    LockService: (() => { let held = false; const L = { waitLock() { held = true; }, tryLock() { held = true; return true; }, hasLock() { return held; }, releaseLock() { held = false; } }; return { getScriptLock: () => L }; })(),
    Utilities: { getUuid: () => crypto.randomUUID(),
      // formatDate ตามเวลาไทย (UTC+7) เหมือน Apps Script ที่ตั้ง TZ = Asia/Bangkok
      formatDate: (d, tz, f) => { const t = new Date(d.getTime() + 7 * 3600000).toISOString(); return f === 'yyMM' ? t.slice(2, 4) + t.slice(5, 7) : t.slice(0, 10); },
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, str) => Array.from(crypto.createHash('sha256').update(String(str), 'utf8').digest()).map(b => b > 127 ? b - 256 : b),
      computeHmacSha256Signature: (value, key) => Array.from(crypto.createHmac('sha256', String(key)).update(String(value), 'utf8').digest()).map(b => b > 127 ? b - 256 : b),
      base64Encode: bytes => Buffer.from(bytes.map(b => (b + 256) % 256)).toString('base64') },
    // v4.7 Lark: Script Properties / UrlFetchApp (บันทึกทุกคำขอ — เทสต์ dry-run ต้องไม่มีคำขอเลย) / ScriptApp
    PropertiesService: { getScriptProperties: () => ({ getProperties: () => Object.assign({}, props), getProperty: k => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; } }) },
    UrlFetchApp: {
      fetch: (url, o) => { fetchLog.push({ url, o }); return fakeResp(url, o); },
      fetchAll: reqs => reqs.map(r => { fetchLog.push({ url: r.url, o: r }); return fakeResp(r.url, r); }) },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST/exec' }), getProjectTriggers: () => triggers.slice(),
      deleteTrigger: t => { const i = triggers.indexOf(t); if (i >= 0) triggers.splice(i, 1); },
      newTrigger: fn => { const b = { timeBased: () => b, everyMinutes: () => b, everyHours: () => b, atHour: () => b, nearMinute: () => b, everyDays: () => b, inTimezone: () => b,
        create: () => { const t = { getHandlerFunction: () => fn }; triggers.push(t); return t; } }; return b; } },
    CacheService: { getScriptCache: () => cache },
    Logger: { log() {} }, Session: { getActiveUser: () => ({ getEmail: () => (globalThis.__SSO_EMAIL || '') }),
               getEffectiveUser: () => ({ getEmail: () => (globalThis.__EFFECTIVE_EMAIL || 'owner@mglobalsourcing.net') }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ setMimeType() { return { text: t }; } }) },
    HtmlService: {   // พอสำหรับทดสอบว่า doGet เลือกไฟล์ไหน
      XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
      createHtmlOutputFromFile: name => { const o = { file: name, setTitle() { return o; }, addMetaTag() { return o; }, setXFrameOptionsMode() { return o; }, getContent: () => '' }; return o; },
      createHtmlOutput: h => { const o = { html: h, setTitle() { return o; } }; return o; } },
    DriveApp: { getFileById: id => driveFile(id), getRootFolder: () => ({}) }, console, globalThis, Date, JSON, Math, Object, String, Number, Array
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(codePath, 'utf8'), ctx);
  // v4.7: ไฟล์ .gs อื่นในโปรเจกต์เดียวกัน (Lark.gs) — Apps Script โหลดทุกไฟล์เข้า scope เดียวกัน
  const lark = require('path').join(require('path').dirname(codePath), 'Lark.gs');
  if (fs.existsSync(lark) && !globalThis.__NO_LARK) vm.runInContext(fs.readFileSync(lark, 'utf8'), ctx);
  ctx.setup();
  return { ctx, sheets, props, fetchLog, triggers, files, driveLog };
}
module.exports = { makeRuntime };
// หมายเหตุ: ไฟล์ในโฟลเดอร์ tests/ ใช้ทดสอบบนเครื่องเท่านั้น — ห้ามคัดลอกขึ้น Apps Script
