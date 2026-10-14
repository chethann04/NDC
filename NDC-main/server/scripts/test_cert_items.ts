import prisma from '../src/config/prisma';
import { LaboratoryAggregationService } from '../src/services/LaboratoryAggregationService';

async function test() {
  const clearanceDocs = await prisma.ndcClearance.findMany({
    where: {
      ndcRequestId: 'a7dc13c3-3bfe-4ec0-a0c1-aee7f7c0cee5',
      department: {
        isActive: true,
        requiresClearance: true
      }
    },
    include: {
      department: true,
      lab: true,
      reviewedBy: {
        select: { id: true, name: true, role: true }
      }
    },
    orderBy: { createdAt: 'asc' }
  });

  console.log('clearanceDocs count:', clearanceDocs.length);
  clearanceDocs.forEach(c => console.log('Doc:', c.department?.code, c.department?.name, 'isBranch:', c.department?.isAcademicBranch, 'labId:', c.labId, 'status:', c.status));

  const items = LaboratoryAggregationService.getCertificateClearanceItems(clearanceDocs);
  console.log('Result of getCertificateClearanceItems:', JSON.stringify(items, null, 2));
}

test()
  .then(() => prisma.$disconnect())
  .catch((e) => { console.error(e); prisma.$disconnect(); });
