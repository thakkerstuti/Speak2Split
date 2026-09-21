import mongoose, { Schema, Document, Types } from "mongoose";
import { applyStandardJson } from "./plugin";

export interface ExpenseTemplateDoc extends Document {
  _id: Types.ObjectId;
  groupId?: Types.ObjectId;
  ownerId: Types.ObjectId;
  name: string;
  title: string;
  defaultAmount?: number;
  category: string;
  splitMethod: "EQUAL" | "EXACT" | "PERCENTAGE" | "SHARES";
  icon?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ExpenseTemplateSchema = new Schema<ExpenseTemplateDoc>({
  groupId: { type: Schema.Types.ObjectId, ref: "Group", index: true },
  ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  name: { type: String, required: true },
  title: { type: String, required: true },
  defaultAmount: { type: Number },
  category: { type: String, default: "general" },
  splitMethod: { type: String, enum: ["EQUAL", "EXACT", "PERCENTAGE", "SHARES"], default: "EQUAL" },
  icon: { type: String },
});

applyStandardJson(ExpenseTemplateSchema);

export const ExpenseTemplateModel =
  mongoose.models.ExpenseTemplate || mongoose.model<ExpenseTemplateDoc>("ExpenseTemplate", ExpenseTemplateSchema);
