import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Modal, TextInput, Alert, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { groupsApi, settlementsApi, expensesApi, exportsApi } from "../../../lib/api";
import { useAuthStore } from "../../../store/auth-store";
import { useGroupRealtime } from "../../../lib/useGroupRealtime";
import { colors, spacing, radius, typography } from "../../../lib/theme";

export default function GroupDetailScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const router = useRouter();
  const currentUser = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [addMemberVisible, setAddMemberVisible] = useState(false);
  const [memberEmail, setMemberEmail] = useState("");

  // Real-time: joins this group's Socket.IO room for the lifetime of this
  // screen and invalidates the relevant queries below whenever another
  // client changes something — no manual refresh needed.
  useGroupRealtime(groupId);

  const groupQuery = useQuery({ queryKey: ["group", groupId], queryFn: () => groupsApi.detail(groupId!) });
  const balancesQuery = useQuery({ queryKey: ["balances", groupId], queryFn: () => settlementsApi.balances(groupId!) });
  const expensesQuery = useQuery({ queryKey: ["expenses", groupId], queryFn: () => expensesApi.listForGroup(groupId!) });

  const addMemberMutation = useMutation({
    mutationFn: () => groupsApi.addMember(groupId!, memberEmail),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["group", groupId] });
      setAddMemberVisible(false);
      setMemberEmail("");
    },
    onError: (err: any) => Alert.alert("Couldn't add member", err?.response?.data?.error ?? "Try again."),
  });

  const settleMutation = useMutation({
    mutationFn: (input: { toUserId: string; amount: number }) =>
      settlementsApi.create({ groupId: groupId!, toUserId: input.toUserId, amount: input.amount }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["balances", groupId] });
      Alert.alert("Settlement recorded", "Mark it complete once the payment actually goes through.");
    },
  });

  const myBalance = balancesQuery.data?.balances.find((b) => b.userId === currentUser?.id);
  const [exporting, setExporting] = useState(false);
  const authToken = useAuthStore((s) => s.token);

  const exportPdf = async () => {
    if (!groupId || !authToken) return;
    setExporting(true);
    try {
      const fileUri = FileSystem.documentDirectory + `${groupQuery.data?.name ?? "group"}_report.pdf`;
      const result = await FileSystem.downloadAsync(exportsApi.groupPdfUrl(groupId), fileUri, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (result.status !== 200) {
        throw new Error(`Server returned ${result.status}`);
      }
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(result.uri, { mimeType: "application/pdf", dialogTitle: "Speak2Split report" });
      } else {
        Alert.alert("Downloaded", `Saved to ${result.uri}`);
      }
    } catch (err: any) {
      Alert.alert("Export failed", String(err?.message ?? err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.xxl }}>
      <Text style={styles.title}>{groupQuery.data?.name ?? "…"}</Text>
      <Text style={styles.muted}>{groupQuery.data?.members.length ?? 0} members</Text>

      <Pressable style={styles.exportButton} onPress={exportPdf} disabled={exporting}>
        {exporting ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.exportButtonText}>Export PDF report</Text>}
      </Pressable>

      <View style={styles.quickLinkRow}>
        <Pressable style={styles.quickLink} onPress={() => router.push({ pathname: "/(tabs)/groups/shopping-list", params: { groupId } })}>
          <Text style={styles.quickLinkText}>Shopping List</Text>
        </Pressable>
        <Pressable style={styles.quickLink} onPress={() => router.push({ pathname: "/(tabs)/groups/templates", params: { groupId } })}>
          <Text style={styles.quickLinkText}>Templates</Text>
        </Pressable>
        <Pressable style={styles.quickLink} onPress={() => router.push({ pathname: "/(tabs)/groups/documents", params: { groupId } })}>
          <Text style={styles.quickLinkText}>Documents</Text>
        </Pressable>
      </View>

      {myBalance && (
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>YOUR BALANCE</Text>
          <Text style={[styles.balanceAmount, { color: myBalance.netBalance >= 0 ? colors.positive : colors.negative }]}>
            {myBalance.netBalance >= 0 ? "+" : ""}
            ₹{myBalance.netBalance.toFixed(2)}
          </Text>
          <Text style={styles.muted}>{myBalance.netBalance >= 0 ? "you are owed" : "you owe"}</Text>
        </View>
      )}

      <Text style={styles.sectionTitle}>Suggested settlements</Text>
      {balancesQuery.data?.suggestedSettlements.length === 0 && <Text style={styles.muted}>Everyone's settled up 🎉</Text>}
      {balancesQuery.data?.suggestedSettlements.map((s, idx) => (
        <View key={idx} style={styles.settlementRow}>
          <Text style={styles.settlementText}>
            {s.fromDisplayName} → {s.toDisplayName}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Text style={styles.settlementAmount}>₹{s.amount.toFixed(2)}</Text>
            {s.fromUserId === currentUser?.id && (
              <Pressable
                style={styles.settleButton}
                onPress={() => settleMutation.mutate({ toUserId: s.toUserId, amount: s.amount })}
              >
                <Text style={styles.settleButtonText}>Settle</Text>
              </Pressable>
            )}
          </View>
        </View>
      ))}

      <Text style={styles.sectionTitle}>Members</Text>
      {groupQuery.data?.members.map((m) => (
        <Text key={m.id} style={styles.memberRow}>
          {m.displayName} <Text style={styles.muted}>· {m.role.toLowerCase()}</Text>
        </Text>
      ))}
      <Pressable style={styles.addMemberButton} onPress={() => setAddMemberVisible(true)}>
        <Text style={styles.addMemberText}>+ Add member</Text>
      </Pressable>

      <Text style={styles.sectionTitle}>Recent expenses</Text>
      {expensesQuery.data?.length === 0 && <Text style={styles.muted}>No expenses yet.</Text>}
      {expensesQuery.data?.map((e: any) => (
        <View key={e.id} style={styles.expenseRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.expenseTitle}>{e.title}</Text>
            <Text style={styles.muted}>{e.category} · {new Date(e.expenseDate).toLocaleDateString()}</Text>
          </View>
          <Text style={styles.expenseAmount}>₹{Number(e.amount).toFixed(2)}</Text>
        </View>
      ))}

      <Modal visible={addMemberVisible} transparent animationType="slide" onRequestClose={() => setAddMemberVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add member</Text>
            <Text style={styles.muted}>They must already have a Speak2Split account.</Text>
            <TextInput
              style={styles.input}
              placeholder="email@example.com"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              value={memberEmail}
              onChangeText={setMemberEmail}
            />
            <Pressable style={styles.button} onPress={() => addMemberMutation.mutate()} disabled={!memberEmail}>
              <Text style={styles.buttonText}>{addMemberMutation.isPending ? "Adding…" : "Add"}</Text>
            </Pressable>
            <Pressable style={{ marginTop: spacing.md, alignItems: "center" }} onPress={() => setAddMemberVisible(false)}>
              <Text style={styles.muted}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  title: { ...typography.display, fontSize: 26, color: colors.textPrimary },
  exportButton: { marginTop: spacing.sm, alignSelf: "flex-start", borderWidth: 1, borderColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  exportButtonText: { color: colors.accent, fontWeight: "600", fontSize: 13 },
  quickLinkRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  quickLink: { flex: 1, backgroundColor: colors.card, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: "center", borderWidth: 1, borderColor: colors.border },
  quickLinkText: { color: colors.textPrimary, fontSize: 12, fontWeight: "600" },
  muted: { color: colors.textMuted, fontSize: 14 },
  balanceCard: { marginTop: spacing.lg, backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.lg, alignItems: "center" },
  balanceLabel: { ...typography.label, color: colors.textMuted },
  balanceAmount: { fontSize: 34, fontWeight: "700", marginTop: spacing.xs },
  sectionTitle: { ...typography.title, color: colors.textPrimary, marginTop: spacing.xl, marginBottom: spacing.sm },
  settlementRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  settlementText: { color: colors.textPrimary, fontSize: 15 },
  settlementAmount: { color: colors.textSecondary, fontWeight: "600" },
  settleButton: { backgroundColor: colors.accentMuted, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill },
  settleButtonText: { color: colors.accent, fontWeight: "700", fontSize: 13 },
  memberRow: { color: colors.textPrimary, fontSize: 15, paddingVertical: spacing.xs },
  addMemberButton: { marginTop: spacing.sm },
  addMemberText: { color: colors.accent, fontWeight: "600" },
  expenseRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  expenseTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: "600" },
  expenseAmount: { color: colors.textPrimary, fontWeight: "700" },
  modalOverlay: { flex: 1, backgroundColor: "#00000090", justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.bgElevated, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  modalTitle: { ...typography.title, color: colors.textPrimary, marginBottom: spacing.xs },
  input: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, color: colors.textPrimary, fontSize: 16, marginTop: spacing.md },
  button: { marginTop: spacing.lg, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: 16, alignItems: "center" },
  buttonText: { color: colors.bg, fontWeight: "700", fontSize: 16 },
});
