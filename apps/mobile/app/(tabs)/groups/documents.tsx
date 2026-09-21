import { useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, Alert, ActivityIndicator, Linking } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import { FileText, Upload, Trash2 } from "lucide-react-native";
import { api, documentsApi } from "../../../lib/api";
import { useAuthStore } from "../../../store/auth-store";
import { colors, spacing, radius, typography } from "../../../lib/theme";

export default function DocumentsScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const queryClient = useQueryClient();
  const authToken = useAuthStore((s) => s.token);
  const [uploading, setUploading] = useState(false);

  const docsQuery = useQuery({ queryKey: ["documents", groupId], queryFn: () => documentsApi.list(groupId!) });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => documentsApi.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["documents", groupId] }),
    onError: (err: any) => Alert.alert("Couldn't delete", err?.response?.data?.error ?? "Try again."),
  });

  const pickAndUpload = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.[0]) return;

    const file = result.assets[0];
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", {
        uri: file.uri,
        name: file.name,
        type: file.mimeType ?? "application/octet-stream",
      } as unknown as Blob);
      formData.append("category", "document");

      await api.post(`/documents/group/${groupId}`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      queryClient.invalidateQueries({ queryKey: ["documents", groupId] });
    } catch (err: any) {
      Alert.alert("Upload failed", err?.response?.data?.error ?? String(err?.message ?? err));
    } finally {
      setUploading(false);
    }
  };

  const openDocument = (documentId: string) => {
    // Opens in the device browser/viewer; the download endpoint enforces
    // group-membership authorization server-side before streaming bytes.
    Linking.openURL(documentsApi.downloadUrl(documentId));
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Documents</Text>
        <Pressable style={styles.uploadButton} onPress={pickAndUpload} disabled={uploading}>
          {uploading ? <ActivityIndicator color={colors.bg} size="small" /> : <Upload color={colors.bg} size={18} />}
        </Pressable>
      </View>

      {docsQuery.isLoading && <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} />}

      <FlatList
        contentContainerStyle={{ padding: spacing.lg }}
        data={docsQuery.data ?? []}
        keyExtractor={(d: any) => d.id}
        ListEmptyComponent={
          !docsQuery.isLoading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No documents yet</Text>
              <Text style={styles.muted}>Bills, tickets, and booking confirmations for this group live here.</Text>
            </View>
          ) : null
        }
        renderItem={({ item }: { item: any }) => (
          <Pressable style={styles.row} onPress={() => openDocument(item.id)}>
            <FileText color={colors.accent} size={22} />
            <View style={{ flex: 1 }}>
              <Text style={styles.fileName}>{item.fileName}</Text>
              <Text style={styles.muted}>
                {item.uploadedByName} · {(item.sizeBytes / 1024).toFixed(0)} KB · {new Date(item.createdAt).toLocaleDateString()}
              </Text>
            </View>
            <Pressable onPress={() => deleteMutation.mutate(item.id)} hitSlop={8}>
              <Trash2 color={colors.negative} size={18} />
            </Pressable>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: spacing.lg, paddingTop: spacing.xxl },
  title: { ...typography.display, fontSize: 26, color: colors.textPrimary },
  uploadButton: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", paddingTop: spacing.xl, gap: spacing.xs },
  emptyTitle: { color: colors.textPrimary, fontWeight: "600", fontSize: 16 },
  muted: { color: colors.textMuted, fontSize: 13 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  fileName: { color: colors.textPrimary, fontSize: 15, fontWeight: "600" },
});
