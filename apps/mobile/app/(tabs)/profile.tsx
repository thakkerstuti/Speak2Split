import { View, Text, StyleSheet, Pressable, Alert, Image } from "react-native";
import { ChevronRight, Bell, Shield, Download, Link as LinkIcon, LogOut } from "lucide-react-native";
import { useAuthStore } from "../../store/auth-store";
import { colors, spacing, radius, typography, fonts } from "../../lib/theme";

const PROVIDER_LABELS: Record<string, string> = {
  EMAIL: "Email & password",
  GOOGLE: "Google Sign-In",
  APPLE: "Apple Sign-In",
};

export default function ProfileScreen() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const confirmLogout = () => {
    Alert.alert("Log out?", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Log out", style: "destructive", onPress: logout },
    ]);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.headerTitle}>Profile</Text>

      {/* User Header Info Card */}
      <View style={styles.profileHeaderCard}>
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
      </View>

      {/* Settings Section Card */}
      <View style={styles.sectionCard}>
        <Row icon={Bell} label="Notifications" sub="Push & email preferences" />
        <Row icon={Shield} label="Security & Privacy" sub="Account security settings" />
        <Row icon={Download} label="Export & PDF Reports" sub="Download transaction history" />
        <Row icon={LinkIcon} label="Linked Accounts" sub="Connected Google accounts" isLast />
      </View>

      <Pressable style={styles.logoutButton} onPress={confirmLogout}>
        <LogOut color={colors.negative} size={18} />
        <Text style={styles.logoutText}>Log Out</Text>
      </Pressable>
    </View>
  );
}

function Row({ icon: Icon, label, sub, isLast }: { icon: any; label: string; sub: string; isLast?: boolean }) {
  return (
    <Pressable style={[styles.row, isLast && { borderBottomWidth: 0 }]}>
      <View style={styles.rowIconBadge}>
        <Icon color={colors.primary} size={18} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowSub}>{sub}</Text>
      </View>
      <ChevronRight color={colors.textMuted} size={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingTop: spacing.xxl + 8, paddingHorizontal: spacing.lg },
  headerTitle: { ...typography.display, fontSize: 28, color: colors.textPrimary, marginBottom: spacing.md },
  profileHeaderCard: {
    backgroundColor: colors.card,
    borderRadius: 24,
    padding: spacing.lg,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
  },
  avatar: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.primaryLight, alignItems: "center", justifyContent: "center" },
  avatarImage: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.card },
  avatarText: { color: colors.primary, fontSize: 28, fontFamily: fonts.bold },
  name: { ...typography.title, color: colors.textPrimary, marginTop: spacing.sm },
  email: { color: colors.textSecondary, fontFamily: fonts.medium, fontSize: 13, marginTop: 2 },
  providerRow: { flexDirection: "row", gap: spacing.xs, marginTop: spacing.md },
  providerChip: { backgroundColor: colors.primaryLight, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 4, borderWidth: 1, borderColor: colors.primaryMuted },
  providerChipText: { color: colors.primary, fontSize: 12, fontFamily: fonts.bold },
  sectionCard: {
    backgroundColor: colors.card,
    borderRadius: 24,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  rowIconBadge: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.primaryLight, alignItems: "center", justifyContent: "center" },
  rowLabel: { color: colors.textPrimary, fontSize: 15, fontFamily: fonts.semibold },
  rowSub: { color: colors.textMuted, fontSize: 12, fontFamily: fonts.regular, marginTop: 1 },
  logoutButton: {
    marginTop: spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: colors.negativeSoft,
    backgroundColor: colors.negativeSoft,
    borderRadius: radius.pill,
    paddingVertical: 14,
  },
  logoutText: { color: colors.negative, fontFamily: fonts.bold, fontSize: 15 },
});
