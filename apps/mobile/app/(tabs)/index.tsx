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
      {/* Top Header Row with Logo & Avatar */}
      <View style={styles.topHeader}>
        <Text style={styles.brandTitle}>Speak2Split</Text>
        <View style={styles.headerIcons}>
          <Pressable style={styles.iconCircle} onPress={() => router.push("/(tabs)/notifications")}>
            <Bell color={colors.textPrimary} size={19} />
          </Pressable>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>{displayName.slice(0, 1).toUpperCase()}</Text>
          </View>
        </View>
      </View>

      {/* Greeting Title */}
      <View style={styles.greetingSection}>
        <Text style={styles.hi}>Hi {displayName}! 👋</Text>
        <Text style={styles.subGreeting}>Control your expenses here.</Text>
      </View>

      {/* Search Bar */}
      <Pressable style={styles.searchBar} onPress={() => router.push("/(tabs)/search")}>
        <Search color={colors.textMuted} size={18} />
        <Text style={styles.searchPlaceholder}>Search group or expenses</Text>
      </Pressable>

      {/* Front Page Action Cards: Voice, Scan, Manual */}
      <View style={styles.quickAddContainer}>
        <Text style={styles.quickAddLabel}>ADD EXPENSE BY</Text>
        <View style={styles.quickAddRow}>
          <Pressable
            style={styles.quickAddTile}
            onPress={() => router.push({ pathname: "/(tabs)/add-expense", params: { mode: "voice" } })}
          >
            <View style={[styles.quickAddIconCircle, { backgroundColor: "#EEF2FF" }]}>
              <Mic color={colors.primary} size={22} />
            </View>
            <Text style={styles.quickAddTileTitle}>Voice</Text>
            <Text style={styles.quickAddTileSub}>Speech AI</Text>
          </Pressable>

          <Pressable
            style={styles.quickAddTile}
            onPress={() => router.push({ pathname: "/(tabs)/add-expense", params: { mode: "receipt" } })}
          >
            <View style={[styles.quickAddIconCircle, { backgroundColor: "#F0FDF4" }]}>
              <Camera color="#166534" size={22} />
            </View>
            <Text style={styles.quickAddTileTitle}>Scan</Text>
            <Text style={styles.quickAddTileSub}>OCR Bill</Text>
          </Pressable>

          <Pressable
            style={styles.quickAddTile}
            onPress={() => router.push({ pathname: "/(tabs)/add-expense", params: { mode: "manual" } })}
          >
            <View style={[styles.quickAddIconCircle, { backgroundColor: "#FEF3C7" }]}>
              <Edit3 color="#92400E" size={22} />
            </View>
            <Text style={styles.quickAddTileTitle}>Manual</Text>
            <Text style={styles.quickAddTileSub}>Type Details</Text>
          </Pressable>
        </View>
      </View>

      {/* Recent Updates Banner */}
      {pendingSettlement ? (
        <View style={styles.updateCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.updateCardTag}>Recent Updates</Text>
            <Text style={styles.updateTitle}>{pendingSettlement.fromDisplayName} Made a Payment!</Text>
            <Text style={styles.updateSubtitle}>
              Review and settle — ₹{Number(pendingSettlement.amount || 0).toFixed(0)}
            </Text>
          </View>
          <Pressable style={styles.settleButton} onPress={() => router.push(`/(tabs)/groups/${pendingSettlement.groupId}`)}>
            <Text style={styles.settleButtonText}>Settle Now</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.updateCardDemo}>
          <View style={{ flex: 1 }}>
            <Text style={styles.updateTitle}>Group Balances Updated</Text>
            <Text style={styles.updateSubtitle}>All balances are up to date.</Text>
          </View>
          <Pressable style={styles.settleButton} onPress={() => router.push("/(tabs)/groups")}>
            <Text style={styles.settleButtonText}>View</Text>
          </Pressable>
        </View>
      )}

      {/* My Groups Section */}
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>My Groups</Text>
        <Pressable onPress={() => router.push("/(tabs)/groups")}>
          <Text style={styles.viewAll}>View All</Text>
        </Pressable>
      </View>

      {groupsQuery.data?.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No groups yet</Text>
          <Text style={styles.muted}>Create one to start splitting expenses.</Text>
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingLeft: spacing.lg, paddingRight: spacing.md, gap: spacing.md }}>
          {groupsQuery.data?.map((group, idx) => {
            const isPrimaryCard = idx === 0;
            const groupBalance = balancesQuery.data?.find((b) => b.group.id === group.id);
            const total = groupBalance?.balances?.reduce((s: number, b: any) => s + b.totalPaid, 0) ?? 0;
            return (
              <Pressable
                key={group.id}
                style={[styles.groupCard, isPrimaryCard ? styles.groupCardActive : styles.groupCardInactive]}
                onPress={() => router.push(`/(tabs)/groups/${group.id}`)}
              >
                <Text style={[styles.groupCardTitle, isPrimaryCard ? styles.textWhite : styles.textDark]} numberOfLines={1}>
                  {group.name}
                </Text>
                <Text style={[styles.groupCardSubtitle, isPrimaryCard ? styles.textWhiteMuted : styles.textGray]}>
                  Total Expenses: ₹{(total || 0).toFixed(0)}
                </Text>

                <View style={styles.groupCardFooter}>
                  <View style={styles.avatarStack}>
                    {(groupBalance?.balances ?? [{ displayName: "User" }, { displayName: "Friend" }]).slice(0, 3).map((b: any, i: number) => (
                      <View key={i} style={[styles.stackAvatar, { marginLeft: i === 0 ? 0 : -8, zIndex: 10 - i }]}>
                        <Text style={styles.stackAvatarText}>{b.displayName?.slice(0, 1).toUpperCase()}</Text>
                      </View>
                    ))}
                    <View style={[styles.stackAvatar, styles.stackAvatarMore, { marginLeft: -8 }]}>
                      <Text style={styles.stackAvatarMoreText}>+4</Text>
                    </View>
                  </View>

                  <Pressable
                    style={[styles.addExpensesBtn, isPrimaryCard ? styles.addExpensesBtnWhite : styles.addExpensesBtnBlue]}
                    onPress={() => router.push({ pathname: "/(tabs)/add-expense", params: { groupId: group.id } })}
                  >
                    <Text style={[styles.addExpensesBtnText, isPrimaryCard ? { color: colors.primary } : { color: colors.primary }]}>
                      Add Expenses
                    </Text>
                  </Pressable>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {/* Recent Expenses Section */}
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>Recent Expenses</Text>
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
                <Icon color={colors.textPrimary} size={18} strokeWidth={2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.expenseItemTitle}>{e.title}</Text>
                <Text style={styles.expenseItemMeta}>
                  {new Date(e.expenseDate).toLocaleDateString(undefined, { day: "numeric", month: "short" })} · Paid by {e.paidByDisplayName || "Member"}
                </Text>
              </View>
              <Text style={styles.expenseItemAmount}>-₹{Number(e.amount).toFixed(2)}</Text>
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
  brandTitle: {
    fontFamily: fonts.extrabold,
    fontSize: 22,
    color: colors.primary,
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
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: "#F1F5F9",
    borderRadius: radius.pill,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
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
    shadowColor: colors.textPrimary,
    shadowOpacity: 0.03,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
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
    backgroundColor: "#F8FAFC",
    borderRadius: 16,
    paddingVertical: spacing.md - 2,
    paddingHorizontal: spacing.xs,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E2E8F0",
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
    backgroundColor: colors.primaryMuted,
    borderRadius: 20,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    padding: spacing.md,
  },
  updateCardDemo: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.primaryMuted,
    borderRadius: 20,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    padding: spacing.md,
  },
  updateCardTag: { color: colors.primary, fontFamily: fonts.bold, fontSize: 11, textTransform: "uppercase", marginBottom: 2 },
  updateTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 15 },
  updateSubtitle: { color: colors.textSecondary, fontFamily: fonts.medium, fontSize: 13, marginTop: 2 },
  settleButton: { backgroundColor: colors.warning, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 10 },
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
  },
  emptyTitle: { color: colors.textPrimary, fontFamily: fonts.bold },
  groupCard: {
    width: 210,
    borderRadius: 22,
    padding: spacing.md,
    justifyContent: "space-between",
    minHeight: 140,
    shadowColor: colors.textPrimary,
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  groupCardActive: { backgroundColor: colors.primary },
  groupCardInactive: { backgroundColor: "#F1F5F9", borderWidth: 1, borderColor: colors.border },
  groupCardTitle: { fontFamily: fonts.bold, fontSize: 16 },
  groupCardSubtitle: { fontFamily: fonts.medium, fontSize: 12, marginTop: 4 },
  textWhite: { color: colors.onDark },
  textWhiteMuted: { color: "#FFFFFFCC" },
  textDark: { color: colors.textPrimary },
  textGray: { color: colors.textSecondary },
  groupCardFooter: { gap: spacing.sm, marginTop: spacing.md },
  avatarStack: { flexDirection: "row", alignItems: "center" },
  stackAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primaryMuted,
    borderWidth: 2,
    borderColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  stackAvatarText: { color: colors.primary, fontSize: 11, fontFamily: fonts.bold },
  stackAvatarMore: { backgroundColor: colors.textMuted },
  stackAvatarMoreText: { color: colors.onDark, fontSize: 10, fontFamily: fonts.bold },
  addExpensesBtn: { borderRadius: radius.pill, paddingVertical: 10, alignItems: "center" },
  addExpensesBtnWhite: { backgroundColor: colors.card },
  addExpensesBtnBlue: { backgroundColor: colors.primaryMuted },
  addExpensesBtnText: { fontFamily: fonts.bold, fontSize: 13 },
  expenseListCard: {
    marginHorizontal: spacing.lg,
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  expenseItem: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm + 2 },
  expenseItemBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  expenseIconBadge: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },
  expenseItemTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 15 },
  expenseItemMeta: { color: colors.textSecondary, fontFamily: fonts.medium, fontSize: 12, marginTop: 2 },
  expenseItemAmount: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 15 },
});
