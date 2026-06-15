ALTER TYPE "public"."connection_provider" ADD VALUE 'notion';--> statement-breakpoint
ALTER TYPE "public"."integration_type" ADD VALUE 'notion';--> statement-breakpoint
ALTER TABLE "workspace_connections" ADD COLUMN "metadata" jsonb;