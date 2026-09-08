DROP INDEX "webhook_deliveries_event_idx";--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ALTER COLUMN "integration_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ALTER COLUMN "url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ALTER COLUMN "payload" DROP NOT NULL;--> statement-breakpoint
--> NOT NULL with no default fails on a table that already has rows (23502), and
--> production has them. Every existing delivery predates this column and is a
--> webhook, since webhooks were the only type ever enqueued — so backfilling
--> 'webhook' is a statement of fact, not a guess.
ALTER TABLE "webhook_deliveries" ADD COLUMN "type" "integration_type" NOT NULL DEFAULT 'webhook';--> statement-breakpoint
--> Dropped straight after the backfill: leaving it would let an insert that
--> forgets the column land silently as a webhook, and the partial unique
--> indexes above route on exactly this value.
ALTER TABLE "webhook_deliveries" ALTER COLUMN "type" DROP DEFAULT;--> statement-breakpoint
CREATE INDEX "webhook_deliveries_form_idx" ON "webhook_deliveries" USING btree ("form_id","type","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_webhook_idx" ON "webhook_deliveries" USING btree ("integration_id","submission_id","event") WHERE "webhook_deliveries"."type" = 'webhook';--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_singleton_idx" ON "webhook_deliveries" USING btree ("form_id","type","submission_id","event") WHERE "webhook_deliveries"."type" <> 'webhook';