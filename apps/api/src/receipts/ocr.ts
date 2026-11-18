/**
 * OCR Provider
 *
 * Extracts raw text from a receipt image. Provider order (unchanged):
 *   OCR_PROVIDER (if set) first, then Google Vision -> Gemini -> OpenAI.
 * Providers without a key are skipped, so with only GEMINI_API_KEY set (the
 * free-tier setup) Gemini is the only provider used. Google Vision and
 * OpenAI only run if their keys are configured — both are billed services.
 *
 * Security:
 *  - API keys are sent in request headers only, never in URLs.
 *  - Provider error bodies are redacted (configured keys + key-shaped
 *    strings) before they are put into an error message.
 *  - Error messages here are for SERVER LOGS. The receipts router maps them
 *    to generic, user-friendly messages; raw provider output never reaches
 *    the mobile app.
 */

export class OcrNotConfiguredError extends Error {}
export class OcrError extends Error {}

export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
const OCR_TIMEOUT_MS = 30000;

const KEY_PATTERNS = [/AIza[0-9A-Za-z_-]{20,}/g, /sk-[A-Za-z0-9_-]{8,}/g, /gsk_[A-Za-z0-9_-]{8,}/g];

/** Removes the given secrets and anything that looks like an API key. */
export function redactSecrets(text: string, secrets: (string | undefined)[] = []): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join("***");
  for (const p of KEY_PATTERNS) out = out.replace(p, "***");
  return out;
}

const configuredKeys = () => [
  process.env.GOOGLE_VISION_API_KEY,
  process.env.GOOGLE_SPEECH_API_KEY,
  process.env.GOOGLE_API_KEY,
  process.env.GEMINI_API_KEY,
  process.env.OPENAI_API_KEY,
];

async function providerFetch(provider: string, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(OCR_TIMEOUT_MS) });
  } catch (err: any) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      throw new OcrError(`${provider} request timed out (${OCR_TIMEOUT_MS / 1000}s)`);
    }
    throw new OcrError(`${provider} request failed: ${redactSecrets(String(err?.message ?? err), configuredKeys())}`);
  }
}

async function providerHttpError(provider: string, response: Response): Promise<OcrError> {
  const body = await response.text().catch(() => "");
  return new OcrError(`${provider} failed (HTTP ${response.status}): ${redactSecrets(body, configuredKeys()).slice(0, 500)}`);
}

async function runGoogleVision(imageBuffer: Buffer): Promise<string> {
  const apiKey = process.env.GOOGLE_VISION_API_KEY || process.env.GOOGLE_SPEECH_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new OcrNotConfiguredError("GOOGLE_VISION_API_KEY is not configured");
  }

  const response = await providerFetch("Google Vision", "https://vision.googleapis.com/v1/images:annotate", {
    method: "POST",
    // Google APIs accept the API key in the x-goog-api-key header; keeping it
    // out of the URL keeps it out of access logs, proxies and error traces.
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      requests: [
        {
          image: { content: imageBuffer.toString("base64") },
          features: [{ type: "TEXT_DETECTION" }],
        },
      ],
    }),
  });

  if (!response.ok) throw await providerHttpError("Google Vision", response);

  const json = (await response.json()) as {
    responses?: { fullTextAnnotation?: { text: string }; error?: { message: string } }[];
  };
  const first = json.responses?.[0];
  if (first?.error) {
    throw new OcrError(`Google Vision error: ${redactSecrets(first.error.message, configuredKeys())}`);
  }
  const text = first?.fullTextAnnotation?.text;
  if (!text) {
    throw new OcrError("Google Vision returned no text");
  }
  return text;
}

async function runGeminiVision(imageBuffer: Buffer): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new OcrNotConfiguredError("GEMINI_API_KEY is not configured");
  }

  // gemini-1.5-flash has been shut down. Default to a current stable, free-tier
  // model; override with GEMINI_MODEL without a code change.
  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  const response = await providerFetch(
    "Gemini Vision",
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      // Key in a header, never in the URL (URLs end up in logs).
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: "Extract all raw readable text from this receipt image verbatim. Include store name, date, items, subtotal, tax, and total amount. Output ONLY the raw extracted text.",
              },
              {
                inline_data: {
                  mime_type: "image/jpeg",
                  data: imageBuffer.toString("base64"),
                },
              },
            ],
          },
        ],
      }),
    }
  );

  if (!response.ok) throw await providerHttpError("Gemini Vision", response);

  const json = (await response.json()) as any;
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) {
    throw new OcrError("Gemini Vision returned no text from receipt");
  }
  return text;
}

async function runOpenAiVision(imageBuffer: Buffer): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new OcrNotConfiguredError("OPENAI_API_KEY is not configured");
  }

  const response = await providerFetch("OpenAI Vision", "https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Extract all raw text from this receipt image. Output ONLY the extracted text." },
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${imageBuffer.toString("base64")}` },
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) throw await providerHttpError("OpenAI Vision", response);

  const json = (await response.json()) as any;
  const text = json.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new OcrError("OpenAI Vision returned no text");
  }
  return text;
}

export async function runOcr(imageBuffer: Buffer): Promise<string> {
  const preferred = process.env.OCR_PROVIDER;
  const attempts: { provider: string; fn: () => Promise<string> }[] = [];

  if (preferred === "google_vision") attempts.push({ provider: "google_vision", fn: () => runGoogleVision(imageBuffer) });
  if (preferred === "gemini") attempts.push({ provider: "gemini", fn: () => runGeminiVision(imageBuffer) });
  if (preferred === "openai") attempts.push({ provider: "openai", fn: () => runOpenAiVision(imageBuffer) });

  const defaultOrder = [
    { provider: "google_vision", fn: () => runGoogleVision(imageBuffer) },
    { provider: "gemini", fn: () => runGeminiVision(imageBuffer) },
    { provider: "openai", fn: () => runOpenAiVision(imageBuffer) },
  ];

  for (const item of defaultOrder) {
    if (!attempts.some((a) => a.provider === item.provider)) {
      attempts.push(item);
    }
  }

  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      return await attempt.fn();
    } catch (err: any) {
      if (err instanceof OcrNotConfiguredError) continue;
      errors.push(`[${attempt.provider}] ${redactSecrets(String(err?.message ?? err), configuredKeys())}`);
    }
  }

  if (errors.length === 0) {
    throw new OcrNotConfiguredError("No OCR provider is configured (set GEMINI_API_KEY for free-tier OCR).");
  }

  throw new OcrError(`All OCR providers failed:\n${errors.join("\n")}`);
}
