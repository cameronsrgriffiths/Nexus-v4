-- Slice 8: knowledge conflict UI.
--
-- Append-only log of knowledge_page writes. Backs:
--   - Append-vs-append auto-merge detection (the operator-save endpoint
--     queries the log for intervening write modes).
--   - "Lost agent write" audit rows after a force-overwrite (the agent's row
--     is referenced by lost_to_force_by_id pointing at the operator's force
--     row that replaced it).

CREATE TYPE "public"."knowledge_write_mode" AS ENUM('create', 'append', 'overwrite', 'force');
--> statement-breakpoint
CREATE TYPE "public"."knowledge_write_actor" AS ENUM('agent', 'operator');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_write_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"version_after" integer NOT NULL,
	"mode" "knowledge_write_mode" NOT NULL,
	"actor" "knowledge_write_actor" NOT NULL,
	"content_after" text NOT NULL,
	"lost_to_force_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "knowledge_write_log" ADD CONSTRAINT "knowledge_write_log_page_id_knowledge_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."knowledge_page"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "knowledge_write_log" ADD CONSTRAINT "knowledge_write_log_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_write_log_page_version_idx" ON "knowledge_write_log" ("page_id","version_after");
