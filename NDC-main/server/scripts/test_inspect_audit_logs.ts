import prisma from '../src/config/prisma';

async function main() {
  const clearances = await prisma.ndcClearance.findMany({
    where: { ndcRequestId: 'a7dc13c3-3bfe-4ec0-a0c1-aee7f7c0cee5' },
    include: { department: true }
  });

  for (const c of clearances) {
    const logs = await prisma.auditLog.findMany({
      where: { entityId: c.id },
      orderBy: { timestamp: 'desc' }
    });
    console.log(`Dept: ${c.department?.name} (${c.department?.code}): reviewedAt=${c.reviewedAt}, logs count=${logs.length}`);
    for (const l of logs) {
      console.log(`   [${l.timestamp.toISOString()}] ${l.action}: ${l.description}`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
