import { useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, Modal, TextInput } from "react-native";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Plus } from "lucide-react-native";
import { groupsApi } from "../../../lib/api";
import { colors, spacing, radius, typography } from "../../../lib/theme";

const GROUP_TYPES = ["FLAT", "TRIP", "FAMILY", "FRIENDS", "COUPLE", "EVENT", "CUSTOM"] as const;

export default function GroupsListScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const groupsQuery = useQuery({ queryKey: ["groups"], queryFn: groupsApi.list });
  const [modalVisible, setModalVisible] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof GROUP_TYPES)[number]>("FLAT");

  const createMutation = useMutation({
    mutationFn: () => groupsApi.create({ name, type }),
    onSuccess: (group) => {
      queryClient.invalidateQueries({ queryKey: ["groups"] });
      setModalVisible(false);
      setName("");
      router.push(`/(tabs)/groups/${group.id}`);
    },
  });

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Groups</Text>
        <Pressable style={styles.addButton} onPress={() => setModalVisible(true)}>
          <Plus color={colors.bg} size={20} />
        </Pressable>
      </View>

      <FlatList
        contentContainerStyle={{ padding: spacing.lg }}
        data={groupsQuery.data ?? []}
        keyExtractor={(g) => g.id}
        renderItem={({ item }) => (
          <Pressable style={styles.groupCard} onPress={() => router.push(`/(tabs)/groups/${item.id}`)}>
            <View style={styles.groupAvatar}>
              <Text style={styles.groupAvatarText}>{item.name.slice(0, 1).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.groupName}>{item.name}</Text>
              <Text style={styles.muted}>
                {item.type} · {item.currency}
              </Text>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No groups yet</Text>
            <Text style={styles.muted}>Tap + to create your first one.</Text>
          </View>
        }
      />

      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>New group</Text>
            <TextInput
              style={styles.input}
              placeholder="Group name"
              placeholderTextColor={colors.textMuted}
              value={name}
              onChangeText={setName}
            />
            <View style={styles.typeRow}>
              {GROUP_TYPES.map((t) => (
                <Pressable
                  key={t}
                  style={[styles.typeChip, type === t && styles.typeChipActive]}
                  onPress={() => setType(t)}
                >
                  <Text style={[styles.typeChipText, type === t && styles.typeChipTextActive]}>{t}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              style={[styles.button, !name && { opacity: 0.5 }]}
              disabled={!name || createMutation.isPending}
              onPress={() => createMutation.mutate()}
            >
              <Text style={styles.buttonText}>{createMutation.isPending ? "Creating…" : "Create group"}</Text>
            </Pressable>
            <Pressable style={{ marginTop: spacing.md, alignItems: "center" }} onPress={() => setModalVisible(false)}>
              <Text style={styles.muted}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: spacing.lg, paddingTop: spacing.xxl },
  title: { ...typography.display, fontSize: 28, color: colors.textPrimary },
  addButton: { backgroundColor: colors.accent, borderRadius: radius.pill, width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  groupCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  groupAvatar: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.accentMuted, alignItems: "center", justifyContent: "center" },
  groupAvatarText: { color: colors.accent, fontWeight: "700", fontSize: 18 },
  groupName: { color: colors.textPrimary, fontSize: 16, fontWeight: "600" },
  muted: { color: colors.textMuted, fontSize: 14 },
  emptyState: { padding: spacing.xl, alignItems: "center", gap: spacing.xs },
  emptyTitle: { color: colors.textPrimary, fontWeight: "600" },
  modalOverlay: { flex: 1, backgroundColor: "#00000090", justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.bgElevated, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  modalTitle: { ...typography.title, color: colors.textPrimary, marginBottom: spacing.md },
  input: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, color: colors.textPrimary, fontSize: 16 },
  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.md },
  typeChip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  typeChipActive: { backgroundColor: colors.accentMuted, borderColor: colors.accent },
  typeChipText: { color: colors.textSecondary, fontSize: 13 },
  typeChipTextActive: { color: colors.accent, fontWeight: "700" },
  button: { marginTop: spacing.lg, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: 16, alignItems: "center" },
  buttonText: { color: colors.bg, fontWeight: "700", fontSize: 16 },
});
