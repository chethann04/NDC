import mongoose, { Schema, Document } from 'mongoose';

export interface ICertificateSequence extends Document {
  key: string; // e.g. "NDC"
  year: number; // e.g. 2026
  prefix: string; // e.g. "NDC/MCE/"
  currentNumber: number;
  createdAt: Date;
  updatedAt: Date;
}

const CertificateSequenceSchema: Schema = new Schema(
  {
    key: { type: String, required: true, default: 'NDC' },
    year: { type: Number, required: true },
    prefix: { type: String, required: true, default: 'NDC/MCE/' },
    currentNumber: { type: Number, required: true, default: 0 }
  },
  { timestamps: true }
);

CertificateSequenceSchema.index({ key: 1, year: 1 }, { unique: true });

export default mongoose.model<ICertificateSequence>('CertificateSequence', CertificateSequenceSchema);
