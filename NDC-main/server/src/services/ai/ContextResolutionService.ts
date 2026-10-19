import prisma from '../../config/prisma';
import { UserRole } from '../../constants/roles';
import { departmentCache } from '../../utils/departmentCache';
import { DepartmentAgentRegistry, DepartmentAgentConfig } from './DepartmentAgentRegistry';

export interface ResolvedDepartment {
  id: string;
  code: string;
  name: string;
  category: 'ADMINISTRATION' | 'CENTRAL_DESK' | 'LABORATORY' | 'ACADEMIC_BRANCH';
  isAcademicBranch?: boolean;
}

export interface ResolvedAiContext {
  userId: string;
  userName: string;
  userEmail: string;
  role: UserRole;
  scope: 'INSTITUTION_WIDE' | 'DEPARTMENT' | 'ACADEMIC_BRANCH';
  department: ResolvedDepartment;
  assistantConfig: {
    title: string;
    badge: string;
    greeting: string;
    systemPrompt: string;
    suggestedQueries: string[];
    presets: Array<{ label: string; amount?: number; reason?: string }>;
    supportedOperations: string[];
    category: string;
  };
  scannerConfig: {
    title: string;
    documentType: string;
    scannerInstructions: string;
  };
  permissions: {
    canMutateDues: boolean;
    canApproveClearance: boolean;
    canViewAllDepartments: boolean;
    canViewAuditLogs: boolean;
    isSuperAdmin: boolean;
  };
  availableDepartments?: Array<{ id: string; code: string; name: string }>;
}

