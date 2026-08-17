CREATE TABLE "leads" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"phone" text,
	"lat" real NOT NULL,
	"lng" real NOT NULL,
	"status" text NOT NULL DEFAULT 'chua_gap',
	"note" text,
	"next_visit_at" integer,
	"created_by" text,
	"created_at" integer NOT NULL DEFAULT (unixepoch()),
	"updated_at" integer NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE "lead_visits" (
	"id" integer PRIMARY KEY AUTOINCREMENT,
	"lead_id" text NOT NULL,
	"status" text NOT NULL,
	"note" text,
	"visited_by" text,
	"visited_at" integer NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX "leads_status_idx" ON "leads" ("status");
CREATE INDEX "leads_next_visit_idx" ON "leads" ("next_visit_at");
CREATE INDEX "lead_visits_lead_idx" ON "lead_visits" ("lead_id");
