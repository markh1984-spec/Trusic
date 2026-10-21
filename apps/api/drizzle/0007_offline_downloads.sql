CREATE TABLE "offline_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_key" text NOT NULL,
	"name" text NOT NULL,
	"platform" text NOT NULL,
	"last_sync_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "plays" ADD COLUMN "client_play_id" uuid;--> statement-breakpoint
ALTER TABLE "plays" ADD COLUMN "counted_in_period" text;--> statement-breakpoint
ALTER TABLE "offline_devices" ADD CONSTRAINT "offline_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_periods" ADD CONSTRAINT "subscription_periods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "offline_devices_user_key_idx" ON "offline_devices" USING btree ("user_id","device_key");--> statement-breakpoint
CREATE INDEX "subscription_periods_user_idx" ON "subscription_periods" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "plays_client_play_idx" ON "plays" USING btree ("user_id","client_play_id");--> statement-breakpoint
CREATE INDEX "plays_counted_in_idx" ON "plays" USING btree ("counted_in_period");