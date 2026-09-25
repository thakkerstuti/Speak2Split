import { Platform } from "react-native";

export async function isAppleAuthAvailable(): Promise<boolean> {
  return false;
}

export type AppleSignInResult =
  | { status: "success"; identityToken: string; fullName?: string }
  | { status: "cancelled" }
  | { status: "error"; message: string };

export async function signInWithApple(): Promise<AppleSignInResult> {
  return { status: "error", message: "Apple Sign-In is only available on iOS" };
}
