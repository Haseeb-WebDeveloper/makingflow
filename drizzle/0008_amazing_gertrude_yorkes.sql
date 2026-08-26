CREATE TYPE "public"."chat_surface" AS ENUM('builder', 'insights');--> statement-breakpoint
DROP INDEX "form_chat_messages_form_seq_idx";--> statement-breakpoint
ALTER TABLE "form_chat_messages" ADD COLUMN "surface" "chat_surface" DEFAULT 'builder' NOT NULL;--> statement-breakpoint
CREATE INDEX "form_chat_messages_form_surface_seq_idx" ON "form_chat_messages" USING btree ("form_id","surface","seq");