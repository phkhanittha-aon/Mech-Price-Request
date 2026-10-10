#!/usr/bin/env bash
# Phase 6 — รันเทสต์ทั้งหมดแล้วสรุปตามหัวข้อตรวจสอบ   รัน: bash tests/run_all.sh [โฟลเดอร์เก็บผล]
# ทดสอบบนเครื่องเท่านั้น — ห้ามคัดลอกไฟล์ในโฟลเดอร์ tests/ ขึ้น Apps Script
set -u
cd "$(dirname "$0")/.."
ROOT="$PWD"; OUT="${1:-$(mktemp -d)}"; mkdir -p "$OUT"
export NODE_PATH="${NODE_PATH:-$(npm root -g)}"
declare -a NAMES RESULTS
run() {   # run "หัวข้อ" "ชื่อเทสต์" คำสั่ง…
  local topic="$1" name="$2"; shift 2
  local log="$OUT/${name//[^A-Za-z0-9_]/_}.log" t0=$SECONDS
  if "$@" > "$log" 2>&1; then st="PASS"; else st="FAIL"; fi
  local n_pass n_fail; n_pass=$(grep -c '^PASS' "$log"); n_fail=$(grep -c '^FAIL\|PAGEERROR' "$log")
  NAMES+=("$topic|$name"); RESULTS+=("$st|$n_pass|$n_fail|$((SECONDS - t0))s|$log")
  printf '%-4s  %-34s %-26s %4s ok %3s fail  %s\n' "$st" "$topic" "$name" "$n_pass" "$n_fail" "$((SECONDS - t0))s"
}
echo "MGS Pricing — Phase 6 verification · $(date '+%Y-%m-%d %H:%M') · $(git rev-parse --short HEAD 2>/dev/null)"
echo "logs: $OUT"; echo
run "1 Smoke ทุก role / สิทธิ์ / projection" "smoke_roles"        node tests/smoke_roles.js "$ROOT"
run "1 Smoke ทุก role / สิทธิ์ / projection" "test_backend"       node tests/test_backend.js Code.gs
run "1 Smoke ทุก role / สิทธิ์ / projection" "audit_roles(browser)" node tests/audit_roles.js "$ROOT" "$OUT"
run "1 Smoke ทุก role / สิทธิ์ / projection" "e2e (หลายผู้ใช้)"       node tests/e2e.js "$ROOT/Index.html" "$ROOT/Code.gs" "$OUT"
run "1 Smoke ทุก role / สิทธิ์ / projection" "e2e_sales"          node tests/e2e_sales.js "$ROOT" "$OUT"
run "2 Follow-up (งานค้างอยู่ที่ใคร)"       "test_v43"           node tests/test_v43.js Code.gs
run "3 Login สองเส้นทาง"                  "test_v42"           node tests/test_v42.js Code.gs
run "3 Login สองเส้นทาง"                  "test_v44"           node tests/test_v44.js Code.gs
run "3 Login สองเส้นทาง"                  "e2e_login(browser)" node tests/e2e_login.js "$ROOT" "$OUT"
run "4 FX before/after (รวม CNY)"         "fx_test"            node tests/fx_test.js
run "4+5 FX / ตัวเงิน / MasterData"        "test_v46"           node tests/test_v46.js "$ROOT"
run "5 ตัวเงิน (หน้าจอจริง)"                "e2e_v46(browser)"   node tests/e2e_v46.js "$ROOT" "$OUT"
run "6 Blob hash ก่อน/หลัง"                 "blob_hash"          node tests/blob_hash.js "$ROOT"
run "7 localStorage + ชีทจาก production"   "compat_production"  node tests/compat_production.js "$ROOT"
run "· Lark (dry-run)"                    "test_v47"           node tests/test_v47.js "$ROOT"
run "· Lark ลิงก์เปิดเอกสาร"                 "e2e_v47(browser)"   node tests/e2e_v47.js "$ROOT"
run "· Layout ทุกหน้า ทุกจอ"                 "layout_audit"       node tests/layout_audit.js "$ROOT" "$OUT"
# audit_roles เป็นตัวเดินทุกเมนูทุก role (ไม่พิมพ์ PASS) → ตกถ้ามี JavaScript error ในหน้าใดหน้าหนึ่ง
for i in "${!NAMES[@]}"; do if [[ "${NAMES[$i]}" == *"audit_roles"* ]]; then IFS='|' read -r _ _ _ _ alog <<< "${RESULTS[$i]}";
  if grep -q '^   errors: [^n]' "$alog" || ! grep -q '^   errors: none' "$alog"; then RESULTS[$i]="FAIL|0|1|-|$alog"; echo "      audit_roles: พบ error ในหน้าจอ → FAIL"; fi; fi; done
# layout_audit ไม่มีบรรทัด PASS/FAIL → ถือว่าตกถ้าเจอปัญหา
if grep -q 'PAGE-HSCROLL\|misaligned\|NOT \|FAIL' "$OUT/layout_audit.log"; then RESULTS[${#RESULTS[@]}-1]="FAIL|0|$(grep -c 'PAGE-HSCROLL\|misaligned\|NOT \|FAIL' "$OUT/layout_audit.log")|-|$OUT/layout_audit.log"; echo "      layout_audit: พบปัญหา layout → FAIL"; fi
echo
total_ok=0; total_fail=0; bad=0
for i in "${!RESULTS[@]}"; do IFS='|' read -r st p f _ log <<< "${RESULTS[$i]}"; total_ok=$((total_ok + p)); total_fail=$((total_fail + f)); [ "$st" = "PASS" ] || bad=$((bad + 1)); done
echo "สรุป: ${#RESULTS[@]} ชุดเทสต์ · ผ่าน $((${#RESULTS[@]} - bad)) ชุด · ตก $bad ชุด · assertion ผ่าน $total_ok ข้อ · ตก $total_fail ข้อ"
[ "$bad" -eq 0 ] && echo "ALL PHASE 6 CHECKS PASSED" || { echo "PHASE 6 FAILED — ดู log ด้านบน"; exit 1; }
