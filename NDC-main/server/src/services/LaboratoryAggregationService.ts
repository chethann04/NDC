import prisma from '../config/prisma';
import { DepartmentClearanceStatus } from '../constants/statuses';

export interface PendingLabDetail {
  id: string;
  name: string;
  code: string;
  status: string;
  logicalStatus: 'NO DUE' | 'DUE' | 'PENDING';
  dueAmount: number;
  dueDetails: string;
  remarks?: string;
  reviewedByName?: string;
}

export interface LaboratoryItemSummary {
  id?: string;
  name: 'Physics Lab' | 'Chemistry Lab' | 'Department Lab';
  code: string;
  status: DepartmentClearanceStatus | string;
  logicalStatus: 'NO DUE' | 'DUE' | 'PENDING';
  dueAmount: number;
  dueDetails?: string;
  remarks?: string;
  isDue: boolean;
  isApplicable: boolean;
}

export interface LaboratoryClearanceSummary {
  status: DepartmentClearanceStatus | 'CLEARED' | 'DUE' | 'PENDING' | 'ON_HOLD' | 'NOT_APPLICABLE';
  aggregateStatus: 'NO DUE' | 'DUE' | 'PENDING';
  overallLaboratoryStatus: 'NO DUE' | 'DUE' | 'PENDING';
  physicsStatus: 'NO DUE' | 'DUE' | 'PENDING';
  chemistryStatus: 'NO DUE' | 'DUE' | 'PENDING';
  departmentStatus: 'NO DUE' | 'DUE' | 'PENDING';

  physicsLab: LaboratoryItemSummary;
  chemistryLab: LaboratoryItemSummary;
  departmentLab: LaboratoryItemSummary;

  totalLabs: number;
  applicableLabsCount: number;
  clearedLabs: number;
  notApplicableLabsCount: number;
  pendingCount: number;
  dueCount: number;
  totalDueAmount: number;
  dueLabs: PendingLabDetail[];
  pendingLabs: PendingLabDetail[];
  allLabs: Array<{
    id: string;
    name: string;
    code: string;
    status: string;
    logicalStatus?: 'NO DUE' | 'DUE' | 'PENDING';
    dueAmount: number;
    reviewedAt?: Date | string | null;
    reviewedByName?: string;
  }>;
}

export class LaboratoryAggregationService {
  /**
   * Deterministically identify whether a clearance task belongs to a laboratory.
   * Strictly limited to:
   * 1. Physics Lab (PHY)
   * 2. Chemistry Lab (CHEM)
   * 3. Department Lab (single departmentLab record with labId)
   */
  public static isLaboratoryClearance(clearance: any): boolean {
    if (!clearance) return false;

    // 1. Linked to a DepartmentLab model -> Department Lab
    if (clearance.labId || clearance.lab) {
      return true;
    }

    const dept = clearance.department || clearance.departmentId;
    if (!dept) return false;

    const code = (dept.code || '').toUpperCase().trim();
    const name = (dept.name || '').toLowerCase();

    // 2. Physics Lab
    if (code === 'PHY' || code === 'PHY_LAB' || (dept.category === 'COLLEGE_LAB' && name.includes('physics'))) {
      return true;
    }

    // 3. Chemistry Lab
    if (code === 'CHEM' || code === 'CHEM_LAB' || (dept.category === 'COLLEGE_LAB' && name.includes('chemistry'))) {
      return true;
    }

    return false;
  }

