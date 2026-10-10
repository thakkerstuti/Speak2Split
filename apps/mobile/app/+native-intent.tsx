/**
 * Intercepts incoming deep links before Expo Router navigates to them.
 *
 * Google sign-in finishes by opening
 *   com.stuti21.speak2split:/oauthredirect?code=...&state=...
 * That URL is consumed by expo-auth-session (via the system browser/Linking),
 * NOT by a screen. Without this hook Expo Router tries to open the non-existent
 * route "/oauthredirect"; AuthGate then replaces it with a freshly mounted
 * login screen, which unmounts the login screen that is waiting for Google's
 * result, so the sign-in result is lost and the user lands on login again.
 *
 * Map it to the login route so the current login screen stays mounted.
 */
export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}): string {
  if (typeof path === "string" && path.includes("oauthredirect")) {
    return "/login";
  }
  return path;
}
