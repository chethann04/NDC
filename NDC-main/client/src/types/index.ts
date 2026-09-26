export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'DEPARTMENT_OFFICER' | 'HOD' | 'STUDENT';

export type NdcStatus = 'PENDING' | 'IN_PROGRESS' | 'BLOCKED' | 'APPROVED' | 'CANCELLED' | 'REJECTED';

export type ClearanceStatus = 'PENDING' | 'CLEARED' | 'DUE' | 'ON_HOLD' | 'NOT_APPLICABLE';

export type CertificateStatus = 'VALID' | 'REVOKED';

export interface PendingLabDetail {
  id: string;
  name: string;
  code: string;
  status: ClearanceStatus;
  dueAmount: number;
  dueDetails?: string;
  remarks?: string;
  reviewedByName?: string;
}

export interface LaboratorySummary {
  status: ClearanceStatus;
  totalLabs: number;
  applicableLabsCount: number;
  clearedLabs: number;
  notApplicableLabsCount: number;
  pendingCount: number;
  dueCount: number;
  totalDueAmount: number;
  pendingLabs: PendingLabDetail[];
  allLabs: {
    id: string;
    name: string;
    code: string;
    status: ClearanceStatus;
    dueAmount: number;
    reviewedAt?: string;
    reviewedByName?: string;
  }[];
}

export interface User {
  id: string;
  loginId?: string;
  email: string;
  name: string;
  role: UserRole;
  mustChangePassword?: boolean;
  associatedStudentId?: string;
  associatedOfficerId?: string;
  departmentId?: string;
  department?: Department;
  studentProfile?: Student;
  officerProfile?: ClearanceOfficer;
}

export interface Student {
  _id: string;
  studentId: string;
  usn: string;
  fullName: string;
  email: string;
  phone: string;
  departmentId: Department | any;
  departmentName?: string;
  section: string;
  batch: string;
  academicYear: string;
  semester: string;
  year: string;
  admissionYear: number;
  graduationYear: number;
  isActive: boolean;
  createdAt?: string;
}

export interface Department {
  _id: string;
  name: string;
  code: string;
  description?: string;
  category?: string;
  requiresClearance: boolean;
  isAcademicBranch?: boolean;
  displayOrder: number;
  isActive: boolean;
  hodName?: string;
  hodDesignation?: string;
}

export interface ClearanceOfficer {
  _id: string;
  userId: string;
  employeeId: string;
  name: string;
  email: string;
  departmentIds: Department[] | string[];
  isActive: boolean;
}

export interface NdcRequest {
  _id: string;
  requestNumber: string;
  studentId: Student | any;
  status: NdcStatus;
  submittedAt: string;
  completedAt?: string;
  certificateId?: Certificate | any;
  remarks?: string;
}

export interface ClearanceTask {
  _id: string;
  ndcRequestId: NdcRequest | any;
  studentId: Student | any;
  departmentId: Department | any;
  officerId?: ClearanceOfficer | any;
  status: ClearanceStatus;
  remarks?: string;
  dueAmount?: number;
  dueDetails?: string;
  reviewedBy?: User | any;
  reviewedAt?: string;
  createdAt: string;
}

export interface Certificate {
  _id: string;
  certificateNumber: string;
  ndcRequestId: string;
  studentId: Student | any;
  issuedAt: string;
  issuedBy?: User | any;
  pdfPath?: string;
  status: CertificateStatus;
  revokedAt?: string;
  revocationReason?: string;
}

export interface AuditLog {
  _id: string;
  userId?: User | any;
  userName?: string;
  role?: string;
  action: string;
  entityType: string;
  entityId?: string;
  description: string;
  ipAddress?: string;
  timestamp: string;
}

export interface SystemSetting {
  _id: string;
  collegeName: string;
  collegeAddress: string;
  collegeLogoUrl?: string;
  certificateTitle: string;
  certificateStatement: string;
  certificatePrefix: string;
  signatoryName: string;
  signatoryDesignation: string;
  footerText: string;
  eligibleBatches: string[];
  eligibleYears: string[];
}