export class ContextResolutionService {
  /**
   * Authoritative, role-aware context resolution from trusted server state.
   * Untrusted inputs (such as requestedDeptCode from frontend) are strictly validated against permissions.
   */
  public static async resolveUserContext(
    user: { id: string; role: string; departmentId?: string | null; name?: string; email?: string },
    requestedDeptCode?: string
  ): Promise<ResolvedAiContext> {
    const role = user.role as UserRole;
    const userId = user.id;
    const userName = user.name || 'Officer';
    const userEmail = user.email || '';

    let scope: 'INSTITUTION_WIDE' | 'DEPARTMENT' | 'ACADEMIC_BRANCH' = 'DEPARTMENT';
    let targetDept: ResolvedDepartment;
    let availableDepartments: Array<{ id: string; code: string; name: string }> | undefined;

    // Normalize requested code
    let reqCode = requestedDeptCode?.trim()?.toUpperCase();
    if (reqCode === 'ADMIN' || reqCode === 'OFFICE' || reqCode === 'COLLEGE_OFFICE') {
      reqCode = 'ADM';
    }

    // -------------------------------------------------------------
    // A. ADMINISTRATION (SUPER_ADMIN / ADMIN)
    // -------------------------------------------------------------
    if (role === UserRole.SUPER_ADMIN || role === UserRole.ADMIN) {
      scope = 'INSTITUTION_WIDE';

      // Load all active departments so admin can inspect any department if explicitly requested
      const allDepts = await prisma.clearanceDepartment.findMany({
        where: { isActive: true },
        select: { id: true, code: true, name: true, category: true, isAcademicBranch: true },
        orderBy: { displayOrder: 'asc' }
      });

      availableDepartments = [
        { id: 'admin-institution', code: 'ADM', name: 'Administration Block (All Departments)' },
        ...allDepts.map((d) => ({ id: d.id, code: d.code, name: d.name }))
      ];

      // If admin explicitly requested a specific department to inspect
      if (reqCode && reqCode !== 'ADM') {
        const found = allDepts.find((d) => d.code.toUpperCase() === reqCode);
        if (found) {
          targetDept = {
            id: found.id,
            code: found.code,
            name: found.name,
            category: (found.category as any) || 'CENTRAL_DESK',
            isAcademicBranch: found.isAcademicBranch
          };
        } else {
          // Fall back safely to Administration Block, NEVER to Physics
          targetDept = {
            id: 'admin-institution',
            code: 'ADM',
            name: 'Administration Block',
            category: 'ADMINISTRATION'
          };
        }
      } else {
        // Default to Administration Block
        targetDept = {
          id: 'admin-institution',
          code: 'ADM',
          name: 'Administration Block',
          category: 'ADMINISTRATION'
        };
      }
    }

    // -------------------------------------------------------------
    // B. HEAD OF DEPARTMENT (HOD)
    // -------------------------------------------------------------
    else if (role === UserRole.HOD) {
      scope = 'ACADEMIC_BRANCH';

      let hodDept: any = null;
      if (user.departmentId) {
        hodDept = await departmentCache.getDepartmentById(user.departmentId);
      }
      if (!hodDept) {
        // Lookup from user record
        const dbUser = await prisma.user.findUnique({
          where: { id: userId },
          include: { department: true }
        });
        hodDept = dbUser?.department;
      }

      if (!hodDept) {
        throw new Error('Unauthorized: HOD account has no assigned academic department.');
      }

      targetDept = {
        id: hodDept.id,
        code: hodDept.code,
        name: hodDept.name,
        category: 'ACADEMIC_BRANCH',
        isAcademicBranch: true
      };
    }

    // -------------------------------------------------------------
    // C. DEPARTMENT OFFICER (DEPARTMENT_OFFICER)
    // -------------------------------------------------------------
    else if (role === UserRole.DEPARTMENT_OFFICER) {
      scope = 'DEPARTMENT';

      // Query database for authoritative officer department mappings
      const officer = await prisma.clearanceOfficer.findUnique({
        where: { userId },
        include: {
          departmentMappings: {
            include: { department: true }
          }
        }
      });

      const mappedDepts = officer?.departmentMappings.map((m) => m.department) || [];

      // Also check primary user departmentId if mappings are empty
      if (mappedDepts.length === 0 && user.departmentId) {
        const prim = await departmentCache.getDepartmentById(user.departmentId);
        if (prim) mappedDepts.push(prim as any);
      }

      if (mappedDepts.length === 0) {
        throw new Error('Unauthorized: Clearance Officer has no authorized department assigned.');
      }

      availableDepartments = mappedDepts.map((d) => ({ id: d.id, code: d.code, name: d.name }));

      // Enforce strict authorization: officer can ONLY access mapped departments
      if (reqCode) {
        const matched = mappedDepts.find((d) => d.code.toUpperCase() === reqCode);
        if (matched) {
          targetDept = {
            id: matched.id,
            code: matched.code,
            name: matched.name,
            category: (matched.category as any) || 'CENTRAL_DESK',
            isAcademicBranch: matched.isAcademicBranch
          };
        } else {
          // Untrusted requestedDeptCode attempted cross-department access - enforce primary mapping!
          const primary = mappedDepts[0];
          targetDept = {
            id: primary.id,
            code: primary.code,
            name: primary.name,
            category: (primary.category as any) || 'CENTRAL_DESK',
            isAcademicBranch: primary.isAcademicBranch
          };
        }
      } else {
        const primary = mappedDepts[0];
        targetDept = {
          id: primary.id,
          code: primary.code,
          name: primary.name,
          category: (primary.category as any) || 'CENTRAL_DESK',
          isAcademicBranch: primary.isAcademicBranch
        };
      }
    }

    // -------------------------------------------------------------
    // D. FALLBACK FOR OTHER ROLES (STUDENT or UNSPECIFIED)
    // -------------------------------------------------------------
    else {
      throw new Error(`Unauthorized: Role "${role}" is not permitted to access staff AI assistants.`);
    }

    // -------------------------------------------------------------
    // BUILD ASSISTANT & SCANNER CONFIGURATION
    // -------------------------------------------------------------
    const deptAgentConfig = DepartmentAgentRegistry.getConfig(targetDept.code, {
      name: targetDept.name,
      category: targetDept.category,
      isAcademicBranch: targetDept.isAcademicBranch
    });
    const assistantConfig = this.buildAssistantConfig(targetDept, role, deptAgentConfig);
    const scannerConfig = this.buildScannerConfig(targetDept, deptAgentConfig);

    const isSuperAdmin = role === UserRole.SUPER_ADMIN;
    const isAdmin = role === UserRole.SUPER_ADMIN || role === UserRole.ADMIN;

    const permissions = {
      canMutateDues: isAdmin || role === UserRole.DEPARTMENT_OFFICER,
      canApproveClearance: isAdmin || role === UserRole.DEPARTMENT_OFFICER || role === UserRole.HOD,
      canViewAllDepartments: isAdmin,
      canViewAuditLogs: isAdmin,
      isSuperAdmin
    };

    return {
      userId,
      userName,
      userEmail,
      role,
      scope,
      department: targetDept,
      assistantConfig,
      scannerConfig,
      permissions,
      availableDepartments
    };
  }

