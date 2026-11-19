/**
 * Shared helpers for the AI-layer tests. Every provider HTTP call goes through
 * a jest mock of global.fetch — no real API is contacted, no credits are used.
 */

export const AI_ENV_VARS = [
  "AI_TRANSCRIBE_PROVIDER", "AI_TRANSCRIBE_FALLBACK", "AI_TRANSCRIBE_TIMEOUT_MS",
  "AI_PARSE_PROVIDER", "AI_PARSE_FALLBACK", "AI_PARSE_TIMEOUT_MS",
  "AI_RECEIPT_PROVIDER", "AI_RECEIPT_FALLBACK", "AI_RECEIPT_TIMEOUT_MS",
  "AI_GEMINI_MODEL", "AI_GEMINI_TRANSCRIBE_MODEL",
  "STT_PROVIDER", "OCR_PROVIDER", "GEMINI_MODEL", "GEMINI_STT_MODEL", "EXPENSE_PARSER_MODEL",
  "ASSEMBLYAI_API_KEY", "ASSEMBLYAI_ENABLED", "ASSEMBLYAI_MAX_WAIT_MS", "ASSEMBLYAI_POLL_INTERVAL_MS",
  "GROQ_API_KEY", "GROQ_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "OPENAI_API_KEY", "DEEPSEEK_API_KEY",
  "ANTHROPIC_API_KEY", "GOOGLE_VISION_API_KEY", "GOOGLE_SPEECH_API_KEY",
];

export function clearAiEnv(): void {
  for (const k of AI_ENV_VARS) delete process.env[k];
}

export type MockResponse = { ok: boolean; status?: number; json?: () => Promise<any>; text?: () => Promise<string> };

export const ok = (body: any): MockResponse => ({
  ok: true,
  status: 200,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

export const fail = (status: number, body: string | object): MockResponse => ({
  ok: false,
  status,
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  json: async () => body,
});

/** A fetch that never answers until its AbortSignal fires (to exercise timeouts). */
export const hang = (_url: string, init: any) =>
  new Promise<MockResponse>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
  });

export const URLS = {
  aaiUpload: "https://api.assemblyai.com/v2/upload",
  aaiSubmit: "https://api.assemblyai.com/v2/transcript",
  groqAudio: "https://api.groq.com/openai/v1/audio/transcriptions",
  groqChat: "https://api.groq.com/openai/v1/chat/completions",
  openaiAudio: "https://api.openai.com/v1/audio/transcriptions",
  openaiChat: "https://api.openai.com/v1/chat/completions",
  deepseekChat: "https://api.deepseek.com/v1/chat/completions",
  anthropic: "https://api.anthropic.com/v1/messages",
  geminiPrefix: "https://generativelanguage.googleapis.com/v1beta/models/",
  vision: "https://vision.googleapis.com/v1/images:annotate",
  speech: "https://speech.googleapis.com/v1/speech:recognize",
};

type Handler = (url: string, init: any) => MockResponse | Promise<MockResponse>;

/**
 * Installs a fetch mock that routes by URL prefix. A route value may be a
 * handler or a queue of responses (last one repeats). Unrouted URLs throw.
 */
export function mockFetch(routes: Record<string, Handler | MockResponse[]>) {
  const queues = new Map<string, MockResponse[]>();
  for (const [k, v] of Object.entries(routes)) if (Array.isArray(v)) queues.set(k, [...v]);
  const fn = jest.fn(async (url: string, init?: any) => {
    const key = Object.keys(routes)
      .filter((prefix) => url.startsWith(prefix))
      .sort((a, b) => b.length - a.length)[0];
    if (!key) throw new Error(`Unexpected fetch to ${url}`);
    const route = routes[key];
    if (Array.isArray(route)) {
      const q = queues.get(key)!;
      return q.length > 1 ? q.shift()! : q[0];
    }
    return route(url, init);
  });
  global.fetch = fn as any;
  return fn;
}

export const calledUrls = (fn: jest.Mock) => fn.mock.calls.map((c) => String(c[0]));

export const geminiText = (text: string) => ok({ candidates: [{ content: { parts: [{ text }] } }] });
export const chatText = (text: string) => ok({ choices: [{ message: { content: text } }] });
