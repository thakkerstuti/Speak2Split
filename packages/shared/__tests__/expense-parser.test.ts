import { parseExpenseUtterance, ExpenseParseError, LlmClient } from "../src/parsing/expense-parser";

class FakeLlmClient implements LlmClient {
  constructor(private readonly response: string) {}
  async complete(): Promise<string> {
    return this.response;
  }
}

describe("expense parser", () => {
  it("parses a well-formed model response for a simple statement", async () => {
    const fake = new FakeLlmClient(
      JSON.stringify({
        title: "Electricity",
        amount: 2400,
        currency: "INR",
        category: "electricity",
        payerMentions: [{ mention: "me", amountPaid: 2400 }],
        participantMentions: ["me", "Vanshika", "Ishika"],
        splitMethod: "EQUAL",
        exactShares: null,
        percentageShares: null,
        shareUnits: null,
        dateHint: null,
        notes: null,
        recurring: { isRecurring: false },
        parseConfidence: 0.95,
        ambiguityNotes: [],
      })
    );

    const draft = await parseExpenseUtterance("I paid 2400 for electricity. Me, Vanshika and Ishika are splitting it.", fake);
    expect(draft.amount).toBe(2400);
    expect(draft.participantMentions).toEqual(["me", "Vanshika", "Ishika"]);
    expect(draft.splitMethod).toBe("EQUAL");
  });

  it("strips markdown code fences some models wrap JSON in", async () => {
    const fake = new FakeLlmClient(
      "```json\n" +
        JSON.stringify({
          title: "Groceries",
          amount: 500,
          currency: "INR",
          category: "groceries",
          payerMentions: [{ mention: "me", amountPaid: 500 }],
          participantMentions: ["me"],
          splitMethod: "EQUAL",
          dateHint: null,
          notes: null,
          recurring: { isRecurring: false },
          parseConfidence: 0.9,
          ambiguityNotes: [],
        }) +
        "\n```"
    );
    const draft = await parseExpenseUtterance("I paid 500 for groceries", fake);
    expect(draft.title).toBe("Groceries");
  });

  it("normalizes a malformed/partial response defensively rather than crashing", async () => {
    const fake = new FakeLlmClient(JSON.stringify({ amount: 1000 }));
    const draft = await parseExpenseUtterance("something ambiguous", fake);
    expect(draft.title).toBe("Expense");
    expect(draft.splitMethod).toBe("EQUAL");
    expect(draft.currency).toBe("INR");
    expect(Array.isArray(draft.payerMentions)).toBe(true);
  });

  it("throws ExpenseParseError on genuinely invalid JSON", async () => {
    const fake = new FakeLlmClient("this is not json at all");
    await expect(parseExpenseUtterance("test", fake)).rejects.toThrow(ExpenseParseError);
  });

  it("rejects empty utterances before calling the model", async () => {
    const fake = new FakeLlmClient("{}");
    await expect(parseExpenseUtterance("   ", fake)).rejects.toThrow(ExpenseParseError);
  });

  it("captures multi-payer statements", async () => {
    const fake = new FakeLlmClient(
      JSON.stringify({
        title: "Hotel",
        amount: 2500,
        currency: "INR",
        category: "hotel",
        payerMentions: [
          { mention: "Vanshika", amountPaid: 1000 },
          { mention: "me", amountPaid: 1500 },
        ],
        participantMentions: ["me", "Vanshika"],
        splitMethod: "EQUAL",
        dateHint: null,
        notes: null,
        recurring: { isRecurring: false },
        parseConfidence: 0.92,
        ambiguityNotes: [],
      })
    );
    const draft = await parseExpenseUtterance("Vanshika paid 1000 and I paid 1500 for the hotel.", fake);
    expect(draft.payerMentions).toHaveLength(2);
    expect(draft.payerMentions.reduce((s, p) => s + (p.amountPaid ?? 0), 0)).toBe(2500);
  });
});
