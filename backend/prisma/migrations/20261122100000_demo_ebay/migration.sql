-- Simulated eBay for the demo account: remembers whether the demo visitor has "connected"
-- the sample seller account. Always NULL for the administrator.

-- AlterTable
ALTER TABLE "admin_users" ADD COLUMN     "demoEbayConnectedAt" TIMESTAMPTZ(3);