  /**
   * Construct tailored assistant configuration (greeting, queries, presets, system prompt)
   */
  private static buildAssistantConfig(
    dept: ResolvedDepartment,
    role: UserRole,
    agentConfig: DepartmentAgentConfig | null
  ) {
    const isLibrary = dept.code === 'LIB' || dept.name.toLowerCase().includes('library');
    const isChemistry = dept.code === 'CHEM' || dept.name.toLowerCase().includes('chemistry');
    const isPhysics = dept.code === 'PHY' || dept.name.toLowerCase().includes('physics');
    const isHostel = dept.code === 'HST' || dept.name.toLowerCase().includes('hostel');
    const isSports = dept.code === 'SPT' || dept.name.toLowerCase().includes('sports');
    const isCashFee = dept.code === 'ACC' || dept.name.toLowerCase().includes('fee') || dept.name.toLowerCase().includes('cash');
    const isAdmin = dept.code === 'ADM' || role === UserRole.SUPER_ADMIN || role === UserRole.ADMIN;

    // Title & Badge
    let title = `${dept.name} AI Assistant`;
    let badge = dept.code;
    let greeting = '';
    let suggestedQueries: string[] = [];
    let presets: Array<{ label: string; amount?: number; reason?: string }> = [];

    if (dept.code === 'ADM') {
      title = 'Administration Block AI Assistant';
      badge = 'ADM';
      greeting = `Hello! I am the **Administration Block AI Assistant**.\n\nI provide institution-wide clearance governance, monitor cross-department clearance progress, inspect certificate status, and review student clearances across all sections.\n\nHow can I assist your administrative review today?`;
      suggestedQueries = [
        'Show institution-wide clearance summary',
        'Which departments have the most pending clearances?',
        'Look up student clearance across all departments',
        'Check certificate readiness for final year students',
        'List recent clearance audit events'
      ];
      presets = [
        { label: 'Check Full NDC Status (All Depts)', reason: 'Review complete clearance status' },
        { label: 'View Pending Clearance Queues', reason: 'Inspect department bottlenecks' },
        { label: 'Audit Log Summary', reason: 'Review recent audit events' },
        { label: 'Certificate Issuance Status', reason: 'Check student certificate eligibility' }
      ];
    } else if (isLibrary) {
      title = 'Central Library AI Assistant';
      badge = 'LIB';
      greeting = `Hello! I am the **Central Library AI Assistant**.\n\nI can read real-time circulation dues, check overdue textbooks, reference books, and stage safe clearance approvals or fee additions with your explicit confirmation.\n\nHow can I assist your circulation desk today?`;
      suggestedQueries = [
        'Who has overdue books in Central Library?',
        'What is the current library clearance summary?',
        'Check overdue book fines for a student',
        'Clear library dues upon book return'
      ];
      presets = [
        { label: 'Overdue textbook fine (Standard)', amount: 50, reason: 'Overdue book return fine' },
        { label: 'Reference section overdue fine', amount: 150, reason: 'Reference book overdue fine' },
        { label: 'Lost textbook replacement fee', amount: 500, reason: 'Lost textbook replacement penalty' },
        { label: 'Damaged book binding / spine penalty', amount: 200, reason: 'Damaged book binding repair' },
        { label: 'Library card / RFID tag lost fine', amount: 100, reason: 'Lost library card replacement' }
      ];
    } else if (isChemistry) {
      title = 'Chemistry Lab AI Assistant';
      badge = 'CHEM';
      greeting = `Hello! I am the **Chemistry Lab AI Assistant**.\n\nI can read real-time laboratory records, check apparatus breakages (burettes, pipettes, glassware), and stage safe clearance approvals or fee additions with your explicit confirmation.\n\nHow can I assist your laboratory desk today?`;
      suggestedQueries = [
        'Who has outstanding dues in Chemistry Lab?',
        'What is the current chemistry clearance summary?',
        'Record glassware breakage fine',
        'Clear chemistry lab dues'
      ];
      presets = [
        { label: 'Standard Burette / Pipette Breakage', amount: 200, reason: 'Burette/Pipette glassware breakage' },
        { label: 'Volumetric Flask Damage', amount: 300, reason: 'Volumetric flask breakage' },
        { label: 'Chemical Spill / Reagent Fee', amount: 150, reason: 'Chemical spill / wasted reagent' },
        { label: 'Glass Beaker / Test Tube Damage', amount: 100, reason: 'Beaker / test tube breakage' },
        { label: 'Lab Manual Overdue', amount: 0, reason: 'Lab manual unreturned' }
      ];
    } else if (isPhysics) {
      title = 'Physics Department AI Assistant';
      badge = 'PHY';
      greeting = `Hello! I am the **Physics Department AI Assistant**.\n\nI can read real-time student clearance data, check outstanding apparatus dues, and stage safe approvals or fee additions with your explicit confirmation.\n\nHow can I assist your laboratory desk today?`;
      suggestedQueries = [
        'Who has outstanding dues in Physics Lab?',
        'What is the current clearance summary?',
        'Clear dues for student',
        'Mark due for Spectrometer Prism damage'
      ];
      presets = [
        { label: 'Spectrometer Prism / Grating', amount: 350, reason: 'Spectrometer prism damage' },
        { label: 'Laser Optics Kit Component', amount: 500, reason: 'Laser optics kit component damaged' },
        { label: 'Torsional Pendulum Wire Snap', amount: 150, reason: 'Torsion pendulum wire snap' },
        { label: 'Optical Bench Component', amount: 250, reason: 'Optical bench component breakage' },
        { label: 'Observation Manual Overdue', amount: 0, reason: 'Physics manual overdue' }
      ];
    } else if (isHostel) {
      title = 'Hostel Administration AI Assistant';
      badge = 'HST';
      greeting = `Hello! I am the **Hostel Administration AI Assistant**.\n\nI can verify resident hosteller clearance status, check outstanding mess bills, room damage charges, and stage safe clearance approvals with your confirmation.\n\nHow can I assist your hostel desk today?`;
      suggestedQueries = [
        'Who has unpaid mess bills in Hostel?',
        'What is the current hostel clearance summary?',
        'Record room key replacement charge',
        'Approve hostel clearance for resident'
      ];
      presets = [
        { label: 'Outstanding Mess Bill', amount: 1500, reason: 'Monthly mess bill arrears' },
        { label: 'Room Key Replacement', amount: 250, reason: 'Lost room key replacement' },
        { label: 'Cupboard / Lock Damage', amount: 500, reason: 'Room furniture / lock repair' },
        { label: 'Electrical Fixture Damage', amount: 350, reason: 'Room electrical fixture repair' }
      ];
    } else if (isSports) {
      title = 'Sports Department AI Assistant';
      badge = 'SPT';
      greeting = `Hello! I am the **Physical Education & Sports AI Assistant**.\n\nI can check sports equipment issues, tournament kits, gym dues, and stage safe clearance approvals with your confirmation.\n\nHow can I assist your sports desk today?`;
      suggestedQueries = [
        'Who has unreturned sports equipment?',
        'What is the current sports clearance summary?',
        'Record unreturned sports jersey fine',
        'Approve sports clearance'
      ];
      presets = [
        { label: 'Unreturned Badminton Racket', amount: 800, reason: 'Unreturned sports gear' },
        { label: 'Unreturned College Team Jersey', amount: 750, reason: 'Missing college team uniform' },
        { label: 'Cricket Gear Damage / Loss', amount: 600, reason: 'Damaged cricket kit item' },
        { label: 'Gym Equipment Mishandling', amount: 300, reason: 'Gym room penalty' }
      ];
    } else if (isCashFee) {
      title = 'Cash & Fee Section AI Assistant';
      badge = 'ACC';
      greeting = `Hello! I am the **Cash & Fee Section AI Assistant**.\n\nI verify tuition fees, exam fees, transport challans, and assist with financial clearance reconciliation.\n\nHow can I assist your cash counter today?`;
      suggestedQueries = [
        'Who has pending tuition fee dues?',
        'What is the fee section clearance summary?',
        'Check exam fee reconciliation status',
        'Clear fee dues after receipt verification'
      ];
      presets = [
        { label: 'Tuition Fee Arrears', amount: 10000, reason: 'Pending semester tuition balance' },
        { label: 'Bus / Transportation Fee Due', amount: 5000, reason: 'College bus fee arrears' },
        { label: 'Examination Fee Arrears', amount: 1800, reason: 'VTU Exam fee unpaid balance' },
        { label: 'ID Card Re-issue Fee', amount: 200, reason: 'Replacement smart card charge' }
      ];
    } else {
      // Academic branch or generic department
      title = `${dept.name} AI Assistant`;
      badge = dept.code;
      greeting = `Hello! I am the **${dept.name} (${dept.code}) AI Assistant**.\n\nI assist with departmental laboratory clearances, project kit loans, specialized seminar room sign-offs, and branch student clearance verification.\n\nHow can I assist your department desk today?`;
      suggestedQueries = [
        `Who has pending clearances in ${dept.code}?`,
        `What is the current ${dept.name} clearance summary?`,
        'Check student branch clearance status',
        'Clear departmental lab dues'
      ];
      presets = [
        { label: 'Department Lab Equipment Due', amount: 500, reason: 'Departmental lab component due' },
        { label: 'Component / Kit Breakage Fee', amount: 1000, reason: 'Hardware project kit damage' },
        { label: 'Seminar / Library Book Loan', amount: 250, reason: 'Department library book overdue' },
        { label: 'Final Semester Project Due', amount: 0, reason: 'Project hardware return pending' }
      ];
    }

    const systemPrompt = agentConfig?.assistantInstructions || `You are the specialized AI Assistant for ${dept.name} (${dept.code}) at Malnad College of Engineering (MCE).`;
    const supportedOperations = agentConfig?.supportedOperations || ['LOOKUP_STUDENT', 'CHECK_STATUS', 'LIST_DUES'];

    return {
      title,
      badge,
      greeting,
      systemPrompt,
      suggestedQueries,
      presets,
      supportedOperations,
      category: dept.category
    };
  }

