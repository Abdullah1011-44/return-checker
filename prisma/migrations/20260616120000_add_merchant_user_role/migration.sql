-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('MERCHANT', 'ADMIN');

-- AlterTable
ALTER TABLE "Merchant" ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'MERCHANT';
