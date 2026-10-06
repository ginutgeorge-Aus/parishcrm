-- CreateEnum
CREATE TYPE "MinistryRole" AS ENUM ('STAFF', 'VOLUNTEER', 'SUNDAY_SCHOOL_TEACHER', 'YOUTH_LEADER', 'CHILDREN_MINISTRY', 'OTHER');

-- AlterTable
ALTER TABLE "Person" ADD COLUMN     "ministryRoles" "MinistryRole"[] DEFAULT ARRAY[]::"MinistryRole"[];
