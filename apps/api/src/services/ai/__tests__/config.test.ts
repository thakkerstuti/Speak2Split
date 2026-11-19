/** AI config resolution: per-function providers, fallbacks, capability checks and legacy aliases. */
import { CAPABILITIES, DEFAULT_CHAINS, describeAiConfig, getApiKey, resetAiWarnings, resolveChain } from "../config";
import { clearAiEnv } from "./helpers";

describe("AI config", () => {
  const originalEnv = process.env;
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
  });
  const warnings = () => warnSpy.mock.calls.flat().join(" ");

  it("defaults reproduce today's order for every function", () => {
    expect(resolveChain("transcribe").chain).toEqual(["assemblyai", "groq", "gemini"]);
    expect(resolveChain("parseExpense").chain).toEqual(["gemini", "groq", "openai", "deepseek"]);
    expect(resolveChain("parseReceipt").chain).toEqual(["google_vision", "gemini", "openai"]);
  });

  it("no default chain contains a provider that can't do that function", () => {
    for (const [fn, chain] of Object.entries(DEFAULT_CHAINS)) {
      for (const p of chain) expect(CAPABILITIES[p]).toContain(fn);
    }
  });

  it("primary + comma-separated fallback (spaces, case and duplicates tolerated)", () => {
    process.env.AI_PARSE_PROVIDER = "Groq";
    process.env.AI_PARSE_FALLBACK = " gemini ,DEEPSEEK, groq ,gemini";
    expect(resolveChain("parseExpense").chain).toEqual(["groq", "gemini", "deepseek"]);
  });

  it("an explicit primary without a fallback keeps the other defaults as fallbacks", () => {
    process.env.AI_RECEIPT_PROVIDER = "openai";
    expect(resolveChain("parseReceipt").chain).toEqual(["openai", "google_vision", "gemini"]);
  });

  it("an empty fallback means no fallback", () => {
    process.env.AI_TRANSCRIBE_PROVIDER = "groq";
    process.env.AI_TRANSCRIBE_FALLBACK = "";
    expect(resolveChain("transcribe").chain).toEqual(["groq"]);
  });

  it("rejects providers that can't do the function (with a warning), never crashing", () => {
    process.env.AI_PARSE_PROVIDER = "assemblyai";
    process.env.AI_PARSE_FALLBACK = "google_vision,groq,anthropic";
    const r = resolveChain("parseExpense");
    expect(r.chain[0]).toBe("gemini"); // fell back to the default primary
    expect(r.chain).toContain("groq");
    expect(r.chain).not.toContain("google_vision");
    expect(r.issues.join(" ")).toMatch(/assemblyai.*can't do parseExpense/);
    expect(r.issues.join(" ")).toMatch(/google_vision can't do parseExpense/);
    expect(r.issues.join(" ")).toMatch(/"anthropic" is not a known provider/);
  });

  it("legacy STT_PROVIDER pins one provider with no fallback, and warns once", () => {
    process.env.STT_PROVIDER = "gemini";
    expect(resolveChain("transcribe").chain).toEqual(["gemini"]);
    resolveChain("transcribe");
    expect(warnSpy.mock.calls.filter((c) => String(c[0]).includes("STT_PROVIDER is deprecated"))).toHaveLength(1);
  });

  it("the new variable wins over the legacy one", () => {
    process.env.STT_PROVIDER = "gemini";
    process.env.AI_TRANSCRIBE_PROVIDER = "groq";
    expect(resolveChain("transcribe").chain[0]).toBe("groq");
    expect(warnings()).not.toMatch(/STT_PROVIDER is deprecated/);
  });

  it("legacy key aliases resolve with a deprecation warning", () => {
    process.env.GROQ_KEY = "gsk_legacy_0000000";
    expect(getApiKey("groq")).toBe("gsk_legacy_0000000");
    expect(warnings()).toMatch(/GROQ_KEY is deprecated .* GROQ_API_KEY/);
  });

  it("describeAiConfig marks providers without keys", () => {
    process.env.GEMINI_API_KEY = "gem_test";
    expect(describeAiConfig()).toContain("parseReceipt: google_vision (no key) → gemini → openai (no key)");
  });
});
