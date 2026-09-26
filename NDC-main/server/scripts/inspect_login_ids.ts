import prisma from '../src/config/prisma';

async function main() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      loginId: true,
      role: true,
      name: true,
      associatedOfficer: {
        select: {
          employeeId: true,
          departmentMappings: {
            include: { department: true }
          }
        }
      },
      department: true
    },
    orderBy: [{ role: 'asc' }, { email: 'asc' }]
  });

  console.log('Total users:', users.length);
  for (const u of users) {
    console.log(`[${u.role}] ${u.name} | loginId: ${u.loginId} | email: ${u.email} | empId: ${u.associatedOfficer?.employeeId || 'N/A'}`);
  }
}

main().finally(() => prisma.$disconnect());
