/**
 * Speech-to-Text Provider
 *
 * Real integration with Speech-to-Text APIs: Groq Whisper (primary), Gemini,
 * OpenAI Whisper, and Google Speech-to-Text (fallbacks). Kept behind a narrow interface
 * (`transcribeAudio`) so providers can be configured via STT_PROVIDER env var
 * without touching calling code. If the configured provider's credential is
 * missing, this throws a specific, clear error.
 */

export class SttNotConfiguredError extends Error {}
export class SttTranscriptionError extends Error {}

export interface TranscriptionResult {
  transcript: string;
  languageDetected?: string;
}

const PROVIDER_TIMEOUT_MS = 30000;

/**
 * fetch() wrapper used by every provider: enforces a timeout and converts
 * network-level failures (DNS, connection reset, abort) into a
 * SttTranscriptionError so the fallback cascade can move on to the next
 * provider and the router can return a clean 422 instead of a 500.
 */
async function providerFetch(providerName: string, url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new SttTranscriptionError(`${providerName} request timed out (${PROVIDER_TIMEOUT_MS / 1000}s)`);
    }
    throw new SttTranscriptionError(`${providerName} request failed: ${err?.message || err}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function transcribeWithGroq(audioBuffer: Buffer, fileName: string, mimeType: string): Promise<TranscriptionResult> {
  const apiKey = process.env.GROQ_API_KEY || process.env.GROQ_KEY;
  if (!apiKey) {
    throw new SttNotConfiguredError("GROQ_API_KEY is not configured");
  }

  const formData = new FormData();
  formData.append("file", new Blob([audioBuffer], { type: mimeType || "audio/m4a" }), fileName || "recording.m4a");
  formData.append("model", "whisper-large-v3-turbo");

  const response = await providerFetch("Groq Whisper", "https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}` },
    body: formData as any,
  });

  if (!response.ok) {
    const body = await response.text();
    if (response.status === 429) {
      throw new SttTranscriptionError("Groq Whisper rate limit exceeded (HTTP 429). Please try again in a moment.");
    }
    const safeBody = body.replace(/gsk_[A-Za-z0-9_-]+/g, "gsk_***");
    throw new SttTranscriptionError(`Groq Whisper transcription failed (HTTP ${response.status}): ${safeBody}`);
  }

  const json = (await response.json()) as { text?: string; language?: string };
  if (!json.text) {
    throw new SttTranscriptionError("Groq Whisper returned no transcript text");
  }

  return { transcript: json.text, languageDetected: json.language };
}

async function transcribeWithGemini(audioBuffer: Buffer, mimeType: string): Promise<TranscriptionResult> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new SttNotConfiguredError("GEMINI_API_KEY is not configured");
  }

  const safeMime = mimeType || "audio/m4a";
  const response = await providerFetch(
    "Gemini Audio STT",
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: "Transcribe this spoken audio verbatim into plain text. Output ONLY the raw spoken transcript text, with no preamble, formatting, or quotes.",
              },
              {
                inline_data: {
                  mime_type: safeMime,
                  data: audioBuffer.toString("base64"),
                },
              },
            ],
          },
        ],
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    if (response.status === 429) {
      throw new SttTranscriptionError("Gemini Audio STT rate limit exceeded (HTTP 429).");
    }
    throw new SttTranscriptionError(`Gemini Audio STT failed (HTTP ${response.status}): ${body}`);
  }

  const json = (await response.json()) as any;
  const transcript = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!transcript) {
    throw new SttTranscriptionError("Gemini returned no transcript text for audio");
  }

  return { transcript };
}

