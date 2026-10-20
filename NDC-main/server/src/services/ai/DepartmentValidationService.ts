import prisma from '../../config/prisma';
import { DepartmentClearanceStatus, NdcRequestStatus } from '../../constants/statuses';
import { DueManagementService } from '../DueManagementService';
import { DepartmentAgentRegistry } from './DepartmentAgentRegistry';

export interface ValidationCheckItem {
  key:
    | 'student_identity'
    | 'desk_validity'
    | 'officer_authorization'
    | 'charge_type'
    | 'amount_rules'
    | 'duplicate_check'
    | 'clearance_state';
  label: string;
  passed: boolean;
  unverified?: boolean;
  mandatory: boolean;
  detail: string;
}

export interface ComprehensiveValidationResult {
  isValid: boolean;
  canStage: boolean;
  canExecute: boolean;
  checks: ValidationCheckItem[];
  student?: any;
  clearance?: any;
  department?: any;
  studentAcademicDepartment: string;
  targetClearanceDesk: string;
  consequences: string;
  emailWillQueue: boolean;
  blockingReason?: string;
  correctiveAction?: string;
}

export class DepartmentValidationService {
  /**
   * Validates whether a specific charge type / reason is authorized for a clearance department
   */
  public static validateChargeType(
    departmentCode: string,
    reason: string
  ): {
    allowed: boolean;
    reasonDetail: string;
    detectedCategory?: string;
    correctiveAction?: string;
  } {
    const cleanReason = (reason || '').trim();
    if (!cleanReason) {
      return {
        allowed: false,
        reasonDetail: 'Due reason is required and cannot be empty.',
        correctiveAction: 'Please specify the exact particulars or description for this due.'
      };
    }

    const code = departmentCode.toUpperCase();
    const config = DepartmentAgentRegistry.getConfig(code);

    // Apparatus & laboratory equipment patterns
    const isLabApparatusReason =
      /\b(apparatus|equipment|spectrometer|sonometer|laser|diffraction|prism|microscope|caliper|vernier|pendulum|dielectric|screw gauge|glassware|burette|pipette|flask|chemical|beaker|crucible|stalagometer|viscometer|electrode|conductance)\b/i.test(
        cleanReason
      );

    // Central Library (LIB) charge validation
    if (code === 'LIB' || config?.displayName?.toLowerCase().includes('library')) {
      if (isLabApparatusReason) {
        return {
          allowed: false,
          reasonDetail: `"${cleanReason}" is a laboratory equipment / apparatus charge type. Central Library clearance desk is only authorized to record library book overdue fines, lost textbook replacements, and damaged volume penalties.`,
          detectedCategory: 'LABORATORY_APPARATUS',
          correctiveAction:
            'If this is an overdue or damaged book fine, please specify the book title or accession number. If this is laboratory equipment damage, route the charge to Engineering Physics Laboratory or the relevant departmental laboratory desk.'
        };
      }

      if (/\b(hostel|mess|room rent|sports|gym|tournament|tuition|exam fee)\b/i.test(cleanReason)) {
        return {
          allowed: false,
          reasonDetail: `"${cleanReason}" is not a library-related charge. Central Library only manages library materials and book fines.`,
          detectedCategory: 'CROSS_DEPARTMENT',
          correctiveAction: 'Route this charge to the respective department desk (Hostel, Sports, or Accounts).'
        };
      }

      return {
        allowed: true,
        reasonDetail: `Authorized charge type for Central Library (Library fine / materials).`,
        detectedCategory: 'LIBRARY_DUES'
      };
    }

    // Engineering Physics Laboratory (PHY)
    if (code === 'PHY') {
      if (/\b(library|book|overdue book|lost book|textbook|accession|book bank)\b/i.test(cleanReason)) {
        return {
          allowed: false,
          reasonDetail: `"${cleanReason}" is a library charge type and is NOT authorized for Engineering Physics Laboratory. Physics Lab only handles laboratory apparatus, instrument damage, and experiment breakages.`,
          detectedCategory: 'LIBRARY_DUES',
          correctiveAction: 'Please record library book fines through the Central Institutional Library AI Assistant.'
        };
      }

      if (/\b(hostel|mess bill|room rent|sports kit|tournament|tuition fee)\b/i.test(cleanReason)) {
        return {
          allowed: false,
          reasonDetail: `"${cleanReason}" is not authorized for Engineering Physics Laboratory.`,
          detectedCategory: 'CROSS_DEPARTMENT',
          correctiveAction: 'Route non-laboratory charges to the appropriate department desk.'
        };
      }

      return {
        allowed: true,
        reasonDetail: `Authorized charge type for Engineering Physics Laboratory (Apparatus / Lab Equipment).`,
        detectedCategory: 'PHYSICS_LAB'
      };
    }

    // Engineering Chemistry Laboratory (CHEM)
    if (code === 'CHEM') {
      if (/\b(library|book|overdue|textbook|hostel|sports|tuition)\b/i.test(cleanReason)) {
        return {
          allowed: false,
          reasonDetail: `"${cleanReason}" is not authorized for Engineering Chemistry Laboratory. Chemistry Lab only handles glassware breakage, chemical spills, and laboratory instruments.`,
          detectedCategory: 'CROSS_DEPARTMENT',
          correctiveAction: 'Route this due to the respective central desk or library.'
        };
      }

      return {
        allowed: true,
        reasonDetail: `Authorized charge type for Chemistry Laboratory (Glassware / Equipment).`,
        detectedCategory: 'CHEMISTRY_LAB'
      };
    }

    // Central Desk: Sports (SPORTS)
    if (code === 'SPORTS') {
      if (isLabApparatusReason || /\b(library|book|textbook|hostel|tuition)\b/i.test(cleanReason)) {
        return {
          allowed: false,
          reasonDetail: `"${cleanReason}" is not authorized for Physical Education & Sports desk. Sports only handles athletic gear, tournament kits, and sports equipment.`,
          detectedCategory: 'CROSS_DEPARTMENT',
          correctiveAction: 'Route this due to the designated lab or library desk.'
        };
      }

      return {
        allowed: true,
        reasonDetail: `Authorized charge type for Sports & Physical Education.`,
        detectedCategory: 'SPORTS'
      };
    }

    // Central Desk: Hostel (HOSTEL)
    if (code === 'HOSTEL') {
      if (isLabApparatusReason || /\b(library|book|textbook|spectrometer|sonometer)\b/i.test(cleanReason)) {
        return {
          allowed: false,
          reasonDetail: `"${cleanReason}" is not authorized for Hostel Section. Hostel Section only handles room rent, mess dues, and hostel property damages.`,
          detectedCategory: 'CROSS_DEPARTMENT',
          correctiveAction: 'Route academic or laboratory dues to the corresponding department.'
        };
      }

      return {
        allowed: true,
        reasonDetail: `Authorized charge type for Hostel Section.`,
        detectedCategory: 'HOSTEL'
      };
    }

    // Central Desk: Finance (FINANCE / ACCOUNTS)
    if (code === 'FINANCE' || code === 'ACC') {
      if (isLabApparatusReason || /\b(spectrometer|sonometer|burette|pipette)\b/i.test(cleanReason)) {
        return {
          allowed: false,
          reasonDetail: `"${cleanReason}" is a laboratory equipment charge and must be handled at the laboratory desk. Finance manages institutional fees and college dues.`,
          detectedCategory: 'CROSS_DEPARTMENT',
          correctiveAction: 'Route equipment dues to the specific laboratory desk.'
        };
      }

      return {
        allowed: true,
        reasonDetail: `Authorized charge type for Accounts & Finance.`,
        detectedCategory: 'FINANCE'
      };
    }

    // Academic Branch Labs (CS, IS, EC, EE, ME, CV, AI, CB, etc.)
    if (config?.category === 'ACADEMIC_BRANCH' || config?.category === 'LABORATORY') {
      if (/\b(library book|central library|hostel mess|tuition fee)\b/i.test(cleanReason)) {
        return {
          allowed: false,
          reasonDetail: `"${cleanReason}" is not authorized for ${config.displayName}. Department labs only handle departmental equipment, computing labs, and project kits.`,
          detectedCategory: 'CROSS_DEPARTMENT',
          correctiveAction: 'Route central charges to the respective central office.'
        };
      }

      return {
        allowed: true,
        reasonDetail: `Authorized charge type for ${config?.displayName || code}.`,
        detectedCategory: 'ACADEMIC_BRANCH'
      };
    }

    // Default permissive if no specific conflict
    return {
      allowed: true,
      reasonDetail: `Charge type verified for ${departmentCode}.`
    };
  }

