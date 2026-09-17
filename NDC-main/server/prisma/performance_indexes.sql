-- ==============================================================================
-- High-Performance Database Indexes
-- Run these statements in Supabase SQL Editor / PostgreSQL terminal
-- ==============================================================================

-- 1. Speed up active user lookups (used on every authenticated request)
CREATE INDEX IF NOT EXISTS idx_users_id_active ON users(id) WHERE "isActive" = true;

-- 2. Speed up student clearance checks (most common queries in dashboards & queues)
CREATE INDEX IF NOT EXISTS idx_ndc_clearances_request_dept ON ndc_clearances("ndcRequestId", "departmentId");
CREATE INDEX IF NOT EXISTS idx_students_usn ON students(usn);

-- 3. Speed up audit log reads (admin / reports)
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
