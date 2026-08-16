import { pgTable, text, doublePrecision, timestamp, serial, integer, jsonb } from "drizzle-orm/pg-core";

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

// One row per recruitment "mối" (lead) placed on the map while doing
// door-to-door recruitment. Unlike the plain notes (which only live in the
// browser's localStorage), leads are shared server-side so the whole team
// sees the same pipeline and nobody re-visits an address someone else
// already covered. "status" tracks the candidate type (khong_tiem_nang /
// ung_vien_a / ung_vien_b / ung_vien_c); the full history of status
// changes/visits lives in leadVisits. "eval_answers" holds the 10-criteria
// screening checklist (1 = Có, 0 = Không, per question index), with
// "eval_score" (số câu "Có") and "eval_result" ("dat" khi đủ 10/10 điểm,
// "chua_dat" khi chưa đủ) kept alongside for quick display/filtering
// without recomputing from the raw answers each time.
export const leads = pgTable("leads", {
  id: text().primaryKey(),
  name: text(),
  phone: text(),
  lat: doublePrecision().notNull(),
  lng: doublePrecision().notNull(),
  status: text().notNull().default("khong_tiem_nang"),
  note: text(),
  nextVisitAt: timestamp("next_visit_at"),
  evalAnswers: jsonb("eval_answers"),
  evalScore: integer("eval_score"),
  evalResult: text("eval_result"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Append-only log of every visit/update made to a lead (status change,
// note, who did it, when) so the team can see the full contact history at
// one address instead of just the current snapshot.
export const leadVisits = pgTable("lead_visits", {
  id: serial().primaryKey(),
  leadId: text("lead_id").notNull(),
  status: text().notNull(),
  note: text(),
  visitedBy: text("visited_by"),
  visitedAt: timestamp("visited_at").defaultNow().notNull(),
});
