/** Google Cloud Vision (receipt OCR) and Google Cloud Speech-to-Text. Keys go in the x-goog-api-key header. */
import { AiNotConfiguredError, AiProvider, AiProviderError } from "../types";
import { getApiKey } from "../config";
import { httpError, providerFetch, readJson, redactSecrets } from "../http";

export const googleVisionProvider: AiProvider = {
  name: "google_vision",
  async receiptText(image, timeoutMs) {
    const apiKey = getApiKey("google_vision");
    if (!apiKey) throw new AiNotConfiguredError("GOOGLE_VISION_API_KEY is not configured");
    const label = "Google Vision";
    const res = await providerFetch(label, "https://vision.googleapis.com/v1/images:annotate", {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        requests: [{ image: { content: image.toString("base64") }, features: [{ type: "TEXT_DETECTION" }] }],
      }),
    }, timeoutMs);
    if (!res.ok) throw await httpError(label, res);
    const json = await readJson<{ responses?: { fullTextAnnotation?: { text: string }; error?: { message: string } }[] }>(label, res);
    const first = json.responses?.[0];
    if (first?.error) throw new AiProviderError(`Google Vision error: ${redactSecrets(first.error.message)}`);
    const text = first?.fullTextAnnotation?.text;
    if (!text) throw new AiProviderError("Google Vision returned no text");
    return text;
  },
};

export const googleSpeechProvider: AiProvider = {
  name: "google_speech",
  async transcribe(audio, timeoutMs) {
    const apiKey = getApiKey("google_speech");
    if (!apiKey) throw new AiNotConfiguredError("GOOGLE_SPEECH_API_KEY is not configured");
    const label = "Google Speech-to-Text";
    const res = await providerFetch(label, "https://speech.googleapis.com/v1/speech:recognize", {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        config: { encoding: "LINEAR16", languageCode: "en-IN", enableAutomaticPunctuation: true },
        audio: { content: audio.buffer.toString("base64") },
      }),
    }, timeoutMs);
    if (!res.ok) throw await httpError(label, res);
    const json = await readJson<{ results?: { alternatives: { transcript: string }[] }[] }>(label, res);
    const transcript = json.results?.map((r) => r.alternatives[0]?.transcript).join(" ").trim();
    if (!transcript) throw new AiProviderError("Google Speech-to-Text returned no transcript");
    return { transcript };
  },
};
