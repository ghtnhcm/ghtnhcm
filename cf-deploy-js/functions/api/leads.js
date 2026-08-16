import { eq, and, gte, lte, inArray, desc } from "drizzle-orm";
import { getDb } from "../../db/index.js";
import { leads, leadVisits } from "../../db/schema.js";

const MAX_NAME_LEN = 60;
const MAX_PHONE_LEN = 20;
const MAX_NOTE_LEN = 1000;
const MAX_ID_LEN = 64;

// Trạng thái hợp lệ trong phễu tuyển dụng — khớp với danh sách hiển thị ở
// giao diện. Giữ ở một chỗ để cả tạo mới và cập nhật (thêm lượt ghé) đều
// dùng chung, tránh lệch dữ liệu.
const VALID_STATUSES = [
  "chua_gap",
  "da_gap_chua_quan_tam",
  "quan_tam",
  "hen_phong_van",
  "da_tuyen",
  "tu_choi",
];

function isNonEmptyString(v, maxLen) {
  return typeof v === "string" && v.trim().length > 0 && v.trim().length <= maxLen;
}

function cleanOptionalString(v, maxLen) {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length ? trimmed.slice(0, maxLen) : null;
}

function parseOptionalDate(v) {
  if (v === undefined || v === null || v === "") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d; // undefined = invalid, khác null (không có)
}

export const onRequestGet = async ({ request, env }) => {
  const db = getDb(env.DATABASE_URL);
  const url = new URL(request.url);

  const rows = await db
    .select()
    .from(leads)
    .orderBy(desc(leads.updatedAt));

  const wantsHistory = url.searchParams.get("history") === "1";
  if (!wantsHistory) {
    return Response.json(rows);
  }

  // Kèm toàn bộ lịch sử ghé thăm của từng mối, dùng khi mở chi tiết 1 mối
  // (không cần cho danh sách/bản đồ thông thường nên để tùy chọn, đỡ tốn
  // truy vấn khi chỉ cần load nhanh các điểm trên bản đồ).
  const visits = await db
    .select()
    .from(leadVisits)
    .orderBy(desc(leadVisits.visitedAt));

  const visitsByLead = {};
  for (const v of visits) {
    (visitsByLead[v.leadId] ??= []).push(v);
  }

  return Response.json({ leads: rows, visits: visitsByLead });
};

