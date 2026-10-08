#!/usr/bin/env python3
"""คัดลอกแคตตาล็อกสินค้า + โลโก้ จาก Index.html ไปใส่ Sales.html

ใช้เมื่อแก้ CATALOG ใน Index.html แล้วอยากให้ช่องค้นหาสินค้าของแอป Sales เห็นของใหม่ด้วย
    python3 tools/sync_sales_catalog.py

ส่งออกเฉพาะ รหัส / ชื่อ / กลุ่ม / หน่วย — ไม่มี duty, supplier หรือราคาใด ๆ (Sales ห้ามเห็นข้อมูลต้นทุน)
"""
import json, re, sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
index = (root / 'Index.html').read_text(encoding='utf-8')
sales_path = root / 'Sales.html'
sales = sales_path.read_text(encoding='utf-8')

m = re.search(r'^const CATALOG = (\{.*\});\s*$', index, re.M)
if not m:
    sys.exit('ไม่พบ const CATALOG ใน Index.html')
catalog = json.loads(m.group(1))
lite, seen = [], set()
for p in catalog.get('products', []):
    code = str(p.get('code') or '').strip()
    if not code or code in seen:
        continue
    seen.add(code)
    lite.append([code, str(p.get('desc') or '').strip(), str(p.get('group') or ''), str(p.get('uom') or '')])

lm = re.search(r'^const LOGO = ("data:image/[^"]+");\s*$', index, re.M)
logo = lm.group(1) if lm else "''"

def put(text, tag, value):
    pat = re.compile(r'/\*' + tag + r'\*/.*?/\*END_' + tag + r'\*/', re.S)
    if not pat.search(text):
        sys.exit('ไม่พบ marker /*' + tag + '*/ ใน Sales.html')
    return pat.sub(lambda _: '/*' + tag + '*/' + value + '/*END_' + tag + '*/', text, count=1)

sales = put(sales, 'CATALOG', json.dumps(lite, ensure_ascii=False, separators=(',', ':')))
sales = put(sales, 'LOGO', logo)
sales_path.write_text(sales, encoding='utf-8')
print(f'Sales.html: {len(lite)} สินค้า · โลโก้ {"✓" if lm else "ไม่พบ"}')
