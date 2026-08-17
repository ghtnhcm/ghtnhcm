CREATE TABLE "density_points" (
	"id" text PRIMARY KEY,
	"level" text NOT NULL,
	"note" text,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX "density_points_level_idx" ON "density_points" ("level");
