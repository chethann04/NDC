import mongoose, { Schema, Document } from 'mongoose';

export interface IAuditLog extends Document {
  userId?: mongoose.Types.ObjectId;
  userName?: string;
  role?: string;
  action: string;
  entityType: string;
  entityId?: mongoose.Types.ObjectId | string;
  oldValue?: any;
  newValue?: any;
  description: string;
  ipAddress?: string;
  userAgent?: string;
  timestamp: Date;
}

const AuditLogSchema: Schema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    userName: { type: String, default: 'SYSTEM' },
    role: { type: String, default: 'SYSTEM' },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: Schema.Types.Mixed },
    oldValue: { type: Schema.Types.Mixed },
    newValue: { type: Schema.Types.Mixed },
    description: { type: String, required: true },
    ipAddress: { type: String },
    userAgent: { type: String },
    timestamp: { type: Date, default: Date.now }
  },
  { timestamps: false }
);

AuditLogSchema.index({ userId: 1 });
AuditLogSchema.index({ action: 1 });
AuditLogSchema.index({ entityType: 1 });
AuditLogSchema.index({ timestamp: -1 });

export default mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);
