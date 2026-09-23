import { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, Alert } from "react-native";
import { Link } from "expo-router";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { authApi } from "../../lib/api";
import { useAuthStore } from "../../store/auth-store";
import { useGoogleAuth } from "../../lib/googleAuth";
import { signInWithApple, isAppleAuthAvailable } from "../../lib/appleAuth";
import { colors, spacing, radius, typography, fonts } from "../../lib/theme";

const schema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
});
type FormValues = z.infer<typeof schema>;

export default function LoginScreen() {
  const setSession = useAuthStore((s) => s.setSession);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [socialLoading, setSocialLoading] = useState<"google" | "apple" | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    isAppleAuthAvailable().then(setAppleAvailable);
  }, []);

  const handleGoogleIdToken = async (idToken: string) => {
    setSocialLoading("google");
    setServerError(null);
    try {
      const { token, user } = await authApi.google(idToken);
      await setSession(token, user);
    } catch (err: any) {
      setServerError(err?.response?.data?.error ?? "Google sign-in failed. Please try again.");
    } finally {
      setSocialLoading(null);
    }
  };

  const google = useGoogleAuth(handleGoogleIdToken);

  const onPressGoogle = async () => {
    if (!google.isConfigured) {
      Alert.alert(
        "Google Sign-In Notice",
        "Google Sign-In requires your Google Web Client ID (EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID). Email/Password Sign-In is fully active and recommended for testing!"
      );
      return;
    }
    await google.promptAsync();
  };

  const onPressApple = async () => {
    setSocialLoading("apple");
    setServerError(null);
    try {
      const result = await signInWithApple();
      if (result.status === "cancelled") return;
      if (result.status === "error") {
        setServerError(result.message);
        return;
      }
      const { token, user } = await authApi.apple(result.identityToken, result.fullName);
      await setSession(token, user);
    } catch (err: any) {
      setServerError(err?.response?.data?.error ?? "Apple sign-in failed. Please try again.");
    } finally {
      setSocialLoading(null);
    }
  };

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = async (values: FormValues) => {
    setServerError(null);
    setSubmitting(true);
    try {
      let res;
      try {
        res = await authApi.login(values);
      } catch (firstErr: any) {
        if (
          !firstErr?.response ||
          firstErr?.response?.status === 502 ||
          firstErr?.response?.status === 503 ||
          firstErr?.code === "ECONNABORTED"
        ) {
          setServerError("Server is waking up. Retrying connection…");
          await new Promise((r) => setTimeout(r, 2500));
          res = await authApi.login(values);
        } else {
          throw firstErr;
        }
      }
      await setSession(res.token, res.user);
    } catch (err: any) {
      if (err?.response?.status === 502 || err?.response?.status === 503) {
        setServerError("Backend service is waking up or connecting to database. Please tap Sign In again in a few seconds.");
      } else {
        setServerError(err?.response?.data?.error ?? "Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.wordmark}>Speak2Split</Text>
          <Text style={styles.tagline}>Say it. Split it. Settle it with ease.</Text>
        </View>

        <View style={styles.formCard}>
          <Text style={styles.label}>EMAIL</Text>
          <Controller
            control={control}
            name="email"
            render={({ field: { onChange, value } }) => (
              <TextInput
                style={styles.input}
                placeholder="you@example.com"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                keyboardType="email-address"
                value={value}
                onChangeText={onChange}
              />
            )}
          />
          {errors.email && <Text style={styles.error}>{errors.email.message}</Text>}

          <Text style={[styles.label, { marginTop: spacing.md }]}>PASSWORD</Text>
          <Controller
            control={control}
            name="password"
            render={({ field: { onChange, value } }) => (
              <TextInput
                style={styles.input}
                placeholder="••••••••"
                placeholderTextColor={colors.textMuted}
                secureTextEntry
                value={value}
                onChangeText={onChange}
              />
            )}
          />
          {errors.password && <Text style={styles.error}>{errors.password.message}</Text>}

          {serverError && <Text style={styles.serverError}>{serverError}</Text>}

          <Pressable
            style={({ pressed }) => [styles.button, pressed && { opacity: 0.9 }]}
            onPress={handleSubmit(onSubmit)}
            disabled={submitting}
          >
            <Text style={styles.buttonText}>{submitting ? "Signing in…" : "Sign In"}</Text>
          </Pressable>

          <Link href="/(auth)/register" asChild>
            <Pressable style={styles.linkRow}>
              <Text style={styles.linkText}>New here? Create an account</Text>
            </Pressable>
          </Link>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>OR</Text>
            <View style={styles.dividerLine} />
          </View>

          <Pressable
            style={({ pressed }) => [styles.socialButton, pressed && { opacity: 0.85 }]}
            onPress={onPressGoogle}
            disabled={socialLoading !== null}
          >
            {socialLoading === "google" ? (
              <ActivityIndicator color={colors.textPrimary} />
            ) : (
              <Text style={styles.socialButtonText}>Continue with Google</Text>
            )}
          </Pressable>

          {appleAvailable && (
            <Pressable
              style={({ pressed }) => [styles.socialButton, styles.appleButton, pressed && { opacity: 0.85 }]}
              onPress={onPressApple}
              disabled={socialLoading !== null}
            >
              {socialLoading === "apple" ? (
                <ActivityIndicator color={colors.onDark} />
              ) : (
                <Text style={styles.appleButtonText}>Continue with Apple</Text>
              )}
            </Pressable>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1, paddingHorizontal: spacing.lg, justifyContent: "center" },
  header: { marginBottom: spacing.xl, alignItems: "center" },
  wordmark: { ...typography.display, fontSize: 32, color: colors.primary, letterSpacing: -0.5 },
  tagline: { ...typography.bodyRegular, color: colors.textSecondary, marginTop: 4 },
  formCard: {
    backgroundColor: colors.card,
    borderRadius: 24,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: colors.textPrimary,
    shadowOpacity: 0.04,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  label: { ...typography.label, color: colors.textMuted },
  input: {
    marginTop: spacing.xs + 2,
    backgroundColor: "#F8FAFC",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    color: colors.textPrimary,
    fontSize: 15,
    fontFamily: fonts.medium,
  },
  error: { color: colors.negative, marginTop: spacing.xs, fontSize: 13, fontFamily: fonts.medium },
  serverError: { color: colors.negative, marginTop: spacing.md, fontSize: 14, textAlign: "center", fontFamily: fonts.medium },
  button: {
    marginTop: spacing.xl,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 16,
    alignItems: "center",
  },
  buttonText: { color: colors.onDark, fontSize: 16, fontFamily: fonts.bold },
  linkRow: { marginTop: spacing.lg, alignItems: "center" },
  linkText: { color: colors.textSecondary, fontSize: 14, fontFamily: fonts.semibold },
  divider: { flexDirection: "row", alignItems: "center", marginTop: spacing.xl, gap: spacing.sm },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { color: colors.textMuted, fontSize: 12, fontFamily: fonts.semibold, letterSpacing: 1 },
  socialButton: {
    marginTop: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    alignItems: "center",
  },
  socialButtonText: { color: colors.textPrimary, fontSize: 15, fontFamily: fonts.bold },
  appleButton: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  appleButtonText: { color: colors.onDark, fontSize: 15, fontFamily: fonts.bold },
});
