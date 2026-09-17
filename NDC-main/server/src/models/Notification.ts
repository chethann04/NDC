import mongoose, { Schema, Document } from 'mongoose';

export interface INotification extends Document {
  recipientUserId: mongoose.Types.ObjectId;
  title: string;
  message: string;
  type: string;
  isRead: boolean;
  relatedEntityId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema: Schema = new Schema(
  {
    recipientUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    type: { type: String, default: 'INFO' },
    isRead: { type: Boolean, default: false },
    relatedEntityId: { type: Schema.Types.ObjectId }
  },
  { timestamps: true }
);

NotificationSchema.index({ recipientUserId: 1, isRead: 1 });

export default mongoose.model<INotification>('Notification', NotificationSchema);
