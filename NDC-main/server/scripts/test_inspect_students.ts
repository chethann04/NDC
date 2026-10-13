import prisma from '../src/config/prisma';

async function main() {
  const students = await prisma.student.findMany({
    include: {
      department: true,
      ndcRequests: { include: { clearances: true, certificate: true } },
      certificates: true
    }
  });
  console.log('Total students in DB:', students.length);
  for (const s of students) {
    console.log(`- Student: ${s.fullName} (${s.usn}), Dept: ${s.department?.name}`);
    console.log(`  Requests: ${s.ndcRequests.length}, Certs: ${s.certificates.length}`);
    s.ndcRequests.forEach(r => {
      console.log(`    Request ${r.requestNumber}: status=${r.status}, certId=${r.certificateId}, clearances=${r.clearances.length}`);
    });
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
