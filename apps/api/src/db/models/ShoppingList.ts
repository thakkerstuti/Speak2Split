import mongoose, { Schema, Document, Types } from "mongoose";
import { applyStandardJson } from "./plugin";

export interface ShoppingItemSubdoc {
  _id: Types.ObjectId;
  name: string;
  quantity?: string;
  estimatedPrice?: number;
  assignedToId?: Types.ObjectId;
  addedById: Types.ObjectId;
  isCompleted: boolean;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ShoppingListDoc extends Document {
  _id: Types.ObjectId;
  groupId: Types.ObjectId;
  name: string;
  items: ShoppingItemSubdoc[];
  archivedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ShoppingItemSchema = new Schema<ShoppingItemSubdoc>({
  name: { type: String, required: true },
  quantity: { type: String },
  estimatedPrice: { type: Number },
  assignedToId: { type: Schema.Types.ObjectId, ref: "User" },
  addedById: { type: Schema.Types.ObjectId, ref: "User", required: true },
  isCompleted: { type: Boolean, default: false },
  completedAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const ShoppingListSchema = new Schema<ShoppingListDoc>({
  groupId: { type: Schema.Types.ObjectId, ref: "Group", required: true, index: true },
  name: { type: String, default: "Shopping List" },
  items: { type: [ShoppingItemSchema], default: [] },
  archivedAt: { type: Date },
});

applyStandardJson(ShoppingListSchema);
// Items are subdocuments, but we still want id (not _id) exposed on each
// when the parent document is serialized.
ShoppingItemSchema.set("toJSON", {
  virtuals: true,
  transform: (_doc: unknown, ret: any) => {
    ret.id = String(ret._id);
    delete ret._id;
    return ret;
  },
});

export const ShoppingListModel =
  mongoose.models.ShoppingList || mongoose.model<ShoppingListDoc>("ShoppingList", ShoppingListSchema);
