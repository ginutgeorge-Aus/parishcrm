-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "frozenPdf" BYTEA;

-- CreateIndex
CREATE INDEX "Invoice_accountId_idx" ON "Invoice"("accountId");
CREATE INDEX "Invoice_fundId_idx" ON "Invoice"("fundId");
