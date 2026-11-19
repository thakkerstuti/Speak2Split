/**
 * Shared types and errors for the AI service layer.
 *
 * Routes and other application code import ONLY from `services/ai` (index.ts).
 * Provider HTTP calls live exclusively in `services/ai/providers/`.
 */

export type AiFunction = "transcribe" | "parseExpense" | "parseReceipt";

export type ProviderName =
  | "assemblyai"
  | "groq"
  | "gemini"
  | "openai"
  | "deepseek"
  | "google_vision"
  | "google_speech";

export interface AudioInput {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}

export interface TranscriptionResult {
  transcript: string;
  languageDetected?: string;
}

export interface JsonCompletionRequest {
  system: string;
  user: string;
  timeoutMs: number;
}

/** What a provider module may implement. Each function is optional — capability is declared in config.ts. */
export interface AiProvider {
  name: ProviderName;
  transcribe?(audio: AudioInput, timeoutMs: number): Promise<TranscriptionResult>;
  /** Returns the raw text of a JSON-only model reply (validated by the caller). */
  completeJson?(req: JsonCompletionRequest): Promise<string>;
  /** Returns raw text read from a receipt image (fields are extracted + validated by the caller). */
  receiptText?(image: Buffer, timeoutMs: number): Promise<string>;
}

/**
 * Result of a structured AI function. `data` is ALWAYS schema-valid:
 *  - "ok": the provider's output passed validation.
 *  - "needs_confirmation": validation failed twice (or only the offline
 *    heuristic was available); `data` contains only fields that individually
 *    passed validation, with safe defaults for the rest, and must be
 *    confirmed by the user before anything is saved.
 */
export type AiResult<T> =
  | { status: "ok"; data: T; provider: ProviderName; issues: [] }
  | { status: "needs_confirmation"; data: T; provider: ProviderName | "heuristic"; issues: string[] };

export class AiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
/** No provider in the configured chain has a key (or the chain is empty). */
export class AiNotConfiguredError extends AiError {}
/** A provider call failed (HTTP error, timeout, network error, empty/invalid response). Triggers fallback. */
export class AiProviderError extends AiError {}
/** Provider deliberately skipped (e.g. AssemblyAI free credits exhausted). Treated as a provider failure. */
export class AiProviderUnavailableError extends AiProviderError {}
/** The caller's input is unusable (e.g. empty audio, empty text). */
export class AiInvalidInputError extends AiError {}
