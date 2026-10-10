-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'ABSENT');

-- CreateTable
CREATE TABLE "SundaySchoolSession" (
    "id" SERIAL NOT NULL,
    "classId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SundaySchoolSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SundaySchoolAttendance" (
    "id" SERIAL NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "personId" INTEGER NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "markedAt" TIMESTAMP(3) NOT NULL,
    "markedById" INTEGER,

    CONSTRAINT "SundaySchoolAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SundaySchoolRollMarker" (
    "id" SERIAL NOT NULL,
    "classId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SundaySchoolRollMarker_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SundaySchoolSession_classId_date_key" ON "SundaySchoolSession"("classId", "date");

-- CreateIndex
CREATE INDEX "SundaySchoolAttendance_personId_idx" ON "SundaySchoolAttendance"("personId");

-- CreateIndex
CREATE INDEX "SundaySchoolAttendance_markedById_idx" ON "SundaySchoolAttendance"("markedById");

-- CreateIndex
CREATE UNIQUE INDEX "SundaySchoolAttendance_sessionId_personId_key" ON "SundaySchoolAttendance"("sessionId", "personId");

-- CreateIndex
CREATE INDEX "SundaySchoolRollMarker_userId_idx" ON "SundaySchoolRollMarker"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SundaySchoolRollMarker_classId_userId_key" ON "SundaySchoolRollMarker"("classId", "userId");

-- AddForeignKey
ALTER TABLE "SundaySchoolSession" ADD CONSTRAINT "SundaySchoolSession_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SundaySchoolClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SundaySchoolAttendance" ADD CONSTRAINT "SundaySchoolAttendance_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SundaySchoolSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SundaySchoolAttendance" ADD CONSTRAINT "SundaySchoolAttendance_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SundaySchoolAttendance" ADD CONSTRAINT "SundaySchoolAttendance_markedById_fkey" FOREIGN KEY ("markedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SundaySchoolRollMarker" ADD CONSTRAINT "SundaySchoolRollMarker_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SundaySchoolClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SundaySchoolRollMarker" ADD CONSTRAINT "SundaySchoolRollMarker_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

