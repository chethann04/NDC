import prisma from '../src/config/prisma';
import { DepartmentClearanceStatus } from '../src/constants/statuses';
import { UserRole } from '../src/constants/roles';
import { DepartmentAgentRegistry } from '../src/services/ai/DepartmentAgentRegistry';
import { MultiActionExtractionService, ExtractedActionItem } from '../src/services/ai/MultiActionExtractionService';
import { AgentToolExecutionService } from '../src/services/ai/AgentToolExecutionService';
import { LaboratoryAggregationService } from '../src/services/LaboratoryAggregationService';

async function runMultiAgentPlatformTests() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║  NDC MULTI-AGENT INTELLIGENCE PLATFORM VERIFICATION TEST SUITE  ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, details?: any) {
    if (condition) {
      console.log(`  [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${testName}`, details || '');
      failed++;
    }
  }

  try {
    // =========================================================================
    // 1. DEPARTMENT AGENT REGISTRY & DOMAIN SPECIALIZATION
    // =========================================================================
    console.log('\n--- 1. Testing Department Agent Registry & Domain Knowledge ---');
    
    const allConfigs = DepartmentAgentRegistry.getAllConfigs();
    assert(allConfigs.length >= 10, `Registry contains ${allConfigs.length} departments (expected >= 10)`);

    const phyConfig = DepartmentAgentRegistry.getConfig('PHY');
    assert(phyConfig !== null, 'Physics config registered');
    assert(Boolean(phyConfig?.knowledgeSources?.apparatusList?.some(a => a.toLowerCase().includes('sonometer'))), 'Physics apparatus contains sonometer');
    assert(phyConfig?.clearanceTarget === 'Physics Laboratory Clearance', 'Physics targets Physics Laboratory Clearance');

    const chemConfig = DepartmentAgentRegistry.getConfig('CHEM');
    assert(chemConfig !== null, 'Chemistry config registered');
    assert(Boolean(chemConfig?.knowledgeSources?.glasswareList?.some(a => a.toLowerCase().includes('burette'))), 'Chemistry glassware contains burette');

    const libConfig = DepartmentAgentRegistry.getConfig('LIB');
    assert(libConfig !== null, 'Library config registered');
    assert(Boolean(libConfig?.knowledgeSources?.fineRules && libConfig.knowledgeSources.fineRules.length > 0), 'Library fine rules configured');
    assert(Boolean(libConfig?.extractionSchema?.fields?.some((f: any) => f.name === 'bookTitle')), 'Library extraction schema has bookTitle');

    const unknownConfig = DepartmentAgentRegistry.getConfig('NONEXISTENT_DEPT');
    assert(unknownConfig === null, 'Unknown department returns null safely without throwing');

    // =========================================================================
    // 2. MULTI-ACTION NATURAL LANGUAGE EXTRACTION
    // =========================================================================
    console.log('\n--- 2. Testing Multi-Action Extraction & Respectively Resolution ---');

    const phyDept = await prisma.clearanceDepartment.findFirst({ where: { code: 'PHY' } });
    const chemDept = await prisma.clearanceDepartment.findFirst({ where: { code: 'CHEM' } });

    assert(Boolean(phyDept), 'Physics department resolved from DB');
    assert(Boolean(chemDept), 'Chemistry department resolved from DB');

    const phyDeptInfo = { id: phyDept!.id, code: phyDept!.code, name: phyDept!.name };

    // Resolve or create student 1
    let student1 = await prisma.student.findFirst({ where: { usn: { equals: '4MC22EC002', mode: 'insensitive' } } });
    if (!student1) {
      student1 = await prisma.student.create({
        data: {
          studentId: '4MC22EC002',
          usn: '4MC22EC002',
          fullName: 'Ananya Sharma',
          email: 'ananya.sharma.test@mcehassan.ac.in',
          departmentId: phyDept!.id,
          year: '2nd Year',
          semester: '4th Semester'
        }
      });
    }

    // Resolve or create student 2
    let student2 = await prisma.student.findFirst({ where: { usn: { equals: '4MC24IS022', mode: 'insensitive' } } });
    if (!student2) {
      student2 = await prisma.student.create({
        data: {
          studentId: '4MC24IS022',
          usn: '4MC24IS022',
          fullName: 'Kiran Kumar',
          email: 'kiran.kumar.test@mcehassan.ac.in',
          departmentId: phyDept!.id,
          year: '1st Year',
          semester: '2nd Semester'
        }
      });
    }

    // Ensure active NdcRequests exist for clearances
    let req1 = await prisma.ndcRequest.findFirst({ where: { studentId: student1.id } });
    if (!req1) {
      req1 = await prisma.ndcRequest.create({
        data: {
          requestNumber: `REQ-TEST-${Date.now()}-1`,
          studentId: student1.id
        }
      });
    }

    let req2 = await prisma.ndcRequest.findFirst({ where: { studentId: student2.id } });
    if (!req2) {
      req2 = await prisma.ndcRequest.create({
        data: {
          requestNumber: `REQ-TEST-${Date.now()}-2`,
          studentId: student2.id
        }
      });
    }

    // Ensure Physics clearances exist
    let cl1 = await prisma.ndcClearance.findFirst({ where: { studentId: student1.id, departmentId: phyDept!.id } });
    if (!cl1) {
      cl1 = await prisma.ndcClearance.create({
        data: {
          ndcRequestId: req1.id,
          studentId: student1.id,
          departmentId: phyDept!.id,
          status: DepartmentClearanceStatus.PENDING,
          dueAmount: 0
        }
      });
    }
    let cl2 = await prisma.ndcClearance.findFirst({ where: { studentId: student2.id, departmentId: phyDept!.id } });
    if (!cl2) {
      cl2 = await prisma.ndcClearance.create({
        data: {
          ndcRequestId: req2.id,
          studentId: student2.id,
          departmentId: phyDept!.id,
          status: DepartmentClearanceStatus.PENDING,
          dueAmount: 0
        }
      });
    }

    // Test 2a: Single Action extraction
    const singleMsg = "Add ₹300 for the broken sonometer wire for student 4MC22EC002.";
    const singleRes = await MultiActionExtractionService.parseActions(singleMsg, phyDeptInfo);
    assert(!singleRes.needsClarification, 'Single action parsed without ambiguity');
    assert(singleRes.actions.length === 1, 'Extracted 1 action');
    assert(singleRes.actions[0].amount === 300, 'Extracted amount is 300');
    assert(singleRes.actions[0].usn === '4MC22EC002', 'Extracted USN is 4MC22EC002');
    assert(singleRes.actions[0].reason.toLowerCase().includes('sonometer'), 'Extracted reason contains sonometer');

    // Test 2b: Multi-Action extraction with "respectively"
    const multiMsg = "For students 4MC22EC002 and 4MC24IS022, add dues of ₹300 and ₹1,500 for breaking the sonometer wire and breaking the optic fibre respectively.";
    const multiRes = await MultiActionExtractionService.parseActions(multiMsg, phyDeptInfo);
    assert(!multiRes.needsClarification, 'Multi-action parsed without ambiguity');
    assert(multiRes.actions.length === 2, `Extracted 2 separate actions (got ${multiRes.actions.length})`);
    
    const act1 = multiRes.actions.find(a => a.usn === '4MC22EC002');
    const act2 = multiRes.actions.find(a => a.usn === '4MC24IS022');
    assert(Boolean(act1 && act2), 'Both students resolved in batch actions');
    assert(act1?.amount === 300, `Student 1 correctly associated with ₹300 (got ${act1?.amount})`);
    assert(Boolean(act1?.reason.toLowerCase().includes('sonometer')), 'Student 1 correctly associated with sonometer wire');
    assert(act2?.amount === 1500, `Student 2 correctly associated with ₹1,500 (got ${act2?.amount})`);
    assert(Boolean(act2?.reason.toLowerCase().includes('optic')), 'Student 2 correctly associated with optic fibre');

    // Test 2c: Ambiguity detection on count mismatch (2 students, 1 amount)
    const ambiguousMsg = "Add ₹300 due for students 4MC22EC002 and 4MC24IS022";
    const ambigRes = await MultiActionExtractionService.parseActions(ambiguousMsg, phyDeptInfo);
    assert(ambigRes.needsClarification === true, 'Ambiguity correctly flagged for 2 students with only 1 amount');
    assert(Boolean(ambigRes.clarificationPrompt), 'Clarification question generated for ambiguous instruction');

    // =========================================================================
    // 3. STRICT SERVER-SIDE AUTHORIZATION ISOLATION
    // =========================================================================
    console.log('\n--- 3. Testing RBAC Department Isolation & Security Boundaries ---');

    let phyOfficer = await prisma.user.findFirst({
      where: {
        role: UserRole.DEPARTMENT_OFFICER,
        departmentId: phyDept!.id
      }
    });
    if (!phyOfficer) {
      phyOfficer = await prisma.user.create({
        data: {
          name: 'Physics Lab Officer Test',
          email: 'phy.officer.multiagent@mcehassan.ac.in',
          passwordHash: 'dummy_hash',
          role: UserRole.DEPARTMENT_OFFICER,
          departmentId: phyDept!.id
        }
      });
    }

    const authCheckPhy = await AgentToolExecutionService.authorizeOfficerForDepartment(phyOfficer.id, phyDept!.id);
    assert(authCheckPhy.authorized === true, 'Physics officer authorized for Physics Department');

    const authCheckChem = await AgentToolExecutionService.authorizeOfficerForDepartment(phyOfficer.id, chemDept!.id);
    assert(authCheckChem.authorized === false, 'Physics officer is strictly DENIED authorization for Chemistry Department');

    // =========================================================================
    // 4. MANDATORY HUMAN CONFIRMATION & EXECUTION GUARANTEES
    // =========================================================================
    console.log('\n--- 4. Testing Mandatory Confirmation, Replay & Batch Execution ---');

    // 4a. Reset cl1 to PENDING before test
    await prisma.ndcClearance.update({
      where: { id: cl1.id },
      data: { status: DepartmentClearanceStatus.PENDING, dueAmount: 0, dueDetails: '' }
    });

    const stagedActionItem: ExtractedActionItem = {
      actionId: 'act-1',
      action: 'MARK_DUE',
      usn: student1.usn,
      studentId: student1.id,
      studentName: student1.fullName,
      clearanceId: cl1.id,
      amount: 300,
      reason: 'Broken sonometer wire',
      departmentCode: 'PHY',
      departmentName: 'Physics Department',
      consequences: 'Student clearance marked as DUE (₹300)'
    };

    const stagedPayload = await AgentToolExecutionService.stageActionsForConfirmation(
      phyOfficer.id,
      phyDeptInfo,
      [stagedActionItem]
    );

    assert(Boolean(stagedPayload.token), 'Action successfully staged with secure token');

    // 4b. Verify NO database mutation happened upon staging
    const clCheckStaged = await prisma.ndcClearance.findUnique({ where: { id: cl1.id } });
    assert(Number(clCheckStaged?.dueAmount || 0) === 0, 'No DB mutation occurred during staging step');

    // 4c. Execute confirmed token
    const execRes = await AgentToolExecutionService.executeConfirmedToken(stagedPayload.token, phyOfficer.id);
    assert(execRes.success === true, 'Execution of confirmed action succeeded');
    assert(execRes.executedCount === 1, 'Exactly 1 action executed');

    const clCheckExecuted = await prisma.ndcClearance.findUnique({ where: { id: cl1.id } });
    assert(Number(clCheckExecuted?.dueAmount) === 300, 'Live clearance dueAmount updated to ₹300');
    assert(clCheckExecuted?.status === DepartmentClearanceStatus.DUE, 'Live clearance status updated to DUE');

    // 4d. Replay prevention: Executing the same token a second time must FAIL
    const replayRes = await AgentToolExecutionService.executeConfirmedToken(stagedPayload.token, phyOfficer.id);
    assert(replayRes.success === false, 'Replay protection blocked duplicate execution of consumed token');
    assert(replayRes.error === 'TOKEN_ALREADY_CONSUMED' || replayRes.error === 'TOKEN_ALREADY_USED', 'Returned error code TOKEN_ALREADY_CONSUMED');

    // 4e. Batch Execution: Stage and Confirm 2 actions atomically
    const batchActionItems: ExtractedActionItem[] = [
      {
        actionId: 'batch-1',
        action: 'CLEAR_DUE',
        usn: student1.usn,
        studentId: student1.id,
        studentName: student1.fullName,
        clearanceId: cl1.id,
        reason: 'Paid ₹300 replacement fee for sonometer wire',
        departmentCode: 'PHY',
        departmentName: 'Physics Department',
        consequences: 'Student clearance marked as NO DUE'
      },
      {
        actionId: 'batch-2',
        action: 'MARK_DUE',
        usn: student2.usn,
        studentId: student2.id,
        studentName: student2.fullName,
        clearanceId: cl2.id,
        amount: 1500,
        reason: 'Broken optic fibre cable',
        departmentCode: 'PHY',
        departmentName: 'Physics Department',
        consequences: 'Student clearance marked as DUE (₹1,500)'
      }
    ];

    const batchPayload = await AgentToolExecutionService.stageActionsForConfirmation(
      phyOfficer.id,
      phyDeptInfo,
      batchActionItems
    );

    const batchExecRes = await AgentToolExecutionService.executeConfirmedToken(batchPayload.token, phyOfficer.id);
    assert(batchExecRes.success === true, 'Batch execution succeeded atomically');
    assert(batchExecRes.executedCount === 2, 'Applied exactly 2 batch actions');

    const cl1Updated = await prisma.ndcClearance.findUnique({ where: { id: cl1.id } });
    const cl2Updated = await prisma.ndcClearance.findUnique({ where: { id: cl2.id } });
    assert(cl1Updated?.status === DepartmentClearanceStatus.CLEARED && Number(cl1Updated?.dueAmount) === 0, 'Student 1 cleared of dues');
    assert(cl2Updated?.status === DepartmentClearanceStatus.DUE && Number(cl2Updated?.dueAmount) === 1500, 'Student 2 marked with ₹1,500 due');

    // =========================================================================
    // 5. CANONICAL CLEARANCE WORKFLOW & 3-LAB AGGREGATION
    // =========================================================================
    console.log('\n--- 5. Testing Consolidated Laboratory Aggregation (Phase 8) ---');

    // Ensure student 2 has Chemistry and Department Lab clearances
    let cl2Chem = await prisma.ndcClearance.findFirst({ where: { studentId: student2.id, departmentId: chemDept!.id } });
    if (!cl2Chem) {
      cl2Chem = await prisma.ndcClearance.create({
        data: {
          ndcRequestId: req2.id,
          studentId: student2.id,
          departmentId: chemDept!.id,
          status: DepartmentClearanceStatus.CLEARED,
          dueAmount: 0
        }
      });
    } else {
      await prisma.ndcClearance.update({ where: { id: cl2Chem.id }, data: { status: DepartmentClearanceStatus.CLEARED, dueAmount: 0 } });
    }

    // Since student2 Physics has DUE (₹1,500), consolidated Laboratory status must be DUE
    const summaryWhenDue = await LaboratoryAggregationService.getLaboratoryClearanceSummaryByStudentId(student2.id);
    assert(summaryWhenDue.overallLaboratoryStatus === 'DUE', `Consolidated Laboratory status is DUE when Physics has outstanding due (got ${summaryWhenDue.overallLaboratoryStatus})`);

    // Now clear Physics lab as well, and any department lab clearances
    await prisma.ndcClearance.update({
      where: { id: cl2.id },
      data: { status: DepartmentClearanceStatus.CLEARED, dueAmount: 0 }
    });
    await prisma.ndcClearance.updateMany({
      where: {
        studentId: student2.id,
        NOT: { departmentId: { in: [phyDept!.id, chemDept!.id] } }
      },
      data: { status: DepartmentClearanceStatus.CLEARED, dueAmount: 0 }
    });

    const summaryWhenCleared = await LaboratoryAggregationService.getLaboratoryClearanceSummaryByStudentId(student2.id);
    assert(summaryWhenCleared.overallLaboratoryStatus === 'NO DUE', `Consolidated Laboratory status is NO DUE when all labs cleared (got ${summaryWhenCleared.overallLaboratoryStatus})`);

    console.log('\n================================================================');
    console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('================================================================\n');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err: any) {
    console.error('Fatal test error:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runMultiAgentPlatformTests();
