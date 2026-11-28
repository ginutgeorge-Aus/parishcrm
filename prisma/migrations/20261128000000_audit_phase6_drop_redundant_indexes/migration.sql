-- AUD-6-12: drop unused / redundant indexes. Each single-column index below is the leading prefix of a
-- composite index that stays, or (Person.mobile) is an encrypted column never queried by equality.
DROP INDEX "Person_mobile_idx";
DROP INDEX "Transaction_familyId_idx";
DROP INDEX "Transaction_personId_idx";
DROP INDEX "Transaction_paymentAccountId_idx";
DROP INDEX "Transaction_isGiving_idx";
DROP INDEX "Registration_eventId_idx";
DROP INDEX "ServiceHeadcount_serviceDate_idx";
DROP INDEX "AuditLog_action_idx";
