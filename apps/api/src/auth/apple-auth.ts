import jwt from "jsonwebtoken";
import crypto from "crypto";

/**
 * Verifies an Apple identity token SERVER-SIDE against Apple's published
 * public keys (real JWKS fetch + signature verification via Node's native
 * crypto module), not a trust-the-client shortcut. Apple identity tokens
 * are standard JWTs signed by Apple; this validates signature, issuer,
 * audience, and expiry before any account is created or linked.
 *
 * Deliberately uses Node's built-in `crypto.createPublicKey` (JWK import
 * has been natively supported since Node 16) instead of the `jwks-rsa`
 * package — that package pulls in `jose`, an ESM-only dependency that
 * breaks CommonJS/ts-jest test runs. This avoids the dependency entirely.
 */
export interface VerifiedAppleIdentity {
  appleUserId: string; // the `sub` claim — stable identity
  email?: string; // may be a private relay address (@privaterelay.appleid.com)
  emailVerified: boolean;
  isPrivateEmail: boolean;
}

export class AppleAuthNotConfiguredError extends Error {}
export class InvalidAppleTokenError extends Error {}

const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_JWKS_URI = "https://appleid.apple.com/auth/keys";

interface AppleJwk {
  kty: string;
  kid: string;
  use: string;
  alg: string;
  n: string;
  e: string;
}

let cachedKeys: { keys: AppleJwk[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 3600_000;

async function fetchApplePublicKey(kid: string): Promise<crypto.KeyObject> {
  const now = Date.now();
  if (!cachedKeys || now - cachedKeys.fetchedAt > CACHE_TTL_MS) {
    const response = await fetch(APPLE_JWKS_URI);
    if (!response.ok) {
      throw new Error(`Failed to fetch Apple JWKS: HTTP ${response.status}`);
    }
    const json = (await response.json()) as { keys: AppleJwk[] };
    cachedKeys = { keys: json.keys, fetchedAt: now };
  }

  const jwk = cachedKeys.keys.find((k) => k.kid === kid);
  if (!jwk) {
    throw new Error(`No Apple signing key found for kid=${kid}`);
  }

  return crypto.createPublicKey({ key: { kty: jwk.kty, n: jwk.n, e: jwk.e }, format: "jwk" });
}

export async function verifyAppleIdToken(identityToken: string): Promise<VerifiedAppleIdentity> {
  const clientId = process.env.APPLE_SIGN_IN_CLIENT_ID;
  if (!clientId) {
    throw new AppleAuthNotConfiguredError("APPLE_SIGN_IN_CLIENT_ID is not configured — see ENVIRONMENT.md");
  }

  const decoded = jwt.decode(identityToken, { complete: true });
  if (!decoded || typeof decoded === "string" || !decoded.header.kid) {
    throw new InvalidAppleTokenError("Malformed Apple identity token");
  }

  let publicKey: crypto.KeyObject;
  try {
    publicKey = await fetchApplePublicKey(decoded.header.kid);
  } catch (err) {
    throw new InvalidAppleTokenError(`Could not fetch Apple signing key: ${(err as Error).message}`);
  }

  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(identityToken, publicKey.export({ type: "spki", format: "pem" }), {
      algorithms: ["RS256"],
      issuer: APPLE_ISSUER,
      audience: clientId,
    }) as jwt.JwtPayload;
  } catch (err) {
    throw new InvalidAppleTokenError(`Apple identity token verification failed: ${(err as Error).message}`);
  }

  if (!payload.sub) {
    throw new InvalidAppleTokenError("Apple identity token missing sub claim");
  }

  const email = typeof payload.email === "string" ? payload.email : undefined;
  return {
    appleUserId: payload.sub,
    email,
    emailVerified: payload.email_verified === true || payload.email_verified === "true",
    isPrivateEmail: payload.is_private_email === true || payload.is_private_email === "true",
  };
}
