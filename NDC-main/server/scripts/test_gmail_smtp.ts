import nodemailer from 'nodemailer';

async function testGmail() {
  console.log('Testing Gmail SMTP connection...');
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, // SSL
    auth: {
      user: '4mc24is022@gmail.com',
      pass: 'ctvahxouinazbzui'
    }
  });

  try {
    await transporter.verify();
    console.log('✓ Gmail SMTP connection verified successfully!');

    console.log('Sending test email to chethuc809@gmail.com...');
    const info = await transporter.sendMail({
      from: '"MCE No Due Portal" <4mc24is022@gmail.com>',
      to: 'chethuc809@gmail.com',
      subject: `[MCE NDC Portal] Live Gmail SMTP Test - ${new Date().toLocaleTimeString()}`,
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; background: #ecfdf5; border-radius: 8px;">
          <h2 style="color: #047857;">MCE No Due Portal: Gmail SMTP Verification</h2>
          <p>Congratulations! This email confirms that Gmail App Password is successfully sending emails to real students without needing a custom domain.</p>
          <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
        </div>
      `
    });

    console.log('✓ Email sent successfully! MessageId:', info.messageId);
  } catch (err: any) {
    console.error('✗ Failed to send via Gmail SMTP:', err.message);
  }
}

testGmail();
