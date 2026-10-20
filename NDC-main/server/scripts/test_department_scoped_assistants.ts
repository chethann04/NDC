import prisma from '../src/config/prisma';
import { UserRole } from '../src/constants/roles';
import { ContextResolutionService } from '../src/services/ai/ContextResolutionService';
import { DepartmentAgentRegistry } from '../src/services/ai/DepartmentAgentRegistry';
import { AiAssistantService } from '../src/services/AiAssistantService';
import fs from 'fs';
import path from 'path';

async function runDepartmentScopedAssistantTests() {
  console.log('\n===============================================================');
  console.log('🧪 RUNNING DEPARTMENT-SPECIFIC AI ASSISTANTS TEST SUITE');
  console.log('===============================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, testName: string, failureDetails?: string) {
    total++;
    if (condition) {
      console.log(`  ✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${testName}`);
      if (failureDetails) {
        console.error(`     Details: ${failureDetails}`);
      }
    }
  }

  try {
    // ─────────────────────────────────────────────────────────────
    // TEST SUITE 1: Dedicated Assistant Metadata for Every Department
    // ─────────────────────────────────────────────────────────────
    console.log('--- TEST SUITE 1: Dedicated Assistant Loading & Metadata ---');

    const mockAdmin = {
      id: 'test-admin-id',
      role: UserRole.ADMIN,
      name: 'System Admin',
      email: 'admin@mce.ac.in',
      departmentId: null
    };

    // Load all active departments from database
    const dbDepartments = await prisma.clearanceDepartment.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: 'asc' }
    });

    console.log(`Found ${dbDepartments.length} active clearance departments in database.`);

    // Expected department assistant mappings
    const expectedAssistants: Record<string, { title: string; badge: string; descKeyword: string }> = {
      PHY: {
        title: 'Physics Department AI Assistant',
        badge: 'PHY',
        descKeyword: 'apparatus'
      },
      CHEM: {
        title: 'Chemistry Department AI Assistant',
        badge: 'CHEM',
        descKeyword: 'glassware'
      },
      LIB: {
        title: 'Central Library AI Assistant',
        badge: 'LIB',
        descKeyword: 'overdue'
      },
      ADM: {
        title: 'Administration AI Assistant',
        badge: 'ADM',
        descKeyword: 'governance'
      },
      HST: {
        title: 'Hostel Administration AI Assistant',
        badge: 'HST',
        descKeyword: 'hostel'
      },
      SPT: {
        title: 'Sports Department AI Assistant',
        badge: 'SPT',
        descKeyword: 'sports'
      },
      ACC: {
        title: 'Accounts and Fee AI Assistant',
        badge: 'ACC',
        descKeyword: 'fee'
      },
      CS: {
        title: 'CSE Department AI Assistant',
        badge: 'CS',
        descKeyword: 'Computer Science'
      },
      IS: {
        title: 'ISE Department AI Assistant',
        badge: 'IS',
        descKeyword: 'Information Science'
      }
    };

    for (const [code, expected] of Object.entries(expectedAssistants)) {
      const ctx = await ContextResolutionService.resolveUserContext(mockAdmin, code);
      assert(
        ctx.department.code === expected.badge,
        `Department [${code}] resolves to badge [${expected.badge}]`,
        `Got: ${ctx.department.code}`
      );
      assert(
        ctx.assistantConfig.title === expected.title,
        `Department [${code}] has title "${expected.title}"`,
        `Got: ${ctx.assistantConfig.title}`
      );
      assert(
        Boolean(ctx.assistantConfig.description) &&
          ctx.assistantConfig.description.toLowerCase().includes(expected.descKeyword.toLowerCase()),
        `Department [${code}] has responsibility description containing "${expected.descKeyword}"`,
        `Got: ${ctx.assistantConfig.description}`
      );
      assert(
        ctx.assistantConfig.suggestedQueries.length >= 3,
        `Department [${code}] provides department-specific suggested queries (${ctx.assistantConfig.suggestedQueries.length} provided)`
      );
    }

    // Also verify every remaining database department synthesizes its own assistant dynamically
    for (const d of dbDepartments) {
      const ctx = await ContextResolutionService.resolveUserContext(mockAdmin, d.code);
      assert(
        Boolean(ctx.assistantConfig.title) && ctx.assistantConfig.title.includes('AI Assistant'),
        `DB department [${d.code}] "${d.name}" dynamically generates assistant title: "${ctx.assistantConfig.title}"`
      );
      assert(
        ctx.assistantConfig.badge === d.code,
        `DB department [${d.code}] matches badge: "${ctx.assistantConfig.badge}"`
      );
      assert(
        Boolean(ctx.assistantConfig.description) && ctx.assistantConfig.description.length > 10,
        `DB department [${d.code}] has valid description: "${ctx.assistantConfig.description}"`
      );
    }

    // ─────────────────────────────────────────────────────────────
    // TEST SUITE 2: Invalid Department Identifier Handling
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST SUITE 2: Invalid Department Route Handling ---');

    // Admin requesting completely non-existent department code
    const invalidAdminCtx = await ContextResolutionService.resolveUserContext(mockAdmin, 'INVALID_DEPT_XYZ');
    assert(
      invalidAdminCtx.department.code === 'ADM',
      'Admin requesting invalid department gracefully falls back to Administration Block (ADM)',
      `Got: ${invalidAdminCtx.department.code}`
    );
    assert(
      invalidAdminCtx.assistantConfig.badge === 'ADM',
      'Fallback assistant badge is ADM'
    );

    // ─────────────────────────────────────────────────────────────
    // TEST SUITE 3: Strict Backend Authorization & Cross-Department Rejection
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST SUITE 3: Strict Authorization & Cross-Department Protection ---');

    // Find real physics department
    const phyDept = dbDepartments.find((d) => d.code === 'PHY') || { id: 'phy-id', code: 'PHY', name: 'Physics Lab' };

    const phyOfficer = {
      id: 'test-phy-officer',
      role: UserRole.DEPARTMENT_OFFICER,
      name: 'Physics Officer',
      email: 'physics@mce.ac.in',
      departmentId: phyDept.id
    };

    // 1. Authorized access without code defaults to PHY
    const phyCtx = await ContextResolutionService.resolveUserContext(phyOfficer);
    assert(
      phyCtx.department.code === 'PHY',
      'Officer with no code parameter defaults to assigned department [PHY]'
    );
    assert(
      phyCtx.assistantConfig.title === 'Physics Department AI Assistant',
      'Officer loads dedicated Physics Department AI Assistant'
    );

    // 2. Authorized access with matching code works
    const phyWithCode = await ContextResolutionService.resolveUserContext(phyOfficer, 'PHY');
    assert(
      phyWithCode.department.code === 'PHY',
      'Officer explicitly requesting own department [PHY] is authorized'
    );

    // 3. Unauthorized access attempting cross-department access is rejected
    let rejectedUnauthorized = false;
    let rejectedMsg = '';
    try {
      await ContextResolutionService.resolveUserContext(phyOfficer, 'LIB');
    } catch (e: any) {
      if (e.message.includes('Forbidden') || e.message.includes('not authorized')) {
        rejectedUnauthorized = true;
        rejectedMsg = e.message;
      }
    }
    assert(
      rejectedUnauthorized,
      'Officer requesting unauthorized department [LIB] is strictly rejected with Forbidden error',
      `Error received: ${rejectedMsg}`
    );

    // 4. HOD unauthorized access attempting cross-department access is rejected
    const hodUser = {
      id: 'test-hod-user',
      role: UserRole.HOD,
      name: 'HOD Physics',
      email: 'hod.physics@mce.ac.in',
      departmentId: phyDept.id
    };
    let hodRejected = false;
    try {
      await ContextResolutionService.resolveUserContext(hodUser, 'CS');
    } catch (e: any) {
      if (e.message.includes('Forbidden') || e.message.includes('not permitted')) {
        hodRejected = true;
      }
    }
    assert(
      hodRejected,
      'HOD requesting unauthorized branch [CS] is strictly rejected with Forbidden error'
    );

    // ─────────────────────────────────────────────────────────────
    // TEST SUITE 4: Conversation History & Department Isolation
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST SUITE 4: Chat History & Department Isolation ---');

    const testUserId = 'test-isolation-user-' + Date.now();

    // Create a message in PHY
    await (prisma as any).aiConversationLog.create({
      data: {
        userId: testUserId,
        departmentCode: 'PHY',
        role: 'user',
        content: 'Check physics sonometer wire dues for USN 4MC24IS001'
      }
    });

    // Create a message in LIB
    await (prisma as any).aiConversationLog.create({
      data: {
        userId: testUserId,
        departmentCode: 'LIB',
        role: 'user',
        content: 'Check library overdue book fine for USN 4MC24IS001'
      }
    });

    // Query history for PHY
    const phyLogs = await (prisma as any).aiConversationLog.findMany({
      where: { userId: testUserId, departmentCode: 'PHY' }
    });
    assert(
      phyLogs.length === 1 && phyLogs[0].content.includes('sonometer'),
      'PHY conversation log is isolated and contains only Physics messages'
    );

    // Query history for LIB
    const libLogs = await (prisma as any).aiConversationLog.findMany({
      where: { userId: testUserId, departmentCode: 'LIB' }
    });
    assert(
      libLogs.length === 1 && libLogs[0].content.includes('library overdue'),
      'LIB conversation log is isolated and contains only Library messages'
    );

    // Clean up test logs
    await (prisma as any).aiConversationLog.deleteMany({
      where: { userId: testUserId }
    });
    assert(true, 'Test conversation logs cleaned up successfully');

    // ─────────────────────────────────────────────────────────────
    // TEST SUITE 5: Frontend UI Verification - Dropdown Removed
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST SUITE 5: Frontend UI Dropdown Elimination Verification ---');

    const aiPagePath = path.resolve(__dirname, '../../client/src/pages/officer/AiAssistantPage.tsx');
    const aiPageContent = fs.readFileSync(aiPagePath, 'utf-8');

    assert(
      !aiPageContent.includes('<select'),
      'AiAssistantPage.tsx contains NO <select> dropdown element'
    );

    assert(
      !aiPageContent.includes('Scope:'),
      'AiAssistantPage.tsx contains NO "Scope:" label'
    );

    assert(
      !aiPageContent.includes('setActiveDepartmentCode'),
      'AiAssistantPage.tsx contains NO manual assistant switcher state / setActiveDepartmentCode'
    );

    assert(
      aiPageContent.includes('useParams'),
      'AiAssistantPage.tsx uses useParams to read dedicated department route parameter'
    );

    assert(
      aiPageContent.includes('{assistantTitle}'),
      'AiAssistantPage.tsx displays dynamic assistant title'
    );

    assert(
      aiPageContent.includes('[{assistantBadge}]'),
      'AiAssistantPage.tsx displays assistant badge in header'
    );

    assert(
      aiPageContent.includes('{assistantDescription}'),
      'AiAssistantPage.tsx displays assistant responsibility description in header'
    );

    // ─────────────────────────────────────────────────────────────
    // TEST SUITE 6: App Routing Verification
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST SUITE 6: App Routing Verification ---');

    const appPath = path.resolve(__dirname, '../../client/src/App.tsx');
    const appContent = fs.readFileSync(appPath, 'utf-8');

    assert(
      appContent.includes('/officer/ai-assistant/:deptCode'),
      'App.tsx defines route for /officer/ai-assistant/:deptCode'
    );

    assert(
      appContent.includes('/departments/:deptCode/assistant'),
      'App.tsx defines route for /departments/:deptCode/assistant'
    );

    console.log('\n===============================================================');
    console.log(`📊 TEST RESULTS: ${passed} OF ${total} TESTS PASSED`);
    console.log('===============================================================\n');

    if (passed === total) {
      console.log('🎉 ALL DEPARTMENT-SPECIFIC AI ASSISTANT TESTS PASSED!\n');
    } else {
      console.error(`⚠️ ${total - passed} tests failed.\n`);
      process.exit(1);
    }
  } catch (err) {
    console.error('Fatal test error:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runDepartmentScopedAssistantTests();
