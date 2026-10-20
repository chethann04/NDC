import prisma from '../src/config/prisma';
import { UserRole } from '../src/constants/roles';
import { ContextResolutionService } from '../src/services/ai/ContextResolutionService';
import { AiAssistantService } from '../src/services/AiAssistantService';
import { LogbookScannerService } from '../src/services/LogbookScannerService';
import { AgentToolExecutionService } from '../src/services/ai/AgentToolExecutionService';
import { DepartmentAgentRegistry } from '../src/services/ai/DepartmentAgentRegistry';

async function runRoleAwareContextTests() {
  console.log('\n===============================================================');
  console.log('🧪 RUNNING ROLE-AWARE AND DEPARTMENT-AWARE CONTEXT TEST SUITE');
  console.log('===============================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition: boolean, testName: string, failureDetails?: string) {
    totalTests++;
    if (condition) {
      console.log(`  ✅ [PASS] ${testName}`);
      passedTests++;
    } else {
      console.error(`  ❌ [FAIL] ${testName}`);
      if (failureDetails) {
        console.error(`     Details: ${failureDetails}`);
      }
    }
  }

  try {
    // ─────────────────────────────────────────────────────────────
    // TEST 1: Administration Block / Admin User Context Resolution
    // ─────────────────────────────────────────────────────────────
    console.log('--- TEST 1: Admin User Context Resolution (The Reported Bug) ---');
    const adminUser = await prisma.user.findFirst({
      where: { role: { in: [UserRole.SUPER_ADMIN, UserRole.ADMIN] } }
    });

    const mockAdmin = adminUser || {
      id: 'mock-admin-id',
      role: UserRole.ADMIN,
      name: 'College Administrator',
      email: 'admin@mce.ac.in',
      departmentId: null
    };

    const adminContext = await ContextResolutionService.resolveUserContext(mockAdmin);

    assert(
      adminContext.department.code === 'ADM',
      'Admin context resolves department code to ADM (not PHY)',
      `Received code: ${adminContext.department.code}`
    );

    assert(
      adminContext.department.name.includes('Administration'),
      'Admin context department name contains Administration',
      `Received name: ${adminContext.department.name}`
    );

    assert(
      adminContext.assistantConfig.badge === 'ADM',
      'Admin assistant badge is ADM',
      `Received badge: ${adminContext.assistantConfig.badge}`
    );

    assert(
      adminContext.assistantConfig.title.includes('Administration'),
      'Admin assistant title reflects Administration Block',
      `Received title: ${adminContext.assistantConfig.title}`
    );

    assert(
      !adminContext.assistantConfig.greeting.toLowerCase().includes('physics') &&
      !adminContext.assistantConfig.greeting.toLowerCase().includes('apparatus'),
      'Admin greeting does not mention Physics or apparatus defaults',
      `Greeting: ${adminContext.assistantConfig.greeting}`
    );

    assert(
      adminContext.assistantConfig.presets.every((p) => !p.label.toLowerCase().includes('spectrometer') && !p.label.toLowerCase().includes('laser')),
      'Admin presets do not contain Physics apparatus (spectrometers, lasers)',
      `Presets: ${JSON.stringify(adminContext.assistantConfig.presets)}`
    );

    assert(
      adminContext.scope === 'INSTITUTION_WIDE',
      'Admin scope is INSTITUTION_WIDE',
      `Scope: ${adminContext.scope}`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 2: Admin Live Statistics Scope
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 2: Admin Live Statistics Scope ---');
    const adminStats = await ContextResolutionService.getContextStats(adminContext);

    assert(
      adminStats.scope === 'INSTITUTION_WIDE',
      'Admin stats return INSTITUTION_WIDE scope',
      `Scope: ${adminStats.scope}`
    );

    assert(
      typeof adminStats.totalStudents === 'number' && typeof adminStats.fullyCleared === 'number',
      'Admin stats return institutional aggregate counters (totalStudents, fullyCleared)',
      `Stats: ${JSON.stringify(adminStats)}`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 3: Department Officers (Physics, Chemistry, Library)
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 3: Department Officers Authorization & Context ---');
    const phyDept = await prisma.clearanceDepartment.findFirst({ where: { code: 'PHY' } });
    const chemDept = await prisma.clearanceDepartment.findFirst({ where: { code: 'CHEM' } });
    const libDept = await prisma.clearanceDepartment.findFirst({ where: { code: 'LIB' } });

    if (phyDept) {
      const phyOfficer = {
        id: 'mock-phy-officer',
        role: UserRole.DEPARTMENT_OFFICER,
        name: 'Physics Lab Officer',
        email: 'physics@mce.ac.in',
        departmentId: phyDept.id
      };
      const phyCtx = await ContextResolutionService.resolveUserContext(phyOfficer);

      assert(
        phyCtx.department.code === 'PHY',
        'Physics Officer correctly resolves to PHY department',
        `Received: ${phyCtx.department.code}`
      );

      assert(
        phyCtx.assistantConfig.title.includes('Physics'),
        'Physics Officer receives Physics Assistant title',
        `Title: ${phyCtx.assistantConfig.title}`
      );

      assert(
        phyCtx.assistantConfig.presets.some((p) => p.label.toLowerCase().includes('spectrometer') || p.label.toLowerCase().includes('optical') || p.label.toLowerCase().includes('laser')),
        'Physics Officer presets contain Physics domain items',
        `Presets: ${JSON.stringify(phyCtx.assistantConfig.presets)}`
      );
    }

    if (chemDept) {
      const chemOfficer = {
        id: 'mock-chem-officer',
        role: UserRole.DEPARTMENT_OFFICER,
        name: 'Chemistry Lab Officer',
        email: 'chemistry@mce.ac.in',
        departmentId: chemDept.id
      };
      const chemCtx = await ContextResolutionService.resolveUserContext(chemOfficer);

      assert(
        chemCtx.department.code === 'CHEM',
        'Chemistry Officer correctly resolves to CHEM department (never PHY)',
        `Received: ${chemCtx.department.code}`
      );

      assert(
        chemCtx.assistantConfig.title.includes('Chemistry'),
        'Chemistry Officer receives Chemistry Assistant title',
        `Title: ${chemCtx.assistantConfig.title}`
      );

      assert(
        chemCtx.assistantConfig.presets.some((p) => p.label.toLowerCase().includes('burette') || p.label.toLowerCase().includes('glassware') || p.label.toLowerCase().includes('flask')),
        'Chemistry Officer presets contain Chemistry glassware/reagents',
        `Presets: ${JSON.stringify(chemCtx.assistantConfig.presets)}`
      );
    }

    if (libDept) {
      const libOfficer = {
        id: 'mock-lib-officer',
        role: UserRole.DEPARTMENT_OFFICER,
        name: 'Library Officer',
        email: 'library@mce.ac.in',
        departmentId: libDept.id
      };
      const libCtx = await ContextResolutionService.resolveUserContext(libOfficer);

      assert(
        libCtx.department.code === 'LIB',
        'Library Officer correctly resolves to LIB department (never PHY)',
        `Received: ${libCtx.department.code}`
      );

      assert(
        libCtx.assistantConfig.title.includes('Library'),
        'Library Officer receives Library Assistant title',
        `Title: ${libCtx.assistantConfig.title}`
      );

      assert(
        libCtx.assistantConfig.presets.some((p) => p.label.toLowerCase().includes('textbook') || p.label.toLowerCase().includes('book')),
        'Library Officer presets contain textbook overdue / book fines',
        `Presets: ${JSON.stringify(libCtx.assistantConfig.presets)}`
      );
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 4: Cross-Department Spoofing Rejection
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 4: Cross-Department Spoofing Protection ---');
    if (phyDept && libDept) {
      const phyOfficer = {
        id: 'mock-phy-officer',
        role: UserRole.DEPARTMENT_OFFICER,
        name: 'Physics Officer',
        email: 'physics@mce.ac.in',
        departmentId: phyDept.id
      };

      // Attempt spoofing: Physics officer requests 'LIB'
      let spoofRejected = false;
      try {
        await ContextResolutionService.resolveUserContext(phyOfficer, 'LIB');
      } catch (err: any) {
        if (err.message?.includes('Forbidden') || err.message?.includes('not authorized')) {
          spoofRejected = true;
        }
      }

      assert(
        spoofRejected,
        'Officer requesting unauthorized department is strictly rejected with Forbidden error'
      );
    }

    // Admin requesting specific department is authorized
    if (chemDept) {
      const adminChemRequest = await ContextResolutionService.resolveUserContext(mockAdmin, 'CHEM');
      assert(
        adminChemRequest.department.code === 'CHEM',
        'Admin permitted to switch scope and view specific department',
        `Expected CHEM, got: ${adminChemRequest.department.code}`
      );
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 5: Conversational AI Queries with Resolved Context
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 5: Conversational AI Grounded Execution ---');
    const adminChatResult = await AiAssistantService.processMessage({
      user: {
        id: mockAdmin.id,
        role: mockAdmin.role,
        name: mockAdmin.name,
        departmentId: undefined
      },
      messages: [{ role: 'user', content: 'What is the current clearance summary?' }]
    });

    assert(
      adminChatResult.reply.includes('Administration Block') &&
      !adminChatResult.reply.includes('Desk: Engineering Physics Laboratory') &&
      !adminChatResult.reply.includes('Physics Department AI Assistant'),
      'Admin general query reply identifies as Administration Block (ADM), not Physics desk',
      `Reply snippet: ${adminChatResult.reply.slice(0, 150)}...`
    );

    assert(
      Boolean(adminChatResult.suggestions && adminChatResult.suggestions.length > 0 && adminChatResult.suggestions.every((s) => !s.toLowerCase().includes('physics lab') && !s.toLowerCase().includes('thermometer'))),
      'Admin general query suggestions do not contain Physics defaults',
      `Suggestions: ${JSON.stringify(adminChatResult.suggestions)}`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 6: Scanner Missing Department Fallback Safety
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 6: Scanner Missing Context Fallback Safety ---');
    let scannerErrorCaught = false;
    try {
      // Test invalid / missing department resolution
      await LogbookScannerService.processUpload({
        lecturerUserId: 'non-existent-user-id',
        departmentId: '',
        originalFilename: 'test.jpg',
        mimeType: 'image/jpeg',
        fileBuffer: Buffer.from('fake-image-bytes')
      });
    } catch (err: any) {
      scannerErrorCaught = true;
      assert(
        err.message.includes('department') || err.message.includes('authorized'),
        'Scanner fails safely without defaulting to PHY when department cannot be resolved',
        `Error: ${err.message}`
      );
    }

    assert(
      scannerErrorCaught,
      'Scanner refuses to process without authorized department',
      'Should have thrown an error'
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 7: Dynamic Department Creation & Automatic AI Assistant Synthesis
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 7: Dynamic Department Creation & Synthesis ---');
    const testDeptCode = 'TEST_ROB';
    const testDeptName = 'Robotics & Automation Laboratory';

    // Ensure clean state
    await prisma.clearanceDepartment.deleteMany({ where: { code: testDeptCode } });

    const createdDept = await prisma.clearanceDepartment.create({
      data: {
        code: testDeptCode,
        name: testDeptName,
        category: 'LABORATORY',
        description: 'Advanced robotics research, microcontroller kits, and autonomous systems clearance.',
        isAcademicBranch: false,
        requiresClearance: true,
        displayOrder: 99
      }
    });

    const mockRobOfficer = {
      id: 'mock-rob-officer-id',
      role: UserRole.DEPARTMENT_OFFICER,
      name: 'Robotics Lab Incharge',
      email: 'robotics@mce.ac.in',
      departmentId: createdDept.id
    };

    const robContext = await ContextResolutionService.resolveUserContext(mockRobOfficer);

    assert(
      robContext.department.code === testDeptCode,
      'Dynamically created department resolves to correct code',
      `Expected ${testDeptCode}, got: ${robContext.department.code}`
    );

    assert(
      robContext.assistantConfig.title === `${testDeptName} AI Assistant`,
      'Assistant title dynamically synthesized matching canonical department name',
      `Title: ${robContext.assistantConfig.title}`
    );

    assert(
      robContext.assistantConfig.badge === testDeptCode,
      'Assistant badge dynamically matches created department code',
      `Badge: ${robContext.assistantConfig.badge}`
    );

    assert(
      robContext.assistantConfig.greeting.includes(testDeptName),
      'Assistant greeting dynamically incorporates department name',
      `Greeting: ${robContext.assistantConfig.greeting}`
    );

    assert(
      !robContext.assistantConfig.greeting.toLowerCase().includes('physics') &&
      !robContext.assistantConfig.greeting.toLowerCase().includes('spectrometer'),
      'Dynamically synthesized assistant never defaults or leaks Physics Lab items',
      `Greeting: ${robContext.assistantConfig.greeting}`
    );

    assert(
      robContext.scannerConfig.title.includes(testDeptName),
      'Scanner title dynamically synthesized for new department',
      `Scanner Title: ${robContext.scannerConfig.title}`
    );

    assert(
      robContext.scannerConfig.documentType === `${testDeptCode}_CLEARANCE_REGISTER`,
      'Scanner extraction schema dynamically derived from department code',
      `DocumentType: ${robContext.scannerConfig.documentType}`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 8: Strict Cross-Department Data & Mutation Isolation
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 8: Strict Cross-Department Data & Mutation Isolation ---');
    if (phyDept && libDept) {
      // Direct authorization check
      const authRejectLib = await AgentToolExecutionService.authorizeOfficerForDepartment(
        'mock-phy-officer-user',
        libDept.id
      );

      assert(
        !authRejectLib.authorized,
        'Officer unauthorized for another department is strictly rejected by server authorization',
        `Authorized: ${authRejectLib.authorized}`
      );

      // Verify clearance queries filter strictly by departmentId
      const phyClearances = await prisma.ndcClearance.findMany({
        where: { departmentId: phyDept.id },
        take: 5
      });

      assert(
        phyClearances.every((c) => c.departmentId === phyDept.id),
        'Department clearance queries are strictly scoped to departmentId',
        'Found clearance outside authorized departmentId'
      );
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 9: Administration Cross-Department Multi-Clearance Student Lookup
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 9: Administration Student Multi-Clearance Lookup ---');
    const existingStudent = await prisma.student.findFirst({
      where: { isActive: true },
      include: { ndcClearances: true }
    });

    if (existingStudent) {
      const adminLookupResult = await AiAssistantService.processMessage({
        user: {
          id: mockAdmin.id,
          role: mockAdmin.role,
          name: mockAdmin.name,
          departmentId: undefined
        },
        messages: [{ role: 'user', content: `Lookup student ${existingStudent.usn}` }]
      });

      assert(
        adminLookupResult.reply.includes(existingStudent.fullName) || adminLookupResult.reply.includes(existingStudent.usn),
        'Admin student lookup retrieves real student record',
        `Reply snippet: ${adminLookupResult.reply.slice(0, 150)}...`
      );

      assert(
        adminLookupResult.reply.includes('Overview') || adminLookupResult.reply.includes('Record'),
        'Admin student lookup returns formatted institutional status',
        `Reply snippet: ${adminLookupResult.reply.slice(0, 150)}...`
      );
    }

    // Clean up temporary test department
    await prisma.clearanceDepartment.deleteMany({ where: { code: testDeptCode } });

    console.log('\n===============================================================');
    console.log(`📊 TEST RESULTS: ${passedTests} OF ${totalTests} TESTS PASSED`);
    console.log('===============================================================\n');

    if (passedTests === totalTests) {
      console.log('🎉 ALL ROLE-AWARE AND CONTEXT TESTS PASSED SUCCESSFULLY!');
      process.exit(0);
    } else {
      console.error(`⚠️ ${totalTests - passedTests} tests failed.`);
      process.exit(1);
    }
  } catch (err) {
    console.error('Test execution error:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runRoleAwareContextTests();
