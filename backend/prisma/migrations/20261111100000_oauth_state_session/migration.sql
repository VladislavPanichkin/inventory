-- Bind each OAuth `state` to the admin session that started the eBay connect flow.
-- Existing states (10-minute lifetime, never bound to a session) are discarded.
DELETE FROM "oauth_states";

-- AlterTable
ALTER TABLE "oauth_states" ADD COLUMN "adminSessionId" UUID NOT NULL;

-- AddForeignKey
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_adminSessionId_fkey" FOREIGN KEY ("adminSessionId") REFERENCES "admin_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
