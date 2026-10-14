const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const depts = await prisma.clearanceDepartment.findMany({
    select: { id: true, name: true, code: true, isActive: true, requiresClearance: true, isAcademicBranch: true, displayOrder: true }
  });
  console.log(JSON.stringify(depts, null, 2));
}

run().finally(() => prisma.$disconnect());
