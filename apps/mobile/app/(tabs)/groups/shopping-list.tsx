import { useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, TextInput, Alert, ActivityIndicator } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Plus, Check } from "lucide-react-native";
import { shoppingApi, ShoppingItem } from "../../../lib/api";
import { useGroupRealtime } from "../../../lib/useGroupRealtime";
import { colors, spacing, radius, typography } from "../../../lib/theme";

export default function ShoppingListScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const queryClient = useQueryClient();
  const [newItemName, setNewItemName] = useState("");

  useGroupRealtime(groupId);

  const listsQuery = useQuery({
    queryKey: ["shopping", groupId],
    queryFn: () => shoppingApi.getForGroup(groupId!),
    enabled: !!groupId,
  });

  const list = listsQuery.data?.[0];

  const addMutation = useMutation({
    mutationFn: () => shoppingApi.addItem({ listId: list!.id, name: newItemName }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shopping", groupId] });
      setNewItemName("");
    },
    onError: (err: any) => Alert.alert("Couldn't add item", err?.response?.data?.error ?? "Try again."),
  });

  const toggleMutation = useMutation({
    mutationFn: (item: ShoppingItem) => shoppingApi.updateItem(item.id, { isCompleted: !item.isCompleted }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shopping", groupId] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => shoppingApi.deleteItem(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shopping", groupId] }),
  });

  if (listsQuery.isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (listsQuery.isError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>Couldn't load the shopping list.</Text>
      </View>
    );
  }

  const pending = list?.items.filter((i) => !i.isCompleted) ?? [];
  const completed = list?.items.filter((i) => i.isCompleted) ?? [];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{list?.name ?? "Shopping List"}</Text>
      </View>

      <View style={styles.addRow}>
        <TextInput
          style={styles.input}
          placeholder="Add an item…"
          placeholderTextColor={colors.textMuted}
          value={newItemName}
          onChangeText={setNewItemName}
          onSubmitEditing={() => newItemName.trim() && addMutation.mutate()}
          returnKeyType="done"
        />
        <Pressable
          style={[styles.addButton, !newItemName.trim() && { opacity: 0.4 }]}
          disabled={!newItemName.trim() || addMutation.isPending}
          onPress={() => addMutation.mutate()}
        >
          <Plus color={colors.bg} size={20} />
        </Pressable>
      </View>

      <FlatList
        contentContainerStyle={{ padding: spacing.lg }}
        data={[...pending, ...completed]}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Nothing on the list yet</Text>
            <Text style={styles.muted}>Add groceries, supplies, or anything the group needs to pick up.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.itemRow}>
            <Pressable style={styles.checkbox} onPress={() => toggleMutation.mutate(item)}>
              {item.isCompleted && <Check color={colors.bg} size={14} />}
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={[styles.itemName, item.isCompleted && styles.itemNameCompleted]}>{item.name}</Text>
              <Text style={styles.muted}>
                {[item.quantity, item.estimatedPrice ? `₹${item.estimatedPrice}` : null, item.assignedToName ? `→ ${item.assignedToName}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </View>
            <Pressable onPress={() => deleteMutation.mutate(item.id)}>
              <Text style={styles.deleteText}>Remove</Text>
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.xxl },
  title: { ...typography.display, fontSize: 26, color: colors.textPrimary },
  addRow: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, marginTop: spacing.md },
  input: { flex: 1, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: 12, color: colors.textPrimary, fontSize: 16 },
  addButton: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", paddingTop: spacing.xl, gap: spacing.xs },
  emptyTitle: { color: colors.textPrimary, fontWeight: "600", fontSize: 16 },
  muted: { color: colors.textMuted, fontSize: 13 },
  itemRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  checkbox: { width: 24, height: 24, borderRadius: radius.sm, borderWidth: 2, borderColor: colors.accent, alignItems: "center", justifyContent: "center" },
  itemName: { color: colors.textPrimary, fontSize: 15, fontWeight: "600" },
  itemNameCompleted: { textDecorationLine: "line-through", color: colors.textMuted },
  deleteText: { color: colors.negative, fontSize: 12 },
});
