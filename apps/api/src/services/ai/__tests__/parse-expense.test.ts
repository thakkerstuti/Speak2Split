/** parseExpense() — MOCKED providers only (global.fetch is a jest mock). */
import { parseExpense, resetAiWarnings, AiInvalidInputError } from "..";
import { URLS, calledUrls, chatText, clearAiEnv, fail, geminiText, hang, mockFetch } from "./helpers";

const validDraft = {
  title: "Dinner",
  amount: 1200,
  currency: "INR",
  category: "food",
  payerMentions: [{ mention: "me", amountPaid: 1200 }],
  participantMentions: ["me", "Rahul", "Aisha"],
  splitMethod: "EQUAL",
  exactShares: null,
  percentageShares: null,
  shareUnits: null,
  dateHint: null,
  notes: null,
  recurring: { isRecurring: false, frequency: null },
  parseConfidence: 0.92,
  ambiguityNotes: [],
};
const json = (o: unknown) => JSON.stringify(o);

describe("parseExpense (mocked providers)", () => {
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

  it("returns a validated draft with status ok (Gemini primary, key in header)", async () => {
    process.env.GEMINI_API_KEY = "gem_secret_key";
    const fn = mockFetch({ [URLS.geminiPrefix]: () => geminiText(json(validDraft)) });

    const r = await parseExpense("Dinner 1200 with Rahul and Aisha");

    expect(r.status).toBe("ok");
    expect(r.provider).toBe("gemini");
    expect(r.data).toMatchObject({ title: "Dinner", amount: 1200, splitMethod: "EQUAL", participantMentions: ["me", "Rahul", "Aisha"] });
    const [url, init] = fn.mock.calls[0] as any;
    expect(url).toBe(`${URLS.geminiPrefix}gemini-3.5-flash-lite:generateContent`);
    expect(url).not.toContain("gem_secret_key");
    expect(init.headers["x-goog-api-key"]).toBe("gem_secret_key");
    expect(JSON.parse(init.body).generationConfig).toEqual({ responseMimeType: "application/json" });
  });

  it("strips markdown code fences around the JSON", async () => {
    process.env.GEMINI_API_KEY = "gem_test";
    mockFetch({ [URLS.geminiPrefix]: () => geminiText("```json\n" + json(validDraft) + "\n```") });
    expect((await parseExpense("Dinner 1200")).status).toBe("ok");
  });

  it("accepts numbers sent as strings like \"2,400\"", async () => {
    process.env.GEMINI_API_KEY = "gem_test";
    mockFetch({ [URLS.geminiPrefix]: () => geminiText(json({ ...validDraft, amount: "2,400", payerMentions: [{ mention: "me", amountPaid: "2,400" }] })) });
    const r = await parseExpense("Rent 2,400");
    expect(r.status).toBe("ok");
    expect(r.data.amount).toBe(2400);
  });

  // ---------------- fallback on error / timeout ----------------

  it("falls back to Groq when Gemini errors", async () => {
    process.env.GEMINI_API_KEY = "gem_test";
    process.env.GROQ_API_KEY = "gsk_test";
    const fn = mockFetch({ [URLS.geminiPrefix]: () => fail(503, "overloaded"), [URLS.groqChat]: () => chatText(json(validDraft)) });
    const r = await parseExpense("Dinner 1200");
    expect(r).toMatchObject({ status: "ok", provider: "groq" });
    const body = JSON.parse((fn.mock.calls[1][1] as any).body);
    expect(body.model).toBe("llama-3.3-70b-versatile");
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("falls back on timeout (AI_PARSE_TIMEOUT_MS)", async () => {
    process.env.AI_PARSE_TIMEOUT_MS = "50";
    process.env.GEMINI_API_KEY = "gem_test";
    process.env.GROQ_API_KEY = "gsk_test";
    mockFetch({ [URLS.geminiPrefix]: hang, [URLS.groqChat]: () => chatText(json(validDraft)) });
    const r = await parseExpense("Dinner 1200");
    expect(r.provider).toBe("groq");
    expect(warnings()).toMatch(/gemini failed.*timed out/);
  });

  it("default chain continues to OpenAI then DeepSeek when keys exist (today's order)", async () => {
    process.env.GEMINI_API_KEY = "gem_test";
    process.env.GROQ_API_KEY = "gsk_test";
    process.env.OPENAI_API_KEY = "sk-test-openai-000000";
    process.env.DEEPSEEK_API_KEY = "sk-test-deepseek-0000";
    const fn = mockFetch({
      [URLS.geminiPrefix]: () => fail(500, "x"),
      [URLS.groqChat]: () => fail(500, "x"),
      [URLS.openaiChat]: () => fail(500, "x"),
      [URLS.deepseekChat]: () => chatText(json(validDraft)),
    });
    const r = await parseExpense("Dinner 1200");
    expect(r.provider).toBe("deepseek");
    expect(calledUrls(fn).map((u) => u.split("/")[2])).toEqual([
      "generativelanguage.googleapis.com",
      "api.groq.com",
      "api.openai.com",
      "api.deepseek.com",
    ]);
  });

  it("never calls Anthropic, even if ANTHROPIC_API_KEY is set (provider removed)", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-should-never-be-used-000000";
    const fn = mockFetch({});
    const r = await parseExpense("Dinner 1200 with Rahul");
    expect(r.provider).toBe("heuristic");
    expect(calledUrls(fn)).not.toContain(URLS.anthropic);
    expect(fn).not.toHaveBeenCalled();
  });

  it("AI_PARSE_PROVIDER / AI_PARSE_FALLBACK choose the providers", async () => {
    process.env.AI_PARSE_PROVIDER = "deepseek";
    process.env.AI_PARSE_FALLBACK = "groq";
    process.env.DEEPSEEK_API_KEY = "sk-test-deepseek-0000";
    process.env.GROQ_API_KEY = "gsk_test";
    process.env.GEMINI_API_KEY = "gem_test";
    const fn = mockFetch({ [URLS.deepseekChat]: () => fail(500, "x"), [URLS.groqChat]: () => chatText(json(validDraft)) });
    expect((await parseExpense("Dinner 1200")).provider).toBe("groq");
    expect(calledUrls(fn)).toEqual([URLS.deepseekChat, URLS.groqChat]); // Gemini not in the chain
  });

  // ---------------- validation: retry once, then needs_confirmation ----------------

  it("retries once when the reply fails validation, telling the model what was wrong", async () => {
    process.env.GEMINI_API_KEY = "gem_test";
    const fn = mockFetch({
      [URLS.geminiPrefix]: [geminiText(json({ ...validDraft, splitMethod: "HALF_HALF" })), geminiText(json(validDraft))],
    });
    const r = await parseExpense("Dinner 1200");
    expect(r.status).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    const retryPrompt = JSON.parse((fn.mock.calls[1][1] as any).body).contents[0].parts[0].text;
    expect(retryPrompt).toMatch(/did not match the schema: splitMethod/);
  });

  it("returns needs_confirmation with only the valid fields after a second invalid reply", async () => {
    process.env.GEMINI_API_KEY = "gem_test";
    process.env.GROQ_API_KEY = "gsk_test";
    const bad = { ...validDraft, amount: -50, splitMethod: "HALF_HALF" };
    const fn = mockFetch({ [URLS.geminiPrefix]: () => geminiText(json(bad)), [URLS.groqChat]: () => chatText(json(validDraft)) });

    const r = await parseExpense("Dinner 1200");

    expect(r.status).toBe("needs_confirmation");
    expect(r.provider).toBe("gemini");
    expect(fn).toHaveBeenCalledTimes(2); // exactly one retry, no fallback for invalid output
    expect(r.issues.join(" ")).toMatch(/amount/);
    expect(r.issues.join(" ")).toMatch(/splitMethod/);
    expect(r.data.amount).toBeNull(); // invalid value dropped, not passed on
    expect(r.data.splitMethod).toBe("EQUAL"); // safe default
    expect(r.data.title).toBe("Dinner"); // valid field kept
    expect(r.data.participantMentions).toEqual(["me", "Rahul", "Aisha"]);
  });

  it("non-JSON replies count as invalid (retry, then needs_confirmation)", async () => {
    process.env.GEMINI_API_KEY = "gem_test";
    mockFetch({ [URLS.geminiPrefix]: () => geminiText("Sure! The amount was 1200.") });
    const r = await parseExpense("Dinner 1200");
    expect(r.status).toBe("needs_confirmation");
    expect(r.issues).toEqual(["reply was not valid JSON"]);
  });

  it("cross-field checks: percentages that don't add to 100 are rejected", async () => {
    process.env.GEMINI_API_KEY = "gem_test";
    const bad = { ...validDraft, splitMethod: "PERCENTAGE", percentageShares: { me: 60, Rahul: 30 } };
    mockFetch({ [URLS.geminiPrefix]: () => geminiText(json(bad)) });
    const r = await parseExpense("Dinner 1200 60/30");
    expect(r.status).toBe("needs_confirmation");
    expect(r.issues.join(" ")).toMatch(/percentages add up to 90/);
    expect(r.data.percentageShares).toBeUndefined();
  });

  it("cross-field checks: payer amounts must add up to the total", async () => {
    process.env.GEMINI_API_KEY = "gem_test";
    const bad = { ...validDraft, payerMentions: [{ mention: "me", amountPaid: 500 }, { mention: "Rahul", amountPaid: 500 }] };
    mockFetch({ [URLS.geminiPrefix]: () => geminiText(json(bad)) });
    const r = await parseExpense("Dinner 1200");
    expect(r.status).toBe("needs_confirmation");
    expect(r.data.payerMentions).toEqual([]);
  });

  // ---------------- offline heuristic ----------------

  it("uses the offline heuristic when no provider is configured — always needs_confirmation", async () => {
    const fn = mockFetch({});
    const r = await parseExpense("Dinner 1200 with Rahul");
    expect(fn).not.toHaveBeenCalled();
    expect(r).toMatchObject({ status: "needs_confirmation", provider: "heuristic" });
    expect(r.data.amount).toBe(1200);
    expect(r.data.participantMentions).toContain("Rahul");
    expect(r.issues[0]).toMatch(/isn't configured/);
  });

  it("uses the offline heuristic when every provider fails — without leaking provider details", async () => {
    process.env.GEMINI_API_KEY = "gem_secret_value";
    process.env.GROQ_API_KEY = "gsk_test";
    mockFetch({ [URLS.geminiPrefix]: () => fail(500, "boom gem_secret_value"), [URLS.groqChat]: () => fail(500, "boom") });
    const r = await parseExpense("Taxi 500");
    expect(r).toMatchObject({ status: "needs_confirmation", provider: "heuristic" });
    expect(r.issues[0]).toMatch(/temporarily unavailable/);
    expect(JSON.stringify(r)).not.toContain("gem_secret_value");
    expect(warnings()).not.toContain("gem_secret_value");
  });

  it("rejects empty text before calling any provider", async () => {
    process.env.GEMINI_API_KEY = "gem_test";
    const fn = mockFetch({});
    await expect(parseExpense("   ")).rejects.toThrow(AiInvalidInputError);
    expect(fn).not.toHaveBeenCalled();
  });

  // ---------------- config aliases ----------------

  it("GEMINI_MODEL still works as an alias for AI_GEMINI_MODEL, with a deprecation warning", async () => {
    process.env.GEMINI_API_KEY = "gem_test";
    process.env.GEMINI_MODEL = "gemini-3.6-flash";
    const fn = mockFetch({ [URLS.geminiPrefix]: () => geminiText(json(validDraft)) });
    await parseExpense("Dinner 1200");
    expect(calledUrls(fn)[0]).toContain("/models/gemini-3.6-flash:generateContent");
    expect(warnings()).toMatch(/GEMINI_MODEL is deprecated .* AI_GEMINI_MODEL/);
  });

  it("GOOGLE_API_KEY still works for Gemini, with a deprecation warning", async () => {
    process.env.GOOGLE_API_KEY = "AIzaLegacyGoogleKey_0123456789";
    const fn = mockFetch({ [URLS.geminiPrefix]: () => geminiText(json(validDraft)) });
    expect((await parseExpense("Dinner 1200")).status).toBe("ok");
    expect((fn.mock.calls[0][1] as any).headers["x-goog-api-key"]).toBe("AIzaLegacyGoogleKey_0123456789");
    expect(warnings()).toMatch(/GOOGLE_API_KEY is deprecated .* GEMINI_API_KEY/);
  });
});
