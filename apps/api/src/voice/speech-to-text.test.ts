/**
 * MOCKED unit tests only: every provider HTTP call goes through a jest mock of
 * global.fetch. No real AssemblyAI / Groq / Gemini / OpenAI / Google API is
 * contacted and no credits are consumed.
 */
import {
  transcribeAudio,
  resetAssemblyAiCircuitBreaker,
  SttNotConfiguredError,
  SttTranscriptionError,
} from "./speech-to-text";

const AAI = "https://api.assemblyai.com";
const AAI_UPLOAD = `${AAI}/v2/upload`;
const AAI_SUBMIT = `${AAI}/v2/transcript`;
const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GEMINI_PREFIX = "https://generativelanguage.googleapis.com/v1beta/models/";
const OPENAI_URL = "https://api.openai.com/v1/audio/transcriptions";

const AAI_KEY = "aai_test_key_0123456789abcdef";
const audio = () => Buffer.from("fake m4a audio bytes");

type MockResponse = { ok: boolean; status?: number; json?: () => Promise<any>; text?: () => Promise<string> };
const ok = (body: any): MockResponse => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const fail = (status: number, body: string | object): MockResponse => ({
  ok: false,
  status,
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  json: async () => body,
});

type Handler = () => MockResponse | Promise<MockResponse>;

/** Routes mocked fetch calls by URL. `poll` may be a queue (last entry repeats) or a function. */
function mockFetch(routes: {
  upload?: Handler;
  submit?: Handler;
  poll?: MockResponse[] | Handler;
  groq?: Handler;
  gemini?: Handler;
  openai?: Handler;
}) {
  const pollQueue = Array.isArray(routes.poll) ? [...routes.poll] : null;
  const fn = jest.fn(async (url: string, _init?: any) => {
    if (url === AAI_UPLOAD && routes.upload) return routes.upload();
    if (url === AAI_SUBMIT && routes.submit) return routes.submit();
    if (url.startsWith(`${AAI_SUBMIT}/`) && routes.poll) {
      if (pollQueue) return pollQueue.length > 1 ? pollQueue.shift()! : pollQueue[0];
      return (routes.poll as Handler)();
    }
    if (url === GROQ_URL && routes.groq) return routes.groq();
    if (url.startsWith(GEMINI_PREFIX) && routes.gemini) return routes.gemini();
    if (url === OPENAI_URL && routes.openai) return routes.openai();
    throw new Error(`Unexpected fetch to ${url}`);
  });
  global.fetch = fn as any;
  return fn;
}

const calledUrls = (fn: jest.Mock) => fn.mock.calls.map((c) => String(c[0]));
const aaiSuccess = () => ({
  upload: () => ok({ upload_url: "https://cdn.assemblyai.com/upload/abc" }),
  submit: () => ok({ id: "tx_123", status: "queued" }),
  poll: [
    ok({ id: "tx_123", status: "queued" }),
    ok({ id: "tx_123", status: "processing" }),
    ok({ id: "tx_123", status: "completed", text: "I paid 1200 for dinner with Rahul and Aisha", language_code: "en" }),
  ],
});

