import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, Alert, ActivityIndicator, Modal } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Mic, Square } from "lucide-react-native";
import { Audio } from "expo-av";
import * as ImagePicker from "expo-image-picker";
import { groupsApi, expensesApi, api, contactsApi } from "../../lib/api";
import { useAuthStore } from "../../store/auth-store";
import { colors, spacing, radius, typography } from "../../lib/theme";

type Mode = "manual" | "voice" | "receipt";

export default function AddExpenseScreen() {
  const { mode: modeParam } = useLocalSearchParams<{ mode?: string }>();
  const [mode, setMode] = useState<Mode>((modeParam as Mode) ?? "manual");
  const router = useRouter();
  const queryClient = useQueryClient();

  const groupsQuery = useQuery({ queryKey: ["groups"], queryFn: groupsApi.list });
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedGroupId && groupsQuery.data?.length) setSelectedGroupId(groupsQuery.data[0].id);
  }, [groupsQuery.data]);

  const groupDetailQuery = useQuery({
    queryKey: ["group", selectedGroupId],
    queryFn: () => groupsApi.detail(selectedGroupId!),
    enabled: !!selectedGroupId,
  });

  // ---------- Manual entry state ----------
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("general");
  const [selectedParticipants, setSelectedParticipants] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Default: everyone in the group participates, payer = current user (handled server-side by caller).
    if (groupDetailQuery.data) {
      setSelectedParticipants(new Set(groupDetailQuery.data.members.map((m) => m.id)));
    }
  }, [groupDetailQuery.data]);

  const createExpenseMutation = useMutation({
    mutationFn: expensesApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses", selectedGroupId] });
      queryClient.invalidateQueries({ queryKey: ["balances", selectedGroupId] });
      Alert.alert("Expense added", "", [{ text: "OK", onPress: () => router.push(`/(tabs)/groups/${selectedGroupId}`) }]);
      setTitle("");
      setAmount("");
    },
    onError: (err: any) => Alert.alert("Couldn't add expense", err?.response?.data?.error ?? "Try again."),
  });

  const currentUser = useAuthStore((s) => s.user);
  const myUserId = currentUser?.id;

  const submitManual = () => {
    if (!selectedGroupId || !title || !amount || selectedParticipants.size === 0) {
      Alert.alert("Missing info", "Fill in a title, amount, and pick at least one participant.");
      return;
    }
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      Alert.alert("Invalid amount", "Enter a positive number.");
      return;
    }
    createExpenseMutation.mutate({
      groupId: selectedGroupId,
      title,
      amount: amountNum,
      category,
      splitMethod: "EQUAL",
      payers: [{ userId: myUserId!, amountPaid: amountNum }],
      participants: [...selectedParticipants].map((userId) => ({ userId })),
      source: "MANUAL",
    });
  };

  // ---------- Voice / NLP entry state ----------
  const [utterance, setUtterance] = useState("");
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);

  const startRecording = async () => {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Microphone permission needed", "Enable microphone access in Settings to use voice input.");
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: rec } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      setRecording(rec);
      setIsRecording(true);
    } catch (err) {
      Alert.alert("Recording failed", String(err));
    }
  };

  const [transcribing, setTranscribing] = useState(false);
  const stopRecording = async () => {
    if (!recording) return;
    setIsRecording(false);
    await recording.stopAndUnloadAsync();
    const uri = recording.getURI();
    setRecording(null);
    if (!uri) return;

    // Real upload to the backend's speech-to-text endpoint. Requires an
    // STT provider configured server-side (see .env.example). If it's not
    // configured, this surfaces the exact 503 the backend returns rather
    // than pretending to have transcribed anything.
    setTranscribing(true);
    try {
      const formData = new FormData();
      formData.append("audio", {
        uri,
        name: "recording.m4a",
        type: "audio/m4a",
      } as unknown as Blob);

      const { data } = await api.post<{ transcript: string }>("/voice/transcribe", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setUtterance(data.transcript);
      Alert.alert("Transcribed", `"${data.transcript}"\n\nReview it below, then tap Parse.`);
    } catch (err: any) {
      const message = err?.response?.data?.error ?? String(err?.message ?? err);
      Alert.alert(
        "Couldn't transcribe",
        `${message}\n\nYou can still type what you said below — it runs through the exact same parser.`
      );
    } finally {
      setTranscribing(false);
    }
  };

  const [parseResult, setParseResult] = useState<any>(null);
  const [parsing, setParsing] = useState(false);
  const [addPersonFor, setAddPersonFor] = useState<string | null>(null);
  const [addPersonName, setAddPersonName] = useState("");
  const [addPersonPhone, setAddPersonPhone] = useState("");
  const [addPersonEmail, setAddPersonEmail] = useState("");
  const [addingPerson, setAddingPerson] = useState(false);

  // ---------- Receipt scan state ----------
  const [scanningReceipt, setScanningReceipt] = useState(false);
  const [receiptDraft, setReceiptDraft] = useState<any>(null);
  const [receiptMerchant, setReceiptMerchant] = useState("");
  const [receiptAmount, setReceiptAmount] = useState("");
  const [receiptCategory, setReceiptCategory] = useState("general");

  const pickReceiptImage = async (source: "camera" | "gallery") => {
    const permission =
      source === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission needed", `Enable ${source} access in Settings to scan a receipt.`);
      return;
    }

    const result =
      source === "camera"
        ? await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: true })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.7, allowsEditing: true });

    if (result.canceled || !result.assets?.[0]) return;
    const image = result.assets[0];

    if (!selectedGroupId) {
      Alert.alert("Pick a group first", "Choose which group this receipt belongs to.");
      return;
    }

    setScanningReceipt(true);
    setReceiptDraft(null);
    try {
      const formData = new FormData();
      formData.append("image", {
        uri: image.uri,
        name: "receipt.jpg",
        type: "image/jpeg",
      } as unknown as Blob);
      formData.append("groupId", selectedGroupId);

      const { data } = await api.post("/receipts/scan", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setReceiptDraft(data);
      setReceiptMerchant(data.merchant ?? "");
      setReceiptAmount(data.amount ? String(data.amount) : "");
      setReceiptCategory(data.category ?? "general");
    } catch (err: any) {
      Alert.alert("Couldn't scan receipt", err?.response?.data?.error ?? "Try a clearer photo, or add the expense manually.");
    } finally {
      setScanningReceipt(false);
    }
  };

  const confirmReceiptExpense = () => {
    if (!selectedGroupId || !myUserId) return;
    const amountNum = Number(receiptAmount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      Alert.alert("Invalid amount", "Enter the correct total before confirming.");
      return;
    }
    const participantIds = groupDetailQuery.data?.members.map((m) => m.id) ?? [];
    createExpenseMutation.mutate({
      groupId: selectedGroupId,
      title: receiptMerchant || "Receipt",
      amount: amountNum,
      category: receiptCategory,
      splitMethod: "EQUAL",
      payers: [{ userId: myUserId, amountPaid: amountNum }],
      participants: participantIds.map((userId) => ({ userId })),
      source: "RECEIPT_OCR",
      notes: receiptDraft?.rawText ? `OCR source: ${receiptDraft.amountSource}` : undefined,
    });
    setReceiptDraft(null);
  };

  const parseUtterance = async () => {
    if (!selectedGroupId || !utterance.trim()) return;
    setParsing(true);
    setParseResult(null);
    try {
      const { data } = await api.post("/expenses/parse", { groupId: selectedGroupId, utterance });
      setParseResult(data);
    } catch (err: any) {
      Alert.alert("Couldn't parse that", err?.response?.data?.error ?? "Try rephrasing.");
    } finally {
      setParsing(false);
    }
  };

  /**
   * "Add person" flow triggered when a mention comes back NOT_FOUND.
   * Per the identity rules: this REQUIRES a phone or email (enforced
   * server-side too) — we never create a person from the spoken name
   * alone, since that's exactly how silent misattribution happens.
   */
  const submitAddPerson = async () => {
    if (!addPersonFor) return;
    if (!addPersonPhone && !addPersonEmail) {
      Alert.alert("Phone or email required", "This is what keeps two people with the same name from getting mixed up.");
      return;
    }
    setAddingPerson(true);
    try {
      await contactsApi.addPerson({
        displayName: addPersonName || addPersonFor,
        phone: addPersonPhone || undefined,
        email: addPersonEmail || undefined,
      });
      setAddPersonFor(null);
      setAddPersonName("");
      setAddPersonPhone("");
      setAddPersonEmail("");
      // Re-run the parse so the newly added person resolves this time.
      await parseUtterance();
    } catch (err: any) {
      Alert.alert("Couldn't add person", err?.response?.data?.error ?? "Try again.");
    } finally {
      setAddingPerson(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.xxl }}>
      <Text style={styles.title}>Add expense</Text>

      <View style={styles.modeRow}>
        {(["manual", "voice", "receipt"] as Mode[]).map((m) => (
          <Pressable key={m} style={[styles.modeChip, mode === m && styles.modeChipActive]} onPress={() => setMode(m)}>
            <Text style={[styles.modeChipText, mode === m && styles.modeChipTextActive]}>{m}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>GROUP</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.sm }}>
        {groupsQuery.data?.map((g) => (
          <Pressable
            key={g.id}
            style={[styles.groupChip, selectedGroupId === g.id && styles.groupChipActive]}
            onPress={() => setSelectedGroupId(g.id)}
          >
            <Text style={[styles.groupChipText, selectedGroupId === g.id && styles.groupChipTextActive]}>{g.name}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {mode === "manual" && (
        <View style={{ marginTop: spacing.lg }}>
          <Text style={styles.label}>TITLE</Text>
          <TextInput style={styles.input} placeholder="Electricity" placeholderTextColor={colors.textMuted} value={title} onChangeText={setTitle} />
          <Text style={[styles.label, { marginTop: spacing.md }]}>AMOUNT (₹)</Text>
          <TextInput style={styles.input} placeholder="2400" placeholderTextColor={colors.textMuted} keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
          <Text style={[styles.label, { marginTop: spacing.md }]}>CATEGORY</Text>
          <TextInput style={styles.input} placeholder="electricity" placeholderTextColor={colors.textMuted} value={category} onChangeText={setCategory} />

          <Text style={[styles.label, { marginTop: spacing.md }]}>SPLIT BETWEEN</Text>
          {groupDetailQuery.data?.members.map((m) => {
            const selected = selectedParticipants.has(m.id);
            return (
              <Pressable
                key={m.id}
                style={styles.participantRow}
                onPress={() => {
                  const next = new Set(selectedParticipants);
                  if (selected) next.delete(m.id);
                  else next.add(m.id);
                  setSelectedParticipants(next);
                }}
              >
                <View style={[styles.checkbox, selected && styles.checkboxActive]} />
                <Text style={styles.participantName}>{m.displayName}</Text>
              </Pressable>
            );
          })}

          <Pressable style={styles.submitButton} onPress={submitManual} disabled={createExpenseMutation.isPending}>
            <Text style={styles.submitButtonText}>{createExpenseMutation.isPending ? "Adding…" : "Add expense"}</Text>
          </Pressable>
        </View>
      )}

      {mode === "voice" && (
        <View style={{ marginTop: spacing.lg, alignItems: "center" }}>
          <Pressable
            style={[styles.micButton, isRecording && styles.micButtonActive]}
            onPress={isRecording ? stopRecording : startRecording}
          >
            {isRecording ? <Square color={colors.bg} size={28} /> : <Mic color={colors.bg} size={28} />}
          </Pressable>
          <Text style={[styles.muted, { marginTop: spacing.sm }]}>
            {isRecording ? "Recording… tap to stop" : transcribing ? "Transcribing…" : "Tap to speak"}
          </Text>

          <Text style={[styles.label, { marginTop: spacing.xl, alignSelf: "flex-start" }]}>OR TYPE IT</Text>
          <TextInput
            style={[styles.input, { width: "100%", height: 80, textAlignVertical: "top" }]}
            placeholder="I paid 2400 for electricity. Me, Vanshika and Ishika are splitting it."
            placeholderTextColor={colors.textMuted}
            multiline
            value={utterance}
            onChangeText={setUtterance}
          />
          <Pressable style={styles.submitButton} onPress={parseUtterance} disabled={parsing}>
            {parsing ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.submitButtonText}>Parse</Text>}
          </Pressable>

          {parseResult && (
            <View style={styles.parseResultCard}>
              <Text style={styles.parseResultTitle}>{parseResult.draft.title} — ₹{parseResult.draft.amount}</Text>
              <Text style={styles.muted}>Category: {parseResult.draft.category} · Split: {parseResult.draft.splitMethod}</Text>
              {Object.entries(parseResult.resolvedMentions).map(([mention, res]: [string, any]) => (
                <View key={mention} style={styles.mentionRow}>
                  <Text style={styles.mentionLabel}>"{mention}"</Text>
                  {res.status === "RESOLVED" && <Text style={styles.mentionResolved}>→ {res.displayName}</Text>}
                  {res.status === "AMBIGUOUS" && (
                    <View>
                      <Text style={styles.mentionAmbiguous}>{res.promptMessage}</Text>
                      <View style={{ flexDirection: "row", gap: spacing.xs, marginTop: spacing.xs }}>
                        {res.candidates.map((c: any) => (
                          <Pressable key={c.userId} style={styles.candidateChip}>
                            <Text style={styles.candidateChipText}>{c.displayName}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  )}
                  {res.status === "NOT_FOUND" && (
                    <View>
                      <Text style={styles.mentionNotFound}>Couldn't identify "{mention}"</Text>
                      <Pressable
                        style={styles.candidateChip}
                        onPress={() => {
                          setAddPersonFor(mention);
                          setAddPersonName(mention);
                        }}
                      >
                        <Text style={styles.candidateChipText}>+ Add person</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              ))}
              <Text style={[styles.muted, { marginTop: spacing.sm }]}>
                Tap a name above to confirm who they are, then this becomes a normal expense confirmation before it's created —
                nothing is saved yet.
              </Text>
            </View>
          )}
        </View>
      )}

      {mode === "receipt" && (
        <View style={{ marginTop: spacing.lg, alignItems: "center" }}>
          <View style={styles.receiptButtonRow}>
            <Pressable style={styles.receiptSourceButton} onPress={() => pickReceiptImage("camera")} disabled={scanningReceipt}>
              <Text style={styles.receiptSourceButtonText}>Camera</Text>
            </Pressable>
            <Pressable style={styles.receiptSourceButton} onPress={() => pickReceiptImage("gallery")} disabled={scanningReceipt}>
              <Text style={styles.receiptSourceButtonText}>Gallery</Text>
            </Pressable>
          </View>

          {scanningReceipt && (
            <View style={{ marginTop: spacing.lg, alignItems: "center" }}>
              <ActivityIndicator color={colors.accent} />
              <Text style={[styles.muted, { marginTop: spacing.sm }]}>Reading receipt…</Text>
            </View>
          )}

          {receiptDraft && (
            <View style={styles.parseResultCard}>
              {receiptDraft.reviewMessage && (
                <View style={styles.warningBanner}>
                  <Text style={styles.warningText}>{receiptDraft.reviewMessage}</Text>
                </View>
              )}
              <Text style={styles.label}>MERCHANT</Text>
              <TextInput style={styles.input} value={receiptMerchant} onChangeText={setReceiptMerchant} placeholderTextColor={colors.textMuted} />
              <Text style={[styles.label, { marginTop: spacing.md }]}>AMOUNT (₹)</Text>
              <TextInput style={styles.input} value={receiptAmount} onChangeText={setReceiptAmount} keyboardType="decimal-pad" placeholderTextColor={colors.textMuted} />
              <Text style={[styles.label, { marginTop: spacing.md }]}>CATEGORY</Text>
              <TextInput style={styles.input} value={receiptCategory} onChangeText={setReceiptCategory} placeholderTextColor={colors.textMuted} />

              <Pressable style={styles.submitButton} onPress={confirmReceiptExpense} disabled={createExpenseMutation.isPending}>
                <Text style={styles.submitButtonText}>{createExpenseMutation.isPending ? "Saving…" : "Confirm expense"}</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}

      <Modal visible={!!addPersonFor} transparent animationType="slide" onRequestClose={() => setAddPersonFor(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Who is "{addPersonFor}"?</Text>
            <Text style={styles.muted}>
              A phone number or email is required — this is the stable identity Speak2Split uses, never the name alone,
              so two people with the same name never get mixed up.
            </Text>
            <TextInput style={styles.input} placeholder="Full name" placeholderTextColor={colors.textMuted} value={addPersonName} onChangeText={setAddPersonName} />
            <TextInput style={styles.input} placeholder="Phone" placeholderTextColor={colors.textMuted} keyboardType="phone-pad" value={addPersonPhone} onChangeText={setAddPersonPhone} />
            <TextInput style={styles.input} placeholder="Email" placeholderTextColor={colors.textMuted} autoCapitalize="none" value={addPersonEmail} onChangeText={setAddPersonEmail} />
            <Pressable style={styles.submitButton} onPress={submitAddPerson} disabled={addingPerson}>
              <Text style={styles.submitButtonText}>{addingPerson ? "Adding…" : "Add & re-resolve"}</Text>
            </Pressable>
            <Pressable style={{ marginTop: spacing.md, alignItems: "center" }} onPress={() => setAddPersonFor(null)}>
              <Text style={styles.muted}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  title: { ...typography.display, fontSize: 26, color: colors.textPrimary },
  modeRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  modeChip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  modeChipActive: { backgroundColor: colors.accentMuted, borderColor: colors.accent },
  modeChipText: { color: colors.textSecondary, textTransform: "capitalize" },
  modeChipTextActive: { color: colors.accent, fontWeight: "700" },
  label: { ...typography.label, color: colors.textMuted, marginTop: spacing.lg },
  groupChip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, marginRight: spacing.sm },
  groupChipActive: { backgroundColor: colors.accentMuted, borderColor: colors.accent },
  groupChipText: { color: colors.textSecondary },
  groupChipTextActive: { color: colors.accent, fontWeight: "700" },
  input: { marginTop: spacing.sm, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: 14, color: colors.textPrimary, fontSize: 16 },
  participantRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.border },
  checkboxActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  participantName: { color: colors.textPrimary, fontSize: 15 },
  submitButton: { marginTop: spacing.xl, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: 16, alignItems: "center", width: "100%" },
  submitButtonText: { color: colors.bg, fontWeight: "700", fontSize: 16 },
  micButton: { width: 88, height: 88, borderRadius: radius.pill, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", marginTop: spacing.xl },
  micButtonActive: { backgroundColor: colors.negative },
  muted: { color: colors.textMuted, fontSize: 14, textAlign: "center" },
  parseResultCard: { marginTop: spacing.lg, backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, width: "100%" },
  parseResultTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: "700" },
  mentionRow: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  mentionLabel: { color: colors.textSecondary, fontSize: 13 },
  mentionResolved: { color: colors.positive, fontWeight: "600" },
  mentionAmbiguous: { color: colors.warning, fontWeight: "600" },
  mentionNotFound: { color: colors.negative },
  candidateChip: { backgroundColor: colors.accentMuted, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.pill, marginTop: spacing.xs, alignSelf: "flex-start" },
  candidateChipText: { color: colors.accent, fontSize: 13, fontWeight: "600" },
  modalOverlay: { flex: 1, backgroundColor: "#00000090", justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.bgElevated, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  modalTitle: { ...typography.title, color: colors.textPrimary, marginBottom: spacing.xs },
  receiptButtonRow: { flexDirection: "row", gap: spacing.md },
  receiptSourceButton: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  receiptSourceButtonText: { color: colors.textPrimary, fontWeight: "600" },
  warningBanner: { backgroundColor: colors.warning + "20", borderRadius: radius.sm, padding: spacing.sm, marginBottom: spacing.md },
  warningText: { color: colors.warning, fontSize: 13 },
});
