import { useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, Modal, TextInput, Alert, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Plus, Zap } from "lucide-react-native";
import { templatesApi, expensesApi, ExpenseTemplate } from "../../../lib/api";
import { colors, spacing, radius, typography } from "../../../lib/theme";

export default function TemplatesScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [createVisible, setCreateVisible] = useState(false);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [applyingId, setApplyingId] = useState<string | null>(null);

  const templatesQuery = useQuery({ queryKey: ["templates", groupId], queryFn: () => templatesApi.list(groupId) });

  const createMutation = useMutation({
    mutationFn: () =>
      templatesApi.create({ groupId, name, title, defaultAmount: amount ? Number(amount) : undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates", groupId] });
      setCreateVisible(false);
      setName("");
      setTitle("");
      setAmount("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => templatesApi.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["templates", groupId] }),
  });

  /**
   * "Use template": resolves the CURRENT group's active members fresh from
   * the server (never reuses stale IDs from when the template was made),
   * then creates the expense split equally among everyone currently in
   * the group, exactly like the manual add-expense default. The person
   * still sees the result on the group screen and can edit/settle from
   * there — this is a fast-path for genuinely recurring, no-surprises
   * expenses like rent, not a black box.
   */
  const useTemplate = async (template: ExpenseTemplate) => {
    if (!groupId) return;
    setApplyingId(template.id);
    try {
      const resolved = await templatesApi.resolve(template.id, groupId);
      if (!resolved.amount) {
        Alert.alert("Amount needed", "This template has no default amount saved — add the expense manually this time.");
        return;
      }
      const participantIds = resolved.suggestedParticipants.map((p) => p.userId);
      if (participantIds.length === 0) {
        Alert.alert("No members", "This group currently has no members to split with.");
        return;
      }
      await expensesApi.create({
        groupId,
        title: resolved.title,
        amount: Number(resolved.amount),
        category: resolved.category,
        splitMethod: "EQUAL",
        payers: [{ userId: participantIds[0], amountPaid: Number(resolved.amount) }],
        participants: participantIds.map((userId) => ({ userId })),
        source: "TEMPLATE",
      });
      queryClient.invalidateQueries({ queryKey: ["expenses", groupId] });
      queryClient.invalidateQueries({ queryKey: ["balances", groupId] });
      Alert.alert("Expense created", `${resolved.title} — ₹${resolved.amount}, split between ${participantIds.length} current members.`, [
        { text: "OK", onPress: () => router.push(`/(tabs)/groups/${groupId}`) },
      ]);
    } catch (err: any) {
      Alert.alert("Couldn't use template", err?.response?.data?.error ?? "Try again.");
    } finally {
      setApplyingId(null);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Templates</Text>
        <Pressable style={styles.addButton} onPress={() => setCreateVisible(true)}>
          <Plus color={colors.bg} size={20} />
        </Pressable>
      </View>

      {templatesQuery.isLoading && <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} />}

      <FlatList
        contentContainerStyle={{ padding: spacing.lg }}
        data={templatesQuery.data ?? []}
        keyExtractor={(t) => t.id}
        ListEmptyComponent={
          !templatesQuery.isLoading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No templates yet</Text>
              <Text style={styles.muted}>Save recurring expenses like Rent or WiFi for one-tap reuse.</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{item.name}</Text>
              <Text style={styles.muted}>
                {item.title}{item.defaultAmount ? ` · ₹${item.defaultAmount}` : ""} · {item.category}
              </Text>
            </View>
            <Pressable style={styles.useButton} onPress={() => useTemplate(item)} disabled={applyingId === item.id}>
              {applyingId === item.id ? <ActivityIndicator color={colors.accent} size="small" /> : <Zap color={colors.accent} size={16} />}
              <Text style={styles.useButtonText}>Use</Text>
            </Pressable>
            <Pressable onPress={() => deleteMutation.mutate(item.id)} style={{ marginLeft: spacing.sm }}>
              <Text style={styles.deleteText}>Delete</Text>
            </Pressable>
          </View>
        )}
      />

      <Modal visible={createVisible} transparent animationType="slide" onRequestClose={() => setCreateVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>New template</Text>
            <TextInput style={styles.input} placeholder="Name (e.g. Rent)" placeholderTextColor={colors.textMuted} value={name} onChangeText={setName} />
            <TextInput style={styles.input} placeholder="Expense title (e.g. Monthly Rent)" placeholderTextColor={colors.textMuted} value={title} onChangeText={setTitle} />
            <TextInput style={styles.input} placeholder="Default amount (optional)" placeholderTextColor={colors.textMuted} keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
            <Pressable style={styles.button} onPress={() => createMutation.mutate()} disabled={!name || !title}>
              <Text style={styles.buttonText}>{createMutation.isPending ? "Saving…" : "Save template"}</Text>
            </Pressable>
            <Pressable style={{ marginTop: spacing.md, alignItems: "center" }} onPress={() => setCreateVisible(false)}>
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
  title: { ...typography.display, fontSize: 26, color: colors.textPrimary },
  addButton: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", paddingTop: spacing.xl, gap: spacing.xs },
  emptyTitle: { color: colors.textPrimary, fontWeight: "600", fontSize: 16 },
  muted: { color: colors.textMuted, fontSize: 13 },
  card: { flexDirection: "row", alignItems: "center", backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  cardTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: "700" },
  useButton: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.accentMuted, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.pill },
  useButtonText: { color: colors.accent, fontWeight: "700", fontSize: 12 },
  deleteText: { color: colors.negative, fontSize: 12 },
  modalOverlay: { flex: 1, backgroundColor: "#00000090", justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.bgElevated, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  modalTitle: { ...typography.title, color: colors.textPrimary, marginBottom: spacing.md },
  input: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, color: colors.textPrimary, fontSize: 16, marginTop: spacing.md },
  button: { marginTop: spacing.lg, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: 16, alignItems: "center" },
  buttonText: { color: colors.bg, fontWeight: "700", fontSize: 16 },
});
