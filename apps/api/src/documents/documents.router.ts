import { Router, Response } from "express";
import multer from "multer";
import { DocumentModel } from "../db/models/Document";
import { UserModel } from "../db/models/User";
import { AuthedRequest, requireAuth } from "../auth/auth.router";
import { assertMembership } from "../groups/groups.router";
import { saveFile, readFile, deleteFile } from "./storage";

export const documentsRouter = Router();
documentsRouter.use(requireAuth);

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_SIZE } });

/** POST /documents/group/:groupId — upload a file, associated with the group. */
documentsRouter.post("/group/:groupId", upload.single("file"), async (req: AuthedRequest, res: Response) => {
  const isMember = await assertMembership(req.params.groupId, req.userId!);
  if (!isMember) return res.status(403).json({ error: "Not a member of this group" });

  const file = (req as unknown as { file?: Express.Multer.File }).file;
  if (!file) return res.status(400).json({ error: "No file provided (expected multipart field 'file')" });

  const category = typeof req.body.category === "string" ? req.body.category : undefined;

  const stored = await saveFile(file.buffer, file.originalname);
  const doc = await DocumentModel.create({
    groupId: req.params.groupId,
    uploadedById: req.userId,
    fileName: file.originalname,
    filePath: stored.storageKey,
    mimeType: file.mimetype,
    sizeBytes: stored.sizeBytes,
    category,
  });

  return res.status(201).json(doc.toJSON());
});

documentsRouter.get("/group/:groupId", async (req: AuthedRequest, res: Response) => {
  const isMember = await assertMembership(req.params.groupId, req.userId!);
  if (!isMember) return res.status(403).json({ error: "Not a member of this group" });

  const docs = await DocumentModel.find({ groupId: req.params.groupId, deletedAt: { $exists: false } })
    .sort({ createdAt: -1 })
    .lean();
  const users = await UserModel.find({ _id: { $in: docs.map((d) => d.uploadedById) } }).lean();
  const nameById = new Map(users.map((u) => [String(u._id), u.displayName]));

  return res.json(
    docs.map((d) => ({ ...d, id: String(d._id), _id: undefined, uploadedByName: nameById.get(String(d.uploadedById)) }))
  );
});

documentsRouter.get("/:id/download", async (req: AuthedRequest, res: Response) => {
  const doc = await DocumentModel.findOne({ _id: req.params.id, deletedAt: { $exists: false } });
  if (!doc) return res.status(404).json({ error: "Document not found" });

  const isMember = await assertMembership(String(doc.groupId), req.userId!);
  if (!isMember) return res.status(403).json({ error: "Not authorized to access this document" });

  const buffer = await readFile(doc.filePath);
  res.setHeader("Content-Type", doc.mimeType);
  res.setHeader("Content-Disposition", `attachment; filename="${doc.fileName}"`);
  return res.send(buffer);
});

documentsRouter.delete("/:id", async (req: AuthedRequest, res: Response) => {
  const doc = await DocumentModel.findOne({ _id: req.params.id, deletedAt: { $exists: false } });
  if (!doc) return res.status(404).json({ error: "Document not found" });

  const isMember = await assertMembership(String(doc.groupId), req.userId!);
  if (!isMember) return res.status(403).json({ error: "Not authorized to delete this document" });

  if (String(doc.uploadedById) !== req.userId) {
    return res.status(403).json({ error: "Only the person who uploaded this document can delete it" });
  }

  doc.deletedAt = new Date();
  await doc.save();
  await deleteFile(doc.filePath);
  return res.json({ ok: true });
});
