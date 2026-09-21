/**
 * Central environment/config access. JWT_ACCESS_SECRET in particular must
 * NEVER silently fall back to an insecure default in production — a
 * missing secret there means anyone could forge a valid session token.
 * In development, a fallback is allowed (with a loud console warning) so
 * local setup doesn't require an env file just to boot; in production the
 * process refuses to start instead.
 */
function requireJwtSecret(): string {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (secret && secret.length >= 16) return secret;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "FATAL: JWT_ACCESS_SECRET is missing or too short. Refusing to start in production without a real secret. Set JWT_ACCESS_SECRET in your environment (see ENVIRONMENT.md)."
    );
  }

  // eslint-disable-next-line no-console
  console.warn(
    "[config] WARNING: JWT_ACCESS_SECRET not set (or too short) — using an insecure development-only fallback. This is NEVER acceptable in production."
  );
  return "dev-only-insecure-secret-change-me";
}

export const JWT_SECRET = requireJwtSecret();
