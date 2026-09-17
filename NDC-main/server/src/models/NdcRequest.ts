import mongoose, { Schema, Document } from 'mongoose';
import { NdcRequestStatus } from '../constants/statuses';

export interface INdcRequest extends Document {
  requestNumber: string;
  studentId: mongoose.Types.ObjectId;
  status: NdcRequestStatus;
  submittedAt: Date;
  completedAt?: Date;
  certificateId?: mongoose.Types.ObjectId;
  remarks?: string;
  createdAt: Date;
  updatedAt: Date;
}

const NdcRequestSchema: Schema = new Schema(
  {
    requestNumber: { type: String, required: true, unique: true, uppercase: true, trim: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    status: {
      type: String,
      enum: Object.values(NdcRequestStatus),
      default: NdcRequestStatus.PENDING,
      required: true
    },
    submittedAt: { type: Date, default: Date.now },
    completedAt: { type: Date },
    certificateId: { type: Schema.Types.ObjectId, ref: 'NdcCertificate' },
    remarks: { type: String }
  },
  { timestamps: true }
);

NdcRequestSchema.index({ studentId: 1 });
NdcRequestSchema.index({ status: 1 });
NdcRequestSchema.index({ submittedAt: -1 });

export default mongoose.model<INdcRequest>('NdcRequest', NdcRequestSchema);
