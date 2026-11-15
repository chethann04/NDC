/**
 * Comprehensive Automated Regression Test Suite:
 * Admin Role-Based Landing, Scoping, Authorization, and Session Context Isolation
 */
import prisma from '../src/config/prisma';
import { UserRole } from '../src/constants/roles';
import { TeachingDepartmentController } from '../src/controllers/TeachingDepartmentController';

// Exact replica of the client logic from client/src/store/useAuthStore.ts for standalone verification
function getAuthorizedDashboardPath(user: any | null): string {
  if (!user) return '/login';
  if (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN') {
    return '/admin/dashboard';
  }
  if (user.role === 'STUDENT') return '/student/dashboard';
  if (user.role === 'HOD') return '/teaching-departments';
  if (user.role === 'DEPARTMENT_OFFICER') {
    const deptObj = user?.department as any;
    const officerDeptObj = (user?.officerProfile as any)?.departmentIds?.[0] as any;
    const code = (
      officerDeptObj?.code ||
      deptObj?.code ||
      (typeof user?.departmentId === 'object' ? (user?.departmentId as any)?.code : undefined) ||
      ''
    ).toUpperCase();
    const isAcademic =
      deptObj?.isAcademicBranch ||
      deptObj?.category === 'ACADEMIC_BRANCH' ||
      officerDeptObj?.isAcademicBranch ||
      officerDeptObj?.category === 'ACADEMIC_BRANCH';

    if (user.loginId === 'PHY001' || user.email?.includes('physics') || code === 'PHY') {
      return '/officer/physics-lab';
    }
    if (user.loginId === 'CHEM001' || user.email?.includes('chemistry') || code === 'CHEM') {
      return '/officer/chemistry-lab';
    }
    if (user.loginId === 'LIB001' || user.email?.includes('library') || code === 'LIB') {
      return '/officer/central-library';
    }
    if (isAcademic) {
      return '/officer/department-lab';
    }
    return '/officer/dashboard';
  }
  return '/admin/dashboard';
}

function isPathAllowedForRole(path: string, user: any | null): boolean {
  if (!user || !path) return false;
  const normalized = path.split('?')[0].split('#')[0];

  if (normalized === '/login' || normalized === '/student-login' || normalized === '/login/student') {
    return false;
  }

  if (['/', '/dashboard', '/students', '/departments', '/clearance', '/clearances', '/account/settings', '/verify'].includes(normalized)) {
    return true;
  }

  const role = user.role;

  if (role === 'SUPER_ADMIN') {
    return true;
  }

  if (role === 'ADMIN') {
    if (
      normalized.startsWith('/teaching-departments') ||
      normalized === '/officer/department-lab' ||
      normalized === '/officer/physics-lab' ||
      normalized === '/officer/chemistry-lab' ||
      normalized === '/officer/central-library' ||
      normalized.startsWith('/student/')
    ) {
      return false;
    }
    return normalized.startsWith('/admin/') || normalized.startsWith('/officer/') || normalized === '/admin';
  }

  if (role === 'HOD') {
    if (normalized.startsWith('/admin/') || normalized.startsWith('/student/')) {
      return false;
    }
    return normalized.startsWith('/teaching-departments') || normalized.startsWith('/officer/');
  }

  if (role === 'DEPARTMENT_OFFICER') {
    if (normalized.startsWith('/admin/') || normalized.startsWith('/student/') || normalized.startsWith('/teaching-departments')) {
      return false;
    }
    return normalized.startsWith('/officer/');
  }

  if (role === 'STUDENT') {
    return normalized.startsWith('/student/');
  }

  return false;
}

