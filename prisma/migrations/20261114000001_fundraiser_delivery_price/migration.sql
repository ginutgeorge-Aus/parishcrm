-- AlterTable
ALTER TABLE "Fundraiser" ADD COLUMN     "deliveryPrice" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "FundraiserEntry" ADD COLUMN     "delivery" BOOLEAN NOT NULL DEFAULT false;
