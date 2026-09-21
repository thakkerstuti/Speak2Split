/**
 * Notification Channel Adapters
 *
 * Each adapter makes a REAL call to its provider's API. None of these fake
 * a successful send — if the required credential isn't configured, the
 * adapter throws a clear, specific error (caught by the orchestrator and
 * recorded as SKIPPED_NOT_CONFIGURED), rather than silently pretending to
 * have delivered anything.
 */

export interface DeliveryResult {
  providerRef?: string;
}

export class NotConfiguredError extends Error {}

/**
 * Push notifications via Expo's push service. This is genuinely live —
 * Expo's push endpoint doesn't require an API key for basic sends, only a
 * valid Expo push token registered from a real device (see
 * notification_devices table, populated by the mobile app on launch).
 */
export async function sendPushNotification(expoPushToken: string, title: string, body: string, data?: unknown): Promise<DeliveryResult> {
  const response = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ to: expoPushToken, title, body, data }),
  });
  const json = (await response.json()) as { data?: { status?: string; id?: string } };
  if (!response.ok || json?.data?.status === "error") {
    throw new Error(`Expo push failed: ${JSON.stringify(json)}`);
  }
  return { providerRef: json?.data?.id };
}

/**
 * Transactional email via Resend. Requires RESEND_API_KEY. This is a real
 * HTTP call to Resend's API — with no key configured it throws
 * NotConfiguredError rather than pretending to send.
 */
export async function sendEmail(to: string, subject: string, html: string): Promise<DeliveryResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new NotConfiguredError("RESEND_API_KEY is not configured — see ENVIRONMENT.md");
  }
  const fromAddress = process.env.EMAIL_FROM_ADDRESS ?? "notifications@speak2split.app";

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ from: fromAddress, to, subject, html }),
  });
  const json = (await response.json()) as { id?: string; message?: string };
  if (!response.ok) {
    throw new Error(`Resend API error: ${JSON.stringify(json)}`);
  }
  return { providerRef: json?.id };
}

/**
 * WhatsApp via the official WhatsApp Business Cloud API only. Requires
 * WHATSAPP_BUSINESS_PHONE_NUMBER_ID and WHATSAPP_BUSINESS_ACCESS_TOKEN, and
 * the recipient must have opted in and the message must use an approved
 * template (Cloud API requirement for business-initiated conversations).
 * This deliberately does NOT attempt any form of personal WhatsApp
 * automation — only the sanctioned Business API surface.
 */
export async function sendWhatsAppTemplate(
  toE164Phone: string,
  templateName: string,
  languageCode: string,
  parameters: string[]
): Promise<DeliveryResult> {
  const phoneNumberId = process.env.WHATSAPP_BUSINESS_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_BUSINESS_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) {
    throw new NotConfiguredError("WhatsApp Business Cloud API credentials are not configured — see ENVIRONMENT.md");
  }

  const response = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: toE164Phone,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        components: [{ type: "body", parameters: parameters.map((text) => ({ type: "text", text })) }],
      },
    }),
  });
  const json = (await response.json()) as { messages?: { id: string }[]; error?: unknown };
  if (!response.ok) {
    throw new Error(`WhatsApp Cloud API error: ${JSON.stringify(json)}`);
  }
  return { providerRef: json?.messages?.[0]?.id };
}
