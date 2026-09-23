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
      const { token, user } = await authApi.register(values);
      await setSession(token, user);
    } catch (err: any) {
      if (err?.response?.status === 502 || err?.response?.status === 503) {
        setServerError("Backend service is waking up or connecting to database. Please tap Create account again in a few seconds.");
      } else {
        setServerError(err?.response?.data?.error ?? "Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.header}>
        <Text style={styles.title}>Create your account</Text>
        <Text style={styles.subtitle}>Takes about 20 seconds.</Text>
      </View>

      <View style={styles.form}>
        <Text style={styles.label}>NAME</Text>
        <Controller
          control={control}
          name="displayName"
          render={({ field: { onChange, value } }) => (
            <TextInput style={styles.input} placeholder="Rohan Mehta" placeholderTextColor={colors.textMuted} value={value} onChangeText={onChange} />
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
            <TextInput style={styles.input} placeholder="At least 8 characters" placeholderTextColor={colors.textMuted} secureTextEntry value={value} onChangeText={onChange} />
          )}
        />
        {errors.password && <Text style={styles.error}>{errors.password.message}</Text>}

        {serverError && <Text style={styles.serverError}>{serverError}</Text>}

        <Pressable style={({ pressed }) => [styles.button, pressed && { opacity: 0.85 }]} onPress={handleSubmit(onSubmit)} disabled={submitting}>
          <Text style={styles.buttonText}>{submitting ? "Creating…" : "Create account"}</Text>
        </Pressable>

        <Link href="/(auth)/login" asChild>
          <Pressable style={styles.linkRow}>
            <Text style={styles.linkText}>Already have an account? Sign in</Text>
          </Pressable>
        </Link>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.lg, justifyContent: "center" },
  header: { marginBottom: spacing.xl },
  title: { ...typography.title, color: colors.textPrimary },
  subtitle: { ...typography.body, color: colors.textSecondary, marginTop: spacing.xs },
  form: {},
  label: { ...typography.label, color: colors.textMuted },
  input: {
    marginTop: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    color: colors.textPrimary,
    fontSize: 16,
  },
  error: { color: colors.negative, marginTop: spacing.xs, fontSize: 13 },
  serverError: { color: colors.negative, marginTop: spacing.md, fontSize: 14, textAlign: "center" },
  button: { marginTop: spacing.xl, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: 16, alignItems: "center" },
  buttonText: { color: colors.onDark, fontSize: 16, fontFamily: fonts.bold },
  linkRow: { marginTop: spacing.lg, alignItems: "center" },
  linkText: { color: colors.textSecondary, fontSize: 14 },
});
