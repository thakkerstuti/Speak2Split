import { useMemo, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, Modal, Switch, ScrollView } from "react-native";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Settings, Home, Receipt, HandCoins, Users2, BarChart3, Bell } from "lucide-react-native";
import { notificationsApi, Notification } from "../../lib/api";
import { colors, spacing, radius, typography, fonts } from "../../lib/theme";

const NOTIFICATION_TYPES = [
  "EXPENSE_ADDED", "SETTLEMENT_CREATED", "SETTLEMENT_COMPLETED", "GROUP_INVITATION",
  "RECURRING_EXPENSE_CREATED", "PAYMENT_REMINDER",
] as const;
const CHANNELS = ["PUSH", "EMAIL"] as const;

const TYPE_LABELS: Record<string, string> = {
  EXPENSE_ADDED: "Expense added",
  SETTLEMENT_CREATED: "Settlement requested",
  SETTLEMENT_COMPLETED: "Settlement completed",
  GROUP_INVITATION: "Group invitations",
  RECURRING_EXPENSE_CREATED: "Recurring expense created",
  PAYMENT_REMINDER: "Payment reminders",
};

const TYPE_ICON: Record<string, { icon: any; bg: string }> = {
  PAYMENT_REMINDER: { icon: Home, bg: "#F04452" },
  EXPENSE_ADDED: { icon: Receipt, bg: "#1BB980" },
  SETTLEMENT_CREATED: { icon: HandCoins, bg: "#8B5CF6" },
  SETTLEMENT_COMPLETED: { icon: HandCoins, bg: "#8B5CF6" },
  GROUP_INVITATION: { icon: Users2, bg: "#14B8A6" },
  RECURRING_EXPENSE_CREATED: { icon: BarChart3, bg: "#F5A623" },
  OTHER: { icon: Bell, bg: colors.textMuted },
};

const DAY_MS = 24 * 60 * 60 * 1000;

export default function NotificationsScreen() {
  const queryClient = useQueryClient();
  const [prefsVisible, setPrefsVisible] = useState(false);

  const notificationsQuery = useQuery({ queryKey: ["notifications"], queryFn: notificationsApi.list });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const unreadCount = notificationsQuery.data?.filter((n) => !n.readAt).length ?? 0;

  const sections = useMemo(() => {
    const data = notificationsQuery.data ?? [];
    const now = Date.now();
    const recent = data.filter((n) => now - new Date(n.createdAt).getTime() < DAY_MS);
    const older = data.filter((n) => now - new Date(n.createdAt).getTime() >= DAY_MS);
    return [
      { title: "Recent", data: recent },
      { title: "Older", data: older },
    ].filter((s) => s.data.length > 0);
  }, [notificationsQuery.data]);

  const onPressNotification = (n: Notification) => {
    if (!n.readAt) markReadMutation.mutate(n.id);
  };

  const relativeTime = (iso: string) => {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short" });
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Notification</Text>
        <Pressable style={styles.iconButton} onPress={() => setPrefsVisible(true)}>
          <Settings color={colors.textSecondary} size={18} />
        </Pressable>
      </View>
      {unreadCount > 0 && (
        <Pressable style={styles.markAllRow} onPress={() => markAllReadMutation.mutate()}>
          <Text style={styles.markAllText}>Mark all {unreadCount} as read</Text>
        </Pressable>
      )}

      {notificationsQuery.isLoading && <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />}

      <FlatList
        contentContainerStyle={{ padding: spacing.lg }}
        data={sections}
        keyExtractor={(s) => s.title}
        ListEmptyComponent={
          !notificationsQuery.isLoading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>You're all caught up</Text>
              <Text style={styles.muted}>Expense and settlement updates for your groups will show up here.</Text>
            </View>
          ) : null
        }
        renderItem={({ item: section }) => (
          <View style={{ marginBottom: spacing.lg }}>
            <Text style={styles.sectionLabel}>{section.title}</Text>
            {section.data.map((n) => {
              const config = TYPE_ICON[n.type] ?? TYPE_ICON.OTHER;
              const Icon = config.icon;
              return (
                <Pressable key={n.id} style={styles.row} onPress={() => onPressNotification(n)}>
                  <View style={[styles.iconBadge, { backgroundColor: config.bg }]}>
                    <Icon color={colors.onDark} size={18} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.rowTopLine}>
                      <Text style={styles.rowTitle} numberOfLines={1}>{n.title}</Text>
                      <Text style={styles.rowTime}>{relativeTime(n.createdAt)}</Text>
                    </View>
                    <Text style={styles.rowBody} numberOfLines={2}>{n.body}</Text>
                  </View>
                  {!n.readAt && <View style={styles.unreadDot} />}
                </Pressable>
              );
            })}
          </View>
        )}
      />

      <NotificationPreferencesModal visible={prefsVisible} onClose={() => setPrefsVisible(false)} />
    </View>
  );
}

function NotificationPreferencesModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const prefsQuery = useQuery({ queryKey: ["notification-preferences"], queryFn: notificationsApi.getPreferences, enabled: visible });

  const setPrefMutation = useMutation({
    mutationFn: notificationsApi.setPreference,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notification-preferences"] }),
  });

  const isEnabled = (type: string, channel: string) => {
    const explicit = prefsQuery.data?.find((p) => p.type === type && p.channel === channel);
    if (explicit) return explicit.enabled;
    return channel === "PUSH";
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Notification preferences</Text>
          <ScrollView style={{ maxHeight: 420 }}>
            {NOTIFICATION_TYPES.map((type) => (
              <View key={type} style={styles.prefGroup}>
                <Text style={styles.prefGroupTitle}>{TYPE_LABELS[type]}</Text>
                {CHANNELS.map((channel) => (
                  <View key={channel} style={styles.prefRow}>
                    <Text style={styles.prefLabel}>{channel === "PUSH" ? "Push" : "Email"}</Text>
                    <Switch
                      value={isEnabled(type, channel)}
                      onValueChange={(value) => setPrefMutation.mutate({ type, channel, enabled: value })}
                      trackColor={{ true: colors.primary, false: colors.border }}
                    />
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>
          <Pressable style={{ marginTop: spacing.md, alignItems: "center" }} onPress={onClose}>
            <Text style={styles.muted}>Done</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: spacing.lg, paddingTop: spacing.xxl },
  title: { ...typography.title, fontSize: 19, color: colors.textPrimary },
  muted: { color: colors.textMuted, fontSize: 13, fontFamily: fonts.regular },
  markAllRow: { paddingHorizontal: spacing.lg, marginTop: spacing.sm },
  markAllText: { color: colors.primary, fontSize: 13, fontFamily: fonts.semibold },
  iconButton: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.bgElevated, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  empty: { alignItems: "center", paddingTop: spacing.xl, gap: spacing.xs },
  emptyTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 16 },
  sectionLabel: { color: colors.textMuted, fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 0.4, marginBottom: spacing.sm, textTransform: "uppercase" },
  row: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, backgroundColor: colors.bgElevated, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, shadowColor: "#0F172A", shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  iconBadge: { width: 40, height: 40, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  rowTopLine: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  rowTitle: { flex: 1, color: colors.textPrimary, fontSize: 14, fontFamily: fonts.bold },
  rowTime: { color: colors.textMuted, fontSize: 11, fontFamily: fonts.medium, marginLeft: spacing.xs },
  rowBody: { color: colors.textSecondary, fontSize: 13, fontFamily: fonts.regular, marginTop: 2 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, marginTop: 6 },
  modalOverlay: { flex: 1, backgroundColor: "#00000055", justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.bgElevated, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  modalTitle: { ...typography.title, color: colors.textPrimary, marginBottom: spacing.md },
  prefGroup: { marginBottom: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  prefGroupTitle: { color: colors.textPrimary, fontSize: 14, fontFamily: fonts.semibold, marginBottom: spacing.xs },
  prefRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 4 },
  prefLabel: { color: colors.textSecondary, fontSize: 13, fontFamily: fonts.regular },
});
