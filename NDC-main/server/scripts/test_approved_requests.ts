import prisma from '../src/config/prisma';

async function main() {
  const approvedRequests = await prisma.ndcRequest.findMany({
    where: { status: 'APPROVED' },
    include: { student: true, certificate: true, clearances: true }
  });
  console.log('Approved requests count:', approvedRequests.length);
  for (const r of approvedRequests) {
    console.log(`- Request ${r.requestNumber}: student=${r.student?.fullName} (${r.student?.usn}), certId=${r.certificateId}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
