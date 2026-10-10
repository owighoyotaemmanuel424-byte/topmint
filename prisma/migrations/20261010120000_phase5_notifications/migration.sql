-- Phase 5: transaction history and notifications.
--
-- Adds the notification metadata the notification centre needs (type, related
-- resource, idempotency key, read timestamp) plus the indexes behind the
-- server-side filters on the customer transaction history and notification
-- lists. Every new column is nullable or defaulted, so existing notification
-- rows and financial records are preserved unchanged.

CREATE TYPE "NotificationType" AS ENUM (
  'ACCOUNT',
  'DEPOSIT',
  'WITHDRAWAL',
  'INVESTMENT',
  'INVESTMENT_MATURITY',
  'INVESTMENT_EARNING',
  'PAYMENT',
  'SECURITY',
  'ACCOUNT_UPDATE',
  'ANNOUNCEMENT'
);

ALTER TABLE "Notification"
  ADD COLUMN "type" "NotificationType" NOT NULL DEFAULT 'ACCOUNT',
  ADD COLUMN "resourceType" TEXT,
  ADD COLUMN "resourceId" TEXT,
  ADD COLUMN "link" TEXT,
  ADD COLUMN "eventKey" TEXT,
  ADD COLUMN "readAt" TIMESTAMP(3);

-- One notification per (customer, business event). Postgres treats NULLs as
-- distinct in a unique index, so notifications without an event key are
-- unaffected.
CREATE UNIQUE INDEX "Notification_userId_eventKey_key" ON "Notification"("userId", "eventKey");

-- Backs the notification centre's type filter and the newest-first ordering.
CREATE INDEX "Notification_userId_type_createdAt_idx" ON "Notification"("userId", "type", "createdAt");

-- Backs the transaction history status filter alongside the existing
-- (userId, createdAt) index used for ordering.
CREATE INDEX "Transaction_userId_status_createdAt_idx" ON "Transaction"("userId", "status", "createdAt");
