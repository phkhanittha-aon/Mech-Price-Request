// Phase 6 — ตรวจ blob: hash CATALOG / LOGO / EXCEL_LEGACY_LINES "ก่อน" (production) และ "หลัง" (ไฟล์ปัจจุบัน) พิมพ์ทั้งสองค่า · ไม่ตรง = FAIL
// รัน: node tests/blob_hash.js $PWD [prod-ref]   (ทดสอบบนเครื่องเท่านั้น ห้าม deploy)
const fs = require('fs'), crypto = require('crypto'), cp = require('child_process');
const DIR = process.argv[2] || '.', REF = process.argv[3] || 'ec8c4ea';
let fails = 0;
const sha = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
/** ค่าของ blob ทั้งก้อน: ตั้งแต่ "const NAME=" ถึงท้ายบรรทัด (blob ทั้ง 3 ตัวอยู่ในบรรทัดเดียว) */
function blob(text, name) {
  const m = new RegExp('(?:const|let|var)\\s+' + name + '\\s*=').exec(text);
  if (!m) return null;
  const end = text.indexOf('\n', m.index);
  return text.slice(m.index, end < 0 ? undefined : end);
}
const before = cp.execSync('git show ' + REF + ':Index.html', { cwd: DIR, maxBuffer: 64 << 20 }).toString();
const after = fs.readFileSync(DIR + '/Index.html', 'utf8');
console.log('Index.html  ก่อน = ' + REF + ' (production)   หลัง = ไฟล์ปัจจุบัน\n');
console.log('blob'.padEnd(20) + 'ขนาด (ก่อน/หลัง)'.padEnd(22) + 'SHA-256 ก่อน'.padEnd(68) + 'SHA-256 หลัง');
['CATALOG', 'LOGO', 'EXCEL_LEGACY_LINES'].forEach(n => {
  const a = blob(before, n), b = blob(after, n);
  const ha = a ? sha(a) : '(ไม่พบ)', hb = b ? sha(b) : '(ไม่พบ)', same = !!a && a === b;
  console.log(n.padEnd(20) + ((a || '').length + ' / ' + (b || '').length).padEnd(22) + ha.padEnd(68) + hb + (same ? '   ✓ ตรงกัน' : '   ✗ ไม่ตรง'));
  if (!same) fails++;
});
// Sales.html: CATALOG_LITE / LOGO สร้างจาก Index ด้วย tools/sync_sales_catalog.py — ต้องตรงกับฉบับแรกที่สร้าง
const SREF = cp.execSync('git log --diff-filter=A --format=%h -- Sales.html', { cwd: DIR }).toString().trim().split('\n').pop();
const sb = cp.execSync('git show ' + SREF + ':Sales.html', { cwd: DIR, maxBuffer: 64 << 20 }).toString(), sa = fs.readFileSync(DIR + '/Sales.html', 'utf8');
const marker = (t, m) => { const i = t.indexOf(m); return i < 0 ? null : t.slice(i, t.indexOf('\n', i)); };
console.log('\nSales.html  ก่อน = ' + SREF + ' (ฉบับแรก)   หลัง = ไฟล์ปัจจุบัน');
[['CATALOG_LITE', '/*CATALOG*/'], ['LOGO', '/*LOGO*/']].forEach(([n, m]) => {
  const a = marker(sb, m), b = marker(sa, m), same = !!a && a === b;
  console.log(n.padEnd(20) + ((a || '').length + ' / ' + (b || '').length).padEnd(22) + (a ? sha(a) : '(ไม่พบ)').padEnd(68) + (b ? sha(b) : '(ไม่พบ)') + (same ? '   ✓ ตรงกัน' : '   ✗ ไม่ตรง'));
  if (!same) fails++;
});
console.log(fails ? '\n' + fails + ' BLOB MISMATCH — FAIL' : '\nALL BLOBS BYTE-IDENTICAL'); process.exit(fails ? 1 : 0);
