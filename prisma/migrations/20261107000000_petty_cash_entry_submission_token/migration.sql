-- #487: idempotency token for manual petty-cash receipts and expenses (same
-- mechanism as #491 for transfers). Additive and nullable; existing rows keep
-- NULL (Postgres unique indexes allow many NULLs).
ALTER TABLE "PettyCashReceipt" ADD COLUMN "submissionToken" TEXT;
ALTER TABLE "PettyCashExpense" ADD COLUMN "submissionToken" TEXT;

CREATE UNIQUE INDEX "PettyCashReceipt_submissionToken_key" ON "PettyCashReceipt"("submissionToken");
CREATE UNIQUE INDEX "PettyCashExpense_submissionToken_key" ON "PettyCashExpense"("submissionToken");
