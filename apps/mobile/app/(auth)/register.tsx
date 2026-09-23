import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from "react-native";
import { Link } from "expo-router";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { authApi } from "../../lib/api";
import { useAuthStore } from "../../store/auth-store";
import { colors, spacing, radius, typography, fonts } from "../../lib/theme";

const schema = z.object({
  displayName: z.string().min(1, "Enter your name"),
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "At least 8 characters"),
});
type FormValues = z.infer<typeof schema>;

export default function RegisterScreen() {
  const setSession = useAuthStore((s) => s.setSession);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
        res = await authApi.register(values);
      } catch (firstErr: any) {
        if (
          !firstErr?.response ||
          firstErr?.response?.status === 502 ||
          firstErr?.response?.status === 503 ||
          firstErr?.code === "ECONNABORTED"
        ) {
          setServerError("Server is waking up. Retrying connection…");
          await new Promise((r) => setTimeout(r, 2500));
          try {
            res = await authApi.register(values);
          } catch (retryErr: any) {
            if (retryErr?.response?.status === 409) {
              res = await authApi.login({ email: values.email, password: values.password });
            } else {
              throw retryErr;
            }
          }
        } else {
          throw firstErr;
        }
      }
      await setSession(res.token, res.user);
    } catch (err: any) {
      if (err?.response?.status === 502 || err?.response?.status === 503) {
        setServerError("Backend database is unreachable or waking up. Please try again in a few seconds.");
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
          <Text style={styles.title}>Create your account</Text>
          <Text style={styles.subtitle}>Takes about 20 seconds to get started.</Text>
        </View>

        <View style={styles.formCard}>
          <Text style={styles.label}>FULL NAME</Text>
          <Controller
            control={control}
            name="displayName"
            render={({ field: { onChange, value } }) => (
              <TextInput
                style={styles.input}
                placeholder="Arafat Sharma"
                placeholderTextColor={colors.textMuted}
                value={value}
                onChangeText={onChange}
              />
            )}
          />
          {errors.displayName && <Text style={styles.error}>{errors.displayName.message}</Text>}

          <Text style={[styles.label, { marginTop: spacing.md }]}>EMAIL</Text>
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
                placeholder="At least 8 characters"
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
            <Text style={styles.buttonText}>{submitting ? "Creating…" : "Create Account"}</Text>
          </Pressable>

          <Link href="/(auth)/login" asChild>
            <Pressable style={styles.linkRow}>
              <Text style={styles.linkText}>Already have an account? Sign in</Text>
            </Pressable>
          </Link>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1, paddingHorizontal: spacing.lg, justifyContent: "center" },
  header: { marginBottom: spacing.lg, alignItems: "center" },
  wordmark: { ...typography.display, fontSize: 28, color: colors.primary, letterSpacing: -0.5, marginBottom: 4 },
  title: { ...typography.title, fontSize: 20, color: colors.textPrimary },
  subtitle: { ...typography.bodyRegular, color: colors.textSecondary, marginTop: 2 },
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
});
