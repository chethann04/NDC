import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

async function runDiagnostic() {
  console.log('=== EMAIL SYSTEM DIAGNOSTIC ===');
  console.log('SMTP_HOST:', process.env.SMTP_HOST);
  console.log('SMTP_PORT:', process.env.SMTP_PORT);
  console.log('SMTP_USER:', process.env.SMTP_USER);
  console.log('SMTP_FROM:', process.env.SMTP_FROM);

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    tls: { rejectUnauthorized: false }
  });

  try {
    console.log('Verifying SMTP connection...');
    await transporter.verify();
    console.log('✓ SMTP Connection Verified Successfully!');
  } catch (err: any) {
    console.error('✗ SMTP Verification Failed:', err.message);
    return;
  }

  const testRecipients = ['chethuc809@gmail.com', 'chethannhs04@gmail.com'];
  for (const to of testRecipients) {
    try {
      console.log(`Sending live test email to: ${to}...`);
      const info = await transporter.sendMail({
        from: `"MCE No Due Certificate Portal" <${process.env.SMTP_USER}>`,
        to,
        subject: `[Diagnostic Test] MCE NDC Portal - ${new Date().toLocaleTimeString()}`,
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; background: #f0fdf4; border-radius: 8px;">
            <h2 style="color: #047857;">MCE No Due Portal Email Test</h2>
            <p>This is a live test email confirming that automated clearance notifications and certificates are delivering correctly.</p>
            <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
          </div>
        `
      });
      console.log(`✓ Delivered to ${to}: MessageId: ${info.messageId}, Response: ${info.response}`);
    } catch (err: any) {
      console.error(`✗ Failed sending to ${to}:`, err.message);
    }
  }
}

runDiagnostic().catch(console.error);
