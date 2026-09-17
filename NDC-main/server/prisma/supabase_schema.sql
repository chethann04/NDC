-- ==========================================================
-- SUPABASE POSTGRESQL SCHEMA FOR NO DUE CERTIFICATE SYSTEM
-- Run this in Supabase SQL Editor if creating tables directly.
-- ==========================================================

-- 1. Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Create Enums
DO $$ BEGIN
    CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'DEPARTMENT_OFFICER', 'HOD', 'STUDENT');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "NdcRequestStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'APPROVED', 'REJECTED', 'CANCELLED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "DepartmentClearanceStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'DUES_PENDING', 'NOT_APPLICABLE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "CertificateStatus" AS ENUM ('VALID', 'REVOKED', 'REPLACED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 3. Clearance Departments Table
CREATE TABLE IF NOT EXISTS "clearance_departments" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" VARCHAR(255) NOT NULL UNIQUE,
    "code" VARCHAR(50) NOT NULL UNIQUE,
    "description" TEXT DEFAULT '',
    "requiresClearance" BOOLEAN DEFAULT true,
    "isAcademicBranch" BOOLEAN DEFAULT false,
    "displayOrder" INTEGER DEFAULT 0,
    "isActive" BOOLEAN DEFAULT true,
    "hodName" VARCHAR(255) DEFAULT '',
    "hodDesignation" VARCHAR(255) DEFAULT 'Head of the Department',
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Students Table
CREATE TABLE IF NOT EXISTS "students" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "studentId" VARCHAR(100) NOT NULL UNIQUE,
    "usn" VARCHAR(100) NOT NULL UNIQUE,
    "fullName" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(50) DEFAULT '',
    "departmentId" UUID NOT NULL REFERENCES "clearance_departments"("id") ON UPDATE CASCADE ON DELETE RESTRICT,
    "departmentName" VARCHAR(255),
    "section" VARCHAR(20) DEFAULT 'A',
    "batch" VARCHAR(50) DEFAULT '2022-2026',
    "academicYear" VARCHAR(50) DEFAULT '2025-2026',
    "semester" VARCHAR(50) DEFAULT '8th Semester',
    "year" VARCHAR(50) DEFAULT '4th Year',
    "admissionYear" INTEGER DEFAULT 2022,
    "graduationYear" INTEGER DEFAULT 2026,
    "isActive" BOOLEAN DEFAULT true,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_students_email" ON "students"("email");
CREATE INDEX IF NOT EXISTS "idx_students_dept" ON "students"("departmentId");
CREATE INDEX IF NOT EXISTS "idx_students_batch" ON "students"("batch");
CREATE INDEX IF NOT EXISTS "idx_students_academic_year" ON "students"("academicYear");

-- 5. Clearance Officers Table (stub for FK)
CREATE TABLE IF NOT EXISTS "clearance_officers" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" UUID UNIQUE NOT NULL,
    "employeeId" VARCHAR(100) NOT NULL UNIQUE,
    "name" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "isActive" BOOLEAN DEFAULT true,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 6. Users Table
CREATE TABLE IF NOT EXISTS "users" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "email" VARCHAR(255) NOT NULL UNIQUE,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "associatedStudentId" UUID UNIQUE REFERENCES "students"("id") ON UPDATE CASCADE ON DELETE CASCADE,
    "associatedOfficerId" UUID UNIQUE REFERENCES "clearance_officers"("id") ON UPDATE CASCADE ON DELETE CASCADE,
    "departmentId" UUID REFERENCES "clearance_departments"("id") ON UPDATE CASCADE ON DELETE SET NULL,
    "isActive" BOOLEAN DEFAULT true,
    "mustChangePassword" BOOLEAN DEFAULT false,
    "lastLogin" TIMESTAMP WITH TIME ZONE,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Add foreign key back to users from clearance_officers
DO $$ BEGIN
    ALTER TABLE "clearance_officers" ADD CONSTRAINT "fk_officers_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON UPDATE CASCADE ON DELETE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 7. Officer Department Join Table
