-- Deleting an event must not cascade away CheckoutSession rows (they record card payments).
ALTER TABLE "CheckoutSession" DROP CONSTRAINT "CheckoutSession_eventId_fkey";
ALTER TABLE "CheckoutSession" ADD CONSTRAINT "CheckoutSession_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
