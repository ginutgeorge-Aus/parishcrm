-- ParishCRM baseline: the full schema as of v1.0.0, generated from
-- prisma/schema.prisma, plus the database-level rules Prisma cannot express
-- (appended at the end).

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "FamilyStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'VISITOR');

-- CreateEnum
CREATE TYPE "FamilyRole" AS ENUM ('HEAD', 'SPOUSE', 'CHILD', 'OTHER');

-- CreateEnum
CREATE TYPE "Classification" AS ENUM ('MEMBER', 'VISITOR', 'INACTIVE', 'STUDENT');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('SENT', 'SUBMITTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'PASTOR', 'VIEWER', 'AUDITOR', 'OFFICE_ADMIN', 'EVENT_ORGANISER');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "AccountKind" AS ENUM ('BANK', 'CASH');

-- CreateEnum
CREATE TYPE "EventImageKind" AS ENUM ('BANNER', 'POSTER');

-- CreateEnum
CREATE TYPE "CheckoutStatus" AS ENUM ('OPEN', 'COMPLETED', 'EXPIRED', 'UNFULFILLED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PettyCashSessionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('BUG', 'FEATURE', 'SUGGESTION');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'RESOLVED', 'DECLINED');

-- CreateEnum
CREATE TYPE "CheckpointStatus" AS ENUM ('WORKING', 'BROKEN');

-- CreateEnum
CREATE TYPE "BrandingSlot" AS ENUM ('LOGO', 'CREST', 'CREST_HEADER', 'ICON', 'LETTERHEAD');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "Family" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "memberNo" TEXT,
    "address" TEXT,
    "suburb" TEXT,
    "state" TEXT,
    "postcode" TEXT,
    "homePhone" TEXT,
    "status" "FamilyStatus" NOT NULL DEFAULT 'ACTIVE',
    "joinedDate" TIMESTAMP(3),
    "marriageDate" TIMESTAMP(3),
    "monthlyDues" DECIMAL(10,2),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Family_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Person" (
    "id" SERIAL NOT NULL,
    "familyId" INTEGER NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "middleName" TEXT,
    "title" TEXT,
    "suffix" TEXT,
    "gender" "Gender",
    "dateOfBirth" TEXT,
    "role" "FamilyRole" NOT NULL DEFAULT 'OTHER',
    "classification" "Classification" NOT NULL DEFAULT 'MEMBER',
    "email" TEXT,
    "emailHash" TEXT,
    "mobile" TEXT,
    "mobileHash" TEXT,
    "workPhone" TEXT,
    "homePhone" TEXT,
    "photoUrl" TEXT,
    "membershipDate" TIMESTAMP(3),
    "baptismDate" TIMESTAMP(3),
    "notes" TEXT,
    "profession" TEXT,
    "motherParish" TEXT,
    "maritalStatus" TEXT,
    "pastoralNotes" TEXT,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "emailConsent" BOOLEAN NOT NULL DEFAULT true,
    "consentUpdatedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "bankingName" TEXT,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'VIEWER',
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "otpCode" TEXT,
    "otpExpiresAt" TIMESTAMP(3),
    "failedOtpAttempts" INTEGER NOT NULL DEFAULT 0,
    "otpLockedUntil" TIMESTAMP(3),
    "passwordResetToken" TEXT,
    "passwordResetExpires" TIMESTAMP(3),
    "sessionsValidFrom" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustedDevice" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrustedDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "type" "ReportType" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "issueNumber" INTEGER NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "pageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckpointResult" (
    "id" SERIAL NOT NULL,
    "checkpointId" TEXT NOT NULL,
    "status" "CheckpointStatus" NOT NULL,
    "testedById" INTEGER,
    "testedAt" TIMESTAMP(3),
    "issueNumber" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckpointResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FamilyUpdateInvite" (
    "id" SERIAL NOT NULL,
    "familyId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" "InviteStatus" NOT NULL DEFAULT 'SENT',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),

    CONSTRAINT "FamilyUpdateInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FamilyUpdateSubmission" (
    "id" SERIAL NOT NULL,
    "familyId" INTEGER NOT NULL,
    "inviteId" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FamilyUpdateSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountGroup" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AccountGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fund" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Fund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "groupId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" SERIAL NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "type" "TransactionType" NOT NULL,
    "accountId" INTEGER NOT NULL,
    "familyId" INTEGER,
    "personId" INTEGER,
    "isGiving" BOOLEAN NOT NULL DEFAULT false,
    "paymentAccountId" INTEGER,
    "reference" TEXT,
    "bankRef" TEXT,
    "reconciled" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "pettyCashReceiptId" INTEGER,
    "pettyCashExpenseId" INTEGER,
    "pettyCashTransferId" INTEGER,
    "fundId" INTEGER,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionAttachment" (
    "id" SERIAL NOT NULL,
    "transactionId" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedById" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransactionAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptSend" (
    "id" SERIAL NOT NULL,
    "transactionId" INTEGER NOT NULL,
    "sentTo" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentById" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,

    CONSTRAINT "ReceiptSend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentReminderSend" (
    "id" SERIAL NOT NULL,
    "registrationId" INTEGER NOT NULL,
    "sentTo" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentById" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,

    CONSTRAINT "PaymentReminderSend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Budget" (
    "id" SERIAL NOT NULL,
    "year" INTEGER NOT NULL,
    "accountId" INTEGER NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "note" TEXT,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CelebrationSend" (
    "id" SERIAL NOT NULL,
    "personId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "sendDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CelebrationSend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAccount" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "AccountKind" NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'worship',
    "kind" TEXT NOT NULL DEFAULT 'one_off',
    "date" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "recurs" TEXT,
    "recursLabel" TEXT,
    "startTime" TEXT,
    "location" TEXT,
    "slug" TEXT NOT NULL,
    "volunteerToken" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "registrationClosed" BOOLEAN NOT NULL DEFAULT false,
    "registrationDeadline" TIMESTAMP(3),
    "bankBsb" TEXT,
    "bankAccount" TEXT,
    "onlinePaymentEnabled" BOOLEAN NOT NULL DEFAULT false,
    "passCardFee" BOOLEAN NOT NULL DEFAULT false,
    "familyWaiverEnabled" BOOLEAN NOT NULL DEFAULT false,
    "familyWaiverThreshold" INTEGER NOT NULL DEFAULT 4,
    "tieredPricingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "familyPricingTiers" JSONB,
    "customQuestions" JSONB,
    "organizers" JSONB,
    "imageUrl" TEXT,
    "reminderDaysBefore" INTEGER,
    "reminderSentAt" TIMESTAMP(3),
    "reminderClaimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventManager" (
    "id" SERIAL NOT NULL,
    "eventId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventManager_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckoutSession" (
    "id" SERIAL NOT NULL,
    "stripeSessionId" TEXT NOT NULL,
    "eventId" INTEGER NOT NULL,
    "status" "CheckoutStatus" NOT NULL DEFAULT 'OPEN',
    "payload" TEXT NOT NULL,
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "surchargeCents" INTEGER NOT NULL DEFAULT 0,
    "publicToken" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "anonymizedAt" TIMESTAMP(3),
    "registrationId" INTEGER,

    CONSTRAINT "CheckoutSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventImage" (
    "id" SERIAL NOT NULL,
    "eventId" INTEGER NOT NULL,
    "kind" "EventImageKind" NOT NULL,
    "data" BYTEA NOT NULL,
    "mimeType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketType" (
    "id" SERIAL NOT NULL,
    "eventId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "capacity" INTEGER,
    "countsTowardWaiver" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Waitlist" (
    "id" SERIAL NOT NULL,
    "eventId" INTEGER NOT NULL,
    "ticketTypeId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailHash" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "anonymizedAt" TIMESTAMP(3),

    CONSTRAINT "Waitlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Registration" (
    "id" SERIAL NOT NULL,
    "eventId" INTEGER NOT NULL,
    "publicToken" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailHash" TEXT,
    "phone" TEXT,
    "customAnswers" JSONB,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paymentRef" TEXT,
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "anonymizedAt" TIMESTAMP(3),

    CONSTRAINT "Registration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistrationItem" (
    "id" SERIAL NOT NULL,
    "registrationId" INTEGER NOT NULL,
    "ticketTypeId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "RegistrationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendee" (
    "id" SERIAL NOT NULL,
    "registrationItemId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "answers" JSONB,
    "checkedInAt" TIMESTAMP(3),

    CONSTRAINT "Attendee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceType" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PettyCashSession" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "status" "PettyCashSessionStatus" NOT NULL DEFAULT 'OPEN',
    "custodianId" INTEGER NOT NULL,
    "openingBalance" DECIMAL(10,2) NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "notes" TEXT,
    "countedCash" DECIMAL(10,2),
    "closingVariance" DECIMAL(10,2),

    CONSTRAINT "PettyCashSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PettyCashReceipt" (
    "id" SERIAL NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "serviceTypeId" INTEGER,
    "accountId" INTEGER NOT NULL,
    "personId" INTEGER,
    "amount" DECIMAL(10,2) NOT NULL,
    "notes" TEXT,
    "importKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fundId" INTEGER,

    CONSTRAINT "PettyCashReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PettyCashExpense" (
    "id" SERIAL NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "payee" TEXT NOT NULL,
    "accountId" INTEGER NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "description" TEXT NOT NULL,
    "receiptRef" TEXT,
    "importKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fundId" INTEGER,

    CONSTRAINT "PettyCashExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PettyCashTransfer" (
    "id" SERIAL NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "retainedFloat" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "depositSlipRef" TEXT,
    "depositedByName" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PettyCashTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "BrandingAsset" (
    "slot" "BrandingSlot" NOT NULL,
    "bytes" BYTEA NOT NULL,
    "mimeType" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandingAsset_pkey" PRIMARY KEY ("slot")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" INTEGER,
    "metadata" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountOpeningBalance" (
    "id" SERIAL NOT NULL,
    "paymentAccountId" INTEGER NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "asOfDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountOpeningBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationStatement" (
    "id" SERIAL NOT NULL,
    "paymentAccountId" INTEGER NOT NULL,
    "statementDate" TIMESTAMP(3) NOT NULL,
    "closingBalance" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReconciliationStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "resetAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "key" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "intro" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "signoff" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" INTEGER,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "DgrReceipt" (
    "id" SERIAL NOT NULL,
    "receiptNo" TEXT NOT NULL,
    "fyEndYear" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL,
    "personId" INTEGER,
    "donorName" TEXT NOT NULL,
    "donorEmail" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "sentAt" TIMESTAMP(3),
    "sentById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER NOT NULL,
    "errorMessage" TEXT,

    CONSTRAINT "DgrReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipApplication" (
    "id" SERIAL NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "signature" TEXT NOT NULL,
    "applicantName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailHash" TEXT,
    "mobile" TEXT,
    "mobileHash" TEXT,
    "placeSigned" TEXT,
    "signedDate" TIMESTAMP(3),
    "monthlyDues" DECIMAL(10,2),
    "linkedFamilyId" INTEGER,
    "reviewedById" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "anonymizedAt" TIMESTAMP(3),

    CONSTRAINT "MembershipApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErrorLog" (
    "id" SERIAL NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "errorType" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "route" TEXT,
    "method" TEXT,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErrorLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteViewDaily" (
    "id" SERIAL NOT NULL,
    "route" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RouteViewDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Family_memberNo_key" ON "Family"("memberNo");

-- CreateIndex
CREATE INDEX "Family_archivedAt_idx" ON "Family"("archivedAt");

-- CreateIndex
CREATE INDEX "Family_status_idx" ON "Family"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Family_name_key" ON "Family"("name");

-- CreateIndex
CREATE INDEX "Person_archivedAt_idx" ON "Person"("archivedAt");

-- CreateIndex
CREATE INDEX "Person_familyId_idx" ON "Person"("familyId");

-- CreateIndex
CREATE INDEX "Person_classification_idx" ON "Person"("classification");

-- CreateIndex
CREATE INDEX "Person_emailHash_idx" ON "Person"("emailHash");

-- CreateIndex
CREATE INDEX "Person_mobileHash_idx" ON "Person"("mobileHash");

-- CreateIndex
CREATE INDEX "Person_lastName_firstName_idx" ON "Person"("lastName", "firstName");

-- CreateIndex
CREATE INDEX "Person_archivedAt_role_idx" ON "Person"("archivedAt", "role");

-- CreateIndex
CREATE INDEX "Person_mobile_idx" ON "Person"("mobile");

-- CreateIndex
CREATE UNIQUE INDEX "Person_familyId_firstName_lastName_key" ON "Person"("familyId", "firstName", "lastName");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_passwordResetToken_key" ON "User"("passwordResetToken");

-- CreateIndex
CREATE UNIQUE INDEX "TrustedDevice_tokenHash_key" ON "TrustedDevice"("tokenHash");

-- CreateIndex
CREATE INDEX "TrustedDevice_userId_idx" ON "TrustedDevice"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Report_issueNumber_key" ON "Report"("issueNumber");

-- CreateIndex
CREATE INDEX "Report_userId_idx" ON "Report"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckpointResult_checkpointId_key" ON "CheckpointResult"("checkpointId");

-- CreateIndex
CREATE UNIQUE INDEX "FamilyUpdateInvite_tokenHash_key" ON "FamilyUpdateInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "FamilyUpdateInvite_familyId_idx" ON "FamilyUpdateInvite"("familyId");

-- CreateIndex
CREATE INDEX "FamilyUpdateInvite_status_idx" ON "FamilyUpdateInvite"("status");

-- CreateIndex
CREATE INDEX "FamilyUpdateSubmission_familyId_idx" ON "FamilyUpdateSubmission"("familyId");

-- CreateIndex
CREATE INDEX "FamilyUpdateSubmission_status_idx" ON "FamilyUpdateSubmission"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AccountGroup_name_type_key" ON "AccountGroup"("name", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Fund_name_key" ON "Fund"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Account_code_key" ON "Account"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_bankRef_key" ON "Transaction"("bankRef");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_pettyCashReceiptId_key" ON "Transaction"("pettyCashReceiptId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_pettyCashExpenseId_key" ON "Transaction"("pettyCashExpenseId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_pettyCashTransferId_key" ON "Transaction"("pettyCashTransferId");

-- CreateIndex
CREATE INDEX "Transaction_date_idx" ON "Transaction"("date");

-- CreateIndex
CREATE INDEX "Transaction_accountId_idx" ON "Transaction"("accountId");

-- CreateIndex
CREATE INDEX "Transaction_familyId_idx" ON "Transaction"("familyId");

-- CreateIndex
CREATE INDEX "Transaction_personId_idx" ON "Transaction"("personId");

-- CreateIndex
CREATE INDEX "Transaction_type_idx" ON "Transaction"("type");

-- CreateIndex
CREATE INDEX "Transaction_fundId_idx" ON "Transaction"("fundId");

-- CreateIndex
CREATE INDEX "Transaction_paymentAccountId_idx" ON "Transaction"("paymentAccountId");

-- CreateIndex
CREATE INDEX "Transaction_reconciled_idx" ON "Transaction"("reconciled");

-- CreateIndex
CREATE INDEX "Transaction_isGiving_idx" ON "Transaction"("isGiving");

-- CreateIndex
CREATE INDEX "Transaction_paymentAccountId_reconciled_date_idx" ON "Transaction"("paymentAccountId", "reconciled", "date");

-- CreateIndex
CREATE INDEX "Transaction_paymentAccountId_type_date_idx" ON "Transaction"("paymentAccountId", "type", "date");

-- CreateIndex
CREATE INDEX "Transaction_isGiving_type_date_idx" ON "Transaction"("isGiving", "type", "date");

-- CreateIndex
CREATE INDEX "Transaction_familyId_isGiving_date_idx" ON "Transaction"("familyId", "isGiving", "date");

-- CreateIndex
CREATE INDEX "Transaction_personId_isGiving_date_idx" ON "Transaction"("personId", "isGiving", "date");

-- CreateIndex
CREATE INDEX "Transaction_isGiving_familyId_date_idx" ON "Transaction"("isGiving", "familyId", "date");

-- CreateIndex
CREATE INDEX "TransactionAttachment_transactionId_idx" ON "TransactionAttachment"("transactionId");

-- CreateIndex
CREATE INDEX "ReceiptSend_transactionId_idx" ON "ReceiptSend"("transactionId");

-- CreateIndex
CREATE INDEX "ReceiptSend_sentAt_idx" ON "ReceiptSend"("sentAt");

-- CreateIndex
CREATE INDEX "PaymentReminderSend_registrationId_idx" ON "PaymentReminderSend"("registrationId");

-- CreateIndex
CREATE INDEX "PaymentReminderSend_sentAt_idx" ON "PaymentReminderSend"("sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "Budget_year_accountId_key" ON "Budget"("year", "accountId");

-- CreateIndex
CREATE INDEX "CelebrationSend_sendDate_idx" ON "CelebrationSend"("sendDate");

-- CreateIndex
CREATE UNIQUE INDEX "CelebrationSend_personId_action_sendDate_key" ON "CelebrationSend"("personId", "action", "sendDate");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAccount_name_key" ON "PaymentAccount"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Event_slug_key" ON "Event"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Event_volunteerToken_key" ON "Event"("volunteerToken");

-- CreateIndex
CREATE INDEX "EventManager_userId_idx" ON "EventManager"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "EventManager_eventId_userId_key" ON "EventManager"("eventId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutSession_stripeSessionId_key" ON "CheckoutSession"("stripeSessionId");

-- CreateIndex
CREATE INDEX "CheckoutSession_status_expiresAt_idx" ON "CheckoutSession"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "CheckoutSession_registrationId_idx" ON "CheckoutSession"("registrationId");

-- CreateIndex
CREATE UNIQUE INDEX "EventImage_eventId_kind_key" ON "EventImage"("eventId", "kind");

-- CreateIndex
CREATE INDEX "Waitlist_eventId_idx" ON "Waitlist"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "Waitlist_eventId_ticketTypeId_emailHash_key" ON "Waitlist"("eventId", "ticketTypeId", "emailHash");

-- CreateIndex
CREATE UNIQUE INDEX "Registration_publicToken_key" ON "Registration"("publicToken");

-- CreateIndex
CREATE INDEX "Registration_emailHash_idx" ON "Registration"("emailHash");

-- CreateIndex
CREATE INDEX "Registration_eventId_idx" ON "Registration"("eventId");

-- CreateIndex
CREATE INDEX "Registration_eventId_paymentStatus_idx" ON "Registration"("eventId", "paymentStatus");

-- CreateIndex
CREATE INDEX "Registration_createdAt_idx" ON "Registration"("createdAt");

-- CreateIndex
CREATE INDEX "RegistrationItem_ticketTypeId_idx" ON "RegistrationItem"("ticketTypeId");

-- CreateIndex
CREATE INDEX "RegistrationItem_registrationId_idx" ON "RegistrationItem"("registrationId");

-- CreateIndex
CREATE INDEX "Attendee_registrationItemId_idx" ON "Attendee"("registrationItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceType_name_key" ON "ServiceType"("name");

-- CreateIndex
CREATE INDEX "PettyCashSession_custodianId_idx" ON "PettyCashSession"("custodianId");

-- CreateIndex
CREATE INDEX "PettyCashSession_status_idx" ON "PettyCashSession"("status");

-- CreateIndex
CREATE INDEX "PettyCashSession_openedAt_idx" ON "PettyCashSession"("openedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PettyCashSession_title_key" ON "PettyCashSession"("title");

-- CreateIndex
CREATE INDEX "PettyCashReceipt_sessionId_idx" ON "PettyCashReceipt"("sessionId");

-- CreateIndex
CREATE INDEX "PettyCashReceipt_accountId_idx" ON "PettyCashReceipt"("accountId");

-- CreateIndex
CREATE INDEX "PettyCashReceipt_fundId_idx" ON "PettyCashReceipt"("fundId");

-- CreateIndex
CREATE INDEX "PettyCashReceipt_date_idx" ON "PettyCashReceipt"("date");

-- CreateIndex
CREATE UNIQUE INDEX "PettyCashReceipt_importKey_key" ON "PettyCashReceipt"("importKey");

-- CreateIndex
CREATE INDEX "PettyCashExpense_sessionId_idx" ON "PettyCashExpense"("sessionId");

-- CreateIndex
CREATE INDEX "PettyCashExpense_accountId_idx" ON "PettyCashExpense"("accountId");

-- CreateIndex
CREATE INDEX "PettyCashExpense_fundId_idx" ON "PettyCashExpense"("fundId");

-- CreateIndex
CREATE INDEX "PettyCashExpense_date_idx" ON "PettyCashExpense"("date");

-- CreateIndex
CREATE UNIQUE INDEX "PettyCashExpense_importKey_key" ON "PettyCashExpense"("importKey");

-- CreateIndex
CREATE INDEX "PettyCashTransfer_sessionId_idx" ON "PettyCashTransfer"("sessionId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_resourceType_resourceId_idx" ON "AuditLog"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "AuditLog_resourceType_action_createdAt_idx" ON "AuditLog"("resourceType", "action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_userId_createdAt_idx" ON "AuditLog"("action", "userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AccountOpeningBalance_paymentAccountId_key" ON "AccountOpeningBalance"("paymentAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationStatement_paymentAccountId_statementDate_key" ON "ReconciliationStatement"("paymentAccountId", "statementDate");

-- CreateIndex
CREATE INDEX "RateLimit_resetAt_idx" ON "RateLimit"("resetAt");

-- CreateIndex
CREATE UNIQUE INDEX "DgrReceipt_receiptNo_key" ON "DgrReceipt"("receiptNo");

-- CreateIndex
CREATE INDEX "DgrReceipt_personId_idx" ON "DgrReceipt"("personId");

-- CreateIndex
CREATE INDEX "DgrReceipt_fyEndYear_idx" ON "DgrReceipt"("fyEndYear");

-- CreateIndex
CREATE INDEX "DgrReceipt_createdAt_idx" ON "DgrReceipt"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DgrReceipt_fyEndYear_seq_key" ON "DgrReceipt"("fyEndYear", "seq");

-- CreateIndex
CREATE INDEX "MembershipApplication_status_idx" ON "MembershipApplication"("status");

-- CreateIndex
CREATE INDEX "MembershipApplication_emailHash_idx" ON "MembershipApplication"("emailHash");

-- CreateIndex
CREATE INDEX "MembershipApplication_mobileHash_idx" ON "MembershipApplication"("mobileHash");

-- CreateIndex
CREATE INDEX "ErrorLog_fingerprint_createdAt_idx" ON "ErrorLog"("fingerprint", "createdAt");

-- CreateIndex
CREATE INDEX "ErrorLog_createdAt_idx" ON "ErrorLog"("createdAt");

-- CreateIndex
CREATE INDEX "RouteViewDaily_date_idx" ON "RouteViewDaily"("date");

-- CreateIndex
CREATE UNIQUE INDEX "RouteViewDaily_route_date_key" ON "RouteViewDaily"("route", "date");

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustedDevice" ADD CONSTRAINT "TrustedDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckpointResult" ADD CONSTRAINT "CheckpointResult_testedById_fkey" FOREIGN KEY ("testedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyUpdateInvite" ADD CONSTRAINT "FamilyUpdateInvite_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyUpdateInvite" ADD CONSTRAINT "FamilyUpdateInvite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyUpdateSubmission" ADD CONSTRAINT "FamilyUpdateSubmission_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyUpdateSubmission" ADD CONSTRAINT "FamilyUpdateSubmission_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "FamilyUpdateInvite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyUpdateSubmission" ADD CONSTRAINT "FamilyUpdateSubmission_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AccountGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_paymentAccountId_fkey" FOREIGN KEY ("paymentAccountId") REFERENCES "PaymentAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_pettyCashReceiptId_fkey" FOREIGN KEY ("pettyCashReceiptId") REFERENCES "PettyCashReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_pettyCashExpenseId_fkey" FOREIGN KEY ("pettyCashExpenseId") REFERENCES "PettyCashExpense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_pettyCashTransferId_fkey" FOREIGN KEY ("pettyCashTransferId") REFERENCES "PettyCashTransfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "Fund"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionAttachment" ADD CONSTRAINT "TransactionAttachment_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionAttachment" ADD CONSTRAINT "TransactionAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptSend" ADD CONSTRAINT "ReceiptSend_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptSend" ADD CONSTRAINT "ReceiptSend_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentReminderSend" ADD CONSTRAINT "PaymentReminderSend_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentReminderSend" ADD CONSTRAINT "PaymentReminderSend_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CelebrationSend" ADD CONSTRAINT "CelebrationSend_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventManager" ADD CONSTRAINT "EventManager_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventManager" ADD CONSTRAINT "EventManager_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutSession" ADD CONSTRAINT "CheckoutSession_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutSession" ADD CONSTRAINT "CheckoutSession_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventImage" ADD CONSTRAINT "EventImage_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketType" ADD CONSTRAINT "TicketType_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Waitlist" ADD CONSTRAINT "Waitlist_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Waitlist" ADD CONSTRAINT "Waitlist_ticketTypeId_fkey" FOREIGN KEY ("ticketTypeId") REFERENCES "TicketType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationItem" ADD CONSTRAINT "RegistrationItem_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationItem" ADD CONSTRAINT "RegistrationItem_ticketTypeId_fkey" FOREIGN KEY ("ticketTypeId") REFERENCES "TicketType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendee" ADD CONSTRAINT "Attendee_registrationItemId_fkey" FOREIGN KEY ("registrationItemId") REFERENCES "RegistrationItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PettyCashSession" ADD CONSTRAINT "PettyCashSession_custodianId_fkey" FOREIGN KEY ("custodianId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PettyCashReceipt" ADD CONSTRAINT "PettyCashReceipt_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PettyCashSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PettyCashReceipt" ADD CONSTRAINT "PettyCashReceipt_serviceTypeId_fkey" FOREIGN KEY ("serviceTypeId") REFERENCES "ServiceType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PettyCashReceipt" ADD CONSTRAINT "PettyCashReceipt_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PettyCashReceipt" ADD CONSTRAINT "PettyCashReceipt_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PettyCashReceipt" ADD CONSTRAINT "PettyCashReceipt_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "Fund"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PettyCashExpense" ADD CONSTRAINT "PettyCashExpense_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PettyCashSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PettyCashExpense" ADD CONSTRAINT "PettyCashExpense_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PettyCashExpense" ADD CONSTRAINT "PettyCashExpense_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "Fund"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PettyCashTransfer" ADD CONSTRAINT "PettyCashTransfer_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PettyCashSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountOpeningBalance" ADD CONSTRAINT "AccountOpeningBalance_paymentAccountId_fkey" FOREIGN KEY ("paymentAccountId") REFERENCES "PaymentAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationStatement" ADD CONSTRAINT "ReconciliationStatement_paymentAccountId_fkey" FOREIGN KEY ("paymentAccountId") REFERENCES "PaymentAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DgrReceipt" ADD CONSTRAINT "DgrReceipt_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DgrReceipt" ADD CONSTRAINT "DgrReceipt_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DgrReceipt" ADD CONSTRAINT "DgrReceipt_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipApplication" ADD CONSTRAINT "MembershipApplication_linkedFamilyId_fkey" FOREIGN KEY ("linkedFamilyId") REFERENCES "Family"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipApplication" ADD CONSTRAINT "MembershipApplication_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Database-level rules not expressible in schema.prisma
-- ---------------------------------------------------------------------------

-- At most one active CASH account (petty-cash code assumes a single cash account).
CREATE UNIQUE INDEX "PaymentAccount_one_active_cash"
  ON "PaymentAccount"(("kind")) WHERE "kind" = 'CASH' AND "isActive";

-- At most one default account.
CREATE UNIQUE INDEX "PaymentAccount_one_default"
  ON "PaymentAccount"(("isDefault")) WHERE "isDefault";

-- The default account must be an active BANK account.
ALTER TABLE "PaymentAccount" ADD CONSTRAINT "PaymentAccount_default_is_bank"
  CHECK (NOT "isDefault" OR "kind" = 'BANK');
ALTER TABLE "PaymentAccount" ADD CONSTRAINT "PaymentAccount_default_active_chk"
  CHECK (NOT "isDefault" OR "isActive");

-- AuditLog is append-only. The app role owns its tables, so REVOKE cannot stop
-- UPDATE/DELETE; a trigger fires regardless of ownership. For a legitimate,
-- privileged retention purge, disable triggers for that session only:
--   SET session_replication_role = 'replica';
--   DELETE FROM "AuditLog" WHERE "createdAt" < now() - interval '7 years';
--   RESET session_replication_role;
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only; % is not permitted.', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_mutate
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
