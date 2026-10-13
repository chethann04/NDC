import prisma from '../src/config/prisma';
import { NdcController } from '../src/controllers/NdcController';

async function main() {
  const student = await prisma.student.findFirst({
    where: { usn: '4MC24IS022' },
    include: { user: true }
  });

  if (!student) {
    console.log('Student not found');
    return;
  }

  const mockReq: any = {
    params: { studentId: student.id },
    user: {
      role: 'STUDENT',
      associatedStudentId: student.id,
      id: student.user?.id
    }
  };

  let resData: any = null;
  const mockRes: any = {
    status(code: number) { return this; },
    json(data: any) { resData = data; return this; }
  };

  await NdcController.getStudentNdcStatus(mockReq, mockRes);
  console.log('Progress returned:', resData.progress);
  console.log('ndcRequest status:', resData.ndcRequest?.status);
  console.log('clearances count:', resData.clearances?.length);
  console.log('Clearances sample:', resData.clearances?.map((c: any) => ({
    name: c.department?.name || c.departmentId?.name,
    code: c.department?.code || c.departmentId?.code,
    status: c.status
  })));
}

main().catch(console.error).finally(() => prisma.$disconnect());
