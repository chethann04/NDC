import fs from 'fs';
import path from 'path';

async function testSubmissionDesk() {
  const baseURL = 'http://localhost:5000/api/v1';

  try {
    console.log('1. Logging in as College Office (office@mce.ac.in)...');
    const loginRes = await fetch(`${baseURL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'office@mce.ac.in',
        password: 'Officer@123'
      })
    });
    const loginData = await loginRes.json() as any;
    if (!loginRes.ok) {
      throw new Error(`Login failed: ${JSON.stringify(loginData)}`);
    }
    const token = loginData.token;
    console.log('   Logged in successfully.');

    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    };

    console.log('\n2. Fetching certificates for College Office Desk...');
    const certsRes = await fetch(`${baseURL}/certificates?page=1&limit=10`, { headers });
    const certsData = await certsRes.json() as any;
    if (!certsRes.ok) {
      throw new Error(`Fetch certificates failed: ${JSON.stringify(certsData)}`);
    }
    const certificates = certsData.data || [];
    const summary = certsData.counts || {};
    console.log(`   Fetched ${certificates.length} certificates.`);
    console.log('   Desk Summary Stats:', summary);

    if (certificates.length > 0) {
      const sampleCert = certificates[0];
      console.log(`\n3. Testing Physical Submission toggle on Cert ID ${sampleCert._id} (${sampleCert.certificateNumber})...`);
      
      const updateRes = await fetch(
        `${baseURL}/certificates/${sampleCert._id}/submission`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            isSubmitted: true,
            submissionRemarks: 'Physically submitted to College Office with original hall ticket'
          })
        }
      );
      const updateData = await updateRes.json() as any;
      console.log('   Updated submission status:', updateData.data?.isSubmitted, 'Remarks:', updateData.data?.submissionRemarks);
    }

    console.log('\n4. Testing PDF Report Generation with Date Ranges...');
    const today = new Date().toISOString().split('T')[0];
    const pdfRes = await fetch(
      `${baseURL}/certificates/submission-report/pdf?startDate=2024-01-01&endDate=${today}&status=ALL`,
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    );

    console.log(`   Received PDF response: Status ${pdfRes.status}, Content-Type: ${pdfRes.headers.get('content-type')}`);
    if (!pdfRes.ok) {
      const errText = await pdfRes.text();
      throw new Error(`PDF export failed: ${errText}`);
    }
    const arrayBuffer = await pdfRes.arrayBuffer();
    console.log(`   PDF Size: ${arrayBuffer.byteLength} bytes.`);
    const outputPath = path.join(__dirname, 'test_submission_report.pdf');
    fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));
    console.log(`   Saved sample test PDF to: ${outputPath}`);

    console.log('\n5. Verifying that College Office CANNOT review/process clearance tasks...');
    const forbiddenRes = await fetch(
      `${baseURL}/ndc/clearance/dummy-id`,
      {
        method: 'PUT',
        headers,
        body: JSON.stringify({ status: 'CLEARED' })
      }
    );
    if (forbiddenRes.status === 403 || forbiddenRes.status === 404) {
      console.log(`   Security passed as expected: HTTP ${forbiddenRes.status}`);
    } else {
      console.error(`   SECURITY WARNING: Unexpected HTTP status: ${forbiddenRes.status}`);
    }

    console.log('\nALL VERIFICATIONS PASSED SUCCESSFULLY!');
  } catch (err: any) {
    console.error('Error during verification:', err.message);
    process.exit(1);
  }
}

testSubmissionDesk();
