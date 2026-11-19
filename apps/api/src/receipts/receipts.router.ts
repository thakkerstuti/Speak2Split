import { Router, Response } from "express";
import multer from "multer";
import { AuthedRequest, requireAuth } from "../auth/auth.router";
import { assertMembership } from "../groups/groups.router";
import { parseReceipt, AiInvalidInputError, AiNotConfiguredError, AiProviderError, redactSecrets } from "../services/ai";
import { saveFile } from "../documents/storage";

export const OCR_MESSAGES = {
  unavailable: "Receipt scanning isn't available right now. You can still add the expense by typing it.",
  failed: "Couldn't read that receipt. Try a clearer, well-lit photo — or type the expense instead.",
  error: "Something went wrong while scanning. Please try again.",
  review: "Some details may be incorrect. Please review before saving.",
};

export const receiptsRouter = Router();
receiptsRouter.use(requireAuth);

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_SIZE } });

const LOW_CONFIDENCE_THRESHOLD = 0.5;

/**
 * POST /receipts/scan — reads the receipt through the AI service layer and
 * returns an editable, validated draft. This endpoint NEVER creates an
 * expense: "needs_confirmation" (and low-confidence) results are flagged for
 * review, and nothing is saved until the user confirms in the app. The
 * receipt image itself is stored so it can be attached later.
 */
receiptsRouter.post("/scan", upload.single("image"), async (req: AuthedRequest, res: Response) => {
  const groupId = typeof req.body.groupId === "string" ? req.body.groupId : undefined;
  if (!groupId) return res.status(400).json({ error: "groupId is required" });

  const isMember = await assertMembership(groupId, req.userId!);
  if (!isMember) return res.status(403).json({ error: "Not a member of this group" });

  const file = (req as unknown as { file?: Express.Multer.File }).file;
  if (!file) return res.status(400).json({ error: "No image provided (expected multipart field 'image')" });

  let result;
  try {
    result = await parseReceipt(file.buffer);
  } catch (err: any) {
    // Provider details (already redacted) go to server logs only — the app
    // only ever receives a generic, user-friendly message.
    // eslint-disable-next-line no-console
    console.warn("[receipts] OCR failed:", redactSecrets(String(err?.message ?? err)));
    if (err instanceof AiNotConfiguredError) return res.status(503).json({ error: OCR_MESSAGES.unavailable, code: "OCR_UNAVAILABLE" });
    if (err instanceof AiProviderError || err instanceof AiInvalidInputError) {
      return res.status(422).json({ error: OCR_MESSAGES.failed, code: "OCR_FAILED" });
    }
    return res.status(500).json({ error: OCR_MESSAGES.error, code: "OCR_ERROR" });
  }

  const stored = await saveFile(file.buffer, file.originalname || "receipt.jpg");
  const needsReview = result.status === "needs_confirmation" || result.data.confidence < LOW_CONFIDENCE_THRESHOLD;

  return res.json({
    ...result.data,
    status: result.status,
    issues: result.issues,
    provider: result.provider,
    receiptStorageKey: stored.storageKey,
    needsReview,
    reviewMessage: needsReview ? OCR_MESSAGES.review : null,
  });
});
