import { PrismaClient } from '../src/generated/client';
const p = new PrismaClient();

async function main() {
  const depts = await p.clearanceDepartment.findMany({
    select: { id: true, name: true, code: true, isActive: true, requiresClearance: true, isAcademicBranch: true }
  });
  console.log('=== Clearance Departments ===');
  console.log(JSON.stringify(depts, null, 2));

  const requestCount = await p.ndcRequest.count();
  const clearanceCount = await p.ndcClearance.count();
  console.log(`\nNDC Requests: ${requestCount}, Clearances: ${clearanceCount}`);

  // Sample one request with clearances
  const sampleReq = await p.ndcRequest.findFirst({
    include: {
      student: { select: { fullName: true, usn: true } },
      clearances: {
        include: { department: { select: { name: true, code: true } }, lab: { select: { name: true } } }
      }
    },
    orderBy: { createdAt: 'desc' }
  });
  if (sampleReq) {
    console.log('\n=== Sample NDC Request ===');
    console.log('Student:', sampleReq.student?.fullName, sampleReq.student?.usn);
    console.log('Clearances:');
    sampleReq.clearances.forEach(c => {
      console.log(` - dept: ${c.department?.name || 'NULL'}, lab: ${c.lab?.name || 'none'}, status: ${c.status}`);
    });
  }
}

main()
  .catch(e => { console.error(e.message); process.exit(1); })
  .finally(() => p.$disconnect());
