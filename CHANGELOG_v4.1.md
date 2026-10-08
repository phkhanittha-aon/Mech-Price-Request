# MGS Project Pricing — v4.1 (RBAC fix + Live Sync + UX)

ไฟล์ที่ใช้งานจริง: `Code.gs` (Apps Script backend) และ `Index.html` (ระบบทำราคา)
`Sales.html` ใช้ต่อได้โดยไม่ต้องแก้ เพราะ API เดิมยังเหมือนเดิมทุกตัว

## วิธีติดตั้ง
1. วาง `Code.gs` ทับของเดิม (ไม่ต้องรัน `setup()` ใหม่ เพราะ schema ไม่เปลี่ยน)
2. วาง `Index.html` ทับไฟล์ HTML ชื่อ **Index**
3. Deploy → Manage deployments → ✏️ → Version: **New version** → Deploy
4. ตรวจ: หน้า Login มุมล่างต้องขึ้น `build 4.1`

> ถ้าอัปเดตแค่ HTML แต่ยังไม่อัปเดต Code.gs ระบบยังทำงานได้ โดยถอยไปใช้โหมดเดิม
> (ดึงทั้งชุดทุก 2 นาที และอนุมัติแบบ local) แต่ conflict guard กับ atomic approve จะยังไม่ทำงาน

---

## 1. Visibility / RBAC: สาเหตุที่ผู้จัดการไม่เห็นราคา

| # | สาเหตุจริงที่เจอในโค้ด | แก้ที่ |
|---|---|---|
| 1 | Role ในแท็บ Users ที่สะกดต่างจากชื่อมาตรฐาน เช่น `BD Manager` หรือ `procurement mgr ` (มีช่องว่างท้าย) ถูกโยนไปเป็น **SALES** ทั้งหมด จึงถูกตัด Cost/GP/Detail ออก (ยืนยันแล้วด้วยการทดสอบกับ Code.gs เดิม) | `normRole_()` / `ROLE_ALIASES` ใน Code.gs และ `normRole()` ใน Index.html |
| 2 | `ROLE_PERMS` ฝั่ง client ไม่มี `Admin` ทำให้ `perms()` คืน `{}` และ Admin ไม่เห็นราคาหรือเมนูผู้จัดการ | `ROLE_PERMS` ใน Index.html |
| 3 | หน้า Preview: Sourcing ถูกล็อกเป็นเวอร์ชันลูกค้าทันทีที่ใบอนุมัติ และเงื่อนไขยังอ้าง stage ชุดเก่า (Sent/Done) | `viewPreview()` → `canInternal = canSeeCost(CURRENT)` |
| 4 | เงื่อนไขกระจายหลายที่ (`viewCost`, `p.margin\|\|p.create`, `isSalesManager`, `final`) อ่านแล้วงง | รวมเหลือกฎเดียว: `seesFullData_()` / `projectRow_()` (server) และ `canSeeCost()` / `canSeePrice()` (client) |

**กฎใหม่ (server กับ client ตรงกันทุกข้อ)**
- **GM / Admin / Procurement Mgr / BD Mgr / Sourcing** เห็นข้อมูลเต็ม (Detail, Cost, Profit, GP) ทุกใบ ทุกสถานะ และไม่มีการ strip
- **Sales** ไม่ได้รับ Detail, Cost หรือ GP เลย ได้เฉพาะ `SalesDetail` และเฉพาะสถานะ `Approved / Pending / Won / Closed`
  ซึ่งต้องถูกปล่อยราคาให้แล้ว หรือเป็นผู้ปล่อยราคา (NON / delegate) ที่ต้องเห็นราคาก่อนจึงจะปล่อยได้
  นอกจากนี้ `SalesDetail` จะผ่าน `stripCost_()` ซ้ำอีกชั้นก่อนส่งออก (`salesSafe_()`)

## 2. Real-time / Sync