  /**
   * Helper to normalize each of the 3 logical laboratory clearance items.
   */
  private static evaluateLabItem(
    c: any,
    defaultName: 'Physics Lab' | 'Chemistry Lab' | 'Department Lab',
    defaultCode: string
  ): LaboratoryItemSummary {
    if (!c) {
      return {
        name: defaultName,
        code: defaultCode,
        status: DepartmentClearanceStatus.NOT_APPLICABLE,
        logicalStatus: 'NO DUE',
        dueAmount: 0,
        dueDetails: '',
        remarks: '',
        isDue: false,
        isApplicable: false
      };
    }

    const rawStatus = (c.status || '').toString().toUpperCase();
    const isNA = rawStatus === 'NOT_APPLICABLE';
    const isCleared = rawStatus === 'CLEARED';
    const isDue = rawStatus === 'DUE';

    let logicalStatus: 'NO DUE' | 'DUE' | 'PENDING' = 'PENDING';
    if (isNA || isCleared) {
      logicalStatus = 'NO DUE';
    } else if (isDue) {
      logicalStatus = 'DUE';
    } else {
      logicalStatus = 'PENDING';
    }

    const dueAmount = logicalStatus === 'DUE' ? (c.dueAmount || 0) : 0;
    const dueDetails = c.dueDetails || (dueAmount > 0 ? `Unsettled fee: ₹${dueAmount}` : '');
    const remarks = c.remarks || '';

    let resolvedStatus: any = c.status;
    if (!resolvedStatus) {
      if (logicalStatus === 'NO DUE') resolvedStatus = DepartmentClearanceStatus.CLEARED;
      else if (logicalStatus === 'DUE') resolvedStatus = DepartmentClearanceStatus.DUE;
      else resolvedStatus = DepartmentClearanceStatus.PENDING;
    }

    return {
      id: c.id || c._id,
      name: defaultName,
      code: defaultCode,
      status: resolvedStatus,
      logicalStatus,
      dueAmount,
      dueDetails,
      remarks,
      isDue: logicalStatus === 'DUE',
      isApplicable: !isNA
    };
  }

