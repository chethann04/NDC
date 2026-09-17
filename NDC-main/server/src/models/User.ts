import mongoose, { Schema, Document } from 'mongoose';
import { UserRole } from '../constants/roles';

export interface IUser extends Document {
  email: string;
  passwordHash: string;
  role: UserRole;
  name: string;
  associatedStudentId?: mongoose.Types.ObjectId;
  associatedOfficerId?: mongoose.Types.ObjectId;
  departmentId?: mongoose.Types.ObjectId; // For HOD
  isActive: boolean;
  mustChangePassword?: boolean;
  lastLogin?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema: Schema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: Object.values(UserRole), required: true },
    name: { type: String, required: true, trim: true },
    associatedStudentId: { type: Schema.Types.ObjectId, ref: 'Student' },
    associatedOfficerId: { type: Schema.Types.ObjectId, ref: 'ClearanceOfficer' },
    departmentId: { type: Schema.Types.ObjectId, ref: 'ClearanceDepartment' },
    isActive: { type: Boolean, default: true },
    mustChangePassword: { type: Boolean, default: false }
  },
  { timestamps: true }
);

export default mongoose.model<IUser>('User', UserSchema);
