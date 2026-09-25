import { useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, Modal, TextInput, RefreshControl } from "react-native";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Plus } from "lucide-react-native";
import { groupsApi, settlementsApi } from "../../../lib/api";
import { useAuthStore } from "../../../store/auth-store";
import { colors, spacing, radius, typography, fonts } from "../../../lib/theme";

const CATEGORY_ITEMS = [
  { id: "FLAT", label: "Flat", emoji: "🏠", bgColor: "#E0E7FF" },
  { id: "TRIP", label: "Trip", emoji: "🏖️", bgColor: "#E0F2FE" },
  { id: "EVENT", label: "Event", emoji: "🎉", bgColor: "#FEF3C7" },
  { id: "FAMILY", label: "Family", emoji: "👨‍👩‍👧", bgColor: "#FCE7F3" },
  { id: "OTHER", label: "Other", emoji: "👥", bgColor: "#F1F5F9" },
] as const;

export default function GroupsListScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [name, setName] = useState("");
  const [selectedType, setSelectedType] = useState<string>("FLAT");

  const groupsQuery = useQuery({ queryKey: ["groups"], queryFn: groupsApi.list });

  // Fetch balances & details for each group to display exact member count and net balance
  const balancesQuery = useQuery({
    queryKey: ["groups-balances-list", groupsQuery.data?.map((g) => g.id)],
    queryFn: async () => {
      if (!groupsQuery.data) return {};
      const results: Record<string, { memberCount: number; netBalance: number }> = {};
      await Promise.all(
        groupsQuery.data.map(async (g) => {
          try {
            const [detail, bal] = await Promise.all([
              groupsApi.detail(g.id).catch(() => null),
              settlementsApi.balances(g.id).catch(() => null),
            ]);
            const myBal = bal?.balances?.find((b) => b.userId === currentUser?.id);
            results[g.id] = {
              memberCount: detail?.members?.length ?? 1,
              netBalance: myBal?.netBalance ?? 0,
            };
          } catch {
            results[g.id] = { memberCount: 1, netBalance: 0 };
          }
        })
      );
      return results;
    },
    enabled: !!groupsQuery.data && !!currentUser,
  });

  const createMutation = useMutation({
    mutationFn: () => groupsApi.create({ name, type: selectedType }),
    onSuccess: (group) => {
      queryClient.invalidateQueries({ queryKey: ["groups"] });
      queryClient.invalidateQueries({ queryKey: ["groups-balances-list"] });
      setModalVisible(false);
      setName("");
      router.push(`/(tabs)/groups/${group.id}`);
    },
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([groupsQuery.refetch(), balancesQuery.refetch()]);
    setRefreshing(false);
  };

  const getCategoryMeta = (type?: string) => {
    const found = CATEGORY_ITEMS.find((c) => c.id === type?.toUpperCase() || c.label.toUpperCase() === type?.toUpperCase());
    return found || { id: "OTHER", label: "Other", emoji: "👥", bgColor: "#F1F5F9" };
  };

  return (
    <View style={styles.container}>
      {/* Header Row */}
      <View style={styles.header}>
        <Text style={styles.title}>Groups</Text>
        <Pressable style={styles.newGroupBtn} onPress={() => setModalVisible(true)}>
          <Plus color={colors.onDark} size={18} strokeWidth={2.5} />
          <Text style={styles.newGroupBtnText}>New Group</Text>
        </Pressable>
      </View>

      {/* Groups List */}
      <FlatList
        contentContainerStyle={styles.listContent}
        data={groupsQuery.data ?? []}
        keyExtractor={(g) => g.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        renderItem={({ item }) => {
          const catMeta = getCategoryMeta(item.type);
          const groupMeta = balancesQuery.data?.[item.id] || { memberCount: 1, netBalance: 0 };
          const net = groupMeta.netBalance;

          return (
            <Pressable style={styles.groupCard} onPress={() => router.push(`/(tabs)/groups/${item.id}`)}>
              {/* Category Icon Badge */}
              <View style={[styles.categoryIconBox, { backgroundColor: catMeta.bgColor }]}>
                <Text style={styles.categoryEmoji}>{catMeta.emoji}</Text>
              </View>

              {/* Group Name & Member count */}
              <View style={{ flex: 1 }}>
                <Text style={styles.groupName} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.groupSubtitle}>
                  {groupMeta.memberCount} {groupMeta.memberCount === 1 ? "member" : "members"}
                </Text>
              </View>

              {/* Net Balance Status */}
              <View style={styles.balanceContainer}>
                <Text
                  style={[
                    styles.balanceText,
                    net > 0 && styles.balancePositive,
                    net < 0 && styles.balanceNegative,
                    net === 0 && styles.balanceNeutral,
                  ]}
                >
                  {net < 0 ? `-₹${Math.abs(net).toLocaleString("en-IN")}` : `₹${net.toLocaleString("en-IN")}`}
                </Text>
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No groups created yet</Text>
            <Text style={styles.muted}>Tap + New Group to start splitting expenses.</Text>
          </View>
        }
      />

      {/* Create New Group Modal Sheet */}
      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <Pressable style={styles.dismissArea} onPress={() => setModalVisible(false)} />
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>New group</Text>

            {/* Input field */}
            <TextInput
              style={styles.input}
              placeholder="Group name (e.g. Flatmates, Goa Trip)"
              placeholderTextColor="#94A3B8"
              value={name}
              onChangeText={setName}
              autoFocus
            />

            {/* Category selection pills */}
            <View style={styles.categoryPillRow}>
              {CATEGORY_ITEMS.map((cat) => {
                const isActive = selectedType === cat.id;
                return (
                  <Pressable
                    key={cat.id}
                    style={[styles.catPill, isActive && styles.catPillActive]}
                    onPress={() => setSelectedType(cat.id)}
                  >
                    <Text style={styles.catEmoji}>{cat.emoji}</Text>
                    <Text style={[styles.catLabel, isActive && styles.catLabelActive]}>{cat.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Submit Button */}
            <Pressable
              style={[styles.createBtn, (!name.trim() || createMutation.isPending) && styles.createBtnDisabled]}
              disabled={!name.trim() || createMutation.isPending}
              onPress={() => createMutation.mutate()}
            >
              <Text style={styles.createBtnText}>{createMutation.isPending ? "Creating group…" : "Create group"}</Text>
            </Pressable>

            {/* Cancel Button */}
            <Pressable style={styles.cancelBtn} onPress={() => setModalVisible(false)}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl + 8,
    paddingBottom: spacing.md,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 28,
    color: colors.textPrimary,
    letterSpacing: -0.5,
  },
  newGroupBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.darkBtnBg,
    borderRadius: radius.pill,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  newGroupBtnText: {
    color: colors.onDark,
    fontFamily: fonts.bold,
    fontSize: 14,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl + 40,
  },
  groupCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.card,
    borderRadius: 22,
    padding: spacing.md + 2,
    marginBottom: spacing.md,
    shadowColor: "#0F172A",
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  categoryIconBox: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  categoryEmoji: {
    fontSize: 22,
  },
  groupName: {
    color: colors.textPrimary,
    fontFamily: fonts.bold,
    fontSize: 17,
  },
  groupSubtitle: {
    color: colors.textSecondary,
    fontFamily: fonts.medium,
    fontSize: 13,
    marginTop: 2,
  },
  balanceContainer: {
    alignItems: "flex-end",
  },
  balanceText: {
    fontFamily: fonts.bold,
    fontSize: 16,
  },
  balancePositive: {
    color: colors.positive,
  },
  balanceNegative: {
    color: colors.coral,
  },
  balanceNeutral: {
    color: colors.textPrimary,
  },
  emptyState: {
    padding: spacing.xxl,
    alignItems: "center",
    gap: spacing.xs,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontFamily: fonts.bold,
    fontSize: 16,
  },
  muted: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 14,
    textAlign: "center",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
    justifyContent: "flex-end",
  },
  dismissArea: {
    flex: 1,
  },
  modalSheet: {
    backgroundColor: "#FDFDFD",
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -4 },
    elevation: 10,
  },
  modalTitle: {
    fontFamily: fonts.bold,
    fontSize: 22,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  input: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    color: colors.textPrimary,
    fontFamily: fonts.medium,
    fontSize: 15,
  },
  categoryPillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
  catPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  catPillActive: {
    backgroundColor: colors.coral,
    borderColor: colors.coral,
  },
  catEmoji: {
    fontSize: 15,
  },
  catLabel: {
    color: colors.textSecondary,
    fontFamily: fonts.semibold,
    fontSize: 14,
  },
  catLabelActive: {
    color: colors.onDark,
  },
  createBtn: {
    backgroundColor: colors.coral,
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: "center",
    shadowColor: colors.coral,
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  createBtnDisabled: {
    opacity: 0.5,
    shadowOpacity: 0,
    elevation: 0,
  },
  createBtnText: {
    color: colors.onDark,
    fontFamily: fonts.bold,
    fontSize: 16,
  },
  cancelBtn: {
    marginTop: spacing.md,
    alignItems: "center",
    paddingVertical: 8,
  },
  cancelBtnText: {
    color: colors.textSecondary,
    fontFamily: fonts.semibold,
    fontSize: 15,
  },
});

