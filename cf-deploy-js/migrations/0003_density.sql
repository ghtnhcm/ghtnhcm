CREATE TABLE "density_points" (
	"id" text PRIMARY KEY NOT NULL,
	"level" text NOT NULL,
	"note" text,
	"lat" real NOT NULL,
	"lng" real NOT NULL,
	"created_by" text,
	"created_at" integer NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX "density_points_level_idx" ON "density_points" ("level");
