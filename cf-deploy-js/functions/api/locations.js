import { eq, gt, lt, gte, lte, and, inArray } from "drizzle-orm";
import { getDb } from "../../db/index.js";
import { liveLocations, locationHistory } from "../../db/schema.js";

// A participant is considered offline once their last update is older than this.
const STALE_MS = 90_000;
const MAX_NAME_LEN = 40;
const MAX_ID_LEN = 64;

// Trail points older than this are pruned opportunistically on writes, so
// the history table doesn't grow forever while still keeping a few months
// of past survey journeys available for reference/reporting.
const HISTORY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000; // ~3 months
// Safety cap on how many trail points come back per session in one response.
const MAX_HISTORY_POINTS_PER_SESSION = 5000;
// Safety cap on total trail points fetched across ALL participants in one
// history request (single batched query — see onRequestGet below).
const MAX_TOTAL_HISTORY_POINTS = 20000;
// How far back (in time) trail sessions are still pulled into the map, so
// multi-day routes ("hành trình lưu 90 ngày") actually show up — not just
// today's. The points were never deleted from the database before this (only
// HISTORY_RETENTION_MS controls permanent deletion); this just controlled how
// far back the *API* looked. Extend this if survey trips should stay visible
// on the map for longer than a week.
const TRAIL_VISIBILITY_MS = 7 * 24 * 60 * 60 * 1000; // 7 ngày
// Each time someone turns location-sharing back on, a new sessionId starts —
// so a multi-day trail is really several sessions per participant. This caps
// how many of a person's most recent sessions we pull (roughly "how many
// separate days/trips"), so one very active participant over many days can't
// blow up the response.
const MAX_SESSIONS_PER_PARTICIPANT = 30;


export const onRequestPost = async ({ request, env }) => {
  const db = getDb(env.DB);

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

  // Opportunistic cleanup of trail points older than the retention window
  // (no separate cron needed).
  const historyCutoff = new Date(Date.now() - HISTORY_RETENTION_MS);
  db.delete(locationHistory).where(lt(locationHistory.recordedAt, historyCutoff)).catch(() => {});

  return new Response(null, { status: 204 });
};

export const onRequestGet = async ({ request, env }) => {
  const db = getDb(env.DB);
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

  // Trails stay visible for a while after someone goes offline (closes the
  // tab, loses signal, turns sharing off) — their points were never deleted,
  // so we still surface the route for anyone active within the visibility
  // window, not only the people currently online. Currently-online people
  // (in `rows`) are always included so their live-updating route shows too.
  //
  // PERFORMANCE NOTE (read before touching this again): this endpoint has
  // twice hit Cloudflare Workers CPU/subrequest limits as the group grew:
  //   1. First version ran one D1 query per participant in a loop → too many
  //      subrequests → 503.
  //   2. Second version pulled every point from the last 24h for everyone
  //      into one query, then filtered/grouped in JS → too much data to
  //      parse and walk in JS → exceeded the free plan's 10ms CPU budget
  //      (Cloudflare error 1102) once the group hit ~14 people.
  // This version pushes the "only the participant's N most recent sessions"
  // filtering into SQL itself (D1/SQLite query time doesn't count against
  // Worker CPU time — only parsing/looping in JS does), via two small raw
  // queries instead of drizzle's query builder, so only the points actually
  // needed ever reach the Worker's JS.
  const trailCutoffSec = Math.floor((Date.now() - TRAIL_VISIBILITY_MS) / 1000);

  // Step 1: each participant's most recent sessions (up to
  // MAX_SESSIONS_PER_PARTICIPANT), one row per session — not just their
  // single latest one. This is what lets multiple days of trail show up
  // instead of only the most recent day. Still a small result set (one row
  // per session, not per point) and still filtered entirely in SQL, so it
  // doesn't reintroduce the per-participant query loop or the "pull
  // everything into JS" problem noted above.
  // (Deliberately avoids ROW_NUMBER()/window functions here — a CTE +
  // correlated-subquery rank check instead, since it's the more broadly
  // compatible SQLite syntax across D1 versions.)
  const latestSessions = (
    await env.DB.prepare(
      `WITH session_max AS (
         SELECT lh.participant_id AS participantId,
                lh.session_id AS sessionId,
                lh.name AS name,
                MAX(lh.recorded_at) AS max_recorded_at
         FROM location_history lh
         WHERE lh.recorded_at > ?
         GROUP BY lh.participant_id, lh.session_id
       )
       SELECT participantId, sessionId, name
       FROM session_max sm
       WHERE (
         SELECT COUNT(*) FROM session_max sm2
         WHERE sm2.participantId = sm.participantId
           AND sm2.max_recorded_at > sm.max_recorded_at
       ) < ?`
    )
      .bind(trailCutoffSec, MAX_SESSIONS_PER_PARTICIPANT)
      .all()
  ).results ?? [];

  const trails = {};
  for (const row of rows) trails[row.id] = { name: row.name, points: [] };

  if (latestSessions.length > 0) {
    const sessionIds = latestSessions.map((s) => s.sessionId);
    const participantBySession = new Map(latestSessions.map((s) => [s.sessionId, { id: s.participantId, name: s.name }]));

    // Step 2: only the points belonging to those selected recent sessions —
    // not every point from the whole lookback window across every session.
    const placeholders = sessionIds.map(() => "?").join(",");
    const points = (
      await env.DB.prepare(
        `SELECT session_id AS sessionId, lat, lng, recorded_at AS recordedAt
         FROM location_history
         WHERE session_id IN (${placeholders})
         ORDER BY recorded_at ASC
         LIMIT ?`
      )
        .bind(...sessionIds, MAX_TOTAL_HISTORY_POINTS)
        .all()
    ).results ?? [];

    for (const p of points) {
      const participant = participantBySession.get(p.sessionId);
      if (!participant) continue;
      if (!trails[participant.id]) trails[participant.id] = { name: participant.name, points: [] };
      trails[participant.id].points.push({
        lat: p.lat,
        lng: p.lng,
        t: new Date(p.recordedAt * 1000).toISOString(),
      });
    }
  }

  return Response.json({ locations: rows, trails });
};

