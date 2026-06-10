-- ReturnEvent.eventType: store free-form strings (e.g. SHOPIFY_ORDER_SYNC)
-- without a Prisma/Postgres enum. Safe cast when column uses EventType enum.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'EventType'
      AND n.nspname = 'public'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ReturnEvent'
      AND column_name = 'eventType'
  ) THEN
    ALTER TABLE "ReturnEvent"
      ALTER COLUMN "eventType" TYPE TEXT
      USING "eventType"::TEXT;
  END IF;
END $$;

DROP TYPE IF EXISTS "EventType";