  /**
   * Construct tailored scanner configuration
   */
  private static buildScannerConfig(dept: ResolvedDepartment, agentConfig: DepartmentAgentConfig | null) {
    let title = `Scan ${dept.name} Register`;
    let documentType = agentConfig?.extractionSchema?.recordType || `${dept.code}_LOGBOOK_REGISTER`;
    let scannerInstructions = agentConfig?.scannerInstructions || `Extract logbook and register entries for ${dept.name}.`;

    if (dept.code === 'ADM') {
      title = 'Administrative Document & Clearance Scanner';
      documentType = 'ADMINISTRATIVE_CLEARANCE_DOCUMENT';
      scannerInstructions = 'Extract administrative records, clearance acknowledgments, or consolidated clearance submission ledgers.';
    } else if (dept.code === 'LIB') {
      title = 'Scan Central Library Register';
      documentType = 'LIBRARY_DUE_REGISTER';
    } else if (dept.code === 'CHEM') {
      title = 'Scan Chemistry Lab Breakage Register';
      documentType = 'CHEMISTRY_LAB_BREAKAGE_REGISTER';
    } else if (dept.code === 'PHY') {
      title = 'Scan Physics Lab Breakage Register';
      documentType = 'PHYSICS_LAB_BREAKAGE_REGISTER';
    }

    return {
      title,
      documentType,
      scannerInstructions
    };
  }

