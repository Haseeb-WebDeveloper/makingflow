CREATE TABLE "mcp_rate_limits" (
	"key_id" uuid NOT NULL,
	"budget" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "mcp_rate_limits_key_id_budget_window_start_pk" PRIMARY KEY("key_id","budget","window_start")
);
--> statement-breakpoint
ALTER TABLE "mcp_rate_limits" ADD CONSTRAINT "mcp_rate_limits_key_id_mcp_api_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."mcp_api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_rate_limits_window_idx" ON "mcp_rate_limits" USING btree ("window_start");