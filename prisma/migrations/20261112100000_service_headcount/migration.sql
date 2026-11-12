-- CreateTable
CREATE TABLE "ServiceHeadcount" (
    "id" SERIAL NOT NULL,
    "serviceDate" DATE NOT NULL,
    "serviceTypeId" INTEGER NOT NULL,
    "adults" INTEGER NOT NULL,
    "children" INTEGER NOT NULL,
    "notes" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceHeadcount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceHeadcount_serviceDate_idx" ON "ServiceHeadcount"("serviceDate");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceHeadcount_serviceDate_serviceTypeId_key" ON "ServiceHeadcount"("serviceDate", "serviceTypeId");

-- AddForeignKey
ALTER TABLE "ServiceHeadcount" ADD CONSTRAINT "ServiceHeadcount_serviceTypeId_fkey" FOREIGN KEY ("serviceTypeId") REFERENCES "ServiceType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
