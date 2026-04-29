-- Consolidate channel.email_address into channel.address. Idempotent so it
-- repairs any environment shape: a clean post-0007 DB (column exists, holds
-- email rows' address), a drifted dev DB (column never existed), or a halfway
-- state. Mailtrap's inbox id is a separate identifier and stays as its own
-- column; this also re-asserts it for envs where 0005 didn't take effect.

-- Backfill must reference email_address conditionally — if the column was
-- never created (drifted dev DB), a plain UPDATE statement parses against the
-- live schema and would fail. Wrap in a DO block that checks first.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'channel' AND column_name = 'email_address'
  ) THEN
    EXECUTE 'UPDATE "channel" SET "address" = "email_address" WHERE "address" IS NULL AND "email_address" IS NOT NULL';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "channel" DROP COLUMN IF EXISTS "email_address";--> statement-breakpoint
ALTER TABLE "channel" ADD COLUMN IF NOT EXISTS "mailtrap_inbox_id" text;
