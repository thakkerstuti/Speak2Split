/**
 * Receipt Field Extraction
 *
 * Takes raw OCR text (whatever a vision/OCR provider returns) and extracts
 * merchant, total amount, date, and category — using label-based heuristics
 * ("TOTAL", "GRAND TOTAL", "AMOUNT DUE", "NET TOTAL") rather than naively
 * picking the largest number on the receipt, which would frequently grab a
 * subtotal-plus-tax intermediate figure, an item price, or a loyalty-points
 * balance instead of the actual amount paid.
 *
 * This is deliberately pure/synchronous and OCR-provider-agnostic — it only
 * knows about text in, structured draft out — so it's fully unit-testable
 * without any external OCR call, and the OCR provider itself can be swapped
 * without touching this logic.
 */

export interface ReceiptExtraction {
  merchant: string | null;
  amount: number | null;
  amountSource: "labeled_total" | "labeled_grand_total" | "labeled_amount_due" | "fallback_largest" | "none";
  date: string | null;
  category: string;
  currency: string;
  confidence: number;
  rawText: string;
}

const TOTAL_LABEL_PATTERNS: { pattern: RegExp; source: ReceiptExtraction["amountSource"]; weight: number }[] = [
  { pattern: /\b(grand\s*total|net\s*total)\b[^\d₹]{0,15}([₹]?\s*[\d,]+\.?\d*)/i, source: "labeled_grand_total", weight: 1.0 },
  { pattern: /\btotal\b(?!\s*items)[^\d₹]{0,15}([₹]?\s*[\d,]+\.?\d*)/i, source: "labeled_total", weight: 0.9 },
  { pattern: /\b(amount\s*due|balance\s*due|amount)\b[^\d₹]{0,15}([₹]?\s*[\d,]+\.?\d*)/i, source: "labeled_amount_due", weight: 0.75 },
];

function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[₹,]/g, "").replace(/rs\.?/i, "").trim();
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : null;
}

function extractAllAmounts(text: string): number[] {
  const matches = text.match(/[₹]?\s*\d+(?:,\d{3})*(?:\.\d{1,2})?/g) ?? [];
  return matches.map(parseAmount).filter((n): n is number => n !== null && n > 0);
}

function extractDate(text: string): string | null {
  const isoMatch = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const slashMatch = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  if (slashMatch) {
    let [, d, m, y] = slashMatch;
    if (y.length === 2) y = `20${y}`;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  return null;
}

function guessCategory(merchant: string | null, text: string): string {
  const lower = `${merchant ?? ""} ${text}`.toLowerCase();
  const rules: [RegExp, string][] = [
    [/grocery|supermarket|mart|bigbasket|d-?mart/, "groceries"],
    [/electricity|power|utility|utilities/, "electricity"],
    [/uber|ola|taxi|cab/, "taxi"],
    [/restaurant|cafe|diner|food|zomato|swiggy/, "food"],
    [/hotel|resort|inn/, "hotel"],
    [/pharmacy|medical|chemist/, "medical"],
    [/fuel|petrol|diesel|gas station/, "fuel"],
  ];
  for (const [pattern, category] of rules) {
    if (pattern.test(lower)) return category;
  }
  return "general";
}

function guessMerchant(lines: string[]): string | null {
  const candidateLines = lines.slice(0, 5).filter((l) => l.trim().length > 2 && !/^\d+$/.test(l.trim()));
  if (candidateLines.length === 0) return null;

  const scored = candidateLines.map((line) => {
    const letterRatio = (line.match(/[a-zA-Z]/g)?.length ?? 0) / Math.max(line.length, 1);
    return { line: line.trim(), score: letterRatio * line.length };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.line ?? null;
}

export function extractReceiptFields(rawText: string): ReceiptExtraction {
  const lines = rawText.split("\n").map((l) => l.trim()).filter(Boolean);
  const merchant = guessMerchant(lines);
  const date = extractDate(rawText);

  let amount: number | null = null;
  let amountSource: ReceiptExtraction["amountSource"] = "none";
  let confidence = 0.3;

  for (const { pattern, source, weight } of TOTAL_LABEL_PATTERNS) {
    const match = rawText.match(pattern);
    if (match) {
      const amountGroup = match[2] ?? match[1];
      const parsed = parseAmount(amountGroup);
      if (parsed !== null) {
        amount = parsed;
        amountSource = source;
        confidence = weight;
        break;
      }
    }
  }

  if (amount === null) {
    const allAmounts = extractAllAmounts(rawText);
    if (allAmounts.length > 0) {
      amount = Math.max(...allAmounts);
      amountSource = "fallback_largest";
      confidence = 0.35;
    }
  }

  const category = guessCategory(merchant, rawText);

  return {
    merchant,
    amount,
    amountSource,
    date,
    category,
    currency: "INR",
    confidence: amount === null ? 0.1 : confidence,
    rawText,
  };
}

export { guessCategory };