  /**
   * Calculate centralized aggregate status and summary for student laboratory clearances.
   *
   * Business Rules:
   * Contains EXACTLY THREE logical clearance items:
   *   1. Physics Lab
   *   2. Chemistry Lab
   *   3. Department Lab
   *
   * Rule:
   *   IF Physics Lab = NO DUE
   *      AND Chemistry Lab = NO DUE
   *      AND Department Lab = NO DUE
   *   THEN
   *      Laboratory = NO DUE
   *   OTHERWISE:
   *      Laboratory = DUE
   */
  public static getLaboratoryClearanceSummary(clearances: any[]): LaboratoryClearanceSummary {
    if (!Array.isArray(clearances) || clearances.length === 0) {
      const emptyItem = (name: any, code: string): LaboratoryItemSummary => ({
        name,
        code,
        status: DepartmentClearanceStatus.CLEARED,
        logicalStatus: 'NO DUE',
        dueAmount: 0,
        dueDetails: '',
        remarks: '',
        isDue: false,
        isApplicable: true
      });

      return {
        status: DepartmentClearanceStatus.CLEARED,
        aggregateStatus: 'NO DUE',
        overallLaboratoryStatus: 'NO DUE',
        physicsStatus: 'NO DUE',
        chemistryStatus: 'NO DUE',
        departmentStatus: 'NO DUE',
        physicsLab: emptyItem('Physics Lab', 'PHY'),
        chemistryLab: emptyItem('Chemistry Lab', 'CHEM'),
        departmentLab: emptyItem('Department Lab', 'DEPT_LAB'),
        totalLabs: 3,
        applicableLabsCount: 3,
        clearedLabs: 3,
        notApplicableLabsCount: 0,
        pendingCount: 0,
        dueCount: 0,
        totalDueAmount: 0,
        dueLabs: [],
        pendingLabs: [],
        allLabs: []
      };
    }

    const labClearances = clearances.filter(this.isLaboratoryClearance);

    // Identify the three logical clearances
    const phyClearance = labClearances.find((c: any) => {
      const code = (c.department?.code || c.departmentId?.code || c.lab?.code || '').toUpperCase().trim();
      const name = (c.department?.name || c.departmentId?.name || c.lab?.name || '').toLowerCase();
      return (code === 'PHY' || code === 'PHY_LAB' || name.includes('physics')) && (!c.labId || name.includes('physics'));
    });

    const chemClearance = labClearances.find((c: any) => {
      const code = (c.department?.code || c.departmentId?.code || c.lab?.code || '').toUpperCase().trim();
      const name = (c.department?.name || c.departmentId?.name || c.lab?.name || '').toLowerCase();
      return (code === 'CHEM' || code === 'CHEM_LAB' || name.includes('chemistry')) && (!c.labId || name.includes('chemistry'));
    });

    const deptClearance = labClearances.find((c: any) => {
      if (c === phyClearance || c === chemClearance) return false;
      const code = (c.department?.code || c.departmentId?.code || c.lab?.code || '').toUpperCase().trim();
      const name = (c.department?.name || c.departmentId?.name || c.lab?.name || '').toLowerCase();
      if (code === 'PHY' || code === 'CHEM' || name.includes('physics') || name.includes('chemistry')) return false;
      return c.labId != null || c.lab != null || c.department?.isAcademicBranch;
    });

    // Evaluate each of the 3 items
    const physicsLab = this.evaluateLabItem(phyClearance, 'Physics Lab', 'PHY');
    const chemistryLab = this.evaluateLabItem(chemClearance, 'Chemistry Lab', 'CHEM');
    const departmentLab = this.evaluateLabItem(deptClearance, 'Department Lab', 'DEPT_LAB');

    // Central Rule: IF ALL THREE = NO DUE -> Laboratory = NO DUE; IF ANY = DUE -> Laboratory = DUE; OTHERWISE PENDING
    const isAnyDue = physicsLab.logicalStatus === 'DUE' || chemistryLab.logicalStatus === 'DUE' || departmentLab.logicalStatus === 'DUE';
    const isOverallNoDue =
      physicsLab.logicalStatus === 'NO DUE' &&
      chemistryLab.logicalStatus === 'NO DUE' &&
      departmentLab.logicalStatus === 'NO DUE';

    let overallLaboratoryStatus: 'NO DUE' | 'DUE' | 'PENDING' = 'PENDING';
    let status: DepartmentClearanceStatus = DepartmentClearanceStatus.PENDING;

    if (isAnyDue) {
      overallLaboratoryStatus = 'DUE';
      status = DepartmentClearanceStatus.DUE;
    } else if (isOverallNoDue) {
      overallLaboratoryStatus = 'NO DUE';
      status = DepartmentClearanceStatus.CLEARED;
    } else {
      overallLaboratoryStatus = 'PENDING';
      status = DepartmentClearanceStatus.PENDING;
    }

    const aggregateStatus = overallLaboratoryStatus;

    // Collect WHICH of the three is due or pending for the student dashboard
    const dueLabs: PendingLabDetail[] = [];
    const pendingLabs: PendingLabDetail[] = [];

    const checkLabForLists = (labItem: LaboratoryItemSummary, origClearance: any) => {
      if (!labItem.isApplicable) return;
      const detail: PendingLabDetail = {
        id: labItem.id || `lab-${labItem.code.toLowerCase()}`,
        name: labItem.name,
        code: labItem.code,
        status: String(labItem.status),
        logicalStatus: labItem.logicalStatus,
        dueAmount: labItem.dueAmount,
        dueDetails: labItem.dueDetails || '',
        remarks: labItem.remarks,
        reviewedByName: origClearance?.reviewedBy?.name
      };

      if (labItem.logicalStatus === 'DUE') {
        dueLabs.push(detail);
      } else if (labItem.logicalStatus === 'PENDING') {
        pendingLabs.push(detail);
      }
    };

    checkLabForLists(physicsLab, phyClearance);
    checkLabForLists(chemistryLab, chemClearance);
    checkLabForLists(departmentLab, deptClearance);

    const applicableLabsCount =
      (physicsLab.isApplicable ? 1 : 0) +
      (chemistryLab.isApplicable ? 1 : 0) +
      (departmentLab.isApplicable ? 1 : 0);

    const clearedLabsCount =
      (physicsLab.logicalStatus === 'NO DUE' && physicsLab.isApplicable ? 1 : 0) +
      (chemistryLab.logicalStatus === 'NO DUE' && chemistryLab.isApplicable ? 1 : 0) +
      (departmentLab.logicalStatus === 'NO DUE' && departmentLab.isApplicable ? 1 : 0);

    const totalDueAmount = dueLabs.reduce((sum, l) => sum + (l.dueAmount || 0), 0);

    const allLabs = [
      {
        id: physicsLab.id || 'lab-phy',
        name: 'Physics Lab',
        code: 'PHY',
        status: String(physicsLab.status),
        logicalStatus: physicsLab.logicalStatus,
        dueAmount: physicsLab.dueAmount,
        reviewedAt: phyClearance?.reviewedAt || null,
        reviewedByName: phyClearance?.reviewedBy?.name
      },
      {
        id: chemistryLab.id || 'lab-chem',
        name: 'Chemistry Lab',
        code: 'CHEM',
        status: String(chemistryLab.status),
        logicalStatus: chemistryLab.logicalStatus,
        dueAmount: chemistryLab.dueAmount,
        reviewedAt: chemClearance?.reviewedAt || null,
        reviewedByName: chemClearance?.reviewedBy?.name
      },
      {
        id: departmentLab.id || 'lab-dept',
        name: 'Department Lab',
        code: 'DEPT_LAB',
        status: String(departmentLab.status),
        logicalStatus: departmentLab.logicalStatus,
        dueAmount: departmentLab.dueAmount,
        reviewedAt: deptClearance?.reviewedAt || null,
        reviewedByName: deptClearance?.reviewedBy?.name
      }
    ].filter((item) => {
      if (item.name === 'Physics Lab') return physicsLab.isApplicable;
      if (item.name === 'Chemistry Lab') return chemistryLab.isApplicable;
      if (item.name === 'Department Lab') return departmentLab.isApplicable;
      return true;
    });

    return {
      status,
      aggregateStatus,
      overallLaboratoryStatus,
      physicsStatus: physicsLab.logicalStatus,
      chemistryStatus: chemistryLab.logicalStatus,
      departmentStatus: departmentLab.logicalStatus,

      physicsLab,
      chemistryLab,
      departmentLab,

      totalLabs: 3,
      applicableLabsCount,
      clearedLabs: clearedLabsCount,
      notApplicableLabsCount: 3 - applicableLabsCount,
      pendingCount: pendingLabs.length,
      dueCount: dueLabs.length,
      totalDueAmount,
      dueLabs,
      pendingLabs,
      allLabs
    };
  }

