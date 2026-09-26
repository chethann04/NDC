import prisma from '../src/config/prisma';

async function main() {
  console.log('Testing direct row deletion as performed in Supabase Studio...');

  const dept = await prisma.clearanceDepartment.findFirst();
  if (!dept) throw new Error('No department found');

  const testUsn = `4MC99SUPA${Date.now().toString().slice(-4)}`;
  const student = await prisma.student.create({
    data: {
      studentId: `STU-${testUsn}`,
      usn: testUsn,
      fullName: 'Supabase Direct Delete Test Student',
      email: `${testUsn.toLowerCase()}@mce.ac.in`,
      departmentId: dept.id,
      departmentName: dept.name,
      batch: '2022-2026',
      academicYear: '2025-2026',
      section: 'A'
    }
  });
  console.log(`1. Created student in database: ${student.id} (${student.usn})`);

  const request = await prisma.ndcRequest.create({
    data: {
      requestNumber: `REQ-SUPA-${Date.now()}`,
      studentId: student.id,
      status: 'APPROVED'
    }
  });

  const certNumber = `NDC/MCE/SUPA/${Date.now().toString().slice(-6)}`;
  const cert = await prisma.ndcCertificate.create({
    data: {
      certificateNumber: certNumber,
      ndcRequestId: request.id,
      studentId: student.id,
      studentName: student.fullName,
      studentUsn: student.usn,
      departmentName: dept.name,
      status: 'VALID'
    }
  });
  console.log(`2. Created certificate in database: ${cert.certificateNumber}`);

  // Simulating Supabase Studio row delete:
  console.log('3. Simulating DELETE FROM students WHERE id = ... (as performed in Supabase Studio)');
  await prisma.student.delete({
    where: { id: student.id }
  });
  console.log('✔ Direct deletion in students table succeeded without any FK error!');

  // Check certificate state
  const certAfter = await prisma.ndcCertificate.findUnique({
    where: { id: cert.id }
  });

  if (!certAfter) {
    throw new Error('FAILED: Certificate was accidentally deleted!');
  }

  console.log('4. Certificate state after student deletion:');
  console.log('   - Certificate exists:', Boolean(certAfter));
  console.log('   - studentId is NULL:', certAfter.studentId === null);
  console.log('   - studentName snapshot preserved:', certAfter.studentName);
  console.log('   - studentUsn snapshot preserved:', certAfter.studentUsn);
  console.log('   - departmentName preserved:', certAfter.departmentName);
  console.log('   - certificateNumber preserved:', certAfter.certificateNumber);

  if (certAfter.studentId !== null || certAfter.studentUsn !== testUsn) {
    throw new Error('FAILED: Snapshots or studentId state incorrect');
  }

  console.log('✔ VERIFICATION PASSED: Student was deleted, certificate preserved with ON DELETE SET NULL!');

  // Cleanup test certificate
  await prisma.ndcCertificate.delete({ where: { id: cert.id } });
}

main()
  .catch((err) => {
    console.error('Test error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
