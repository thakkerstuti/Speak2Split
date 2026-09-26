import { useEffect, useState } from "react";
import * as Google from "expo-auth-session/providers/google";
import * as WebBrowser from "expo-web-browser";
import { Alert } from "react-native";
import { authApi } from "./api";

WebBrowser.maybeCompleteAuthSession();

const DUMMY_CLIENT_ID = "1234567890-dummy.apps.googleusercontent.com";

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
  const effectiveClientId = activeClientId || DUMMY_CLIENT_ID;

  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    clientId: effectiveClientId,
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || effectiveClientId,
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || effectiveClientId,
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

