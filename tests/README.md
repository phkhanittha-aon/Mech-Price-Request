# tests/ — ทดสอบบนเครื่องเท่านั้น ⚠️ ห้ามคัดลอกขึ้น Apps Script

| ไฟล์ | ทดสอบอะไร | คำสั่ง |
|---|---|---|
| `gasmock.js` | Google Sheets / Apps Script จำลอง (ใช้รัน Code.gs ตัวจริงบนเครื่อง) | — |
| `test_backend.js` | RBAC, visibility ทุกสถานะ, อนุมัติ 2 ฝ่ายพร้อมกัน, conflict 409 | `node tests/test_backend.js Code.gs` |
| `test_v42.js` | ล็อกอินอีเมล, Google SSO, Sales Manager, เลข SR, salesview | `node tests/test_v42.js Code.gs` |
| `test_v43.js` | ผู้รับผิดชอบ + SLA (Phase 1), รหัสผ่าน v2 / ล็อก, valueTHB | `node tests/test_v43.js Code.gs` |
| `test_v44.js` | Login: Google/อีเมล, role สดทุก request, หมดอายุ, ปลดล็อก, ลิงก์เดียว | `node tests/test_v44.js Code.gs` |
| `test_v46.js` | Phase 4: อ่านตัวเลขแบบป้องกัน, FX before/after, MGS.fmt, MasterData, price gate, ถ้อยคำ | `node tests/test_v46.js $PWD` |
| `e2e_v46.js` | Phase 4 ในเบราว์เซอร์: ช่องเงิน, margin สด, “อื่น ๆ (ระบุ)”, ตั้งค่า Dropdown, ไฮไลต์ 3 ระดับ | `NODE_PATH=$(npm root -g) node tests/e2e_v46.js $PWD /tmp` |
| `test_v47.js` | Phase 5 Lark: event table, config, hooks, dedup, dry-run ไม่มี HTTP, live จำลอง/retry, webhook, SLA, digest, price gate | `node tests/test_v47.js $PWD docs` |
| `e2e_v47.js` | ลิงก์ `?doc=` จากการ์ด Lark ในทั้งสองแอป | `NODE_PATH=$(npm root -g) node tests/e2e_v47.js $PWD` |
| `gas_shim.js` | จำลอง google.script.run ในเบราว์เซอร์ (ใช้กับ e2e_login) | — |
| `e2e_login.js` | Login ทั้งสองเส้นทาง + ยืนยันตัวตนต่อโดยไม่เสียงาน | `NODE_PATH=$(npm root -g) node tests/e2e_login.js $PWD /tmp` |
| `fx_test.js` | ตาราง FX ก่อน/หลัง + เคส CNY | `NODE_PATH=$(npm root -g) node tests/fx_test.js` |
| `e2e.js` | ระบบทำราคาในเบราว์เซอร์ หลายผู้ใช้พร้อมกัน | `NODE_PATH=$(npm root -g) node tests/e2e.js $PWD/Index.html $PWD/Code.gs /tmp` |
| `e2e_sales.js` | แอป Sales + Sourcing รับงาน + จัดการผู้ใช้ | `NODE_PATH=$(npm root -g) node tests/e2e_sales.js $PWD /tmp` |
| `audit_roles.js` | เดินทุกเมนูทุก role + วัด layout | `NODE_PATH=$(npm root -g) node tests/audit_roles.js $PWD /tmp` |
| `layout_audit.js` | Phase 3: เลื่อนซ้ายขวา / ฟอร์มตรงแนว / หัวตารางติด / แผ่นแก้ไขมือถือ ทุกจอ | `NODE_PATH=$(npm root -g) node tests/layout_audit.js $PWD /tmp` |

ต้องมี Node 18+ และ Playwright (Chromium) สำหรับไฟล์ที่ใช้เบราว์เซอร์
