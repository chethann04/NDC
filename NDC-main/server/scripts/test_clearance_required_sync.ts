import prisma from '../src/config/prisma';
import { DepartmentController } from '../src/controllers/DepartmentController';
import { NdcWorkflowService } from '../src/services/NdcWorkflowService';
import { departmentCache } from '../src/utils/departmentCache';
import { DepartmentClearanceStatus, NdcRequestStatus } from '../src/constants/statuses';
import { CertificateService } from '../src/services/CertificateService';
import { LaboratoryAggregationService } from '../src/services/LaboratoryAggregationService';
import crypto from 'crypto';

async function runTests() {
  console.log('================================================================');
  console.log('TESTING CLEARANCE REQUIRED (MANDATORY STATUS) SYNC');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`[PASS] ${msg}`);
      passed++;
    } else {
      console.error(`[FAIL] ${msg}`);
      failed++;
    }
  }

  // 1. Setup Test Department & Student
  const testDeptCode = `T_${Date.now().toString().slice(-5)}`;
  const testDept = await prisma.clearanceDepartment.create({
    data: {
      name: `Test Sync Dept ${testDeptCode}`,
      code: testDeptCode,
      description: 'Department to test mandatory status sync',
      requiresClearance: true,
      isAcademicBranch: false,
      displayOrder: 99,
      isActive: true
    }
  });

  // Ensure ISE department exists
  let iseDept = await prisma.clearanceDepartment.findFirst({ where: { code: 'IS' } });
  if (!iseDept) {
    iseDept = await prisma.clearanceDepartment.create({
      data: { name: 'Information Science & Engineering', code: 'IS', isAcademicBranch: true, requiresClearance: true }
    });
  }

  const testUsn = `4MC22IS${Math.floor(100 + Math.random() * 900)}`;
  const student = await prisma.student.create({
    data: {
      studentId: `STU-${testUsn}`,
      usn: testUsn,
      fullName: 'Sync Test Student',
      email: `${testUsn.toLowerCase()}@mce.ac.in`,
      departmentId: iseDept.id,
      batch: '2022-2026',
      academicYear: '2025-2026',
      isActive: true
    }
  });

  // Initialize NDC for student
  const ndcRequest = await NdcWorkflowService.initializeNewStudentNdc(student.id, iseDept.id);
  assert(!!ndcRequest, 'NDC Request created for student');

  // Verify test department clearance was initialized
  const initialClearance = await prisma.ndcClearance.findFirst({
    where: { ndcRequestId: ndcRequest.id, departmentId: testDept.id }
  });
  assert(!!initialClearance && initialClearance.status === 'PENDING', 'Initial clearance for test department is PENDING');

  // Clear all other clearances except test department
  await prisma.ndcClearance.updateMany({
    where: {
      ndcRequestId: ndcRequest.id,
      departmentId: { not: testDept.id }
    },
    data: { status: DepartmentClearanceStatus.CLEARED }
  });

  // Re-check status: with testDept PENDING, NDC request should be IN_PROGRESS
  let currentStatus = await NdcWorkflowService.checkAndUpdateNdcStatus(ndcRequest.id);
  assert(currentStatus === NdcRequestStatus.IN_PROGRESS, 'NDC request status is IN_PROGRESS while testDept is PENDING');

  // Query real admin user for audit log foreign key
  const adminUser = await prisma.user.findFirst({ where: { role: 'ADMIN' } });

  // Simulate Admin PUT /departments/:id
  const mockReq: any = {
    params: { id: testDept.id },
    body: { requiresClearance: false },
    user: { id: adminUser?.id, role: 'ADMIN', name: adminUser?.name || 'Admin User' }
  };
  let resStatus = 0;
  let resBody: any = null;
  const mockRes: any = {
    status: (code: number) => {
      resStatus = code;
      return {
        json: (data: any) => { resBody = data; }
      };
    }
  };

  await DepartmentController.updateDepartment(mockReq, mockRes);
  assert(resStatus === 200, 'DepartmentController.updateDepartment responded with 200');

  // Verify in DB that requiresClearance is now false
  const updatedDept = await prisma.clearanceDepartment.findUnique({ where: { id: testDept.id } });
  assert(updatedDept?.requiresClearance === false, 'Department requiresClearance in DB is now FALSE');

  // Verify cache invalidated
  const cachedDepts = await departmentCache.getAllActiveDepartments();
  const cachedTestDept = cachedDepts.find((d) => d.id === testDept.id);
  assert(cachedTestDept?.requiresClearance === false, 'departmentCache immediately reflects requiresClearance = FALSE');

  // Verify student clearance was synced to NOT_APPLICABLE
  const syncedClearance = await prisma.ndcClearance.findFirst({
    where: { ndcRequestId: ndcRequest.id, departmentId: testDept.id }
  });
  assert(syncedClearance?.status === 'NOT_APPLICABLE', 'Student clearance for test department automatically updated to NOT_APPLICABLE');

  // Verify NDC Request automatically transitioned to APPROVED because all mandatory items are now cleared
  const updatedRequest = await prisma.ndcRequest.findUnique({ where: { id: ndcRequest.id } });
  assert(updatedRequest?.status === NdcRequestStatus.APPROVED, 'NDC Request status automatically updated to APPROVED');

  // Verify presentation aggregation excludes exempt department
  const studentClearances = await prisma.ndcClearance.findMany({
    where: { ndcRequestId: ndcRequest.id },
    include: { department: true }
  });
  const presentationItems = LaboratoryAggregationService.aggregateClearancesForPresentation(studentClearances);
  const testDeptInPresentation = presentationItems.find((p: any) => p.departmentId?.code === testDeptCode || p.department?.code === testDeptCode);
  assert(!testDeptInPresentation, 'Exempt department is omitted from presentation items');

  // --- TEST 2: Change Mandatory Status from FALSE to TRUE ---
  console.log('\n--- TEST 2: Admin changes Mandatory Status back to TRUE ---');

  mockReq.body = { requiresClearance: true };
  await DepartmentController.updateDepartment(mockReq, mockRes);
  assert(resStatus === 200, 'DepartmentController.updateDepartment responded with 200');

  // Verify in DB that requiresClearance is now true
  const restoredDept = await prisma.clearanceDepartment.findUnique({ where: { id: testDept.id } });
  assert(restoredDept?.requiresClearance === true, 'Department requiresClearance in DB is now TRUE');

  // Verify cache invalidated
  const refreshedCachedDepts = await departmentCache.getAllActiveDepartments();
  const refreshedCachedTestDept = refreshedCachedDepts.find((d) => d.id === testDept.id);
  assert(refreshedCachedTestDept?.requiresClearance === true, 'departmentCache immediately reflects requiresClearance = TRUE');

  // Verify student clearance was restored to PENDING
  const restoredClearance = await prisma.ndcClearance.findFirst({
    where: { ndcRequestId: ndcRequest.id, departmentId: testDept.id }
  });
  assert(restoredClearance?.status === 'PENDING', 'Student clearance for test department automatically restored to PENDING');

  // Verify NDC Request status was automatically transitioned back to IN_PROGRESS
  const reEvaluatedRequest = await prisma.ndcRequest.findUnique({ where: { id: ndcRequest.id } });
  assert(reEvaluatedRequest?.status === NdcRequestStatus.IN_PROGRESS, 'NDC Request automatically reverted to IN_PROGRESS (not approved until cleared)');

  // Clean up test data
  await prisma.ndcCertificate.deleteMany({ where: { ndcRequestId: ndcRequest.id } });
  await prisma.ndcClearance.deleteMany({ where: { ndcRequestId: ndcRequest.id } });
  await prisma.ndcClearance.deleteMany({ where: { departmentId: testDept.id } });
  await prisma.ndcRequest.delete({ where: { id: ndcRequest.id } });
  await prisma.student.delete({ where: { id: student.id } });
  await prisma.clearanceDepartment.delete({ where: { id: testDept.id } });

  console.log('\n================================================================');
  console.log(`TEST SUITE RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
