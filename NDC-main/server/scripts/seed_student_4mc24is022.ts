import prisma from '../src/config/prisma';
import { NdcWorkflowService } from '../src/services/NdcWorkflowService';
import { DepartmentClearanceStatus } from '../src/constants/statuses';

async function seedStudent() {
  const usn = '4MC24IS022';
  const existing = await prisma.student.findUnique({
    where: { usn },
    include: { ndcRequests: { include: { clearances: true } } }
  });

  if (existing) {
    console.log(`Student ${usn} already exists (ID: ${existing.id})`);
    return existing;
  }

  // Find ISE or Academic department
  const dept = await prisma.clearanceDepartment.findFirst({
    where: {
      OR: [
        { code: 'IS' },
        { code: 'ISE' },
        { name: { contains: 'Information', mode: 'insensitive' } }
      ]
    }
  });

  if (!dept) {
    console.error('ISE department not found');
    return;
  }

  const student = await prisma.student.create({
    data: {
      studentId: usn,
      usn: usn,
      fullName: 'Student 4MC24IS022',
      email: '4mc24is022@gmail.com',
      phone: '9876543210',
      departmentId: dept.id,
      departmentName: dept.name,
      section: 'A',
      batch: '2024-2028',
      academicYear: '2025-2026',
      semester: '2nd Semester',
      year: '1st Year',
      admissionYear: 2024,
      graduationYear: 2028,
      isActive: true
    }
  });

  console.log(`Created student: ${student.fullName} (${student.usn})`);

  // Initialize NDC Request and Clearances
  await NdcWorkflowService.initializeNewStudentNdc(student.id, dept.id);
  console.log(`Initialized NDC Request & Clearances for ${usn}`);

  // Ensure Physics clearance is present
  const phyDept = await prisma.clearanceDepartment.findFirst({ where: { code: 'PHY' } });
  if (phyDept) {
    const ndcReq = await prisma.ndcRequest.findFirst({ where: { studentId: student.id } });
    if (ndcReq) {
      const existingPhy = await prisma.ndcClearance.findFirst({
        where: { ndcRequestId: ndcReq.id, departmentId: phyDept.id }
      });
      if (!existingPhy) {
        await prisma.ndcClearance.create({
          data: {
            ndcRequestId: ndcReq.id,
            studentId: student.id,
            departmentId: phyDept.id,
            status: DepartmentClearanceStatus.PENDING as any,
            dueAmount: 0
          }
        });
        console.log(`Attached Physics Lab clearance to student ${usn}`);
      }
    }
  }

  return student;
}

seedStudent()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
