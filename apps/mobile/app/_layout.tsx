import { useEffect, useState } from "react";
import { Slot, useRouter, useSegments } from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import * as SecureStore from "expo-secure-store";
import { useFonts, PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold } from "@expo-google-fonts/plus-jakarta-sans";
import { useAuthStore } from "../store/auth-store";
import { connectRealtime, disconnectRealtime } from "../lib/realtime";
import { colors } from "../lib/theme";
import { View, ActivityIndicator } from "react-native";

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

/**
 * Gates the app on two things, in order: has the person seen the
 * one-time onboarding slider yet, and are they authenticated. The
 * onboarding screen itself writes ONBOARDING_KEY to SecureStore once
 * the person finishes or skips it, so it's genuinely shown only once
 * per device install — not on every cold start.
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  const { token, isHydrated, hydrate } = useAuthStore();
  const segments = useSegments();
  const router = useRouter();
  const [hasOnboarded, setHasOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    hydrate();
    SecureStore.getItemAsync(ONBOARDING_KEY).then((v) => setHasOnboarded(v === "true"));
  }, []);

  useEffect(() => {
    if (!isHydrated || hasOnboarded === null) return;
    const inAuthGroup = segments[0] === "(auth)";
    const onOnboarding = segments[0] === "onboarding";

    if (!hasOnboarded && !onOnboarding) {
      router.replace("/onboarding");
    } else if (hasOnboarded && !token && !inAuthGroup) {
      router.replace("/(auth)/login");
    } else if (token && (inAuthGroup || onOnboarding)) {
      router.replace("/(tabs)");
    }
  }, [token, isHydrated, hasOnboarded, segments]);

  if (!isHydrated || hasOnboarded === null) {
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
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  if (!fontsLoaded) {
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
