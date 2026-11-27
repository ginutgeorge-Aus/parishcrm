-- AUD-3-12: persist which bank-import deposit claimed a petty-cash session transfer,
-- so a later import cannot match a different deposit to the same transfer.
-- Nullable and additive: existing rows keep NULL (unlinked); no backfill needed.
ALTER TABLE "PettyCashTransfer" ADD COLUMN "linkedDepositBankRef" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PettyCashTransfer_linkedDepositBankRef_key" ON "PettyCashTransfer"("linkedDepositBankRef");
