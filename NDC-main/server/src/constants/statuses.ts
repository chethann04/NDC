export enum NdcRequestStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  BLOCKED = 'BLOCKED',
  APPROVED = 'APPROVED',
  CANCELLED = 'CANCELLED',
  REJECTED = 'REJECTED'
}

export enum DepartmentClearanceStatus {
  PENDING = 'PENDING',
  CLEARED = 'CLEARED',
  DUE = 'DUE',
  ON_HOLD = 'ON_HOLD',
  NOT_APPLICABLE = 'NOT_APPLICABLE'
}

export enum CertificateStatus {
  VALID = 'VALID',
  REVOKED = 'REVOKED'
}
