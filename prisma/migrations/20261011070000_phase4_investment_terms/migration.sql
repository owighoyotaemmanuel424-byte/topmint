-- Phase 4: investment contract snapshots and idempotent investment references.
CREATE TYPE "InvestmentCalculationMethod" AS ENUM ('SIMPLE_FIXED', 'PRINCIPAL_ONLY');
CREATE TYPE "InvestmentPayoutSchedule" AS ENUM ('AT_MATURITY');

ALTER TABLE "InvestmentPlan"
  ADD COLUMN "calculationMethod" "InvestmentCalculationMethod" NOT NULL DEFAULT 'SIMPLE_FIXED',
  ADD COLUMN "payoutSchedule" "InvestmentPayoutSchedule" NOT NULL DEFAULT 'AT_MATURITY',
  ADD COLUMN "maturityConditions" TEXT,
  ADD COLUMN "riskDisclosure" TEXT,
  ADD COLUMN "feeRate" DECIMAL(8,4) NOT NULL DEFAULT 0,
  ADD COLUMN "termsVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Investment"
  ADD COLUMN "reference" TEXT,
  ADD COLUMN "requestKey" TEXT,
  ADD COLUMN "accruedEarnings" DECIMAL(20,2) NOT NULL DEFAULT 0,
  ADD COLUMN "paidEarnings" DECIMAL(20,2) NOT NULL DEFAULT 0,
  ADD COLUMN "termsSnapshot" JSONB;

-- Preserve existing investments and give them a reference and terms snapshot before making fields required.
UPDATE "Investment" i SET
  "reference" = 'INV-LEGACY-' || upper(substr(md5(i."id"), 1, 20)),
  "termsSnapshot" = jsonb_build_object(
    'planId', p."id", 'planName', p."name", 'description', p."description",
    'minimumAmount', p."minimumAmount"::text, 'maximumAmount', p."maximumAmount"::text,
    'durationDays', p."durationDays", 'returnRate', p."returnRate"::text,
    'calculationMethod', 'SIMPLE_FIXED', 'payoutSchedule', 'AT_MATURITY',
    'maturityConditions', NULL, 'riskDisclosure', 'Legacy investment terms were not recorded at purchase.',
    'feeRate', '0', 'termsVersion', 1, 'currency', 'USD', 'legacySnapshot', true
  )
FROM "InvestmentPlan" p WHERE p."id" = i."planId";
UPDATE "Investment" SET "reference" = 'INV-LEGACY-' || upper(substr(md5("id"), 1, 20)) WHERE "reference" IS NULL;
UPDATE "Investment" SET "termsSnapshot" = '{}'::jsonb WHERE "termsSnapshot" IS NULL;
ALTER TABLE "Investment" ALTER COLUMN "reference" SET NOT NULL;
ALTER TABLE "Investment" ALTER COLUMN "termsSnapshot" SET NOT NULL;
CREATE UNIQUE INDEX "Investment_reference_key" ON "Investment"("reference");
CREATE UNIQUE INDEX "Investment_requestKey_key" ON "Investment"("requestKey");
CREATE INDEX "Investment_reference_idx" ON "Investment"("reference");
