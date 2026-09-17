import prisma from '../config/prisma';

async function resetDemoClearances() {
  console.log('--- Resetting All Clearance Tasks to Clean Independent State ---');

  // 1. Delete all generated certificates so certificates are only issued when all desks legitimately clear
  const deletedCerts = await prisma.ndcCertificate.deleteMany({});
  console.log(`Deleted ${deletedCerts.count} certificates.`);

  // 2. Reset all NDC requests to IN_PROGRESS and remove certificateId
  const updatedRequests = await prisma.ndcRequest.updateMany({
    data: {
      status: 'IN_PROGRESS',
      completedAt: null,
      certificateId: null,
      remarks: null
    }
  });
  console.log(`Reset ${updatedRequests.count} NDC requests to IN_PROGRESS.`);

  // 3. Reset all clearance tasks across all departments to PENDING
  const updatedClearances = await prisma.ndcClearance.updateMany({
    data: {
      status: 'PENDING',
      dueAmount: 0,
      dueDetails: '',
      remarks: '',
      reviewedById: null,
      reviewedAt: null
    }
  });
  console.log(`Reset ${updatedClearances.count} departmental clearance records to PENDING.`);

  console.log('--- Successfully reset all clearance tasks. Every department is now completely independent! ---');
}

resetDemoClearances()
  .catch((e) => {
    console.error('Error resetting clearances:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
