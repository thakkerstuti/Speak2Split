import mongoose, { Schema, Document, Types } from "mongoose";
import { applyStandardJson } from "./plugin";

export interface ContactDoc extends Document {
  _id: Types.ObjectId;
  ownerUserId: Types.ObjectId;
  targetUserId?: Types.ObjectId;
  displayName: string;
  firstName: string;
  lastName?: string;
  phone?: string;
  email?: string;
  normalizedPhone?: string;
  normalizedEmail?: string;
  source: "MANUAL" | "DEVICE_CONTACT_SYNC" | "GROUP_INVITE";
  aliases: string[];
  frequencyScore: number;
  lastUsedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ContactSchema = new Schema<ContactDoc>({
  ownerUserId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  targetUserId: { type: Schema.Types.ObjectId, ref: "User" },
  displayName: { type: String, required: true },
  firstName: { type: String, required: true },
  lastName: { type: String },
  phone: { type: String },
  email: { type: String },
  normalizedPhone: { type: String },
  normalizedEmail: { type: String },
  source: { type: String, enum: ["MANUAL", "DEVICE_CONTACT_SYNC", "GROUP_INVITE"], default: "MANUAL" },
  aliases: { type: [String], default: [] },
  frequencyScore: { type: Number, default: 0 },
  lastUsedAt: { type: Date },
});

ContactSchema.index({ ownerUserId: 1, normalizedPhone: 1 }, { unique: true, sparse: true });
ContactSchema.index({ ownerUserId: 1, normalizedEmail: 1 }, { unique: true, sparse: true });
ContactSchema.index({ ownerUserId: 1, firstName: 1 });
ContactSchema.index({ ownerUserId: 1, lastUsedAt: -1 });

applyStandardJson(ContactSchema);

export const ContactModel = mongoose.models.Contact || mongoose.model<ContactDoc>("Contact", ContactSchema);
