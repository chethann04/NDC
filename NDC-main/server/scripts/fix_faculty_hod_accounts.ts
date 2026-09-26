import prisma from '../src/config/prisma';
import { hashPassword } from '../src/utils/passwordUtils';
import { UserRole } from '../src/constants/roles';

async function migrateAndFixAccounts() {
  console.log('=== STARTING FACULTY & HOD ACCOUNT MIGRATION & REPAIR ===\n');

  const officerPass = await hashPassword('Officer@123');

  // Fetch all academic departments
  const academicDepts = await prisma.clearanceDepartment.findMany({
    where: { isAcademicBranch: true },
    orderBy: { code: 'asc' }
  });

  console.log(`Found ${academicDepts.length} academic branch departments.\n`);

  for (const dept of academicDepts) {
    const code = dept.code.toUpperCase().trim();
    const lowerCode = code.toLowerCase();
    console.log(`--- Processing Department [${code}] - ${dept.name} ---`);

    // 1. Ensure unified DepartmentLab exists
    const labCode = `${code}-LAB`;
    await prisma.departmentLab.upsert({
      where: { departmentId: dept.id },
      update: {
        code: labCode,
        name: `${dept.name} Lab`,
        isActive: true
      },
      create: {
        departmentId: dept.id,
        code: labCode,
        name: `${dept.name} Lab`,
        isActive: true,
        displayOrder: 1
      }
    });

    // 2. Fix/Create HOD Account
    const hodEmail = `hod.${lowerCode}@mce.ac.in`;
    const hodLoginId = `HOD-${code}`;

    let hodUser = await prisma.user.findFirst({
      where: {
        OR: [
          { email: { equals: hodEmail, mode: 'insensitive' } },
          { loginId: { equals: hodLoginId, mode: 'insensitive' } }
        ]
      }
    });

    if (hodUser) {
      // Fix role, departmentId, email, loginId, and password
      hodUser = await prisma.user.update({
        where: { id: hodUser.id },
        data: {
          role: UserRole.HOD,
          departmentId: dept.id,
          email: hodEmail,
          loginId: hodLoginId,
          passwordHash: officerPass,
          isActive: true
        }
      });
      console.log(`  ✓ HOD Account updated: ${hodUser.email} [${hodUser.loginId}] -> Role: HOD`);
    } else {
      const hodName = dept.hodName?.trim() || `Head of Department (${code})`;
      hodUser = await prisma.user.create({
        data: {
          name: hodName,
          email: hodEmail,
          loginId: hodLoginId,
          role: UserRole.HOD,
          departmentId: dept.id,
          passwordHash: officerPass,
          isActive: true,
          mustChangePassword: false
        }
      });
      console.log(`  + HOD Account created: ${hodUser.email} [${hodUser.loginId}] -> Role: HOD`);
    }

    // 3. Fix/Create Faculty Account (role: DEPARTMENT_OFFICER)
    const facultyEmail = `faculty.${lowerCode}@mce.ac.in`;
    const facultyLoginId = `${code}001`;
    const facultyEmpId = `EMP-FAC-${code}-01`;
    const facultyName = `Department Faculty (${code})`;

    // Check if faculty user already exists
    let facultyUser = await prisma.user.findFirst({
      where: {
        OR: [
          { email: { equals: facultyEmail, mode: 'insensitive' } },
          { loginId: { equals: facultyLoginId, mode: 'insensitive' } },
          { loginId: { equals: `FAC-${code}`, mode: 'insensitive' } }
        ]
      }
    });

    if (facultyUser) {
      facultyUser = await prisma.user.update({
        where: { id: facultyUser.id },
        data: {
          role: UserRole.DEPARTMENT_OFFICER, // CRITICAL FIX: Ensure role is DEPARTMENT_OFFICER
          departmentId: dept.id,
          email: facultyEmail,
          loginId: facultyLoginId,
          passwordHash: officerPass,
          name: facultyName,
          isActive: true
        }
      });
      console.log(`  ✓ Faculty Account updated: ${facultyUser.email} [${facultyUser.loginId}] -> Role: DEPARTMENT_OFFICER`);
    } else {
      facultyUser = await prisma.user.create({
        data: {
          name: facultyName,
          email: facultyEmail,
          loginId: facultyLoginId,
          role: UserRole.DEPARTMENT_OFFICER,
          departmentId: dept.id,
          passwordHash: officerPass,
          isActive: true,
          mustChangePassword: false
        }
      });
      console.log(`  + Faculty Account created: ${facultyUser.email} [${facultyUser.loginId}] -> Role: DEPARTMENT_OFFICER`);
    }

    // 4. Ensure linked ClearanceOfficer record exists and is mapped to department
    let officer = await prisma.clearanceOfficer.findFirst({
      where: {
        OR: [
          { userId: facultyUser.id },
          { employeeId: facultyEmpId },
          { email: facultyEmail }
        ]
      }
    });

    if (officer) {
      officer = await prisma.clearanceOfficer.update({
        where: { id: officer.id },
        data: {
          userId: facultyUser.id,
          employeeId: facultyEmpId,
          name: facultyName,
          email: facultyEmail,
          isActive: true
        }
      });
    } else {
      officer = await prisma.clearanceOfficer.create({
        data: {
          userId: facultyUser.id,
          employeeId: facultyEmpId,
          name: facultyName,
          email: facultyEmail,
          isActive: true
        }
      });
    }

    // Link officer to user
    await prisma.user.update({
      where: { id: facultyUser.id },
      data: { associatedOfficerId: officer.id }
    });

    // Map in ClearanceOfficerDepartment
    await prisma.clearanceOfficerDepartment.upsert({
      where: {
        officerId_departmentId: {
          officerId: officer.id,
          departmentId: dept.id
        }
      },
      update: {},
      create: {
        officerId: officer.id,
        departmentId: dept.id
      }
    });

    console.log(`  ✓ Officer mapping linked: ${officer.employeeId} -> Dept: ${dept.code}\n`);
  }

  // Also verify CS and IS legacy aliases cse.officer / ise.officer
  const cseOfficer = await prisma.user.findFirst({ where: { email: 'cse.officer@mce.ac.in' } });
  if (cseOfficer) {
    await prisma.user.update({
      where: { id: cseOfficer.id },
      data: { passwordHash: officerPass, role: UserRole.DEPARTMENT_OFFICER }
    });
  }

  const iseOfficer = await prisma.user.findFirst({ where: { email: 'ise.officer@mce.ac.in' } });
  if (iseOfficer) {
    await prisma.user.update({
      where: { id: iseOfficer.id },
      data: { passwordHash: officerPass, role: UserRole.DEPARTMENT_OFFICER }
    });
  }

  console.log('=== MIGRATION & REPAIR COMPLETE ===');
}

migrateAndFixAccounts()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
