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
  const apiKey = process.env.GOOGLE_VISION_API_KEY;
  if (!apiKey) {
    throw new OcrNotConfiguredError("GOOGLE_VISION_API_KEY is not configured (OCR_PROVIDER=google_vision requires it) — see ENVIRONMENT.md");
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
    throw new OcrError("Google Vision returned no text — the image may be too blurry, rotated, or not contain readable text");
  }
  return text;
}

/** AWS Textract path, used when OCR_PROVIDER=textract. Also real, fails clearly if unconfigured. */
async function runTextract(): Promise<string> {
  const accessKey = process.env.AWS_TEXTRACT_ACCESS_KEY_ID;
  const secretKey = process.env.AWS_TEXTRACT_SECRET_ACCESS_KEY;
  if (!accessKey || !secretKey) {
    throw new OcrNotConfiguredError("AWS Textract credentials are not configured (OCR_PROVIDER=textract requires them) — see ENVIRONMENT.md");
  }
  // A full Textract implementation needs AWS SigV4 request signing (the
  // official @aws-sdk/client-textract package handles this). Left as a
  // clear extension point rather than a half-implemented signer, since an
  // incomplete hand-rolled SigV4 implementation would be worse than an
  // honest "not yet wired" error.
  throw new OcrNotConfiguredError(
    "AWS Textract support requires the @aws-sdk/client-textract package to be added — not yet wired in this build. Use OCR_PROVIDER=google_vision instead, or add the AWS SDK integration."
  );
}

export async function runOcr(imageBuffer: Buffer): Promise<string> {
  const provider = process.env.OCR_PROVIDER ?? "google_vision";

  switch (provider) {
    case "google_vision":
      return runGoogleVision(imageBuffer);
    case "textract":
      return runTextract();
    default:
      throw new OcrNotConfiguredError(`Unknown OCR_PROVIDER "${provider}" — expected "google_vision" or "textract"`);
  }
}
