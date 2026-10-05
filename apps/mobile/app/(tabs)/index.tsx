import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Search, Bell, ShoppingCart, Wifi, Receipt, ChevronRight, Mic, Camera, Edit3 } from "lucide-react-native";
import { groupsApi, settlementsApi, expensesApi } from "../../lib/api";
import { useAuthStore } from "../../store/auth-store";
import { colors, spacing, radius, typography, fonts } from "../../lib/theme";
import { useMemo, useState } from "react";

const CATEGORY_ICON: Record<string, any> = {
  groceries: ShoppingCart,
  internet: Wifi,
  electricity: Wifi,
};

export default function DashboardScreen() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  const groupsQuery = useQuery({ queryKey: ["groups"], queryFn: groupsApi.list });

  const groupsKey = groupsQuery.data ? groupsQuery.data.map((g) => g.id).join(",") : "";

  const balancesQuery = useQuery({
    queryKey: ["all-balances", groupsKey],
    queryFn: async () => {
      if (!groupsQuery.data) return [];
      return Promise.all(groupsQuery.data.map((g) => settlementsApi.balances(g.id).then((b) => ({ group: g, ...b }))));
    },
    enabled: !!groupsQuery.data,
  });

  const recentExpensesQuery = useQuery({
    queryKey: ["all-recent-expenses", groupsKey],
    queryFn: async () => {
      if (!groupsQuery.data) return [];
      const all = await Promise.all(
        groupsQuery.data.map((g) => expensesApi.listForGroup(g.id).then((list: any[]) => list.map((e) => ({ ...e, groupName: g.name }))))
      );
      return all
        .flat()
        .sort((a, b) => new Date(b.expenseDate).getTime() - new Date(a.expenseDate).getTime())
        .slice(0, 5);
    },
    enabled: !!groupsQuery.data,
  });

  // Calculate overall user balances across all groups
  const overallSummary = useMemo(() => {
    let youOwe = 0;
    let youAreOwed = 0;
    if (balancesQuery.data && user) {
      for (const g of balancesQuery.data) {
        if (g.suggestedSettlements) {
          for (const s of g.suggestedSettlements) {
            if (s.fromUserId === user.id) youOwe += Number(s.amount || 0);
            if (s.toUserId === user.id) youAreOwed += Number(s.amount || 0);
          }
        }
      }
    }
    const net = youAreOwed - youOwe;
    return { youOwe, youAreOwed, net };
  }, [balancesQuery.data, user]);

  const pendingSettlement = useMemo(() => {
    if (!balancesQuery.data || !user) return null;
    for (const g of balancesQuery.data) {
      const owedToMe = g.suggestedSettlements?.find((s: any) => s.toUserId === user.id);
      if (owedToMe) return { ...owedToMe, groupName: g.group.name, groupId: g.group.id };
    }
    return null;
  }, [balancesQuery.data, user]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([groupsQuery.refetch(), balancesQuery.refetch(), recentExpensesQuery.refetch()]);
    setRefreshing(false);
  };

  const displayName = user?.displayName?.split(" ")[0] || "Friend";

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: spacing.xxl + 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      {/* Header Bar */}
      <View style={styles.topHeader}>
        <View style={styles.brandBadgeRow}>
          <View style={styles.brandIconCircle}>
            <Receipt color={colors.card} size={18} strokeWidth={2.5} />
          </View>
          <Text style={styles.brandTitle}>Speak2Split</Text>
        </View>
        <View style={styles.headerIcons}>
          <Pressable style={styles.iconCircle} onPress={() => router.push("/(tabs)/notifications")}>
            <Bell color={colors.textPrimary} size={18} />
          </Pressable>
          <Pressable style={styles.avatarCircle} onPress={() => router.push("/(tabs)/profile")}>
            <Text style={styles.avatarText}>{displayName.slice(0, 1).toUpperCase()}</Text>
          </Pressable>
        </View>
      </View>

      {/* Greeting Title */}
      <View style={styles.greetingSection}>
        <Text style={styles.hi}>Welcome back, {displayName}</Text>
        <Text style={styles.subGreeting}>Here is your expense summary for today.</Text>
      </View>

      {/* Modern Fintech Total Balance Card */}
      <View style={styles.balanceCard}>
        <View style={styles.balanceCardHeader}>
          <Text style={styles.balanceCardLabel}>TOTAL NET BALANCE</Text>
          <View style={[styles.netStatusBadge, overallSummary.net >= 0 ? styles.badgePositive : styles.badgeNegative]}>
            <Text style={[styles.netStatusText, overallSummary.net >= 0 ? styles.textPositive : styles.textNegative]}>
              {overallSummary.net >= 0 ? "Owed to You" : "You Owe"}
            </Text>
          </View>
        </View>

        <Text style={styles.balanceAmountText}>
          {overallSummary.net >= 0 ? `+₹${overallSummary.net.toFixed(2)}` : `-₹${Math.abs(overallSummary.net).toFixed(2)}`}
        </Text>

        <View style={styles.balanceBreakdownRow}>
          <View style={styles.breakdownCol}>
            <Text style={styles.breakdownLabel}>YOU OWE</Text>
            <Text style={[styles.breakdownValue, { color: colors.coral }]}>₹{overallSummary.youOwe.toFixed(2)}</Text>
          </View>
          <View style={styles.breakdownDivider} />
          <View style={styles.breakdownCol}>
            <Text style={styles.breakdownLabel}>YOU ARE OWED</Text>
            <Text style={[styles.breakdownValue, { color: colors.positive }]}>₹{overallSummary.youAreOwed.toFixed(2)}</Text>
          </View>
        </View>
      </View>

      {/* Search Bar */}
      <Pressable style={styles.searchBar} onPress={() => router.push("/(tabs)/search")}>
        <Search color={colors.textMuted} size={18} />
        <Text style={styles.searchPlaceholder}>Search groups or expenses...</Text>
      </Pressable>

      {/* Quick Add Expense Action Section */}
      <View style={styles.quickAddContainer}>
        <Text style={styles.quickAddLabel}>QUICK EXPENSE ENTRY</Text>
        <View style={styles.quickAddRow}>
          <Pressable
            style={styles.quickAddTile}
            onPress={() => router.push({ pathname: "/(tabs)/add-expense", params: { mode: "voice" } })}
          >
            <View style={[styles.quickAddIconCircle, { backgroundColor: colors.primaryLight }]}>
              <Mic color={colors.primary} size={22} />
            </View>
            <Text style={styles.quickAddTileTitle}>Voice</Text>
            <Text style={styles.quickAddTileSub}>Speech AI</Text>
          </Pressable>

          <Pressable
            style={styles.quickAddTile}
            onPress={() => router.push({ pathname: "/(tabs)/add-expense", params: { mode: "receipt" } })}
          >
            <View style={[styles.quickAddIconCircle, { backgroundColor: colors.positiveSoft }]}>
              <Camera color={colors.positiveDark} size={22} />
            </View>
            <Text style={styles.quickAddTileTitle}>Scan</Text>
            <Text style={styles.quickAddTileSub}>OCR Bill</Text>
          </Pressable>

          <Pressable
            style={styles.quickAddTile}
            onPress={() => router.push({ pathname: "/(tabs)/add-expense", params: { mode: "manual" } })}
          >
            <View style={[styles.quickAddIconCircle, { backgroundColor: colors.warningSoft }]}>
              <Edit3 color={colors.warning} size={22} />
            </View>
            <Text style={styles.quickAddTileTitle}>Manual</Text>
            <Text style={styles.quickAddTileSub}>Type Details</Text>
          </Pressable>
        </View>
      </View>

      {/* Recent Updates / Pending Settlement Banner */}
      {pendingSettlement ? (
        <View style={styles.updateCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.updateCardTag}>PAYMENT NOTIFICATION</Text>
            <Text style={styles.updateTitle}>{pendingSettlement.fromDisplayName} sent a payment</Text>
            <Text style={styles.updateSubtitle}>
              Settle balance of ₹{Number(pendingSettlement.amount || 0).toFixed(2)} in {pendingSettlement.groupName}
            </Text>
          </View>
          <Pressable style={styles.settleButton} onPress={() => router.push(`/(tabs)/groups/${pendingSettlement.groupId}`)}>
            <Text style={styles.settleButtonText}>Settle</Text>
          </Pressable>
        </View>
      ) : null}

      {/* My Groups Section */}
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>Active Groups</Text>
        <Pressable onPress={() => router.push("/(tabs)/groups")}>
          <Text style={styles.viewAll}>View All</Text>
        </Pressable>
      </View>

      {groupsQuery.data?.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No groups created yet</Text>
          <Text style={styles.muted}>Tap View All to create your first group.</Text>
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingLeft: spacing.lg, paddingRight: spacing.md, gap: spacing.md }}>
          {groupsQuery.data?.map((group, idx) => {
            const groupBalance = balancesQuery.data?.find((b) => b.group.id === group.id);
            const total = groupBalance?.balances?.reduce((s: number, b: any) => s + b.totalPaid, 0) ?? 0;
            return (
              <Pressable
                key={group.id}
                style={styles.groupCard}
                onPress={() => router.push(`/(tabs)/groups/${group.id}`)}
              >
                <View style={styles.groupCardTop}>
                  <Text style={styles.groupCardTitle} numberOfLines={1}>
                    {group.name}
                  </Text>
                  <ChevronRight color={colors.textMuted} size={16} />
                </View>
                <Text style={styles.groupCardSubtitle}>
                  Total Pool: ₹{(total || 0).toFixed(0)}
                </Text>

                <View style={styles.groupCardFooter}>
                  <View style={styles.avatarStack}>
                    {(groupBalance?.balances ?? [{ displayName: "User" }, { displayName: "Friend" }]).slice(0, 3).map((b: any, i: number) => (
                      <View key={i} style={[styles.stackAvatar, { marginLeft: i === 0 ? 0 : -8, zIndex: 10 - i }]}>
                        <Text style={styles.stackAvatarText}>{b.displayName?.slice(0, 1).toUpperCase()}</Text>
                      </View>
                    ))}
                  </View>

                  <Pressable
                    style={styles.addExpensesBtn}
                    onPress={() => router.push({ pathname: "/(tabs)/add-expense", params: { groupId: group.id } })}
                  >
                    <Text style={styles.addExpensesBtnText}>+ Add</Text>
                  </Pressable>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {/* Recent Expenses Timeline Section */}
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>Recent Activity</Text>
        <Pressable onPress={() => router.push("/(tabs)/search")}>
          <Text style={styles.viewAll}>View All</Text>
        </Pressable>
      </View>

      <View style={styles.expenseListCard}>
        {recentExpensesQuery.data?.length === 0 && (
          <Text style={styles.muted}>No expenses logged yet.</Text>
        )}
        {recentExpensesQuery.data?.map((e: any, index: number) => {
          const Icon = CATEGORY_ICON[e.category] ?? Receipt;
          const isLast = index === (recentExpensesQuery.data?.length ?? 0) - 1;
          return (
            <View key={e.id} style={[styles.expenseItem, !isLast && styles.expenseItemBorder]}>
              <View style={styles.expenseIconBadge}>
                <Icon color={colors.primary} size={18} strokeWidth={2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.expenseItemTitle}>{e.title}</Text>
                <Text style={styles.expenseItemMeta}>
                  {new Date(e.expenseDate).toLocaleDateString(undefined, { day: "numeric", month: "short" })} · {e.groupName || "Group"}
                </Text>
              </View>
              <Text style={styles.expenseItemAmount}>₹{Number(e.amount).toFixed(2)}</Text>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl + 10,
  },
  brandBadgeRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  brandIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  brandTitle: {
    fontFamily: fonts.extrabold,
    fontSize: 22,
    color: colors.textPrimary,
    letterSpacing: -0.5,
  },
  headerIcons: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  avatarCircle: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 16 },
  greetingSection: { paddingHorizontal: spacing.lg, marginTop: spacing.md },
  hi: { ...typography.display, fontSize: 24, color: colors.textPrimary },
  subGreeting: { ...typography.bodyRegular, color: colors.textSecondary, marginTop: 2 },

  /* Balance Card */
  balanceCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md + 4,
    backgroundColor: colors.primaryDeep,
    borderRadius: 24,
    padding: spacing.lg,
    shadowColor: "#0F172A",
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  balanceCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  balanceCardLabel: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: "#94A3B8",
    letterSpacing: 1,
  },
  netStatusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  badgePositive: { backgroundColor: "#065F46" },
  badgeNegative: { backgroundColor: "#991B1B" },
  netStatusText: { fontFamily: fonts.bold, fontSize: 11 },
  textPositive: { color: "#34D399" },
  textNegative: { color: "#FCA5A5" },
  balanceAmountText: {
    fontFamily: fonts.extrabold,
    fontSize: 34,
    color: "#FFFFFF",
    marginVertical: 12,
    letterSpacing: -1,
  },
  balanceBreakdownRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1E293B",
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginTop: 4,
  },
  breakdownCol: { flex: 1, alignItems: "center" },
  breakdownLabel: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: "#94A3B8",
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  breakdownValue: {
    fontFamily: fonts.bold,
    fontSize: 15,
  },
  breakdownDivider: {
    width: 1,
    height: 24,
    backgroundColor: "#334155",
  },

  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md + 4,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchPlaceholder: { color: colors.textMuted, fontFamily: fonts.medium, fontSize: 15 },
  quickAddContainer: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md + 4,
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  quickAddLabel: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: colors.textMuted,
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
  },
  quickAddRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  quickAddTile: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: 16,
    paddingVertical: spacing.md - 2,
    paddingHorizontal: spacing.xs,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  quickAddIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  quickAddTileTitle: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.textPrimary,
  },
  quickAddTileSub: {
    fontFamily: fonts.medium,
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 1,
  },
  updateCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.primaryLight,
    borderRadius: 20,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.primaryMuted,
  },
  updateCardTag: { color: colors.primary, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 0.8, marginBottom: 2 },
  updateTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 15 },
  updateSubtitle: { color: colors.textSecondary, fontFamily: fonts.medium, fontSize: 13, marginTop: 2 },
  settleButton: { backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 10 },
  settleButtonText: { color: colors.onDark, fontFamily: fonts.bold, fontSize: 13 },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  sectionTitle: { ...typography.title, fontSize: 18, color: colors.textPrimary },
  viewAll: { color: colors.primary, fontFamily: fonts.semibold, fontSize: 14 },
  muted: { color: colors.textMuted, fontSize: 14, fontFamily: fonts.regular },
  emptyState: {
    marginHorizontal: spacing.lg,
    padding: spacing.lg,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    alignItems: "center",
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyTitle: { color: colors.textPrimary, fontFamily: fonts.bold },
  groupCard: {
    width: 210,
    borderRadius: 20,
    padding: spacing.md,
    justifyContent: "space-between",
    minHeight: 135,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  groupCardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  groupCardTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.textPrimary, flex: 1 },
  groupCardSubtitle: { fontFamily: fonts.medium, fontSize: 12, color: colors.textSecondary, marginTop: 4 },
  groupCardFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.md },
  avatarStack: { flexDirection: "row", alignItems: "center" },
  stackAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primaryLight,
    borderWidth: 2,
    borderColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  stackAvatarText: { color: colors.primary, fontSize: 11, fontFamily: fonts.bold },
  addExpensesBtn: { backgroundColor: colors.primaryLight, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
  addExpensesBtnText: { fontFamily: fonts.bold, fontSize: 12, color: colors.primary },
  expenseListCard: {
    marginHorizontal: spacing.lg,
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  expenseItem: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm + 2 },
  expenseItemBorder: { borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  expenseIconBadge: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  expenseItemTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 15 },
  expenseItemMeta: { color: colors.textSecondary, fontFamily: fonts.medium, fontSize: 12, marginTop: 2 },
  expenseItemAmount: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 15 },
});