  /**
   * Comprehensive, pre-flight multi-layer validation based on live database state
   */
  public static async validateDueAction(params: {
    studentUsn: string;
    targetDepartmentIdOrCode: string;
    amount: number;
    reason: string;
    officerUserId: string;
    action: 'MARK_DUE' | 'CLEAR_DUE';
    clearanceId?: string;
  }): Promise<ComprehensiveValidationResult> {
    const {
      studentUsn,
      targetDepartmentIdOrCode,
      amount,
      reason,
      officerUserId,
      action,
      clearanceId
    } = params;

    const checks: ValidationCheckItem[] = [];

    // 1. Fetch Student Identity
    const student = await prisma.student.findFirst({
      where: { usn: { equals: studentUsn.trim(), mode: 'insensitive' } },
      include: {
        department: true,
        certificates: true,
        ndcRequests: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            clearances: {
              include: { department: true }
            }
          }
        }
      }
    });

    const studentAcademicDepartment =
      student?.department?.name || student?.departmentName || 'Information Science & Engineering';

    if (!student) {
      checks.push({
        key: 'student_identity',
        label: 'Student USN & Identity',
        passed: false,
        mandatory: true,
        detail: `USN "${studentUsn}" does not match any active student in the institutional registry.`
      });
    } else if (!student.isActive) {
      checks.push({
        key: 'student_identity',
        label: 'Student USN & Identity',
        passed: false,
        mandatory: true,
        detail: `Student record found (${student.fullName}), but account is flagged INACTIVE.`
      });
    } else {
      checks.push({
        key: 'student_identity',
        label: 'Student USN & Identity',
        passed: true,
        mandatory: true,
        detail: `Verified active student: ${student.fullName} (${student.usn}) — Academic Department: ${studentAcademicDepartment}.`
      });
    }

    // 2. Fetch Target Clearance Department
    let department = await prisma.clearanceDepartment.findFirst({
      where: {
        OR: [
          { id: targetDepartmentIdOrCode },
          { code: { equals: targetDepartmentIdOrCode.trim(), mode: 'insensitive' } }
        ]
      }
    });

    if (!department) {
      checks.push({
        key: 'desk_validity',
        label: 'Target Clearance Desk',
        passed: false,
        mandatory: true,
        detail: `Target clearance desk [${targetDepartmentIdOrCode}] not found in institutional database.`
      });
    } else if (!department.isActive) {
      checks.push({
        key: 'desk_validity',
        label: 'Target Clearance Desk',
        passed: false,
        mandatory: true,
        detail: `Target clearance desk "${department.name}" (${department.code}) is currently inactive.`
      });
    } else {
      checks.push({
        key: 'desk_validity',
        label: 'Target Clearance Desk',
        passed: true,
        mandatory: true,
        detail: `Verified active clearance desk: ${department.name} (${department.code}).`
      });
    }

    const targetClearanceDesk = department?.name || targetDepartmentIdOrCode;

    // 3. Officer Authorization Check
    let officerUser: any = null;
    let isOfficerAuthorized = false;
    let authReason = '';

    if (officerUserId) {
      officerUser = await prisma.user.findUnique({
        where: { id: officerUserId },
        select: { id: true, name: true, role: true, departmentId: true, isActive: true }
      });

      if (!officerUser || !officerUser.isActive) {
        checks.push({
          key: 'officer_authorization',
          label: 'Officer Authorization',
          passed: false,
          mandatory: true,
          detail: 'Officer account is inactive or not found.'
        });
      } else if (department) {
        const authRes = await DueManagementService.verifyOfficerDepartmentAuthorization(
          officerUserId,
          { departmentId: department.id, studentId: student?.id }
        );
        isOfficerAuthorized = authRes.authorized;
        authReason = authRes.reason || '';

        if (isOfficerAuthorized) {
          checks.push({
            key: 'officer_authorization',
            label: 'Officer Authorization',
            passed: true,
            mandatory: true,
            detail: `Authenticated officer (${officerUser.name || officerUser.role}) is authorized for ${department.name}.`
          });
        } else {
          checks.push({
            key: 'officer_authorization',
            label: 'Officer Authorization',
            passed: false,
            mandatory: true,
            detail: `Unauthorized: ${authReason || `Officer does not have review permissions for ${department.name}.`}`
          });
        }
      }
    } else {
      checks.push({
        key: 'officer_authorization',
        label: 'Officer Authorization',
        passed: false,
        unverified: true,
        mandatory: true,
        detail: 'Unverified: No authenticated officer credentials provided.'
      });
    }

    // 4. Charge Type / Department Authorization Check
    let chargeTypeCheck: any = { allowed: true, reasonDetail: 'Valid' };
    if (department && action === 'MARK_DUE') {
      chargeTypeCheck = this.validateChargeType(department.code, reason);
      if (chargeTypeCheck.allowed) {
        checks.push({
          key: 'charge_type',
          label: 'Charge Type Authorization',
          passed: true,
          mandatory: true,
          detail: chargeTypeCheck.reasonDetail
        });
      } else {
        checks.push({
          key: 'charge_type',
          label: 'Charge Type Authorization',
          passed: false,
          mandatory: true,
          detail: chargeTypeCheck.reasonDetail
        });
      }
    } else if (action === 'CLEAR_DUE') {
      checks.push({
        key: 'charge_type',
        label: 'Clearance Action Validity',
        passed: true,
        mandatory: true,
        detail: `Clearance approval as NO DUE is an authorized operation for ${targetClearanceDesk}.`
      });
    }

    // 5. Amount and Business Rules
    if (action === 'MARK_DUE') {
      const numAmount = Number(amount);
      const deptConfig = department ? DepartmentAgentRegistry.getConfig(department.code) : null;
      const minDue = deptConfig?.validationRules?.minDueAmount ?? 1;
      const maxDue = deptConfig?.validationRules?.maxDueAmount ?? 100000;

      if (isNaN(numAmount) || numAmount <= 0) {
        checks.push({
          key: 'amount_rules',
          label: 'Due Amount Validation',
          passed: false,
          mandatory: true,
          detail: `Amount ₹${amount} is invalid. Due amount must be a positive number greater than ₹0.`
        });
      } else if (numAmount < minDue || numAmount > maxDue) {
        checks.push({
          key: 'amount_rules',
          label: 'Due Amount Validation',
          passed: false,
          mandatory: true,
          detail: `Amount ₹${numAmount} violates department limits (Allowed range: ₹${minDue} - ₹${maxDue}).`
        });
      } else {
        checks.push({
          key: 'amount_rules',
          label: 'Due Amount Validation',
          passed: true,
          mandatory: true,
          detail: `Due amount of ₹${numAmount} satisfies department rule constraints (₹${minDue} - ₹${maxDue}).`
        });
      }
    } else {
      checks.push({
        key: 'amount_rules',
        label: 'Due Amount Validation',
        passed: true,
        mandatory: true,
        detail: 'Approval action sets balance to ₹0 (No Due).'
      });
    }

    // Fetch clearance record for clearance state and duplicate checks
    let clearance: any = null;
    if (student && department) {
      if (clearanceId) {
        clearance = await prisma.ndcClearance.findUnique({
          where: { id: clearanceId }
        });
      }
      if (!clearance) {
        clearance = await prisma.ndcClearance.findFirst({
          where: { studentId: student.id, departmentId: department.id }
        });
      }
    }

    // 6. Duplicate Due Detection
    if (clearance && action === 'MARK_DUE') {
      const existingAmount = Number(clearance.dueAmount || 0);
      const existingDetails = (clearance.dueDetails || '').toLowerCase();
      const proposedReason = (reason || '').toLowerCase().trim();

      const isExactDuplicate =
        clearance.status === DepartmentClearanceStatus.DUE &&
        existingAmount === Number(amount) &&
        (existingDetails.includes(proposedReason) || proposedReason.includes(existingDetails));

      if (isExactDuplicate) {
        checks.push({
          key: 'duplicate_check',
          label: 'Duplicate Due Detection',
          passed: false,
          mandatory: true,
          detail: `Duplicate due detected: An identical due of ₹${amount} for "${clearance.dueDetails}" is already recorded on this clearance record.`
        });
      } else {
        // Also check if an identical staged token exists
        const pendingToken = await prisma.aiConfirmationToken.findFirst({
          where: {
            clearanceId: clearance.id,
            action: 'MARK_DUE',
            consumed: false,
            expiresAt: { gt: new Date() }
          }
        });

        const stagedPayload = (pendingToken?.payload as any) || {};
        if (
          pendingToken &&
          stagedPayload.amount === Number(amount) &&
          String(stagedPayload.reason || '').toLowerCase() === proposedReason
        ) {
          checks.push({
            key: 'duplicate_check',
            label: 'Duplicate Due Detection',
            passed: false,
            mandatory: true,
            detail: `Duplicate due detected: An identical proposal of ₹${amount} for "${stagedPayload.reason}" is already staged and pending confirmation.`
          });
        } else {
          checks.push({
            key: 'duplicate_check',
            label: 'Duplicate Due Detection',
            passed: true,
            mandatory: true,
            detail: 'No duplicate dues found on student clearance record.'
          });
        }
      }
    } else if (clearance && action === 'CLEAR_DUE') {
      const isAlreadyCleared =
        clearance.status === (DepartmentClearanceStatus.CLEARED as any) && Number(clearance.dueAmount || 0) === 0;

      if (isAlreadyCleared) {
        checks.push({
          key: 'duplicate_check',
          label: 'Duplicate Action Detection',
          passed: false,
          mandatory: true,
          detail: `${targetClearanceDesk} clearance is already verified and marked as CLEARED with ₹0 dues.`
        });
      } else {
        checks.push({
          key: 'duplicate_check',
          label: 'Duplicate Action Detection',
          passed: true,
          mandatory: true,
          detail: `Clearance currently in ${clearance.status} status; clearance approval ready.`
        });
      }
    } else {
      checks.push({
        key: 'duplicate_check',
        label: 'Duplicate Check',
        passed: true,
        mandatory: true,
        detail: 'Clearance record ready for initialization.'
      });
    }

    // 7. Clearance State & Certificate Validity
    const validCert = student?.certificates?.find((c: any) => c.status === 'VALID');
    if (validCert && action === 'MARK_DUE') {
      checks.push({
        key: 'clearance_state',
        label: 'Clearance State Permitted',
        passed: true,
        mandatory: true,
        detail: `Active certificate [${validCert.certificateNumber}] detected. Recording this due will revoke the certificate and transition NDC status to BLOCKED.`
      });
    } else if (clearance) {
      checks.push({
        key: 'clearance_state',
        label: 'Clearance State Permitted',
        passed: true,
        mandatory: true,
        detail: `Clearance record is in ${clearance.status} state. Action permitted in current workflow cycle.`
      });
    } else {
      checks.push({
        key: 'clearance_state',
        label: 'Clearance State Permitted',
        passed: true,
        mandatory: true,
        detail: 'Student clearance record ready to be established.'
      });
    }

    // Overall Validity Assessment
    const failedMandatoryCheck = checks.find((c) => c.mandatory && !c.passed);
    const isValid = !failedMandatoryCheck;
    const canStage = isValid;
    const canExecute = isValid;

    let blockingReason: string | undefined;
    let correctiveAction: string | undefined;

    if (failedMandatoryCheck) {
      blockingReason = failedMandatoryCheck.detail;
      if (failedMandatoryCheck.key === 'charge_type' && chargeTypeCheck.correctiveAction) {
        correctiveAction = chargeTypeCheck.correctiveAction;
      } else if (failedMandatoryCheck.key === 'student_identity') {
        correctiveAction = 'Verify the student USN format (e.g. 4MC24IS022) and ensure the student is enrolled.';
      } else if (failedMandatoryCheck.key === 'officer_authorization') {
        correctiveAction = `Please switch to an authorized clearance officer account assigned to ${targetClearanceDesk}.`;
      } else if (failedMandatoryCheck.key === 'duplicate_check') {
        correctiveAction = 'Review existing clearance records or cancel the pending duplicate staged action.';
      } else if (failedMandatoryCheck.key === 'amount_rules') {
        correctiveAction = 'Provide a valid positive numeric amount satisfying department limits.';
      }
    }

    // Calculate Real Consequences
    const consequences = this.calculateRealConsequence({
      student,
      department,
      clearance,
      action,
      amount: Number(amount) || 0,
      reason,
      studentAcademicDepartment,
      targetClearanceDesk
    });

    return {
      isValid,
      canStage,
      canExecute,
      checks,
      student,
      clearance,
      department,
      studentAcademicDepartment,
      targetClearanceDesk,
      consequences,
      emailWillQueue: true,
      blockingReason,
      correctiveAction
    };
  }

  /**
   * Derive accurate consequence statement based on actual database relations and business rules
   */
  public static calculateRealConsequence(params: {
    student: any;
    department: any;
    clearance: any;
    action: 'MARK_DUE' | 'CLEAR_DUE';
    amount: number;
    reason: string;
    studentAcademicDepartment: string;
    targetClearanceDesk: string;
  }): string {
    const {
      student,
      department,
      clearance,
      action,
      amount,
      reason,
      studentAcademicDepartment,
      targetClearanceDesk
    } = params;

    const studentName = student?.fullName || 'Student';
    const usn = student?.usn || 'USN';
    const activeRequest = student?.ndcRequests?.[0];
    const currentOverallStatus = activeRequest?.status || 'IN_PROGRESS';

    if (action === 'MARK_DUE') {
      const willTransitionToBlocked = currentOverallStatus !== NdcRequestStatus.BLOCKED;
      const statusImpact = willTransitionToBlocked
        ? `Overall NDC request will transition from ${currentOverallStatus} to BLOCKED, preventing certificate generation until dues are settled.`
        : `Overall NDC request remains BLOCKED due to outstanding departmental dues.`;

      return (
        `Recording an outstanding due of ₹${amount} for "${reason}" will update ${studentName}'s (${usn}) status in ${targetClearanceDesk} to DUE. ` +
        `${statusImpact} An official email notification will be queued to ${student?.email || usn} upon confirmation.`
      );
    }

    // CLEAR_DUE consequences
    const allClearances = activeRequest?.clearances || [];
    const otherPendingOrDue = allClearances.filter(
      (c: any) =>
        c.departmentId !== department?.id &&
        c.status !== DepartmentClearanceStatus.CLEARED &&
        c.status !== DepartmentClearanceStatus.NOT_APPLICABLE
    );

    if (otherPendingOrDue.length === 0 && allClearances.length > 0) {
      return (
        `Approving clearance as NO DUE will set outstanding balance to ₹0 and update ${studentName}'s (${usn}) status in ${targetClearanceDesk} to CLEARED. ` +
        `As all other departmental clearance requirements are satisfied, the student's overall NDC request will advance to APPROVED, enabling official graduation certificate issuance. An official notification will be queued.`
      );
    }

    const clearedCount = allClearances.filter(
      (c: any) =>
        c.status === DepartmentClearanceStatus.CLEARED ||
        c.status === DepartmentClearanceStatus.NOT_APPLICABLE ||
        c.departmentId === department?.id
    ).length;

    return (
      `Approving clearance as NO DUE will set outstanding balance to ₹0 and update ${studentName}'s (${usn}) status in ${targetClearanceDesk} to CLEARED. ` +
      `Progress will advance to ${clearedCount}/${allClearances.length || 1} sections cleared. Final certificate generation will remain pending until remaining sections are cleared. An official notification will be queued.`
    );
  }
}
