DROP INDEX "submissions_form_status_idx";--> statement-breakpoint
CREATE INDEX "form_integrations_workspace_idx" ON "form_integrations" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "submissions_form_status_created_idx" ON "submissions" USING btree ("form_id","status","created_at");--> statement-breakpoint
CREATE INDEX "submissions_workspace_status_created_idx" ON "submissions" USING btree ("workspace_id","status","created_at");--> statement-breakpoint
CREATE INDEX "uploads_form_idx" ON "uploads" USING btree ("form_id");