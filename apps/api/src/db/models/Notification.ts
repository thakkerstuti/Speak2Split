import mongoose, { Schema, Document, Types } from "mongoose";
import { applyStandardJson } from "./plugin";

export interface NotificationDeliverySubdoc {
  channel: "IN_APP" | "PUSH" | "EMAIL" | "WHATSAPP";
  status: "PENDING" | "SENT" | "DELIVERED" | "FAILED" | "SKIPPED_PREFERENCE" | "SKIPPED_NOT_CONFIGURED";
  providerRef?: string;
  error?: string;
  attemptedAt: Date;
  deliveredAt?: Date;
}

export interface NotificationDoc extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  groupId?: Types.ObjectId;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  readAt?: Date;
  deliveries: NotificationDeliverySubdoc[];
  createdAt: Date;
}

const NotificationDeliverySchema = new Schema<NotificationDeliverySubdoc>(
  {
    channel: { type: String, enum: ["IN_APP", "PUSH", "EMAIL", "WHATSAPP"], required: true },
    status: {
      type: String,
      enum: ["PENDING", "SENT", "DELIVERED", "FAILED", "SKIPPED_PREFERENCE", "SKIPPED_NOT_CONFIGURED"],
      default: "PENDING",
    },
    providerRef: { type: String },
    error: { type: String },
    attemptedAt: { type: Date, default: Date.now },
    deliveredAt: { type: Date },
  },
  { _id: false }
);

const NotificationSchema = new Schema<NotificationDoc>({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  groupId: { type: Schema.Types.ObjectId, ref: "Group", index: true },
  type: { type: String, required: true },
  title: { type: String, required: true },
  body: { type: String, required: true },
  data: { type: Schema.Types.Mixed },
  readAt: { type: Date },
  deliveries: { type: [NotificationDeliverySchema], default: [] },
  createdAt: { type: Date, default: Date.now },
});

NotificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });

applyStandardJson(NotificationSchema);

export const NotificationModel =
  mongoose.models.Notification || mongoose.model<NotificationDoc>("Notification", NotificationSchema);

export interface NotificationPreferenceDoc extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  type: string;
  channel: "IN_APP" | "PUSH" | "EMAIL" | "WHATSAPP";
  enabled: boolean;
}

const NotificationPreferenceSchema = new Schema<NotificationPreferenceDoc>({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  type: { type: String, required: true },
  channel: { type: String, enum: ["IN_APP", "PUSH", "EMAIL", "WHATSAPP"], required: true },
  enabled: { type: Boolean, default: true },
});

NotificationPreferenceSchema.index({ userId: 1, type: 1, channel: 1 }, { unique: true });

export const NotificationPreferenceModel =
  mongoose.models.NotificationPreference ||
  mongoose.model<NotificationPreferenceDoc>("NotificationPreference", NotificationPreferenceSchema);

export interface NotificationDeviceDoc extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  expoPushToken: string;
  platform: "ios" | "android";
  createdAt: Date;
  lastSeenAt: Date;
}

const NotificationDeviceSchema = new Schema<NotificationDeviceDoc>({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  expoPushToken: { type: String, required: true, unique: true },
  platform: { type: String, enum: ["ios", "android"], required: true },
  createdAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
});

export const NotificationDeviceModel =
  mongoose.models.NotificationDevice ||
  mongoose.model<NotificationDeviceDoc>("NotificationDevice", NotificationDeviceSchema);
