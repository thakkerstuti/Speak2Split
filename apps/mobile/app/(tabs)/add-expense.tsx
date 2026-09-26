import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, Alert, ActivityIndicator, Modal } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Mic, Square, Camera, Edit3, ArrowLeft } from "lucide-react-native";
import { Audio } from "expo-av";
import * as ImagePicker from "expo-image-picker";
import { groupsApi, expensesApi, api, contactsApi } from "../../lib/api";
import { useAuthStore } from "../../store/auth-store";
import { colors, spacing, radius, typography, fonts } from "../../lib/theme";

type Mode = "select" | "voice" | "receipt" | "manual";

const MODE_OPTIONS: { id: Mode; label: string; icon: any; desc: string }[] = [
  { id: "voice", label: "Voice", icon: Mic, desc: "Speak naturally (e.g. 'Paid 500 for dinner with Rahul')" },
  { id: "receipt", label: "Scan", icon: Camera, desc: "Scan receipt or bill photo using AI OCR" },
  { id: "manual", label: "Manual", icon: Edit3, desc: "Type title, amount, and pick participants manually" },
];

export default function AddExpenseScreen() {
  const { mode: modeParam, groupId: groupIdParam } = useLocalSearchParams<{ mode?: string; groupId?: string }>();
  const [mode, setMode] = useState<Mode>((modeParam as Mode) ?? "select");
  const router = useRouter();
  const queryClient = useQueryClient();

  const groupsQuery = useQuery({ queryKey: ["groups"], queryFn: groupsApi.list });
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(groupIdParam ?? null);

  useEffect(() => {
    if (modeParam && ["select", "voice", "receipt", "manual"].includes(modeParam)) {
      setMode(modeParam as Mode);
    }
  }, [modeParam]);

  useEffect(() => {
    if (groupIdParam) {
      setSelectedGroupId(groupIdParam);
    }
  }, [groupIdParam]);

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
      await parseUtterance();
    } catch (err: any) {
      Alert.alert("Couldn't add person", err?.response?.data?.error ?? "Try again.");
    } finally {
      setAddingPerson(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.xxl, paddingBottom: spacing.xxl + 40 }}>
      {/* Header Bar */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md }}>
        <Pressable style={{ flexDirection: "row", alignItems: "center", gap: 6 }} onPress={() => router.back()}>
          <ArrowLeft color={colors.textPrimary} size={20} />
          <Text style={{ fontFamily: fonts.semibold, color: colors.textPrimary, fontSize: 16 }}>Back</Text>
        </Pressable>
        <Text style={styles.title}>Add Expense</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Group Selector */}
      <Text style={styles.label}>SELECT GROUP</Text>
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

      {/* Initial 3 Options Selection View */}
      {mode === "select" ? (
        <View style={{ marginTop: spacing.xl, gap: spacing.md }}>
          <Text style={{ fontFamily: fonts.bold, fontSize: 18, color: colors.textPrimary, marginBottom: spacing.xs }}>
            Choose how to add your expense:
          </Text>

          {MODE_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            return (
              <Pressable key={opt.id} style={styles.optionCard} onPress={() => setMode(opt.id)}>
                <View style={styles.optionIconBadge}>
                  <Icon color={colors.primary} size={24} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.optionCardTitle}>{opt.label}</Text>
                  <Text style={styles.optionCardDesc}>{opt.desc}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <>
          {/* Mode Switcher Chips */}
          <View style={styles.modeRow}>
            {MODE_OPTIONS.map((opt) => (
              <Pressable
                key={opt.id}
                style={[styles.modeChip, mode === opt.id && styles.modeChipActive]}
                onPress={() => setMode(opt.id)}
              >
                <opt.icon color={mode === opt.id ? colors.onDark : colors.primary} size={16} />
                <Text style={[styles.modeChipText, mode === opt.id && styles.modeChipTextActive]}>{opt.label}</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}

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
            {isRecording ? <Square color={colors.onDark} size={28} /> : <Mic color={colors.onDark} size={28} />}
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
            {parsing ? <ActivityIndicator color={colors.onDark} /> : <Text style={styles.submitButtonText}>Parse</Text>}
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
              <ActivityIndicator color={colors.primary} />
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
  title: { ...typography.display, fontSize: 24, color: colors.textPrimary },
  modeRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  modeChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  modeChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  modeChipText: { color: colors.textSecondary, fontFamily: fonts.medium },
  modeChipTextActive: { color: colors.onDark, fontFamily: fonts.bold },
  label: { ...typography.label, color: colors.textMuted, marginTop: spacing.lg },
  groupChip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, marginRight: spacing.sm },
  groupChipActive: { backgroundColor: colors.primaryMuted, borderColor: colors.primary },
  groupChipText: { color: colors.textSecondary, fontFamily: fonts.medium },
  groupChipTextActive: { color: colors.primary, fontFamily: fonts.bold },
  optionCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  optionIconBadge: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: colors.primaryMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  optionCardTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 16 },
  optionCardDesc: { color: colors.textSecondary, fontFamily: fonts.medium, fontSize: 13, marginTop: 2 },
  input: { marginTop: spacing.sm, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: 14, color: colors.textPrimary, fontSize: 16, fontFamily: fonts.medium },
  participantRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.border },
  checkboxActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  participantName: { color: colors.textPrimary, fontSize: 15, fontFamily: fonts.medium },
  submitButton: { marginTop: spacing.xl, backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 16, alignItems: "center", width: "100%" },
  submitButtonText: { color: colors.onDark, fontFamily: fonts.bold, fontSize: 16 },
  micButton: { width: 88, height: 88, borderRadius: radius.pill, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", marginTop: spacing.xl },
  micButtonActive: { backgroundColor: colors.negative },
  muted: { color: colors.textMuted, fontSize: 14, textAlign: "center", fontFamily: fonts.regular },
  parseResultCard: { marginTop: spacing.lg, backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, width: "100%" },
  parseResultTitle: { color: colors.textPrimary, fontSize: 17, fontFamily: fonts.bold },
  mentionRow: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  mentionLabel: { color: colors.textSecondary, fontSize: 13, fontFamily: fonts.regular },
  mentionResolved: { color: colors.positive, fontFamily: fonts.semibold },
  mentionAmbiguous: { color: colors.warning, fontFamily: fonts.semibold },
  mentionNotFound: { color: colors.negative, fontFamily: fonts.medium },
  candidateChip: { backgroundColor: colors.primaryMuted, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.pill, marginTop: spacing.xs, alignSelf: "flex-start" },
  candidateChipText: { color: colors.primary, fontSize: 13, fontFamily: fonts.semibold },
  modalOverlay: { flex: 1, backgroundColor: "#00000090", justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.bgElevated, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  modalTitle: { ...typography.title, color: colors.textPrimary, marginBottom: spacing.xs },
  receiptButtonRow: { flexDirection: "row", gap: spacing.md },
  receiptSourceButton: { backgroundColor: colors.card, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  receiptSourceButtonText: { color: colors.textPrimary, fontFamily: fonts.semibold },
  warningBanner: { backgroundColor: colors.warning + "20", borderRadius: radius.sm, padding: spacing.sm, marginBottom: spacing.md },
  warningText: { color: colors.warning, fontSize: 13, fontFamily: fonts.medium },
});