  /**
   * Conceptually equivalent to getLaboratoryClearanceSummary(studentId).
   * Fetches active student clearance records and executes centralized 3-item aggregation.
   */
  public static async getLaboratoryClearanceSummaryByStudentId(studentId: string): Promise<LaboratoryClearanceSummary> {
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: {
        ndcRequests: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          include: {
            clearances: {
              where: {
                department: { isActive: true, requiresClearance: true }
              },
              include: { department: true, lab: true, reviewedBy: true }
            }
          }
        }
      }
    });

    const clearances = student?.ndcRequests?.[0]?.clearances || [];
    return this.getLaboratoryClearanceSummary(clearances);
  }

  /**
   * Aggregate student clearance tasks for dashboard presentation.
   * Replaces all individual laboratory clearance items with a single 'Laboratory' entry.
   * Non-laboratory clearance items (Library, Hostel, Sports, Cash/Fee, Academic Dept) remain intact.
   */
  public static aggregateClearancesForPresentation(clearances: any[]): any[] {
    if (!Array.isArray(clearances) || clearances.length === 0) {
      return [];
    }

    const labSummary = this.getLaboratoryClearanceSummary(clearances);

    // Omit any laboratory clearances, legacy LAB desk, and optional/exempt or inactive departments from the non-lab list
    const nonLabClearances = clearances.filter(
      (c: any) =>
        !this.isLaboratoryClearance(c) &&
        (c.department?.code || c.departmentId?.code) !== 'LAB' &&
        (c.department?.requiresClearance !== false && c.departmentId?.requiresClearance !== false) &&
        (c.department?.isActive !== false && c.departmentId?.isActive !== false)
    );

    // If there were no laboratory clearances at all, return non-lab clearances
    if (labSummary.applicableLabsCount === 0 && labSummary.clearedLabs === 0) {
      return nonLabClearances;
    }

    // Build the unified single 'Laboratory' clearance item
    let remarks = 'All laboratory clearances completed';
    if (labSummary.overallLaboratoryStatus === 'DUE') {
      remarks = `${labSummary.dueCount} laboratory clearance${labSummary.dueCount > 1 ? 's' : ''} have outstanding dues`;
    }

    const dueDetailsStr = labSummary.dueLabs
      .map((l) => `${l.name} — Due${l.dueAmount > 0 ? ' (₹' + l.dueAmount + ')' : ''}`)
      .join(', ');

    const aggregatedLabItem = {
      id: 'aggregate-laboratory',
      _id: 'aggregate-laboratory',
      departmentId: {
        id: 'aggregate-laboratory',
        _id: 'aggregate-laboratory',
        name: 'Laboratory',
        code: 'LAB',
        description: 'Engineering Physics, Engineering Chemistry, and Departmental Laboratory Clearances',
        displayOrder: 2,
        requiresClearance: true,
        isAcademicBranch: false
      },
      department: {
        id: 'aggregate-laboratory',
        _id: 'aggregate-laboratory',
        name: 'Laboratory',
        code: 'LAB',
        displayOrder: 2
      },
      status: labSummary.status,
      remarks,
      dueAmount: labSummary.totalDueAmount,
      dueDetails: dueDetailsStr,
      isAggregatedLab: true,
      labSummary
    };

    // Standard institutional display order:
    // 1. Library (LIB)
    // 2. Laboratory (LAB)
    // 3. Hostel (HST)
    // 4. Sports (SPT)
    // 5. Cash/Fee (ACC)
    // 6. Academic Branch (DEPT / HOD)
    const result: any[] = [];
    let labInserted = false;

    for (const item of nonLabClearances) {
      const code = (item.department?.code || item.departmentId?.code || '').toUpperCase();
      // Insert Laboratory right after Library (LIB) or before Hostel (HST)
      if (!labInserted && (code === 'HST' || code === 'SPT' || code === 'ACC' || item.department?.isAcademicBranch)) {
        result.push(aggregatedLabItem);
        labInserted = true;
      }
      result.push(item);
    }

    if (!labInserted) {
      result.push(aggregatedLabItem);
    }

    return result;
  }

  /**
   * Produce the final itemized clearance list for the official Certificate PDF.
   * Strips all individual laboratories and injects exactly ONE "Laboratory — No Due" entry.
   */
  public static getCertificateClearanceItems(clearanceDocs: any[]): any[] {
    const labSummary = this.getLaboratoryClearanceSummary(clearanceDocs);

    // Filter out NOT_APPLICABLE departments and legacy LAB
    const nonLabClearances = clearanceDocs
      .filter((c: any) => !this.isLaboratoryClearance(c) && (c.department?.code || c.departmentId?.code) !== 'LAB')
      .filter((c: any) => c.status !== DepartmentClearanceStatus.NOT_APPLICABLE && c.status !== 'NOT_APPLICABLE');

    const result: any[] = [];

    // Map non-lab clearances to PDF format
    const nonLabRows = nonLabClearances.map((c: any) => ({
      departmentName: c.department?.name || 'Department Desk',
      departmentCode: c.department?.code || 'DEPT',
      status: c.status || 'CLEARED',
      approvalTimestamp: c.reviewedAt || c.updatedAt || new Date(),
      reviewedByName: c.reviewedBy?.name || 'Clearance Officer',
      displayOrder: c.department?.displayOrder ?? 10
    }));

    // If student had any applicable laboratories, insert exactly ONE Laboratory item
    let labRow: any = null;
    if (labSummary.applicableLabsCount > 0 || labSummary.clearedLabs > 0) {
      const labDocs = clearanceDocs.filter(this.isLaboratoryClearance);
      let latestTimestamp: Date = new Date();
      for (const l of labDocs) {
        const t = l.reviewedAt || l.updatedAt;
        if (t && new Date(t) > latestTimestamp) {
          latestTimestamp = new Date(t);
        }
      }

      labRow = {
        departmentName: 'Laboratory',
        departmentCode: 'LAB',
        status: labSummary.overallLaboratoryStatus === 'NO DUE' ? 'CLEARED' : (labSummary.overallLaboratoryStatus === 'DUE' ? 'DUE' : 'PENDING'),
        approvalTimestamp: latestTimestamp,
        reviewedByName: 'Designated Laboratory In-charge',
        displayOrder: 2
      };
    }

    let labInserted = false;
    for (const row of nonLabRows) {
      const code = (row.departmentCode || '').toUpperCase();
      if (labRow && !labInserted && (code === 'HST' || code === 'SPT' || code === 'ACC' || code.length === 2)) {
        result.push(labRow);
        labInserted = true;
      }
      result.push(row);
    }

    if (labRow && !labInserted) {
      result.push(labRow);
    }

    return result;
  }
}

