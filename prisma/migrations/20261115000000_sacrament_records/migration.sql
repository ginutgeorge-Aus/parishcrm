-- CreateEnum
CREATE TYPE "SacramentType" AS ENUM ('BAPTISM', 'CONFIRMATION', 'MARRIAGE', 'FIRST_COMMUNION');

-- CreateTable
CREATE TABLE "SacramentRecord" (
    "id" SERIAL NOT NULL,
    "type" "SacramentType" NOT NULL,
    "year" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL,
    "registerNo" TEXT NOT NULL,
    "personId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "place" TEXT NOT NULL,
    "ministerName" TEXT,
    "spouseId" INTEGER,
    "spouseName" TEXT,
    "godparents" TEXT,
    "notes" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SacramentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SacramentCounter" (
    "type" "SacramentType" NOT NULL,
    "year" INTEGER NOT NULL,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SacramentCounter_pkey" PRIMARY KEY ("type","year")
);

-- CreateIndex
CREATE UNIQUE INDEX "SacramentRecord_registerNo_key" ON "SacramentRecord"("registerNo");

-- CreateIndex
CREATE INDEX "SacramentRecord_personId_idx" ON "SacramentRecord"("personId");

-- CreateIndex
CREATE INDEX "SacramentRecord_spouseId_idx" ON "SacramentRecord"("spouseId");

-- CreateIndex
CREATE INDEX "SacramentRecord_type_date_idx" ON "SacramentRecord"("type", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SacramentRecord_type_year_seq_key" ON "SacramentRecord"("type", "year", "seq");

-- AddForeignKey
ALTER TABLE "SacramentRecord" ADD CONSTRAINT "SacramentRecord_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SacramentRecord" ADD CONSTRAINT "SacramentRecord_spouseId_fkey" FOREIGN KEY ("spouseId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