| ปัญหา | แก้ด้วย |
|---|---|
| ข้อมูลเก่าค้างจอจนกว่าจะกดซิงค์ | `pollChanges()` ทำงานทุก 30 วินาทีในหน้า Dashboard และสรุปทีมขาย โดยดึงเฉพาะแถวที่เปลี่ยน (`type=changes&since=`) และหยุดเองเมื่อแท็บถูกซ่อน |
| เปิดดูหรือแก้ใบแล้วเห็นของเก่า | `openQuote()` / `editQuote()` แสดงข้อมูลในเครื่องทันที แล้วเรียก `refreshQuote(id)` (`type=quote&id=`) เบื้องหลัง ถ้า Cloud ใหม่กว่าจะวาดจอใหม่ |
| แก้ทับกันเงียบ ๆ | Optimistic lock: client ส่ง `baseUpdatedAt` ถ้า Sheet ใหม่กว่า server ตอบ **409 CONFLICT** และไม่เขียนทับ ส่วนหน้าแก้ไขจะตรวจทุก 30 วินาทีและขึ้นแถบเตือน |
| Procurement กับ BD กดอนุมัติพร้อมกันแล้วการอนุมัติของฝ่ายหนึ่งหายไป | action `approve` ใหม่ฝั่ง server ทำงานแบบ atomic ใต้ ScriptLock |
| **บั๊ก sync crash ทั้งรอบ (1)**: ใบที่ถูกลบบน Cloud แต่ไม่มีในเครื่อง ทำให้โค้ดอ่าน `QUOTES[-1]` แล้ว exception จนไม่มีใบไหนถูกอัปเดตเลย | `mergeRemoteRow()` |
| **บั๊ก sync crash ทั้งรอบ (2)**: Detail ที่ใหญ่เกิน cell (`_oversize`) ทำให้ `migrateQuote()` พัง | `remoteFromRow()` ข้ามเฉพาะใบนั้น |
| **บั๊กข้อมูลหาย**: token ถูกเขียนลงใน payload ที่อยู่ในคิว พอเซสชันหมดอายุ รายการในคิวจะส่งซ้ำด้วย token เก่าจนครบ 12 ครั้งแล้วถูกทิ้ง | `_postCloud()` ใช้สำเนาของ payload และใส่ token ปัจจุบันเสมอ |
| เซสชันหมดอายุแบบเงียบ ๆ | `onAuthExpired()` แจ้งผู้ใช้และพาไปล็อกอินใหม่ โดยรายการในคิวยังอยู่ |
| ออฟไลน์แล้วบันทึกใบเดียวกันหลายครั้ง จนครั้งที่ 2 ชน conflict | `flushQueue()` ส่งเฉพาะการบันทึกครั้งล่าสุดของแต่ละใบ |

## 3. UX/UI
- **ตารางทำราคา** (`refreshLines()`) แบ่งเป็น 4 โซนด้วยสีหัวตารางและเส้นแบ่งแนวตั้ง:
  ① ข้อมูลสินค้า, ② ต้นทุน (เพิ่มคอลัมน์ Landed/ชิ้น), ③ มาร์จิ้น (เพิ่มคอลัมน์กำไร/ชิ้น), ④ ราคาขาย
- **Live summary bar** (`renderLiveBar()`) ติดขอบล่างของหน้าทำราคา แสดงยอดขายรวม, ต้นทุนรวม, GP และ %GP (มีสีตามเกณฑ์) และอัปเดตทุกครั้งที่พิมพ์
- **Dashboard** (`viewDashboard()` / `approvalCard()`) มีการ์ด "รออนุมัติราคา" ที่แสดง %GP ตัวใหญ่ ป้าย "⏳ รอฝั่ง Procurement/BD อนุมัติ" และปุ่มอนุมัติบนการ์ด
- **Kanban** (`kanbanCard()`) แสดง %GP ตัวใหญ่และป้ายอนุมัติ 2 ฝ่าย ส่วนใบที่รอคุณอนุมัติจะมีขอบสีเหลือง
- **Preview** โหมดภายในแสดงต้นทุน/หน่วย, %GP และกำไร/หน่วยรายบรรทัด
- สถานะแสดงเป็นภาษาไทย (`STATUS_TH`) ทุกจุด และใบที่เพิ่งเปลี่ยนจาก Cloud จะกะพริบให้เห็น
- มือถือ: grid หลายคอลัมน์ยุบเป็นคอลัมน์เดียว ทำให้ทั้งหน้าไม่ล้นแนวนอนอีก

## 4. Status migration refactor
- รวมจุดแปลงสถานะไว้ที่ `LEGACY_STATUS_MAP`, `normalizeQTStatus()`, `statusFromLegacyStage()` และ `migrateStatusV3()`
- ลบโค้ดที่ไม่มีที่ใช้แล้ว: `STATUSES`, `SALES_STATUSES`, `STATUS_V3_MAP` (ส่วนที่ map ชื่อไปหาตัวเอง), `migrateQTStatus()` และสี STATUS_TAG ของสถานะเก่า
- ผลลัพธ์ของการ migrate ไม่เปลี่ยน: ผ่าน self-test 6/6 และการทดสอบ map สถานะเก่าทุกชื่อ

## การทดสอบที่รันแล้ว
- Backend: รัน Code.gs ตัวจริงบน Google Sheets จำลอง ครอบคลุม login ทุก role, visibility ทุกสถานะ, dual approval แบบ concurrent, 409 conflict, changes/since, การปล่อยราคา, salesPatch และ SalesDetail sanitize
- E2E: เปิด Index.html ใน Chromium หลายผู้ใช้พร้อมกัน ทดสอบ auto-poll 30 วินาที, ป้ายอนุมัติ, conflict banner/modal, live bar, การเห็นราคาของ Admin และ Sourcing และ self-test
