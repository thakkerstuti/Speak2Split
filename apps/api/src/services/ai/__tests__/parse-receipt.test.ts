/** parseReceipt() — MOCKED providers only. Ported from the former receipts/ocr.test.ts, plus validation tests. */
import { parseReceipt, resetAiWarnings, AiInvalidInputError, AiNotConfiguredError, AiProviderError, redactSecrets } from "..";
import { URLS, calledUrls, chatText, clearAiEnv, fail, geminiText, hang, mockFetch, ok } from "./helpers";

const VISION_KEY = "AIzaVisionSecretKey_0123456789abcdef";
const GEMINI_KEY = "gem_secret_key_123";
const OPENAI_KEY = "sk-openai-secret-0123456789";
const img = () => Buffer.from("img");
const visionText = (text: string) => ok({ responses: [{ fullTextAnnotation: { text } }] });
const GOOD_RECEIPT = "CAFE COFFEE DAY\n12/03/2026\nLatte 180\nTOTAL 320.00";

describe("parseReceipt (mocked providers)", () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env = { ...originalEnv };
    clearAiEnv();
    resetAiWarnings();
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warnSpy.mockRestore());
  afterAll(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });
  const warnings = () => warnSpy.mock.calls.flat().join(" ");

  it("Google Vision (default primary) sends its key in the x-goog-api-key header, never in the URL", async () => {
    process.env.GOOGLE_VISION_API_KEY = VISION_KEY;
    const fn = mockFetch({ [URLS.vision]: () => visionText(GOOD_RECEIPT) });
    const r = await parseReceipt(img());
    expect(r.status).toBe("ok");
    expect(r.provider).toBe("google_vision");
    expect(r.data).toMatchObject({ amount: 320, merchant: "CAFE COFFEE DAY", date: "2026-03-12", amountSource: "labeled_total" });
    const [url, init] = fn.mock.calls[0] as any;
    expect(url).toBe(URLS.vision);
    expect(url).not.toContain("key=");
    expect(init.headers["x-goog-api-key"]).toBe(VISION_KEY);
  });

  it("default order is Vision → Gemini → OpenAI (same as before the refactor)", async () => {
    process.env.GOOGLE_VISION_API_KEY = VISION_KEY;
    process.env.GEMINI_API_KEY = GEMINI_KEY;
    process.env.OPENAI_API_KEY = OPENAI_KEY;
    const fn = mockFetch({
      [URLS.vision]: () => fail(500, "x"),
      [URLS.geminiPrefix]: () => fail(500, "x"),
      [URLS.openaiChat]: () => chatText(GOOD_RECEIPT),
    });
    const r = await parseReceipt(img());
    expect(r.provider).toBe("openai");
    expect(calledUrls(fn).map((u) => u.split("/")[2])).toEqual(["vision.googleapis.com", "generativelanguage.googleapis.com", "api.openai.com"]);
  });

  it("redacts the Vision key from HTTP errors and falls back to Gemini (current model, header key)", async () => {
    process.env.GOOGLE_VISION_API_KEY = VISION_KEY;
    process.env.GEMINI_API_KEY = GEMINI_KEY;
    const fn = mockFetch({
      [URLS.vision]: () => fail(403, `API key ${VISION_KEY} not valid`),
      [URLS.geminiPrefix]: () => geminiText("STORE\nTOTAL 450.00"),
    });
    const r = await parseReceipt(img());
    expect(r).toMatchObject({ status: "ok", provider: "gemini" });
    expect(r.data.amount).toBe(450);
    const [url, init] = fn.mock.calls[1] as any;
    expect(url).toBe(`${URLS.geminiPrefix}gemini-3.5-flash-lite:generateContent`);
    expect(url).not.toContain(GEMINI_KEY);
    expect(init.headers["x-goog-api-key"]).toBe(GEMINI_KEY);
    expect(warnings()).not.toContain(VISION_KEY);
  });

  it("never includes any key in the combined error when every provider fails", async () => {
    process.env.GOOGLE_VISION_API_KEY = VISION_KEY;
    process.env.GEMINI_API_KEY = GEMINI_KEY;
    process.env.OPENAI_API_KEY = OPENAI_KEY;
    mockFetch({
      [URLS.vision]: () => ok({ responses: [{ error: { message: `bad key ${VISION_KEY}` } }] }),
      [URLS.geminiPrefix]: () => fail(500, `echo ${GEMINI_KEY}`),
      [URLS.openaiChat]: () => fail(401, `Incorrect API key provided: ${OPENAI_KEY}`),
    });
    const err = await parseReceipt(img()).catch((e) => e);
    expect(err).toBeInstanceOf(AiProviderError);
    for (const key of [VISION_KEY, GEMINI_KEY, OPENAI_KEY]) expect(err.message).not.toContain(key);
    expect(err.message).toMatch(/\[google_vision\][\s\S]*\[gemini\][\s\S]*\[openai\]/);
  });

  it("turns network failures into redacted provider errors", async () => {
    process.env.GOOGLE_VISION_API_KEY = VISION_KEY;
    mockFetch({ [URLS.vision]: () => Promise.reject(new TypeError(`fetch failed for ${VISION_KEY}`)) });
    const err = await parseReceipt(img()).catch((e) => e);
    expect(err).toBeInstanceOf(AiProviderError);
    expect(err.message).not.toContain(VISION_KEY);
  });

  it("falls back on timeout (AI_RECEIPT_TIMEOUT_MS)", async () => {
    process.env.AI_RECEIPT_TIMEOUT_MS = "50";
    process.env.GOOGLE_VISION_API_KEY = VISION_KEY;
    process.env.GEMINI_API_KEY = GEMINI_KEY;
    mockFetch({ [URLS.vision]: hang, [URLS.geminiPrefix]: () => geminiText(GOOD_RECEIPT) });
    expect((await parseReceipt(img())).provider).toBe("gemini");
  });

  it("throws AiNotConfiguredError when no provider key is set", async () => {
    const fn = mockFetch({});
    await expect(parseReceipt(img())).rejects.toThrow(AiNotConfiguredError);
    expect(fn).not.toHaveBeenCalled();
  });

  it("rejects an empty image", async () => {
    await expect(parseReceipt(Buffer.alloc(0))).rejects.toThrow(AiInvalidInputError);
  });

  // ---------------- validation ----------------

  it("retries once when no total can be validated, then succeeds", async () => {
    process.env.GEMINI_API_KEY = GEMINI_KEY;
    const fn = mockFetch({ [URLS.geminiPrefix]: [geminiText("blurry text without numbers"), geminiText(GOOD_RECEIPT)] });
    const r = await parseReceipt(img());
    expect(r.status).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("returns needs_confirmation with only the valid fields after two invalid reads", async () => {
    process.env.GEMINI_API_KEY = GEMINI_KEY;
    process.env.OPENAI_API_KEY = OPENAI_KEY;
    const fn = mockFetch({ [URLS.geminiPrefix]: () => geminiText("BIG BAZAAR SUPERMARKET\nthanks"), [URLS.openaiChat]: () => chatText(GOOD_RECEIPT) });
    const r = await parseReceipt(img());
    expect(r.status).toBe("needs_confirmation");
    expect(r.provider).toBe("gemini");
    expect(fn).toHaveBeenCalledTimes(2); // one retry, no fallback for invalid output
    expect(r.data.amount).toBeNull();
    expect(r.data.merchant).toBe("BIG BAZAAR SUPERMARKET");
    expect(r.issues.join(" ")).toMatch(/amount/);
  });

  it("invalid calendar dates are dropped instead of passed on", async () => {
    process.env.GEMINI_API_KEY = GEMINI_KEY;
    mockFetch({ [URLS.geminiPrefix]: () => geminiText("SHOP\n45/13/2026\nTOTAL 99") });
    const r = await parseReceipt(img());
    expect(r.status).toBe("needs_confirmation");
    expect(r.data.date).toBeNull();
    expect(r.data.amount).toBe(99);
  });

  // ---------------- config ----------------

  it("OCR_PROVIDER still works (moves that provider to the front), with a deprecation warning", async () => {
    process.env.OCR_PROVIDER = "gemini";
    process.env.GOOGLE_VISION_API_KEY = VISION_KEY;
    process.env.GEMINI_API_KEY = GEMINI_KEY;
    const fn = mockFetch({ [URLS.geminiPrefix]: () => fail(500, "x"), [URLS.vision]: () => visionText(GOOD_RECEIPT) });
    const r = await parseReceipt(img());
    expect(r.provider).toBe("google_vision");
    expect(calledUrls(fn)[0].startsWith(URLS.geminiPrefix)).toBe(true);
    expect(warnings()).toMatch(/OCR_PROVIDER is deprecated .* AI_RECEIPT_PROVIDER/);
  });

  it("AI_RECEIPT_FALLBACK='' means no fallback", async () => {
    process.env.AI_RECEIPT_PROVIDER = "gemini";
    process.env.AI_RECEIPT_FALLBACK = "";
    process.env.GEMINI_API_KEY = GEMINI_KEY;
    process.env.GOOGLE_VISION_API_KEY = VISION_KEY;
    const fn = mockFetch({ [URLS.geminiPrefix]: () => fail(500, "x") });
    await expect(parseReceipt(img())).rejects.toThrow(AiProviderError);
    expect(calledUrls(fn).every((u) => u.startsWith(URLS.geminiPrefix))).toBe(true);
  });

  it("redactSecrets removes configured keys and key-shaped strings", () => {
    process.env.GEMINI_API_KEY = "mysecretvalue";
    const out = redactSecrets("a AIzaSyA1234567890abcdefghijkl b sk-proj-abcdefgh123 c gsk_abcdefgh1234 d mysecretvalue");
    expect(out).toBe("a *** b *** c *** d ***");
  });
});
