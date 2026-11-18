/**
 * Speech-to-Text Provider
 *
 * Default cascade (STT_PROVIDER unset):
 *   1. AssemblyAI Universal-2  (primary, FREE-TIER credits only)
 *   2. Groq Whisper            (first fallback)
 *   3. Gemini                  (second fallback)
 * OpenAI Whisper and Google Speech-to-Text are still implemented but are only
 * used when explicitly pinned via STT_PROVIDER, since neither has a no-cost
 * tier and the default path must never incur charges.
 *
 * Kept behind a narrow interface (`transcribeAudio`) so providers can be
 * configured via env vars without touching calling code. Unconfigured
 * providers are skipped; failing providers fall through to the next one.
 */

export class SttNotConfiguredError extends Error {}
export class SttTranscriptionError extends Error {}
/** Provider deliberately skipped (e.g. AssemblyAI free credits exhausted). */
export class SttProviderUnavailableError extends SttTranscriptionError {}

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
async function providerFetch(
  providerName: string,
  url: string,
  init: RequestInit,
  timeoutMs: number = PROVIDER_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new SttTranscriptionError(`${providerName} request timed out (${Math.round(timeoutMs / 1000)}s)`);
    }
    throw new SttTranscriptionError(`${providerName} request failed: ${err?.message || err}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

function redactSecret(text: string, secret: string): string {
  if (!secret) return text;
  return text.split(secret).join("***");
}

// ---------------------------------------------------------------------------
// AssemblyAI Universal-2 (primary) — free-tier credits only
// ---------------------------------------------------------------------------
//
// Free-tier safety: a free AssemblyAI account (no card, no auto-pay) cannot
// be charged — when its credit balance runs out the API rejects requests.
// This code never touches billing. When AssemblyAI reports an exhausted
// balance (or rejects the key), the provider is switched off for the rest of
// this server process so we stop calling it and go straight to Groq/Gemini.
// Transcript submission is never retried, so one recording is billed at most
// once against the free credits.

const ASSEMBLYAI_BASE_URL = "https://api.assemblyai.com";
const ASSEMBLYAI_SPEECH_MODEL = "universal-2";
const ASSEMBLYAI_MAX_CONSECUTIVE_POLL_ERRORS = 3;
const ASSEMBLYAI_QUOTA_PATTERN = /balance|top ?up|insufficient|credit|payment|upgrade|billing|quota/i;

let assemblyAiDisabledReason: string | null = null;

/** Re-enables AssemblyAI after it was switched off (used by tests / ops scripts). */
export function resetAssemblyAiCircuitBreaker(): void {
  assemblyAiDisabledReason = null;
}

function disableAssemblyAi(reason: string): void {
  if (!assemblyAiDisabledReason) {
    console.warn(`[STT] Disabling AssemblyAI until server restart: ${reason}. Using Groq/Gemini fallbacks.`);
  }
  assemblyAiDisabledReason = reason;
}

function positiveIntEnv(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Inspects a non-OK AssemblyAI response; trips the breaker for quota/auth errors, then throws. */
async function throwAssemblyAiHttpError(stage: string, response: Response, apiKey: string): Promise<never> {
  const body = redactSecret(await response.text().catch(() => ""), apiKey).slice(0, 500);

  if (response.status === 402 || ((response.status === 400 || response.status === 403) && ASSEMBLYAI_QUOTA_PATTERN.test(body))) {
    disableAssemblyAi("free-tier credits exhausted / account balance unavailable");
    throw new SttProviderUnavailableError(
      `AssemblyAI free-tier credits exhausted (HTTP ${response.status} during ${stage}); falling back to other providers`
    );
  }
  if (response.status === 401) {
    disableAssemblyAi("API key rejected (HTTP 401)");
    throw new SttProviderUnavailableError("AssemblyAI rejected the API key (HTTP 401); check ASSEMBLYAI_API_KEY");
  }
  if (response.status === 429) {
    throw new SttTranscriptionError(`AssemblyAI rate limit exceeded during ${stage} (HTTP 429)`);
  }
  throw new SttTranscriptionError(`AssemblyAI ${stage} failed (HTTP ${response.status}): ${body}`);
}

async function transcribeWithAssemblyAI(audioBuffer: Buffer): Promise<TranscriptionResult> {
  const apiKey = process.env.ASSEMBLYAI_API_KEY?.trim();
  if (!apiKey || process.env.ASSEMBLYAI_ENABLED?.trim().toLowerCase() === "false") {
    throw new SttNotConfiguredError("ASSEMBLYAI_API_KEY is not configured");
  }
  if (assemblyAiDisabledReason) {
    throw new SttProviderUnavailableError(`AssemblyAI skipped: ${assemblyAiDisabledReason}`);
  }

  const maxWaitMs = positiveIntEnv("ASSEMBLYAI_MAX_WAIT_MS", 45000);
  const pollIntervalMs = positiveIntEnv("ASSEMBLYAI_POLL_INTERVAL_MS", 1500);
  const deadline = Date.now() + maxWaitMs;
  const remaining = () => Math.max(1000, deadline - Date.now());

  // 1. Upload raw audio bytes (m4a / mp4 / wav as recorded by the app).
  const uploadRes = await providerFetch(
    "AssemblyAI upload",
    `${ASSEMBLYAI_BASE_URL}/v2/upload`,
    {
      method: "POST",
      headers: { authorization: apiKey, "content-type": "application/octet-stream" },
      body: audioBuffer as any,
    },
    Math.min(PROVIDER_TIMEOUT_MS, remaining())
  );
  if (!uploadRes.ok) await throwAssemblyAiHttpError("upload", uploadRes, apiKey);
  const { upload_url: uploadUrl } = (await uploadRes.json()) as { upload_url?: string };
  if (!uploadUrl) throw new SttTranscriptionError("AssemblyAI upload returned no upload_url");

  // 2. Submit the transcription job (never retried — avoids double billing).
  const submitRes = await providerFetch(
    "AssemblyAI submit",
    `${ASSEMBLYAI_BASE_URL}/v2/transcript`,
    {
      method: "POST",
      headers: { authorization: apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        audio_url: uploadUrl,
        speech_models: [ASSEMBLYAI_SPEECH_MODEL],
        language_detection: true,
      }),
    },
    Math.min(PROVIDER_TIMEOUT_MS, remaining())
  );
  if (!submitRes.ok) await throwAssemblyAiHttpError("transcript submit", submitRes, apiKey);
  const submitted = (await submitRes.json()) as { id?: string };
  if (!submitted.id) throw new SttTranscriptionError("AssemblyAI submit returned no transcript id");

  // 3. Poll queued -> processing -> completed | error, bounded by maxWaitMs.
  let consecutiveErrors = 0;
  while (Date.now() < deadline) {
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));

    let pollRes: Response;
    try {
      pollRes = await providerFetch(
        "AssemblyAI poll",
        `${ASSEMBLYAI_BASE_URL}/v2/transcript/${encodeURIComponent(submitted.id)}`,
        { method: "GET", headers: { authorization: apiKey } },
        Math.min(15000, remaining())
      );
    } catch (err) {
      if (++consecutiveErrors >= ASSEMBLYAI_MAX_CONSECUTIVE_POLL_ERRORS) throw err;
      continue;
    }

    if (!pollRes.ok) {
      const transient = pollRes.status === 429 || pollRes.status >= 500;
      if (transient && ++consecutiveErrors < ASSEMBLYAI_MAX_CONSECUTIVE_POLL_ERRORS) continue;
      await throwAssemblyAiHttpError("status poll", pollRes, apiKey);
    }
    consecutiveErrors = 0;

    const t = (await pollRes.json()) as { status?: string; text?: string | null; error?: string; language_code?: string | null };
    if (t.status === "completed") {
      const transcript = (t.text || "").trim();
      if (!transcript) throw new SttTranscriptionError("AssemblyAI returned no transcript text");
      return { transcript, languageDetected: t.language_code || undefined };
    }
    if (t.status === "error") {
      const msg = redactSecret(t.error || "unknown error", apiKey);
      if (ASSEMBLYAI_QUOTA_PATTERN.test(msg)) {
        disableAssemblyAi("free-tier credits exhausted / account balance unavailable");
        throw new SttProviderUnavailableError(`AssemblyAI free-tier credits exhausted: ${msg}`);
      }
      throw new SttTranscriptionError(`AssemblyAI transcription failed: ${msg}`);
    }
    // "queued" | "processing": keep polling.
  }

  throw new SttTranscriptionError(`AssemblyAI transcription timed out after ${Math.round(maxWaitMs / 1000)}s`);
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
  const model = process.env.GEMINI_STT_MODEL?.trim() || "gemini-2.5-flash";
  const response = await providerFetch(
    "Gemini Audio STT",
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      // Key sent as a header (not a query param) so it never appears in URLs/logs.
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
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
    throw new SttTranscriptionError(
      `Gemini Audio STT failed (HTTP ${response.status}): ${redactSecret(body, apiKey).slice(0, 500)}`
    );
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
  if (preferred === "assemblyai") {
    return transcribeWithAssemblyAI(audioBuffer);
  }
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
    console.warn(`[STT] Unknown STT_PROVIDER "${preferred}"; using automatic provider cascade (AssemblyAI first).`);
  }

  // Automatic cascade: AssemblyAI (primary) -> Groq -> Gemini. Only free-tier
  // providers are in the default path; Whisper/Google require an explicit pin.
  const defaultOrder = [
    { provider: "assemblyai", fn: () => transcribeWithAssemblyAI(audioBuffer) },
    { provider: "groq", fn: () => transcribeWithGroq(audioBuffer, fileName, mimeType) },
    { provider: "gemini", fn: () => transcribeWithGemini(audioBuffer, mimeType) },
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
      if (!(err instanceof SttProviderUnavailableError) || !String(err.message).startsWith("AssemblyAI skipped")) {
        console.warn(`[STT] ${item.provider} failed, trying next provider: ${err?.message || err}`);
      }
      errors.push(`[${item.provider}] ${err?.message || err}`);
    }
  }

  if (errors.length === 0) {
    throw new SttNotConfiguredError(
      "No STT API keys configured on server. Set ASSEMBLYAI_API_KEY (primary), GROQ_API_KEY, or GEMINI_API_KEY."
    );
  }

  throw new SttTranscriptionError(`All transcription providers failed:\n${errors.join("\n")}`);
}
