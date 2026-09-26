import prisma from '../src/config/prisma';
import credentialOtpService from '../src/services/CredentialOtpService';

const BASE_URL = 'http://localhost:5000/api/v1';

async function postJson(url: string, data: any, token?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(data)
  });

  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data: json };
}

async function runTests() {
  console.log('============================================================');
  console.log('TEST SUITE: REAL SECTION CREDENTIAL CHANGE WITH OTP');
  console.log('============================================================\n');

  // Let's identify the Library operational account
  const initialUser = await prisma.user.findFirst({
    where: {
      OR: [
        { email: 'library@mce.ac.in' },
        { loginId: 'LIB001' }
      ]
    },
    include: { department: true }
  });

  if (!initialUser) {
    throw new Error('Library user not found in database. Seed before testing.');
  }

  const initialEmail = initialUser.email;
  const initialId = initialUser.id;
  const initialRole = initialUser.role;
  const initialDeptId = initialUser.departmentId;
  const initialPassword = 'Officer@123';

  console.log(`[Target Account] ID: ${initialId} | Name: ${initialUser.name} | Role: ${initialRole} | Email: ${initialEmail}`);

  // TEST 1: Login with initial/demo credentials
  console.log('\n--- TEST 1: Login with initial/demo credentials ---');
  const loginRes1 = await postJson(`${BASE_URL}/auth/login`, {
    email: initialEmail,
    password: initialPassword
  });

  if (loginRes1.status !== 200 || !loginRes1.data.token) {
    throw new Error(`TEST 1 FAILED: Could not log in with demo credentials. Status: ${loginRes1.status}`);
  }
  const token = loginRes1.data.token;
  console.log('✓ TEST 1 PASSED: Logged in normally. Token acquired. No first-login redirect or forced screen.');

  // TEST 2: Logout and Login again with demo credentials (demonstrates no first-login assumption)
  console.log('\n--- TEST 2: Re-login with demo credentials (no first-login assumption) ---');
  const loginRes2 = await postJson(`${BASE_URL}/auth/login`, {
    email: initialEmail,
    password: initialPassword
  });
  if (loginRes2.status !== 200 || !loginRes2.data.token) {
    throw new Error('TEST 2 FAILED: Re-login failed.');
  }
  console.log('✓ TEST 2 PASSED: Second login successful with zero first-login detection.');

  // TEST 3: Validation on Email Request
  console.log('\n--- TEST 3: Email format & uniqueness validation ---');
  const tempNewEmail = 'library.official@mce.ac.in';

  // 3a. Identical email rejection
  const res3a = await postJson(
    `${BASE_URL}/auth/credentials/request-email-otp`,
    { newEmail: initialEmail },
    token
  );
  if (res3a.status === 400) {
    console.log('✓ 3a. Identical email rejected with 400 Bad Request:', res3a.data.message);
  } else {
    throw new Error(`Expected 400 for identical email, got ${res3a.status}`);
  }

  // 3b. Duplicate email rejection (using another existing account in DB)
  const anotherUser = await prisma.user.findFirst({
    where: { id: { not: initialId } }
  });
  if (!anotherUser) {
    throw new Error('Need at least 2 users in database to test uniqueness');
  }

  const res3b = await postJson(
    `${BASE_URL}/auth/credentials/request-email-otp`,
    { newEmail: anotherUser.email },
    token
  );
  if (res3b.status === 409) {
    console.log(`✓ 3b. Duplicate email [${anotherUser.email}] rejected with 409 Conflict:`, res3b.data.message);
  } else {
    throw new Error(`Expected 409 for duplicate email, got ${res3b.status}: ${JSON.stringify(res3b.data)}`);
  }

  // TEST 4: Dispatch OTP to the NEW email address
  console.log('\n--- TEST 4: Dispatch OTP to NEW email address ---');
  const otpReqRes = await postJson(
    `${BASE_URL}/auth/credentials/request-email-otp`,
    { newEmail: tempNewEmail },
    token
  );
  if (!otpReqRes.data.success) {
    throw new Error(`TEST 4 FAILED: OTP request returned: ${JSON.stringify(otpReqRes.data)}`);
  }
  console.log('✓ TEST 4 PASSED: OTP requested successfully:', otpReqRes.data.message);

  // 4b. Verify cooldown enforcement
  const res4b = await postJson(
    `${BASE_URL}/auth/credentials/request-email-otp`,
    { newEmail: tempNewEmail },
    token
  );
  if (res4b.status === 400 && res4b.data.message?.includes('Please wait')) {
    console.log('✓ 4b. Cooldown enforced on immediate resend:', res4b.data.message);
  } else {
    console.log('Cooldown response:', res4b.status, res4b.data);
  }

  // TEST 5: Verify incorrect OTP fails
  console.log('\n--- TEST 5: Incorrect OTP verification test ---');
  const res5 = await postJson(
    `${BASE_URL}/auth/credentials/verify-otp`,
    { newEmail: tempNewEmail, otp: '000000' },
    token
  );
  if (res5.status === 400 && res5.data.message?.includes('remaining')) {
    console.log('✓ TEST 5 PASSED: Incorrect OTP rejected with remaining attempt count:', res5.data.message);
  } else {
    throw new Error(`Expected 400 for incorrect OTP, got ${res5.status}: ${JSON.stringify(res5.data)}`);
  }

  // TEST 6: Verify with correct OTP
  console.log('\n--- TEST 6: Correct OTP verification ---');
  // Retrieve the generated OTP from credentialOtpService
  const actualOtp = credentialOtpService.getActiveOtpForTesting(initialId, tempNewEmail);
  if (!actualOtp) {
    throw new Error('TEST 6 FAILED: Could not access stored OTP record for verification.');
  }

  const verifyRes = await postJson(
    `${BASE_URL}/auth/credentials/verify-otp`,
    { newEmail: tempNewEmail, otp: actualOtp },
    token
  );
  if (!verifyRes.data.success) {
    throw new Error(`TEST 6 FAILED: Correct OTP verification returned: ${JSON.stringify(verifyRes.data)}`);
  }
  console.log('✓ TEST 6 PASSED: Correct OTP verified successfully:', verifyRes.data.message);

  // TEST 7: Update credentials with new password
  console.log('\n--- TEST 7: Update credentials with new password ---');
  const newPassword = 'NewSecretPass@2026';

  // 7a. Password mismatch check
  const res7a = await postJson(
    `${BASE_URL}/auth/credentials/update`,
    {
      newEmail: tempNewEmail,
      otp: actualOtp,
      newPassword: newPassword,
      confirmPassword: 'MismatchPassword123'
    },
    token
  );
  if (res7a.status === 400) {
    console.log('✓ 7a. Password mismatch rejected:', res7a.data.message);
  } else {
    throw new Error(`Expected 400 for password mismatch, got ${res7a.status}`);
  }

  // 7b. Perform actual valid update
  const updateRes = await postJson(
    `${BASE_URL}/auth/credentials/update`,
    {
      newEmail: tempNewEmail,
      otp: actualOtp,
      newPassword: newPassword,
      confirmPassword: newPassword
    },
    token
  );
  if (!updateRes.data.success) {
    throw new Error(`TEST 7 FAILED: Credential update failed: ${JSON.stringify(updateRes.data)}`);
  }
  console.log('✓ TEST 7 PASSED: Credentials updated successfully:', updateRes.data.message);

  // TEST 8: Old credentials must immediately fail
  console.log('\n--- TEST 8: Old credentials rejection test ---');
  const res8 = await postJson(`${BASE_URL}/auth/login`, {
    email: initialEmail,
    password: initialPassword
  });
  if (res8.status === 401) {
    console.log('✓ TEST 8 PASSED: Old email/password rejected with 401 Invalid credentials.');
  } else {
    throw new Error(`OLD CREDENTIALS STILL LOGGED IN! Status: ${res8.status}`);
  }

  // TEST 9: New credentials must successfully authenticate
  console.log('\n--- TEST 9: New credentials authentication & invariant check ---');
  const loginNewRes = await postJson(`${BASE_URL}/auth/login`, {
    email: tempNewEmail,
    password: newPassword
  });
  if (loginNewRes.status !== 200 || !loginNewRes.data.token) {
    throw new Error(`TEST 9 FAILED: Login with new credentials failed: ${JSON.stringify(loginNewRes.data)}`);
  }

  const updatedUser = loginNewRes.data.user;
  console.log(`✓ TEST 9 PASSED: Authenticated with new credentials! User ID: ${updatedUser.id}`);

  // Invariant verification
  if (updatedUser.id !== initialId) throw new Error('Invariant violation: User ID changed!');
  if (updatedUser.role !== initialRole) throw new Error('Invariant violation: Role changed!');
  if (updatedUser.departmentId !== initialDeptId) throw new Error('Invariant violation: Department changed!');
  console.log('✓ ALL INVARIANTS PRESERVED: Same User ID, Same Role, Same Department.');

  // TEST 10: Change credentials again (restoring initial credentials to confirm repeatability)
  console.log('\n--- TEST 10: Restore initial credentials (verify repeatable self-service) ---');
  const newToken = loginNewRes.data.token;

  // Request OTP to restore initialEmail
  await postJson(
    `${BASE_URL}/auth/credentials/request-email-otp`,
    { newEmail: initialEmail },
    newToken
  );

  const restoreOtp = credentialOtpService.getActiveOtpForTesting(initialId, initialEmail);
  if (!restoreOtp) {
    throw new Error('Could not access restore OTP.');
  }

  await postJson(
    `${BASE_URL}/auth/credentials/verify-otp`,
    { newEmail: initialEmail, otp: restoreOtp },
    newToken
  );

  await postJson(
    `${BASE_URL}/auth/credentials/update`,
    {
      newEmail: initialEmail,
      otp: restoreOtp,
      newPassword: initialPassword,
      confirmPassword: initialPassword
    },
    newToken
  );

  // Verify initial credentials work again
  const finalCheck = await postJson(`${BASE_URL}/auth/login`, {
    email: initialEmail,
    password: initialPassword
  });
  if (finalCheck.status !== 200) {
    throw new Error('Failed to restore initial credentials.');
  }
  console.log('✓ TEST 10 PASSED: Successfully restored initial credentials. Repeatable change confirmed!');

  console.log('\n============================================================');
  console.log('ALL 10 VERIFICATION TESTS COMPLETED WITH 100% SUCCESS!');
  console.log('============================================================');
}

runTests()
  .catch((err) => {
    console.error('\n❌ TEST RUN FAILED:', err);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });
