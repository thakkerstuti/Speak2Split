import mongoose, { Schema, Document, Types } from "mongoose";
import { applyStandardJson } from "./plugin";

export interface AuthAccountSubdoc {
  provider: "GOOGLE" | "APPLE";
  providerUserId: string;
  createdAt: Date;
}

export interface UserDoc extends Document {
  _id: Types.ObjectId;
  email: string;
  passwordHash?: string;
  displayName: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  normalizedPhone?: string;
  avatarUrl?: string;
  defaultCurrency: string;
  isActive: boolean;
  authAccounts: AuthAccountSubdoc[];
  createdAt: Date;
  updatedAt: Date;
}

const AuthAccountSchema = new Schema<AuthAccountSubdoc>(
  {
    provider: { type: String, enum: ["GOOGLE", "APPLE"], required: true },
    providerUserId: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const UserSchema = new Schema<UserDoc>({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String },
  displayName: { type: String, required: true },
  firstName: { type: String },
  lastName: { type: String },
  phone: { type: String },
  normalizedPhone: { type: String },
  avatarUrl: { type: String },
  defaultCurrency: { type: String, default: "INR" },
  isActive: { type: Boolean, default: true },
  authAccounts: { type: [AuthAccountSchema], default: [] },
});

UserSchema.index({ "authAccounts.provider": 1, "authAccounts.providerUserId": 1 }, { unique: true, sparse: true });

applyStandardJson(UserSchema);

export const UserModel = mongoose.models.User || mongoose.model<UserDoc>("User", UserSchema);
