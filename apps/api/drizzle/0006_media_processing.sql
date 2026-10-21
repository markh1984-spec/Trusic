CREATE TABLE "media_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"source_key" text NOT NULL,
	"track_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"heartbeat_at" timestamp with time zone,
	"error" text,
	"variants" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "media_jobs_source_key_unique" UNIQUE("source_key")
);
--> statement-breakpoint
ALTER TABLE "tracks" ADD COLUMN "original_audio_key" text;--> statement-breakpoint
ALTER TABLE "tracks" ADD COLUMN "preview_audio_key" text;--> statement-breakpoint
ALTER TABLE "tracks" ADD COLUMN "preview_audio_bytes" bigint;--> statement-breakpoint
ALTER TABLE "tracks" ADD COLUMN "loudness_lufs" real;--> statement-breakpoint
ALTER TABLE "tracks" ADD COLUMN "loudness_gain_db" real;--> statement-breakpoint
ALTER TABLE "tracks" ADD COLUMN "audio_processed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "media_jobs" ADD CONSTRAINT "media_jobs_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_jobs_status_idx" ON "media_jobs" USING btree ("status","run_after");