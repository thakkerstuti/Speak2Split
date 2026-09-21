import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, TextInput } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Search, Bell, ShoppingCart, Wifi, Receipt } from "lucide-react-native";
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

  const balancesQuery = useQuery({
    queryKey: ["all-balances", groupsQuery.data?.map((g) => g.id)],
    queryFn: async () => {
      if (!groupsQuery.data) return [];
      return Promise.all(groupsQuery.data.map((g) => settlementsApi.balances(g.id).then((b) => ({ group: g, ...b }))));
    },
    enabled: !!groupsQuery.data,
  });

  const recentExpensesQuery = useQuery({
    queryKey: ["all-recent-expenses", groupsQuery.data?.map((g) => g.id)],
    queryFn: async () => {
      if (!groupsQuery.data) return [];
      const all = await Promise.all(
        groupsQuery.data.map((g) => expensesApi.listForGroup(g.id).then((list: any[]) => list.map((e) => ({ ...e, groupName: g.name }))))
      );
      return all
        .flat()
        .sort((a, b) => new Date(b.expenseDate).getTime() - new Date(a.expenseDate).getTime())
        .slice(0, 4);
    },
    enabled: !!groupsQuery.data,
  });

  const pendingSettlement = useMemo(() => {
    if (!balancesQuery.data || !user) return null;
    for (const g of balancesQuery.data) {
      const owedToMe = g.suggestedSettlements.find((s: any) => s.toUserId === user.id);
      if (owedToMe) return { ...owedToMe, groupName: g.group.name, groupId: g.group.id };
    }
    return null;
  }, [balancesQuery.data, user]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([groupsQuery.refetch(), balancesQuery.refetch(), recentExpensesQuery.refetch()]);
    setRefreshing(false);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: spacing.xxl }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.hi}>Hi {user?.displayName?.split(" ")[0] ?? ""} 👋</Text>
          <Text style={styles.subGreeting}>Control your expenses here.</Text>
        </View>
        <View style={styles.headerIcons}>
          <Pressable style={styles.iconCircle} onPress={() => router.push("/(tabs)/notifications")}>
            <Bell color={colors.textPrimary} size={19} />
          </Pressable>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>{user?.displayName?.slice(0, 1).toUpperCase()}</Text>
          </View>
        </View>
      </View>

      <Pressable style={styles.searchBar} onPress={() => router.push("/(tabs)/search")}>
        <Search color={colors.textMuted} size={18} />
        <Text style={styles.searchPlaceholder}>Search group or expenses</Text>
      </Pressable>

      {pendingSettlement && (
        <View style={styles.updateCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.updateTitle}>{pendingSettlement.fromDisplayName} owes you</Text>
            <Text style={styles.updateSubtitle}>
              Review and settle — ₹{pendingSettlement.amount.toFixed(0)} in {pendingSettlement.groupName}
            </Text>
          </View>
          <Pressable style={styles.settleButton} onPress={() => router.push(`/(tabs)/groups/${pendingSettlement.groupId}`)}>
            <Text style={styles.settleButtonText}>Settle Now</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>My Groups</Text>
        <Pressable onPress={() => router.push("/(tabs)/groups")}>
          <Text style={styles.viewAll}>View All</Text>
        </Pressable>
      </View>

      {groupsQuery.data?.length === 0 && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No groups yet</Text>
          <Text style={styles.muted}>Create one to start splitting expenses.</Text>
        </View>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingLeft: spacing.lg, gap: spacing.md }}>
        {groupsQuery.data?.map((group, idx) => {
          const groupBalance = balancesQuery.data?.find((b) => b.group.id === group.id);
          const total = groupBalance?.balances.reduce((s: number, b: any) => s + b.totalPaid, 0) ?? 0;
          return (
            <Pressable key={group.id} style={styles.groupCard} onPress={() => router.push(`/(tabs)/groups/${group.id}`)}>
              <View style={[styles.groupCardHeader, { backgroundColor: idx % 2 === 0 ? colors.primary : colors.textPrimary }]}>
                <Text style={styles.groupCardTitle} numberOfLines={1}>{group.name}</Text>
                <Text style={styles.groupCardSubtitle}>Total Expenses: ₹{total.toFixed(0)}</Text>
              </View>
              <View style={styles.groupCardBody}>
                <View style={styles.avatarStack}>
                  {(groupBalance?.balances ?? []).slice(0, 3).map((b: any, i: number) => (
                    <View key={b.userId} style={[styles.stackAvatar, { marginLeft: i === 0 ? 0 : -10, zIndex: 10 - i }]}>
                      <Text style={styles.stackAvatarText}>{b.displayName?.slice(0, 1).toUpperCase()}</Text>
                    </View>
                  ))}
                  {(groupBalance?.balances?.length ?? 0) > 3 && (
                    <View style={[styles.stackAvatar, styles.stackAvatarMore, { marginLeft: -10 }]}>
                      <Text style={styles.stackAvatarMoreText}>+{(groupBalance!.balances.length - 3)}</Text>
                    </View>
                  )}
                </View>
                <Pressable
                  style={styles.addExpenseButton}
                  onPress={() => router.push({ pathname: "/(tabs)/add-expense", params: { groupId: group.id } })}
                >
                  <Text style={styles.addExpenseButtonText}>Add Expenses</Text>
                </Pressable>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>Recent Expenses</Text>
        <Pressable onPress={() => router.push("/(tabs)/search")}>
          <Text style={styles.viewAll}>View All</Text>
        </Pressable>
      </View>

      <View style={{ paddingHorizontal: spacing.lg }}>
        {recentExpensesQuery.data?.length === 0 && <Text style={styles.muted}>No expenses yet.</Text>}
        {recentExpensesQuery.data?.map((e: any) => {
          const Icon = CATEGORY_ICON[e.category] ?? Receipt;
          return (
            <View key={e.id} style={styles.expenseRow}>
              <View style={styles.expenseIconWrap}>
                <Icon color={colors.textSecondary} size={18} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.expenseTitle}>{e.title}</Text>
                <Text style={styles.muted}>
                  {new Date(e.expenseDate).toLocaleDateString(undefined, { day: "numeric", month: "short" })} · {e.groupName}
                </Text>
              </View>
              <Text style={styles.expenseAmount}>-₹{Number(e.amount).toFixed(0)}</Text>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingHorizontal: spacing.lg, paddingTop: spacing.xxl },
  hi: { ...typography.title, fontSize: 22, color: colors.textPrimary },
  subGreeting: { ...typography.body, fontSize: 14, color: colors.textSecondary, marginTop: 2 },
  headerIcons: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  iconCircle: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.bgElevated, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  avatarCircle: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.primaryMuted, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 16 },
  searchBar: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.bgElevated, borderRadius: radius.md, marginHorizontal: spacing.lg, marginTop: spacing.lg, paddingHorizontal: spacing.md, paddingVertical: 13, borderWidth: 1, borderColor: colors.border },
  searchPlaceholder: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 15 },
  updateCard: { flexDirection: "row", alignItems: "center", backgroundColor: colors.primaryMuted, borderRadius: radius.lg, marginHorizontal: spacing.lg, marginTop: spacing.lg, padding: spacing.md },
  updateTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 15 },
  updateSubtitle: { color: colors.textSecondary, fontFamily: fonts.medium, fontSize: 12, marginTop: 2 },
  settleButton: { backgroundColor: colors.warning, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  settleButtonText: { color: colors.onDark, fontFamily: fonts.bold, fontSize: 12 },
  sectionHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: spacing.lg, marginTop: spacing.xl, marginBottom: spacing.md },
  sectionTitle: { ...typography.title, fontSize: 17, color: colors.textPrimary },
  viewAll: { color: colors.primary, fontFamily: fonts.semibold, fontSize: 13 },
  muted: { color: colors.textMuted, fontSize: 13, fontFamily: fonts.regular },
  emptyState: { marginHorizontal: spacing.lg, padding: spacing.lg, backgroundColor: colors.bgElevated, borderRadius: radius.md, alignItems: "center", gap: spacing.xs },
  emptyTitle: { color: colors.textPrimary, fontFamily: fonts.bold },
  groupCard: { width: 180, borderRadius: radius.lg, backgroundColor: colors.bgElevated, overflow: "hidden", marginRight: spacing.xs, shadowColor: "#0F172A", shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  groupCardHeader: { padding: spacing.md, height: 74, justifyContent: "center" },
  groupCardTitle: { color: colors.onDark, fontFamily: fonts.bold, fontSize: 14 },
  groupCardSubtitle: { color: "#FFFFFFCC", fontFamily: fonts.medium, fontSize: 11, marginTop: 4 },
  groupCardBody: { padding: spacing.sm, gap: spacing.sm },
  avatarStack: { flexDirection: "row", alignItems: "center" },
  stackAvatar: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.primaryMuted, borderWidth: 2, borderColor: colors.bgElevated, alignItems: "center", justifyContent: "center" },
  stackAvatarText: { color: colors.primary, fontSize: 10, fontFamily: fonts.bold },
  stackAvatarMore: { backgroundColor: colors.textMuted },
  stackAvatarMoreText: { color: colors.onDark, fontSize: 9, fontFamily: fonts.bold },
  addExpenseButton: { backgroundColor: colors.primaryMuted, borderRadius: radius.pill, paddingVertical: 8, alignItems: "center" },
  addExpenseButtonText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 12 },
  expenseRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  expenseIconWrap: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.bgElevated, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  expenseTitle: { color: colors.textPrimary, fontFamily: fonts.semibold, fontSize: 15 },
  expenseAmount: { color: colors.negative, fontFamily: fonts.bold, fontSize: 14 },
});
