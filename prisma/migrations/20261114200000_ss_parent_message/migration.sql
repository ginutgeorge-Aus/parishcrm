-- CreateTable
CREATE TABLE "SundaySchoolMessage" (
    "id" SERIAL NOT NULL,
    "classId" INTEGER NOT NULL,
    "sentById" INTEGER,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SundaySchoolMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SundaySchoolMessageRecipient" (
    "id" SERIAL NOT NULL,
    "messageId" INTEGER NOT NULL,
    "personId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SundaySchoolMessageRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SundaySchoolMessage_classId_createdAt_idx" ON "SundaySchoolMessage"("classId", "createdAt");

-- CreateIndex
CREATE INDEX "SundaySchoolMessageRecipient_status_idx" ON "SundaySchoolMessageRecipient"("status");

-- CreateIndex
CREATE INDEX "SundaySchoolMessageRecipient_personId_idx" ON "SundaySchoolMessageRecipient"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "SundaySchoolMessageRecipient_messageId_personId_key" ON "SundaySchoolMessageRecipient"("messageId", "personId");

-- AddForeignKey
ALTER TABLE "SundaySchoolMessage" ADD CONSTRAINT "SundaySchoolMessage_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SundaySchoolClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SundaySchoolMessage" ADD CONSTRAINT "SundaySchoolMessage_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SundaySchoolMessageRecipient" ADD CONSTRAINT "SundaySchoolMessageRecipient_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "SundaySchoolMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SundaySchoolMessageRecipient" ADD CONSTRAINT "SundaySchoolMessageRecipient_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

