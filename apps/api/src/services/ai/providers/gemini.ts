import { AiNotConfiguredError, AiProvider, AiProviderError } from "../types";
import { getApiKey, models } from "../config";
import { httpError, providerFetch, readJson } from "../http";

const endpoint = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

function key(): string {
  const k = getApiKey("gemini");
  if (!k) throw new AiNotConfiguredError("GEMINI_API_KEY is not configured");
  return k;
}

/** One generateContent call. The key travels in a header, never in the URL. */
async function generate(label: string, model: string, parts: unknown[], timeoutMs: number, jsonMode = false): Promise<string> {
  const res = await providerFetch(label, endpoint(model), {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key() },
    body: JSON.stringify({
      contents: [{ parts }],
      ...(jsonMode ? { generationConfig: { responseMimeType: "application/json" } } : {}),
    }),
  }, timeoutMs);
  if (!res.ok) throw await httpError(label, res);
  const json = await readJson<any>(label, res);
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string" || !text.trim()) throw new AiProviderError(`${label} returned no text`);
  return text.trim();
}

export const geminiProvider: AiProvider = {
  name: "gemini",
  async transcribe(audio, timeoutMs) {
    const transcript = await generate(
      "Gemini Audio STT",
      models.geminiTranscribe(),
      [
        { text: "Transcribe this spoken audio verbatim into plain text. Output ONLY the raw spoken transcript text, with no preamble, formatting, or quotes." },
        { inline_data: { mime_type: audio.mimeType || "audio/m4a", data: audio.buffer.toString("base64") } },
      ],
      timeoutMs
    );
    return { transcript };
  },
  completeJson: (req) =>
    generate("Gemini", models.gemini(), [{ text: `${req.system}\n\nUser input: ${req.user}` }], req.timeoutMs, true),
  receiptText: (image, timeoutMs) =>
    generate(
      "Gemini Vision",
      models.gemini(),
      [
        { text: "Extract all raw readable text from this receipt image verbatim. Include store name, date, items, subtotal, tax, and total amount. Output ONLY the raw extracted text." },
        { inline_data: { mime_type: "image/jpeg", data: image.toString("base64") } },
      ],
      timeoutMs
    ),
};
