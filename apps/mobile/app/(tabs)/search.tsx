import { useState, useMemo, useRef } from "react";
import { View, Text, StyleSheet, TextInput, FlatList, Pressable, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Search as SearchIcon } from "lucide-react-native";
import { searchApi, SearchResults } from "../../lib/api";
import { colors, spacing, radius, typography } from "../../lib/theme";

type SectionKey = keyof SearchResults;

export default function SearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced so we're not hitting the API on every keystroke — each call
  // clears any pending timer from the previous keystroke first.
  const onChangeText = (text: string) => {
    setQuery(text);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => setDebouncedQuery(text), 350);
  };

  const searchQuery = useQuery({
    queryKey: ["search", debouncedQuery],
    queryFn: () => searchApi.search({ q: debouncedQuery }),
    enabled: debouncedQuery.trim().length > 0,
  });

  const sections = useMemo(() => {
    if (!searchQuery.data) return [];
    const d = searchQuery.data;
    const list: { key: SectionKey; title: string; count: number }[] = [
      { key: "expenses", title: "Expenses", count: d.expenses.length },
      { key: "groups", title: "Groups", count: d.groups.length },
      { key: "people", title: "People", count: d.people.length },
      { key: "settlements", title: "Settlements", count: d.settlements.length },
      { key: "recurringExpenses", title: "Recurring", count: d.recurringExpenses.length },
    ];
    return list.filter((s) => s.count > 0);
  }, [searchQuery.data]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Search</Text>
        <View style={styles.searchBar}>
          <SearchIcon color={colors.textMuted} size={18} />
          <TextInput
            style={styles.searchInput}
            placeholder="Expenses, people, groups…"
            placeholderTextColor={colors.textMuted}
            value={query}
            onChangeText={onChangeText}
            autoFocus
          />
        </View>
      </View>

      {searchQuery.isLoading && <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} />}

      {!searchQuery.isLoading && debouncedQuery.length > 0 && sections.length === 0 && (
        <View style={styles.empty}>
          <Text style={styles.muted}>No results for "{debouncedQuery}"</Text>
        </View>
      )}

      {debouncedQuery.length === 0 && (
        <View style={styles.empty}>
          <Text style={styles.muted}>Search across every group you're in — expenses, people, settlements, and more.</Text>
        </View>
      )}

      <FlatList
        contentContainerStyle={{ padding: spacing.lg }}
        data={sections}
        keyExtractor={(s) => s.key}
        renderItem={({ item: section }) => (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>

            {section.key === "expenses" &&
              searchQuery.data!.expenses.map((e: any) => (
                <Pressable key={e.id} style={styles.resultRow} onPress={() => router.push(`/(tabs)/groups/${e.groupId ?? e.group_id}`)}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.resultTitle}>{e.title}</Text>
                    <Text style={styles.muted}>{e.groupName ?? e.group_name} · {e.category} · {new Date(e.expenseDate ?? e.expense_date ?? Date.now()).toLocaleDateString()}</Text>
                  </View>
                  <Text style={styles.resultAmount}>₹{Number(e.amount).toFixed(2)}</Text>
                </Pressable>
              ))}

            {section.key === "groups" &&
              searchQuery.data!.groups.map((g: any) => (
                <Pressable key={g.id} style={styles.resultRow} onPress={() => router.push(`/(tabs)/groups/${g.id}`)}>
                  <Text style={styles.resultTitle}>{g.name}</Text>
                  <Text style={styles.muted}>{g.type}</Text>
                </Pressable>
              ))}

            {section.key === "people" &&
              searchQuery.data!.people.map((p: any) => (
                <View key={p.id} style={styles.resultRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.resultTitle}>{p.displayName ?? p.display_name}</Text>
                    <Text style={styles.muted}>{p.phone ?? p.email ?? "No contact info"}</Text>
                  </View>
                </View>
              ))}

            {section.key === "settlements" &&
              searchQuery.data!.settlements.map((s: any) => (
                <Pressable key={s.id} style={styles.resultRow} onPress={() => router.push(`/(tabs)/groups/${s.groupId ?? s.group_id}`)}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.resultTitle}>{s.fromDisplayName ?? s.from_name} → {s.toDisplayName ?? s.to_name}</Text>
                    <Text style={styles.muted}>{s.method} · {s.status}</Text>
                  </View>
                  <Text style={styles.resultAmount}>₹{Number(s.amount).toFixed(2)}</Text>
                </Pressable>
              ))}

            {section.key === "recurringExpenses" &&
              searchQuery.data!.recurringExpenses.map((r: any) => (
                <Pressable key={r.id} style={styles.resultRow} onPress={() => router.push(`/(tabs)/groups/${r.groupId ?? r.group_id}`)}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.resultTitle}>{r.title}</Text>
                    <Text style={styles.muted}>{r.frequency}</Text>
                  </View>
                  <Text style={styles.resultAmount}>₹{Number(r.amount).toFixed(2)}</Text>
                </Pressable>
              ))}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.xxl },
  title: { ...typography.display, fontSize: 26, color: colors.textPrimary, marginBottom: spacing.md },
  searchBar: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 16, paddingVertical: 12 },
  empty: { alignItems: "center", paddingTop: spacing.xl, paddingHorizontal: spacing.xl },
  muted: { color: colors.textMuted, fontSize: 13, textAlign: "center" },
  section: { marginBottom: spacing.lg },
  sectionTitle: { ...typography.label, color: colors.textMuted, marginBottom: spacing.sm },
  resultRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.xs },
  resultTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: "600" },
  resultAmount: { color: colors.textPrimary, fontWeight: "700" },
});
