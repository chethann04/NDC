import mongoose, { Schema, Document } from 'mongoose';
import { CertificateStatus } from '../constants/statuses';

export interface INdcCertificate extends Document {
  certificateNumber: string;
  ndcRequestId: mongoose.Types.ObjectId;
  studentId: mongoose.Types.ObjectId;
  issuedAt: Date;
  issuedBy?: mongoose.Types.ObjectId;
  pdfPath?: string;
  status: CertificateStatus;
  revokedAt?: Date;
  revokedBy?: mongoose.Types.ObjectId;
  revocationReason?: string;
  isReplaced?: boolean;
  replacementCertificateId?: mongoose.Types.ObjectId;
  studentName?: string;
  studentUsn?: string;
  departmentName?: string;
  createdAt: Date;
  updatedAt: Date;
}

const NdcCertificateSchema: Schema = new Schema(
  {
    certificateNumber: { type: String, required: true, unique: true, uppercase: true, trim: true },
    ndcRequestId: { type: Schema.Types.ObjectId, ref: 'NdcRequest', required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    studentName: { type: String },
    studentUsn: { type: String },
    departmentName: { type: String },
    issuedAt: { type: Date, default: Date.now, required: true },
    issuedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    pdfPath: { type: String },
    status: {
      type: String,
      enum: Object.values(CertificateStatus),
      default: CertificateStatus.VALID,
      required: true
    },
    revokedAt: { type: Date },
    revokedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    revocationReason: { type: String },
    isReplaced: { type: Boolean, default: false },
    replacementCertificateId: { type: Schema.Types.ObjectId, ref: 'NdcCertificate' }
  },
  { timestamps: true }
);

NdcCertificateSchema.index({ studentId: 1 });
NdcCertificateSchema.index({ ndcRequestId: 1 });
NdcCertificateSchema.index({ status: 1 });

export default mongoose.model<INdcCertificate>('NdcCertificate', NdcCertificateSchema);
