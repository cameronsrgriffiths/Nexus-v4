ALTER TABLE "channel" ADD COLUMN IF NOT EXISTS "address" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channel_kind_address_unique" ON "channel" USING btree ("kind","address");
