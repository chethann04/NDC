
const fs = require('fs');
const path = require('path');

const cacheFile = path.join(
    __dirname,
    '.cache',
    'credential_otps.json'
);

const userId = 'otp-security-test-user';
const currentEmail = 'current@example.com';
const newEmail = 'new@example.com';
const otp = '123456';
const key = `${userId}:${newEmail}`;

async function run() {
    if (!fs.existsSync(cacheFile)) {
        throw new Error('OTP cache file not found. Stopping safely.');
    }

    const originalCache = fs.readFileSync(cacheFile, 'utf8');
    let exitCode = 0;

    try {
        const module = require('./dist/services/CredentialOtpService');
        const service =
            module.default ||
            module.credentialOtpService ||
            module;

        if (typeof service.consumeVerifiedOtp !== 'function') {
            throw new Error(
                'Could not find consumeVerifiedOtp on the exported service.'
            );
        }

        const makeRecord = (verified, code = otp, expiresAt =
            new Date(Date.now() + 5 * 60 * 1000).toISOString()) => ({
                userId,
                currentEmail,
                newEmail,
                otp: code,
                attempts: 0,
                maxAttempts: 5,
                expiresAt,
                resendAvailableAt: new Date(Date.now() + 60_000).toISOString(),
                verified,
                purpose: 'SELF_SERVICE_CHANGE'
            });

        const writeRecord = record => {
            fs.writeFileSync(
                cacheFile,
                JSON.stringify({ [key]: record }, null, 2)
            );
        };

        const check = (condition, message) => {
            if (!condition) throw new Error(message);
            console.log(`PASS: ${message}`);
        };

        // 1. Unverified OTP must not be consumed.
        writeRecord(makeRecord(false));
        const unverified = service.consumeVerifiedOtp(userId, newEmail, otp);
        check(!unverified.success, 'Unverified OTP rejected.');

        // 2. Incorrect OTP must not be accepted.
        writeRecord(makeRecord(true));
        const wrong = service.consumeVerifiedOtp(userId, newEmail, '999999');
        check(!wrong.success, 'Incorrect OTP rejected.');

        // 3. Expired OTP must be rejected.
        writeRecord(makeRecord(
            true,
            otp,
            new Date(Date.now() - 60_000).toISOString()
        ));
        const expired = service.consumeVerifiedOtp(userId, newEmail, otp);
        check(!expired.success, 'Expired OTP rejected.');

        // 4. Correct verified OTP must work once, then fail on reuse.
        writeRecord(makeRecord(true));
        const firstUse = service.consumeVerifiedOtp(userId, newEmail, otp);
        check(firstUse.success === true, 'Verified OTP accepted once.');

        const secondUse = service.consumeVerifiedOtp(userId, newEmail, otp);
        check(secondUse.success === false, 'Reusing OTP rejected.');
    } catch (error) {
        exitCode = 1;
        console.error('TEST FAILED:', error.message);
    } finally {
        fs.writeFileSync(cacheFile, originalCache);
        console.log('Original OTP cache restored.');
    }

    // The service starts a periodic cleanup timer.
    process.exit(exitCode);
}

run().catch(error => {
    console.error('TEST FAILED:', error.message);
    process.exit(1);
});
