import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import prisma from '../config/prisma';
import { UserRole } from '../constants/roles';

dotenv.config();

export const updateCashFeeSection = async () => {
  try {
    console.log('[Script]: Synchronizing Cash/Fee Section and 3 operator logins...');

    // 1. Ensure department name is "Cash/Fee Section"
    const dept = await prisma.clearanceDepartment.upsert({
      where: { code: 'ACC' },
      update: {
        name: 'Cash/Fee Section',
        description: 'Tuition fee arrears, exam fee balances, fines, and cashier clearances'
      },
      create: {
        name: 'Cash/Fee Section',
        code: 'ACC',
        description: 'Tuition fee arrears, exam fee balances, fines, and cashier clearances',
        displayOrder: 5,
        isAcademicBranch: false
      }
    });
    console.log(`[Script]: Department [${dept.code}] name confirmed as "${dept.name}".`);

    const officerPass = await bcrypt.hash('Officer@123', 10);

    // 2. Define the 3 operator logins + accounts@mce.ac.in
    const operators = [
      {
        email: 'accounts@mce.ac.in',
        name: 'Cash/Fee Section In-charge',
        empId: 'EMP-ACC-00'
      },
      {
        email: 'cashfee1@mce.ac.in',
        name: 'Cash/Fee Officer 1',
        empId: 'EMP-ACC-01'
      },
      {
        email: 'cashfee2@mce.ac.in',
        name: 'Cash/Fee Officer 2',
        empId: 'EMP-ACC-02'
      },
      {
        email: 'cashfee3@mce.ac.in',
        name: 'Cash/Fee Officer 3',
        empId: 'EMP-ACC-03'
      }
    ];

    for (const op of operators) {
      // Step A: Upsert User
      let user = await prisma.user.findUnique({
        where: { email: op.email }
      });

      if (!user) {
        user = await prisma.user.create({
          data: {
            email: op.email,
            passwordHash: officerPass,
            role: UserRole.DEPARTMENT_OFFICER as any,
            name: op.name,
            departmentId: dept.id,
            isActive: true
          }
        });
      } else {
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            passwordHash: officerPass,
            name: op.name,
            departmentId: dept.id,
            isActive: true
          }
        });
      }

      // Step B: Check if an officer is linked to this user
      let officer = await prisma.clearanceOfficer.findUnique({
        where: { userId: user.id }
      });

      if (!officer) {
        // Also check if officer with empId exists
        const existingWithEmp = await prisma.clearanceOfficer.findUnique({
          where: { employeeId: op.empId }
        });

        if (existingWithEmp) {
          // detach previous user if any
          await prisma.user.updateMany({
            where: { associatedOfficerId: existingWithEmp.id },
            data: { associatedOfficerId: null }
          });

          officer = await prisma.clearanceOfficer.update({
            where: { id: existingWithEmp.id },
            data: {
              userId: user.id,
              name: op.name,
              email: op.email,
              isActive: true
            }
          });
        } else {
          officer = await prisma.clearanceOfficer.create({
            data: {
              userId: user.id,
              employeeId: op.empId,
              name: op.name,
              email: op.email,
              isActive: true
            }
          });
        }
      } else {
        officer = await prisma.clearanceOfficer.update({
          where: { id: officer.id },
          data: {
            employeeId: op.empId,
            name: op.name,
            email: op.email,
            isActive: true
          }
        });
      }

      // Step C: Link user to officer
      await prisma.user.update({
        where: { id: user.id },
        data: { associatedOfficerId: officer.id }
      });

      // Step D: Map officer to Cash/Fee Section department
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

      console.log(`[Script]: Configured login [${op.email}] (${op.empId} - ${op.name}) -> Cash/Fee Section`);
    }

    console.log('[Script]: ALL Cash/Fee Section operators successfully provisioned!');
  } catch (error) {
    console.error('[Script Error]:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
};

updateCashFeeSection();
