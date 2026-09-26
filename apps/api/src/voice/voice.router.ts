import { Router, Response } from "express";
import multer from "multer";
import { AuthedRequest, requireAuth } from "../auth/auth.router";
import { transcribeAudio, SttNotConfiguredError, SttTranscriptionError } from "./speech-to-text";

export const voiceRouter = Router();
voiceRouter.use(requireAuth);

const MAX_AUDIO_SIZE = 25 * 1024 * 1024; // 25MB — matches Whisper's own limit
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_AUDIO_SIZE } });

/**
 * POST /voice/transcribe — real speech-to-text only. Deliberately returns
 * JUST the transcript; it does NOT run the NLP parser or name resolution
 * itself. The mobile client takes the returned transcript and calls the
 * existing, already-tested POST /expenses/parse with it — the exact same
 * code path used for typed text — so voice and text entry share one
 * pipeline end to end rather than duplicating parsing/resolution logic.
 */
voiceRouter.post("/transcribe", upload.single("audio"), async (req: AuthedRequest, res: Response) => {
  const file = (req as unknown as { file?: Express.Multer.File }).file;
  if (!file) return res.status(400).json({ error: "No audio file provided (expected multipart field 'audio')" });

  try {
    const result = await transcribeAudio(file.buffer, file.originalname || "recording.m4a", file.mimetype);
    return res.json(result);
  } catch (err: any) {
    if (err instanceof SttNotConfiguredError) {
      return res.status(503).json({ error: err.message });
    }
    if (err instanceof SttTranscriptionError) {
      return res.status(422).json({ error: err.message });
    }
    return res.status(500).json({ error: err?.message || "Transcription failed" });
  }
});
