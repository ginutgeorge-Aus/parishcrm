-- CreateEnum
CREATE TYPE "FundraiserPaymentMethod" AS ENUM ('CASH', 'BANK', 'ONLINE');

-- AlterTable
ALTER TABLE "CheckoutSession" ADD COLUMN     "fundraiserEntryId" INTEGER;

-- CreateTable
CREATE TABLE "Fundraiser" (
    "id" SERIAL NOT NULL,
    "eventId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "unitLabel" TEXT NOT NULL DEFAULT 'packet',
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "refPrefix" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Fundraiser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundraiserEntry" (
    "id" SERIAL NOT NULL,
    "fundraiserId" INTEGER NOT NULL,
    "familyId" INTEGER,
    "outsideName" TEXT,
    "outsideEmail" TEXT,
    "outsidePhone" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "publicToken" TEXT NOT NULL,
    "bankRef" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FundraiserEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundraiserPayment" (
    "id" SERIAL NOT NULL,
    "entryId" INTEGER NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "method" "FundraiserPaymentMethod" NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "stripePaymentRef" TEXT,
    "recordedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FundraiserPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundraiserReminderSend" (
    "id" SERIAL NOT NULL,
    "entryId" INTEGER NOT NULL,
    "sentTo" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentById" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,

    CONSTRAINT "FundraiserReminderSend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Fundraiser_eventId_key" ON "Fundraiser"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "FundraiserEntry_publicToken_key" ON "FundraiserEntry"("publicToken");

-- CreateIndex
CREATE UNIQUE INDEX "FundraiserEntry_bankRef_key" ON "FundraiserEntry"("bankRef");

-- CreateIndex
CREATE INDEX "FundraiserEntry_fundraiserId_idx" ON "FundraiserEntry"("fundraiserId");

-- CreateIndex
CREATE UNIQUE INDEX "FundraiserEntry_fundraiserId_familyId_key" ON "FundraiserEntry"("fundraiserId", "familyId");

-- CreateIndex
CREATE UNIQUE INDEX "FundraiserPayment_stripePaymentRef_key" ON "FundraiserPayment"("stripePaymentRef");

-- CreateIndex
CREATE INDEX "FundraiserPayment_entryId_idx" ON "FundraiserPayment"("entryId");

-- CreateIndex
CREATE INDEX "FundraiserReminderSend_entryId_idx" ON "FundraiserReminderSend"("entryId");

-- CreateIndex
CREATE INDEX "FundraiserReminderSend_sentAt_idx" ON "FundraiserReminderSend"("sentAt");

-- CreateIndex
CREATE INDEX "CheckoutSession_fundraiserEntryId_idx" ON "CheckoutSession"("fundraiserEntryId");

-- AddForeignKey
ALTER TABLE "CheckoutSession" ADD CONSTRAINT "CheckoutSession_fundraiserEntryId_fkey" FOREIGN KEY ("fundraiserEntryId") REFERENCES "FundraiserEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fundraiser" ADD CONSTRAINT "Fundraiser_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundraiserEntry" ADD CONSTRAINT "FundraiserEntry_fundraiserId_fkey" FOREIGN KEY ("fundraiserId") REFERENCES "Fundraiser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundraiserEntry" ADD CONSTRAINT "FundraiserEntry_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundraiserPayment" ADD CONSTRAINT "FundraiserPayment_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "FundraiserEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundraiserPayment" ADD CONSTRAINT "FundraiserPayment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundraiserReminderSend" ADD CONSTRAINT "FundraiserReminderSend_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "FundraiserEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundraiserReminderSend" ADD CONSTRAINT "FundraiserReminderSend_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

