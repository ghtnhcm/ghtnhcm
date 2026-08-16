CREATE TABLE "live_locations" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"accuracy" double precision,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "location_history" (
	"id" serial PRIMARY KEY,
	"participant_id" text NOT NULL,
	"session_id" text NOT NULL,
	"name" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "location_history_session_idx" ON "location_history" ("participant_id","session_id");
--> statement-breakpoint
CREATE INDEX "location_history_recorded_at_idx" ON "location_history" ("recorded_at");
