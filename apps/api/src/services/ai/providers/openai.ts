import { AiNotConfiguredError, AiProvider, AiProviderError } from "../types";
import { getApiKey, models } from "../config";
import { httpError, providerFetch, readJson } from "../http";
import { chatJson, whisperTranscribe } from "./openai-compatible";

const BASE = "https://api.openai.com/v1";

function key(): string {
  const k = getApiKey("openai");
  if (!k) throw new AiNotConfiguredError("OPENAI_API_KEY is not configured");
  return k;
}

export const openAiProvider: AiProvider = {
  name: "openai",
  transcribe: (audio, timeoutMs) =>
    whisperTranscribe({ label: "OpenAI Whisper", url: `${BASE}/audio/transcriptions`, apiKey: key(), model: models.openaiTranscribe(), audio, timeoutMs }),
  completeJson: (req) =>
    chatJson({ label: "OpenAI", url: `${BASE}/chat/completions`, apiKey: key(), model: models.openaiChat(), req }),
  async receiptText(image, timeoutMs) {
    const apiKey = key();
    const label = "OpenAI Vision";
    const res = await providerFetch(label, `${BASE}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: models.openaiChat(),
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Extract all raw text from this receipt image. Output ONLY the extracted text." },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image.toString("base64")}` } },
            ],
          },
        ],
      }),
    }, timeoutMs);
    if (!res.ok) throw await httpError(label, res);
    const json = await readJson<any>(label, res);
    const text = json?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new AiProviderError("OpenAI Vision returned no text");
    return text;
  },
};
