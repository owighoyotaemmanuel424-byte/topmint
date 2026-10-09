-- Make USD the default for newly created wallets and transactions.
-- Existing rows keep their recorded currency and balances; no automatic FX conversion is performed.
ALTER TABLE "Wallet" ALTER COLUMN "currency" SET DEFAULT 'USD';
ALTER TABLE "Transaction" ALTER COLUMN "currency" SET DEFAULT 'USD';
