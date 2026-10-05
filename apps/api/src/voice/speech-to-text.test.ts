import { transcribeAudio, SttNotConfiguredError, SttTranscriptionError } from "./speech-to-text";

describe("speech-to-text integration", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.GNANI_API_KEY;
    delete process.env.GNANI_LANGUAGE_CODE;
    delete process.env.GNANI_MODEL;
    delete process.env.GROQ_API_KEY;
    delete process.env.GROQ_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GOOGLE_SPEECH_API_KEY;
    delete process.env.STT_PROVIDER;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("throws SttNotConfiguredError when no STT API keys are configured", async () => {
    const dummyBuffer = Buffer.from("audio data");
    await expect(transcribeAudio(dummyBuffer, "test.m4a", "audio/m4a")).rejects.toThrow(SttNotConfiguredError);
  });

  it("transcribes successfully using Gnani when GNANI_API_KEY and STT_PROVIDER=gnani are configured", async () => {
    process.env.GNANI_API_KEY = "gnani_secret_key_12345";
    process.env.STT_PROVIDER = "gnani";
    process.env.GNANI_LANGUAGE_CODE = "en-IN";

    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        request_id: "019fd17d-1106-7265-88ab-3ed12d029292",
        timestamp: "2026-10-05T14:52:00Z",
        transcript: "I paid 1200 rupees for dinner with Rahul and Aisha.",
      }),
    });
    global.fetch = mockFetch as any;

    const dummyBuffer = Buffer.from("audio data");
    const result = await transcribeAudio(dummyBuffer, "test.m4a", "audio/m4a");

    expect(result.transcript).toBe("I paid 1200 rupees for dinner with Rahul and Aisha.");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe("https://api.vachana.ai/stt/v3");
    expect(mockFetch.mock.calls[0][1].headers["X-API-Key-ID"]).toBe("gnani_secret_key_12345");
  });

  it("does NOT fall back to other providers when STT_PROVIDER=gnani", async () => {
    process.env.STT_PROVIDER = "gnani";
    process.env.OPENAI_API_KEY = "sk-test-key";
    delete process.env.GNANI_API_KEY;

    const dummyBuffer = Buffer.from("audio data");
    await expect(transcribeAudio(dummyBuffer, "test.m4a", "audio/m4a")).rejects.toThrow(SttNotConfiguredError);
  });

  it("handles Gnani rate limit HTTP 429 error gracefully", async () => {
    process.env.GNANI_API_KEY = "gnani_secret_key_12345";
    process.env.STT_PROVIDER = "gnani";

    const mockFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "Rate limit exceeded",
    });
    global.fetch = mockFetch as any;

    const dummyBuffer = Buffer.from("audio data");
    await expect(transcribeAudio(dummyBuffer, "test.m4a", "audio/m4a")).rejects.toThrow(
      /Gnani Prisma rate limit exceeded/
    );
  });

  it("sanitizes API keys in error output if Gnani fails with HTTP 500", async () => {
    process.env.GNANI_API_KEY = "gnani_secret_key_99999";
    process.env.STT_PROVIDER = "gnani";

    const mockFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Failed with key gnani_secret_key_99999",
    });
    global.fetch = mockFetch as any;

    const dummyBuffer = Buffer.from("audio data");
    try {
      await transcribeAudio(dummyBuffer, "test.m4a", "audio/m4a");
      fail("Should have thrown");
    } catch (err: any) {
      expect(err.message).not.toContain("gnani_secret_key_99999");
      expect(err.message).toContain("***");
    }
  });

  it("supports passing language_code override for Indian languages (e.g. hi-IN, gu-IN)", async () => {
    process.env.GNANI_API_KEY = "gnani_test_key";
    process.env.STT_PROVIDER = "gnani";

    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ transcript: "maine Rahul ke saath khana khaya", language: "hi-IN" }),
    });
    global.fetch = mockFetch as any;

    const dummyBuffer = Buffer.from("audio data");
    const result = await transcribeAudio(dummyBuffer, "test.m4a", "audio/m4a", "hi-IN");

    expect(result.transcript).toBe("maine Rahul ke saath khana khaya");
    expect(result.languageDetected).toBe("hi-IN");
  });

  it("transcribes successfully using Groq when GROQ_API_KEY is configured", async () => {
    process.env.GROQ_API_KEY = "gsk_test_key_12345";
    process.env.STT_PROVIDER = "groq";

    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: "Paid 500 for dinner with Rahul", language: "en" }),
    });
    global.fetch = mockFetch as any;

    const dummyBuffer = Buffer.from("audio data");
    const result = await transcribeAudio(dummyBuffer, "test.m4a", "audio/m4a");

    expect(result.transcript).toBe("Paid 500 for dinner with Rahul");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
  });

  it("does NOT fall back to OpenAI when STT_PROVIDER=groq", async () => {
    process.env.STT_PROVIDER = "groq";
    process.env.OPENAI_API_KEY = "sk-test-key";
    delete process.env.GROQ_API_KEY;

    const dummyBuffer = Buffer.from("audio data");
    await expect(transcribeAudio(dummyBuffer, "test.m4a", "audio/m4a")).rejects.toThrow(SttNotConfiguredError);
  });

  it("handles Groq rate limit HTTP 429 error gracefully", async () => {
    process.env.GROQ_API_KEY = "gsk_test_key_12345";
    process.env.STT_PROVIDER = "groq";

    const mockFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "Rate limit exceeded",
    });
    global.fetch = mockFetch as any;

    const dummyBuffer = Buffer.from("audio data");
    await expect(transcribeAudio(dummyBuffer, "test.m4a", "audio/m4a")).rejects.toThrow(
      /Groq Whisper rate limit exceeded/
    );
  });

  it("sanitizes API keys in error output if Groq fails with HTTP 500", async () => {
    process.env.GROQ_API_KEY = "gsk_secret_token_abc123";
    process.env.STT_PROVIDER = "groq";

    const mockFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Error with token gsk_secret_token_abc123",
    });
    global.fetch = mockFetch as any;

    const dummyBuffer = Buffer.from("audio data");
    try {
      await transcribeAudio(dummyBuffer, "test.m4a", "audio/m4a");
      fail("Should have thrown");
    } catch (err: any) {
      expect(err.message).not.toContain("gsk_secret_token_abc123");
      expect(err.message).toContain("gsk_***");
    }
  });

  it("uses OpenAI Whisper when STT_PROVIDER=whisper", async () => {
    process.env.STT_PROVIDER = "whisper";
    process.env.OPENAI_API_KEY = "sk-test-key";

    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: "Dinner 300", language: "en" }),
    });
    global.fetch = mockFetch as any;

    const dummyBuffer = Buffer.from("audio data");
    const result = await transcribeAudio(dummyBuffer, "test.m4a", "audio/m4a");

    expect(result.transcript).toBe("Dinner 300");
    expect(mockFetch.mock.calls[0][0]).toBe("https://api.openai.com/v1/audio/transcriptions");
  });
});

