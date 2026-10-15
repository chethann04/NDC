import dotenv from 'dotenv';
dotenv.config();

import EmailService from '../src/services/EmailService';

async function main() {
  const targetEmail = process.argv[2] || process.env.REGISTERED_STUDENT_EMAIL || 'chethuc809@gmail.com';
  console.log(`[Live Test]: Preparing to send live test email to: ${targetEmail}`);
  console.log(`[Live Test]: RESEND_API_KEY is ${process.env.RESEND_API_KEY ? 'Present' : 'MISSING'}`);
  console.log(`[Live Test]: EMAIL_FROM is ${process.env.EMAIL_FROM || 'Default sandbox'}`);

  const result = await EmailService.sendMailDetailed({
    to: targetEmail,
    subject: `[MCE NDC Portal] Live Resend Verification - ${new Date().toLocaleTimeString()}`,
    html: `
      <div style="font-family: Arial, sans-serif; padding: 24px; background-color: #f0fdf4; border-radius: 12px; color: #1e293b;">
        <h2 style="color: #047857; margin-top: 0;">MCE No Due Portal - Resend Test</h2>
        <p>This is a live test email confirming that your Resend integration is operational and delivering properly.</p>
        <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
        <hr style="border: none; border-top: 1px solid #bbf7d0; margin: 16px 0;" />
        <p style="font-size: 12px; color: #64748b;">Malnad College of Engineering, Hassan</p>
      </div>
    `
  });

  console.log('[Live Test Result]:', JSON.stringify(result, null, 2));
}

main().catch(console.error);
