const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const certs = await prisma.ndcCertificate.findMany({
    include: {
      student: true,
      request: {
        include: {
          clearances: {
            include: { department: true, lab: true }
          }
        }
      }
    }
  });
  for (const c of certs) {
    console.log('Cert:', c.certificateNumber, 'Student:', c.studentUsn, c.studentName);
    console.log('Request clearances:', c.request?.clearances?.map(cl => `${cl.department?.code} (${cl.status}, labId=${!!cl.labId})`));
  }
}

run().finally(() => prisma.$disconnect());
