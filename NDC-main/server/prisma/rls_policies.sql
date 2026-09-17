-- ==============================================================================
-- Supabase Row Level Security (RLS) Hardening Policies
-- Run these SQL statements in your Supabase SQL Editor / PostgreSQL terminal
-- ==============================================================================

-- 1. Enable RLS on core tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE ndc_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE ndc_clearances ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ndc_certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE clearance_departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE clearance_officers ENABLE ROW LEVEL SECURITY;
ALTER TABLE clearance_officer_departments ENABLE ROW LEVEL SECURITY;

-- 2. Drop existing policies if re-applying
DROP POLICY IF EXISTS "Students can view own data" ON students;
DROP POLICY IF EXISTS "Admins can manage all students" ON students;
DROP POLICY IF EXISTS "Officers can view/clear own department" ON ndc_clearances;
DROP POLICY IF EXISTS "Students can view own clearances" ON ndc_clearances;
DROP POLICY IF EXISTS "Admins can manage all clearances" ON ndc_clearances;
DROP POLICY IF EXISTS "System can insert audit logs" ON audit_logs;
DROP POLICY IF EXISTS "Admins/Supers can view audit logs" ON audit_logs;
DROP POLICY IF EXISTS "Students can view own ndc requests" ON ndc_requests;
DROP POLICY IF EXISTS "Staff can view all ndc requests" ON ndc_requests;

-- 3. Policies for students table
CREATE POLICY "Students can view own data" ON students
FOR SELECT USING (
  id IN (SELECT "associatedStudentId" FROM users WHERE id = (auth.uid())::text)
);

CREATE POLICY "Admins can manage all students" ON students
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE id = (auth.uid())::text AND role::text IN ('SUPER_ADMIN', 'ADMIN')
  )
);

-- 4. Policies for ndc_clearances (Officer & Student Scoped)
CREATE POLICY "Officers can view/clear own department" ON ndc_clearances
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM clearance_officer_departments cod
    JOIN clearance_officers co ON cod."officerId" = co.id
    JOIN users u ON co."userId" = u.id
    WHERE u.id = (auth.uid())::text AND cod."departmentId" = ndc_clearances."departmentId"
  )
);

CREATE POLICY "Students can view own clearances" ON ndc_clearances
FOR SELECT USING (
  "studentId" IN (SELECT "associatedStudentId" FROM users WHERE id = (auth.uid())::text)
);

CREATE POLICY "Admins can manage all clearances" ON ndc_clearances
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE id = (auth.uid())::text AND role::text IN ('SUPER_ADMIN', 'ADMIN')
  )
);

-- 5. Policies for ndc_requests
CREATE POLICY "Students can view own ndc requests" ON ndc_requests
FOR SELECT USING (
  "studentId" IN (SELECT "associatedStudentId" FROM users WHERE id = (auth.uid())::text)
);

CREATE POLICY "Staff can view all ndc requests" ON ndc_requests
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE id = (auth.uid())::text AND role::text IN ('SUPER_ADMIN', 'ADMIN', 'HOD', 'DEPARTMENT_OFFICER')
  )
);

-- 6. Policies for audit_logs (Append-Only, Admins/Supers Read)
CREATE POLICY "System can insert audit logs" ON audit_logs
FOR INSERT WITH CHECK (true);

CREATE POLICY "Admins/Supers can view audit logs" ON audit_logs
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE id = (auth.uid())::text AND role::text IN ('SUPER_ADMIN', 'ADMIN')
  )
);

