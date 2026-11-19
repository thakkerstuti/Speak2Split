/**
 * AI service layer — the ONLY entry point for AI features.
 *
 *   transcribe(audio)            speech → text            (AssemblyAI, Groq, Gemini, OpenAI, Google Speech)
 *   parseExpense(text, context)  text → expense draft     (Gemini, Groq, OpenAI, DeepSeek + offline heuristic)
 *   parseReceipt(image)          image → receipt fields   (Google Vision, Gemini, OpenAI)
 *
 * Providers are chosen per function from server env vars (see config.ts), with
 * comma-separated fallbacks tried on error or timeout. Structured output is
 * validated with Zod; invalid output is retried once, then returned as
 * "needs_confirmation". API keys exist only in server env vars.
 */
export { transcribe } from "./transcribe";
export type { TranscribeResult } from "./transcribe";
export { parseExpense } from "./parse-expense";
export type { ParseExpenseContext } from "./parse-expense";
export { parseReceipt } from "./parse-receipt";
export type { ExpenseDraft, Receipt, ReceiptDraft } from "./schemas";
export {
  AiError,
  AiInvalidInputError,
  AiNotConfiguredError,
  AiProviderError,
  AiProviderUnavailableError,
} from "./types";
export type { AiResult, AudioInput, ProviderName, TranscriptionResult } from "./types";
export { describeAiConfig, resetAiWarnings } from "./config";
export { redactSecrets } from "./http";
export { resetAssemblyAiCircuitBreaker } from "./providers";
