import { View, Text, StyleSheet, Alert, Image, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import Constants from "expo-constants";
import { Bell, FileDown, Users, Mic, LogOut, ChevronRight, Contact2 } from "lucide-react-native";
import { useAuthStore } from "../../store/auth-store";
import { colors, spacing, radius, fonts } from "../../lib/theme";
import { Avatar, Button, Card, ListRow, ScreenHeader } from "../../components/ui";

const PROVIDER_LABELS: Record<string, string> = {
  EMAIL: "Email",
  GOOGLE: "Google",
  APPLE: "Apple",
};

export default function ProfileScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const confirmLogout = () =>
    Alert.alert("Log out?", "You'll need to sign in again to see your groups.", [
      { text: "Cancel", style: "cancel" },
      { text: "Log out", style: "destructive", onPress: logout },
    ]);

  const icon = (Icon: any, bg = colors.primaryLight, fg = colors.primary) => (
    <View style={[styles.rowIcon, { backgroundColor: bg }]}>
      <Icon color={fg} size={18} />
    </View>
  );
  const chevron = <ChevronRight color={colors.textMuted} size={18} />;

  return (
    <View style={styles.container}>
      <ScreenHeader title="Profile" />
      <ScrollView contentContainerStyle={styles.body}>
        <Card style={styles.profileCard}>
          {user?.avatarUrl ? <Image source={{ uri: user.avatarUrl }} style={styles.avatarImage} /> : <Avatar name={user?.displayName} size={76} />}
          <Text style={styles.name}>{user?.displayName}</Text>
          <Text style={styles.email}>{user?.email}</Text>
          {user?.authProviders?.length ? (
            <View style={styles.providerRow}>
              {user.authProviders.map((p) => (
                <View key={p} style={styles.providerChip}>
                  <Text style={styles.providerText}>Signed in with {PROVIDER_LABELS[p] ?? p}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </Card>

        <Card padded={false} style={styles.listCard}>
          <ListRow left={icon(Bell)} title="Notifications" subtitle="Alerts and delivery preferences" right={chevron} onPress={() => router.push("/(tabs)/notifications")} />
          <ListRow left={icon(Users)} title="Groups" subtitle="Members, balances and settle up" right={chevron} onPress={() => router.push("/(tabs)/groups")} />
          <ListRow left={icon(Contact2)} title="People" subtitle="Contacts used for name matching" right={chevron} onPress={() => router.push("/(tabs)/people")} />
          <ListRow
            left={icon(FileDown)}
            title="PDF reports"
            subtitle="Open a group and tap the download icon"
            right={chevron}
            onPress={() => router.push("/(tabs)/groups")}
            last
          />
        </Card>

        <Card style={styles.tipCard}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            {icon(Mic, colors.primary, colors.onDark)}
            <Text style={styles.tipTitle}>Voice tips</Text>
          </View>
          <Text style={styles.tipText}>
            • Say the amount, what it was for and who shared it.{"\n"}• Mention the group name to pick it — e.g. “for the Goa trip”.{"\n"}• Say “I paid” or
            “Rahul paid” to set the payer.{"\n"}• It stops listening automatically when you finish.
          </Text>
        </Card>

        <Button label="Log out" icon={LogOut} variant="danger" onPress={confirmLogout} style={{ marginTop: spacing.lg }} />
        <Text style={styles.version}>Speak2Split {Constants.expoConfig?.version ?? ""}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  body: { paddingHorizontal: spacing.lg, paddingBottom: 120 },
  profileCard: { alignItems: "center", paddingVertical: spacing.lg },
  avatarImage: { width: 76, height: 76, borderRadius: 38 },
  name: { fontFamily: fonts.bold, fontSize: 21, color: colors.textPrimary, marginTop: spacing.sm, letterSpacing: -0.3 },
  email: { fontFamily: fonts.medium, fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  providerRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: spacing.xs, marginTop: spacing.md },
  providerChip: { backgroundColor: colors.primaryLight, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 5 },
  providerText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.primary },
  listCard: { marginTop: spacing.md, paddingHorizontal: spacing.md },
  rowIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  tipCard: { marginTop: spacing.md, backgroundColor: colors.primaryLight, borderColor: colors.primaryMuted },
  tipTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.primaryDeep },
  tipText: { fontFamily: fonts.medium, fontSize: 13, color: colors.primaryDeep, lineHeight: 21, marginTop: spacing.sm },
  version: { fontFamily: fonts.regular, fontSize: 12, color: colors.textMuted, textAlign: "center", marginTop: spacing.md },
});