describe("speech-to-text (mocked providers)", () => {
  const originalEnv = process.env;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env = { ...originalEnv };
    for (const k of [
      "ASSEMBLYAI_API_KEY",
      "ASSEMBLYAI_ENABLED",
      "ASSEMBLYAI_MAX_WAIT_MS",
      "GROQ_API_KEY",
      "GROQ_KEY",
      "OPENAI_API_KEY",
      "GEMINI_API_KEY",
      "GEMINI_STT_MODEL",
      "GOOGLE_API_KEY",
      "GOOGLE_SPEECH_API_KEY",
      "GOOGLE_VISION_API_KEY",
      "STT_PROVIDER",
    ]) {
      delete process.env[k];
    }
    process.env.ASSEMBLYAI_POLL_INTERVAL_MS = "1";
    resetAssemblyAiCircuitBreaker();
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => warnSpy.mockRestore());
  afterAll(() => {
    process.env = originalEnv;
  });

  // ---------------- general ----------------

  it("throws SttNotConfiguredError when no STT API keys are configured", async () => {
    const fn = mockFetch({});
    await expect(transcribeAudio(audio(), "test.m4a", "audio/m4a")).rejects.toThrow(SttNotConfiguredError);
    expect(fn).not.toHaveBeenCalled();
  });

  it("throws SttTranscriptionError for empty audio without calling any provider", async () => {
    process.env.ASSEMBLYAI_API_KEY = AAI_KEY;
    const fn = mockFetch({});
    await expect(transcribeAudio(Buffer.alloc(0), "test.m4a", "audio/m4a")).rejects.toThrow(SttTranscriptionError);
    expect(fn).not.toHaveBeenCalled();
  });

  // ---------------- AssemblyAI (primary) ----------------

  it("AssemblyAI success: upload -> submit Universal-2 -> poll queued/processing/completed", async () => {
    process.env.ASSEMBLYAI_API_KEY = AAI_KEY;
    process.env.GROQ_API_KEY = "gsk_test";
    const fn = mockFetch(aaiSuccess());

    const result = await transcribeAudio(audio(), "recording.m4a", "audio/m4a");

    expect(result).toEqual({ transcript: "I paid 1200 for dinner with Rahul and Aisha", languageDetected: "en" });
    const urls = calledUrls(fn);
    expect(urls[0]).toBe(AAI_UPLOAD);
    expect(urls[1]).toBe(AAI_SUBMIT);
    expect(urls.slice(2)).toEqual([`${AAI_SUBMIT}/tx_123`, `${AAI_SUBMIT}/tx_123`, `${AAI_SUBMIT}/tx_123`]);
    expect(urls).not.toContain(GROQ_URL);

    const uploadInit = fn.mock.calls[0][1] as any;
    expect(uploadInit.headers.authorization).toBe(AAI_KEY);
    expect(uploadInit.headers["content-type"]).toBe("application/octet-stream");

    const submitBody = JSON.parse((fn.mock.calls[1][1] as any).body);
    expect(submitBody).toEqual({
      audio_url: "https://cdn.assemblyai.com/upload/abc",
      speech_models: ["universal-2"],
      language_detection: true,
    });
  });

  it("AssemblyAI is primary: used before Groq and Gemini when all keys are set", async () => {
    process.env.ASSEMBLYAI_API_KEY = AAI_KEY;
    process.env.GROQ_API_KEY = "gsk_test";
    process.env.GEMINI_API_KEY = "gem_test";
    const fn = mockFetch(aaiSuccess());

    await transcribeAudio(audio(), "recording.m4a", "audio/m4a");
    expect(calledUrls(fn).every((u) => u.startsWith(AAI))).toBe(true);
  });

  it("missing ASSEMBLYAI_API_KEY: skips AssemblyAI and uses Groq", async () => {
    process.env.GROQ_API_KEY = "gsk_test";
    const fn = mockFetch({ groq: () => ok({ text: "Paid 500 for dinner with Rahul", language: "en" }) });

    const result = await transcribeAudio(audio(), "test.m4a", "audio/m4a");
    expect(result.transcript).toBe("Paid 500 for dinner with Rahul");
    expect(calledUrls(fn)).toEqual([GROQ_URL]);
  });

  it("missing ASSEMBLYAI_API_KEY with STT_PROVIDER=assemblyai throws SttNotConfiguredError", async () => {
    process.env.STT_PROVIDER = "assemblyai";
    process.env.GROQ_API_KEY = "gsk_test";
    const fn = mockFetch({});
    await expect(transcribeAudio(audio(), "test.m4a", "audio/m4a")).rejects.toThrow(SttNotConfiguredError);
    expect(fn).not.toHaveBeenCalled();
  });

  it("ASSEMBLYAI_ENABLED=false acts as a kill switch", async () => {
    process.env.ASSEMBLYAI_API_KEY = AAI_KEY;
    process.env.ASSEMBLYAI_ENABLED = "false";
    process.env.GROQ_API_KEY = "gsk_test";
    const fn = mockFetch({ groq: () => ok({ text: "Taxi 250" }) });

    await transcribeAudio(audio(), "test.m4a", "audio/m4a");
    expect(calledUrls(fn)).toEqual([GROQ_URL]);
  });

  it("upload failure (HTTP 500) falls back to Groq without submitting a transcript", async () => {
    process.env.ASSEMBLYAI_API_KEY = AAI_KEY;
    process.env.GROQ_API_KEY = "gsk_test";
    const fn = mockFetch({
      upload: () => fail(500, "Internal server error"),
      groq: () => ok({ text: "Groceries 900" }),
    });

    const result = await transcribeAudio(audio(), "test.m4a", "audio/m4a");
    expect(result.transcript).toBe("Groceries 900");
    expect(calledUrls(fn)).toEqual([AAI_UPLOAD, GROQ_URL]);
  });

  it("upload network error falls back to Groq", async () => {
    process.env.ASSEMBLYAI_API_KEY = AAI_KEY;
    process.env.GROQ_API_KEY = "gsk_test";
    mockFetch({
      upload: () => Promise.reject(new TypeError("fetch failed")),
      groq: () => ok({ text: "Lunch 400" }),
    });

    const result = await transcribeAudio(audio(), "test.m4a", "audio/m4a");
    expect(result.transcript).toBe("Lunch 400");
  });

  it("transcription failure (status=error) falls back to Groq; submit is never retried", async () => {
    process.env.ASSEMBLYAI_API_KEY = AAI_KEY;
    process.env.GROQ_API_KEY = "gsk_test";
    const s = aaiSuccess();
    const fn = mockFetch({
      upload: s.upload,
      submit: s.submit,
      poll: [ok({ id: "tx_123", status: "error", error: "Transcoding failed. File does not appear to contain audio." })],
      groq: () => ok({ text: "Rent 15000" }),
    });

    const result = await transcribeAudio(audio(), "test.m4a", "audio/m4a");
    expect(result.transcript).toBe("Rent 15000");
    expect(calledUrls(fn).filter((u) => u === AAI_SUBMIT)).toHaveLength(1);
  });

  it("transcription failure with STT_PROVIDER=assemblyai surfaces the AssemblyAI error", async () => {
    process.env.STT_PROVIDER = "assemblyai";
    process.env.ASSEMBLYAI_API_KEY = AAI_KEY;
    const s = aaiSuccess();
    mockFetch({
      upload: s.upload,
      submit: s.submit,
      poll: [ok({ id: "tx_123", status: "error", error: "Audio duration is too short." })],
    });

    await expect(transcribeAudio(audio(), "test.m4a", "audio/m4a")).rejects.toThrow(
      /AssemblyAI transcription failed: Audio duration is too short/
    );
  });

  it("quota exhausted (HTTP 400 negative balance): falls back to Groq and stops calling AssemblyAI", async () => {
    process.env.ASSEMBLYAI_API_KEY = AAI_KEY;
    process.env.GROQ_API_KEY = "gsk_test";
    const fn = mockFetch({
      upload: aaiSuccess().upload,
      submit: () => fail(400, { error: "Your current account balance is negative. Please top up to continue using the API." }),
      groq: () => ok({ text: "Electricity 2400" }),
    });

    const first = await transcribeAudio(audio(), "test.m4a", "audio/m4a");
    expect(first.transcript).toBe("Electricity 2400");
    expect(calledUrls(fn)).toEqual([AAI_UPLOAD, AAI_SUBMIT, GROQ_URL]);

    fn.mockClear();
    const second = await transcribeAudio(audio(), "test.m4a", "audio/m4a");
    expect(second.transcript).toBe("Electricity 2400");
    expect(calledUrls(fn)).toEqual([GROQ_URL]); // AssemblyAI not contacted again
  });

  it("quota exhausted (HTTP 402 on upload) also disables AssemblyAI", async () => {
    process.env.ASSEMBLYAI_API_KEY = AAI_KEY;
    process.env.GROQ_API_KEY = "gsk_test";
    const fn = mockFetch({
      upload: () => fail(402, { error: "Payment required" }),
      groq: () => ok({ text: "Wifi 999" }),
    });

    await transcribeAudio(audio(), "test.m4a", "audio/m4a");
    fn.mockClear();
    await transcribeAudio(audio(), "test.m4a", "audio/m4a");
    expect(calledUrls(fn)).toEqual([GROQ_URL]);
  });

  it("quota exhausted with no fallback provider configured surfaces a clear error", async () => {
    process.env.ASSEMBLYAI_API_KEY = AAI_KEY;
    mockFetch({
      upload: aaiSuccess().upload,
      submit: () => fail(400, { error: "Your current account balance is negative. Please top up to continue using the API." }),
    });

    await expect(transcribeAudio(audio(), "test.m4a", "audio/m4a")).rejects.toThrow(
      /\[assemblyai\] AssemblyAI free-tier credits exhausted/
    );
  });

  it("invalid AssemblyAI key (HTTP 401) is not retried on later requests", async () => {
    process.env.ASSEMBLYAI_API_KEY = AAI_KEY;
    process.env.GROQ_API_KEY = "gsk_test";
    const fn = mockFetch({
      upload: () => fail(401, { error: "Authentication error, API token missing/invalid" }),
      groq: () => ok({ text: "Milk 60" }),
    });

    await transcribeAudio(audio(), "test.m4a", "audio/m4a");
    fn.mockClear();
    await transcribeAudio(audio(), "test.m4a", "audio/m4a");
    expect(calledUrls(fn)).toEqual([GROQ_URL]);
  });

  it("retries transient poll errors (HTTP 503) a bounded number of times", async () => {
    process.env.ASSEMBLYAI_API_KEY = AAI_KEY;
    const s = aaiSuccess();
    const fn = mockFetch({
      upload: s.upload,
      submit: s.submit,
      poll: [fail(503, "Service unavailable"), fail(503, "Service unavailable"), ok({ status: "completed", text: "Fuel 1500" })],
    });

    const result = await transcribeAudio(audio(), "test.m4a", "audio/m4a");
    expect(result.transcript).toBe("Fuel 1500");
    expect(calledUrls(fn).filter((u) => u.startsWith(`${AAI_SUBMIT}/`))).toHaveLength(3);
  });

  it("gives up after 3 consecutive poll errors and falls back to Groq", async () => {
    process.env.ASSEMBLYAI_API_KEY = AAI_KEY;
    process.env.GROQ_API_KEY = "gsk_test";
    const s = aaiSuccess();
    const fn = mockFetch({
      upload: s.upload,
      submit: s.submit,
      poll: () => fail(503, "Service unavailable"),
      groq: () => ok({ text: "Snacks 120" }),
    });

    const result = await transcribeAudio(audio(), "test.m4a", "audio/m4a");
    expect(result.transcript).toBe("Snacks 120");
    expect(calledUrls(fn).filter((u) => u.startsWith(`${AAI_SUBMIT}/`))).toHaveLength(3);
  });

  it("times out a transcript stuck in 'processing' and falls back to Groq", async () => {
    process.env.ASSEMBLYAI_API_KEY = AAI_KEY;
    process.env.ASSEMBLYAI_MAX_WAIT_MS = "50";
    process.env.GROQ_API_KEY = "gsk_test";
    const s = aaiSuccess();
    mockFetch({
      upload: s.upload,
      submit: s.submit,
      poll: () => ok({ status: "processing" }),
      groq: () => ok({ text: "Movie 700" }),
    });

    const result = await transcribeAudio(audio(), "test.m4a", "audio/m4a");
    expect(result.transcript).toBe("Movie 700");
    expect(warnSpy.mock.calls.flat().join(" ")).toMatch(/AssemblyAI transcription timed out/);
  });

  it("never leaks the AssemblyAI key in error messages", async () => {
    process.env.STT_PROVIDER = "assemblyai";
    process.env.ASSEMBLYAI_API_KEY = AAI_KEY;
    mockFetch({ upload: () => fail(500, `server echoed ${AAI_KEY}`) });

    const err = await transcribeAudio(audio(), "test.m4a", "audio/m4a").catch((e) => e);
    expect(err).toBeInstanceOf(SttTranscriptionError);
    expect(err.message).not.toContain(AAI_KEY);
    expect(err.message).toContain("***");
  });

  // ---------------- fallbacks ----------------

  it("falls back to Gemini when AssemblyAI and Groq both fail", async () => {
    process.env.ASSEMBLYAI_API_KEY = AAI_KEY;
    process.env.GROQ_API_KEY = "gsk_test";
    process.env.GEMINI_API_KEY = "gem_secret_key";
    const fn = mockFetch({
      upload: () => fail(500, "boom"),
      groq: () => fail(503, "Unavailable"),
      gemini: () => ok({ candidates: [{ content: { parts: [{ text: "Paid 300 for chai" }] } }] }),
    });

    const result = await transcribeAudio(audio(), "test.m4a", "audio/m4a");
    expect(result.transcript).toBe("Paid 300 for chai");

    const urls = calledUrls(fn);
    expect(urls[0]).toBe(AAI_UPLOAD);
    expect(urls[1]).toBe(GROQ_URL);
    expect(urls[2]).toBe(`${GEMINI_PREFIX}gemini-2.5-flash:generateContent`);
    expect(urls[2]).not.toContain("gem_secret_key"); // key sent in header, not URL
    expect((fn.mock.calls[2][1] as any).headers["x-goog-api-key"]).toBe("gem_secret_key");
  });

  it("all providers failing reports each provider's error in order", async () => {
    process.env.ASSEMBLYAI_API_KEY = AAI_KEY;
    process.env.GROQ_API_KEY = "gsk_test";
    process.env.GEMINI_API_KEY = "gem_test";
    mockFetch({
      upload: () => fail(500, "aai down"),
      groq: () => fail(500, "groq down"),
      gemini: () => fail(500, "gemini down"),
    });

    const err = await transcribeAudio(audio(), "test.m4a", "audio/m4a").catch((e) => e);
    expect(err).toBeInstanceOf(SttTranscriptionError);
    expect(err.message).toMatch(/All transcription providers failed[\s\S]*\[assemblyai\][\s\S]*\[groq\][\s\S]*\[gemini\]/);
  });

  it("does not use paid-only providers (OpenAI Whisper) in the default cascade", async () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    const fn = mockFetch({ openai: () => ok({ text: "should not be used" }) });

    await expect(transcribeAudio(audio(), "test.m4a", "audio/m4a")).rejects.toThrow(SttNotConfiguredError);
    expect(fn).not.toHaveBeenCalled();
  });

  it("ignores a legacy/unknown STT_PROVIDER value and uses the cascade (AssemblyAI first)", async () => {
    process.env.STT_PROVIDER = "gnani";
    process.env.ASSEMBLYAI_API_KEY = AAI_KEY;
    const fn = mockFetch(aaiSuccess());

    const result = await transcribeAudio(audio(), "test.m4a", "audio/m4a");
    expect(result.transcript).toBe("I paid 1200 for dinner with Rahul and Aisha");
    expect(calledUrls(fn)[0]).toBe(AAI_UPLOAD);
  });

  // ---------------- explicitly pinned providers (unchanged behaviour) ----------------

  it("STT_PROVIDER=groq transcribes with Groq only", async () => {
    process.env.STT_PROVIDER = "groq";
    process.env.GROQ_API_KEY = "gsk_test_key_12345";
    process.env.ASSEMBLYAI_API_KEY = AAI_KEY;
    const fn = mockFetch({ groq: () => ok({ text: "Paid 500 for dinner with Rahul", language: "en" }) });

    const result = await transcribeAudio(audio(), "test.m4a", "audio/m4a");
    expect(result.transcript).toBe("Paid 500 for dinner with Rahul");
    expect(calledUrls(fn)).toEqual([GROQ_URL]);
    expect((fn.mock.calls[0][1] as any).headers.authorization).toBe("Bearer gsk_test_key_12345");
  });

  it("does NOT fall back when STT_PROVIDER=groq and the Groq key is missing", async () => {
    process.env.STT_PROVIDER = "groq";
    process.env.ASSEMBLYAI_API_KEY = AAI_KEY;
    const fn = mockFetch({});
    await expect(transcribeAudio(audio(), "test.m4a", "audio/m4a")).rejects.toThrow(SttNotConfiguredError);
    expect(fn).not.toHaveBeenCalled();
  });

  it("handles Groq rate limit HTTP 429 error gracefully", async () => {
    process.env.STT_PROVIDER = "groq";
    process.env.GROQ_API_KEY = "gsk_test_key_12345";
    mockFetch({ groq: () => fail(429, "Rate limit exceeded") });
    await expect(transcribeAudio(audio(), "test.m4a", "audio/m4a")).rejects.toThrow(/Groq Whisper rate limit exceeded/);
  });

  it("sanitizes API keys in error output if Groq fails with HTTP 500", async () => {
    process.env.STT_PROVIDER = "groq";
    process.env.GROQ_API_KEY = "gsk_secret_token_abc123";
    mockFetch({ groq: () => fail(500, "Error with token gsk_secret_token_abc123") });

    const err = await transcribeAudio(audio(), "test.m4a", "audio/m4a").catch((e) => e);
    expect(err.message).not.toContain("gsk_secret_token_abc123");
    expect(err.message).toContain("gsk_***");
  });

  it("uses OpenAI Whisper only when explicitly pinned with STT_PROVIDER=whisper", async () => {
    process.env.STT_PROVIDER = "whisper";
    process.env.OPENAI_API_KEY = "sk-test-key";
    const fn = mockFetch({ openai: () => ok({ text: "Dinner 300", language: "en" }) });

    const result = await transcribeAudio(audio(), "test.m4a", "audio/m4a");
    expect(result.transcript).toBe("Dinner 300");
    expect(calledUrls(fn)).toEqual([OPENAI_URL]);
  });
});
