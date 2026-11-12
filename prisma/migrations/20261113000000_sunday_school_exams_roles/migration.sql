-- AlterEnum
-- New Sunday school login roles. Postgres 12+ allows several ADD VALUE in one
-- transaction, but a new value cannot be USED until it commits — so the
-- EVENT_ORGANISER -> TEACHER backfill lives in the next migration
-- (20261113000001_teacher_marker_backfill).
ALTER TYPE "UserRole" ADD VALUE 'HEADMASTER';
ALTER TYPE "UserRole" ADD VALUE 'TEACHER';

-- CreateTable
CREATE TABLE "SundaySchoolExam" (
    "id" SERIAL NOT NULL,
    "classId" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "totalMarks" DECIMAL(10,2) NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SundaySchoolExam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SundaySchoolExamResult" (
    "id" SERIAL NOT NULL,
    "examId" INTEGER NOT NULL,
    "personId" INTEGER NOT NULL,
    "score" DECIMAL(10,2) NOT NULL,
    "markedAt" TIMESTAMP(3) NOT NULL,
    "markedById" INTEGER,

    CONSTRAINT "SundaySchoolExamResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SundaySchoolExam_classId_archivedAt_idx" ON "SundaySchoolExam"("classId", "archivedAt");

-- CreateIndex
CREATE INDEX "SundaySchoolExamResult_personId_idx" ON "SundaySchoolExamResult"("personId");

-- CreateIndex
CREATE INDEX "SundaySchoolExamResult_markedById_idx" ON "SundaySchoolExamResult"("markedById");

-- CreateIndex
CREATE UNIQUE INDEX "SundaySchoolExamResult_examId_personId_key" ON "SundaySchoolExamResult"("examId", "personId");

-- AddForeignKey
ALTER TABLE "SundaySchoolExam" ADD CONSTRAINT "SundaySchoolExam_classId_year_fkey" FOREIGN KEY ("classId", "year") REFERENCES "SundaySchoolClass"("id", "year") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SundaySchoolExamResult" ADD CONSTRAINT "SundaySchoolExamResult_examId_fkey" FOREIGN KEY ("examId") REFERENCES "SundaySchoolExam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SundaySchoolExamResult" ADD CONSTRAINT "SundaySchoolExamResult_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SundaySchoolExamResult" ADD CONSTRAINT "SundaySchoolExamResult_markedById_fkey" FOREIGN KEY ("markedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

