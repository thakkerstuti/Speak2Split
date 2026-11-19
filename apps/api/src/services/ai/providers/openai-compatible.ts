/**
 * Shared request code for providers with an OpenAI-compatible API
 * (Groq, OpenAI, DeepSeek): Whisper-style transcription and JSON-mode chat.
 */
import { AiProviderError, AudioInput, JsonCompletionRequest, TranscriptionResult } from "../types";
import { httpError, providerFetch, readJson } from "../http";

export async function whisperTranscribe(opts: {
  label: string;
  url: string;
  apiKey: string;
  model: string;
  audio: AudioInput;
  timeoutMs: number;
}): Promise<TranscriptionResult> {
  const form = new FormData();
  form.append("file", new Blob([opts.audio.buffer], { type: opts.audio.mimeType || "audio/m4a" }), opts.audio.fileName || "recording.m4a");
  form.append("model", opts.model);

  const res = await providerFetch(opts.label, opts.url, {
    method: "POST",
    headers: { authorization: `Bearer ${opts.apiKey}` },
    body: form as any,
  }, opts.timeoutMs);
  if (!res.ok) throw await httpError(opts.label, res);

  const json = await readJson<{ text?: string; language?: string }>(opts.label, res);
  if (!json.text) throw new AiProviderError(`${opts.label} returned no transcript text`);
  return { transcript: json.text, languageDetected: json.language };
}

export async function chatJson(opts: {
  label: string;
  url: string;
  apiKey: string;
  model: string;
  req: JsonCompletionRequest;
}): Promise<string> {
  const res = await providerFetch(opts.label, opts.url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
    body: JSON.stringify({
      model: opts.model,
      messages: [
        { role: "system", content: opts.req.system },
        { role: "user", content: opts.req.user },
      ],
      response_format: { type: "json_object" },
    }),
  }, opts.req.timeoutMs);
  if (!res.ok) throw await httpError(opts.label, res);

  const json = await readJson<any>(opts.label, res);
  const text = json?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new AiProviderError(`${opts.label} returned an empty reply`);
  return text;
}
