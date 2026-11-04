-- #491: idempotency token for manual petty-cash transfers. Additive and nullable;
-- existing rows keep NULL (Postgres unique indexes allow many NULLs).
ALTER TABLE "PettyCashTransfer" ADD COLUMN "submissionToken" TEXT;

CREATE UNIQUE INDEX "PettyCashTransfer_submissionToken_key" ON "PettyCashTransfer"("submissionToken");
