/**
 * Speech-to-Text Provider
 *
 * Real integration with OpenAI's Whisper transcription API. Kept behind a
 * narrow interface (`transcribeAudio`) so a different provider (Google
 * Speech-to-Text, Deepgram — both already documented in .env.example) can
 * be swapped in without touching any calling code. If the configured
 * provider's credential is missing, this throws a specific, clear error —
 * it never returns sample/placeholder text pretending to be a real
 * transcription.
 */

export class SttNotConfiguredError extends Error {}
export class SttTranscriptionError extends Error {}

export interface TranscriptionResult {
  transcript: string;
  languageDetected?: string;
}

async function transcribeWithWhisper(audioBuffer: Buffer, fileName: string, mimeType: string): Promise<TranscriptionResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new SttNotConfiguredError(
      "OPENAI_API_KEY is not configured (STT_PROVIDER=whisper requires it) — see ENVIRONMENT.md"
    );
  }

  const formData = new FormData();
  formData.append("file", new Blob([audioBuffer], { type: mimeType }), fileName);
  formData.append("model", "whisper-1");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}` },
    body: formData as any,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new SttTranscriptionError(`Whisper transcription failed (HTTP ${response.status}): ${body}`);
  }

  const json = (await response.json()) as { text?: string; language?: string };
  if (!json.text) {
    throw new SttTranscriptionError("Whisper returned no transcript text");
  }

  return { transcript: json.text, languageDetected: json.language };
}

/**
 * Google Cloud Speech-to-Text integration, used when STT_PROVIDER=google.
 * Also real — makes an actual API call, fails with a clear error if
 * GOOGLE_SPEECH_API_KEY is missing.
 */
async function transcribeWithGoogleSpeech(audioBuffer: Buffer): Promise<TranscriptionResult> {
  const apiKey = process.env.GOOGLE_SPEECH_API_KEY;
  if (!apiKey) {
    throw new SttNotConfiguredError(
      "GOOGLE_SPEECH_API_KEY is not configured (STT_PROVIDER=google requires it) — see ENVIRONMENT.md"
    );
  }

  const response = await fetch(`https://speech.googleapis.com/v1/speech:recognize?key=${apiKey}`, {
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

export async function transcribeAudio(audioBuffer: Buffer, fileName: string, mimeType: string): Promise<TranscriptionResult> {
  const provider = process.env.STT_PROVIDER ?? "whisper";

  switch (provider) {
    case "whisper":
      return transcribeWithWhisper(audioBuffer, fileName, mimeType);
    case "google":
      return transcribeWithGoogleSpeech(audioBuffer);
    default:
      throw new SttNotConfiguredError(`Unknown STT_PROVIDER "${provider}" — expected "whisper" or "google"`);
  }
}
