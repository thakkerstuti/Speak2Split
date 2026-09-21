import { View, Text, StyleSheet, Pressable, Alert, Image } from "react-native";
import { useAuthStore } from "../../store/auth-store";
import { colors, spacing, radius, typography } from "../../lib/theme";

const PROVIDER_LABELS: Record<string, string> = {
  EMAIL: "Email & password",
  GOOGLE: "Google",
  APPLE: "Apple",
};

export default function ProfileScreen() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const confirmLogout = () => {
    Alert.alert("Log out?", "", [
      { text: "Cancel", style: "cancel" },
      { text: "Log out", style: "destructive", onPress: logout },
    ]);
  };

  return (
    <View style={styles.container}>
      {user?.avatarUrl ? (
        <Image source={{ uri: user.avatarUrl }} style={styles.avatarImage} />
      ) : (
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{user?.displayName?.slice(0, 1).toUpperCase()}</Text>
        </View>
      )}
      <Text style={styles.name}>{user?.displayName}</Text>
      <Text style={styles.email}>{user?.email}</Text>

      {user?.authProviders && user.authProviders.length > 0 && (
        <View style={styles.providerRow}>
          {user.authProviders.map((p) => (
            <View key={p} style={styles.providerChip}>
              <Text style={styles.providerChipText}>{PROVIDER_LABELS[p] ?? p}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.section}>
        <Row label="Notification settings" />
        <Row label="Privacy" />
        <Row label="Export & PDF reports" />
        <Row label="Linked accounts" />
      </View>

      <Pressable style={styles.logoutButton} onPress={confirmLogout}>
        <Text style={styles.logoutText}>Log out</Text>
      </Pressable>
    </View>
  );
}

function Row({ label }: { label: string }) {
  return (
    <Pressable style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, alignItems: "center", paddingTop: spacing.xxl, paddingHorizontal: spacing.lg },
  avatar: { width: 88, height: 88, borderRadius: radius.pill, backgroundColor: colors.accentMuted, alignItems: "center", justifyContent: "center" },
  avatarImage: { width: 88, height: 88, borderRadius: radius.pill, backgroundColor: colors.card },
  avatarText: { color: colors.accent, fontSize: 32, fontWeight: "700" },
  name: { ...typography.title, color: colors.textPrimary, marginTop: spacing.md },
  email: { color: colors.textMuted, marginTop: spacing.xs },
  providerRow: { flexDirection: "row", gap: spacing.xs, marginTop: spacing.sm },
  providerChip: { backgroundColor: colors.card, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4, borderWidth: 1, borderColor: colors.border },
  providerChipText: { color: colors.textSecondary, fontSize: 11, fontWeight: "600" },
  section: { width: "100%", marginTop: spacing.xl },
  row: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  rowLabel: { color: colors.textPrimary, fontSize: 16 },
  logoutButton: { marginTop: spacing.xl, borderWidth: 1, borderColor: colors.negative, borderRadius: radius.md, paddingVertical: 14, paddingHorizontal: spacing.xl },
  logoutText: { color: colors.negative, fontWeight: "700" },
});
