/**
 * Zod schemas for every structured AI output. Nothing a provider returns is
 * passed on without going through one of these.
 */
import { z } from "zod";

export const TranscriptSchema = z.object({
  transcript: z.string().trim().min(1, "empty transcript").max(5000),
  languageDetected: z.string().trim().max(20).optional().nullable().transform((v) => v || undefined),
});

/** Numbers sometimes arrive as strings ("2,400"); accept those, nothing looser. */
const looseNumber = z.union([
  z.number(),
  z
    .string()
    .trim()
    .regex(/^\d{1,3}(,\d{2,3})*(\.\d+)?$|^\d+(\.\d+)?$/, "not a number")
    .transform((s) => Number(s.replace(/,/g, ""))),
]);
const money = looseNumber.pipe(z.number().finite().positive().max(100_000_000));
const nonNegative = looseNumber.pipe(z.number().finite().min(0).max(100_000_000));
const mention = z.string().trim().min(1).max(60);
const shareMap = z.record(mention, nonNegative).nullable().optional().transform((v) => v ?? undefined);

export const SPLIT_METHODS = ["EQUAL", "EXACT", "PERCENTAGE", "SHARES"] as const;
const FREQUENCIES = ["DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY", "YEARLY"] as const;

export const expenseDraftShape = {
  title: z.string().trim().max(120).default("Expense").transform((s) => s || "Expense"),
  amount: money.nullable().default(null),
  currency: z
    .string()
    .trim()
    .default("INR")
    .transform((s) => s.toUpperCase())
    .pipe(z.string().regex(/^[A-Z]{3}$/, "currency must be a 3-letter code")),
  category: z.string().trim().max(40).default("general").transform((s) => s.toLowerCase() || "general"),
  payerMentions: z
    .array(z.object({ mention, amountPaid: nonNegative.nullable().default(null) }))
    .max(20)
    .nullable()
    .default([])
    .transform((v) => v ?? []),
  participantMentions: z.array(mention).max(30).nullable().default([]).transform((v) => v ?? []),
  splitMethod: z.enum(SPLIT_METHODS).default("EQUAL"),
  exactShares: shareMap,
  percentageShares: shareMap,
  shareUnits: shareMap,
  dateHint: z.string().trim().max(60).nullable().default(null),
  notes: z.string().trim().max(500).nullable().default(null),
  recurring: z
    .object({
      isRecurring: z.boolean(),
      frequency: z.enum(FREQUENCIES).nullable().optional().transform((v) => v ?? undefined),
    })
    .nullable()
    .default({ isRecurring: false })
    .transform((v) => v ?? { isRecurring: false }),
  parseConfidence: z.number().min(0).max(1).default(0.5),
  ambiguityNotes: z.array(z.string().max(300)).max(20).nullable().default([]).transform((v) => v ?? []),
};

const sumOf = (m?: Record<string, number>) => Object.values(m ?? {}).reduce((a, b) => a + b, 0);
const approx = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

export const ExpenseDraftSchema = z
  .object(expenseDraftShape)
  .superRefine((d, ctx) => {
    if (d.splitMethod === "PERCENTAGE" && d.percentageShares && Object.keys(d.percentageShares).length) {
      const total = sumOf(d.percentageShares);
      if (!approx(total, 100, 0.5)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["percentageShares"], message: `percentages add up to ${total}, not 100` });
      }
    }
    if (d.splitMethod === "EXACT" && d.exactShares && Object.keys(d.exactShares).length && d.amount != null) {
      const total = sumOf(d.exactShares);
      if (!approx(total, d.amount, 0.01)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["exactShares"], message: `exact shares add up to ${total}, not ${d.amount}` });
      }
    }
    const paid = d.payerMentions.map((p) => p.amountPaid);
    if (d.amount != null && paid.length > 1 && paid.every((v) => v != null)) {
      const total = paid.reduce((a, b) => a! + b!, 0)!;
      if (!approx(total, d.amount, 0.01)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["payerMentions"], message: `payer amounts add up to ${total}, not ${d.amount}` });
      }
    }
  });

export type ExpenseDraft = z.infer<typeof ExpenseDraftSchema>;

export const RECEIPT_AMOUNT_SOURCES = ["labeled_total", "labeled_grand_total", "labeled_amount_due", "fallback_largest", "none"] as const;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "not a real calendar date");

export const receiptShape = {
  merchant: z.string().trim().min(1).max(120).nullable().default(null),
  amount: money,
  amountSource: z.enum(RECEIPT_AMOUNT_SOURCES),
  date: isoDate.nullable().default(null),
  category: z.string().trim().min(1).max(40).default("general"),
  currency: z.string().regex(/^[A-Z]{3}$/).default("INR"),
  confidence: z.number().min(0).max(1),
  rawText: z.string().max(20000),
};

export const ReceiptSchema = z.object(receiptShape);
export type Receipt = z.infer<typeof ReceiptSchema>;
/** A receipt whose amount could not be validated (only in needs_confirmation results). */
export type ReceiptDraft = Omit<Receipt, "amount"> & { amount: number | null };

// ---------------------------------------------------------------------------

export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
}

/**
 * Keeps only the fields of `input` that pass their own schema AND aren't
 * implicated in a cross-field issue — the safe subset for needs_confirmation.
 */
export function pickValidFields<S extends Record<string, z.ZodTypeAny>>(
  shape: S,
  input: unknown,
  invalidKeys: Set<string> = new Set()
): Partial<{ [K in keyof S]: z.infer<S[K]> }> {
  const out: Record<string, unknown> = {};
  if (!input || typeof input !== "object") return out as any;
  for (const key of Object.keys(shape)) {
    if (invalidKeys.has(key)) continue;
    const value = (input as Record<string, unknown>)[key];
    if (value === undefined) continue;
    const r = shape[key].safeParse(value);
    if (r.success) out[key] = r.data;
  }
  return out as any;
}

export function topLevelIssueKeys(error: z.ZodError): Set<string> {
  return new Set(error.issues.map((i) => String(i.path[0] ?? "")).filter(Boolean));
}

/** A complete, schema-valid draft containing nothing but defaults. */
export function emptyExpenseDraft(): ExpenseDraft {
  return ExpenseDraftSchema.parse({});
}