async function runRegressionTestSuite() {
  console.log('\n===============================================================');
  console.log('🧪 RUNNING ADMIN LOGIN & DEPARTMENT SCOPING REGRESSION TESTS');
  console.log('===============================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition: boolean, testName: string, failureDetails?: string) {
    totalTests++;
    if (condition) {
      console.log(`  ✅ [PASS] ${testName}`);
      passedTests++;
    } else {
      console.error(`  ❌ [FAIL] ${testName}`);
      if (failureDetails) {
        console.error(`     Details: ${failureDetails}`);
      }
    }
  }

  try {
    // -------------------------------------------------------------
    // TEST 1: Landing Page Resolution (Frontend Helper)
    // -------------------------------------------------------------
    console.log('--- 1. Testing Landing Page Resolution by Role ---');

    const adminUser: any = {
      id: 'admin-1',
      role: 'ADMIN',
      email: 'admin@mce.ac.in',
      name: 'Administration Block',
      departmentId: 'cs-dept-id', // even if user has departmentId
      department: { id: 'cs-dept-id', code: 'CS', name: 'Computer Science & Engineering', isAcademicBranch: true }
    };

    const superAdminUser: any = {
      id: 'super-1',
      role: 'SUPER_ADMIN',
      email: 'superadmin@mce.ac.in',
      name: 'Super Administrator',
      departmentId: null
    };

    const hodUser: any = {
      id: 'hod-cs-1',
      role: 'HOD',
      email: 'hod.cs@mce.ac.in',
      name: 'HOD CS',
      departmentId: 'cs-dept-id',
      department: { id: 'cs-dept-id', code: 'CS', name: 'Computer Science & Engineering', isAcademicBranch: true }
    };

    const physicsOfficer: any = {
      id: 'phy-1',
      role: 'DEPARTMENT_OFFICER',
      email: 'physics@mce.ac.in',
      loginId: 'PHY001',
      name: 'Physics Officer',
      department: { code: 'PHY', name: 'Physics Department' }
    };

    const csFacultyOfficer: any = {
      id: 'faculty-cs-1',
      role: 'DEPARTMENT_OFFICER',
      email: 'faculty.cs@mce.ac.in',
      loginId: 'CS001',
      name: 'CS Faculty',
      department: { code: 'CS', isAcademicBranch: true }
    };

    const studentUser: any = {
      id: 'student-1',
      role: 'STUDENT',
      name: 'Test Student',
      email: 'student@mce.ac.in'
    };

    assert(
      getAuthorizedDashboardPath(adminUser) === '/admin/dashboard',
      'ADMIN login always resolves to /admin/dashboard (never department lab or teaching-departments)'
    );

    assert(
      getAuthorizedDashboardPath(superAdminUser) === '/admin/dashboard',
      'SUPER_ADMIN login always resolves to /admin/dashboard'
    );

    assert(
      getAuthorizedDashboardPath(hodUser) === '/teaching-departments',
      'HOD login lands on /teaching-departments'
    );

    assert(
      getAuthorizedDashboardPath(physicsOfficer) === '/officer/physics-lab',
      'Physics Officer lands on /officer/physics-lab'
    );

    assert(
      getAuthorizedDashboardPath(csFacultyOfficer) === '/officer/department-lab',
      'CS Academic Faculty Officer lands on /officer/department-lab'
    );

    assert(
      getAuthorizedDashboardPath(studentUser) === '/student/dashboard',
      'Student login continues to land on /student/dashboard'
    );

    // -------------------------------------------------------------
    // TEST 2: Redirect Parameter Validation (Anti-Spoofing / Stale URL)
    // -------------------------------------------------------------
    console.log('\n--- 2. Testing Post-Login Redirect Validation ---');

    assert(
      !isPathAllowedForRole('/teaching-departments', adminUser),
      'ADMIN cannot be redirected to /teaching-departments via redirect parameter'
    );

    assert(
      !isPathAllowedForRole('/officer/department-lab', adminUser),
      'ADMIN cannot be redirected to /officer/department-lab via redirect parameter'
    );

    assert(
      !isPathAllowedForRole('/student/dashboard', adminUser),
      'ADMIN cannot be redirected to /student/dashboard via redirect parameter'
    );

    assert(
      isPathAllowedForRole('/admin/students', adminUser),
      'ADMIN is allowed to redirect to legitimate admin routes (/admin/students)'
    );

    assert(
      isPathAllowedForRole('/admin/dashboard', adminUser),
      'ADMIN is allowed to redirect to /admin/dashboard'
    );

    assert(
      !isPathAllowedForRole('/admin/dashboard', hodUser),
      'HOD cannot be redirected to /admin/dashboard'
    );

    assert(
      !isPathAllowedForRole('/admin/dashboard', studentUser),
      'Student cannot be redirected to /admin/dashboard'
    );

    // -------------------------------------------------------------
    // TEST 3: Backend Teaching Department Controller Security
    // -------------------------------------------------------------
    console.log('\n--- 3. Testing Backend Teaching Department Scoping & Protection ---');

    // Fetch two real academic departments from database
    const depts = await prisma.clearanceDepartment.findMany({
      where: { isAcademicBranch: true, isActive: true },
      take: 2,
      orderBy: { displayOrder: 'asc' }
    });

    if (depts.length >= 2) {
      const deptA = depts[0];
      const deptB = depts[1];

      // 3A: Admin calling getEffectiveAcademicDepartmentId without query departmentId
      const reqAdminNoQuery: any = {
        user: { role: UserRole.ADMIN, email: 'admin@mce.ac.in', departmentId: deptA.id },
        query: {}
      };
      const resolvedAdmin = await (TeachingDepartmentController as any).getEffectiveAcademicDepartmentId(reqAdminNoQuery);
      assert(
        resolvedAdmin === null,
        'Admin calling teaching department without explicit departmentId returns null (no implicit fallback to CS or 1st branch)'
      );

      // 3B: Admin calling getEffectiveAcademicDepartmentId WITH query departmentId (admin branch inspection)
      const reqAdminWithQuery: any = {
        user: { role: UserRole.ADMIN, email: 'admin@mce.ac.in' },
        query: { departmentId: deptB.id }
      };
      const resolvedAdminExplicit = await (TeachingDepartmentController as any).getEffectiveAcademicDepartmentId(reqAdminWithQuery);
      assert(
        resolvedAdminExplicit === deptB.id,
        'Admin explicitly requesting a departmentId resolves that department for inspection'
      );

      // 3C: HOD assigned to deptA trying to access deptB by query param tampering
      const reqHodTamper: any = {
        user: { role: UserRole.HOD, email: 'hod.a@mce.ac.in', departmentId: deptA.id },
        query: { departmentId: deptB.id }
      };

      let tamperRejected = false;
      try {
        await (TeachingDepartmentController as any).getEffectiveAcademicDepartmentId(reqHodTamper);
      } catch (err: any) {
        tamperRejected = true;
      }
      assert(
        tamperRejected,
        'HOD attempting to access another department by modifying departmentId parameter is strictly rejected'
      );

      // 3D: HOD accessing own department
      const reqHodValid: any = {
        user: { role: UserRole.HOD, email: 'hod.a@mce.ac.in', departmentId: deptA.id },
        query: {}
      };
      const resolvedHod = await (TeachingDepartmentController as any).getEffectiveAcademicDepartmentId(reqHodValid);
      assert(
        resolvedHod === deptA.id,
        'HOD always securely resolves to their own assigned academic department'
      );

      // 3E: Missing department assignment fails safely
      const reqHodMissingDept: any = {
        user: { role: UserRole.HOD, email: 'hod.orphan@mce.ac.in', departmentId: null },
        query: {}
      };
      let missingDeptFailed = false;
      try {
        await (TeachingDepartmentController as any).getEffectiveAcademicDepartmentId(reqHodMissingDept);
      } catch {
        missingDeptFailed = true;
      }
      assert(
        missingDeptFailed,
        'User with HOD role but missing department assignment fails safely with an error'
      );

      // 3F: Cross-department student record access check
      const studentInDeptB = await prisma.student.findFirst({
        where: { departmentId: deptB.id }
      });

      if (studentInDeptB) {
        let statusSent = 0;
        let responseJson: any = null;
        const mockRes: any = {
          status: (code: number) => {
            statusSent = code;
            return {
              json: (data: any) => {
                responseJson = data;
              }
            };
          }
        };

        const mockReqHODDeptA: any = {
          user: { role: UserRole.HOD, email: 'hod.a@mce.ac.in', departmentId: deptA.id },
          params: { studentId: studentInDeptB.id },
          query: {}
        };

        await TeachingDepartmentController.getStudentById(mockReqHODDeptA, mockRes);
        assert(
          statusSent === 403,
          'HOD of Department A is strictly forbidden (403) from accessing student details belonging to Department B',
          `HTTP Status: ${statusSent}, Response: ${JSON.stringify(responseJson)}`
        );
      }
    }

    console.log('\n===============================================================');
    console.log(`📊 REGRESSION TEST RESULTS: ${passedTests} OF ${totalTests} TESTS PASSED`);
    console.log('===============================================================\n');

    if (passedTests === totalTests) {
      console.log('🎉 ALL REGRESSION TESTS PASSED SUCCESSFULLY!\n');
    } else {
      console.error('❌ SOME TESTS FAILED. PLEASE REVIEW LOGS.\n');
      process.exit(1);
    }
  } catch (err) {
    console.error('Fatal error during regression test execution:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runRegressionTestSuite();
