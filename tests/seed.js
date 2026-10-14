// v5.9 — ใส่แถวตรงลงชีทจำลอง = ข้อมูลที่ "มีอยู่แล้วในชีท" (ใบที่อนุมัติ / ปล่อยราคาไปแล้ว หรือข้อมูลรุ่นเก่า)
// ตั้งแต่ v5.9 action save ตั้งสถานะ Partial Approved / Approved / Pending เองไม่ได้ (ต้องผ่าน approve / release ที่ server)
// เทสต์ที่ต้องการใบสถานะเหล่านี้เป็น "ข้อมูลตั้งต้น" จึงใช้ตัวนี้แทนการเรียก save — รับ payload รูปแบบเดียวกับ action save
// ทดสอบบนเครื่องเท่านั้น ห้าม deploy
function seedSave(sheets, p) {
  const QS = sheets['Quotations'];
  if (!QS || !QS.rows.length) throw new Error('seedSave: ยังไม่มีแท็บ Quotations (เรียก login / setup ก่อน)');
  const h = QS.rows[0];
  const num = (v, d) => (v === undefined || v === null || v === '' || isNaN(Number(v)) ? d : Number(v));
  const now = new Date().toISOString();
  const vals = {
    Id: p.id, DocType: p.docType || 'QT', DocNo: p.docNo || '', Ref: p.ref || '',
    Title: p.title || '', Customer: p.customer || '', Sales: p.sales || '',
    SalesUserId: p.salesUserId || '', AssignedTo: p.assignedTo || '',
    Group: p.group || '', Round: num(p.round, 1), Currency: p.currency || '',
    Incoterm: p.incoterm || '', PriceTerm: p.priceTerm || '', Exrate: num(p.exrate, 0),
    OfferDate: p.offerDate || '', Stage: p.stage || '', Status: p.status || '',
    FollowStatus: p.followStatus || '', NeedsApproval: p.needsApproval ? 'TRUE' : '',
    ReleasedTo: p.releasedTo || '', SalesNote: p.salesNote || '',
    Lines: num(p.lines, 0), Total: num(p.total, 0), Cost: num(p.cost, 0), Profit: num(p.profit, 0), GP: num(p.gp, 0),
    Updated: p.updated || now.slice(0, 10), UpdatedAt: p.updatedAt || now, By: p.by || 'seed',
    Detail: p.detail || '', SalesDetail: p.salesDetail || ''
  };
  let row = QS.rows.find((r, i) => i > 0 && r[h.indexOf('Id')] === p.id);
  if (!row) { row = new Array(h.length).fill(''); QS.rows.push(row); }
  Object.keys(vals).forEach(k => { const c = h.indexOf(k); if (c >= 0) row[c] = vals[k]; });
  return { ok: true, id: p.id, seeded: true };
}
module.exports = { seedSave };
