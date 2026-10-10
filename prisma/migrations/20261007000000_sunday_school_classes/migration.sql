-- CreateTable
CREATE TABLE "SundaySchoolClass" (
    "id" SERIAL NOT NULL,
    "year" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "location" TEXT NOT NULL DEFAULT '',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SundaySchoolClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SundaySchoolTeacher" (
    "id" SERIAL NOT NULL,
    "classId" INTEGER NOT NULL,
    "personId" INTEGER NOT NULL,

    CONSTRAINT "SundaySchoolTeacher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SundaySchoolEnrolment" (
    "id" SERIAL NOT NULL,
    "classId" INTEGER NOT NULL,
    "personId" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SundaySchoolEnrolment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SundaySchoolClass_year_archivedAt_idx" ON "SundaySchoolClass"("year", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SundaySchoolClass_year_name_location_key" ON "SundaySchoolClass"("year", "name", "location");

-- CreateIndex
CREATE INDEX "SundaySchoolTeacher_personId_idx" ON "SundaySchoolTeacher"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "SundaySchoolTeacher_classId_personId_key" ON "SundaySchoolTeacher"("classId", "personId");

-- CreateIndex
CREATE INDEX "SundaySchoolEnrolment_classId_idx" ON "SundaySchoolEnrolment"("classId");

-- CreateIndex
CREATE UNIQUE INDEX "SundaySchoolEnrolment_personId_year_key" ON "SundaySchoolEnrolment"("personId", "year");

-- AddForeignKey
ALTER TABLE "SundaySchoolTeacher" ADD CONSTRAINT "SundaySchoolTeacher_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SundaySchoolClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SundaySchoolTeacher" ADD CONSTRAINT "SundaySchoolTeacher_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SundaySchoolEnrolment" ADD CONSTRAINT "SundaySchoolEnrolment_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SundaySchoolClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SundaySchoolEnrolment" ADD CONSTRAINT "SundaySchoolEnrolment_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

