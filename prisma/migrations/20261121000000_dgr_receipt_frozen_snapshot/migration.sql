-- AUD-3-05: freeze issuer details, legal text and the emailed PDF on a sent DGR receipt.
-- Nullable and additive: existing rows keep NULL and render live as before.
ALTER TABLE "DgrReceipt" ADD COLUMN "issuer" JSONB,
ADD COLUMN "frozenPdf" BYTEA;
