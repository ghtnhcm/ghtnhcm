import { eq, desc } from "drizzle-orm";
import { getDb } from "../../db/index.js";
import { densityPoints } from "../../db/schema.js";

const MAX_NOTE_LEN = 500;
const MAX_ID_LEN = 64;
const MAX_NAME_LEN = 60;
const VALID_LEVELS = ["cao", "trung_binh", "thap"];

function cleanOptionalString(v, maxLen) {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length ? trimmed.slice(0, maxLen) : null;
}

export const onRequestGet = async ({ env }) => {
  const db = getDb(env.DB);
  const rows = await db
    .select()
    .from(densityPoints)
    .orderBy(desc(densityPoints.createdAt));
  return Response.json(rows);
};

export const onRequestPost = async ({ request, env }) => {
  const db = getDb(env.DB);

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { id, level, note, lat, lng, createdBy } = body ?? {};

  const isValidId = typeof id === "string" && id.length > 0 && id.length <= MAX_ID_LEN;
  const isValidLevel = typeof level === "string" && VALID_LEVELS.includes(level);
  const isValidLat = typeof lat === "number" && Number.isFinite(lat) && lat >= -90 && lat <= 90;
  const isValidLng = typeof lng === "number" && Number.isFinite(lng) && lng >= -180 && lng <= 180;

  if (!isValidId || !isValidLevel || !isValidLat || !isValidLng) {
    return Response.json({ error: "invalid payload" }, { status: 400 });
  }

  await db
    .insert(densityPoints)
    .values({
      id,
      level,
      note: cleanOptionalString(note, MAX_NOTE_LEN),
      lat,
      lng,
      createdBy: cleanOptionalString(createdBy, MAX_NAME_LEN),
      createdAt: new Date(),
    })
    .onConflictDoNothing();

  return new Response(null, { status: 204 });
};

export const onRequestDelete = async ({ request, env }) => {
  const db = getDb(env.DB);
  const url = new URL(request.url);

  // Admin-only: xóa toàn bộ dữ liệu mật độ dân cư, cùng cơ chế mật khẩu
  // ADMIN_KEY như /api/locations và /api/leads.
  if (url.searchParams.get("admin") === "1") {
    const providedKey = request.headers.get("x-admin-key") || "";
    if (!env.ADMIN_KEY || providedKey !== env.ADMIN_KEY) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    await db.delete(densityPoints);
    return new Response(null, { status: 204 });
  }

  const id = url.searchParams.get("id");
  if (id) {
    await db.delete(densityPoints).where(eq(densityPoints.id, id));
  }
  return new Response(null, { status: 204 });
};
