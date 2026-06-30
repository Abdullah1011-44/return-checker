-- Repair migration history drift.
-- MerchantUser exists in the current Prisma schema and real database,
-- but was missing from earlier migration history before ReturnEvent foreign key creation.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MerchantUserRole') THEN
    CREATE TYPE "MerchantUserRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "MerchantUser" (
  "id" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "clerkId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "firstName" TEXT,
  "lastName" TEXT,
  "avatarUrl" TEXT,
  "role" "MerchantUserRole" NOT NULL DEFAULT 'MEMBER',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "lastLoginAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MerchantUser_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MerchantUser_clerkId_key" ON "MerchantUser"("clerkId");
CREATE INDEX IF NOT EXISTS "MerchantUser_merchantId_idx" ON "MerchantUser"("merchantId");
CREATE INDEX IF NOT EXISTS "MerchantUser_clerkId_idx" ON "MerchantUser"("clerkId");
CREATE INDEX IF NOT EXISTS "MerchantUser_email_idx" ON "MerchantUser"("email");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'MerchantUser_merchantId_fkey'
  ) THEN
    ALTER TABLE "MerchantUser"
    ADD CONSTRAINT "MerchantUser_merchantId_fkey"
    FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
