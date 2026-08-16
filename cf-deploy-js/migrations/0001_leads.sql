CREATE TABLE "leads" (
	"id" text PRIMARY KEY,
	"name" text,
	"phone" text,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"status" text DEFAULT 'chua_gap' NOT NULL,
	"note" text,
	"next_visit_at" timestamp,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "lead_visits" (
	"id" serial PRIMARY KEY,
	"lead_id" text NOT NULL,
	"status" text NOT NULL,
	"note" text,
	"visited_by" text,
	"visited_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "leads" ("status");
--> statement-breakpoint
CREATE INDEX "leads_next_visit_idx" ON "leads" ("next_visit_at");
--> statement-breakpoint
CREATE INDEX "lead_visits_lead_idx" ON "lead_visits" ("lead_id");
