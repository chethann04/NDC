import prisma from '../src/config/prisma';

async function main() {
  const req = await prisma.ndcRequest.findFirst({
    where: { student: { usn: '4MC24IS022' } },
    include: {
      clearances: {
        include: {
          department: true,
          lab: true,
          reviewedBy: true
        }
      },
      certificate: true
    }
  });

  if (!req) {
    console.log('No request found');
    return;
  }

  console.log('Request ID:', req.id);
  console.log('Certificate IssuedAt:', req.certificate?.issuedAt);

  console.log('\n--- CLEARANCES ---');
  for (const c of req.clearances) {
    console.log({
      dept: c.department?.code || c.lab?.code,
      name: c.department?.name || c.lab?.name,
      status: c.status,
      reviewedAt: c.reviewedAt,
      updatedAt: c.updatedAt,
      createdAt: c.createdAt,
      reviewedBy: c.reviewedBy?.name
    });
  }

  const logs = await prisma.auditLog.findMany({
    where: {
      entityId: { in: req.clearances.map(c => c.id) }
    },
    orderBy: { timestamp: 'asc' }
  });

  console.log('\n--- AUDIT LOGS FOR CLEARANCES ---');
  for (const l of logs) {
    console.log({
      action: l.action,
      entityId: l.entityId,
      description: l.description
    });
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
