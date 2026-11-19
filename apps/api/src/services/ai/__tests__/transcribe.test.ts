/**
 * transcribe() — MOCKED providers only (global.fetch is a jest mock).
 * Ported from the former voice/speech-to-text.test.ts, plus new-config tests.
 */
import { transcribe, resetAssemblyAiCircuitBreaker, resetAiWarnings, AiInvalidInputError, AiNotConfiguredError, AiProviderError } from "..";
import { URLS, calledUrls, clearAiEnv, fail, geminiText, hang, mockFetch, ok } from "./helpers";

const AAI_KEY = "aai_test_key_0123456789abcdef";
const audio = (buf = Buffer.from("fake m4a audio bytes")) => ({ buffer: buf, fileName: "recording.m4a", mimeType: "audio/m4a" });
const aaiSuccess = () => ({
  [URLS.aaiUpload]: () => ok({ upload_url: "https://cdn.assemblyai.com/upload/abc" }),
  [URLS.aaiSubmit]: [
    ok({ id: "tx_123", status: "queued" }),
  ],
  [`${URLS.aaiSubmit}/`]: [
    ok({ id: "tx_123", status: "queued" }),
    ok({ id: "tx_123", status: "processing" }),
    ok({ id: "tx_123", status: "completed", text: "I paid 1200 for dinner with Rahul and Aisha", language_code: "en" }),
  ],
});

