import { MultiProviderLlmClient, DEFAULT_GEMINI_MODEL } from "../src/parsing/expense-parser";

/** Mocked fetch only — no real Gemini call is made. */
describe("expense parser Gemini model", () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
    for (const k of ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GEMINI_MODEL", "GROQ_API_KEY", "GROQ_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "DEEPSEEK_API_KEY"]) {
      delete process.env[k];
    }
  });
  afterAll(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  const okResponse = { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"title":"x"}' }] } }] }) };

  it("defaults to a current model (not the retired gemini-1.5-flash) and keeps the key out of the URL", async () => {
    process.env.GEMINI_API_KEY = "gem_secret";
    const mockFetch = jest.fn().mockResolvedValue(okResponse);
    global.fetch = mockFetch as any;

    await new MultiProviderLlmClient().complete("system", "Dinner 500");

    const [url, init] = mockFetch.mock.calls[0];
    expect(DEFAULT_GEMINI_MODEL).toBe("gemini-3.5-flash-lite");
    expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODEL}:generateContent`);
    expect(url).not.toContain("gemini-1.5");
    expect(url).not.toContain("gem_secret");
    expect(init.headers["x-goog-api-key"]).toBe("gem_secret");
  });

  it("honours GEMINI_MODEL", async () => {
    process.env.GEMINI_API_KEY = "gem_secret";
    process.env.GEMINI_MODEL = "gemini-3.6-flash";
    const mockFetch = jest.fn().mockResolvedValue(okResponse);
    global.fetch = mockFetch as any;

    await new MultiProviderLlmClient().complete("system", "Dinner 500");
    expect(mockFetch.mock.calls[0][0]).toContain("/models/gemini-3.6-flash:generateContent");
  });

  it("redacts the key if Gemini echoes it in an error, then falls back to the heuristic", async () => {
    process.env.GEMINI_API_KEY = "gem_secret";
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404, text: async () => "model not found for key gem_secret" }) as any;
    const out = await new MultiProviderLlmClient().complete("system", "Dinner 500 with Rahul");
    expect(JSON.parse(out).amount).toBe(500);
  });
});
