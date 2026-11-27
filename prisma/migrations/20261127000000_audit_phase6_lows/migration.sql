-- AUD-6-05: a service type deleted while a receipt is being saved must be refused, not silently blank the receipt.
ALTER TABLE "PettyCashReceipt" DROP CONSTRAINT "PettyCashReceipt_serviceTypeId_fkey";
ALTER TABLE "PettyCashReceipt" ADD CONSTRAINT "PettyCashReceipt_serviceTypeId_fkey"
  FOREIGN KEY ("serviceTypeId") REFERENCES "ServiceType"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

-- AUD-6-11: FK / lookup indexes (Postgres does not index FK columns). paymentRef stays non-unique:
-- a unique constraint needs a duplicate check on the live data first.
CREATE INDEX "TicketType_eventId_idx" ON "TicketType"("eventId");
CREATE INDEX "CheckoutSession_eventId_idx" ON "CheckoutSession"("eventId");
CREATE INDEX "PettyCashReceipt_personId_idx" ON "PettyCashReceipt"("personId");
CREATE INDEX "Registration_paymentRef_idx" ON "Registration"("paymentRef");

-- AUD-6-15: the row trigger blocks UPDATE/DELETE but not TRUNCATE; add a statement-level trigger.
-- For a privileged purge, SET session_replication_role = 'replica' disables this trigger as well.
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable();
