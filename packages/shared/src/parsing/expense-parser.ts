/**
 * Natural Language Expense Parser
 *
 * Converts a raw utterance (typed or transcribed from voice) into a
 * structured, but NOT yet person-resolved, expense draft. Name resolution
 * is deliberately a separate downstream step (see resolution/name-resolver.ts)
 * — this parser only extracts *raw name mentions* as strings; it never
 * decides which actual person "Vanshika" refers to.
 *
 * This calls out to an LLM (Claude, via the Anthropic Messages API) with a
 * strict JSON-only response contract, because regex/keyword parsing cannot
 * reliably handle the range of phrasing in the spec ("I paid the whole bill
 * but split it equally between the four of us", multi-payer sentences,
 * implicit dates like "yesterday", etc).
 *
 * Requires ANTHROPIC_API_KEY to be set server-side. Never call this from
 * the client — the API key must never leave the backend.
 */

export interface ParsedExpenseDraft {
  title: string;
  amount: number | null;
  currency: string;
  category: string;
  /** Raw name mentions exactly as spoken — NOT resolved to user IDs. */
  payerMentions: RawPayerMention[];
  participantMentions: string[]; // includes "me"/"I" as a literal token; resolved by caller
  splitMethod: "EQUAL" | "EXACT" | "PERCENTAGE" | "SHARES";
  exactShares?: Record<string, number>; // rawMention -> amount, only if EXACT stated explicitly
  percentageShares?: Record<string, number>;
  shareUnits?: Record<string, number>;
  dateHint: string | null; // e.g. "yesterday", "2024-06-01" — resolved by caller to an actual Date
  notes: string | null;
  recurring: {
    isRecurring: boolean;
    frequency?: "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "YEARLY";
  };
  parseConfidence: number; // 0-1, overall confidence the model has in this extraction
  ambiguityNotes: string[]; // anything the model flagged as unclear
}

export interface RawPayerMention {
  mention: string; // "me", "Vanshika", etc.
  amountPaid: number | null; // null if not explicitly stated (implies "the rest" or needs inference)
}

const SYSTEM_PROMPT = `You are the expense-parsing engine inside Speak2Split, a shared-expense app.
Extract a structured expense from the user's natural-language sentence about a shared expense.

Rules:
- Output ONLY valid JSON matching the schema below. No prose, no markdown fences.
- Never guess a specific full name if the user only said a first name — copy the mention exactly as spoken (e.g. "Vanshika"). A separate system resolves who that actually is.
- "me"/"I"/"myself" should be included as the literal string "me" in payerMentions/participantMentions — do not try to resolve it.
- If the split method is not stated, default to "EQUAL".
- If amount or payer breakdown is genuinely ambiguous, lower parseConfidence and add a note to ambiguityNotes — do not invent numbers.
- dateHint should capture relative or absolute date language exactly as implied ("yesterday", "last Friday", "2024-06-01"), or null if the expense is for today/unspecified.
- category should be a short lowercase label (e.g. "electricity", "groceries", "hotel", "taxi", "rent", "general").

JSON schema:
{
  "title": string,
  "amount": number | null,
  "currency": string,           // ISO code, default "INR" unless stated otherwise
  "category": string,
  "payerMentions": [{ "mention": string, "amountPaid": number | null }],
  "participantMentions": string[],
  "splitMethod": "EQUAL" | "EXACT" | "PERCENTAGE" | "SHARES",
  "exactShares": { [mention: string]: number } | null,
  "percentageShares": { [mention: string]: number } | null,
  "shareUnits": { [mention: string]: number } | null,
  "dateHint": string | null,
  "notes": string | null,
  "recurring": { "isRecurring": boolean, "frequency": "DAILY"|"WEEKLY"|"BIWEEKLY"|"MONTHLY"|"YEARLY"|null },
  "parseConfidence": number,
  "ambiguityNotes": string[]
}`;

export interface LlmClient {
  /** Returns the raw text content of the model's response. */
  complete(system: string, userMessage: string): Promise<string>;
}

/**
 * Default LLM client backed by the Anthropic Messages API.
 * Configure via ANTHROPIC_API_KEY. Model is configurable so this can be
 * swapped between a fast/cheap model for parsing and a stronger one if needed.
 */
export class AnthropicLlmClient implements LlmClient {
  constructor(
    private readonly apiKey: string = process.env.ANTHROPIC_API_KEY ?? "",
    private readonly model: string = process.env.EXPENSE_PARSER_MODEL ?? "claude-sonnet-4-6"
  ) {}

  async complete(system: string, userMessage: string): Promise<string> {
    if (!this.apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not configured. Set it in the backend .env — see ENVIRONMENT.md."
      );
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        system,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${body}`);
    }

    const data = (await response.json()) as { content: Array<{ type: string; text?: string }> };
    const textBlock = data.content.find((b) => b.type === "text");
    if (!textBlock?.text) {
      throw new Error("Anthropic API returned no text content for expense parsing");
    }
    return textBlock.text;
  }
}

export class ExpenseParseError extends Error {
  constructor(message: string, public readonly rawResponse?: string) {
    super(message);
    this.name = "ExpenseParseError";
  }
}

function stripCodeFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
}

export async function parseExpenseUtterance(
  utterance: string,
  llm: LlmClient = new AnthropicLlmClient()
): Promise<ParsedExpenseDraft> {
  if (!utterance || utterance.trim().length === 0) {
    throw new ExpenseParseError("Empty utterance provided to expense parser");
  }

  const raw = await llm.complete(SYSTEM_PROMPT, utterance);
  const cleaned = stripCodeFences(raw);

  let parsed: ParsedExpenseDraft;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new ExpenseParseError(`Model did not return valid JSON: ${(err as Error).message}`, raw);
  }

  // Defensive normalization — never trust the model's output shape blindly.
  if (!parsed.title || typeof parsed.title !== "string") parsed.title = "Expense";
  if (!Array.isArray(parsed.payerMentions)) parsed.payerMentions = [];
  if (!Array.isArray(parsed.participantMentions)) parsed.participantMentions = [];
  if (!["EQUAL", "EXACT", "PERCENTAGE", "SHARES"].includes(parsed.splitMethod)) {
    parsed.splitMethod = "EQUAL";
  }
  if (!parsed.currency) parsed.currency = "INR";
  if (!parsed.category) parsed.category = "general";
  if (typeof parsed.parseConfidence !== "number") parsed.parseConfidence = 0.5;
  if (!Array.isArray(parsed.ambiguityNotes)) parsed.ambiguityNotes = [];
  if (!parsed.recurring || typeof parsed.recurring !== "object") {
    parsed.recurring = { isRecurring: false };
  }

  return parsed;
}
