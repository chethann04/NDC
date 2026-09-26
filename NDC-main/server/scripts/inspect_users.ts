import prisma from '../src/config/prisma';

async function main() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      loginId: true,
      email: true,
      role: true,
      name: true,
      departmentId: true,
      isActive: true,
      createdAt: true,
      lastLogin: true,
      associatedOfficer: {
        include: {
          departmentMappings: {
            include: { department: true }
          }
        }
      },
      department: true
    },
    orderBy: { createdAt: 'asc' }
  });

  console.log(`TOTAL USERS: ${users.length}`);
  for (const u of users) {
    const dept = u.department?.name || u.associatedOfficer?.departmentMappings?.[0]?.department?.name || 'N/A';
    const deptCode = u.department?.code || u.associatedOfficer?.departmentMappings?.[0]?.department?.code || 'N/A';
    console.log(`- [${u.role}] ${u.name} | loginId: ${u.loginId} | email: ${u.email} | dept: ${dept} (${deptCode}) | active: ${u.isActive}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
