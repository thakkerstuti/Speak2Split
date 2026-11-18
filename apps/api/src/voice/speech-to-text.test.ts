import { transcribeAudio, SttNotConfiguredError, SttTranscriptionError } from "./speech-to-text";

describe("speech-to-text integration", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
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

  it("throws SttTranscriptionError for empty audio without calling any provider", async () => {
    process.env.GROQ_API_KEY = "gsk_test_key_12345";
    const mockFetch = jest.fn();
    global.fetch = mockFetch as any;

    await expect(transcribeAudio(Buffer.alloc(0), "test.m4a", "audio/m4a")).rejects.toThrow(SttTranscriptionError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("uses Groq first in the automatic cascade when STT_PROVIDER is not set", async () => {
    process.env.GROQ_API_KEY = "gsk_test_key_12345";
    process.env.OPENAI_API_KEY = "sk-test-key";
    process.env.GEMINI_API_KEY = "gemini-test-key";

    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: "Paid 900 for groceries with Aisha", language: "en" }),
    });
    global.fetch = mockFetch as any;

    const result = await transcribeAudio(Buffer.from("audio data"), "test.m4a", "audio/m4a");

    expect(result.transcript).toBe("Paid 900 for groceries with Aisha");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect(mockFetch.mock.calls[0][1].headers.authorization).toBe("Bearer gsk_test_key_12345");
  });

  it("falls back to OpenAI Whisper when Groq fails in the automatic cascade", async () => {
    process.env.GROQ_API_KEY = "gsk_test_key_12345";
    process.env.OPENAI_API_KEY = "sk-test-key";

    const mockFetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => "Internal error" })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ text: "Taxi 250", language: "en" }) });
    global.fetch = mockFetch as any;

    const result = await transcribeAudio(Buffer.from("audio data"), "test.m4a", "audio/m4a");

    expect(result.transcript).toBe("Taxi 250");
    expect(mockFetch.mock.calls[0][0]).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect(mockFetch.mock.calls[1][0]).toBe("https://api.openai.com/v1/audio/transcriptions");
  });

  it("falls back to the next provider when Groq has a network error", async () => {
    process.env.GROQ_API_KEY = "gsk_test_key_12345";
    process.env.OPENAI_API_KEY = "sk-test-key";

    const mockFetch = jest
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ text: "Lunch 400" }) });
    global.fetch = mockFetch as any;

    const result = await transcribeAudio(Buffer.from("audio data"), "test.m4a", "audio/m4a");
    expect(result.transcript).toBe("Lunch 400");
  });

  it("reports every provider error when all configured providers fail", async () => {
    process.env.GROQ_API_KEY = "gsk_test_key_12345";
    process.env.OPENAI_API_KEY = "sk-test-key";

    const mockFetch = jest.fn().mockResolvedValue({ ok: false, status: 503, text: async () => "Unavailable" });
    global.fetch = mockFetch as any;

    await expect(transcribeAudio(Buffer.from("audio data"), "test.m4a", "audio/m4a")).rejects.toThrow(
      /All transcription providers failed[\s\S]*\[groq\][\s\S]*\[whisper\]/
    );
  });

  it("ignores a legacy/unknown STT_PROVIDER value and uses the cascade (Groq first)", async () => {
    process.env.STT_PROVIDER = "gnani";
    process.env.GROQ_API_KEY = "gsk_test_key_12345";
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    const mockFetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ text: "Rent 15000" }) });
    global.fetch = mockFetch as any;

    const result = await transcribeAudio(Buffer.from("audio data"), "test.m4a", "audio/m4a");
    expect(result.transcript).toBe("Rent 15000");
    expect(mockFetch.mock.calls[0][0]).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    warn.mockRestore();
  });
});
