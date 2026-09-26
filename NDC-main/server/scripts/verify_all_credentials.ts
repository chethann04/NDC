import prisma from '../src/config/prisma';
import { comparePassword } from '../src/utils/passwordUtils';

async function verifyLogins() {
  console.log('--- TESTING STAFF / OFFICER CREDENTIALS ---');

  const testAccounts = [
    { login: 'SUPERADMIN', pass: 'Admin@123', expectedRole: 'SUPER_ADMIN' },
    { login: 'ADMIN001', pass: 'Admin@123', expectedRole: 'ADMIN' },
    { login: 'PHY001', pass: 'Officer@123', expectedRole: 'DEPARTMENT_OFFICER' },
    { login: 'CHEM001', pass: 'Officer@123', expectedRole: 'DEPARTMENT_OFFICER' },
    { login: 'ISE001', pass: 'Officer@123', expectedRole: 'DEPARTMENT_OFFICER' },
    { login: 'CSE001', pass: 'Officer@123', expectedRole: 'DEPARTMENT_OFFICER' },
    { login: 'LIB001', pass: 'Officer@123', expectedRole: 'DEPARTMENT_OFFICER' },
    { login: 'HST001', pass: 'Officer@123', expectedRole: 'DEPARTMENT_OFFICER' },
    { login: 'SPT001', pass: 'Officer@123', expectedRole: 'DEPARTMENT_OFFICER' },
    { login: 'ACC001', pass: 'Officer@123', expectedRole: 'DEPARTMENT_OFFICER' },
    { login: 'ADM001', pass: 'Officer@123', expectedRole: 'DEPARTMENT_OFFICER' },
    { login: 'HOD-IS', pass: 'Officer@123', expectedRole: 'HOD' },
    { login: 'HOD-CS', pass: 'Officer@123', expectedRole: 'HOD' }
  ];

  let passed = 0;
  let failed = 0;

  for (const acc of testAccounts) {
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { loginId: { equals: acc.login, mode: 'insensitive' } },
          { email: { equals: acc.login.toLowerCase(), mode: 'insensitive' } },
          { associatedOfficer: { employeeId: { equals: acc.login, mode: 'insensitive' } } }
        ]
      },
      include: { associatedOfficer: true }
    });

    if (!user) {
      console.error(`❌ User NOT found for login: ${acc.login}`);
      failed++;
      continue;
    }

    const match = await comparePassword(acc.pass, user.passwordHash);
    if (!match) {
      console.error(`❌ Password mismatch for login: ${acc.login}`);
      failed++;
      continue;
    }

    console.log(`✅ [${user.role}] Login: ${acc.login.padEnd(10)} | Email: ${user.email.padEnd(25)} | Name: ${user.name}`);
    passed++;
  }

  console.log('\n--- TESTING STUDENT CREDENTIALS ---');
  const testStudents = [
    { usn: '4MC22IS001', dob: '2004-05-15' },
    { usn: '4MC22CS001', dob: '2004-05-15' },
    { usn: '4MC22EC001', dob: '2004-05-15' }
  ];

  for (const st of testStudents) {
    const student = await prisma.student.findUnique({
      where: { usn: st.usn },
      include: { department: true }
    });

    if (!student) {
      console.error(`❌ Student NOT found for USN: ${st.usn}`);
      failed++;
      continue;
    }

    const birthDate = new Date(st.dob + 'T00:00:00.000Z');
    const dbDobStr = student.dateOfBirth ? student.dateOfBirth.toISOString().split('T')[0] : '';
    if (dbDobStr !== st.dob) {
      console.error(`❌ Student DOB mismatch for USN: ${st.usn}: Expected ${st.dob}, got ${dbDobStr}`);
      failed++;
      continue;
    }

    console.log(`✅ [STUDENT] USN: ${student.usn.padEnd(12)} | DOB: ${st.dob} | Name: ${student.fullName} | Dept: ${student.department?.code}`);
    passed++;
  }

  console.log(`\n========================================`);
  console.log(`RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log(`========================================`);
}

verifyLogins()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
