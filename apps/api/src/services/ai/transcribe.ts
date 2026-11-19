import { AiInvalidInputError, AiNotConfiguredError, AiProviderError, AiProviderUnavailableError, AudioInput, ProviderName, TranscriptionResult } from "./types";
import { resolveChain, timeoutFor } from "./config";
import { PROVIDER_REGISTRY } from "./providers";
import { redactSecrets } from "./http";
import { TranscriptSchema, formatIssues } from "./schemas";

export type TranscribeResult = TranscriptionResult & { provider: ProviderName };

/**
 * Speech-to-text through the configured chain (default AssemblyAI → Groq → Gemini).
 * Providers without a key are skipped; any failure or timeout moves on to the
 * next provider. A transcript is plain text, so an invalid one (empty, too
 * long) is treated as a provider failure rather than "needs confirmation".
 */
export async function transcribe(audio: AudioInput): Promise<TranscribeResult> {
  if (!audio?.buffer || audio.buffer.length === 0) throw new AiInvalidInputError("Audio file is empty");
  const input: AudioInput = {
    buffer: audio.buffer,
    fileName: audio.fileName || "recording.m4a",
    mimeType: audio.mimeType || "audio/m4a",
  };

  const { chain } = resolveChain("transcribe");
  const timeoutMs = timeoutFor("transcribe");
  const failures: string[] = [];

  for (const name of chain) {
    const provider = PROVIDER_REGISTRY[name];
    if (!provider.transcribe) continue;
    try {
      const raw = await provider.transcribe(input, timeoutMs);
      const checked = TranscriptSchema.safeParse(raw);
      if (!checked.success) throw new AiProviderError(`${name} returned an invalid transcript (${formatIssues(checked.error).join("; ")})`);
      return { ...checked.data, provider: name };
    } catch (err: any) {
      if (err instanceof AiNotConfiguredError) continue;
      const message = redactSecrets(String(err?.message ?? err));
      const quietSkip = err instanceof AiProviderUnavailableError && message.startsWith("AssemblyAI skipped");
      // eslint-disable-next-line no-console
      if (!quietSkip) console.warn(`[AI] transcribe: ${name} failed, trying next provider: ${message}`);
      failures.push(`[${name}] ${message}`);
    }
  }

  if (failures.length === 0) {
    throw new AiNotConfiguredError(
      "No speech-to-text provider is configured. Set ASSEMBLYAI_API_KEY (primary), GROQ_API_KEY or GEMINI_API_KEY."
    );
  }
  throw new AiProviderError(`All transcription providers failed:\n${failures.join("\n")}`);
}
