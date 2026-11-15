-- CreateTable
CREATE TABLE "RosterFeedToken" (
    "id" SERIAL NOT NULL,
    "personId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RosterFeedToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RosterFeedToken_personId_key" ON "RosterFeedToken"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "RosterFeedToken_tokenHash_key" ON "RosterFeedToken"("tokenHash");

-- AddForeignKey
ALTER TABLE "RosterFeedToken" ADD CONSTRAINT "RosterFeedToken_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
