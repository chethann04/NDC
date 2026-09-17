import mongoose, { Schema, Document } from 'mongoose';
import { DepartmentClearanceStatus } from '../constants/statuses';

export interface INdcClearance extends Document {
  ndcRequestId: mongoose.Types.ObjectId;
  studentId: mongoose.Types.ObjectId;
  departmentId: mongoose.Types.ObjectId;
  officerId?: mongoose.Types.ObjectId;
  status: DepartmentClearanceStatus;
  remarks?: string;
  dueAmount?: number;
  dueDetails?: string;
  reviewedBy?: mongoose.Types.ObjectId; // User ID of reviewer
  reviewedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const NdcClearanceSchema: Schema = new Schema(
  {
    ndcRequestId: { type: Schema.Types.ObjectId, ref: 'NdcRequest', required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    departmentId: { type: Schema.Types.ObjectId, ref: 'ClearanceDepartment', required: true },
    officerId: { type: Schema.Types.ObjectId, ref: 'ClearanceOfficer' },
    status: {
      type: String,
      enum: Object.values(DepartmentClearanceStatus),
      default: DepartmentClearanceStatus.PENDING,
      required: true
    },
    remarks: { type: String },
    dueAmount: { type: Number, default: 0 },
    dueDetails: { type: String },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date }
  },
  { timestamps: true }
);

NdcClearanceSchema.index({ ndcRequestId: 1, departmentId: 1 }, { unique: true });
NdcClearanceSchema.index({ studentId: 1 });
NdcClearanceSchema.index({ departmentId: 1 });
NdcClearanceSchema.index({ status: 1 });

export default mongoose.model<INdcClearance>('NdcClearance', NdcClearanceSchema);
