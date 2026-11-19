import { AiProviderError } from "./types";
import { allConfiguredSecrets } from "./config";

/** Key-shaped strings (Google, OpenAI/DeepSeek, Groq, Anthropic) scrubbed even if not configured here. */
const KEY_PATTERNS = [/AIza[0-9A-Za-z_-]{20,}/g, /sk-[A-Za-z0-9_-]{8,}/g, /gsk_[A-Za-z0-9_-]{8,}/g];

/** Removes every configured AI key (plus `extra` and key-shaped strings) from text. */
export function redactSecrets(text: string, extra: (string | undefined)[] = []): string {
  let out = String(text ?? "");
  for (const s of [...allConfiguredSecrets(), ...extra]) {
    if (s && s.length >= 6) out = out.split(s).join("***");
  }
  for (const p of KEY_PATTERNS) out = out.replace(p, "***");
  return out;
}

/**
 * fetch() with a timeout. Network failures and timeouts become
 * AiProviderError (redacted) so the caller can move on to the fallback.
 */
export async function providerFetch(label: string, url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err: any) {
    if (err?.name === "AbortError" || err?.name === "TimeoutError") {
      throw new AiProviderError(`${label} request timed out (${Math.round(timeoutMs / 1000)}s)`);
    }
    throw new AiProviderError(`${label} request failed: ${redactSecrets(String(err?.message ?? err))}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Builds a redacted error for a non-OK provider response. */
export async function httpError(label: string, response: Response): Promise<AiProviderError> {
  if (response.status === 429) {
    return new AiProviderError(`${label} rate limit exceeded (HTTP 429). Please try again in a moment.`);
  }
  const body = await response.text().catch(() => "");
  return new AiProviderError(`${label} failed (HTTP ${response.status}): ${redactSecrets(body).slice(0, 500)}`);
}

/** Parses a provider's JSON response body, turning malformed bodies into provider errors. */
export async function readJson<T = any>(label: string, response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new AiProviderError(`${label} returned a response that isn't JSON`);
  }
}
