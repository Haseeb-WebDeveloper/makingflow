CREATE TABLE "mcp_oauth_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_name" text,
	"client_uri" text,
	"redirect_uris" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_oauth_codes" (
	"code_hash" text PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"grant_id" uuid NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"resource" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_oauth_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"grant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"replaces_token_hash" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_rate_limits" DROP CONSTRAINT "mcp_rate_limits_key_id_mcp_api_keys_id_fk";
--> statement-breakpoint
ALTER TABLE "mcp_oauth_grants" ALTER COLUMN "client_id" SET DATA TYPE uuid USING "client_id"::uuid;--> statement-breakpoint
ALTER TABLE "mcp_oauth_codes" ADD CONSTRAINT "mcp_oauth_codes_client_id_mcp_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."mcp_oauth_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_oauth_codes" ADD CONSTRAINT "mcp_oauth_codes_grant_id_mcp_oauth_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."mcp_oauth_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_oauth_tokens" ADD CONSTRAINT "mcp_oauth_tokens_grant_id_mcp_oauth_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."mcp_oauth_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_oauth_clients_created_idx" ON "mcp_oauth_clients" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "mcp_oauth_codes_expires_idx" ON "mcp_oauth_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "mcp_oauth_tokens_grant_idx" ON "mcp_oauth_tokens" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX "mcp_oauth_tokens_expires_idx" ON "mcp_oauth_tokens" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "mcp_oauth_grants" ADD CONSTRAINT "mcp_oauth_grants_client_id_mcp_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."mcp_oauth_clients"("id") ON DELETE cascade ON UPDATE no action;