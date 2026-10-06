ALTER TABLE "revenue_entries" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "stripe_account_id" text;--> statement-breakpoint
ALTER TABLE "revenue_entries" ADD CONSTRAINT "revenue_entries_external_ref_unique" UNIQUE("external_ref");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_stripe_customer_id_unique" UNIQUE("stripe_customer_id");