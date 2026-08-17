import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// One row per participant currently sharing their live location.
// Rows are upserted on every position update and considered stale (hidden)
// once "updated_at" is older than the freshness window used by the API.
export const liveLocations = sqliteTable("live_locations", {
  id: text().primaryKey(),
  name: text().notNull(),
  lat: real().notNull(),
  lng: real().notNull(),
  accuracy: real(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

// Append-only trail of positions recorded while a participant has group
// sharing turned on, so everyone can see each person's movement route
// (not just their current dot). "session_id" groups the points of one
// continuous share — a new id is generated every time sharing is
// (re)started — so a participant's route for each outing stays its own
// polyline instead of jumping between unrelated trips. Old rows are pruned
// opportunistically by the API (see HISTORY_RETENTION_MS) so this table
// doesn't grow forever.
export const locationHistory = sqliteTable("location_history", {
  id: integer().primaryKey({ autoIncrement: true }),
  participantId: text("participant_id").notNull(),
  sessionId: text("session_id").notNull(),
  name: text().notNull(),
  lat: real().notNull(),
  lng: real().notNull(),
  recordedAt: integer("recorded_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
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
export const leads = sqliteTable("leads", {
  id: text().primaryKey(),
  name: text(),
  phone: text(),
  lat: real().notNull(),
  lng: real().notNull(),
  status: text().notNull().default("khong_tiem_nang"),
  note: text(),
  nextVisitAt: integer("next_visit_at", { mode: "timestamp" }),
  evalAnswers: text("eval_answers", { mode: "json" }),
  evalScore: integer("eval_score"),
  evalResult: text("eval_result"),
  createdBy: text("created_by"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

// Điểm đánh dấu mật độ dân cư (khảo sát mở văn phòng). Không có nguồn dữ
// liệu tự động cho mật độ dân cư (khác với địa điểm kinh doanh lấy được từ
// OpenStreetMap), nên đây là điểm do người khảo sát tự bấm và chọn mức độ
// dựa trên quan sát thực địa.
export const densityPoints = sqliteTable("density_points", {
  id: text().primaryKey(),
  level: text().notNull(), // 'cao' | 'trung_binh' | 'thap'
  note: text(),
  lat: real().notNull(),
  lng: real().notNull(),
  createdBy: text("created_by"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

// Append-only log of every visit/update made to a lead (status change,
// note, who did it, when) so the team can see the full contact history at
// one address instead of just the current snapshot.
export const leadVisits = sqliteTable("lead_visits", {
  id: integer().primaryKey({ autoIncrement: true }),
  leadId: text("lead_id").notNull(),
  status: text().notNull(),
  note: text(),
  visitedBy: text("visited_by"),
  visitedAt: integer("visited_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});