async function transcribeWithWhisper(audioBuffer: Buffer, fileName: string, mimeType: string): Promise<TranscriptionResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new SttNotConfiguredError("OPENAI_API_KEY is not configured");
  }

  const formData = new FormData();
  formData.append("file", new Blob([audioBuffer], { type: mimeType || "audio/m4a" }), fileName || "recording.m4a");
  formData.append("model", "whisper-1");

  const response = await providerFetch("OpenAI Whisper", "https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}` },
    body: formData as any,
  });

  if (!response.ok) {
    const body = await response.text();
    if (response.status === 429) {
      throw new SttTranscriptionError("OpenAI Whisper rate limit exceeded (HTTP 429).");
    }
    const safeBody = body.replace(/sk-[A-Za-z0-9_-]+/g, "sk-***");
    throw new SttTranscriptionError(`Whisper transcription failed (HTTP ${response.status}): ${safeBody}`);
  }

  const json = (await response.json()) as { text?: string; language?: string };
  if (!json.text) {
    throw new SttTranscriptionError("Whisper returned no transcript text");
  }

  return { transcript: json.text, languageDetected: json.language };
}

async function transcribeWithGoogleSpeech(audioBuffer: Buffer): Promise<TranscriptionResult> {
  const apiKey = process.env.GOOGLE_SPEECH_API_KEY || process.env.GOOGLE_VISION_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new SttNotConfiguredError("GOOGLE_SPEECH_API_KEY is not configured");
  }

  const response = await providerFetch("Google Speech-to-Text", `https://speech.googleapis.com/v1/speech:recognize?key=${apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      config: { encoding: "LINEAR16", languageCode: "en-IN", enableAutomaticPunctuation: true },
      audio: { content: audioBuffer.toString("base64") },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new SttTranscriptionError(`Google Speech-to-Text failed (HTTP ${response.status}): ${body}`);
  }

  const json = (await response.json()) as { results?: { alternatives: { transcript: string }[] }[] };
  const transcript = json.results?.map((r) => r.alternatives[0]?.transcript).join(" ").trim();
  if (!transcript) {
    throw new SttTranscriptionError("Google Speech-to-Text returned no transcript");
  }

  return { transcript };
}

export async function transcribeAudio(
  audioBuffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<TranscriptionResult> {
  if (!audioBuffer || audioBuffer.length === 0) {
    throw new SttTranscriptionError("Audio file is empty");
  }

  const preferred = process.env.STT_PROVIDER?.trim().toLowerCase();

  // Explicit provider selection: call requested provider directly without fallback
  if (preferred === "groq") {
    return transcribeWithGroq(audioBuffer, fileName, mimeType);
  }
  if (preferred === "whisper" || preferred === "openai") {
    return transcribeWithWhisper(audioBuffer, fileName, mimeType);
  }
  if (preferred === "gemini") {
    return transcribeWithGemini(audioBuffer, mimeType);
  }
  if (preferred === "google") {
    return transcribeWithGoogleSpeech(audioBuffer);
  }
  if (preferred) {
    console.warn(`[STT] Unknown STT_PROVIDER "${preferred}"; using automatic provider cascade (Groq first).`);
  }

  // Automatic cascade: Groq is primary, the rest are fallbacks in order.
  const defaultOrder = [
    { provider: "groq", fn: () => transcribeWithGroq(audioBuffer, fileName, mimeType) },
    { provider: "gemini", fn: () => transcribeWithGemini(audioBuffer, mimeType) },
    { provider: "whisper", fn: () => transcribeWithWhisper(audioBuffer, fileName, mimeType) },
    { provider: "google", fn: () => transcribeWithGoogleSpeech(audioBuffer) },
  ];

  const errors: string[] = [];
  for (const item of defaultOrder) {
    try {
      return await item.fn();
    } catch (err: any) {
      if (err instanceof SttNotConfiguredError) {
        // Skip unconfigured providers silently
        continue;
      }
      console.warn(`[STT] ${item.provider} failed, trying next provider: ${err?.message || err}`);
      errors.push(`[${item.provider}] ${err?.message || err}`);
    }
  }

  if (errors.length === 0) {
    throw new SttNotConfiguredError(
      "No STT API keys configured on server. Set GROQ_API_KEY (primary), or GEMINI_API_KEY, OPENAI_API_KEY, or GOOGLE_SPEECH_API_KEY."
    );
  }

  throw new SttTranscriptionError(`All transcription providers failed:\n${errors.join("\n")}`);
}
