const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const s = await prisma.student.findUnique({
    where: { usn: '4MC23CV001' },
    include: {
      ndcRequests: {
        include: {
          clearances: {
            include: { department: true, lab: true }
          }
        }
      }
    }
  });
  for (const r of s.ndcRequests) {
    for (const c of r.clearances) {
      console.log('CV student clearance:', c.department?.code, c.department?.name, 'isBranch:', c.department?.isAcademicBranch, 'labId:', c.labId, 'status:', c.status);
    }
  }
}

run().finally(() => prisma.$disconnect());
