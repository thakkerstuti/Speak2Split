import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Alert, ActivityIndicator, RefreshControl } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Download, Mic, UserPlus, ShoppingCart, LayoutTemplate, FileText, ArrowRight, Receipt, CheckCircle2 } from "lucide-react-native";
import { groupsApi, settlementsApi, expensesApi, exportsApi, SuggestedSettlement } from "../../../lib/api";
import { useAuthStore } from "../../../store/auth-store";
import { useGroupRealtime } from "../../../lib/useGroupRealtime";
import { colors, spacing, radius, fonts, shadows } from "../../../lib/theme";
import { formatINR, formatShortDate, firstName } from "../../../lib/format";
import { Avatar, Button, Card, CategoryIcon, Chip, EmptyState, IconButton, ScreenHeader, SectionHeader, Sheet, Skeleton } from "../../../components/ui";

const METHODS = [
  { id: "UPI", label: "UPI" },
  { id: "CASH", label: "Cash" },
  { id: "BANK_TRANSFER", label: "Bank" },
  { id: "OTHER", label: "Other" },
];

export default function GroupDetailScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const router = useRouter();
  const me = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const queryClient = useQueryClient();
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [memberEmail, setMemberEmail] = useState("");
  const [settling, setSettling] = useState<SuggestedSettlement | null>(null);
  const [method, setMethod] = useState("UPI");
  const [exporting, setExporting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useGroupRealtime(groupId);

  const groupQuery = useQuery({ queryKey: ["group", groupId], queryFn: () => groupsApi.detail(groupId!), enabled: !!groupId });
  const balancesQuery = useQuery({ queryKey: ["balances", groupId], queryFn: () => settlementsApi.balances(groupId!), enabled: !!groupId });
  const expensesQuery = useQuery({ queryKey: ["expenses", groupId], queryFn: () => expensesApi.listForGroup(groupId!), enabled: !!groupId });

  const members = (groupQuery.data?.members ?? []).filter((m) => m.status === "ACTIVE");
  const nameOf = (id: string) => (id === me?.id ? "You" : members.find((m) => m.id === id)?.displayName ?? "Someone");
  const myBalance = balancesQuery.data?.balances.find((b) => b.userId === me?.id)?.netBalance ?? 0;

  const refreshAll = () => {
    for (const key of [["balances", groupId], ["expenses", groupId], ["group", groupId]]) queryClient.invalidateQueries({ queryKey: key });
    for (const key of ["all-balances", "groups-balances-list"]) queryClient.invalidateQueries({ queryKey: [key] });
  };

  const addMemberMutation = useMutation({
    mutationFn: () => groupsApi.addMember(groupId!, memberEmail.trim()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["group", groupId] });
      setAddMemberOpen(false);
      setMemberEmail("");
    },
    onError: (err: any) => Alert.alert("Couldn't add member", err?.response?.data?.error ?? "Please try again."),
  });

  // Records the payment and immediately marks it complete so balances update.
  const settleMutation = useMutation({
    mutationFn: async (s: SuggestedSettlement) => {
      const created = await settlementsApi.create({ groupId: groupId!, toUserId: s.toUserId, amount: s.amount, method });
      const id = created?.id ?? created?._id;
      if (id) await settlementsApi.complete(String(id));
      return created;
    },
    onSuccess: () => {
      setSettling(null);
      refreshAll();
    },
    onError: (err: any) => Alert.alert("Couldn't record payment", err?.response?.data?.error ?? "Please try again."),
  });

  const exportPdf = async () => {
    if (!groupId || !token) return;
    setExporting(true);
    try {
      const safeName = (groupQuery.data?.name ?? "group").replace(/[^a-z0-9-_ ]/gi, "").trim() || "group";
      const fileUri = `${FileSystem.documentDirectory}${safeName}_report.pdf`;
      const result = await FileSystem.downloadAsync(exportsApi.groupPdfUrl(groupId), fileUri, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (result.status !== 200) throw new Error(`Server returned ${result.status}`);
      if (await Sharing.isAvailableAsync()) {
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

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([groupQuery.refetch(), balancesQuery.refetch(), expensesQuery.refetch()]);
    setRefreshing(false);
  };

  const speak = () =>
    router.push({ pathname: "/(tabs)/add-expense", params: { mode: "voice", groupId: groupId!, autostart: String(Date.now()) } });

  const suggestions = balancesQuery.data?.suggestedSettlements ?? [];

  return (
    <View style={styles.container}>
      <ScreenHeader
        title={groupQuery.data?.name ?? " "}
        subtitle={groupQuery.data ? `${members.length} ${members.length === 1 ? "member" : "members"}` : undefined}
        large={false}
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/groups"))}
        right={exporting ? <ActivityIndicator color={colors.primary} /> : <IconButton icon={Download} label="Export PDF report" onPress={exportPdf} />}
      />

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* Balance */}
        <View
          style={[
            styles.balanceCard,
            { backgroundColor: myBalance > 0.009 ? colors.positiveSoft : myBalance < -0.009 ? colors.negativeSoft : colors.card },
          ]}
        >
          <Text style={styles.balanceLabel}>YOUR BALANCE</Text>
          {balancesQuery.isLoading ? (
            <Skeleton width={140} height={34} style={{ marginTop: 8 }} />
          ) : (
            <Text
              style={[
                styles.balanceAmount,
                { color: myBalance > 0.009 ? colors.positiveDark : myBalance < -0.009 ? colors.negativeDark : colors.textPrimary },
              ]}
            >
              {Math.abs(myBalance) < 0.01 ? "All settled" : formatINR(Math.abs(myBalance))}
            </Text>
          )}
          {Math.abs(myBalance) >= 0.01 ? (
            <Text style={styles.balanceCaption}>{myBalance > 0 ? "you are owed in total" : "you owe in total"}</Text>
          ) : null}
        </View>

        <View style={styles.actionsRow}>
          <Button label="Add by voice" icon={Mic} onPress={speak} full={false} style={{ flex: 1 }} />
          <Button label="Member" icon={UserPlus} variant="secondary" onPress={() => setAddMemberOpen(true)} full={false} style={{ paddingHorizontal: spacing.md }} />
        </View>

        <View style={styles.toolsRow}>
          <Chip icon={ShoppingCart} label="Shopping" onPress={() => router.push({ pathname: "/(tabs)/groups/shopping-list", params: { groupId } })} />
          <Chip icon={LayoutTemplate} label="Templates" onPress={() => router.push({ pathname: "/(tabs)/groups/templates", params: { groupId } })} />
          <Chip icon={FileText} label="Documents" onPress={() => router.push({ pathname: "/(tabs)/groups/documents", params: { groupId } })} />
        </View>

        {/* Settle up */}
        <SectionHeader title="Settle up" />
        <Card padded={false} style={{ paddingHorizontal: spacing.md }}>
          {balancesQuery.isLoading ? (
            <View style={{ paddingVertical: spacing.md, gap: spacing.sm }}>
              <Skeleton height={36} />
              <Skeleton height={36} />
            </View>
          ) : suggestions.length === 0 ? (
            <View style={styles.settledRow}>
              <CheckCircle2 color={colors.positive} size={20} />
              <Text style={styles.settledText}>Everyone's settled up</Text>
            </View>
          ) : (
            suggestions.map((s, i) => {
              const mine = s.fromUserId === me?.id;
              return (
                <View key={`${s.fromUserId}-${s.toUserId}`} style={[styles.settleRow, i < suggestions.length - 1 && styles.divider]}>
                  <Avatar name={s.fromDisplayName} size={30} />
                  <ArrowRight color={colors.textMuted} size={14} />
                  <Avatar name={s.toDisplayName} size={30} />
                  <View style={{ flex: 1, marginLeft: 4 }}>
                    <Text style={styles.settleText} numberOfLines={1}>
                      {mine ? "You" : firstName(s.fromDisplayName)} → {s.toUserId === me?.id ? "you" : firstName(s.toDisplayName)}
                    </Text>
                    <Text style={styles.settleAmount}>{formatINR(s.amount)}</Text>
                  </View>
                  {mine ? <Button label="Settle" size="md" full={false} onPress={() => setSettling(s)} /> : null}
                </View>
              );
            })
          )}
        </Card>

        {/* Members */}
        <SectionHeader title="Members" actionLabel="Add" onAction={() => setAddMemberOpen(true)} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md }}>
          {members.map((m) => {
            const bal = balancesQuery.data?.balances.find((b) => b.userId === m.id)?.netBalance ?? 0;
            return (
              <View key={m.id} style={styles.memberTile}>
                <Avatar name={m.displayName} size={44} />
                <Text style={styles.memberName} numberOfLines={1}>{m.id === me?.id ? "You" : firstName(m.displayName)}</Text>
                <Text style={[styles.memberBal, { color: bal > 0.009 ? colors.positiveDark : bal < -0.009 ? colors.negativeDark : colors.textMuted }]}>
                  {Math.abs(bal) < 0.01 ? "settled" : formatINR(bal, { sign: true })}
                </Text>
              </View>
            );
          })}
        </ScrollView>

        {/* Expenses */}
        <SectionHeader title="Expenses" />
        <Card padded={false} style={{ paddingHorizontal: spacing.md }}>
          {expensesQuery.isLoading ? (
            <View style={{ paddingVertical: spacing.md, gap: spacing.sm }}>
              <Skeleton height={42} />
              <Skeleton height={42} />
              <Skeleton height={42} />
            </View>
          ) : !expensesQuery.data?.length ? (
            <EmptyState icon={Receipt} title="No expenses yet" body="Tap “Add by voice” and say what you spent." />
          ) : (
            expensesQuery.data.map((e: any, i: number) => {
              const myShare = Number(e.participants?.find((p: any) => String(p.userId) === me?.id)?.shareAmount ?? 0);
              const myPaid = Number(e.payers?.find((p: any) => String(p.userId) === me?.id)?.amountPaid ?? 0);
              const diff = myPaid - myShare;
              const payerName = e.payers?.length > 1 ? `${e.payers.length} people` : nameOf(String(e.payers?.[0]?.userId));
              return (
                <View key={e.id} style={[styles.expenseRow, i < expensesQuery.data.length - 1 && styles.divider]}>
                  <CategoryIcon category={e.category} size={42} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.expenseTitle} numberOfLines={1}>{e.title}</Text>
                    <Text style={styles.expenseMeta} numberOfLines={1}>
                      {payerName} paid {formatINR(e.amount)} · {formatShortDate(e.expenseDate)}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    {Math.abs(diff) < 0.01 ? (
                      <Text style={styles.expenseNeutral}>{myShare > 0 ? "even" : "not involved"}</Text>
                    ) : (
                      <>
                        <Text style={[styles.expenseDiffLabel, { color: diff > 0 ? colors.positiveDark : colors.negativeDark }]}>
                          {diff > 0 ? "you lent" : "you borrowed"}
                        </Text>
                        <Text style={[styles.expenseDiff, { color: diff > 0 ? colors.positiveDark : colors.negativeDark }]}>{formatINR(Math.abs(diff))}</Text>
                      </>
                    )}
                  </View>
                </View>
              );
            })
          )}
        </Card>
      </ScrollView>

      {/* Settle sheet */}
      <Sheet
        visible={!!settling}
        onClose={() => setSettling(null)}
        title={settling ? `Pay ${firstName(settling.toDisplayName)} ${formatINR(settling.amount)}` : ""}
        subtitle="Record this once you've actually paid. It will update everyone's balance."
      >
        <Text style={styles.sheetLabel}>HOW DID YOU PAY?</Text>
        <View style={styles.methodRow}>
          {METHODS.map((m) => (
            <Chip key={m.id} label={m.label} selected={method === m.id} onPress={() => setMethod(m.id)} />
          ))}
        </View>
        <Button
          label="Mark as paid"
          icon={CheckCircle2}
          onPress={() => settling && settleMutation.mutate(settling)}
          loading={settleMutation.isPending}
          style={{ marginTop: spacing.lg }}
        />
      </Sheet>

      {/* Add member sheet */}
      <Sheet
        visible={addMemberOpen}
        onClose={() => setAddMemberOpen(false)}
        title="Add a member"
        subtitle="Enter the email they use for Speak2Split."
      >
        <TextInput
          style={styles.input}
          placeholder="friend@example.com"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          keyboardType="email-address"
          autoFocus
          value={memberEmail}
          onChangeText={setMemberEmail}
          onSubmitEditing={() => memberEmail.trim() && addMemberMutation.mutate()}
        />
        <Button
          label="Add to group"
          onPress={() => addMemberMutation.mutate()}
          loading={addMemberMutation.isPending}
          disabled={!memberEmail.trim()}
          style={{ marginTop: spacing.lg }}
        />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  body: { paddingHorizontal: spacing.lg, paddingBottom: 120 },

  balanceCard: { borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, ...shadows.sm },
  balanceLabel: { fontFamily: fonts.bold, fontSize: 11, color: colors.textMuted, letterSpacing: 0.8 },
  balanceAmount: { fontFamily: fonts.extrabold, fontSize: 32, marginTop: 6, letterSpacing: -1 },
  balanceCaption: { fontFamily: fonts.medium, fontSize: 13, color: colors.textSecondary, marginTop: 2 },

  actionsRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  toolsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },

  settledRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.md },
  settledText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.textSecondary },
  settleRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 12 },
  settleText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.textPrimary },
  settleAmount: { fontFamily: fonts.bold, fontSize: 15, color: colors.textPrimary, marginTop: 1 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },

  memberTile: { width: 76, alignItems: "center" },
  memberName: { fontFamily: fonts.semibold, fontSize: 13, color: colors.textPrimary, marginTop: 6 },
  memberBal: { fontFamily: fonts.bold, fontSize: 11, marginTop: 1 },

  expenseRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: 12 },
  expenseTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.textPrimary },
  expenseMeta: { fontFamily: fonts.medium, fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  expenseDiffLabel: { fontFamily: fonts.semibold, fontSize: 11 },
  expenseDiff: { fontFamily: fonts.bold, fontSize: 15 },
  expenseNeutral: { fontFamily: fonts.medium, fontSize: 12, color: colors.textMuted },

  sheetLabel: { fontFamily: fonts.bold, fontSize: 11, color: colors.textMuted, letterSpacing: 0.8 },
  methodRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.cardTinted,
    borderRadius: radius.sm + 2,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    fontFamily: fonts.medium,
    fontSize: 15,
    color: colors.textPrimary,
  },
});