export const onRequestDelete = async ({ request, env }) => {
  const db = getDb(env.DB);
  const url = new URL(request.url);

  // Admin-only: delete data for selected people and/or a time window (or
  // everyone/everything if neither filter is given). Gated by a secret key
  // that lives only on the server (env.ADMIN_KEY, configured via
  // `wrangler secret put ADMIN_KEY` — never checked into the repo or shipped
  // in the app's JS). Anyone can see this button in the UI, but the request
  // is rejected server-side unless the correct key is supplied, so only
  // whoever holds that key can actually delete anything.
  if (url.searchParams.get("admin") === "1") {
    const providedKey = request.headers.get("x-admin-key") || "";
    if (!env.ADMIN_KEY || providedKey !== env.ADMIN_KEY) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    const participantsParam = url.searchParams.get("participants");
    const participantIds = participantsParam
      ? participantsParam.split(",").map((s) => s.trim()).filter(Boolean)
      : null;
    const fromParam = url.searchParams.get("from");
    const toParam = url.searchParams.get("to");
    const from = fromParam ? new Date(fromParam) : null;
    const to = toParam ? new Date(toParam) : null;
    const validFrom = from && !Number.isNaN(from.getTime()) ? from : null;
    const validTo = to && !Number.isNaN(to.getTime()) ? to : null;

    const historyConds = [];
    if (participantIds) historyConds.push(inArray(locationHistory.participantId, participantIds));
    if (validFrom) historyConds.push(gte(locationHistory.recordedAt, validFrom));
    if (validTo) historyConds.push(lte(locationHistory.recordedAt, validTo));

    const liveConds = [];
    if (participantIds) liveConds.push(inArray(liveLocations.id, participantIds));
    if (validFrom) liveConds.push(gte(liveLocations.updatedAt, validFrom));
    if (validTo) liveConds.push(lte(liveLocations.updatedAt, validTo));

    let historyQuery = db.delete(locationHistory);
    if (historyConds.length) historyQuery = historyQuery.where(and(...historyConds));
    await historyQuery;

    let liveQuery = db.delete(liveLocations);
    if (liveConds.length) liveQuery = liveQuery.where(and(...liveConds));
    await liveQuery;

    return new Response(null, { status: 204 });
  }

  const id = url.searchParams.get("id");
  if (id) {
    await db.delete(liveLocations).where(eq(liveLocations.id, id));
    // history=1 also wipes this participant's saved trail (location_history),
    // not just their live dot — an explicit, separate opt-in since it's
    // permanent and removes their route from everyone's map.
    if (url.searchParams.get("history") === "1") {
      await db.delete(locationHistory).where(eq(locationHistory.participantId, id));
    }
  }
  return new Response(null, { status: 204 });
};
