import { Router, Response } from "express";
import multer from "multer";
import { AuthedRequest, requireAuth } from "../auth/auth.router";
import { assertMembership } from "../groups/groups.router";
import { runOcr, OcrNotConfiguredError, OcrError } from "./ocr";
import { extractReceiptFields } from "@speak2split/shared";
import { saveFile } from "../documents/storage";

export const receiptsRouter = Router();
receiptsRouter.use(requireAuth);

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_SIZE } });

const LOW_CONFIDENCE_THRESHOLD = 0.5;

/**
 * POST /receipts/scan — runs real OCR, then the tested field-extraction
 * heuristic, and returns an editable draft. This endpoint NEVER creates an
 * expense — per the spec, an uncertain AI interpretation must always go
 * through user confirmation first. The receipt image itself is saved to
 * storage regardless of extraction quality, so it can be attached to
 * whatever expense the user eventually confirms.
 */
receiptsRouter.post("/scan", upload.single("image"), async (req: AuthedRequest, res: Response) => {
  const groupId = typeof req.body.groupId === "string" ? req.body.groupId : undefined;
  if (!groupId) return res.status(400).json({ error: "groupId is required" });

  const isMember = await assertMembership(groupId, req.userId!);
  if (!isMember) return res.status(403).json({ error: "Not a member of this group" });

  const file = (req as unknown as { file?: Express.Multer.File }).file;
  if (!file) return res.status(400).json({ error: "No image provided (expected multipart field 'image')" });

  let rawText: string;
  try {
    rawText = await runOcr(file.buffer);
  } catch (err) {
    if (err instanceof OcrNotConfiguredError) {
      return res.status(503).json({ error: err.message });
    }
    if (err instanceof OcrError) {
      return res.status(422).json({ error: err.message });
    }
    throw err;
  }

  const extraction = extractReceiptFields(rawText);
  const stored = await saveFile(file.buffer, file.originalname || "receipt.jpg");

  return res.json({
    ...extraction,
    receiptStorageKey: stored.storageKey,
    needsReview: extraction.confidence < LOW_CONFIDENCE_THRESHOLD,
    reviewMessage:
      extraction.confidence < LOW_CONFIDENCE_THRESHOLD
        ? "Some details may be incorrect. Please review before saving."
        : null,
  });
});
