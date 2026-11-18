import { useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, TextInput, RefreshControl } from "react-native";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Plus, Users, ChevronRight } from "lucide-react-native";
import { groupsApi, settlementsApi } from "../../../lib/api";
import { useAuthStore } from "../../../store/auth-store";
import { colors, spacing, radius, fonts } from "../../../lib/theme";
import { formatINR } from "../../../lib/format";
import { AvatarStack, Button, Card, Chip, EmptyState, ScreenHeader, Sheet, Skeleton } from "../../../components/ui";

const GROUP_TYPES = [
  { id: "FLAT", label: "Flat", emoji: "🏠", bg: "#E0E7FF" },
  { id: "TRIP", label: "Trip", emoji: "🏖️", bg: "#E0F2FE" },
  { id: "FRIENDS", label: "Friends", emoji: "🍻", bg: "#DCFCE7" },
  { id: "FAMILY", label: "Family", emoji: "👨‍👩‍👧", bg: "#FCE7F3" },
  { id: "EVENT", label: "Event", emoji: "🎉", bg: "#FEF3C7" },
  { id: "CUSTOM", label: "Other", emoji: "👥", bg: "#F1F5F9" },
] as const;

const typeMeta = (type?: string) => GROUP_TYPES.find((t) => t.id === type?.toUpperCase()) ?? GROUP_TYPES[GROUP_TYPES.length - 1];

export default function GroupsListScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const [refreshing, setRefreshing] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<string>("FLAT");

  const groupsQuery = useQuery({ queryKey: ["groups"], queryFn: groupsApi.list });
  const groupsKey = groupsQuery.data ? groupsQuery.data.map((g) => g.id).join(",") : "";
  const metaQuery = useQuery({
    queryKey: ["groups-balances-list", groupsKey],
    queryFn: async () => {
      const out: Record<string, { names: string[]; net: number }> = {};
      await Promise.all(
        (groupsQuery.data ?? []).map(async (g) => {
          const bal = await settlementsApi.balances(g.id).catch(() => null);
          out[g.id] = {
            names: bal?.balances.map((b) => b.displayName) ?? [],
            net: Number(bal?.balances.find((b) => b.userId === me?.id)?.netBalance ?? 0),
          };
        })
      );
      return out;
    },
    enabled: !!groupsQuery.data && !!me,
  });

  const createMutation = useMutation({
    mutationFn: () => groupsApi.create({ name: name.trim(), type }),
    onSuccess: (group) => {
      queryClient.invalidateQueries({ queryKey: ["groups"] });
      setCreateOpen(false);
      setName("");
      router.push(`/(tabs)/groups/${group.id}`);
    },
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([groupsQuery.refetch(), metaQuery.refetch()]);
    setRefreshing(false);
  };

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Groups"
        right={<Button label="New" icon={Plus} size="md" full={false} onPress={() => setCreateOpen(true)} variant="dark" />}
      />

      <FlatList
        contentContainerStyle={styles.list}
        data={groupsQuery.data ?? []}
        keyExtractor={(g) => g.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm + 4 }} />}
        renderItem={({ item }) => {
          const t = typeMeta(item.type);
          const meta = metaQuery.data?.[item.id];
          const net = meta?.net ?? 0;
          return (
            <Card onPress={() => router.push(`/(tabs)/groups/${item.id}`)} style={styles.row}>
              <View style={[styles.typeIcon, { backgroundColor: t.bg }]}>
                <Text style={{ fontSize: 22 }}>{t.emoji}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                {meta ? (
                  <Text style={[styles.status, { color: net > 0.009 ? colors.positiveDark : net < -0.009 ? colors.negativeDark : colors.textSecondary }]}>
                    {net > 0.009 ? `You're owed ${formatINR(net)}` : net < -0.009 ? `You owe ${formatINR(-net)}` : "Settled up"}
                  </Text>
                ) : (
                  <Skeleton width={110} height={12} style={{ marginTop: 6 }} />
                )}
              </View>
              {meta?.names.length ? <AvatarStack names={meta.names} max={3} size={26} /> : null}
              <ChevronRight color={colors.textMuted} size={18} />
            </Card>
          );
        }}
        ListEmptyComponent={
          groupsQuery.isLoading ? (
            <View style={{ gap: spacing.sm + 4 }}>
              <Skeleton height={76} radius={radius.lg} />
              <Skeleton height={76} radius={radius.lg} />
              <Skeleton height={76} radius={radius.lg} />
            </View>
          ) : (
            <Card>
              <EmptyState
                icon={Users}
                title="No groups yet"
                body="Create one for your flat, a trip or family — then just speak your expenses."
                actionLabel="Create group"
                onAction={() => setCreateOpen(true)}
              />
            </Card>
          )
        }
      />

      <Sheet visible={createOpen} onClose={() => setCreateOpen(false)} title="New group">
        <TextInput
          style={styles.input}
          placeholder="Name (e.g. Flatmates, Goa Trip)"
          placeholderTextColor={colors.textMuted}
          value={name}
          onChangeText={setName}
          autoFocus
        />
        <View style={styles.typeRow}>
          {GROUP_TYPES.map((t) => (
            <Chip key={t.id} label={`${t.emoji}  ${t.label}`} selected={type === t.id} onPress={() => setType(t.id)} />
          ))}
        </View>
        <Text style={styles.hint}>Tip: say the group's name when you speak an expense and it'll go straight here.</Text>
        <Button
          label="Create group"
          onPress={() => createMutation.mutate()}
          loading={createMutation.isPending}
          disabled={!name.trim()}
          style={{ marginTop: spacing.lg }}
        />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  list: { paddingHorizontal: spacing.lg, paddingBottom: 120 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  typeIcon: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  name: { fontFamily: fonts.bold, fontSize: 16, color: colors.textPrimary },
  status: { fontFamily: fonts.semibold, fontSize: 13, marginTop: 3 },
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
  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
  hint: { fontFamily: fonts.regular, fontSize: 12, color: colors.textSecondary, marginTop: spacing.md, lineHeight: 18 },
});
