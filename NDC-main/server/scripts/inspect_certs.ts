import prisma from '../src/config/prisma';

async function test() {
  const students = await prisma.student.findMany({
    where: { usn: { in: ['4MC22AI100', '4MC24IS022', '4MC22CS002'] } },
    include: {
      certificates: true,
      ndcRequests: {
        include: {
          clearances: {
            include: { department: true, lab: true }
          }
        }
      }
    }
  });
  for (const s of students) {
    console.log('=== Student:', s.usn, s.fullName);
    console.log('Certificates:', s.certificates.map(c => ({ no: c.certificateNumber, reqId: c.ndcRequestId, pdf: c.pdfPath })));
    for (const r of s.ndcRequests) {
      console.log('  Request:', r.id, r.status);
      for (const c of r.clearances) {
        console.log('    Clearance:', c.department?.code, c.department?.name, 'isBranch:', c.department?.isAcademicBranch, 'labId:', c.labId, 'status:', c.status);
      }
    }
  }
}

test()
  .then(() => prisma.$disconnect())
  .catch((e) => { console.error(e); prisma.$disconnect(); });
