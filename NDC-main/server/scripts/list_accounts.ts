import prisma from '../src/config/prisma';

async function main() {
  const staff = await prisma.user.findMany({
    where: { role: { not: 'STUDENT' } },
    include: {
      department: true,
      associatedOfficer: {
        include: {
          departmentMappings: {
            include: { department: true }
          }
        }
      }
    },
    orderBy: [
      { role: 'asc' },
      { email: 'asc' }
    ]
  });

  console.log('=== STAFF / OFFICER / ADMIN / HOD ACCOUNTS ===');
  for (const u of staff) {
    const empId = u.associatedOfficer?.employeeId || 'N/A';
    const deptCodes = u.associatedOfficer?.departmentMappings.map(m => `${m.department.code} (${m.department.name})`).join(', ') 
                      || (u.department ? `${u.department.code} (${u.department.name})` : 'System-wide');
    console.log(`[${u.role}]`);
    console.log(`  Name: ${u.name}`);
    console.log(`  Login ID: ${empId}`);
    console.log(`  Email: ${u.email}`);
    console.log(`  Assigned Scope: ${deptCodes}`);
    console.log(`  Active: ${u.isActive}`);
    console.log('');
  }

  // Find students with dateOfBirth
  const studentsWithDob = await prisma.student.findMany({
    where: { dateOfBirth: { not: null } },
    include: { department: true },
    orderBy: { usn: 'asc' }
  });

  console.log('=== STUDENTS WITH DATE OF BIRTH (READY FOR STUDENT LOGIN) ===');
  for (const s of studentsWithDob) {
    const dobStr = s.dateOfBirth?.toISOString().split('T')[0];
    console.log(`USN: ${s.usn} | Name: ${s.fullName} | DOB: ${dobStr} | Branch: ${s.department?.name} (${s.department?.code})`);
  }
}

main().finally(() => prisma.$disconnect());
