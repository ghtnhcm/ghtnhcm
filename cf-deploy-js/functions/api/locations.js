import { eq, gt, lt, and, desc } from "drizzle-orm";
import { getDb } from "../../db/index.js";
import { liveLocations, locationHistory } from "../../db/schema.js";

// A participant is considered offline once their last update is older than this.
const STALE_MS = 90_000;
const MAX_NAME_LEN = 40;
const MAX_ID_LEN = 64;

// Trail points older than this are pruned opportunistically on writes, so
// the history table doesn't grow forever while still covering a full day
// of survey work.
const HISTORY_RETENTION_MS = 24 * 60 * 60 * 1000;
// Safety cap on how many trail points come back per session in one response.
const MAX_HISTORY_POINTS_PER_SESSION = 2000;


export const onRequestPost = async ({ request, env }) => {
  const db = getDb(env.DATABASE_URL);

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { id, name, lat, lng, accuracy, sessionId } = body ?? {};
  const isValidId = typeof id === "string" && id.length > 0 && id.length <= MAX_ID_LEN;
  const isValidName = typeof name === "string" && name.trim().length > 0;
  const isValidLat = typeof lat === "number" && Number.isFinite(lat) && lat >= -90 && lat <= 90;
  const isValidLng = typeof lng === "number" && Number.isFinite(lng) && lng >= -180 && lng <= 180;
  const isValidAccuracy = accuracy === undefined || accuracy === null || (typeof accuracy === "number" && Number.isFinite(accuracy));
  const isValidSessionId = sessionId === undefined || sessionId === null || (typeof sessionId === "string" && sessionId.length > 0 && sessionId.length <= MAX_ID_LEN);

  if (!isValidId || !isValidName || !isValidLat || !isValidLng || !isValidAccuracy || !isValidSessionId) {
    return Response.json({ error: "invalid payload" }, { status: 400 });
  }

  const cleanName = name.trim().slice(0, MAX_NAME_LEN);
  const now = new Date();

  await db
    .insert(liveLocations)
    .values({ id, name: cleanName, lat, lng, accuracy: accuracy ?? null, updatedAt: now })
    .onConflictDoUpdate({
      target: liveLocations.id,
      set: { name: cleanName, lat, lng, accuracy: accuracy ?? null, updatedAt: now },
    });

  // Record this point on the participant's journey so the route they
  // walked/drove can be drawn on the map, not just their current dot.
  // sessionId groups points from one continuous "bật chia sẻ" session;
  // fall back to the participant id so older clients still get a trail.
  const cleanSessionId = (typeof sessionId === "string" && sessionId) ? sessionId.slice(0, MAX_ID_LEN) : id;
  await db.insert(locationHistory).values({
    participantId: id,
    sessionId: cleanSessionId,
    name: cleanName,
    lat,
    lng,
    recordedAt: now,
  });

  // Opportunistic cleanup of old trail points (no separate cron needed).
  const historyCutoff = new Date(Date.now() - HISTORY_RETENTION_MS);
  db.delete(locationHistory).where(lt(locationHistory.recordedAt, historyCutoff)).catch(() => {});

  return new Response(null, { status: 204 });
};

export const onRequestGet = async ({ request, env }) => {
  const db = getDb(env.DATABASE_URL);
  const url = new URL(request.url);
  const cutoff = new Date(Date.now() - STALE_MS);
  const rows = await db
    .select({
      id: liveLocations.id,
      name: liveLocations.name,
      lat: liveLocations.lat,
      lng: liveLocations.lng,
      accuracy: liveLocations.accuracy,
      updatedAt: liveLocations.updatedAt,
    })
    .from(liveLocations)
    .where(gt(liveLocations.updatedAt, cutoff));

  const wantsHistory = url.searchParams.get("history") === "1";
  if (!wantsHistory) {
    return Response.json(rows);
  }

  // Return each currently-active participant's trail for their current
  // session, so the client can draw a route line per person.
  const historyCutoff = new Date(Date.now() - HISTORY_RETENTION_MS);
  const trails = {};

  for (const row of rows) {
    const points = await db
      .select({
        lat: locationHistory.lat,
        lng: locationHistory.lng,
        recordedAt: locationHistory.recordedAt,
        sessionId: locationHistory.sessionId,
      })
      .from(locationHistory)
      .where(and(eq(locationHistory.participantId, row.id), gt(locationHistory.recordedAt, historyCutoff)))
      .orderBy(desc(locationHistory.recordedAt))
      .limit(MAX_HISTORY_POINTS_PER_SESSION);

    if (points.length === 0) continue;
    // Only keep the most recent session's points (points is newest-first).
    const currentSessionId = points[0].sessionId;
    const sessionPoints = points
      .filter((p) => p.sessionId === currentSessionId)
      .reverse()
      .map((p) => ({ lat: p.lat, lng: p.lng, t: p.recordedAt.toISOString() }));

    trails[row.id] = { name: row.name, points: sessionPoints };
  }

  return Response.json({ locations: rows, trails });
};

export const onRequestDelete = async ({ request, env }) => {
  const db = getDb(env.DATABASE_URL);
  const id = new URL(request.url).searchParams.get("id");
  if (id) {
    await db.delete(liveLocations).where(eq(liveLocations.id, id));
  }
  return new Response(null, { status: 204 });
};
