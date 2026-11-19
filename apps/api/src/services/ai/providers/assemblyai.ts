/**
 * AssemblyAI Universal-2 (speech-to-text) — FREE-TIER credits only.
 *
 * A free AssemblyAI account (no card, no auto-pay) cannot be charged: when its
 * credit balance runs out the API rejects requests. This module never touches
 * billing. When AssemblyAI reports an exhausted balance (or rejects the key)
 * it is switched off for the rest of the server process, so we stop calling it
 * and the transcribe chain goes straight to its fallbacks. Transcript
 * submission is never retried, so one recording is billed at most once.
 */
import { AiProvider, AiNotConfiguredError, AiProviderError, AiProviderUnavailableError, AudioInput, TranscriptionResult } from "../types";
import { getApiKey, positiveIntEnv, warnOnce } from "../config";
import { providerFetch, redactSecrets } from "../http";

const BASE_URL = "https://api.assemblyai.com";
const SPEECH_MODEL = "universal-2";
const MAX_CONSECUTIVE_POLL_ERRORS = 3;
const QUOTA_PATTERN = /balance|top ?up|insufficient|credit|payment|upgrade|billing|quota/i;

let disabledReason: string | null = null;

/** Re-enables AssemblyAI after it was switched off (tests / ops scripts). */
export function resetAssemblyAiCircuitBreaker(): void {
  disabledReason = null;
}

function disable(reason: string): void {
  if (!disabledReason) warnOnce(`Disabling AssemblyAI until server restart: ${reason}. Using fallback providers.`);
  disabledReason = reason;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Inspects a non-OK response; trips the breaker for quota/auth errors, then throws. */
async function throwHttpError(stage: string, response: Response): Promise<never> {
  const body = redactSecrets(await response.text().catch(() => "")).slice(0, 500);
  if (response.status === 402 || ((response.status === 400 || response.status === 403) && QUOTA_PATTERN.test(body))) {
    disable("free-tier credits exhausted / account balance unavailable");
    throw new AiProviderUnavailableError(
      `AssemblyAI free-tier credits exhausted (HTTP ${response.status} during ${stage}); falling back to other providers`
    );
  }
  if (response.status === 401) {
    disable("API key rejected (HTTP 401)");
    throw new AiProviderUnavailableError("AssemblyAI rejected the API key (HTTP 401); check ASSEMBLYAI_API_KEY");
  }
  if (response.status === 429) {
    throw new AiProviderError(`AssemblyAI rate limit exceeded during ${stage} (HTTP 429)`);
  }
  throw new AiProviderError(`AssemblyAI ${stage} failed (HTTP ${response.status}): ${body}`);
}

async function transcribe(audio: AudioInput, requestTimeoutMs: number): Promise<TranscriptionResult> {
  const apiKey = getApiKey("assemblyai");
  if (!apiKey) throw new AiNotConfiguredError("ASSEMBLYAI_API_KEY is not configured");
  if (disabledReason) throw new AiProviderUnavailableError(`AssemblyAI skipped: ${disabledReason}`);

  const maxWaitMs = positiveIntEnv("ASSEMBLYAI_MAX_WAIT_MS", 45000);
  const pollIntervalMs = positiveIntEnv("ASSEMBLYAI_POLL_INTERVAL_MS", 1500);
  const deadline = Date.now() + maxWaitMs;
  const remaining = () => Math.max(1000, deadline - Date.now());

  // 1. Upload raw audio bytes (m4a / mp4 / wav as recorded by the app).
  const uploadRes = await providerFetch(
    "AssemblyAI upload",
    `${BASE_URL}/v2/upload`,
    {
      method: "POST",
      headers: { authorization: apiKey, "content-type": "application/octet-stream" },
      body: audio.buffer as any,
    },
    Math.min(requestTimeoutMs, remaining())
  );
  if (!uploadRes.ok) await throwHttpError("upload", uploadRes);
  const { upload_url: uploadUrl } = (await uploadRes.json()) as { upload_url?: string };
  if (!uploadUrl) throw new AiProviderError("AssemblyAI upload returned no upload_url");

  // 2. Submit the transcription job (never retried — avoids double billing).
  const submitRes = await providerFetch(
    "AssemblyAI submit",
    `${BASE_URL}/v2/transcript`,
    {
      method: "POST",
      headers: { authorization: apiKey, "content-type": "application/json" },
      body: JSON.stringify({ audio_url: uploadUrl, speech_models: [SPEECH_MODEL], language_detection: true }),
    },
    Math.min(requestTimeoutMs, remaining())
  );
  if (!submitRes.ok) await throwHttpError("transcript submit", submitRes);
  const submitted = (await submitRes.json()) as { id?: string };
  if (!submitted.id) throw new AiProviderError("AssemblyAI submit returned no transcript id");

  // 3. Poll queued -> processing -> completed | error, bounded by maxWaitMs.
  let consecutiveErrors = 0;
  while (Date.now() < deadline) {
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));

    let pollRes: Response;
    try {
      pollRes = await providerFetch(
        "AssemblyAI poll",
        `${BASE_URL}/v2/transcript/${encodeURIComponent(submitted.id)}`,
        { method: "GET", headers: { authorization: apiKey } },
        Math.min(15000, remaining())
      );
    } catch (err) {
      if (++consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS) throw err;
      continue;
    }

    if (!pollRes.ok) {
      const transient = pollRes.status === 429 || pollRes.status >= 500;
      if (transient && ++consecutiveErrors < MAX_CONSECUTIVE_POLL_ERRORS) continue;
      await throwHttpError("status poll", pollRes);
    }
    consecutiveErrors = 0;

    const t = (await pollRes.json()) as { status?: string; text?: string | null; error?: string; language_code?: string | null };
    if (t.status === "completed") {
      const transcript = (t.text || "").trim();
      if (!transcript) throw new AiProviderError("AssemblyAI returned no transcript text");
      return { transcript, languageDetected: t.language_code || undefined };
    }
    if (t.status === "error") {
      const msg = redactSecrets(t.error || "unknown error");
      if (QUOTA_PATTERN.test(msg)) {
        disable("free-tier credits exhausted / account balance unavailable");
        throw new AiProviderUnavailableError(`AssemblyAI free-tier credits exhausted: ${msg}`);
      }
      throw new AiProviderError(`AssemblyAI transcription failed: ${msg}`);
    }
    // "queued" | "processing": keep polling.
  }

  throw new AiProviderError(`AssemblyAI transcription timed out after ${Math.round(maxWaitMs / 1000)}s`);
}

export const assemblyAiProvider: AiProvider = { name: "assemblyai", transcribe };
