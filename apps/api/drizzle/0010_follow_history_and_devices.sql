CREATE TABLE "follow_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artist_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "offline_devices" ADD COLUMN "removed_reason" text;--> statement-breakpoint
ALTER TABLE "offline_devices" ADD COLUMN "track_count" integer;--> statement-breakpoint
ALTER TABLE "follow_events" ADD CONSTRAINT "follow_events_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "follow_events_artist_idx" ON "follow_events" USING btree ("artist_id","created_at");--> statement-breakpoint
CREATE INDEX "artists_image_idx" ON "artists" USING btree ("image_key");--> statement-breakpoint
CREATE INDEX "releases_artwork_idx" ON "releases" USING btree ("artwork_key");--> statement-breakpoint
-- Everyone following now followed on the day their follow was made. Unfollows before today weren't kept.
INSERT INTO "follow_events" ("artist_id", "kind", "created_at") SELECT "artist_id", 'follow', "created_at" FROM "follows";--> statement-breakpoint
-- Until now, devices were only ever removed by downloads on newer devices.
UPDATE "offline_devices" SET "removed_reason" = 'limit' WHERE "removed_at" IS NOT NULL;