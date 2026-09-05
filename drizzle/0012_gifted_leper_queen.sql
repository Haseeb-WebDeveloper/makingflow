CREATE TABLE "mcp_key_workspaces" (
	"key_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	CONSTRAINT "mcp_key_workspaces_key_id_workspace_id_pk" PRIMARY KEY("key_id","workspace_id")
);
--> statement-breakpoint
ALTER TABLE "mcp_api_keys" DROP CONSTRAINT "mcp_api_keys_workspace_id_workspaces_id_fk";
--> statement-breakpoint
DROP INDEX "mcp_api_keys_workspace_idx";--> statement-breakpoint
ALTER TABLE "mcp_key_workspaces" ADD CONSTRAINT "mcp_key_workspaces_key_id_mcp_api_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."mcp_api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_key_workspaces" ADD CONSTRAINT "mcp_key_workspaces_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_key_workspaces_workspace_idx" ON "mcp_key_workspaces" USING btree ("workspace_id");--> statement-breakpoint

-- Carry every existing key's single workspace into the grant table BEFORE the
-- column goes away. drizzle-kit generates the DROP on its own but not this;
-- without it a one-workspace key would silently become a key granting nothing,
-- and the failure would look like "my key stopped working" rather than a
-- migration bug.
INSERT INTO "mcp_key_workspaces" ("key_id", "workspace_id")
SELECT "id", "workspace_id" FROM "mcp_api_keys" WHERE "workspace_id" IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE "mcp_api_keys" DROP COLUMN "workspace_id";