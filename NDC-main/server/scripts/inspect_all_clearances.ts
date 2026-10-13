import prisma from '../src/config/prisma';

async function main() {
  const reqs = await prisma.ndcRequest.findMany({
    include: {
      clearances: {
        include: { department: true, lab: true }
      },
      student: true
    }
  });

  console.log('Total requests:', reqs.length);
  for (const r of reqs) {
    console.log(`Req: ${r.requestNumber}, Student: ${r.student?.fullName} (${r.student?.usn}), Status: ${r.status}`);
    for (const c of r.clearances) {
      console.log(`  - ${c.department?.code || c.lab?.code}: status=${c.status}, reviewedAt=${c.reviewedAt?.toISOString()}, updatedAt=${c.updatedAt.toISOString()}`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
