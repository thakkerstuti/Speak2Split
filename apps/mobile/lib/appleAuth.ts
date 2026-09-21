import { Platform } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";

/**
 * Real Sign in with Apple via expo-apple-authentication — this is a native
 * module bundled with Expo Go on iOS, so it works via `npx expo start` +
 * Expo Go on a physical iOS device or the iOS Simulator signed into a real
 * Apple ID. It does NOT exist on Android (Apple doesn't offer it there) —
 * callers must check `isAppleAuthAvailable()` and hide the button on
 * Android/web rather than showing a dead button.
 *
 * Apple only returns the person's name on the very FIRST authorization for
 * a given app — every subsequent sign-in omits it, so the caller must
 * capture and forward `fullName` to the backend the first time and not
 * expect it again after that (the backend already handles this: it only
 * uses fullName to set the initial display name when creating a new user).
 */

export async function isAppleAuthAvailable(): Promise<boolean> {
  if (Platform.OS !== "ios") return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

export type AppleSignInResult =
  | { status: "success"; identityToken: string; fullName?: string }
  | { status: "cancelled" }
  | { status: "error"; message: string };

export async function signInWithApple(): Promise<AppleSignInResult> {
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });

    if (!credential.identityToken) {
      return { status: "error", message: "Apple did not return an identity token" };
    }

    const fullName = credential.fullName
      ? [credential.fullName.givenName, credential.fullName.familyName].filter(Boolean).join(" ")
      : undefined;

    return { status: "success", identityToken: credential.identityToken, fullName: fullName || undefined };
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "ERR_REQUEST_CANCELED") {
      return { status: "cancelled" };
    }
    return { status: "error", message: (err as Error)?.message ?? "Apple Sign-In failed" };
  }
}
