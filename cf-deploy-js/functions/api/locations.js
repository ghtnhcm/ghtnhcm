import { eq, gt, lt, gte, lte, and, inArray, desc } from "drizzle-orm";
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
// A person's trail stays visible to the group for this long after they go
// offline (close the tab, lose signal, etc.) — the points were never
// deleted from the database, this just controls how long the *API* keeps
// surfacing a finished route so it doesn't vanish the moment someone
// disconnects. Extend this if survey trips run longer than a day.
const TRAIL_VISIBILITY_MS = 24 * 60 * 60 * 1000; // 24 giờ


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
  // IMPORTANT: this used to run one D1 query per participant in a loop,
  // which blows through Cloudflare Workers' subrequest limit once enough
  // people have shared a location (each D1 call is a subrequest) and makes
  // the whole endpoint return 503. Fetch every recent point in a single
  // query instead and group it in JS.
  const trailCutoff = new Date(Date.now() - TRAIL_VISIBILITY_MS);
  const allPoints = await db
    .select({
      participantId: locationHistory.participantId,
      name: locationHistory.name,
      lat: locationHistory.lat,
      lng: locationHistory.lng,
      recordedAt: locationHistory.recordedAt,
      sessionId: locationHistory.sessionId,
    })
    .from(locationHistory)
    .where(gt(locationHistory.recordedAt, trailCutoff))
    .orderBy(desc(locationHistory.recordedAt))
    .limit(MAX_TOTAL_HISTORY_POINTS);

  // allPoints is newest-first across everyone. Walk it once, and for each
  // participant keep only the points belonging to their most recent session
  // (the first sessionId we see for that participant, since we're going
  // newest-first).
  const trailsBuild = new Map();
  for (const p of allPoints) {
    let entry = trailsBuild.get(p.participantId);
    if (!entry) {
      entry = { name: p.name, sessionId: p.sessionId, points: [] };
      trailsBuild.set(p.participantId, entry);
    }
    if (p.sessionId !== entry.sessionId) continue; // older session, ignore
    entry.points.push({ lat: p.lat, lng: p.lng, t: p.recordedAt.toISOString() });
  }

  const trails = {};
  for (const [participantId, entry] of trailsBuild) {
    entry.points.reverse(); // back to chronological order
    trails[participantId] = { name: entry.name, points: entry.points };
  }
  // Currently-online people (in `rows`) with no recent history rows yet
  // (e.g. just started sharing) still get an (empty) trail entry so the
  // frontend can rely on every online participant having one.
  for (const row of rows) {
    if (!trails[row.id]) trails[row.id] = { name: row.name, points: [] };
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
