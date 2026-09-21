import mongoose, { Schema, Document as MongoDocument, Types } from "mongoose";
import { applyStandardJson } from "./plugin";

export interface DocumentDoc extends MongoDocument {
  _id: Types.ObjectId;
  groupId: Types.ObjectId;
  uploadedById: Types.ObjectId;
  fileName: string;
  filePath: string;
  mimeType: string;
  sizeBytes: number;
  category?: string;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const DocumentSchema = new Schema<DocumentDoc>({
  groupId: { type: Schema.Types.ObjectId, ref: "Group", required: true, index: true },
  uploadedById: { type: Schema.Types.ObjectId, ref: "User", required: true },
  fileName: { type: String, required: true },
  filePath: { type: String, required: true },
  mimeType: { type: String, required: true },
  sizeBytes: { type: Number, required: true },
  category: { type: String },
  deletedAt: { type: Date },
});

applyStandardJson(DocumentSchema);

export const DocumentModel =
  mongoose.models.Document || mongoose.model<DocumentDoc>("Document", DocumentSchema);
