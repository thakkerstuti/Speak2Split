import { EXPENSE_PARSER_SYSTEM_PROMPT, heuristicExpenseDraft, stripCodeFences } from "@speak2split/shared";
import { z } from "zod";
import { AiInvalidInputError, AiNotConfiguredError, AiResult, ProviderName } from "./types";
import { resolveChain, timeoutFor } from "./config";
import { PROVIDER_REGISTRY } from "./providers";
import { redactSecrets } from "./http";
import {
  ExpenseDraft,
  ExpenseDraftSchema,
  emptyExpenseDraft,
  expenseDraftShape,
  formatIssues,
  pickValidFields,
  topLevelIssueKeys,
} from "./schemas";

export interface ParseExpenseContext {
  /** Names the user is likely to mention (e.g. group members) — spelling hints only, never auto-resolved. */
  knownNames?: string[];
  /** Currency to assume when none is spoken. */
  defaultCurrency?: string;
}

const MAX_TEXT = 2000;

function buildUserMessage(text: string, ctx: ParseExpenseContext, previousIssues?: string[]): string {
  const lines = [text];
  if (ctx.defaultCurrency) lines.push(`\n(Default currency if none is stated: ${ctx.defaultCurrency}.)`);
  if (ctx.knownNames?.length) lines.push(`(People the user often mentions: ${ctx.knownNames.slice(0, 30).join(", ")}.)`);
  if (previousIssues?.length) {
    lines.push(
      `\nYour previous reply did not match the schema: ${previousIssues.slice(0, 8).join("; ")}. ` +
        "Reply again with ONLY a valid JSON object that matches the schema exactly."
    );
  }
  return lines.join("\n");
}

type Checked =
  | { ok: true; data: ExpenseDraft }
  | { ok: false; issues: string[]; value: unknown; error?: z.ZodError };

function checkReply(raw: string): Checked {
  let value: unknown;
  try {
    value = JSON.parse(stripCodeFences(raw));
  } catch {
    return { ok: false, issues: ["reply was not valid JSON"], value: undefined };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, issues: ["reply was not a JSON object"], value: undefined };
  }
  const r = ExpenseDraftSchema.safeParse(value);
  if (r.success) return { ok: true, data: r.data };
  return { ok: false, issues: formatIssues(r.error), value, error: r.error };
}

/** Only fields that passed validation, with safe defaults for the rest. Always schema-valid. */
function safeDraft(value: unknown, error?: z.ZodError): ExpenseDraft {
  const picked = pickValidFields(expenseDraftShape, value, error ? topLevelIssueKeys(error) : new Set());
  const merged = { ...emptyExpenseDraft(), ...picked };
  const check = ExpenseDraftSchema.safeParse(merged);
  return check.success ? check.data : { ...emptyExpenseDraft(), title: merged.title, amount: merged.amount };
}

/**
 * Natural-language expense → structured draft.
 *  - Provider chain from AI_PARSE_PROVIDER / AI_PARSE_FALLBACK (default Gemini → Groq → OpenAI → DeepSeek).
 *  - Provider error or timeout → next provider.
 *  - Reply fails Zod validation → retried once on the same provider (told what was wrong);
 *    still invalid → status "needs_confirmation" with only the validated fields.
 *  - No provider reachable → offline heuristic, always "needs_confirmation".
 */
export async function parseExpense(text: string, context: ParseExpenseContext = {}): Promise<AiResult<ExpenseDraft>> {
  const utterance = (text ?? "").trim();
  if (!utterance) throw new AiInvalidInputError("Nothing to parse — the text is empty");
  if (utterance.length > MAX_TEXT) throw new AiInvalidInputError(`Text is too long to parse (max ${MAX_TEXT} characters)`);

  const { chain } = resolveChain("parseExpense");
  const timeoutMs = timeoutFor("parseExpense");
  let providerFailures = 0;

  for (const name of chain) {
    const provider = PROVIDER_REGISTRY[name];
    if (!provider.completeJson) continue;
    try {
      let last: Extract<Checked, { ok: false }> | null = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        const raw = await provider.completeJson({
          system: EXPENSE_PARSER_SYSTEM_PROMPT,
          user: buildUserMessage(utterance, context, last?.issues),
          timeoutMs,
        });
        const checked = checkReply(raw);
        if (checked.ok) return { status: "ok", data: checked.data, provider: name, issues: [] };
        last = checked;
        // eslint-disable-next-line no-console
        console.warn(`[AI] parseExpense: ${name} reply failed validation (attempt ${attempt}/2): ${checked.issues.join("; ")}`);
      }
      return {
        status: "needs_confirmation",
        data: safeDraft(last!.value, last!.error),
        provider: name as ProviderName,
        issues: last!.issues,
      };
    } catch (err: any) {
      if (err instanceof AiNotConfiguredError) continue;
      providerFailures++;
      // eslint-disable-next-line no-console
      console.warn(`[AI] parseExpense: ${name} failed, trying next provider: ${redactSecrets(String(err?.message ?? err))}`);
    }
  }

  // Last resort: offline keyword extraction. Never trusted without the user confirming.
  const guess = heuristicExpenseDraft(utterance);
  const checked = ExpenseDraftSchema.safeParse(guess);
  return {
    status: "needs_confirmation",
    data: checked.success ? checked.data : safeDraft(guess, checked.error),
    provider: "heuristic",
    issues: [
      providerFailures > 0
        ? "AI parsing is temporarily unavailable, so this was filled in offline — please check every field."
        : "AI parsing isn't configured, so this was filled in offline — please check every field.",
    ],
  };
}
