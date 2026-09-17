import mongoose, { Schema, Document } from 'mongoose';

export interface IClearanceDepartment extends Document {
  name: string;
  code: string;
  description: string;
  requiresClearance: boolean;
  isAcademicBranch: boolean;
  displayOrder: number;
  isActive: boolean;
  hodName?: string;
  hodDesignation?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ClearanceDepartmentSchema: Schema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    description: { type: String, default: '' },
    requiresClearance: { type: Boolean, default: true },
    isAcademicBranch: { type: Boolean, default: false },
    displayOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    hodName: { type: String, default: '' },
    hodDesignation: { type: String, default: 'Head of the Department' }
  },
  { timestamps: true }
);


export default mongoose.model<IClearanceDepartment>('ClearanceDepartment', ClearanceDepartmentSchema);
