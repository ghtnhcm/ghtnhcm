import { pgTable, text, doublePrecision, timestamp, serial } from "drizzle-orm/pg-core";

// One row per participant currently sharing their live location.
// Rows are upserted on every position update and considered stale (hidden)
// once "updated_at" is older than the freshness window used by the API.
export const liveLocations = pgTable("live_locations", {
  id: text().primaryKey(),
  name: text().notNull(),
  lat: doublePrecision().notNull(),
  lng: doublePrecision().notNull(),
  accuracy: doublePrecision(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Append-only trail of positions recorded while a participant has group
// sharing turned on, so everyone can see each person's movement route
// (not just their current dot). "session_id" groups the points of one
// continuous share — a new id is generated every time sharing is
// (re)started — so a participant's route for each outing stays its own
// polyline instead of jumping between unrelated trips. Old rows are pruned
// opportunistically by the API (see HISTORY_RETENTION_MS) so this table
// doesn't grow forever.
export const locationHistory = pgTable("location_history", {
  id: serial().primaryKey(),
  participantId: text("participant_id").notNull(),
  sessionId: text("session_id").notNull(),
  name: text().notNull(),
  lat: doublePrecision().notNull(),
  lng: doublePrecision().notNull(),
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
});
