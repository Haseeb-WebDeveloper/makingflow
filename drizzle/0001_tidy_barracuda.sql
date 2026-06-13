CREATE TYPE "public"."custom_domain_status" AS ENUM('pending', 'active', 'error');--> statement-breakpoint
CREATE TABLE "custom_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"status" "custom_domain_status" DEFAULT 'pending' NOT NULL,
	"verification" jsonb,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN "custom_domain_id" uuid;--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "custom_domains" ADD CONSTRAINT "custom_domains_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "custom_domains_domain_idx" ON "custom_domains" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "custom_domains_workspace_idx" ON "custom_domains" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_custom_domain_id_custom_domains_id_fk" FOREIGN KEY ("custom_domain_id") REFERENCES "public"."custom_domains"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "forms_domain_slug_idx" ON "forms" USING btree ("custom_domain_id","slug");