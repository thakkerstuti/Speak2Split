/**
 * OCR Provider
 *
 * Real integration with Google Cloud Vision's text detection API. Kept
 * behind a narrow interface so a different provider (AWS Textract,
 * already documented in .env.example) can be swapped in later. If the
 * configured provider's credential is missing, this throws a specific
 * error — it never fabricates OCR text.
 */

export class OcrNotConfiguredError extends Error {}
export class OcrError extends Error {}

async function runGoogleVision(imageBuffer: Buffer): Promise<string> {
  const apiKey = process.env.GOOGLE_VISION_API_KEY || process.env.GOOGLE_SPEECH_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new OcrNotConfiguredError("GOOGLE_VISION_API_KEY is not configured");
  }

  const response = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requests: [
        {
          image: { content: imageBuffer.toString("base64") },
          features: [{ type: "TEXT_DETECTION" }],
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new OcrError(`Google Vision API failed (HTTP ${response.status}): ${body}`);
  }

  const json = (await response.json()) as {
    responses?: { fullTextAnnotation?: { text: string }; error?: { message: string } }[];
  };
  const first = json.responses?.[0];
  if (first?.error) {
    throw new OcrError(`Google Vision API error: ${first.error.message}`);
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

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
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

  if (!response.ok) {
    const body = await response.text();
    throw new OcrError(`Gemini Vision OCR failed (HTTP ${response.status}): ${body}`);
  }

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

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
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

  if (!response.ok) {
    const body = await response.text();
    throw new OcrError(`OpenAI Vision OCR failed (HTTP ${response.status}): ${body}`);
  }

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
      errors.push(`[${attempt.provider}] ${err?.message || err}`);
    }
  }

  if (errors.length === 0) {
    throw new OcrNotConfiguredError(
      "No OCR API keys configured on server. Set GOOGLE_VISION_API_KEY, GEMINI_API_KEY, or OPENAI_API_KEY on Render."
    );
  }

  throw new OcrError(`All OCR providers failed:\n${errors.join("\n")}`);
}

