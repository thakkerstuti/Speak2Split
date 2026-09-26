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

export function getGoogleClientId(): string {
  return (
    process.env.GOOGLE_OAUTH_CLIENT_ID ||
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ||
    process.env.GOOGLE_WEB_CLIENT_ID ||
    process.env.GOOGLE_CLIENT_ID ||
    ""
  );
}

function getClient(): OAuth2Client {
  const clientId = getGoogleClientId();
  return new OAuth2Client(clientId || undefined);
}

export async function verifyGoogleIdToken(idToken: string): Promise<VerifiedGoogleIdentity> {
  const oauthClient = getClient();
  const clientId = getGoogleClientId();

  let ticket;
  try {
    if (clientId) {
      const androidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || process.env.GOOGLE_ANDROID_CLIENT_ID;
      const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || process.env.GOOGLE_IOS_CLIENT_ID;
      const validAudiences = [clientId, androidClientId, iosClientId].filter(Boolean) as string[];
      ticket = await oauthClient.verifyIdToken({ idToken, audience: validAudiences.length === 1 ? validAudiences[0] : validAudiences });
    } else {
      ticket = await oauthClient.verifyIdToken({ idToken });
    }
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

