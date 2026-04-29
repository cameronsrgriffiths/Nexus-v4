-- Slice 7: knowledge baseline (FTS + pgvector + OCC retry).
--
-- Postgres FTS is built in. pgvector is the extension we add here for the
-- semantic-recall column. Both indexes (FTS GIN on tsv, IVFFlat on embedding)
-- live next to the page row so search_knowledge can query them in one shot.

CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TYPE "public"."knowledge_scope" AS ENUM('org', 'agent', 'contact');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_page" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"scope" "knowledge_scope" NOT NULL,
	"scope_id" uuid NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"tsv" tsvector NOT NULL,
	"embedding" vector(768) NOT NULL,
	"moved_to" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "knowledge_page" ADD CONSTRAINT "knowledge_page_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_page_scope_title_unique" ON "knowledge_page" ("org_id","scope","scope_id","title");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_page_scope_idx" ON "knowledge_page" ("org_id","scope","scope_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_page_tsv_idx" ON "knowledge_page" USING GIN ("tsv");
--> statement-breakpoint
-- IVFFlat needs at least one row before the index is meaningful, but
-- creating it empty is fine — Postgres falls back to a sequential scan
-- until there's enough data for the index to help.
CREATE INDEX IF NOT EXISTS "knowledge_page_embedding_idx" ON "knowledge_page" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);
