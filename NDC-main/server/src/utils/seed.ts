import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import prisma from '../config/prisma';
import { UserRole } from '../constants/roles';

dotenv.config();

export const seedDatabase = async () => {
  try {
    console.log('[Seed]: Connecting to Supabase PostgreSQL via Prisma...');

    // 1. Initial Settings
    await prisma.setting.deleteMany({});
    await prisma.setting.create({
      data: {
        collegeName: 'MALNAD COLLEGE OF ENGINEERING',
        collegeAddress: 'Autonomous Institution Affiliated to VTU, Belagavi | PB No. 21, Hassan, Karnataka - 573202',
        certificateTitle: 'NO DUE CERTIFICATE',
        certificatePrefix: 'NDC/MCE/',
        signatoryName: 'Dr. K. S. Ananth',
        signatoryDesignation: 'Dean & Administrative Officer'
      }
    });
    console.log('[Seed]: System settings initialized.');

    // 2. Certificate Sequence Counter
    await prisma.certificateSequence.deleteMany({});
    await prisma.certificateSequence.create({
      data: {
        key: 'NDC',
        year: new Date().getFullYear(),
        prefix: 'NDC/MCE/',
        currentNumber: 0
      }
    });

    // 3. Clear Existing Clearance Officers & Staff Users
    await prisma.clearanceOfficerDepartment.deleteMany({});
    await prisma.clearanceOfficer.deleteMany({});
    await prisma.user.deleteMany({
      where: {
        role: { in: [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.DEPARTMENT_OFFICER, UserRole.HOD] as any }
      }
    });

    // 4. Default Central Clearance Departments
    const deptsData = [
      { name: 'Central Library', code: 'LIB', description: 'Borrowed reference books, textbooks, and library resource clearances', displayOrder: 1, isAcademicBranch: false, requiresClearance: true },
      { name: 'Laboratory Section', code: 'LAB', description: 'Laboratory handbooks, workshop tools, and equipment clearances', displayOrder: 2, isAcademicBranch: false, requiresClearance: true },
      { name: 'Hostel Warden / Administration', code: 'HST', description: 'Hostel room fee balance, mess dues, and room key handover', displayOrder: 3, isAcademicBranch: false, requiresClearance: true },
      { name: 'Physical Education / Sports Section', code: 'SPT', description: 'Sports equipment, gym items, and athletic uniform clearances', displayOrder: 4, isAcademicBranch: false, requiresClearance: true },
      { name: 'Cash/Fee Section', code: 'ACC', description: 'Tuition fee arrears, exam fee balances, fines, and cashier clearances', displayOrder: 5, isAcademicBranch: false, requiresClearance: true },
      { name: 'College Office / Administrative Section', code: 'ADM', description: 'Overall institutional & administrative clearance', displayOrder: 6, isAcademicBranch: false, requiresClearance: false }
    ];

    for (const d of deptsData) {
      await prisma.clearanceDepartment.upsert({
        where: { code: d.code },
        update: d,
        create: d
      });
    }

    // Clean up any legacy clearance items for ADM department so clearance is strictly restricted to designated clearance officers
    await prisma.ndcClearance.deleteMany({
      where: { department: { code: 'ADM' } }
    });

    const libDept = await prisma.clearanceDepartment.findUnique({ where: { code: 'LIB' } });
    const labDept = await prisma.clearanceDepartment.findUnique({ where: { code: 'LAB' } });
    const hstDept = await prisma.clearanceDepartment.findUnique({ where: { code: 'HST' } });
    const sptDept = await prisma.clearanceDepartment.findUnique({ where: { code: 'SPT' } });
    const accDept = await prisma.clearanceDepartment.findUnique({ where: { code: 'ACC' } });
    const admDept = await prisma.clearanceDepartment.findUnique({ where: { code: 'ADM' } });

    // 5. Seed Pre-configured Demo Accounts
    const adminPass = await bcrypt.hash('Admin@123', 10);
    const officerPass = await bcrypt.hash('Officer@123', 10);

    // Super Admin & System Admin
    await prisma.user.create({
      data: {
        email: 'superadmin@mce.ac.in',
        passwordHash: adminPass,
        role: UserRole.SUPER_ADMIN as any,
        name: 'Super Administrator',
        isActive: true
      }
    });

    await prisma.user.create({
      data: {
        email: 'admin@mce.ac.in',
        passwordHash: adminPass,
        role: UserRole.ADMIN as any,
        name: 'Administration Block',
        isActive: true
      }
    });

    // Helper for creating Officer user and record
    const createOfficerAccount = async (
      email: string,
      name: string,
      empId: string,
      dept: any,
      role: any = UserRole.DEPARTMENT_OFFICER,
      loginId?: string
    ) => {
      if (!dept) return;
      const user = await prisma.user.create({
        data: {
          email,
          loginId: loginId || empId,
          passwordHash: officerPass,
          role: role as any,
          name,
          departmentId: dept.id,
          isActive: true
        }
      });

      const officer = await prisma.clearanceOfficer.create({
        data: {
          userId: user.id,
          employeeId: empId,
          name: user.name,
          email: user.email,
          isActive: true
        }
      });

      await prisma.user.update({
        where: { id: user.id },
        data: { associatedOfficerId: officer.id }
      });

      await prisma.clearanceOfficerDepartment.create({
        data: {
          officerId: officer.id,
          departmentId: dept.id
        }
      });
    };

    // Central Clearance Officers
    await createOfficerAccount('office@mce.ac.in', 'Administrative Office In-charge', 'EMP-ADM-01', admDept, UserRole.DEPARTMENT_OFFICER, 'ADM001');
    await createOfficerAccount('library@mce.ac.in', 'Central Library Officer', 'EMP-LIB-01', libDept, UserRole.DEPARTMENT_OFFICER, 'LIB001');
    await createOfficerAccount('lab@mce.ac.in', 'Laboratory In-charge Officer', 'EMP-LAB-01', labDept, UserRole.DEPARTMENT_OFFICER, 'LAB001');
    await createOfficerAccount('hostel@mce.ac.in', 'Hostel Warden', 'EMP-HST-01', hstDept, UserRole.DEPARTMENT_OFFICER, 'HST001');
    await createOfficerAccount('sports@mce.ac.in', 'Physical Education / Sports Officer', 'EMP-SPT-01', sptDept, UserRole.DEPARTMENT_OFFICER, 'SPT001');
    
    // Cash/Fee Section 3 Operators + In-charge
    await createOfficerAccount('cashfee1@mce.ac.in', 'Cash/Fee Officer 1', 'EMP-ACC-01', accDept, UserRole.DEPARTMENT_OFFICER, 'ACC001');
    await createOfficerAccount('cashfee2@mce.ac.in', 'Cash/Fee Officer 2', 'EMP-ACC-02', accDept, UserRole.DEPARTMENT_OFFICER, 'ACC002');
    await createOfficerAccount('cashfee3@mce.ac.in', 'Cash/Fee Officer 3', 'EMP-ACC-03', accDept, UserRole.DEPARTMENT_OFFICER, 'ACC003');
    await createOfficerAccount('accounts@mce.ac.in', 'Cash/Fee Section In-charge', 'EMP-ACC-00', accDept, UserRole.DEPARTMENT_OFFICER, 'ACC000');

    // 6. All 11 Academic Branches & Faculty/HOD Accounts
    const academicDepts = [
      { name: 'Computer Science & Engineering', code: 'CS', order: 7 },
      { name: 'Computer Science & Engineering (AI & ML)', code: 'AI', order: 8 },
      { name: 'Computer Science and Business Systems', code: 'CB', order: 9 },
      { name: 'Robotics & Artificial Intelligence', code: 'RA', order: 10 },
      { name: 'Electronics & Communication Engineering', code: 'EC', order: 11 },
      { name: 'Electronics Engineering (VLSI Design & Technology)', code: 'VL', order: 12 },
      { name: 'Electronics & Computer Engineering', code: 'ET', order: 13 },
      { name: 'Electrical and Electronics Engineering', code: 'EE', order: 14 },
      { name: 'Civil Engineering', code: 'CV', order: 15 },
      { name: 'Mechanical Engineering', code: 'ME', order: 16 },
      { name: 'Information Science & Engineering', code: 'IS', order: 17 }
    ];

    for (const ad of academicDepts) {
      let deptRecord = await prisma.clearanceDepartment.findUnique({ where: { code: ad.code } });
      if (!deptRecord) {
        deptRecord = await prisma.clearanceDepartment.create({
          data: {
            name: ad.name,
            code: ad.code,
            description: `Department of ${ad.name} Academic Faculty Desk`,
            isAcademicBranch: true,
            displayOrder: ad.order
          }
        });
      }

      const lowerCode = ad.code.toLowerCase();
      // Seed HOD
      await createOfficerAccount(
        `hod.${lowerCode}@mce.ac.in`,
        `Head of Department (${ad.code})`,
        `EMP-HOD-${ad.code}-01`,
        deptRecord,
        UserRole.HOD,
        `HOD-${ad.code}`
      );

      // Seed Faculty
      await createOfficerAccount(
        `faculty.${lowerCode}@mce.ac.in`,
        `Department Faculty (${ad.code})`,
        `EMP-FAC-${ad.code}-01`,
        deptRecord,
        UserRole.DEPARTMENT_OFFICER,
        `${ad.code}001`
      );
    }

    console.log('[Seed]: Successfully seeded all 6 central clearance desks and 11 academic department Faculty/HOD accounts into Supabase/PostgreSQL.');
    console.log('--- SEEDING COMPLETE ---');
  } catch (err) {
    console.error('[Seed Error]:', err);
  }
};

if (require.main === module) {
  seedDatabase().then(() => process.exit(0));
}
