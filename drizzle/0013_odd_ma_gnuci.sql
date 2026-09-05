CREATE TABLE "mcp_oauth_grant_workspaces" (
	"grant_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	CONSTRAINT "mcp_oauth_grant_workspaces_grant_id_workspace_id_pk" PRIMARY KEY("grant_id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE "mcp_oauth_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"client_name" text,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_audit_log" ADD COLUMN "grant_id" uuid;--> statement-breakpoint
ALTER TABLE "mcp_oauth_grant_workspaces" ADD CONSTRAINT "mcp_oauth_grant_workspaces_grant_id_mcp_oauth_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."mcp_oauth_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_oauth_grant_workspaces" ADD CONSTRAINT "mcp_oauth_grant_workspaces_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_oauth_grants" ADD CONSTRAINT "mcp_oauth_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_oauth_grant_workspaces_workspace_idx" ON "mcp_oauth_grant_workspaces" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_oauth_grants_user_client_idx" ON "mcp_oauth_grants" USING btree ("user_id","client_id");--> statement-breakpoint
CREATE INDEX "mcp_oauth_grants_user_idx" ON "mcp_oauth_grants" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "mcp_audit_log" ADD CONSTRAINT "mcp_audit_log_grant_id_mcp_oauth_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."mcp_oauth_grants"("id") ON DELETE set null ON UPDATE no action;