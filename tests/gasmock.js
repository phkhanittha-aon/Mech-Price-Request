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
  Sheet.prototype.deleteRow = function (r) { this.rows.splice(r - 1, 1); };
  Sheet.prototype.deleteRows = function (r, n) { this.rows.splice(r - 1, n); };
  Sheet.prototype.appendRow = function (a) { this.rows.push(a.slice()); };
  const cacheStore = {};
  const cache = { get: k => (k in cacheStore ? cacheStore[k] : null), put: (k, v) => { cacheStore[k] = String(v); }, remove: k => { delete cacheStore[k]; } };
  const ss = { getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = new Sheet(n)), getId: () => 'x', toast() {} };
  const ctx = {
    SpreadsheetApp: { getActive: () => ss, openById: () => ss },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { getUuid: () => crypto.randomUUID(),
      // formatDate ตามเวลาไทย (UTC+7) เหมือน Apps Script ที่ตั้ง TZ = Asia/Bangkok
      formatDate: (d, tz, f) => { const t = new Date(d.getTime() + 7 * 3600000).toISOString(); return f === 'yyMM' ? t.slice(2, 4) + t.slice(5, 7) : t.slice(0, 10); },
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, str) => Array.from(crypto.createHash('sha256').update(String(str), 'utf8').digest()).map(b => b > 127 ? b - 256 : b) },
    CacheService: { getScriptCache: () => cache },
    Logger: { log() {} }, Session: { getActiveUser: () => ({ getEmail: () => (globalThis.__SSO_EMAIL || '') }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ setMimeType() { return { text: t }; } }) },
    HtmlService: {}, DriveApp: {}, console, globalThis, Date, JSON, Math, Object, String, Number, Array
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(codePath, 'utf8'), ctx);
  ctx.setup();
  return { ctx, sheets };
}
module.exports = { makeRuntime };
// หมายเหตุ: ไฟล์ในโฟลเดอร์ tests/ ใช้ทดสอบบนเครื่องเท่านั้น — ห้ามคัดลอกขึ้น Apps Script
