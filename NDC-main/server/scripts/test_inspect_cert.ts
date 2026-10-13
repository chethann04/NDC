import prisma from '../src/config/prisma';

async function main() {
  const allCerts = await prisma.ndcCertificate.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      student: { include: { department: true } },
      request: { include: { student: true, clearances: true } }
    }
  });

  console.log('Total certificates in DB:', allCerts.length);
  for (const c of allCerts) {
    console.log(`\n--- Cert ${c.certificateNumber} (${c.id}) ---`);
    console.log(`Status: ${c.status}, StudentUsn: ${c.studentUsn}, StudentName: ${c.studentName}`);
    console.log(`Direct studentId: ${c.studentId}, Student found by relation: ${!!c.student}`);
    console.log(`Request found: ${!!c.request}, Request clearances count: ${c.request?.clearances?.length || 0}`);
    
    // Check if student exists by USN
    if (c.studentUsn) {
      const s = await prisma.student.findUnique({
        where: { usn: c.studentUsn },
        include: { department: true }
      });
      console.log(`Student found by USN (${c.studentUsn}): ${!!s} (id: ${s?.id})`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
