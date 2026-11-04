const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  console.log('--- Testing AI Assistant Response Redesign ---');

  // Find a student and physics department officer
  const student = await prisma.student.findFirst({
    where: { isActive: true },
    include: { department: true }
  });

  const dept = await prisma.clearanceDepartment.findFirst({
    where: { code: 'PHY' }
  });

  const officer = await prisma.user.findFirst({
    where: { role: 'DEPARTMENT_OFFICER', departmentId: dept.id }
  }) || await prisma.user.findFirst({
    where: { role: 'DEPARTMENT_OFFICER' }
  });

  if (!student || !dept || !officer) {
    console.error('Missing student, department, or officer for test.');
    process.exit(1);
  }

  console.log(`Using Student: ${student.fullName} (${student.usn})`);
  console.log(`Using Officer: ${officer.name} (${officer.role})`);
  console.log(`Department: ${dept.name} (${dept.code})`);

  // Ensure NDC Request and clearance exist
  const { NdcWorkflowService } = require('./dist/services/NdcWorkflowService');
  await NdcWorkflowService.ensureStudentNdcRequest(student.id);

  let clearance = await prisma.ndcClearance.findFirst({
    where: { studentId: student.id, departmentId: dept.id }
  });

  // Reset clearance to CLEARED with 0 dues for clean testing
  await prisma.ndcClearance.update({
    where: { id: clearance.id },
    data: { status: 'CLEARED', dueAmount: 0, dueDetails: null }
  });

  const { AiAssistantService } = require('./dist/services/AiAssistantService');

  // Test 1: Stage New Outstanding Due
  console.log('\n=== TEST 1: Staging New Outstanding Due ===');
  const addDueRes = await AiAssistantService.processMessage({
    user: { id: officer.id, role: officer.role, name: officer.name, departmentId: officer.departmentId },
    departmentCode: dept.code,
    messages: [
      { role: 'user', content: `Add ₹300 due for Broken Glass for USN ${student.usn}` }
    ]
  });

  console.log('Reply Output:\n', addDueRes.reply);
  console.log('ActionRequired isModification:', addDueRes.actionRequired?.isModification);
  console.log('ActionRequired amount:', addDueRes.actionRequired?.amount);

  if (!addDueRes.reply.includes('New Outstanding Due')) {
    throw new Error('Test 1 Failed: Reply does not contain "New Outstanding Due"');
  }
  if (!addDueRes.reply.includes('Do you want to continue?')) {
    throw new Error('Test 1 Failed: Reply does not contain "Do you want to continue?"');
  }
  if (addDueRes.reply.includes('Validation Established') || addDueRes.reply.includes('1. Understood')) {
    throw new Error('Test 1 Failed: Reply contains technical jargon or numbered checklist!');
  }
  console.log('✅ TEST 1 PASSED: Clean New Outstanding Due summary staged correctly.');

  // Confirm Test 1 (Execution of New Due)
  console.log('\n=== TEST 2: Confirming New Outstanding Due ===');
  const token1 = addDueRes.actionRequired.token;
  const exec1 = await AiAssistantService.confirmAndExecute(token1, officer.id);

  console.log('Completion Reply Output:\n', exec1.completionReply);
  console.log('Verified Due Amount:', exec1.dueAmount);
  console.log('Overall NDC Status:', exec1.overallNdcStatus);

  if (!exec1.completionReply.includes('Outstanding Due Added Successfully!')) {
    throw new Error('Test 2 Failed: Completion reply does not contain "Outstanding Due Added Successfully!"');
  }
  if (exec1.completionReply.includes('1. Operation Succeeded') || exec1.completionReply.includes('### ✅ Action Executed and Verified')) {
    throw new Error('Test 2 Failed: Completion reply contains old 7-point numbered list!');
  }
  console.log('✅ TEST 2 PASSED: Clean success response returned for New Due.');

  // Test 3: Modify Existing Due
  console.log('\n=== TEST 3: Staging Modification of Existing Due ===');
  // Student now has ₹300 due in DB. Officer asks to change due to ₹360
  const modDueRes = await AiAssistantService.processMessage({
    user: { id: officer.id, role: officer.role, name: officer.name, departmentId: officer.departmentId },
    departmentCode: dept.code,
    messages: [
      { role: 'user', content: `Change the due amount for USN ${student.usn} to ₹360` }
    ]
  });

  console.log('Modify Reply Output:\n', modDueRes.reply);
  console.log('ActionRequired isModification:', modDueRes.actionRequired?.isModification);
  console.log('ActionRequired previousAmount:', modDueRes.actionRequired?.previousAmount);
  console.log('ActionRequired newAmount:', modDueRes.actionRequired?.newAmount);
  console.log('ActionRequired difference:', modDueRes.actionRequired?.difference);

  if (!modDueRes.reply.includes('Update Due Amount')) {
    throw new Error('Test 3 Failed: Reply does not contain "Update Due Amount"');
  }
  if (!modDueRes.reply.includes('Current Amount: ₹300')) {
    throw new Error('Test 3 Failed: Reply does not contain "Current Amount: ₹300"');
  }
  if (!modDueRes.reply.includes('New Amount: ₹360')) {
    throw new Error('Test 3 Failed: Reply does not contain "New Amount: ₹360"');
  }
  if (!modDueRes.reply.includes('Difference: +₹60')) {
    throw new Error('Test 3 Failed: Reply does not contain "Difference: +₹60"');
  }
  if (!modDueRes.reply.includes('Should I save this change?')) {
    throw new Error('Test 3 Failed: Reply does not contain "Should I save this change?"');
  }
  console.log('✅ TEST 3 PASSED: Clean Update Due Amount summary staged correctly.');

  // Confirm Test 3 (Execution of Modification)
  console.log('\n=== TEST 4: Confirming Modification of Due ===');
  const token2 = modDueRes.actionRequired.token;
  const exec2 = await AiAssistantService.confirmAndExecute(token2, officer.id);

  console.log('Completion Reply Output:\n', exec2.completionReply);
  console.log('Verified Due Amount:', exec2.dueAmount);
  console.log('Previous Amount:', exec2.previousAmount);
  console.log('Overall NDC Status:', exec2.overallNdcStatus);

  if (!exec2.completionReply.includes('Due Amount Updated Successfully!')) {
    throw new Error('Test 4 Failed: Completion reply does not contain "Due Amount Updated Successfully!"');
  }
  if (!exec2.completionReply.includes('Previous Amount: ₹300') || !exec2.completionReply.includes('New Amount: ₹360')) {
    throw new Error('Test 4 Failed: Completion reply does not show previous and new amount!');
  }
  console.log('✅ TEST 4 PASSED: Clean success response returned for Modified Due.');

  // Clean up: reset clearance back to cleared
  await prisma.ndcClearance.update({
    where: { id: clearance.id },
    data: { status: 'CLEARED', dueAmount: 0, dueDetails: null }
  });
  console.log('\nAll tests completed successfully!');
  await prisma.$disconnect();
}

run().catch(async (e) => {
  console.error('Test execution error:', e);
  await prisma.$disconnect();
  process.exit(1);
});
