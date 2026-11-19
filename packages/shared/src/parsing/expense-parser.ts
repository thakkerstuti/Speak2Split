/**
 * Natural Language Expense Parser — pure, network-free pieces.
 *
 * Converts a raw utterance (typed or transcribed from voice) into a
 * structured, but NOT yet person-resolved, expense draft. Name resolution
 * is deliberately a separate downstream step (see resolution/name-resolver.ts)
 * — this parser only extracts *raw name mentions* as strings; it never
 * decides which actual person "Vanshika" refers to.
 *
 * Provider calls (Gemini, Groq, OpenAI, DeepSeek) live ONLY in the API's AI
 * service layer (apps/api/src/services/ai). This module provides the prompt,
 * the LlmClient contract, output normalization and the offline heuristic.
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

export const EXPENSE_PARSER_SYSTEM_PROMPT = `You are the expense-parsing engine inside Speak2Split, a shared-expense app.
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

export class ExpenseParseError extends Error {
  constructor(message: string, public readonly rawResponse?: string) {
    super(message);
    this.name = "ExpenseParseError";
  }
}

export function stripCodeFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
}

/**
 * Offline, keyword-based extraction used when no AI provider is reachable.
 * Its output is a best guess — callers must always ask the user to confirm it.
 */
export function heuristicExpenseDraft(utterance: string): ParsedExpenseDraft {
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

  const ambiguityNotes: string[] = ["Extracted offline without AI — please check every field."];

  return {
    title,
    amount,
    currency: "INR",
    category,
    payerMentions,
    participantMentions,
    splitMethod: "EQUAL",
    dateHint: null,
    notes: null,
    recurring: { isRecurring: false },
    parseConfidence: amount ? 0.8 : 0.4,
    ambiguityNotes,
  };
}

export async function parseExpenseUtterance(
  utterance: string,
  llm: LlmClient
): Promise<ParsedExpenseDraft> {
  if (!utterance || utterance.trim().length === 0) {
    throw new ExpenseParseError("Empty utterance provided to expense parser");
  }

  const raw = await llm.complete(EXPENSE_PARSER_SYSTEM_PROMPT, utterance);
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

