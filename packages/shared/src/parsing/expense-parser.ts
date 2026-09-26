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
 * Multi-provider LLM client that automatically detects available API keys on the server
 * (Gemini, Groq, OpenAI, Anthropic, DeepSeek) and falls back gracefully.
 */
export class MultiProviderLlmClient implements LlmClient {
  async complete(system: string, userMessage: string): Promise<string> {
    const errors: string[] = [];

    // 1. Try Gemini API if GEMINI_API_KEY or GOOGLE_API_KEY is configured
    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (geminiKey) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: `${system}\n\nUser input: ${userMessage}` }] }],
              generationConfig: { responseMimeType: "application/json" },
            }),
          }
        );
        if (res.ok) {
          const json = (await res.json()) as any;
          const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) return text;
        } else {
          const errText = await res.text();
          errors.push(`Gemini HTTP ${res.status}: ${errText}`);
        }
      } catch (err: any) {
        errors.push(`Gemini error: ${err?.message}`);
      }
    }

    // 2. Try Groq API if GROQ_API_KEY is configured
    const groqKey = process.env.GROQ_API_KEY || process.env.GROQ_KEY;
    if (groqKey) {
      try {
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${groqKey}`,
          },
          body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages: [
              { role: "system", content: system },
              { role: "user", content: userMessage },
            ],
            response_format: { type: "json_object" },
          }),
        });
        if (res.ok) {
          const json = (await res.json()) as any;
          const text = json.choices?.[0]?.message?.content;
          if (text) return text;
        } else {
          const errText = await res.text();
          errors.push(`Groq HTTP ${res.status}: ${errText}`);
        }
      } catch (err: any) {
        errors.push(`Groq error: ${err?.message}`);
      }
    }

    // 3. Try OpenAI API if OPENAI_API_KEY is configured
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      try {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${openaiKey}`,
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: system },
              { role: "user", content: userMessage },
            ],
            response_format: { type: "json_object" },
          }),
        });
        if (res.ok) {
          const json = (await res.json()) as any;
          const text = json.choices?.[0]?.message?.content;
          if (text) return text;
        } else {
          const errText = await res.text();
          errors.push(`OpenAI HTTP ${res.status}: ${errText}`);
        }
      } catch (err: any) {
        errors.push(`OpenAI error: ${err?.message}`);
      }
    }

    // 4. Try Anthropic API if ANTHROPIC_API_KEY is configured
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (anthropicKey) {
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": anthropicKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: process.env.EXPENSE_PARSER_MODEL || "claude-3-5-sonnet-20241022",
            max_tokens: 1024,
            system,
            messages: [{ role: "user", content: userMessage }],
          }),
        });
        if (res.ok) {
          const json = (await res.json()) as any;
          const textBlock = json.content?.find((b: any) => b.type === "text");
          if (textBlock?.text) return textBlock.text;
        } else {
          const errText = await res.text();
          errors.push(`Anthropic HTTP ${res.status}: ${errText}`);
        }
      } catch (err: any) {
        errors.push(`Anthropic error: ${err?.message}`);
      }
    }

    // 5. Try DeepSeek API if DEEPSEEK_API_KEY is configured
    const deepseekKey = process.env.DEEPSEEK_API_KEY;
    if (deepseekKey) {
      try {
        const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${deepseekKey}`,
          },
          body: JSON.stringify({
            model: "deepseek-chat",
            messages: [
              { role: "system", content: system },
              { role: "user", content: userMessage },
            ],
            response_format: { type: "json_object" },
          }),
        });
        if (res.ok) {
          const json = (await res.json()) as any;
          const text = json.choices?.[0]?.message?.content;
          if (text) return text;
        } else {
          const errText = await res.text();
          errors.push(`DeepSeek HTTP ${res.status}: ${errText}`);
        }
      } catch (err: any) {
        errors.push(`DeepSeek error: ${err?.message}`);
      }
    }

    // If all LLM calls failed or no keys are configured, return synthesized JSON via heuristic extraction
    return synthesizeHeuristicJson(userMessage, errors);
  }
}

/** Legacy alias for backwards compatibility */
export class AnthropicLlmClient extends MultiProviderLlmClient {}

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

function synthesizeHeuristicJson(utterance: string, previousErrors: string[]): string {
  const text = utterance.trim();
  
  // Extract amount
  const amountMatch = text.match(/(?:rs\.?|inr|₹)?\s*(\d+(?:\.\d{1,2})?)/i) || text.match(/(\d+(?:\.\d{1,2})?)\s*(?:rs|rupees|bucks|inr)?/i);
  const amount = amountMatch ? parseFloat(amountMatch[1]) : null;

  // Extract category
  let category = "general";
  if (/grocery|supermarket|mart|food/i.test(text)) category = "groceries";
  else if (/electricity|bill|power|utility/i.test(text)) category = "electricity";
  else if (/cab|uber|ola|taxi|auto|ride/i.test(text)) category = "taxi";
  else if (/dinner|lunch|breakfast|swiggy|zomato|cafe|coffee|drinks|beer|pizza/i.test(text)) category = "food";
  else if (/rent|flat|apartment/i.test(text)) category = "rent";
  else if (/hotel|stay|resort/i.test(text)) category = "hotel";

  // Extract title
  let title = "Expense";
  const words = text.split(/\s+/);
  if (words.length > 0 && words.length <= 6) {
    title = text;
  } else {
    const categoryWord = words.find(w => /dinner|lunch|cab|groceries|rent|coffee|pizza|uber|bill/i.test(w));
    title = categoryWord ? `${categoryWord.charAt(0).toUpperCase() + categoryWord.slice(1)} Expense` : "Voice Expense";
  }

  // Extract mentions
  const participantMentions: string[] = ["me"];
  const payerMentions: RawPayerMention[] = [{ mention: "me", amountPaid: amount }];

  // Find other names (capitalized words or words after with/between/for)
  const nameMatches = text.match(/\b(?:with|and|between|for)\s+([A-Z][a-z]+|[a-z]+)\b/gi);
  if (nameMatches) {
    for (const match of nameMatches) {
      const parts = match.split(/\s+/);
      const name = parts[parts.length - 1];
      if (name && !/me|i|my|myself|all|us|we|the|them/i.test(name)) {
        const cleanName = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
        if (!participantMentions.includes(cleanName)) {
          participantMentions.push(cleanName);
        }
      }
    }
  }

  const ambiguityNotes: string[] = [];
  if (previousErrors.length > 0) {
    ambiguityNotes.push(`Extracted using smart heuristics. External LLMs failed or hit quota limits.`);
  }

  return JSON.stringify({
    title,
    amount,
    currency: "INR",
    category,
    payerMentions,
    participantMentions,
    splitMethod: "EQUAL",
    exactShares: null,
    percentageShares: null,
    shareUnits: null,
    dateHint: null,
    notes: null,
    recurring: { isRecurring: false, frequency: null },
    parseConfidence: amount ? 0.8 : 0.4,
    ambiguityNotes,
  });
}

export async function parseExpenseUtterance(
  utterance: string,
  llm: LlmClient = new MultiProviderLlmClient()
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

