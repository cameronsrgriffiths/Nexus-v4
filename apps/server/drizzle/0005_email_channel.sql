-- Email channel: extends `channel` with kind-specific columns, adds an inbound
-- dedupe table for poll-based ingestion, and adds `external_id` to
-- `agent_message` for email threading (Message-ID).

ALTER TABLE "channel" ADD COLUMN IF NOT EXISTS "email_address" text;--> statement-breakpoint
ALTER TABLE "channel" ADD COLUMN IF NOT EXISTS "mailtrap_inbox_id" text;--> statement-breakpoint
ALTER TABLE "agent_message" ADD COLUMN IF NOT EXISTS "external_id" text;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "channel_inbound_seen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "channel_inbound_seen" ADD CONSTRAINT "channel_inbound_seen_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channel_inbound_seen_channel_external_unique" ON "channel_inbound_seen" USING btree ("channel_id","external_id");