CREATE TABLE IF NOT EXISTS "clearance_officer_departments" (
    "officerId" UUID NOT NULL REFERENCES "clearance_officers"("id") ON UPDATE CASCADE ON DELETE CASCADE,
    "departmentId" UUID NOT NULL REFERENCES "clearance_departments"("id") ON UPDATE CASCADE ON DELETE CASCADE,
    "assignedAt" TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    PRIMARY KEY ("officerId", "departmentId")
);

-- 8. NDC Certificates (pre-created for NDC Request FK)
CREATE TABLE IF NOT EXISTS "ndc_certificates" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "certificateNumber" VARCHAR(100) NOT NULL UNIQUE,
    "ndcRequestId" UUID NOT NULL,
    "studentId" UUID NOT NULL REFERENCES "students"("id") ON UPDATE CASCADE ON DELETE RESTRICT,
    "studentName" VARCHAR(255),
    "studentUsn" VARCHAR(100),
    "departmentName" VARCHAR(255),
    "issuedAt" TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    "issuedById" UUID REFERENCES "users"("id") ON UPDATE CASCADE ON DELETE SET NULL,
    "pdfPath" TEXT,
    "status" "CertificateStatus" DEFAULT 'VALID' NOT NULL,
    "revokedAt" TIMESTAMP WITH TIME ZONE,
    "revokedById" UUID REFERENCES "users"("id") ON UPDATE CASCADE ON DELETE SET NULL,
    "revocationReason" TEXT,
    "isReplaced" BOOLEAN DEFAULT false,
    "replacementCertificateId" UUID,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 9. NDC Requests Table
CREATE TABLE IF NOT EXISTS "ndc_requests" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "requestNumber" VARCHAR(100) NOT NULL UNIQUE,
    "studentId" UUID NOT NULL REFERENCES "students"("id") ON UPDATE CASCADE ON DELETE CASCADE,
    "status" "NdcRequestStatus" DEFAULT 'PENDING' NOT NULL,
    "submittedAt" TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    "completedAt" TIMESTAMP WITH TIME ZONE,
    "certificateId" UUID UNIQUE REFERENCES "ndc_certificates"("id") ON UPDATE CASCADE ON DELETE SET NULL,
    "remarks" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_ndc_req_student" ON "ndc_requests"("studentId");
CREATE INDEX IF NOT EXISTS "idx_ndc_req_status" ON "ndc_requests"("status");
CREATE INDEX IF NOT EXISTS "idx_ndc_req_submitted" ON "ndc_requests"("submittedAt");

-- Add foreign key back to ndc_requests from ndc_certificates
DO $$ BEGIN
    ALTER TABLE "ndc_certificates" ADD CONSTRAINT "fk_cert_request" FOREIGN KEY ("ndcRequestId") REFERENCES "ndc_requests"("id") ON UPDATE CASCADE ON DELETE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "idx_cert_student" ON "ndc_certificates"("studentId");
CREATE INDEX IF NOT EXISTS "idx_cert_request" ON "ndc_certificates"("ndcRequestId");
CREATE INDEX IF NOT EXISTS "idx_cert_status" ON "ndc_certificates"("status");

-- 10. NDC Clearance Items Table
CREATE TABLE IF NOT EXISTS "ndc_clearances" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "ndcRequestId" UUID NOT NULL REFERENCES "ndc_requests"("id") ON UPDATE CASCADE ON DELETE CASCADE,
    "studentId" UUID NOT NULL REFERENCES "students"("id") ON UPDATE CASCADE ON DELETE CASCADE,
    "departmentId" UUID NOT NULL REFERENCES "clearance_departments"("id") ON UPDATE CASCADE ON DELETE RESTRICT,
    "officerId" UUID REFERENCES "clearance_officers"("id") ON UPDATE CASCADE ON DELETE SET NULL,
    "status" "DepartmentClearanceStatus" DEFAULT 'PENDING' NOT NULL,
    "remarks" TEXT,
    "dueAmount" DOUBLE PRECISION DEFAULT 0,
    "dueDetails" TEXT,
    "reviewedById" UUID REFERENCES "users"("id") ON UPDATE CASCADE ON DELETE SET NULL,
    "reviewedAt" TIMESTAMP WITH TIME ZONE,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT "unique_req_dept" UNIQUE ("ndcRequestId", "departmentId")
);

