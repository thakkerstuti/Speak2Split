import { useEffect } from "react";
import * as Google from "expo-auth-session/providers/google";
import * as WebBrowser from "expo-web-browser";

WebBrowser.maybeCompleteAuthSession();

const DUMMY_CLIENT_ID = "1234567890-dummyclientid.apps.googleusercontent.com";

export function useGoogleAuth(onIdToken: (idToken: string) => void) {
  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  const androidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || webClientId;
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || webClientId;

  const isConfigured = !!(webClientId || process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID);

  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    clientId: webClientId || DUMMY_CLIENT_ID,
    androidClientId: androidClientId || DUMMY_CLIENT_ID,
    iosClientId: iosClientId || DUMMY_CLIENT_ID,
  });

  useEffect(() => {
    if (isConfigured && response?.type === "success" && response.params?.id_token) {
      onIdToken(response.params.id_token);
    }
  }, [response, isConfigured]);

  return {
    promptAsync,
    isReady: isConfigured && !!request,
    isConfigured,
    wasCancelled: response?.type === "cancel" || response?.type === "dismiss",
    hadError: response?.type === "error",
  };
}
