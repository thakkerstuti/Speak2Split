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
});
