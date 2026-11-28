-- #813: dedicated "when the sweep marked this row EXPIRED" column. Additive and nullable:
-- no backfill needed, rows EXPIRED before this change keep expiredAt NULL and the sweep falls
-- back to expiresAt for them. Rollback: ALTER TABLE "CheckoutSession" DROP COLUMN "expiredAt";
ALTER TABLE "CheckoutSession" ADD COLUMN "expiredAt" TIMESTAMP(3);
