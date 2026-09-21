import mongoose, { Schema, Document, Types } from "mongoose";
import { applyStandardJson } from "./plugin";

export interface ExpensePayerSubdoc {
  userId: Types.ObjectId;
  amountPaid: number;
}

export interface ExpenseParticipantSubdoc {
  userId: Types.ObjectId;
  shareAmount: number;
  sharePercent?: number;
  shareUnits?: number;
}

export interface ExpenseDoc extends Document {
  _id: Types.ObjectId;
  groupId: Types.ObjectId;
  title: string;
  amount: number;
  currency: string;
  category: string;
  splitMethod: "EQUAL" | "EXACT" | "PERCENTAGE" | "SHARES";
  source: "MANUAL" | "VOICE" | "RECEIPT_OCR" | "RECURRING" | "TEMPLATE";
  status: "ACTIVE" | "DELETED";
  expenseDate: Date;
  notes?: string;
  createdById: Types.ObjectId;
  recurringExpenseId?: Types.ObjectId;
  recurringOccurrenceDate?: string;
  aiRawInput?: string;
  aiConfidence?: number;
  payers: ExpensePayerSubdoc[];
  participants: ExpenseParticipantSubdoc[];
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ExpensePayerSchema = new Schema<ExpensePayerSubdoc>(
  { userId: { type: Schema.Types.ObjectId, ref: "User", required: true }, amountPaid: { type: Number, required: true } },
  { _id: false }
);

const ExpenseParticipantSchema = new Schema<ExpenseParticipantSubdoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    shareAmount: { type: Number, required: true },
    sharePercent: { type: Number },
    shareUnits: { type: Number },
  },
  { _id: false }
);

const ExpenseSchema = new Schema<ExpenseDoc>({
  groupId: { type: Schema.Types.ObjectId, ref: "Group", required: true, index: true },
  title: { type: String, required: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: "INR" },
  category: { type: String, default: "general" },
  splitMethod: { type: String, enum: ["EQUAL", "EXACT", "PERCENTAGE", "SHARES"], default: "EQUAL" },
  source: { type: String, enum: ["MANUAL", "VOICE", "RECEIPT_OCR", "RECURRING", "TEMPLATE"], default: "MANUAL" },
  status: { type: String, enum: ["ACTIVE", "DELETED"], default: "ACTIVE" },
  expenseDate: { type: Date, default: Date.now },
  notes: { type: String },
  createdById: { type: Schema.Types.ObjectId, ref: "User", required: true },
  recurringExpenseId: { type: Schema.Types.ObjectId, ref: "RecurringExpense" },
  recurringOccurrenceDate: { type: String },
  aiRawInput: { type: String },
  aiConfidence: { type: Number },
  payers: { type: [ExpensePayerSchema], required: true },
  participants: { type: [ExpenseParticipantSchema], required: true },
  deletedAt: { type: Date },
});

ExpenseSchema.index({ groupId: 1, expenseDate: -1 });
ExpenseSchema.index({ groupId: 1, category: 1 });
ExpenseSchema.index({ "payers.userId": 1 });
ExpenseSchema.index({ "participants.userId": 1 });
ExpenseSchema.index(
  { recurringExpenseId: 1, recurringOccurrenceDate: 1 },
  { unique: true, partialFilterExpression: { recurringExpenseId: { $exists: true } } }
);

applyStandardJson(ExpenseSchema);

export const ExpenseModel = mongoose.models.Expense || mongoose.model<ExpenseDoc>("Expense", ExpenseSchema);
