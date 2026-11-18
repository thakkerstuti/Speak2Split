import { runOcr, DEFAULT_GEMINI_MODEL, OcrError, OcrNotConfiguredError, redactSecrets } from "./ocr";

/** Mocked fetch only — no real OCR provider is called. */
describe("receipt OCR providers", () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;
  const VISION_KEY = "AIzaVisionSecretKey_0123456789abcdef";
  const GEMINI_KEY = "gem_secret_key_123";
  const OPENAI_KEY = "sk-openai-secret-0123456789";

  beforeEach(() => {
    process.env = { ...originalEnv };
    for (const k of ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GEMINI_MODEL", "GOOGLE_VISION_API_KEY", "GOOGLE_SPEECH_API_KEY", "OPENAI_API_KEY", "OCR_PROVIDER"]) {
      delete process.env[k];
    }
  });
  afterAll(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  const visionOk = { ok: true, json: async () => ({ responses: [{ fullTextAnnotation: { text: "CAFE\nTOTAL 320.00" } }] }) };
  const geminiOk = { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "STORE\nTOTAL 450.00" }] } }] }) };

  // ---- Google Vision ----
  it("Google Vision sends the key in the x-goog-api-key header, never in the URL", async () => {
    process.env.GOOGLE_VISION_API_KEY = VISION_KEY;
    const mockFetch = jest.fn().mockResolvedValue(visionOk);
    global.fetch = mockFetch as any;

    expect(await runOcr(Buffer.from("img"))).toContain("TOTAL 320.00");
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://vision.googleapis.com/v1/images:annotate");
    expect(url).not.toContain("key=");
    expect(url).not.toContain(VISION_KEY);
    expect(init.headers["x-goog-api-key"]).toBe(VISION_KEY);
  });

  it("redacts the Vision key from HTTP error bodies and falls back to Gemini", async () => {
    process.env.GOOGLE_VISION_API_KEY = VISION_KEY;
    process.env.GEMINI_API_KEY = GEMINI_KEY;
    const mockFetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 403, text: async () => `API key ${VISION_KEY} not valid` })
      .mockResolvedValueOnce(geminiOk);
    global.fetch = mockFetch as any;

    expect(await runOcr(Buffer.from("img"))).toContain("TOTAL 450.00");
    expect(mockFetch.mock.calls[1][0]).toContain(`/models/${DEFAULT_GEMINI_MODEL}:generateContent`);
  });

  it("never includes any key in the combined error when every provider fails", async () => {
    process.env.GOOGLE_VISION_API_KEY = VISION_KEY;
    process.env.GEMINI_API_KEY = GEMINI_KEY;
    process.env.OPENAI_API_KEY = OPENAI_KEY;
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ responses: [{ error: { message: `bad key ${VISION_KEY}` } }] }) })
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => `echo ${GEMINI_KEY}` })
      .mockResolvedValueOnce({ ok: false, status: 401, text: async () => `Incorrect API key provided: ${OPENAI_KEY}` }) as any;

    const err = await runOcr(Buffer.from("img")).catch((e) => e);
    expect(err).toBeInstanceOf(OcrError);
    for (const key of [VISION_KEY, GEMINI_KEY, OPENAI_KEY]) expect(err.message).not.toContain(key);
    expect(err.message).toMatch(/\[google_vision\][\s\S]*\[gemini\][\s\S]*\[openai\]/);
  });

  it("turns network failures into redacted OcrErrors", async () => {
    process.env.GOOGLE_VISION_API_KEY = VISION_KEY;
    global.fetch = jest.fn().mockRejectedValue(new TypeError(`fetch failed for ${VISION_KEY}`)) as any;
    const err = await runOcr(Buffer.from("img")).catch((e) => e);
    expect(err).toBeInstanceOf(OcrError);
    expect(err.message).not.toContain(VISION_KEY);
  });

  it("throws OcrNotConfiguredError when no provider key is set", async () => {
    global.fetch = jest.fn() as any;
    await expect(runOcr(Buffer.from("img"))).rejects.toThrow(OcrNotConfiguredError);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // ---- Gemini ----
  it("Gemini uses the current default model with the key in a header", async () => {
    process.env.GEMINI_API_KEY = GEMINI_KEY;
    process.env.OCR_PROVIDER = "gemini";
    const mockFetch = jest.fn().mockResolvedValue(geminiOk);
    global.fetch = mockFetch as any;

    const text = await runOcr(Buffer.from("img"));
    expect(text).toContain("TOTAL 450.00");
    const [url, init] = mockFetch.mock.calls[0];
    expect(DEFAULT_GEMINI_MODEL).toBe("gemini-3.5-flash-lite");
    expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODEL}:generateContent`);
    expect(url).not.toContain(GEMINI_KEY);
    expect(init.headers["x-goog-api-key"]).toBe(GEMINI_KEY);
  });

  it("Gemini honours GEMINI_MODEL and redacts the key from errors", async () => {
    process.env.GEMINI_API_KEY = GEMINI_KEY;
    process.env.GEMINI_MODEL = "gemini-3.6-flash";
    process.env.OCR_PROVIDER = "gemini";
    const mockFetch = jest.fn().mockResolvedValue({ ok: false, status: 500, text: async () => `bad key ${GEMINI_KEY}` });
    global.fetch = mockFetch as any;

    const err = await runOcr(Buffer.from("img")).catch((e) => e);
    expect(err).toBeInstanceOf(OcrError);
    expect(err.message).not.toContain(GEMINI_KEY);
    expect(mockFetch.mock.calls[0][0]).toContain("/models/gemini-3.6-flash:generateContent");
  });

  // ---- redaction helper ----
  it("redactSecrets removes configured secrets and key-shaped strings", () => {
    const out = redactSecrets("a AIzaSyA1234567890abcdefghijkl b sk-proj-abcdefgh123 c gsk_abcdefgh1234 d mysecretvalue", ["mysecretvalue"]);
    expect(out).toBe("a *** b *** c *** d ***");
  });
});
