/**
 * AI configuration: which provider serves each function, fallbacks, models,
 * timeouts and API keys — all from server env vars, read on every call so
 * changes (and tests) take effect without a restart.
 *
 * New variables (old names still work for one release, with a deprecation warning):
 *   AI_TRANSCRIBE_PROVIDER / AI_TRANSCRIBE_FALLBACK   (was STT_PROVIDER)
 *   AI_PARSE_PROVIDER      / AI_PARSE_FALLBACK
 *   AI_RECEIPT_PROVIDER    / AI_RECEIPT_FALLBACK      (was OCR_PROVIDER)
 *   AI_GEMINI_MODEL                                   (was GEMINI_MODEL)
 *   AI_GEMINI_TRANSCRIBE_MODEL                        (was GEMINI_STT_MODEL)
 *   AI_TRANSCRIBE_TIMEOUT_MS, AI_PARSE_TIMEOUT_MS, AI_RECEIPT_TIMEOUT_MS
 * Fallbacks are comma-separated lists, tried in order; an empty value means
 * "no fallback". Providers without an API key are skipped.
 */
import { AiFunction, ProviderName } from "./types";

export const PROVIDERS: ProviderName[] = [
  "assemblyai",
  "groq",
  "gemini",
  "openai",
  "deepseek",
  "google_vision",
  "google_speech",
];

/** Which provider can serve which function. Anything else is rejected. */
export const CAPABILITIES: Record<ProviderName, AiFunction[]> = {
  assemblyai: ["transcribe"],
  groq: ["transcribe", "parseExpense"],
  gemini: ["transcribe", "parseExpense", "parseReceipt"],
  openai: ["transcribe", "parseExpense", "parseReceipt"],
  deepseek: ["parseExpense"],
  google_vision: ["parseReceipt"],
  google_speech: ["transcribe"],
};

/** Defaults reproduce the pre-refactor order exactly (Anthropic removed). */
export const DEFAULT_CHAINS: Record<AiFunction, ProviderName[]> = {
  transcribe: ["assemblyai", "groq", "gemini"],
  parseExpense: ["gemini", "groq", "openai", "deepseek"],
  parseReceipt: ["google_vision", "gemini", "openai"],
};

const FUNCTION_ENV: Record<AiFunction, { provider: string; fallback: string; timeout: string; timeoutDefault: number }> = {
  transcribe: { provider: "AI_TRANSCRIBE_PROVIDER", fallback: "AI_TRANSCRIBE_FALLBACK", timeout: "AI_TRANSCRIBE_TIMEOUT_MS", timeoutDefault: 30000 },
  parseExpense: { provider: "AI_PARSE_PROVIDER", fallback: "AI_PARSE_FALLBACK", timeout: "AI_PARSE_TIMEOUT_MS", timeoutDefault: 15000 },
  parseReceipt: { provider: "AI_RECEIPT_PROVIDER", fallback: "AI_RECEIPT_FALLBACK", timeout: "AI_RECEIPT_TIMEOUT_MS", timeoutDefault: 30000 },
};

/** Legacy provider spellings accepted in env values. */
const NAME_ALIASES: Record<string, ProviderName> = {
  whisper: "openai",
  google: "google_speech",
  "google-speech": "google_speech",
  vision: "google_vision",
  "google-vision": "google_vision",
  googlevision: "google_vision",
};

// ---------------------------------------------------------------------------
// Warnings (each distinct message logged once per process)
// ---------------------------------------------------------------------------

const warned = new Set<string>();
export function warnOnce(message: string): void {
  if (warned.has(message)) return;
  warned.add(message);
  // eslint-disable-next-line no-console
  console.warn(`[AI] ${message}`);
}
/** Test helper: forget which warnings were already logged. */
export function resetAiWarnings(): void {
  warned.clear();
}

function deprecated(oldName: string, newName: string): void {
  warnOnce(`Env var ${oldName} is deprecated and will be removed in the next release — rename it to ${newName}.`);
}

