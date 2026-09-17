import mongoose, { Schema, Document } from 'mongoose';

export interface IStudent extends Document {
  studentId: string;
  usn: string;
  fullName: string;
  email: string;
  phone?: string;
  departmentId: mongoose.Types.ObjectId;
  departmentName?: string;
  section: string;
  batch: string;
  academicYear: string;
  semester: string;
  year: string;
  admissionYear: number;
  graduationYear: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const StudentSchema: Schema = new Schema(
  {
    studentId: { type: String, required: true, unique: true, trim: true },
    usn: { type: String, required: true, unique: true, uppercase: true, trim: true },
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, default: '', trim: true },
    departmentId: { type: Schema.Types.ObjectId, ref: 'ClearanceDepartment', required: true },
    departmentName: { type: String },
    section: { type: String, default: 'A', uppercase: true, trim: true },
    batch: { type: String, default: '2022-2026', trim: true },
    academicYear: { type: String, default: '2025-2026', trim: true },
    semester: { type: String, default: '8th Semester', trim: true },
    year: { type: String, default: '4th Year', trim: true },
    admissionYear: { type: Number, default: 2022 },
    graduationYear: { type: Number, default: 2026 },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

StudentSchema.index({ email: 1 });
StudentSchema.index({ departmentId: 1 });
StudentSchema.index({ batch: 1 });
StudentSchema.index({ academicYear: 1 });

export default mongoose.model<IStudent>('Student', StudentSchema);
