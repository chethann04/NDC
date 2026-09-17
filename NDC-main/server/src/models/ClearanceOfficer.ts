import mongoose, { Schema, Document } from 'mongoose';

export interface IClearanceOfficer extends Document {
  userId: mongoose.Types.ObjectId;
  employeeId: string;
  name: string;
  email: string;
  departmentIds: mongoose.Types.ObjectId[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ClearanceOfficerSchema: Schema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    employeeId: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    departmentIds: [{ type: Schema.Types.ObjectId, ref: 'ClearanceDepartment' }],
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);


export default mongoose.model<IClearanceOfficer>('ClearanceOfficer', ClearanceOfficerSchema);
