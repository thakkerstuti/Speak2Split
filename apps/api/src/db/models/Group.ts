import mongoose, { Schema, Document, Types } from "mongoose";
import crypto from "crypto";
import { applyStandardJson } from "./plugin";

export interface GroupDoc extends Document {
  _id: Types.ObjectId;
  name: string;
  type: "FLAT" | "TRIP" | "FAMILY" | "FRIENDS" | "COUPLE" | "EVENT" | "CUSTOM";
  currency: string;
  createdById: Types.ObjectId;
  inviteCode: string;
  archivedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const GroupSchema = new Schema<GroupDoc>({
  name: { type: String, required: true },
  type: { type: String, enum: ["FLAT", "TRIP", "FAMILY", "FRIENDS", "COUPLE", "EVENT", "CUSTOM"], default: "CUSTOM" },
  currency: { type: String, default: "INR" },
  createdById: { type: Schema.Types.ObjectId, ref: "User", required: true },
  inviteCode: { type: String, unique: true, default: () => crypto.randomBytes(6).toString("hex") },
  archivedAt: { type: Date },
});

applyStandardJson(GroupSchema);

export const GroupModel = mongoose.models.Group || mongoose.model<GroupDoc>("Group", GroupSchema);

export interface GroupMemberDoc extends Document {
  _id: Types.ObjectId;
  groupId: Types.ObjectId;
  userId: Types.ObjectId;
  role: "OWNER" | "ADMIN" | "MEMBER";
  status: "INVITED" | "ACTIVE" | "LEFT" | "REMOVED";
  joinedAt: Date;
  leftAt?: Date;
}

const GroupMemberSchema = new Schema<GroupMemberDoc>({
  groupId: { type: Schema.Types.ObjectId, ref: "Group", required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  role: { type: String, enum: ["OWNER", "ADMIN", "MEMBER"], default: "MEMBER" },
  status: { type: String, enum: ["INVITED", "ACTIVE", "LEFT", "REMOVED"], default: "ACTIVE" },
  joinedAt: { type: Date, default: Date.now },
  leftAt: { type: Date },
});

GroupMemberSchema.index({ groupId: 1, userId: 1 }, { unique: true });

applyStandardJson(GroupMemberSchema);

export const GroupMemberModel =
  mongoose.models.GroupMember || mongoose.model<GroupMemberDoc>("GroupMember", GroupMemberSchema);
