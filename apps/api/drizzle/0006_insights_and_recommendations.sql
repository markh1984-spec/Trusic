ALTER TABLE "plays" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "human_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "likes_track_idx" ON "likes" USING btree ("track_id");--> statement-breakpoint
CREATE INDEX "plays_track_idx" ON "plays" USING btree ("track_id","played_at","user_id","ms_played","source");