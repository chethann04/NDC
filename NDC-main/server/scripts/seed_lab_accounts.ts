import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import prisma from '../src/config/prisma';
import { UserRole } from '../src/constants/roles';

dotenv.config();

export async function seedLabAccounts() {
  console.log('[Seed]: Setting up Physics, Chemistry, and Department accounts...');

  const officerPass = await bcrypt.hash('Officer@123', 10);

  // Ensure legacy LAB central desk does NOT require clearance
  await prisma.clearanceDepartment.updateMany({
    where: { code: 'LAB' },
    data: { requiresClearance: false }
  });

  // 1. Upsert Physics Lab Department
  const phyDept = await prisma.clearanceDepartment.upsert({
    where: { code: 'PHY' },
    update: {
      name: 'Physics Lab',
      category: 'COLLEGE_LAB',
      description: 'Physics laboratory apparatus, laser instruments, optics, and experiment handbook clearances',
      isAcademicBranch: false,
      requiresClearance: true,
      displayOrder: 2,
      isActive: true
    },
    create: {
      name: 'Physics Lab',
      code: 'PHY',
      category: 'COLLEGE_LAB',
      description: 'Physics laboratory apparatus, laser instruments, optics, and experiment handbook clearances',
      isAcademicBranch: false,
      requiresClearance: true,
      displayOrder: 2,
      isActive: true
    }
  });
  console.log('[Seed]: Physics Department configured [PHY]:', phyDept.id);

  // 2. Upsert Chemistry Lab Department
  const chemDept = await prisma.clearanceDepartment.upsert({
    where: { code: 'CHEM' },
    update: {
      name: 'Chemistry Lab',
      category: 'COLLEGE_LAB',
      description: 'Chemistry laboratory glassware, titrations, chemical reagents, and lab manual clearances',
      isAcademicBranch: false,
      requiresClearance: true,
      displayOrder: 3,
      isActive: true
    },
    create: {
      name: 'Chemistry Lab',
      code: 'CHEM',
      category: 'COLLEGE_LAB',
      description: 'Chemistry laboratory glassware, titrations, chemical reagents, and lab manual clearances',
      isAcademicBranch: false,
      requiresClearance: true,
      displayOrder: 3,
      isActive: true
    }
  });
  console.log('[Seed]: Chemistry Department configured [CHEM]:', chemDept.id);

  // Helper to upsert Officer and User
  async function createOrUpdateOfficerAccount(
    loginId: string,
    email: string,
    name: string,
    empId: string,
    deptId: string
  ) {
    // Check if user exists by loginId or email
    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { loginId: loginId },
          { email: email }
        ]
      }
    });

    if (user) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          loginId: loginId,
          email: email,
          name: name,
          passwordHash: officerPass,
          departmentId: deptId,
          role: UserRole.DEPARTMENT_OFFICER as any,
          isActive: true
        }
      });
    } else {
      user = await prisma.user.create({
        data: {
          loginId: loginId,
          email: email,
          name: name,
          passwordHash: officerPass,
          departmentId: deptId,
          role: UserRole.DEPARTMENT_OFFICER as any,
          isActive: true,
          mustChangePassword: false
        }
      });
    }

    let officer = await prisma.clearanceOfficer.findFirst({
      where: {
        OR: [
          { userId: user.id },
          { employeeId: empId }
        ]
      }
    });

    if (officer) {
      officer = await prisma.clearanceOfficer.update({
        where: { id: officer.id },
        data: {
          userId: user.id,
          employeeId: empId,
          name: name,
          email: email,
          isActive: true
        }
      });
    } else {
      officer = await prisma.clearanceOfficer.create({
        data: {
          userId: user.id,
          employeeId: empId,
          name: name,
          email: email,
          isActive: true
        }
      });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { associatedOfficerId: officer.id }
    });

    await prisma.clearanceOfficerDepartment.upsert({
      where: {
        officerId_departmentId: {
          officerId: officer.id,
          departmentId: deptId
        }
      },
      update: {},
      create: {
        officerId: officer.id,
        departmentId: deptId
      }
    });

    console.log(`[Seed]: Account configured -> Login ID: [${loginId}] | Email: [${email}] | EmpId: [${empId}]`);
    return { user, officer };
  }

  // 3. Create Physics Lab Officer account (PHY001)
  await createOrUpdateOfficerAccount(
    'PHY001',
    'physics.lab@mce.ac.in',
    'Physics Laboratory In-charge',
    'EMP-PHY-01',
    phyDept.id
  );

  // 4. Create Chemistry Lab Officer account (CHEM001)
  await createOrUpdateOfficerAccount(
    'CHEM001',
    'chemistry.lab@mce.ac.in',
    'Chemistry Laboratory In-charge',
    'EMP-CHEM-01',
    chemDept.id
  );

  // 5. Setup ISE Department & ISE001
  const iseDept = await prisma.clearanceDepartment.findUnique({
    where: { code: 'IS' }
  });

  if (iseDept) {
    await prisma.clearanceDepartment.update({
      where: { id: iseDept.id },
      data: { category: 'ACADEMIC_BRANCH', isAcademicBranch: true }
    });

    await createOrUpdateOfficerAccount(
      'ISE001',
      'ise.officer@mce.ac.in',
      'Information Science Department Officer',
      'EMP-ISE-01',
      iseDept.id
    );

    // Strictly 1 Department Lab for Information Science
    await prisma.departmentLab.upsert({
      where: { departmentId: iseDept.id },
      update: {
        name: 'Department Lab',
        code: 'IS-LAB',
        displayOrder: 1,
        isActive: true
      },
      create: {
        name: 'Department Lab',
        code: 'IS-LAB',
        departmentId: iseDept.id,
        displayOrder: 1,
        isActive: true
      }
    });
    console.log(`[Seed]: Configured 1 Department Lab under Information Science [${iseDept.code}].`);
  }

  // 6. Setup CSE Department & CSE001
  const cseDept = await prisma.clearanceDepartment.findUnique({
    where: { code: 'CS' }
  });

  if (cseDept) {
    await prisma.clearanceDepartment.update({
      where: { id: cseDept.id },
      data: { category: 'ACADEMIC_BRANCH', isAcademicBranch: true }
    });

    await createOrUpdateOfficerAccount(
      'CSE001',
      'cse.officer@mce.ac.in',
      'Computer Science Department Officer',
      'EMP-CSE-01',
      cseDept.id
    );

    // Strictly 1 Department Lab for Computer Science
    await prisma.departmentLab.upsert({
      where: { departmentId: cseDept.id },
      update: {
        name: 'Department Lab',
        code: 'CS-LAB',
        displayOrder: 1,
        isActive: true
      },
      create: {
        name: 'Department Lab',
        code: 'CS-LAB',
        departmentId: cseDept.id,
        displayOrder: 1,
        isActive: true
      }
    });
    console.log(`[Seed]: Configured 1 Department Lab under Computer Science [${cseDept.code}].`);
  }

  // 7. Configure exactly 1 Department Lab for ALL active academic branches
  const allAcademicDepts = await prisma.clearanceDepartment.findMany({
    where: { isAcademicBranch: true }
  });

  for (const dept of allAcademicDepts) {
    const labCode = `${dept.code}-LAB`;
    await prisma.departmentLab.upsert({
      where: { departmentId: dept.id },
      update: {
        name: 'Department Lab',
        code: labCode,
        displayOrder: 1,
        isActive: true
      },
      create: {
        name: 'Department Lab',
        code: labCode,
        departmentId: dept.id,
        displayOrder: 1,
        isActive: true
      }
    });
    console.log(`[Seed]: Verified 1 Department Lab for academic branch [${dept.code}].`);
  }

  // 8. Assign loginId to existing Admin / SuperAdmin
  const superAdmin = await prisma.user.findFirst({ where: { role: UserRole.SUPER_ADMIN } });
  if (superAdmin && !superAdmin.loginId) {
    await prisma.user.update({
      where: { id: superAdmin.id },
      data: { loginId: 'SUPERADMIN' }
    });
  }

  const admin = await prisma.user.findFirst({ where: { role: UserRole.ADMIN } });
  if (admin && !admin.loginId) {
    await prisma.user.update({
      where: { id: admin.id },
      data: { loginId: 'ADMIN001' }
    });
  }

  console.log('[Seed]: Seeding finished successfully.');
}

if (require.main === module) {
  seedLabAccounts()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[Seed Error]:', err);
      process.exit(1);
    });
}
