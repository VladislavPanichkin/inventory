-- Demo account: every product gets an owner, and accounts get a role.
-- Existing products are assigned to the (single) administrator.

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'DEMO');

-- AlterTable
ALTER TABLE "admin_users" ADD COLUMN     "demoChangesUsed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'ADMIN';

-- AlterTable: added as optional first so existing rows can be assigned before it becomes required.
ALTER TABLE "products" ADD COLUMN     "ownerId" UUID;

UPDATE "products"
SET "ownerId" = (SELECT "id" FROM "admin_users" WHERE "role" = 'ADMIN' ORDER BY "createdAt" ASC LIMIT 1);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "products" WHERE "ownerId" IS NULL) THEN
    RAISE EXCEPTION 'Products exist but there is no administrator to own them. Create the administrator first (ADMIN_EMAIL / ADMIN_PASSWORD), then run the migration again.';
  END IF;
END $$;

ALTER TABLE "products" ALTER COLUMN "ownerId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "products_ownerId_idx" ON "products"("ownerId");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
