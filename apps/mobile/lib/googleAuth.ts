import { useEffect, useState } from "react";
import * as Google from "expo-auth-session/providers/google";
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

  const activeClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || serverClientId;
  const isConfigured = !!activeClientId;

  const [request, response, promptAsync] = Google.useIdTokenAuthRequest(
    isConfigured
      ? {
          clientId: activeClientId,
          androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || activeClientId,
          iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || activeClientId,
        }
      : {}
  );

  useEffect(() => {
    if (response?.type === "success") {
      const idToken =
        response.params?.id_token ||
        (response as any).authentication?.idToken ||
        (response as any).authentication?.accessToken;
      if (idToken) {
        onIdToken(idToken);
      }
    }
  }, [response]);

  const triggerPrompt = async () => {
    let currentId = activeClientId;
    if (!currentId) {
      try {
        const cfg = await authApi.getConfig();
        if (cfg?.googleWebClientId) {
          setServerClientId(cfg.googleWebClientId);
          currentId = cfg.googleWebClientId;
        }
      } catch (e) {}
    }

    if (!currentId) {
      Alert.alert(
        "Google Sign-In Configuration",
        "Google Sign-In requires a Google Web Client ID.\n\nPlease add GOOGLE_OAUTH_CLIENT_ID to your Render Environment Variables (or set EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID in mobile environment)."
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