CREATE INDEX IF NOT EXISTS "idx_clearance_student" ON "ndc_clearances"("studentId");
CREATE INDEX IF NOT EXISTS "idx_clearance_dept" ON "ndc_clearances"("departmentId");
CREATE INDEX IF NOT EXISTS "idx_clearance_status" ON "ndc_clearances"("status");

-- 11. Certificate Sequence Counter Table
CREATE TABLE IF NOT EXISTS "certificate_sequences" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "key" VARCHAR(50) DEFAULT 'NDC' NOT NULL,
    "year" INTEGER NOT NULL,
    "prefix" VARCHAR(50) DEFAULT 'NDC/MCE/' NOT NULL,
    "currentNumber" INTEGER DEFAULT 0 NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT "unique_seq_key_year" UNIQUE ("key", "year")
);

-- 12. Settings Table
CREATE TABLE IF NOT EXISTS "settings" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "collegeName" VARCHAR(255) DEFAULT 'MALNAD COLLEGE OF ENGINEERING' NOT NULL,
    "collegeAddress" TEXT DEFAULT 'Autonomous Institution Affiliated to VTU, Belagavi | Hassan, Karnataka - 573202' NOT NULL,
    "collegeLogoUrl" TEXT DEFAULT '',
    "certificateTitle" VARCHAR(255) DEFAULT 'NO DUE CERTIFICATE' NOT NULL,
    "certificateStatement" TEXT DEFAULT 'has cleared all outstanding financial dues, library books, laboratory equipment, hostel fees, and departmental obligations with the institution.' NOT NULL,
    "certificatePrefix" VARCHAR(50) DEFAULT 'NDC/MCE/' NOT NULL,
    "academicYear" VARCHAR(50) DEFAULT '2025-2026',
    "signatoryName" VARCHAR(255) DEFAULT 'Dr. K. S. Ananth' NOT NULL,
    "signatoryDesignation" VARCHAR(255) DEFAULT 'Dean & Administrative Officer' NOT NULL,
    "footerText" TEXT DEFAULT 'This certificate is generated by the Autonomous No Due Clearance System.' NOT NULL,
    "eligibleBatches" TEXT[] DEFAULT ARRAY['2022-2026', '2023-2027', '2024-2028', '2021-2025']::TEXT[],
    "eligibleYears" TEXT[] DEFAULT ARRAY['4th Year', 'Final Year', '3rd Year']::TEXT[],
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 13. Audit Logs Table
CREATE TABLE IF NOT EXISTS "audit_logs" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" UUID REFERENCES "users"("id") ON UPDATE CASCADE ON DELETE SET NULL,
    "userName" VARCHAR(255) DEFAULT 'SYSTEM' NOT NULL,
    "role" VARCHAR(100) DEFAULT 'SYSTEM' NOT NULL,
    "action" VARCHAR(255) NOT NULL,
    "entityType" VARCHAR(255) NOT NULL,
    "entityId" VARCHAR(255),
    "oldValue" JSONB,
    "newValue" JSONB,
    "description" TEXT NOT NULL,
    "ipAddress" VARCHAR(100),
    "userAgent" TEXT,
    "timestamp" TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_audit_user" ON "audit_logs"("userId");
CREATE INDEX IF NOT EXISTS "idx_audit_action" ON "audit_logs"("action");
CREATE INDEX IF NOT EXISTS "idx_audit_entity_type" ON "audit_logs"("entityType");
CREATE INDEX IF NOT EXISTS "idx_audit_timestamp" ON "audit_logs"("timestamp" DESC);

-- 14. Notifications Table
CREATE TABLE IF NOT EXISTS "notifications" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "recipientUserId" UUID NOT NULL REFERENCES "users"("id") ON UPDATE CASCADE ON DELETE CASCADE,
    "title" VARCHAR(255) NOT NULL,
    "message" TEXT NOT NULL,
    "type" VARCHAR(50) DEFAULT 'INFO' NOT NULL,
    "isRead" BOOLEAN DEFAULT false NOT NULL,
    "relatedEntityId" VARCHAR(255),
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_notif_recipient_read" ON "notifications"("recipientUserId", "isRead");
