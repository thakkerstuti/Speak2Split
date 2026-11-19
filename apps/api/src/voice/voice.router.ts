import { Router, Response } from "express";
import multer from "multer";
import { AuthedRequest, requireAuth } from "../auth/auth.router";
import { transcribe, AiInvalidInputError, AiNotConfiguredError, AiProviderError, redactSecrets } from "../services/ai";

export const voiceRouter = Router();
voiceRouter.use(requireAuth);

const MAX_AUDIO_SIZE = 25 * 1024 * 1024; // 25MB — matches Whisper's own limit
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_AUDIO_SIZE } });

export const STT_MESSAGES = {
  unavailable: "Voice input isn't available right now. You can type the expense instead.",
  failed: "Couldn't transcribe that. Please try again, or type the expense.",
  empty: "The recording was empty. Please try again.",
};

/**
 * POST /voice/transcribe — speech-to-text only, via the AI service layer.
 * Deliberately returns JUST the transcript; the client sends it to
 * POST /expenses/parse, the same pipeline typed text uses.
 */
voiceRouter.post("/transcribe", upload.single("audio"), async (req: AuthedRequest, res: Response) => {
  const file = (req as unknown as { file?: Express.Multer.File }).file;
  if (!file) return res.status(400).json({ error: "No audio file provided (expected multipart field 'audio')" });

  try {
    const result = await transcribe({
      buffer: file.buffer,
      fileName: file.originalname || "recording.m4a",
      mimeType: file.mimetype,
    });
    return res.json(result);
  } catch (err: any) {
    // Provider details (already redacted) go to server logs only.
    // eslint-disable-next-line no-console
    console.warn("[voice] transcription failed:", redactSecrets(String(err?.message ?? err)));
    if (err instanceof AiInvalidInputError) return res.status(422).json({ error: STT_MESSAGES.empty, code: "EMPTY_AUDIO" });
    if (err instanceof AiNotConfiguredError) return res.status(503).json({ error: STT_MESSAGES.unavailable, code: "STT_UNAVAILABLE" });
    if (err instanceof AiProviderError) return res.status(422).json({ error: STT_MESSAGES.failed, code: "STT_FAILED" });
    throw err;
  }
});