const env = (name: string): string | undefined => {
  const v = process.env[name];
  return v === undefined ? undefined : v.trim();
};

// ---------------------------------------------------------------------------
// Provider chains
// ---------------------------------------------------------------------------

export function normalizeProviderName(raw: string): ProviderName | null {
  const key = raw.trim().toLowerCase();
  if (!key) return null;
  if ((PROVIDERS as string[]).includes(key)) return key as ProviderName;
  return NAME_ALIASES[key] ?? null;
}

function parseList(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface ResolvedChain {
  chain: ProviderName[];
  issues: string[];
}

/**
 * Provider chain for a function: [primary, ...fallbacks].
 * Invalid or incapable entries are dropped with a warning (never fatal), so a
 * typo in Render can't take the feature down — it falls back to the default.
 */
export function resolveChain(fn: AiFunction): ResolvedChain {
  const names = FUNCTION_ENV[fn];
  const issues: string[] = [];
  const defaults = DEFAULT_CHAINS[fn];

  let primaryRaw = env(names.provider);
  let fallbackRaw = env(names.fallback);
  let legacyDefaultFallback: ProviderName[] | null = null;

  // Legacy aliases (one release): STT_PROVIDER pinned a single provider with no
  // fallback; OCR_PROVIDER moved one provider to the front of the default order.
  if (!primaryRaw) {
    if (fn === "transcribe" && env("STT_PROVIDER")) {
      deprecated("STT_PROVIDER", "AI_TRANSCRIBE_PROVIDER");
      const legacy = normalizeProviderName(env("STT_PROVIDER")!);
      if (legacy && CAPABILITIES[legacy].includes(fn)) {
        primaryRaw = legacy;
        legacyDefaultFallback = [];
      } else {
        issues.push(`Unknown STT_PROVIDER "${env("STT_PROVIDER")}"; using the default chain (${defaults.join(" → ")}).`);
      }
    } else if (fn === "parseReceipt" && env("OCR_PROVIDER")) {
      deprecated("OCR_PROVIDER", "AI_RECEIPT_PROVIDER");
      const legacy = normalizeProviderName(env("OCR_PROVIDER")!);
      if (legacy && CAPABILITIES[legacy].includes(fn)) {
        primaryRaw = legacy;
        legacyDefaultFallback = defaults.filter((p) => p !== legacy);
      } else {
        issues.push(`Unknown OCR_PROVIDER "${env("OCR_PROVIDER")}"; using the default chain (${defaults.join(" → ")}).`);
      }
    }
  }

  let primary: ProviderName = defaults[0];
  let usingDefaultPrimary = true;
  if (primaryRaw) {
    const p = normalizeProviderName(primaryRaw);
    if (!p) issues.push(`${names.provider}="${primaryRaw}" is not a known provider; using ${defaults[0]}.`);
    else if (!CAPABILITIES[p].includes(fn)) issues.push(`${names.provider}="${primaryRaw}" can't do ${fn}; using ${defaults[0]}.`);
    else {
      primary = p;
      usingDefaultPrimary = false;
    }
  }

  let fallback: ProviderName[];
  if (fallbackRaw !== undefined) {
    fallback = [];
    for (const item of parseList(fallbackRaw)) {
      const p = normalizeProviderName(item);
      if (!p) issues.push(`${names.fallback}: "${item}" is not a known provider (ignored).`);
      else if (!CAPABILITIES[p].includes(fn)) issues.push(`${names.fallback}: ${p} can't do ${fn} (ignored).`);
      else fallback.push(p);
    }
  } else if (legacyDefaultFallback) {
    fallback = legacyDefaultFallback;
  } else if (usingDefaultPrimary) {
    fallback = defaults.slice(1);
  } else {
    fallback = defaults.filter((p) => p !== primary);
  }

  const chain = [primary, ...fallback.filter((p) => p !== primary)].filter((p, i, arr) => arr.indexOf(p) === i);
  for (const issue of issues) warnOnce(issue);
  return { chain, issues };
}

export function timeoutFor(fn: AiFunction): number {
  const names = FUNCTION_ENV[fn];
  const v = Number(env(names.timeout));
  return Number.isFinite(v) && v > 0 ? v : names.timeoutDefault;
}

export function positiveIntEnv(name: string, fallback: number): number {
  const v = Number(env(name));
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
export const DEFAULT_GEMINI_TRANSCRIBE_MODEL = "gemini-2.5-flash";

function withAlias(newName: string, oldName: string, fallback: string): string {
  const v = env(newName);
  if (v) return v;
  const old = env(oldName);
  if (old) {
    deprecated(oldName, newName);
    return old;
  }
  return fallback;
}

export const models = {
  gemini: () => withAlias("AI_GEMINI_MODEL", "GEMINI_MODEL", DEFAULT_GEMINI_MODEL),
  geminiTranscribe: () => withAlias("AI_GEMINI_TRANSCRIBE_MODEL", "GEMINI_STT_MODEL", DEFAULT_GEMINI_TRANSCRIBE_MODEL),
  groqTranscribe: () => "whisper-large-v3-turbo",
  groqChat: () => "llama-3.3-70b-versatile",
  openaiTranscribe: () => "whisper-1",
  openaiChat: () => "gpt-4o-mini",
  deepseekChat: () => "deepseek-chat",
};

// ---------------------------------------------------------------------------
// API keys (server env only)
// ---------------------------------------------------------------------------

const KEY_SOURCES: Record<ProviderName, { name: string; aliases: string[] }> = {
  assemblyai: { name: "ASSEMBLYAI_API_KEY", aliases: [] },
  groq: { name: "GROQ_API_KEY", aliases: ["GROQ_KEY"] },
  gemini: { name: "GEMINI_API_KEY", aliases: ["GOOGLE_API_KEY"] },
  openai: { name: "OPENAI_API_KEY", aliases: [] },
  deepseek: { name: "DEEPSEEK_API_KEY", aliases: [] },
  google_vision: { name: "GOOGLE_VISION_API_KEY", aliases: ["GOOGLE_SPEECH_API_KEY", "GOOGLE_API_KEY"] },
  google_speech: { name: "GOOGLE_SPEECH_API_KEY", aliases: ["GOOGLE_VISION_API_KEY", "GOOGLE_API_KEY"] },
};

export function keyEnvName(provider: ProviderName): string {
  return KEY_SOURCES[provider].name;
}

/** The provider's API key, or undefined if not configured. */
export function getApiKey(provider: ProviderName): string | undefined {
  if (provider === "assemblyai" && env("ASSEMBLYAI_ENABLED")?.toLowerCase() === "false") return undefined;
  const src = KEY_SOURCES[provider];
  const direct = env(src.name);
  if (direct) return direct;
  for (const alias of src.aliases) {
    const v = env(alias);
    if (v) {
      deprecated(alias, src.name);
      return v;
    }
  }
  return undefined;
}

/** Every configured AI key value — used to scrub them from any error text or log. */
export function allConfiguredSecrets(): string[] {
  const names = new Set<string>();
  for (const s of Object.values(KEY_SOURCES)) {
    names.add(s.name);
    s.aliases.forEach((a) => names.add(a));
  }
  return [...names].map((n) => env(n)).filter((v): v is string => !!v && v.length >= 6);
}

/** Logged once at startup so misconfiguration shows up in Render logs immediately. */
export function describeAiConfig(): string[] {
  return (Object.keys(DEFAULT_CHAINS) as AiFunction[]).map((fn) => {
    const { chain } = resolveChain(fn);
    const parts = chain.map((p) => (getApiKey(p) ? p : `${p} (no key)`));
    return `${fn}: ${parts.join(" → ")}`;
  });
}
