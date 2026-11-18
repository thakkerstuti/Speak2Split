import { useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Search, Bell, Mic, Camera, Edit3, ChevronRight, Users, HandCoins, Receipt } from "lucide-react-native";
import { groupsApi, settlementsApi, expensesApi, notificationsApi } from "../../lib/api";
import { useAuthStore } from "../../store/auth-store";
import { colors, spacing, radius, fonts, shadows } from "../../lib/theme";
import { formatINR, formatShortDate, firstName } from "../../lib/format";
import { AvatarStack, Card, CategoryIcon, EmptyState, IconButton, SectionHeader, Skeleton } from "../../components/ui";

export default function DashboardScreen() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);

  const groupsQuery = useQuery({ queryKey: ["groups"], queryFn: groupsApi.list });
  const groupsKey = groupsQuery.data ? groupsQuery.data.map((g) => g.id).join(",") : "";

  const balancesQuery = useQuery({
    queryKey: ["all-balances", groupsKey],
    queryFn: async () => {
      if (!groupsQuery.data) return [];
      return Promise.all(
        groupsQuery.data.map((g) =>
          settlementsApi
            .balances(g.id)
            .then((b) => ({ group: g, ...b }))
            .catch(() => ({ group: g, balances: [], suggestedSettlements: [] }))
        )
      );
    },
    enabled: !!groupsQuery.data,
  });

  const recentExpensesQuery = useQuery({
    queryKey: ["all-recent-expenses", groupsKey],
    queryFn: async () => {
      if (!groupsQuery.data) return [];
      const all = await Promise.all(
        groupsQuery.data.map((g) =>
          expensesApi
            .listForGroup(g.id)
            .then((list: any[]) => list.map((e) => ({ ...e, groupName: g.name, groupId: g.id })))
            .catch(() => [])
        )
      );
      return all
        .flat()
        .sort((a, b) => new Date(b.expenseDate).getTime() - new Date(a.expenseDate).getTime())
        .slice(0, 6);
    },
    enabled: !!groupsQuery.data,
  });

  const notificationsQuery = useQuery({ queryKey: ["notifications"], queryFn: notificationsApi.list });
  const unread = notificationsQuery.data?.filter((n) => !n.readAt).length ?? 0;

  const summary = useMemo(() => {
    let youOwe = 0;
    let youAreOwed = 0;
    for (const g of balancesQuery.data ?? []) {
      for (const s of g.suggestedSettlements ?? []) {
        if (s.fromUserId === user?.id) youOwe += Number(s.amount || 0);
        if (s.toUserId === user?.id) youAreOwed += Number(s.amount || 0);
      }
    }
    return { youOwe, youAreOwed, net: youAreOwed - youOwe };
  }, [balancesQuery.data, user?.id]);

  const owedToMe = useMemo(() => {
    for (const g of balancesQuery.data ?? []) {
      const s = g.suggestedSettlements?.find((x) => x.toUserId === user?.id);
      if (s) return { ...s, groupName: g.group.name, groupId: g.group.id };
    }
    return null;
  }, [balancesQuery.data, user?.id]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([groupsQuery.refetch(), balancesQuery.refetch(), recentExpensesQuery.refetch(), notificationsQuery.refetch()]);
    setRefreshing(false);
  };

  const speak = () =>
    router.push({ pathname: "/(tabs)/add-expense", params: { mode: "voice", autostart: String(Date.now()), groupId: "" } });
  const loadingBalances = groupsQuery.isLoading || (balancesQuery.isLoading && !!groupsQuery.data?.length);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingTop: insets.top + spacing.sm, paddingBottom: 120 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.greeting}>{greeting},</Text>
          <Text style={styles.name} numberOfLines={1}>{firstName(user?.displayName)} 👋</Text>
        </View>
        <IconButton icon={Search} label="Search" onPress={() => router.push("/(tabs)/search")} />
        <View style={{ width: spacing.sm }} />
        <IconButton icon={Bell} label="Notifications" badge={unread} onPress={() => router.push("/(tabs)/notifications")} />
      </View>

      {/* Balance */}
      <View style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>YOUR NET BALANCE</Text>
        {loadingBalances ? (
          <Skeleton width={160} height={38} style={{ marginVertical: 10, backgroundColor: "#312E81" }} />
        ) : (
          <Text style={styles.balanceAmount}>{formatINR(summary.net, { sign: true })}</Text>
        )}
        <Text style={styles.balanceCaption}>
          {summary.net > 0 ? "Overall, friends owe you" : summary.net < 0 ? "Overall, you owe friends" : "You're all settled up"}
        </Text>
        <View style={styles.balanceSplit}>
          <View style={{ flex: 1 }}>
            <Text style={styles.splitLabel}>YOU OWE</Text>
            <Text style={[styles.splitValue, { color: "#FCA5A5" }]}>{formatINR(summary.youOwe)}</Text>
          </View>
          <View style={styles.splitDivider} />
          <View style={{ flex: 1, alignItems: "flex-end" }}>
            <Text style={styles.splitLabel}>YOU'RE OWED</Text>
            <Text style={[styles.splitValue, { color: "#6EE7B7" }]}>{formatINR(summary.youAreOwed)}</Text>
          </View>
        </View>
      </View>

      {/* Voice-first quick add */}
      <View style={styles.pad}>
        <Pressable onPress={speak} style={({ pressed }) => [styles.speakCard, pressed && { transform: [{ scale: 0.99 }] }]}>
          <View style={styles.speakMic}>
            <Mic color={colors.onDark} size={26} strokeWidth={2.4} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.speakTitle}>Just say it</Text>
            <Text style={styles.speakSub}>“Dinner 1200 with Rahul and Aisha”</Text>
          </View>
          <ChevronRight color={colors.primary} size={20} />
        </Pressable>
        <View style={styles.quickRow}>
          <QuickAction icon={Camera} label="Scan bill" onPress={() => router.push({ pathname: "/(tabs)/add-expense", params: { mode: "receipt", groupId: "" } })} />
          <QuickAction icon={Edit3} label="Type it" onPress={() => router.push({ pathname: "/(tabs)/add-expense", params: { mode: "manual", groupId: "" } })} />
        </View>
      </View>

      {/* Someone owes you */}
      {owedToMe ? (
        <View style={styles.pad}>
          <Card onPress={() => router.push(`/(tabs)/groups/${owedToMe.groupId}`)} style={styles.owedCard}>
            <View style={styles.owedIcon}>
              <HandCoins color={colors.positiveDark} size={20} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.owedTitle}>
                {firstName(owedToMe.fromDisplayName)} owes you {formatINR(owedToMe.amount)}
              </Text>
              <Text style={styles.owedSub}>in {owedToMe.groupName}</Text>
            </View>
            <ChevronRight color={colors.textMuted} size={18} />
          </Card>
        </View>
      ) : null}

      {/* Groups */}
      <View style={styles.pad}>
        <SectionHeader title="Your groups" actionLabel="See all" onAction={() => router.push("/(tabs)/groups")} />
      </View>
      {groupsQuery.isLoading ? (
        <View style={[styles.pad, { flexDirection: "row", gap: spacing.md }]}>
          <Skeleton width={200} height={120} radius={20} />
          <Skeleton width={200} height={120} radius={20} />
        </View>
      ) : groupsQuery.data?.length === 0 ? (
        <View style={styles.pad}>
          <Card>
            <EmptyState
              icon={Users}
              title="Start your first group"
              body="Flatmates, a trip, family — split everything in one place."
              actionLabel="Create group"
              onAction={() => router.push("/(tabs)/groups")}
            />
          </Card>
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
          {groupsQuery.data?.map((group) => {
            const gb = balancesQuery.data?.find((b) => b.group.id === group.id);
            const mine = gb?.balances?.find((b) => b.userId === user?.id)?.netBalance ?? 0;
            const names = gb?.balances?.map((b) => b.displayName) ?? [];
            return (
              <Pressable
                key={group.id}
                style={({ pressed }) => [styles.groupCard, pressed && { opacity: 0.9 }]}
                onPress={() => router.push(`/(tabs)/groups/${group.id}`)}
              >
                <Text style={styles.groupName} numberOfLines={1}>{group.name}</Text>
                <Text
                  style={[
                    styles.groupBalance,
                    { color: mine > 0.009 ? colors.positiveDark : mine < -0.009 ? colors.negativeDark : colors.textSecondary },
                  ]}
                >
                  {mine > 0.009 ? `You're owed ${formatINR(mine)}` : mine < -0.009 ? `You owe ${formatINR(-mine)}` : "Settled up"}
                </Text>
                <View style={styles.groupFooter}>
                  {names.length ? <AvatarStack names={names} size={26} /> : <View />}
                  <Pressable
                    hitSlop={8}
                    style={styles.groupAdd}
                    onPress={() =>
                      router.push({ pathname: "/(tabs)/add-expense", params: { mode: "voice", groupId: group.id, autostart: String(Date.now()) } })
                    }
                    accessibilityLabel={`Add expense to ${group.name}`}
                  >
                    <Mic color={colors.primary} size={14} strokeWidth={2.6} />
                    <Text style={styles.groupAddText}>Add</Text>
                  </Pressable>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {/* Recent activity */}
      <View style={styles.pad}>
        <SectionHeader title="Recent activity" />
        <Card padded={false} style={{ paddingHorizontal: spacing.md }}>
          {recentExpensesQuery.isLoading || groupsQuery.isLoading ? (
            <View style={{ paddingVertical: spacing.md, gap: spacing.md }}>
              <Skeleton height={42} />
              <Skeleton height={42} />
              <Skeleton height={42} />
            </View>
          ) : !recentExpensesQuery.data?.length ? (
            <EmptyState icon={Receipt} title="No expenses yet" body="Tap the mic and say what you spent — that's it." />
          ) : (
            recentExpensesQuery.data.map((e: any, i: number) => (
              <Pressable
                key={e.id}
                onPress={() => router.push(`/(tabs)/groups/${e.groupId}`)}
                style={[styles.expenseRow, i < recentExpensesQuery.data!.length - 1 && styles.expenseDivider]}
              >
                <CategoryIcon category={e.category} size={42} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.expenseTitle} numberOfLines={1}>{e.title}</Text>
                  <Text style={styles.expenseMeta} numberOfLines={1}>
                    {e.groupName} · {formatShortDate(e.expenseDate)}
                    {e.source === "VOICE" ? " · 🎙️" : ""}
                  </Text>
                </View>
                <Text style={styles.expenseAmount}>{formatINR(e.amount)}</Text>
              </Pressable>
            ))
          )}
        </Card>
      </View>
    </ScrollView>
  );
}

function QuickAction({ icon: Icon, label, onPress }: { icon: any; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.quickAction, pressed && { opacity: 0.8 }]}>
      <Icon color={colors.textSecondary} size={18} />
      <Text style={styles.quickActionText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  pad: { paddingHorizontal: spacing.lg },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, marginBottom: spacing.md },
  greeting: { fontFamily: fonts.medium, fontSize: 14, color: colors.textSecondary },
  name: { fontFamily: fonts.extrabold, fontSize: 26, color: colors.textPrimary, letterSpacing: -0.6 },

  balanceCard: {
    marginHorizontal: spacing.lg,
    backgroundColor: colors.primaryDeep,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.lg,
  },
  balanceLabel: { fontFamily: fonts.bold, fontSize: 11, color: "#A5B4FC", letterSpacing: 1 },
  balanceAmount: { fontFamily: fonts.extrabold, fontSize: 38, color: colors.onDark, marginTop: 8, letterSpacing: -1.2 },
  balanceCaption: { fontFamily: fonts.medium, fontSize: 13, color: "#C7D2FE", marginTop: 2 },
  balanceSplit: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.md,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
  },
  splitLabel: { fontFamily: fonts.bold, fontSize: 10, color: "#A5B4FC", letterSpacing: 0.8 },
  splitValue: { fontFamily: fonts.bold, fontSize: 17, marginTop: 2 },
  splitDivider: { width: 1, height: 30, backgroundColor: "rgba(255,255,255,0.15)", marginHorizontal: spacing.md },

  speakCard: {
    marginTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.primaryMuted,
  },
  speakMic: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.primary,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  speakTitle: { fontFamily: fonts.bold, fontSize: 17, color: colors.primaryDeep },
  speakSub: { fontFamily: fonts.medium, fontSize: 13, color: colors.primary, marginTop: 2 },
  quickRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  quickAction: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 12,
  },
  quickActionText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.textPrimary },

  owedCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.md },
  owedIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.positiveSoft, alignItems: "center", justifyContent: "center" },
  owedTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.textPrimary },
  owedSub: { fontFamily: fonts.medium, fontSize: 12, color: colors.textSecondary, marginTop: 2 },

  groupCard: {
    width: 210,
    minHeight: 128,
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: "space-between",
    ...shadows.sm,
  },
  groupName: { fontFamily: fonts.bold, fontSize: 16, color: colors.textPrimary },
  groupBalance: { fontFamily: fonts.semibold, fontSize: 13, marginTop: 4 },
  groupFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.md },
  groupAdd: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.primaryLight, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 7 },
  groupAddText: { fontFamily: fonts.bold, fontSize: 12, color: colors.primary },

  expenseRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: 12 },
  expenseDivider: { borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  expenseTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.textPrimary },
  expenseMeta: { fontFamily: fonts.medium, fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  expenseAmount: { fontFamily: fonts.bold, fontSize: 15, color: colors.textPrimary },
});
