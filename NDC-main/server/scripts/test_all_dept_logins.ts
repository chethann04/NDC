import prisma from '../src/config/prisma';
import { comparePassword } from '../src/utils/passwordUtils';

async function testAllDepartmentLogins() {
  console.log('========================================================================');
  console.log('🧪 VERIFYING DYNAMIC FACULTY & HOD AUTHENTICATION ACROSS ALL DEPARTMENTS');
  console.log('========================================================================\n');

  const academicDepts = await prisma.clearanceDepartment.findMany({
    where: { isAcademicBranch: true },
    orderBy: { code: 'asc' }
  });

  const testMatrix: Array<{
    dept: string;
    type: 'FACULTY' | 'HOD';
    login: string;
    pass: string;
    expectedRole: string;
    shouldSucceed: boolean;
  }> = [];

  for (const d of academicDepts) {
    const code = d.code.toUpperCase().trim();
    const lowerCode = code.toLowerCase();

    // Test A: Faculty Email + Correct Password
    testMatrix.push({
      dept: code,
      type: 'FACULTY',
      login: `faculty.${lowerCode}@mce.ac.in`,
      pass: 'Officer@123',
      expectedRole: 'DEPARTMENT_OFFICER',
      shouldSucceed: true
    });

    // Test B: Faculty Login ID + Correct Password
    testMatrix.push({
      dept: code,
      type: 'FACULTY',
      login: `${code}001`,
      pass: 'Officer@123',
      expectedRole: 'DEPARTMENT_OFFICER',
      shouldSucceed: true
    });

    // Test C: HOD Email + Correct Password
    testMatrix.push({
      dept: code,
      type: 'HOD',
      login: `hod.${lowerCode}@mce.ac.in`,
      pass: 'Officer@123',
      expectedRole: 'HOD',
      shouldSucceed: true
    });

    // Test D: HOD Login ID + Correct Password
    testMatrix.push({
      dept: code,
      type: 'HOD',
      login: `HOD-${code}`,
      pass: 'Officer@123',
      expectedRole: 'HOD',
      shouldSucceed: true
    });

    // Test E: Faculty with Wrong Password (Must Fail)
    testMatrix.push({
      dept: code,
      type: 'FACULTY',
      login: `faculty.${lowerCode}@mce.ac.in`,
      pass: 'WrongPassword123!',
      expectedRole: 'DEPARTMENT_OFFICER',
      shouldSucceed: false
    });

    // Test F: HOD with Wrong Password (Must Fail)
    testMatrix.push({
      dept: code,
      type: 'HOD',
      login: `hod.${lowerCode}@mce.ac.in`,
      pass: 'WrongPassword123!',
      expectedRole: 'HOD',
      shouldSucceed: false
    });
  }

  let passed = 0;
  let failed = 0;

  for (const item of testMatrix) {
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { loginId: { equals: item.login, mode: 'insensitive' } },
          { email: { equals: item.login.toLowerCase(), mode: 'insensitive' } },
          { associatedOfficer: { employeeId: { equals: item.login, mode: 'insensitive' } } }
        ]
      },
      include: {
        department: true,
        associatedOfficer: true
      }
    });

    if (item.shouldSucceed) {
      if (!user) {
        console.error(`❌ [FAIL] ${item.dept} ${item.type}: User [${item.login}] NOT found in DB.`);
        failed++;
        continue;
      }

      const isMatch = await comparePassword(item.pass, user.passwordHash);
      if (!isMatch) {
        console.error(`❌ [FAIL] ${item.dept} ${item.type}: Password mismatch for [${item.login}].`);
        failed++;
        continue;
      }

      if (user.role !== item.expectedRole) {
        console.error(`❌ [FAIL] ${item.dept} ${item.type}: Role mismatch for [${item.login}]. Expected [${item.expectedRole}], got [${user.role}].`);
        failed++;
        continue;
      }

      if (user.department?.code !== item.dept) {
        console.error(`❌ [FAIL] ${item.dept} ${item.type}: Dept mismatch for [${item.login}]. Expected [${item.dept}], got [${user.department?.code}].`);
        failed++;
        continue;
      }

      console.log(`✅ [PASS] ${item.dept.padEnd(5)} | ${item.type.padEnd(8)} | Login: ${item.login.padEnd(25)} -> Resolved User: ${user.name} | Role: ${user.role} | Dept: ${user.department?.code}`);
      passed++;
    } else {
      // Negative tests: wrong password
      if (!user) {
        console.log(`✅ [PASS] ${item.dept.padEnd(5)} | ${item.type.padEnd(8)} | Negative test for [${item.login}] passed (user not found).`);
        passed++;
        continue;
      }

      const isMatch = await comparePassword(item.pass, user.passwordHash);
      if (isMatch) {
        console.error(`❌ [FAIL] ${item.dept} ${item.type}: Wrong password unexpectedly SUCCEEDED for [${item.login}].`);
        failed++;
      } else {
        console.log(`✅ [PASS] ${item.dept.padEnd(5)} | ${item.type.padEnd(8)} | Wrong password rejected correctly for [${item.login}].`);
        passed++;
      }
    }
  }

  console.log('\n========================================================================');
  console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

testAllDepartmentLogins()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
