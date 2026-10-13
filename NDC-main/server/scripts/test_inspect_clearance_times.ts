import prisma from '../src/config/prisma';

async function main() {
  const student = await prisma.student.findFirst({
    where: { usn: '4MC24IS022' },
    include: {
      ndcRequests: {
        include: {
          clearances: {
            include: { department: true }
          },
          certificate: true
        }
      }
    }
  });

  if (!student) {
    console.log('Student not found');
    return;
  }

  console.log(`Student: ${student.fullName} (${student.usn})`);
  const req = student.ndcRequests[0];
  console.log(`Request: ${req.requestNumber}, Status: ${req.status}, CertId: ${req.certificateId}`);
  console.log('Clearances:');
  for (const c of req.clearances) {
    console.log(`- ${c.department?.name} (${c.department?.code}): status=${c.status}, reviewedAt=${c.reviewedAt}, updatedAt=${c.updatedAt}, createdAt=${c.createdAt}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
