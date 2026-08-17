CREATE TABLE "live_locations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"lat" real NOT NULL,
	"lng" real NOT NULL,
	"accuracy" real,
	"updated_at" integer NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE "location_history" (
	"id" integer PRIMARY KEY AUTOINCREMENT,
	"participant_id" text NOT NULL,
	"session_id" text NOT NULL,
	"name" text NOT NULL,
	"lat" real NOT NULL,
	"lng" real NOT NULL,
	"recorded_at" integer NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX "location_history_session_idx" ON "location_history" ("participant_id","session_id");
CREATE INDEX "location_history_recorded_at_idx" ON "location_history" ("recorded_at");
