import mongoose, { Schema, Document, Types } from "mongoose";

export interface ActivityEventDoc extends Document {
  _id: Types.ObjectId;
  groupId: Types.ObjectId;
  actorId: Types.ObjectId;
  expenseId?: Types.ObjectId;
  type: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

const ActivityEventSchema = new Schema<ActivityEventDoc>({
  groupId: { type: Schema.Types.ObjectId, ref: "Group", required: true, index: true },
  actorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  expenseId: { type: Schema.Types.ObjectId, ref: "Expense" },
  type: { type: String, required: true },
  metadata: { type: Schema.Types.Mixed },
  createdAt: { type: Date, default: Date.now },
});

ActivityEventSchema.index({ groupId: 1, createdAt: -1 });

export const ActivityEventModel =
  mongoose.models.ActivityEvent || mongoose.model<ActivityEventDoc>("ActivityEvent", ActivityEventSchema);
