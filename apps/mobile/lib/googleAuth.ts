import { useEffect } from "react";
import * as Google from "expo-auth-session/providers/google";
import * as WebBrowser from "expo-web-browser";

WebBrowser.maybeCompleteAuthSession();

/**
 * Real Google Sign-In via expo-auth-session's OAuth implicit flow, requesting
 * an ID token (not just an access token) — the backend's /auth/google
 * endpoint verifies this token's signature against Google's public keys
 * server-side, so a forged client-side value can never create a session.
 *
 * CONFIGURATION REQUIRED (see .env.example):
 *   EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID   — a Web application OAuth client
 *     from Google Cloud Console. Used for the token exchange regardless
 *     of platform, per Google's own guidance for Expo/React Native apps.
 *   EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID   — iOS OAuth client (optional, only
 *     needed if you want the native iOS-style redirect instead of the
 *     web-based one).
 *   EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID — Android OAuth client (optional).
 *
 * EXPO GO vs DEV BUILD:
 *   In Expo Go, this uses Expo's hosted auth proxy (auth.expo.io) as the
 *   OAuth redirect target — you must add that proxy redirect URI to your
 *   Google Cloud Console client's "Authorized redirect URIs". This works
 *   for development/testing directly via `npx expo start` + Expo Go.
 *   In a standalone/dev-client build, expo-auth-session instead uses your
 *   app's own custom URL scheme, which requires no proxy and is the
 *   correct setup for production. Both paths are supported by the same
 *   code below — expo-auth-session picks the right one automatically
 *   based on how the app is currently running.
 */
export function useGoogleAuth(onIdToken: (idToken: string) => void) {
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    clientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
  });

  useEffect(() => {
    if (response?.type === "success" && response.params.id_token) {
      onIdToken(response.params.id_token);
    }
  }, [response]);

  const isConfigured = !!process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

  return {
    promptAsync,
    isReady: !!request,
    isConfigured,
    // Surfaced distinctly from "not configured" so the UI can show the
    // right message: cancellation is a normal outcome, missing config is
    // a setup problem.
    wasCancelled: response?.type === "cancel" || response?.type === "dismiss",
    hadError: response?.type === "error",
  };
}
