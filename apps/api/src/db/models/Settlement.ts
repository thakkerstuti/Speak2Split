import mongoose, { Schema, Document, Types } from "mongoose";
import { applyStandardJson } from "./plugin";

export interface SettlementDoc extends Document {
  _id: Types.ObjectId;
  groupId: Types.ObjectId;
  fromUserId: Types.ObjectId;
  toUserId: Types.ObjectId;
  amount: number;
  currency: string;
  method: "CASH" | "UPI" | "BANK_TRANSFER" | "OTHER";
  status: "PENDING" | "COMPLETED" | "CANCELLED";
  note?: string;
  completedAt?: Date;
  cancelledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const SettlementSchema = new Schema<SettlementDoc>({
  groupId: { type: Schema.Types.ObjectId, ref: "Group", required: true, index: true },
  fromUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  toUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: "INR" },
  method: { type: String, enum: ["CASH", "UPI", "BANK_TRANSFER", "OTHER"], default: "CASH" },
  status: { type: String, enum: ["PENDING", "COMPLETED", "CANCELLED"], default: "PENDING" },
  note: { type: String },
  completedAt: { type: Date },
  cancelledAt: { type: Date },
});

SettlementSchema.index({ groupId: 1, status: 1 });

applyStandardJson(SettlementSchema);

export const SettlementModel =
  mongoose.models.Settlement || mongoose.model<SettlementDoc>("Settlement", SettlementSchema);