describe("transcribe (mocked providers)", () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env = { ...originalEnv };
    clearAiEnv();
    process.env.ASSEMBLYAI_POLL_INTERVAL_MS = "1";
    resetAssemblyAiCircuitBreaker();
    resetAiWarnings();
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warnSpy.mockRestore());
  afterAll(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });
  const warnings = () => warnSpy.mock.calls.flat().join(" ");

  // ---------------- general ----------------

  it("throws AiNotConfiguredError when no STT key is configured", async () => {
    const fn = mockFetch({});
    await expect(transcribe(audio())).rejects.toThrow(AiNotConfiguredError);
    expect(fn).not.toHaveBeenCalled();
  });

  it("rejects empty audio without calling any provider", async () => {
    process.env.ASSEMBLYAI_API_KEY = AAI_KEY;
    const fn = mockFetch({});
    await expect(transcribe(audio(Buffer.alloc(0)))).rejects.toThrow(AiInvalidInputError);
    expect(fn).not.toHaveBeenCalled();
  });

  // ---------------- AssemblyAI (primary) ----------------

  it("AssemblyAI success: upload -> submit Universal-2 -> poll queued/processing/completed", async () => {
    process.env.ASSEMBLYAI_API_KEY = AAI_KEY;
    process.env.GROQ_API_KEY = "gsk_test";
    const fn = mockFetch(aaiSuccess());

    const result = await transcribe(audio());

    expect(result).toEqual({ transcript: "I paid 1200 for dinner with Rahul and Aisha", languageDetected: "en", provider: "assemblyai" });
    const urls = calledUrls(fn);
    expect(urls[0]).toBe(URLS.aaiUpload);
    expect(urls[1]).toBe(URLS.aaiSubmit);
    expect(urls.slice(2)).toEqual([`${URLS.aaiSubmit}/tx_123`, `${URLS.aaiSubmit}/tx_123`, `${URLS.aaiSubmit}/tx_123`]);
    expect(urls).not.toContain(URLS.groqAudio);
    const uploadInit = fn.mock.calls[0][1] as any;
    expect(uploadInit.headers.authorization).toBe(AAI_KEY);
    expect(uploadInit.headers["content-type"]).toBe("application/octet-stream");
    expect(JSON.parse((fn.mock.calls[1][1] as any).body)).toEqual({
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
    await transcribe(audio());
    expect(calledUrls(fn).every((u) => u.startsWith("https://api.assemblyai.com"))).toBe(true);
  });

  it("missing ASSEMBLYAI_API_KEY: skips AssemblyAI and uses Groq", async () => {
    process.env.GROQ_API_KEY = "gsk_test";
    const fn = mockFetch({ [URLS.groqAudio]: () => ok({ text: "Paid 500 for dinner with Rahul", language: "en" }) });
    const result = await transcribe(audio());
    expect(result.transcript).toBe("Paid 500 for dinner with Rahul");
    expect(result.provider).toBe("groq");
    expect(calledUrls(fn)).toEqual([URLS.groqAudio]);
  });

  it("missing ASSEMBLYAI_API_KEY with STT_PROVIDER=assemblyai (pinned) throws AiNotConfiguredError", async () => {
    process.env.STT_PROVIDER = "assemblyai";
    process.env.GROQ_API_KEY = "gsk_test";
    const fn = mockFetch({});
    await expect(transcribe(audio())).rejects.toThrow(AiNotConfiguredError);
    expect(fn).not.toHaveBeenCalled();
  });

  it("ASSEMBLYAI_ENABLED=false acts as a kill switch", async () => {
    process.env.ASSEMBLYAI_API_KEY = AAI_KEY;
    process.env.ASSEMBLYAI_ENABLED = "false";
    process.env.GROQ_API_KEY = "gsk_test";
    const fn = mockFetch({ [URLS.groqAudio]: () => ok({ text: "Taxi 250" }) });
    await transcribe(audio());
    expect(calledUrls(fn)).toEqual([URLS.groqAudio]);
  });

  it("upload failure (HTTP 500) falls back to Groq without submitting a transcript", async () => {
    process.env.ASSEMBLYAI_API_KEY = AAI_KEY;
    process.env.GROQ_API_KEY = "gsk_test";
    const fn = mockFetch({ [URLS.aaiUpload]: () => fail(500, "Internal server error"), [URLS.groqAudio]: () => ok({ text: "Groceries 900" }) });
    const result = await transcribe(audio());
    expect(result.transcript).toBe("Groceries 900");
    expect(calledUrls(fn)).toEqual([URLS.aaiUpload, URLS.groqAudio]);
  });

  it("upload network error falls back to Groq", async () => {
    process.env.ASSEMBLYAI_API_KEY = AAI_KEY;
    process.env.GROQ_API_KEY = "gsk_test";
    mockFetch({ [URLS.aaiUpload]: () => Promise.reject(new TypeError("fetch failed")), [URLS.groqAudio]: () => ok({ text: "Lunch 400" }) });
    expect((await transcribe(audio())).transcript).toBe("Lunch 400");
  });

  it("transcription failure (status=error) falls back to Groq; submit is never retried", async () => {
    process.env.ASSEMBLYAI_API_KEY = AAI_KEY;
    process.env.GROQ_API_KEY = "gsk_test";
    const fn = mockFetch({
      ...aaiSuccess(),
      [`${URLS.aaiSubmit}/`]: [ok({ id: "tx_123", status: "error", error: "Transcoding failed. File does not appear to contain audio." })],
      [URLS.groqAudio]: () => ok({ text: "Rent 15000" }),
    });
    expect((await transcribe(audio())).transcript).toBe("Rent 15000");
    expect(calledUrls(fn).filter((u) => u === URLS.aaiSubmit)).toHaveLength(1);
  });

  it("transcription failure with STT_PROVIDER=assemblyai surfaces the AssemblyAI error", async () => {
    process.env.STT_PROVIDER = "assemblyai";
    process.env.ASSEMBLYAI_API_KEY = AAI_KEY;
    mockFetch({ ...aaiSuccess(), [`${URLS.aaiSubmit}/`]: [ok({ id: "tx_123", status: "error", error: "Audio duration is too short." })] });
    await expect(transcribe(audio())).rejects.toThrow(/AssemblyAI transcription failed: Audio duration is too short/);
  });

  it("quota exhausted (HTTP 400 negative balance): falls back to Groq and stops calling AssemblyAI", async () => {
    process.env.ASSEMBLYAI_API_KEY = AAI_KEY;
    process.env.GROQ_API_KEY = "gsk_test";
    const fn = mockFetch({
      [URLS.aaiUpload]: () => ok({ upload_url: "https://cdn.assemblyai.com/upload/abc" }),
      [URLS.aaiSubmit]: () => fail(400, { error: "Your current account balance is negative. Please top up to continue using the API." }),
      [URLS.groqAudio]: () => ok({ text: "Electricity 2400" }),
    });
    expect((await transcribe(audio())).transcript).toBe("Electricity 2400");
    expect(calledUrls(fn)).toEqual([URLS.aaiUpload, URLS.aaiSubmit, URLS.groqAudio]);
    fn.mockClear();
    expect((await transcribe(audio())).transcript).toBe("Electricity 2400");
    expect(calledUrls(fn)).toEqual([URLS.groqAudio]);
  });

  it("quota exhausted (HTTP 402 on upload) also disables AssemblyAI", async () => {
    process.env.ASSEMBLYAI_API_KEY = AAI_KEY;
    process.env.GROQ_API_KEY = "gsk_test";
    const fn = mockFetch({ [URLS.aaiUpload]: () => fail(402, { error: "Payment required" }), [URLS.groqAudio]: () => ok({ text: "Wifi 999" }) });
    await transcribe(audio());
    fn.mockClear();
    await transcribe(audio());
    expect(calledUrls(fn)).toEqual([URLS.groqAudio]);
  });

  it("quota exhausted with no fallback provider configured surfaces a clear error", async () => {
    process.env.ASSEMBLYAI_API_KEY = AAI_KEY;
    mockFetch({
      [URLS.aaiUpload]: () => ok({ upload_url: "u" }),
      [URLS.aaiSubmit]: () => fail(400, { error: "Your current account balance is negative. Please top up to continue using the API." }),
    });
    await expect(transcribe(audio())).rejects.toThrow(/\[assemblyai\] AssemblyAI free-tier credits exhausted/);
  });

  it("invalid AssemblyAI key (HTTP 401) is not retried on later requests", async () => {
    process.env.ASSEMBLYAI_API_KEY = AAI_KEY;
    process.env.GROQ_API_KEY = "gsk_test";
    const fn = mockFetch({
      [URLS.aaiUpload]: () => fail(401, { error: "Authentication error, API token missing/invalid" }),
      [URLS.groqAudio]: () => ok({ text: "Milk 60" }),
    });
    await transcribe(audio());
    fn.mockClear();
    await transcribe(audio());
    expect(calledUrls(fn)).toEqual([URLS.groqAudio]);
  });

  it("retries transient poll errors (HTTP 503) a bounded number of times", async () => {
    process.env.ASSEMBLYAI_API_KEY = AAI_KEY;
    const fn = mockFetch({
      ...aaiSuccess(),
      [`${URLS.aaiSubmit}/`]: [fail(503, "Service unavailable"), fail(503, "Service unavailable"), ok({ status: "completed", text: "Fuel 1500" })],
    });
    expect((await transcribe(audio())).transcript).toBe("Fuel 1500");
    expect(calledUrls(fn).filter((u) => u.startsWith(`${URLS.aaiSubmit}/`))).toHaveLength(3);
  });

  it("gives up after 3 consecutive poll errors and falls back to Groq", async () => {
    process.env.ASSEMBLYAI_API_KEY = AAI_KEY;
    process.env.GROQ_API_KEY = "gsk_test";
    const fn = mockFetch({
      ...aaiSuccess(),
      [`${URLS.aaiSubmit}/`]: () => fail(503, "Service unavailable"),
      [URLS.groqAudio]: () => ok({ text: "Snacks 120" }),
    });
    expect((await transcribe(audio())).transcript).toBe("Snacks 120");
    expect(calledUrls(fn).filter((u) => u.startsWith(`${URLS.aaiSubmit}/`))).toHaveLength(3);
  });

  it("times out a transcript stuck in 'processing' and falls back to Groq", async () => {
    process.env.ASSEMBLYAI_API_KEY = AAI_KEY;
    process.env.ASSEMBLYAI_MAX_WAIT_MS = "50";
    process.env.GROQ_API_KEY = "gsk_test";
    mockFetch({ ...aaiSuccess(), [`${URLS.aaiSubmit}/`]: () => ok({ status: "processing" }), [URLS.groqAudio]: () => ok({ text: "Movie 700" }) });
    expect((await transcribe(audio())).transcript).toBe("Movie 700");
    expect(warnings()).toMatch(/AssemblyAI transcription timed out/);
  });

  it("never leaks the AssemblyAI key in error messages or logs", async () => {
    process.env.STT_PROVIDER = "assemblyai";
    process.env.ASSEMBLYAI_API_KEY = AAI_KEY;
    mockFetch({ [URLS.aaiUpload]: () => fail(500, `server echoed ${AAI_KEY}`) });
    const err = await transcribe(audio()).catch((e) => e);
    expect(err).toBeInstanceOf(AiProviderError);
    expect(err.message).not.toContain(AAI_KEY);
    expect(err.message).toContain("***");
    expect(warnings()).not.toContain(AAI_KEY);
  });

  // ---------------- fallbacks ----------------

  it("falls back to Gemini when AssemblyAI and Groq both fail (key in header, not URL)", async () => {
    process.env.ASSEMBLYAI_API_KEY = AAI_KEY;
    process.env.GROQ_API_KEY = "gsk_test";
    process.env.GEMINI_API_KEY = "gem_secret_key";
    const fn = mockFetch({
      [URLS.aaiUpload]: () => fail(500, "boom"),
      [URLS.groqAudio]: () => fail(503, "Unavailable"),
      [URLS.geminiPrefix]: () => geminiText("Paid 300 for chai"),
    });
    const result = await transcribe(audio());
    expect(result).toMatchObject({ transcript: "Paid 300 for chai", provider: "gemini" });
    const urls = calledUrls(fn);
    expect(urls[2]).toBe(`${URLS.geminiPrefix}gemini-2.5-flash:generateContent`);
    expect(urls[2]).not.toContain("gem_secret_key");
    expect((fn.mock.calls[2][1] as any).headers["x-goog-api-key"]).toBe("gem_secret_key");
  });

  it("all providers failing reports each provider's error in order", async () => {
    process.env.ASSEMBLYAI_API_KEY = AAI_KEY;
    process.env.GROQ_API_KEY = "gsk_test";
    process.env.GEMINI_API_KEY = "gem_test";
    mockFetch({
      [URLS.aaiUpload]: () => fail(500, "aai down"),
      [URLS.groqAudio]: () => fail(500, "groq down"),
      [URLS.geminiPrefix]: () => fail(500, "gemini down"),
    });
    const err = await transcribe(audio()).catch((e) => e);
    expect(err).toBeInstanceOf(AiProviderError);
    expect(err.message).toMatch(/All transcription providers failed[\s\S]*\[assemblyai\][\s\S]*\[groq\][\s\S]*\[gemini\]/);
  });

  it("does not use paid-only providers (OpenAI Whisper) in the default chain", async () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    const fn = mockFetch({ [URLS.openaiAudio]: () => ok({ text: "should not be used" }) });
    await expect(transcribe(audio())).rejects.toThrow(AiNotConfiguredError);
    expect(fn).not.toHaveBeenCalled();
  });

  it("ignores a legacy/unknown STT_PROVIDER value and uses the default chain (AssemblyAI first)", async () => {
    process.env.STT_PROVIDER = "gnani";
    process.env.ASSEMBLYAI_API_KEY = AAI_KEY;
    const fn = mockFetch(aaiSuccess());
    expect((await transcribe(audio())).transcript).toBe("I paid 1200 for dinner with Rahul and Aisha");
    expect(calledUrls(fn)[0]).toBe(URLS.aaiUpload);
    expect(warnings()).toMatch(/Unknown STT_PROVIDER "gnani"/);
  });

  // ---------------- pinned providers (legacy STT_PROVIDER semantics kept) ----------------

  it("STT_PROVIDER=groq transcribes with Groq only and logs a deprecation warning", async () => {
    process.env.STT_PROVIDER = "groq";
    process.env.GROQ_API_KEY = "gsk_test_key_12345";
    process.env.ASSEMBLYAI_API_KEY = AAI_KEY;
    const fn = mockFetch({ [URLS.groqAudio]: () => ok({ text: "Paid 500 for dinner with Rahul", language: "en" }) });
    expect((await transcribe(audio())).transcript).toBe("Paid 500 for dinner with Rahul");
    expect(calledUrls(fn)).toEqual([URLS.groqAudio]);
    expect((fn.mock.calls[0][1] as any).headers.authorization).toBe("Bearer gsk_test_key_12345");
    expect(warnings()).toMatch(/STT_PROVIDER is deprecated .* AI_TRANSCRIBE_PROVIDER/);
  });

  it("does NOT fall back when STT_PROVIDER=groq and the Groq key is missing", async () => {
    process.env.STT_PROVIDER = "groq";
    process.env.ASSEMBLYAI_API_KEY = AAI_KEY;
    const fn = mockFetch({});
    await expect(transcribe(audio())).rejects.toThrow(AiNotConfiguredError);
    expect(fn).not.toHaveBeenCalled();
  });

  it("handles Groq rate limit HTTP 429 gracefully", async () => {
    process.env.STT_PROVIDER = "groq";
    process.env.GROQ_API_KEY = "gsk_test_key_12345";
    mockFetch({ [URLS.groqAudio]: () => fail(429, "Rate limit exceeded") });
    await expect(transcribe(audio())).rejects.toThrow(/Groq Whisper rate limit exceeded/);
  });

  it("redacts API keys from errors if Groq fails with HTTP 500", async () => {
    process.env.STT_PROVIDER = "groq";
    process.env.GROQ_API_KEY = "gsk_secret_token_abc123";
    mockFetch({ [URLS.groqAudio]: () => fail(500, "Error with token gsk_secret_token_abc123") });
    const err = await transcribe(audio()).catch((e) => e);
    expect(err.message).not.toContain("gsk_secret_token_abc123");
    expect(err.message).toContain("***");
  });

  it("uses OpenAI Whisper only when explicitly pinned (STT_PROVIDER=whisper)", async () => {
    process.env.STT_PROVIDER = "whisper";
    process.env.OPENAI_API_KEY = "sk-test-key";
    const fn = mockFetch({ [URLS.openaiAudio]: () => ok({ text: "Dinner 300", language: "en" }) });
    expect((await transcribe(audio())).transcript).toBe("Dinner 300");
    expect(calledUrls(fn)).toEqual([URLS.openaiAudio]);
  });

  it("Google Speech (pinned) sends its key in a header, never in the URL", async () => {
    process.env.AI_TRANSCRIBE_PROVIDER = "google_speech";
    process.env.AI_TRANSCRIBE_FALLBACK = "";
    process.env.GOOGLE_SPEECH_API_KEY = "AIzaSpeechKey_0123456789abcdef";
    const fn = mockFetch({ [URLS.speech]: () => ok({ results: [{ alternatives: [{ transcript: "Bus 40" }] }] }) });
    expect((await transcribe(audio())).transcript).toBe("Bus 40");
    expect(calledUrls(fn)[0]).toBe(URLS.speech);
    expect((fn.mock.calls[0][1] as any).headers["x-goog-api-key"]).toBe("AIzaSpeechKey_0123456789abcdef");
  });

  // ---------------- new configuration ----------------

  it("AI_TRANSCRIBE_PROVIDER + comma-separated AI_TRANSCRIBE_FALLBACK set the order", async () => {
    process.env.AI_TRANSCRIBE_PROVIDER = "gemini";
    process.env.AI_TRANSCRIBE_FALLBACK = "groq, assemblyai";
    process.env.GEMINI_API_KEY = "gem_test";
    process.env.GROQ_API_KEY = "gsk_test";
    process.env.ASSEMBLYAI_API_KEY = AAI_KEY;
    const fn = mockFetch({
      [URLS.geminiPrefix]: () => fail(500, "down"),
      [URLS.groqAudio]: () => fail(500, "down"),
      ...aaiSuccess(),
    });
    expect((await transcribe(audio())).provider).toBe("assemblyai");
    const urls = calledUrls(fn);
    expect(urls[0].startsWith(URLS.geminiPrefix)).toBe(true);
    expect(urls[1]).toBe(URLS.groqAudio);
    expect(urls[2]).toBe(URLS.aaiUpload);
  });

  it("a provider that times out falls back to the next one (AI_TRANSCRIBE_TIMEOUT_MS)", async () => {
    process.env.AI_TRANSCRIBE_TIMEOUT_MS = "50";
    process.env.GROQ_API_KEY = "gsk_test";
    process.env.GEMINI_API_KEY = "gem_test";
    mockFetch({ [URLS.groqAudio]: hang, [URLS.geminiPrefix]: () => geminiText("Parking 60") });
    const result = await transcribe(audio());
    expect(result).toMatchObject({ transcript: "Parking 60", provider: "gemini" });
    expect(warnings()).toMatch(/groq failed.*timed out/);
  });

  it("an invalid (whitespace-only) transcript is treated as a failure and falls back", async () => {
    process.env.GROQ_API_KEY = "gsk_test";
    process.env.GEMINI_API_KEY = "gem_test";
    mockFetch({ [URLS.groqAudio]: () => ok({ text: "   " }), [URLS.geminiPrefix]: () => geminiText("Tea 20") });
    expect((await transcribe(audio())).transcript).toBe("Tea 20");
  });

  it("GEMINI_STT_MODEL still works as an alias, with a deprecation warning", async () => {
    process.env.GEMINI_STT_MODEL = "gemini-3.5-flash-lite";
    process.env.GEMINI_API_KEY = "gem_test";
    const fn = mockFetch({ [URLS.geminiPrefix]: () => geminiText("Toll 100") });
    await transcribe(audio());
    expect(calledUrls(fn)[0]).toBe(`${URLS.geminiPrefix}gemini-3.5-flash-lite:generateContent`);
    expect(warnings()).toMatch(/GEMINI_STT_MODEL is deprecated .* AI_GEMINI_TRANSCRIBE_MODEL/);
  });
});
