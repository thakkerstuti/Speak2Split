import "react-native-gesture-handler";
import { useEffect, useState } from "react";
import { Slot, useRouter, useSegments, ErrorBoundary } from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import * as SecureStore from "expo-secure-store";
import * as SplashScreen from "expo-splash-screen";
import {
  useFonts,
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from "@expo-google-fonts/plus-jakarta-sans";
import { useAuthStore } from "../store/auth-store";
import { connectRealtime, disconnectRealtime } from "../lib/realtime";
import { colors } from "../lib/theme";
import { View, ActivityIndicator } from "react-native";

export { ErrorBoundary };

SplashScreen.preventAutoHideAsync().catch(() => {});

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

const ONBOARDING_KEY = "speak2split_has_onboarded";

function RealtimeLifecycle({ token }: { token: string | null }) {
  const refreshProfile = useAuthStore((s) => s.refreshProfile);

  useEffect(() => {
    if (token) {
      connectRealtime(token);
      refreshProfile();
    } else {
      disconnectRealtime();
    }
    return () => {
      if (!token) disconnectRealtime();
    };
  }, [token]);

  return null;
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { token, hasOnboarded, isHydrated, hydrate } = useAuthStore();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    hydrate().catch(() => {});
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    const inAuthGroup = segments[0] === "(auth)";
    const onOnboarding = segments[0] === "onboarding";

    const timer = setTimeout(() => {
      try {
        if (!hasOnboarded && !onOnboarding) {
          router.replace("/onboarding");
        } else if (hasOnboarded && !token && !inAuthGroup) {
          router.replace("/(auth)/login");
        } else if (token && segments[0] !== "(tabs)") {
          router.replace("/(tabs)");
        }
      } catch (e) {
        console.warn("Navigation router error:", e);
      }
    }, 1);

    return () => clearTimeout(timer);
  }, [token, isHydrated, hasOnboarded, segments]);

  if (!isHydrated) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <>
      <RealtimeLifecycle token={token} />
      {children}
    </>
  );
}

export default function RootLayout() {
  const [forceReady, setForceReady] = useState(false);
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  useEffect(() => {
    const timer = setTimeout(() => setForceReady(true), 1500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (fontsLoaded || fontError || forceReady) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, fontError, forceReady]);

  if (!fontsLoaded && !fontError && !forceReady) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="dark" />
      <AuthGate>
        <Slot />
      </AuthGate>
    </QueryClientProvider>
  );
}
