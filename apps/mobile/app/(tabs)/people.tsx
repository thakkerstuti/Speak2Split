import { useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, Alert, TextInput, Modal, ActivityIndicator } from "react-native";
import * as Contacts from "expo-contacts";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { UserPlus, RefreshCw } from "lucide-react-native";
import { contactsApi } from "../../lib/api";
import { colors, spacing, radius, typography } from "../../lib/theme";

/**
 * Contact permission is entirely optional (per spec). The app works fully
 * without it — people can always be added manually or invited to a group.
 * We never ask more than once per app session if the user declines; if
 * denied, we simply don't show the sync affordance beyond a single retry
 * via the button (no auto-repeat prompts).
 */
export default function PeopleScreen() {
  const queryClient = useQueryClient();
  const contactsQuery = useQuery({ queryKey: ["contacts"], queryFn: contactsApi.list });
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const addMutation = useMutation({
    mutationFn: () => contactsApi.addPerson({ displayName: name, phone: phone || undefined, email: email || undefined }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      setAddModalVisible(false);
      setName("");
      setPhone("");
      setEmail("");
      if (result.linked !== "NEW") {
        Alert.alert("Already known", "This matched someone you already have — linked instead of duplicating.");
      }
    },
    onError: (err: any) =>
      Alert.alert("Couldn't add person", err?.response?.data?.error?.message ?? err?.response?.data?.error ?? "A phone number or email is required."),
  });

  const syncContacts = async () => {
    const { status } = await Contacts.requestPermissionsAsync();
    if (status !== "granted") {
      setPermissionDenied(true);
      // Per spec: do not repeatedly prompt. The app remains fully usable —
      // people can still be added manually or via group invite.
      return;
    }
    setSyncing(true);
    try {
      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Emails],
      });

      // Only send name + phone/email — never the full raw platform record —
      // and only rows that actually have an identifier, since a bare name
      // can never establish identity (see contact-matching.ts).
      const payload = data
        .filter((c) => c.name && ((c.phoneNumbers && c.phoneNumbers.length) || (c.emails && c.emails.length)))
        .map((c) => ({
          displayName: c.name!,
          phones: (c.phoneNumbers ?? []).map((p) => p.number).filter((n): n is string => !!n),
          emails: (c.emails ?? []).map((e) => e.email).filter((e): e is string => !!e),
        }));

      const result = await contactsApi.sync(payload);
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      Alert.alert(
        "Contacts synced",
        `${result.summary.linkedToUser} matched existing Speak2Split users, ${result.summary.linkedToContact} already known, ${result.summary.created} added new, ${result.summary.skipped} skipped (no phone/email).`
      );
    } catch (err: any) {
      Alert.alert("Sync failed", String(err?.message ?? err));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>People</Text>
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <Pressable style={styles.iconButton} onPress={syncContacts} disabled={syncing}>
            {syncing ? <ActivityIndicator color={colors.accent} /> : <RefreshCw color={colors.accent} size={20} />}
          </Pressable>
          <Pressable style={styles.iconButton} onPress={() => setAddModalVisible(true)}>
            <UserPlus color={colors.accent} size={20} />
          </Pressable>
        </View>
      </View>

      {permissionDenied && (
        <View style={styles.noticeCard}>
          <Text style={styles.muted}>
            Contact access isn't enabled. Speak2Split works fully without it — add people manually or invite them to a
            group instead.
          </Text>
        </View>
      )}

      <FlatList
        contentContainerStyle={{ padding: spacing.lg }}
        data={contactsQuery.data ?? []}
        keyExtractor={(c) => c.id}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{item.displayName.slice(0, 1).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.displayName}</Text>
              <Text style={styles.muted}>
                {item.targetUserId ? "Speak2Split user" : item.phone || item.email || "No identifier"}
              </Text>
            </View>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.muted}>No people yet. Sync contacts or add someone manually.</Text>
          </View>
        }
      />

      <Modal visible={addModalVisible} transparent animationType="slide" onRequestClose={() => setAddModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add a person</Text>
            <Text style={styles.muted}>A phone number or email is required — this is what keeps two people with the same name from getting mixed up.</Text>
            <TextInput style={styles.input} placeholder="Full name" placeholderTextColor={colors.textMuted} value={name} onChangeText={setName} />
            <TextInput style={styles.input} placeholder="Phone (optional if email given)" placeholderTextColor={colors.textMuted} keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
            <TextInput style={styles.input} placeholder="Email (optional if phone given)" placeholderTextColor={colors.textMuted} autoCapitalize="none" value={email} onChangeText={setEmail} />
            <Pressable style={styles.button} onPress={() => addMutation.mutate()} disabled={!name || (!phone && !email)}>
              <Text style={styles.buttonText}>{addMutation.isPending ? "Adding…" : "Add"}</Text>
            </Pressable>
            <Pressable style={{ marginTop: spacing.md, alignItems: "center" }} onPress={() => setAddModalVisible(false)}>
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
  iconButton: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  noticeCard: { margin: spacing.lg, backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm },
  avatar: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.accentMuted, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.accent, fontWeight: "700" },
  name: { color: colors.textPrimary, fontSize: 15, fontWeight: "600" },
  muted: { color: colors.textMuted, fontSize: 13 },
  empty: { alignItems: "center", paddingTop: spacing.xl },
  modalOverlay: { flex: 1, backgroundColor: "#00000090", justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.bgElevated, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  modalTitle: { ...typography.title, color: colors.textPrimary, marginBottom: spacing.xs },
  input: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, color: colors.textPrimary, fontSize: 16, marginTop: spacing.md },
  button: { marginTop: spacing.lg, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: 16, alignItems: "center" },
  buttonText: { color: colors.bg, fontWeight: "700", fontSize: 16 },
});
