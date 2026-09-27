import { useEffect, useState } from "react";
import * as Google from "expo-auth-session/providers/google";
import { makeRedirectUri } from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { Alert } from "react-native";
import { authApi } from "./api";

WebBrowser.maybeCompleteAuthSession();

export function useGoogleAuth(onIdToken: (idToken: string) => void) {
  const [serverClientId, setServerClientId] = useState<string>("");

  useEffect(() => {
    authApi
      .getConfig()
      .then((cfg) => {
        if (cfg?.googleWebClientId) {
          setServerClientId(cfg.googleWebClientId);
        }
      })
      .catch(() => {});
  }, []);

  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || serverClientId;
  const androidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

  const isConfigured = !!(webClientId || androidClientId);

  // If using a WEB client ID on native Android without an explicit Android Client ID,
  // we must use Expo Auth Proxy (HTTPS URI) because Google blocks custom scheme URIs for Web client types.
  const redirectUri = !androidClientId && webClientId
    ? makeRedirectUri({
        native: "https://auth.expo.io/@stuti21/speak2split",
      })
    : undefined;

  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    clientId: webClientId || androidClientId,
    webClientId: webClientId || undefined,
    androidClientId: androidClientId || undefined,
    iosClientId: iosClientId || undefined,
    redirectUri,
  });

  useEffect(() => {
    if (isConfigured && response?.type === "success") {
      const idToken =
        response.params?.id_token ||
        (response as any).authentication?.idToken ||
        (response as any).authentication?.accessToken;
      if (idToken) {
        onIdToken(idToken);
      }
    }
  }, [response, isConfigured]);

  const triggerPrompt = async () => {
    let activeId = webClientId || androidClientId;
    if (!activeId) {
      try {
        const cfg = await authApi.getConfig();
        if (cfg?.googleWebClientId) {
          setServerClientId(cfg.googleWebClientId);
          activeId = cfg.googleWebClientId;
        }
      } catch (e) {}
    }

    if (!activeId) {
      Alert.alert(
        "Google Sign-In Notice",
        "Google Sign-In requires your Google Web Client ID (GOOGLE_OAUTH_CLIENT_ID on Render or EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID in mobile environment). Email/Password login is active and working!"
      );
      return;
    }

    return promptAsync();
  };

  return {
    promptAsync: triggerPrompt,
    isReady: isConfigured && !!request,
    isConfigured,
    wasCancelled: response?.type === "cancel" || response?.type === "dismiss",
    hadError: response?.type === "error",
  };
}

