import { OAuth2Client } from "google-auth-library";

/**
 * Verifies a Google ID token SERVER-SIDE against Google's public keys.
 * This is real cryptographic verification, not a trust-the-client shortcut
 * — a forged or tampered token is rejected here before any account is
 * created or linked. Requires GOOGLE_OAUTH_CLIENT_ID (the same client ID
 * configured in the Expo app's Google Sign-In config) so we also verify
 * the token was actually issued FOR this app, not just by Google generally.
 */
export interface VerifiedGoogleIdentity {
  googleUserId: string; // the `sub` claim — stable, never the email or name
  email: string;
  emailVerified: boolean;
  name?: string;
  avatarUrl?: string;
}

export class GoogleAuthNotConfiguredError extends Error {}
export class InvalidGoogleTokenError extends Error {}

let client: OAuth2Client | null = null;
function getClient(): OAuth2Client {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) {
    throw new GoogleAuthNotConfiguredError("GOOGLE_OAUTH_CLIENT_ID is not configured — see ENVIRONMENT.md");
  }
  if (!client) client = new OAuth2Client(clientId);
  return client;
}

export async function verifyGoogleIdToken(idToken: string): Promise<VerifiedGoogleIdentity> {
  const oauthClient = getClient();
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID!;

  let ticket;
  try {
    ticket = await oauthClient.verifyIdToken({ idToken, audience: clientId });
  } catch (err) {
    throw new InvalidGoogleTokenError(`Google ID token verification failed: ${(err as Error).message}`);
  }

  const payload = ticket.getPayload();
  if (!payload || !payload.sub || !payload.email) {
    throw new InvalidGoogleTokenError("Google ID token payload missing required claims");
  }

  return {
    googleUserId: payload.sub,
    email: payload.email,
    emailVerified: payload.email_verified ?? false,
    name: payload.name,
    avatarUrl: payload.picture,
  };
}
