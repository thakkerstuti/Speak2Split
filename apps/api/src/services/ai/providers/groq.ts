import { AiNotConfiguredError, AiProvider } from "../types";
import { getApiKey, models } from "../config";
import { chatJson, whisperTranscribe } from "./openai-compatible";

const BASE = "https://api.groq.com/openai/v1";

function key(): string {
  const k = getApiKey("groq");
  if (!k) throw new AiNotConfiguredError("GROQ_API_KEY is not configured");
  return k;
}

export const groqProvider: AiProvider = {
  name: "groq",
  transcribe: (audio, timeoutMs) =>
    whisperTranscribe({ label: "Groq Whisper", url: `${BASE}/audio/transcriptions`, apiKey: key(), model: models.groqTranscribe(), audio, timeoutMs }),
  completeJson: (req) =>
    chatJson({ label: "Groq", url: `${BASE}/chat/completions`, apiKey: key(), model: models.groqChat(), req }),
};
