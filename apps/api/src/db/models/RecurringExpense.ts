import mongoose, { Schema, Document, Types } from "mongoose";
import { applyStandardJson } from "./plugin";

export interface RecurringPayerConfig {
  userId: Types.ObjectId;
  amountPaid: number;
}
export interface RecurringParticipantConfig {
  userId: Types.ObjectId;
  exactAmount?: number;
  percentage?: number;
  shareUnits?: number;
}

export interface RecurringExpenseDoc extends Document {
  _id: Types.ObjectId;
  groupId: Types.ObjectId;
  title: string;
  amount: number;
  currency: string;
  category: string;
  splitMethod: "EQUAL" | "EXACT" | "PERCENTAGE" | "SHARES";
  payerConfig: RecurringPayerConfig[];
  participantConfig: RecurringParticipantConfig[];
  frequency: "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "YEARLY";
  startDate: Date;
  endDate?: Date;
  nextOccurrence: Date;
  lastGeneratedAt?: Date;
  isActive: boolean;
  createdById: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const RecurringExpenseSchema = new Schema<RecurringExpenseDoc>({
  groupId: { type: Schema.Types.ObjectId, ref: "Group", required: true, index: true },
  title: { type: String, required: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: "INR" },
  category: { type: String, default: "general" },
  splitMethod: { type: String, enum: ["EQUAL", "EXACT", "PERCENTAGE", "SHARES"], default: "EQUAL" },
  payerConfig: { type: Schema.Types.Mixed, required: true },
  participantConfig: { type: Schema.Types.Mixed, required: true },
  frequency: { type: String, enum: ["DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY", "YEARLY"], default: "MONTHLY" },
  startDate: { type: Date, required: true },
  endDate: { type: Date },
  nextOccurrence: { type: Date, required: true },
  lastGeneratedAt: { type: Date },
  isActive: { type: Boolean, default: true },
  createdById: { type: Schema.Types.ObjectId, ref: "User", required: true },
});

RecurringExpenseSchema.index({ groupId: 1, isActive: 1 });
RecurringExpenseSchema.index({ nextOccurrence: 1, isActive: 1 });

applyStandardJson(RecurringExpenseSchema);

export const RecurringExpenseModel =
  mongoose.models.RecurringExpense || mongoose.model<RecurringExpenseDoc>("RecurringExpense", RecurringExpenseSchema);
