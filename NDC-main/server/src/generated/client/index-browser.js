
Object.defineProperty(exports, "__esModule", { value: true });

const {
  Decimal,
  objectEnumValues,
  makeStrictEnum,
  Public,
  getRuntime,
  skip
} = require('./runtime/index-browser.js')


const Prisma = {}

exports.Prisma = Prisma
exports.$Enums = {}

/**
 * Prisma Client JS version: 5.22.0
 * Query Engine version: 605197351a3c8bdd595af2d2a9bc3025bca48ea2
 */
Prisma.prismaVersion = {
  client: "5.22.0",
  engine: "605197351a3c8bdd595af2d2a9bc3025bca48ea2"
}

Prisma.PrismaClientKnownRequestError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientKnownRequestError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)};
Prisma.PrismaClientUnknownRequestError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientUnknownRequestError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientRustPanicError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientRustPanicError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientInitializationError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientInitializationError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientValidationError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientValidationError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.NotFoundError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`NotFoundError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.Decimal = Decimal

/**
 * Re-export of sql-template-tag
 */
Prisma.sql = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`sqltag is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.empty = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`empty is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.join = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`join is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.raw = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`raw is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.validator = Public.validator

/**
* Extensions
*/
Prisma.getExtensionContext = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`Extensions.getExtensionContext is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.defineExtension = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`Extensions.defineExtension is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}

/**
 * Shorthand utilities for JSON filtering
 */
Prisma.DbNull = objectEnumValues.instances.DbNull
Prisma.JsonNull = objectEnumValues.instances.JsonNull
Prisma.AnyNull = objectEnumValues.instances.AnyNull

Prisma.NullTypes = {
  DbNull: objectEnumValues.classes.DbNull,
  JsonNull: objectEnumValues.classes.JsonNull,
  AnyNull: objectEnumValues.classes.AnyNull
}



/**
 * Enums
 */

exports.Prisma.TransactionIsolationLevel = makeStrictEnum({
  ReadUncommitted: 'ReadUncommitted',
  ReadCommitted: 'ReadCommitted',
  RepeatableRead: 'RepeatableRead',
  Serializable: 'Serializable'
});

exports.Prisma.UserScalarFieldEnum = {
  id: 'id',
  loginId: 'loginId',
  email: 'email',
  passwordHash: 'passwordHash',
  role: 'role',
  name: 'name',
  associatedStudentId: 'associatedStudentId',
  associatedOfficerId: 'associatedOfficerId',
  departmentId: 'departmentId',
  isActive: 'isActive',
  mustChangePassword: 'mustChangePassword',
  lastLogin: 'lastLogin',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ClearanceDepartmentScalarFieldEnum = {
  id: 'id',
  name: 'name',
  code: 'code',
  category: 'category',
  description: 'description',
  requiresClearance: 'requiresClearance',
  isAcademicBranch: 'isAcademicBranch',
  displayOrder: 'displayOrder',
  isActive: 'isActive',
  hodName: 'hodName',
  hodDesignation: 'hodDesignation',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.DepartmentLabScalarFieldEnum = {
  id: 'id',
  name: 'name',
  code: 'code',
  departmentId: 'departmentId',
  applicableSemesters: 'applicableSemesters',
  displayOrder: 'displayOrder',
  isActive: 'isActive',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ClearanceOfficerScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  employeeId: 'employeeId',
  name: 'name',
  email: 'email',
  isActive: 'isActive',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ClearanceOfficerDepartmentScalarFieldEnum = {
  officerId: 'officerId',
  departmentId: 'departmentId',
  assignedAt: 'assignedAt'
};

exports.Prisma.StudentScalarFieldEnum = {
  id: 'id',
  studentId: 'studentId',
  usn: 'usn',
  fullName: 'fullName',
  email: 'email',
  phone: 'phone',
  departmentId: 'departmentId',
  departmentName: 'departmentName',
  section: 'section',
  batch: 'batch',
  academicYear: 'academicYear',
  semester: 'semester',
  year: 'year',
  admissionYear: 'admissionYear',
  graduationYear: 'graduationYear',
  dateOfBirth: 'dateOfBirth',
  isActive: 'isActive',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.NdcRequestScalarFieldEnum = {
  id: 'id',
  requestNumber: 'requestNumber',
  studentId: 'studentId',
  status: 'status',
  submittedAt: 'submittedAt',
  completedAt: 'completedAt',
  certificateId: 'certificateId',
  remarks: 'remarks',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.NdcClearanceScalarFieldEnum = {
  id: 'id',
  ndcRequestId: 'ndcRequestId',
  studentId: 'studentId',
  departmentId: 'departmentId',
  labId: 'labId',
  officerId: 'officerId',
  status: 'status',
  remarks: 'remarks',
  dueAmount: 'dueAmount',
  dueDetails: 'dueDetails',
  reviewedById: 'reviewedById',
  reviewedAt: 'reviewedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.NdcCertificateScalarFieldEnum = {
  id: 'id',
  certificateNumber: 'certificateNumber',
  ndcRequestId: 'ndcRequestId',
  studentId: 'studentId',
  studentName: 'studentName',
  studentUsn: 'studentUsn',
  departmentName: 'departmentName',
  issuedAt: 'issuedAt',
  issuedById: 'issuedById',
  pdfPath: 'pdfPath',
  status: 'status',
  revokedAt: 'revokedAt',
  revokedById: 'revokedById',
  revocationReason: 'revocationReason',
  isReplaced: 'isReplaced',
  replacementCertificateId: 'replacementCertificateId',
  isSubmitted: 'isSubmitted',
  submittedAt: 'submittedAt',
  submittedById: 'submittedById',
  submissionRemarks: 'submissionRemarks',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.CertificateSequenceScalarFieldEnum = {
  id: 'id',
  key: 'key',
  year: 'year',
  prefix: 'prefix',
  currentNumber: 'currentNumber',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.SettingScalarFieldEnum = {
  id: 'id',
  collegeName: 'collegeName',
  collegeAddress: 'collegeAddress',
  collegeLogoUrl: 'collegeLogoUrl',
  certificateTitle: 'certificateTitle',
  certificateStatement: 'certificateStatement',
  certificatePrefix: 'certificatePrefix',
  academicYear: 'academicYear',
  signatoryName: 'signatoryName',
  signatoryDesignation: 'signatoryDesignation',
  footerText: 'footerText',
  eligibleBatches: 'eligibleBatches',
  eligibleYears: 'eligibleYears',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.AuditLogScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  userName: 'userName',
  role: 'role',
  action: 'action',
  entityType: 'entityType',
  entityId: 'entityId',
  oldValue: 'oldValue',
  newValue: 'newValue',
  description: 'description',
  ipAddress: 'ipAddress',
  userAgent: 'userAgent',
  timestamp: 'timestamp'
};

exports.Prisma.NotificationScalarFieldEnum = {
  id: 'id',
  recipientUserId: 'recipientUserId',
  title: 'title',
  message: 'message',
  type: 'type',
  isRead: 'isRead',
  relatedEntityId: 'relatedEntityId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.SortOrder = {
  asc: 'asc',
  desc: 'desc'
};

exports.Prisma.NullableJsonNullValueInput = {
  DbNull: Prisma.DbNull,
  JsonNull: Prisma.JsonNull
};

exports.Prisma.QueryMode = {
  default: 'default',
  insensitive: 'insensitive'
};

exports.Prisma.NullsOrder = {
  first: 'first',
  last: 'last'
};

exports.Prisma.JsonNullValueFilter = {
  DbNull: Prisma.DbNull,
  JsonNull: Prisma.JsonNull,
  AnyNull: Prisma.AnyNull
};
exports.UserRole = exports.$Enums.UserRole = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  DEPARTMENT_OFFICER: 'DEPARTMENT_OFFICER',
  HOD: 'HOD',
  STUDENT: 'STUDENT'
};

exports.NdcRequestStatus = exports.$Enums.NdcRequestStatus = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  BLOCKED: 'BLOCKED',
  APPROVED: 'APPROVED',
  CANCELLED: 'CANCELLED',
  REJECTED: 'REJECTED'
};

exports.DepartmentClearanceStatus = exports.$Enums.DepartmentClearanceStatus = {
  PENDING: 'PENDING',
  CLEARED: 'CLEARED',
  DUE: 'DUE',
  ON_HOLD: 'ON_HOLD',
  NOT_APPLICABLE: 'NOT_APPLICABLE'
};

exports.CertificateStatus = exports.$Enums.CertificateStatus = {
  VALID: 'VALID',
  REVOKED: 'REVOKED',
  REPLACED: 'REPLACED'
};

exports.Prisma.ModelName = {
  User: 'User',
  ClearanceDepartment: 'ClearanceDepartment',
  DepartmentLab: 'DepartmentLab',
  ClearanceOfficer: 'ClearanceOfficer',
  ClearanceOfficerDepartment: 'ClearanceOfficerDepartment',
  Student: 'Student',
  NdcRequest: 'NdcRequest',
  NdcClearance: 'NdcClearance',
  NdcCertificate: 'NdcCertificate',
  CertificateSequence: 'CertificateSequence',
  Setting: 'Setting',
  AuditLog: 'AuditLog',
  Notification: 'Notification'
};

/**
 * This is a stub Prisma Client that will error at runtime if called.
 */
class PrismaClient {
  constructor() {
    return new Proxy(this, {
      get(target, prop) {
        let message
        const runtime = getRuntime()
        if (runtime.isEdge) {
          message = `PrismaClient is not configured to run in ${runtime.prettyName}. In order to run Prisma Client on edge runtime, either:
- Use Prisma Accelerate: https://pris.ly/d/accelerate
- Use Driver Adapters: https://pris.ly/d/driver-adapters
`;
        } else {
          message = 'PrismaClient is unable to run in this browser environment, or has been bundled for the browser (running in `' + runtime.prettyName + '`).'
        }
        
        message += `
If this is unexpected, please open an issue: https://pris.ly/prisma-prisma-bug-report`

        throw new Error(message)
      }
    })
  }
}

exports.PrismaClient = PrismaClient

Object.assign(exports, Prisma)