  /**
   * Fetch live stats corresponding to resolved context scope
   */
  public static async getContextStats(ctx: ResolvedAiContext): Promise<any> {
    if (ctx.department.code === 'ADM') {
      // Institution-wide stats for Administration
      const [studentsCount, fullyClearedCount, pendingCount, blockedCount, deptBreakdown] = await Promise.all([
        prisma.student.count({ where: { isActive: true } }),
        prisma.ndcRequest.count({ where: { status: 'APPROVED' } }),
        prisma.ndcRequest.count({ where: { status: 'IN_PROGRESS' } }),
        prisma.ndcRequest.count({ where: { status: 'BLOCKED' } }),
        prisma.ndcClearance.groupBy({
          by: ['status'],
          _count: { _all: true }
        })
      ]);

      return {
        scope: 'INSTITUTION_WIDE',
        totalStudents: studentsCount,
        fullyCleared: fullyClearedCount,
        pending: pendingCount,
        blocked: blockedCount,
        clearancesByStatus: deptBreakdown.reduce((acc: any, item) => {
          acc[item.status] = item._count._all;
          return acc;
        }, {})
      };
    }

    // Specific department stats
    const groups = await prisma.ndcClearance.groupBy({
      by: ['status'],
      where: { departmentId: ctx.department.id },
      _count: { _all: true }
    });

    let total = 0;
    let pending = 0;
    let due = 0;
    let cleared = 0;

    for (const g of groups) {
      const count = g._count._all;
      total += count;
      if (g.status === 'PENDING') pending += count;
      else if (g.status === 'DUE') due += count;
      else if (g.status === 'CLEARED') cleared += count;
    }

    return {
      scope: 'DEPARTMENT',
      departmentId: ctx.department.id,
      departmentCode: ctx.department.code,
      total,
      pending,
      due,
      cleared
    };
  }
}