export const onRequestPost = async ({ request, env }) => {
  const db = getDb(env.DATABASE_URL);

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { id, name, phone, lat, lng, status, note, nextVisitAt, createdBy } = body ?? {};

  const isValidId = typeof id === "string" && id.length > 0 && id.length <= MAX_ID_LEN;
  const isValidLat = typeof lat === "number" && Number.isFinite(lat) && lat >= -90 && lat <= 90;
  const isValidLng = typeof lng === "number" && Number.isFinite(lng) && lng >= -180 && lng <= 180;
  const isValidStatus = status === undefined || status === null || VALID_STATUSES.includes(status);

  if (!isValidId || !isValidLat || !isValidLng || !isValidStatus) {
    return Response.json({ error: "invalid payload" }, { status: 400 });
  }

  const parsedNextVisit = parseOptionalDate(nextVisitAt);
  if (parsedNextVisit === undefined) {
    return Response.json({ error: "invalid nextVisitAt" }, { status: 400 });
  }

  const now = new Date();
  const cleanStatus = status && VALID_STATUSES.includes(status) ? status : "chua_gap";

  await db
    .insert(leads)
    .values({
      id,
      name: cleanOptionalString(name, MAX_NAME_LEN),
      phone: cleanOptionalString(phone, MAX_PHONE_LEN),
      lat,
      lng,
      status: cleanStatus,
      note: cleanOptionalString(note, MAX_NOTE_LEN),
      nextVisitAt: parsedNextVisit,
      createdBy: cleanOptionalString(createdBy, MAX_NAME_LEN),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  // Lượt ghé đầu tiên = chính lúc tạo mối, để lịch sử luôn có ít nhất 1 dòng.
  await db.insert(leadVisits).values({
    leadId: id,
    status: cleanStatus,
    note: cleanOptionalString(note, MAX_NOTE_LEN),
    visitedBy: cleanOptionalString(createdBy, MAX_NAME_LEN),
    visitedAt: now,
  });

  return new Response(null, { status: 204 });
};

// Cập nhật 1 mối đã có + ghi thêm 1 lượt ghé thăm vào lịch sử (dùng khi quay
// lại 1 địa chỉ lần 2, lần 3...). Dùng PATCH vì đây là cập nhật một phần.
export const onRequestPatch = async ({ request, env }) => {
  const db = getDb(env.DATABASE_URL);

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { id, name, phone, status, note, nextVisitAt, visitedBy } = body ?? {};
  const isValidId = typeof id === "string" && id.length > 0 && id.length <= MAX_ID_LEN;
  const isValidStatus = status === undefined || status === null || VALID_STATUSES.includes(status);
  if (!isValidId || !isValidStatus) {
    return Response.json({ error: "invalid payload" }, { status: 400 });
  }

  const parsedNextVisit = parseOptionalDate(nextVisitAt);
  if (parsedNextVisit === undefined && nextVisitAt !== undefined) {
    return Response.json({ error: "invalid nextVisitAt" }, { status: 400 });
  }

  const existing = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  if (!existing.length) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  const now = new Date();
  const cleanStatus = status && VALID_STATUSES.includes(status) ? status : existing[0].status;

  const updateSet = { status: cleanStatus, updatedAt: now };
  if (name !== undefined) updateSet.name = cleanOptionalString(name, MAX_NAME_LEN);
  if (phone !== undefined) updateSet.phone = cleanOptionalString(phone, MAX_PHONE_LEN);
  if (note !== undefined) updateSet.note = cleanOptionalString(note, MAX_NOTE_LEN);
  if (nextVisitAt !== undefined) updateSet.nextVisitAt = parsedNextVisit;

  await db.update(leads).set(updateSet).where(eq(leads.id, id));

  await db.insert(leadVisits).values({
    leadId: id,
    status: cleanStatus,
    note: cleanOptionalString(note, MAX_NOTE_LEN),
    visitedBy: cleanOptionalString(visitedBy, MAX_NAME_LEN),
    visitedAt: now,
  });

  return new Response(null, { status: 204 });
};

export const onRequestDelete = async ({ request, env }) => {
  const db = getDb(env.DATABASE_URL);
  const url = new URL(request.url);

  // Admin-only: xóa hàng loạt theo trạng thái và/hoặc khoảng thời gian (hoặc
  // xóa hết nếu không chọn gì) — cùng cơ chế mật khẩu ADMIN_KEY như
  // /api/locations, chỉ kiểm tra ở server.
  if (url.searchParams.get("admin") === "1") {
    const providedKey = request.headers.get("x-admin-key") || "";
    if (!env.ADMIN_KEY || providedKey !== env.ADMIN_KEY) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    const statusParam = url.searchParams.get("statuses");
    const statuses = statusParam
      ? statusParam.split(",").map((s) => s.trim()).filter((s) => VALID_STATUSES.includes(s))
      : null;
    const fromParam = url.searchParams.get("from");
    const toParam = url.searchParams.get("to");
    const from = fromParam ? new Date(fromParam) : null;
    const to = toParam ? new Date(toParam) : null;
    const validFrom = from && !Number.isNaN(from.getTime()) ? from : null;
    const validTo = to && !Number.isNaN(to.getTime()) ? to : null;

    const leadConds = [];
    if (statuses && statuses.length) leadConds.push(inArray(leads.status, statuses));
    if (validFrom) leadConds.push(gte(leads.updatedAt, validFrom));
    if (validTo) leadConds.push(lte(leads.updatedAt, validTo));

    // Tìm id các mối khớp điều kiện trước, để còn xóa lịch sử ghé thăm liên quan.
    let matchQuery = db.select({ id: leads.id }).from(leads);
    if (leadConds.length) matchQuery = matchQuery.where(and(...leadConds));
    const matched = await matchQuery;
    const matchedIds = matched.map((r) => r.id);

    if (matchedIds.length) {
      await db.delete(leadVisits).where(inArray(leadVisits.leadId, matchedIds));
      await db.delete(leads).where(inArray(leads.id, matchedIds));
    }

    return new Response(null, { status: 204 });
  }

  const id = url.searchParams.get("id");
  if (id) {
    await db.delete(leadVisits).where(eq(leadVisits.leadId, id));
    await db.delete(leads).where(eq(leads.id, id));
  }
  return new Response(null, { status: 204 });
};
