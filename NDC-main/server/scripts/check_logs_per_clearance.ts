import prisma from '../src/config/prisma';

async function main() {
  const req = await prisma.ndcRequest.findFirst({
    where: { student: { usn: '4MC24IS022' } },
    include: {
      clearances: {
        include: { department: true, lab: true }
      }
    }
  });

  if (!req) return;

  for (const c of req.clearances) {
    const logs = await prisma.auditLog.findMany({
      where: { entityId: c.id },
      orderBy: { timestamp: 'desc' }
    });
    console.log(`Dept: ${c.department?.code || c.lab?.code} (ID: ${c.id}) - reviewedAt: ${c.reviewedAt}`);
    for (const l of logs) {
      console.log(`   Log: ${l.action} at ${l.timestamp.toISOString()} - ${l.description}`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
