import { extractReceiptFields } from "@speak2split/shared";
import { z } from "zod";
import { AiInvalidInputError, AiNotConfiguredError, AiProviderError, AiResult, ProviderName } from "./types";
import { resolveChain, timeoutFor } from "./config";
import { PROVIDER_REGISTRY } from "./providers";
import { redactSecrets } from "./http";
import { ReceiptDraft, ReceiptSchema, formatIssues, pickValidFields, receiptShape, topLevelIssueKeys } from "./schemas";

const MAX_RAW_TEXT = 20000;

function safeReceipt(extraction: unknown, error: z.ZodError): ReceiptDraft {
  const p = pickValidFields(receiptShape, extraction, topLevelIssueKeys(error));
  return {
    merchant: p.merchant ?? null,
    amount: p.amount ?? null,
    amountSource: p.amountSource ?? "none",
    date: p.date ?? null,
    category: p.category ?? "general",
    currency: p.currency ?? "INR",
    confidence: p.confidence ?? 0,
    rawText: p.rawText ?? "",
  };
}

/**
 * Receipt image → validated receipt fields.
 *  - Provider chain from AI_RECEIPT_PROVIDER / AI_RECEIPT_FALLBACK
 *    (default Google Vision → Gemini → OpenAI, same order as before).
 *  - The provider returns raw text; fields are extracted by the tested
 *    heuristic in @speak2split/shared, then validated with Zod.
 *  - Provider error or timeout → next provider.
 *  - Fields fail validation (e.g. no total found) → read once more with the
 *    same provider; still invalid → "needs_confirmation" with the valid fields.
 */
export async function parseReceipt(image: Buffer): Promise<AiResult<ReceiptDraft>> {
  if (!image || image.length === 0) throw new AiInvalidInputError("Image is empty");

  const { chain } = resolveChain("parseReceipt");
  const timeoutMs = timeoutFor("parseReceipt");
  const failures: string[] = [];

  for (const name of chain) {
    const provider = PROVIDER_REGISTRY[name];
    if (!provider.receiptText) continue;
    try {
      let lastExtraction: unknown;
      let lastError: z.ZodError | undefined;
      for (let attempt = 1; attempt <= 2; attempt++) {
        const text = (await provider.receiptText(image, timeoutMs)).slice(0, MAX_RAW_TEXT);
        const extraction = extractReceiptFields(text);
        const checked = ReceiptSchema.safeParse(extraction);
        if (checked.success) return { status: "ok", data: checked.data, provider: name, issues: [] };
        lastExtraction = extraction;
        lastError = checked.error;
        // eslint-disable-next-line no-console
        console.warn(`[AI] parseReceipt: ${name} result failed validation (attempt ${attempt}/2): ${formatIssues(checked.error).join("; ")}`);
      }
      return {
        status: "needs_confirmation",
        data: safeReceipt(lastExtraction, lastError!),
        provider: name as ProviderName,
        issues: formatIssues(lastError!),
      };
    } catch (err: any) {
      if (err instanceof AiNotConfiguredError) continue;
      const message = redactSecrets(String(err?.message ?? err));
      // eslint-disable-next-line no-console
      console.warn(`[AI] parseReceipt: ${name} failed, trying next provider: ${message}`);
      failures.push(`[${name}] ${message}`);
    }
  }

  if (failures.length === 0) {
    throw new AiNotConfiguredError("No receipt-scanning provider is configured (set GEMINI_API_KEY for free-tier OCR).");
  }
  throw new AiProviderError(`All receipt providers failed:\n${failures.join("\n")}`);
}
