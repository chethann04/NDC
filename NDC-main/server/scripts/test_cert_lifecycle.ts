import prisma from '../src/config/prisma';
import { CertificateService } from '../src/services/CertificateService';
import { CertificateController } from '../src/controllers/CertificateController';

async function main() {
  // Find a student with an NDC request
  const student = await prisma.student.findFirst({
    include: {
      department: true,
      ndcRequests: {
        include: { clearances: { include: { department: true } } }
      }
    }
  });

  if (!student) {
    console.log('No student found');
    return;
  }

  console.log('Testing with student:', student.fullName, student.usn);
  const req = student.ndcRequests[0];
  console.log('Request:', req.id, req.status, 'Clearances count:', req.clearances.length);

  // Mark all clearances as CLEARED for testing in a transaction or test
  await prisma.ndcClearance.updateMany({
    where: { ndcRequestId: req.id },
    data: { status: 'CLEARED' }
  });

  await prisma.ndcRequest.update({
    where: { id: req.id },
    data: { status: 'APPROVED' }
  });

  console.log('Generating certificate...');
  try {
    const cert = await CertificateService.generateCertificate(req.id);
    console.log('Certificate generated:', cert.certificateNumber, cert.id);
    console.log('cert.studentId:', cert.studentId);
    console.log('cert.pdfPath:', cert.pdfPath);

    // Now test downloading it via a mock req/res
    const mockReq: any = {
      params: { id: cert.id },
      user: {
        role: 'SUPER_ADMIN',
        id: 'mock-admin'
      }
    };

    let statusCode = 200;
    let headers: any = {};
    let errorJson: any = null;

    const mockRes: any = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(data: any) {
        errorJson = data;
        return this;
      },
      setHeader(k: string, v: string) {
        headers[k] = v;
      },
      write() {},
      end() {},
      on() {},
      once() {},
      emit() {}
    };

    await CertificateController.downloadPdf(mockReq, mockRes);
    console.log('downloadPdf statusCode:', statusCode);
    console.log('downloadPdf errorJson:', errorJson);
    console.log('downloadPdf headers:', headers);
  } catch (err: any) {
    console.error('Error generating/downloading:', err);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
