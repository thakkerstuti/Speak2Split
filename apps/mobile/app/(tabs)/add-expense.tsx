import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ScrollView,
  Alert,
  ActivityIndicator,
  Animated,
  Easing,
} from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Mic,
  Camera,
  Edit3,
  Check,
  ChevronDown,
  Send,
  RotateCcw,
  Image as ImageIcon,
  AlertCircle,
  UserPlus,
  Sparkles,
  Users,
  Square,
} from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";
import { groupsApi, expensesApi, api, contactsApi, Group, CreateExpenseInput } from "../../lib/api";
import { useAuthStore } from "../../store/auth-store";
import { usePrefsStore } from "../../store/prefs-store";
import { useVoiceCapture } from "../../lib/useVoiceCapture";
import { colors, spacing, radius, fonts, shadows } from "../../lib/theme";
import { CATEGORIES, categoryMeta, equalShares, firstName, formatINR, normalizeCategory } from "../../lib/format";
import { planSplit, payersMatchTotal, SplitState, SplitProblem } from "../../lib/split";
import { Avatar, Button, Card, Chip, ScreenHeader, Sheet } from "../../components/ui";

type Mode = "voice" | "receipt" | "manual";

const MODES: { id: Mode; label: string; icon: any }[] = [
  { id: "voice", label: "Speak", icon: Mic },
  { id: "receipt", label: "Scan", icon: Camera },
  { id: "manual", label: "Type", icon: Edit3 },
];

const SELF = new Set(["me", "i", "myself"]);
const isSelf = (m: string) => SELF.has(m.trim().toLowerCase());

const EXAMPLES = [
  "Paid ₹1,200 for dinner with Rahul and Aisha",
  "Uber to the airport 650, split with Priya",
  "Electricity bill 2400 for the flat",
];

// ---------------------------------------------------------------------------
// Types for POST /expenses/parse
// ---------------------------------------------------------------------------

type Resolved =
  | { status: "RESOLVED"; userId?: string; displayName: string }
  | { status: "AMBIGUOUS"; promptMessage: string; candidates: { userId?: string; displayName: string }[] }
  | { status: "NOT_FOUND" };

interface ParseDraft {
  title: string;
  amount: number | null;
  category: string;
  payerMentions: { mention: string; amountPaid: number | null }[];
  participantMentions: string[];
  splitMethod: "EQUAL" | "EXACT" | "PERCENTAGE" | "SHARES";
  exactShares?: Record<string, number> | null;
  percentageShares?: Record<string, number> | null;
  shareUnits?: Record<string, number> | null;
  parseConfidence: number;
}

interface ParseResponse {
  draft: ParseDraft;
  resolvedMentions: Record<string, Resolved>;
  needsDisambiguation: boolean;
  groupId?: string;
  groupName?: string;
  groupInference?: {
    inferred: boolean;
    confidence: "high" | "medium" | "low";
    reason: string;
    alternatives: { groupId: string; groupName: string }[];
  };
}

/** The split the user spoke ("60/40", "Rahul 700, me 500"), keyed by spoken mention. */
type AiSplit = { method: "EXACT" | "PERCENTAGE" | "SHARES"; byMention: Record<string, number> } | null;

function extractAiSplit(draft: ParseDraft): AiSplit {
  const method = draft.splitMethod;
  const map =
    method === "EXACT" ? draft.exactShares : method === "PERCENTAGE" ? draft.percentageShares : method === "SHARES" ? draft.shareUnits : null;
  if (method === "EQUAL" || !map) return null;
  const byMention: Record<string, number> = {};
  for (const [mention, val] of Object.entries(map)) {
    if (typeof val === "number" && Number.isFinite(val)) byMention[mention] = val;
  }
  return Object.keys(byMention).length ? { method, byMention } : null;
}

/**
 * Maps the spoken split onto user ids using the CURRENT name resolution.
 * People not matched (yet) keep a `mention:<name>` key, so planSplit reports
 * them as "left out" instead of silently dropping or re-splitting them.
 */
function aiSplitState(ai: NonNullable<AiSplit>, rm: Record<string, Resolved>, myId: string): SplitState {
  const byKey: Record<string, number> = {};
  for (const [mention, v] of Object.entries(ai.byMention)) {
    const r = rm[mention];
    const uid = isSelf(mention) ? myId : r?.status === "RESOLVED" && r.userId ? r.userId : undefined;
    const key = uid ?? `mention:${mention}`;
    byKey[key] = (byKey[key] ?? 0) + v;
  }
  return ai.method === "EXACT"
    ? { kind: "amounts", amounts: byKey, fromAi: true }
    : { kind: "weights", method: ai.method, weights: byKey, fromAi: true };
}

function splitProblemText(p: SplitProblem, nameOfKey: (k: string) => string): string | null {
  switch (p.type) {
    case "unassigned":
      return `${formatINR(p.amount)} still needs to be assigned. Adjust the amounts below, or split equally.`;
    case "over":
      return `The amounts add up to ${formatINR(p.amount)} more than the total. Adjust them, or split equally.`;
    case "percent-sum":
      return `The percentages add up to ${p.percent}%, not 100%. Adjust the amounts, or split equally.`;
    case "missing-share":
      return `No share set for ${p.ids.map(nameOfKey).join(", ")}. Set their amount, or split equally.`;
    case "negative":
      return "Amounts can't be negative.";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function AddExpenseScreen() {
  const params = useLocalSearchParams<{ mode?: string; groupId?: string; autostart?: string }>();
  const groupHint = params.groupId && params.groupId.length > 0 ? params.groupId : undefined;
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const myId = me?.id ?? "";
  const { lastGroupId, load: loadPrefs, setLastGroupId } = usePrefsStore();

  const [mode, setMode] = useState<Mode>(
    params.mode === "receipt" || params.mode === "manual" ? (params.mode as Mode) : "voice"
  );
  useEffect(() => {
    if (params.mode === "voice" || params.mode === "receipt" || params.mode === "manual") setMode(params.mode);
  }, [params.mode]);
  useEffect(() => {
    loadPrefs();
  }, [loadPrefs]);

  const groupsQuery = useQuery({ queryKey: ["groups"], queryFn: groupsApi.list });
  const groups = groupsQuery.data ?? [];
  const defaultGroupId = useMemo(() => {
    if (groupHint) return groupHint;
    if (lastGroupId && groups.some((g) => g.id === lastGroupId)) return lastGroupId;
    return groups[0]?.id ?? null;
  }, [groupHint, lastGroupId, groups]);

  const afterSave = useCallback(
    (groupId: string) => {
      setLastGroupId(groupId);
      for (const key of [["expenses", groupId], ["balances", groupId], ["group", groupId]]) {
        queryClient.invalidateQueries({ queryKey: key });
      }
      for (const key of ["all-balances", "all-recent-expenses", "groups-balances-list"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
    [queryClient, setLastGroupId]
  );

  return (
    <View style={styles.container}>
      <ScreenHeader title="Add expense" large={false} onBack={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)"))} />
      <View style={styles.segment}>
        {MODES.map((m) => {
          const active = mode === m.id;
          return (
            <Pressable
              key={m.id}
              onPress={() => setMode(m.id)}
              style={[styles.segmentItem, active && styles.segmentItemActive]}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <m.icon color={active ? colors.primary : colors.textMuted} size={16} strokeWidth={2.4} />
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{m.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {groupsQuery.isSuccess && groups.length === 0 ? (
        <NoGroups onCreate={() => router.push("/(tabs)/groups")} />
      ) : mode === "voice" ? (
        <VoiceFlow
          groups={groups}
          groupHint={groupHint}
          fallbackGroupId={defaultGroupId}
          autostart={params.autostart}
          myId={myId}
          onSaved={afterSave}
        />
      ) : (
        <FormFlow
          key={mode}
          kind={mode}
          groups={groups}
          initialGroupId={defaultGroupId}
          myId={myId}
          onSaved={afterSave}
        />
      )}
    </View>
  );
}

function NoGroups({ onCreate }: { onCreate: () => void }) {
  return (
    <View style={{ padding: spacing.lg }}>
      <Card style={{ alignItems: "center", paddingVertical: spacing.xl }}>
        <View style={styles.noGroupIcon}>
          <Users color={colors.primary} size={26} />
        </View>
        <Text style={styles.bigTitle}>Create a group first</Text>
        <Text style={[styles.mutedCenter, { marginTop: 6 }]}>
          Expenses are split inside a group — flatmates, a trip, family. It takes five seconds.
        </Text>
        <Button label="Create a group" onPress={onCreate} style={{ marginTop: spacing.lg }} />
      </Card>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Voice flow: tap -> speak -> auto-stop -> transcribe -> understand -> review -> save
// ---------------------------------------------------------------------------

type VoicePhase = "idle" | "understanding" | "review" | "saved";

function VoiceFlow({
  groups,
  groupHint,
  fallbackGroupId,
  autostart,
  myId,
  onSaved,
}: {
  groups: Group[];
  groupHint?: string;
  fallbackGroupId: string | null;
  autostart?: string;
  myId: string;
  onSaved: (groupId: string) => void;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [transcript, setTranscript] = useState("");
  const [typed, setTyped] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);

  // Review state
  const [result, setResult] = useState<ParseResponse | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("general");
  const [mentions, setMentions] = useState<Record<string, Resolved>>({});
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [leftOut, setLeftOut] = useState<Set<string>>(new Set());
  const [addingOutsider, setAddingOutsider] = useState<string | null>(null);
  const [participantsAll, setParticipantsAll] = useState(true);
  const [participants, setParticipants] = useState<Set<string>>(new Set());
  const [payerId, setPayerId] = useState<string>(myId);
  const [multiPayers, setMultiPayers] = useState<{ userId: string; amountPaid: number }[] | null>(null);
  const [aiSplit, setAiSplit] = useState<AiSplit>(null);
  // "ai" = the split the user spoke (re-resolved as names change); otherwise an explicit split.
  const [splitMode, setSplitMode] = useState<"ai" | SplitState>({ kind: "equal" });
  const [groupSheet, setGroupSheet] = useState(false);
  const [payerSheet, setPayerSheet] = useState(false);
  const [addPersonFor, setAddPersonFor] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ title: string; amount: number; groupName: string; groupId: string } | null>(null);

  const parseSeq = useRef(0);

  const runParse = useCallback(
    async (text: string, opts: { groupId?: string; keepFields?: boolean } = {}) => {
      const seq = ++parseSeq.current;
      setParseError(null);
      setPhase("understanding");
      const requested = opts.groupId ?? groupHint;
      const call = (gid?: string) =>
        api.post<ParseResponse>("/expenses/parse", gid ? { groupId: gid, utterance: text } : { utterance: text }).then((r) => r.data);
      try {
        let data: ParseResponse;
        try {
          data = await call(requested);
        } catch (err: any) {
          // Older API without group inference requires groupId — retry with the default group.
          if (!requested && err?.response?.status === 400 && fallbackGroupId) data = await call(fallbackGroupId);
          else throw err;
        }
        if (seq !== parseSeq.current) return;

        const gid = data.groupId ?? requested ?? fallbackGroupId;
        const rm = data.resolvedMentions ?? {};
        const draft = data.draft;
        setResult(data);
        setGroupId(gid ?? null);
        setMentions(rm);
        setDismissed(new Set());
        setLeftOut(new Set());

        if (!opts.keepFields) {
          setTitle(draft.title && draft.title !== "Expense" ? draft.title : "");
          setAmount(draft.amount ? String(draft.amount) : "");
          setCategory(normalizeCategory(draft.category));
        }

        // Participants: who was named, or everyone in the group if nobody else was.
        const ids = new Set<string>();
        for (const m of draft.participantMentions ?? []) {
          if (isSelf(m)) ids.add(myId);
          else {
            const r = rm[m];
            if (r?.status === "RESOLVED" && r.userId) ids.add(r.userId);
          }
        }
        const othersMentioned = Object.keys(rm).length > 0;
        const ai = extractAiSplit(draft);
        setAiSplit(ai);
        setSplitMode(ai ? "ai" : { kind: "equal" });
        if (ai) {
          // Everyone named in the spoken split (plus anyone else mentioned).
          const st = aiSplitState(ai, rm, myId);
          const keys = Object.keys(st.kind === "amounts" ? st.amounts : st.kind === "weights" ? st.weights : {});
          setParticipantsAll(false);
          setParticipants(new Set([...keys.filter((k) => !k.startsWith("mention:")), ...ids]));
        } else if (!othersMentioned || ids.size === 0) {
          setParticipantsAll(true);
          setParticipants(new Set());
        } else {
          ids.add(myId);
          setParticipantsAll(false);
          setParticipants(ids);
        }

        // Payers: explicit multi-payer breakdown if it adds up, else first named payer, else me.
        const total = Number(draft.amount ?? 0);
        const payers: { userId: string; amountPaid: number }[] = [];
        for (const p of draft.payerMentions ?? []) {
          const r = rm[p.mention];
          const uid = isSelf(p.mention) ? myId : r?.status === "RESOLVED" ? r.userId : undefined;
          if (uid) payers.push({ userId: uid, amountPaid: Number(p.amountPaid ?? total) });
        }
        const sum = payers.reduce((s, p) => s + p.amountPaid, 0);
        if (payers.length > 1 && total > 0 && Math.abs(sum - total) < 0.01) {
          setMultiPayers(payers);
          setPayerId(payers[0].userId);
        } else {
          setMultiPayers(null);
          setPayerId(payers[0]?.userId ?? myId);
        }

        setPhase("review");
      } catch (err: any) {
        if (seq !== parseSeq.current) return;
        const code = err?.response?.data?.code;
        setParseError(
          code === "NO_GROUPS"
            ? "Create a group first — expenses are always split inside a group."
            : err?.response?.data?.error ?? "I couldn't understand that. Try rephrasing, or type it below."
        );
        setPhase("idle");
      }
    },
    [groupHint, fallbackGroupId, myId]
  );

  const capture = useVoiceCapture({
    onTranscript: (text) => {
      setTranscript(text);
      setTyped("");
      void runParse(text);
    },
  });

  const startListening = useCallback(() => {
    parseSeq.current++;
    setParseError(null);
    setResult(null);
    setSaved(null);
    setTranscript("");
    setPhase("idle");
    void capture.start();
  }, [capture.start]);

  // Center mic / quick actions pass a fresh `autostart` nonce -> start listening immediately.
  const lastAutostart = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (autostart && autostart !== lastAutostart.current) {
      lastAutostart.current = autostart;
      startListening();
    }
  }, [autostart, startListening]);

  // Never keep the mic open when the user leaves this screen.
  useFocusEffect(
    useCallback(() => {
      return () => {
        void capture.cancel();
      };
    }, [capture.cancel])
  );

  const submitTyped = () => {
    const text = typed.trim();
    if (!text) return;
    capture.reset();
    setTranscript(text);
    void runParse(text);
  };

  // ----- Review derived data -----
  const groupDetailQuery = useQuery({
    queryKey: ["group", groupId],
    queryFn: () => groupsApi.detail(groupId!),
    enabled: !!groupId && phase !== "idle",
  });
  const members = (groupDetailQuery.data?.members ?? []).filter((m) => m.status === "ACTIVE");
  const memberIds = members.map((m) => m.id);

  // Resolved people who aren't members of the chosen group. Saving never adds
  // anyone to a group implicitly (the API rejects it) — the user either adds
  // them explicitly or leaves them out.
  const outsiders = useMemo(() => {
    const out: { id: string; displayName: string }[] = [];
    if (!groupDetailQuery.data) return out;
    for (const r of Object.values(mentions)) {
      if (r.status === "RESOLVED" && r.userId && !memberIds.includes(r.userId) && !out.some((o) => o.id === r.userId)) {
        out.push({ id: r.userId, displayName: r.displayName });
      }
    }
    return out;
  }, [mentions, memberIds.join(","), !!groupDetailQuery.data]);
  const pendingOutsiders = outsiders.filter((o) => !leftOut.has(o.id));

  const people = useMemo(() => members.map((m) => ({ id: m.id, displayName: m.displayName })), [members]);
  const nameOf = (id: string) =>
    id === myId ? "You" : people.find((p) => p.id === id)?.displayName ?? outsiders.find((o) => o.id === id)?.displayName ?? "Someone";

  const selectedIds = participantsAll ? memberIds : [...participants].filter((id) => memberIds.includes(id));
  const effectivePayerId = memberIds.includes(payerId) ? payerId : myId;
  const validMultiPayers = multiPayers && multiPayers.every((p) => memberIds.includes(p.userId)) ? multiPayers : null;

  const addOutsider = async (o: { id: string; displayName: string }) => {
    if (!groupId) return;
    setAddingOutsider(o.id);
    try {
      await groupsApi.addMemberById(groupId, o.id);
      await groupDetailQuery.refetch();
    } catch (err: any) {
      Alert.alert(`Couldn't add ${firstName(o.displayName)}`, err?.response?.data?.error ?? "Please try again.");
    } finally {
      setAddingOutsider(null);
    }
  };
  const amountNum = Number(amount.replace(/,/g, ""));
  const validAmount = Number.isFinite(amountNum) && amountNum > 0;

  // Single source of truth: the plan's amounts are what the preview shows AND what Save submits.
  const effectiveSplit: SplitState =
    splitMode === "ai" ? (aiSplit ? aiSplitState(aiSplit, mentions, myId) : { kind: "equal" }) : splitMode;
  const plan = planSplit(validAmount ? amountNum : NaN, selectedIds, effectiveSplit);
  const shares = plan.shares;
  const nameOfKey = (k: string) => (k.startsWith("mention:") ? k.slice("mention:".length) : nameOf(k));
  const splitProblem = plan.problem ? splitProblemText(plan.problem, nameOfKey) : null;
  const droppedNote =
    !plan.problem && plan.dropped.length && effectiveSplit.kind === "weights"
      ? `Recalculated without ${plan.dropped.map(nameOfKey).join(", ")}. Everyone else keeps their proportion.`
      : null;

  // Payers must add up to the total — shown and saved the same way, never silently replaced.
  const multiPayersOk = !!validMultiPayers && validAmount && payersMatchTotal(validMultiPayers, amountNum);
  const payerProblem =
    validMultiPayers && validAmount && !multiPayersOk
      ? `Payments add up to ${formatINR(validMultiPayers.reduce((s, p) => s + p.amountPaid, 0))}, not ${formatINR(amountNum)}. Tap to choose who paid.`
      : null;

  const snapshotAmounts = () => Object.fromEntries(selectedIds.map((sid) => [sid, shares[sid] ?? 0])) as Record<string, number>;
  const editShare = (id: string, value: number) =>
    setSplitMode({ kind: "amounts", amounts: { ...snapshotAmounts(), [id]: value }, fromAi: false });
  const hasShareFor = (id: string) =>
    effectiveSplit.kind === "equal" ||
    (effectiveSplit.kind === "weights" ? effectiveSplit.weights[id] > 0 : effectiveSplit.amounts[id] !== undefined);

  /** Adding people to a non-equal split is an explicit choice — never a silent switch to equal. */
  const includePeople = (ids: string[], onDone: () => void) => {
    const missing = ids.filter((id) => !hasShareFor(id));
    if (missing.length === 0) return onDone();
    const who = missing.length === 1 ? firstName(nameOf(missing[0])) : `${missing.length} people`;
    Alert.alert(`Add ${who} to this split?`, "This split isn't equal, so choose how to include them.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Split equally",
        onPress: () => {
          setSplitMode({ kind: "equal" });
          onDone();
        },
      },
      {
        text: "Set amounts myself",
        onPress: () => {
          const amounts = snapshotAmounts();
          for (const id of missing) amounts[id] = 0;
          setSplitMode({ kind: "amounts", amounts, fromAi: false });
          onDone();
        },
      },
    ]);
  };

  const pendingMentions = Object.entries(mentions).filter(([m, r]) => r.status !== "RESOLVED" && !dismissed.has(m));
  const ambiguousLeft = pendingMentions.filter(([, r]) => r.status === "AMBIGUOUS");

  const toggleParticipant = (id: string) => {
    const base = new Set(selectedIds);
    if (base.has(id)) {
      // Removing someone: the plan recalculates (proportional splits rescale;
      // fixed amounts show what's left to assign) — nothing is silently replaced.
      base.delete(id);
      setParticipantsAll(false);
      setParticipants(base);
      return;
    }
    includePeople([id], () => {
      base.add(id);
      setParticipantsAll(false);
      setParticipants(base);
    });
  };

  const selectEveryone = () =>
    includePeople(
      memberIds.filter((id) => !selectedIds.includes(id)),
      () => setParticipantsAll(true)
    );

  const resolveCandidate = (mention: string, c: { userId?: string; displayName: string }) => {
    if (!c.userId) return;
    setMentions((prev) => ({ ...prev, [mention]: { status: "RESOLVED", userId: c.userId, displayName: c.displayName } }));
    const base = new Set(participantsAll ? memberIds : participants);
    base.add(c.userId);
    base.add(myId);
    setParticipantsAll(false);
    setParticipants(base);
  };

  const createMutation = useMutation({
    mutationFn: (input: CreateExpenseInput) => expensesApi.create(input),
    onSuccess: (_d, input) => {
      onSaved(input.groupId);
      const groupName = groups.find((g) => g.id === input.groupId)?.name ?? result?.groupName ?? "your group";
      setSaved({ title: input.title, amount: input.amount, groupName, groupId: input.groupId });
      setPhase("saved");
    },
    onError: (err: any) => Alert.alert("Couldn't save", err?.response?.data?.error ?? "Please try again."),
  });

  const blocked = ambiguousLeft.length > 0 || pendingOutsiders.length > 0 || !!payerProblem || !!plan.problem;

  const save = () => {
    if (!groupId || !validAmount || selectedIds.length === 0 || blocked) return;
    const payers = multiPayersOk ? validMultiPayers! : [{ userId: effectivePayerId, amountPaid: amountNum }];
    createMutation.mutate({
      groupId,
      title: title.trim() || result?.draft.title || categoryMeta(category).label,
      amount: amountNum,
      category,
      // Exactly what the review card shows: EQUAL (same rounding as the server)
      // or EXACT with the previewed per-person amounts.
      splitMethod: plan.submitMethod,
      payers,
      participants: plan.participants,
      source: "VOICE",
      aiRawInput: transcript,
      aiConfidence: result?.draft.parseConfidence ?? undefined,
    });
  };

  const currentGroupName = groups.find((g) => g.id === groupId)?.name ?? result?.groupName ?? "Choose group";
  const inference = result?.groupInference;
  const listening = capture.state === "listening";
  const transcribing = capture.state === "transcribing";
  const busy = listening || transcribing || phase === "understanding";

  // ----- Saved -----
  if (phase === "saved" && saved) {
    return (
      <ScrollView contentContainerStyle={styles.body}>
        <Card style={{ alignItems: "center", paddingVertical: spacing.xl }}>
          <View style={styles.successBadge}>
            <Check color={colors.onDark} size={34} strokeWidth={3} />
          </View>
          <Text style={styles.successAmount}>{formatINR(saved.amount)}</Text>
          <Text style={styles.bigTitle}>{saved.title}</Text>
          <Text style={[styles.mutedCenter, { marginTop: 4 }]}>Added to {saved.groupName}</Text>
        </Card>
        <Button label="Add another" icon={Mic} onPress={startListening} style={{ marginTop: spacing.lg }} />
        <Button
          label="View group"
          variant="secondary"
          onPress={() => router.push(`/(tabs)/groups/${saved.groupId}`)}
          style={{ marginTop: spacing.sm }}
        />
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      {/* ---------- Capture area ---------- */}
      {phase !== "review" ? (
        <View style={{ alignItems: "center", paddingTop: spacing.md }}>
          <VoiceOrb
            state={listening ? "listening" : busy ? "busy" : "idle"}
            level={capture.level}
            onPress={listening ? capture.stop : busy ? undefined : startListening}
          />
          <Text style={styles.orbTitle}>
            {listening ? "Listening…" : transcribing ? "Transcribing…" : phase === "understanding" ? "Understanding…" : "Tap and say it"}
          </Text>
          <Text style={styles.orbSubtitle}>
            {listening
              ? capture.autoStop
                ? `I'll stop when you finish · ${Math.floor(capture.elapsedMs / 1000)}s`
                : `Tap the mic when you're done · ${Math.floor(capture.elapsedMs / 1000)}s`
              : busy
              ? "Working out the amount, people and group"
              : "No need to pick a group — I'll figure it out"}
          </Text>

          {listening ? (
            <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg }}>
              <Button label="Cancel" variant="secondary" size="md" full={false} onPress={() => capture.cancel()} style={{ paddingHorizontal: spacing.lg }} />
              <Button label="Done" icon={Square} size="md" full={false} onPress={capture.stop} style={{ paddingHorizontal: spacing.lg }} />
            </View>
          ) : null}

          {transcript && busy ? (
            <View style={styles.transcriptBubble}>
              <Text style={styles.transcriptText}>“{transcript}”</Text>
            </View>
          ) : null}

          {(capture.error || parseError) && !busy ? (
            <View style={styles.errorCard}>
              <AlertCircle color={colors.negativeDark} size={18} />
              <Text style={styles.errorText}>{capture.error ?? parseError}</Text>
            </View>
          ) : null}

          {!busy ? (
            <>
              {!capture.error && !parseError ? (
                <View style={{ alignSelf: "stretch", marginTop: spacing.xl }}>
                  <Text style={styles.label}>TRY SAYING</Text>
                  {EXAMPLES.map((ex) => (
                    <Pressable key={ex} onPress={() => setTyped(ex)} style={styles.exampleRow}>
                      <Sparkles color={colors.primary} size={14} />
                      <Text style={styles.exampleText}>{ex}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              <View style={styles.typeRow}>
                <TextInput
                  style={styles.typeInput}
                  placeholder="…or type it here"
                  placeholderTextColor={colors.textMuted}
                  value={typed}
                  onChangeText={setTyped}
                  onSubmitEditing={submitTyped}
                  returnKeyType="send"
                />
                <Pressable
                  onPress={submitTyped}
                  disabled={!typed.trim()}
                  style={[styles.sendButton, !typed.trim() && { opacity: 0.4 }]}
                  accessibilityLabel="Understand typed expense"
                >
                  <Send color={colors.onDark} size={18} />
                </Pressable>
              </View>
            </>
          ) : null}
        </View>
      ) : null}

      {/* ---------- Review ---------- */}
      {phase === "review" && result ? (
        <View>
          <Pressable style={styles.transcriptBubble} onPress={() => { setTyped(transcript); setPhase("idle"); }}>
            <Text style={styles.transcriptText}>“{transcript}”</Text>
            <Text style={styles.transcriptEdit}>Edit</Text>
          </Pressable>

          <Card style={{ marginTop: spacing.md }}>
            {/* Group */}
            <Pressable style={styles.groupRow} onPress={() => setGroupSheet(true)} accessibilityLabel="Change group">
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>GROUP</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
                  <Text style={styles.groupName} numberOfLines={1}>{currentGroupName}</Text>
                  <ChevronDown color={colors.textSecondary} size={18} />
                </View>
                {inference?.inferred ? (
                  <Text style={[styles.inferenceText, inference.confidence === "low" && { color: "#B45309" }]}>
                    {inference.confidence === "low" ? `Best guess · ${inference.reason}. Tap to change.` : inference.reason}
                  </Text>
                ) : null}
              </View>
            </Pressable>

            {/* Amount */}
            <View style={styles.amountRow}>
              <Text style={styles.amountCurrency}>₹</Text>
              <TextInput
                style={styles.amountInput}
                value={amount}
                onChangeText={(t) => setAmount(t.replace(/[^0-9.]/g, ""))}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={colors.textMuted}
                accessibilityLabel="Amount"
              />
            </View>
            <TextInput
              style={styles.titleInput}
              value={title}
              onChangeText={setTitle}
              placeholder="What was it for?"
              placeholderTextColor={colors.textMuted}
              accessibilityLabel="Title"
            />

            <CategoryPicker value={category} onChange={setCategory} />
          </Card>

          {/* Attention items */}
          {pendingMentions.map(([mention, r]) => (
            <Card key={mention} style={[styles.attentionCard, r.status === "AMBIGUOUS" ? styles.attentionWarn : styles.attentionInfo]}>
              {r.status === "AMBIGUOUS" ? (
                <>
                  <Text style={styles.attentionTitle}>Which {mention} did you mean?</Text>
                  <View style={styles.chipWrap}>
                    {r.candidates.map((c) => (
                      <Chip key={`${c.userId}-${c.displayName}`} label={c.displayName} left={<Avatar name={c.displayName} size={20} />} onPress={() => resolveCandidate(mention, c)} />
                    ))}
                    <Chip label="Leave out" onPress={() => setDismissed((d) => new Set(d).add(mention))} />
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.attentionTitle}>{mention} isn't in {currentGroupName} yet</Text>
                  <Text style={styles.attentionBody}>Add them so they share this expense, or leave them out.</Text>
                  <View style={styles.chipWrap}>
                    <Chip label={`Add ${mention}`} icon={UserPlus} onPress={() => setAddPersonFor(mention)} />
                    <Chip label="Leave out" onPress={() => setDismissed((d) => new Set(d).add(mention))} />
                  </View>
                </>
              )}
            </Card>
          ))}

          {pendingOutsiders.map((o) => (
            <Card key={o.id} style={[styles.attentionCard, styles.attentionInfo]}>
              <Text style={styles.attentionTitle}>{o.displayName} isn't in {currentGroupName} yet</Text>
              <Text style={styles.attentionBody}>Add them to the group so they can share this, or leave them out.</Text>
              <View style={styles.chipWrap}>
                <Chip
                  label={addingOutsider === o.id ? "Adding…" : "Add to group"}
                  icon={UserPlus}
                  onPress={addingOutsider ? undefined : () => void addOutsider(o)}
                />
                <Chip label="Leave out" onPress={() => setLeftOut((s) => new Set(s).add(o.id))} />
              </View>
            </Card>
          ))}

          {/* Paid by + split */}
          <Card style={{ marginTop: spacing.md }}>
            <Pressable style={styles.paidByRow} onPress={() => setPayerSheet(true)} disabled={people.length === 0}>
              <Text style={styles.label}>PAID BY</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 6 }}>
                {validMultiPayers ? (
                  <Text style={[styles.paidByName, !!payerProblem && { color: "#B45309" }]}>
                    {validMultiPayers.map((p) => `${firstName(nameOf(p.userId))} ${formatINR(p.amountPaid)}`).join(" · ")}
                  </Text>
                ) : (
                  <>
                    <Avatar name={nameOf(effectivePayerId)} size={26} />
                    <Text style={styles.paidByName}>{nameOf(effectivePayerId)}</Text>
                    <ChevronDown color={colors.textSecondary} size={16} />
                  </>
                )}
              </View>
              {payerProblem ? <Text style={styles.splitWarnText}>{payerProblem}</Text> : null}
            </Pressable>

            <View style={styles.splitHeader}>
              <Text style={styles.label}>
                {plan.label} · {selectedIds.length} {selectedIds.length === 1 ? "PERSON" : "PEOPLE"}
              </Text>
              {memberIds.some((id) => !selectedIds.includes(id)) ? (
                <Pressable onPress={selectEveryone} hitSlop={8}>
                  <Text style={styles.linkText}>Everyone</Text>
                </Pressable>
              ) : null}
            </View>

            {groupDetailQuery.isLoading ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.md }} />
            ) : (
              <ParticipantList
                people={people}
                selected={new Set(selectedIds)}
                shares={shares}
                myId={myId}
                onToggle={toggleParticipant}
                onEditShare={editShare}
              />
            )}

            {splitProblem ? (
              <View style={styles.splitWarn}>
                <AlertCircle color="#B45309" size={16} />
                <Text style={styles.splitWarnText}>{splitProblem}</Text>
              </View>
            ) : droppedNote ? (
              <Text style={styles.splitNote}>{droppedNote}</Text>
            ) : effectiveSplit.kind === "equal" ? (
              <Text style={styles.splitNote}>Tap an amount to change someone's share.</Text>
            ) : null}

            <View style={styles.chipWrap}>
              {effectiveSplit.kind !== "equal" ? (
                <Chip label="Split equally instead" onPress={() => setSplitMode({ kind: "equal" })} />
              ) : null}
              {aiSplit && splitMode !== "ai" ? <Chip label="Use the split you said" onPress={() => setSplitMode("ai")} /> : null}
            </View>
          </Card>

          <Button
            label={
              ambiguousLeft.length > 0
                ? `Choose who ${ambiguousLeft[0][0]} is`
                : pendingOutsiders.length > 0
                ? `Add or leave out ${firstName(pendingOutsiders[0].displayName)}`
                : !validAmount
                ? "Enter an amount"
                : selectedIds.length === 0
                ? "Pick who's splitting"
                : payerProblem
                ? "Fix who paid"
                : plan.problem
                ? "Fix the split to save"
                : `Save ${formatINR(amountNum)}`
            }
            icon={Check}
            onPress={save}
            loading={createMutation.isPending}
            disabled={!groupId || !validAmount || selectedIds.length === 0 || blocked}
            style={{ marginTop: spacing.lg }}
          />
          <Button label="Record again" icon={RotateCcw} variant="ghost" onPress={startListening} style={{ marginTop: spacing.xs }} />
        </View>
      ) : null}

      <GroupPickerSheet
        visible={groupSheet}
        groups={groups}
        selectedId={groupId}
        suggestedId={inference?.inferred ? result?.groupId : undefined}
        onClose={() => setGroupSheet(false)}
        onSelect={(gid) => {
          setGroupSheet(false);
          if (gid !== groupId) void runParse(transcript, { groupId: gid, keepFields: true });
        }}
      />

      <Sheet visible={payerSheet} onClose={() => setPayerSheet(false)} title="Who paid?">
        <ScrollView style={{ maxHeight: 420 }}>
          {people.map((p) => (
            <Pressable
              key={p.id}
              style={styles.pickRow}
              onPress={() => {
                setPayerId(p.id);
                setMultiPayers(null);
                setPayerSheet(false);
              }}
            >
              <Avatar name={p.displayName} size={34} />
              <Text style={styles.pickRowText}>{p.id === myId ? "You" : p.displayName}</Text>
              {effectivePayerId === p.id && !validMultiPayers ? <Check color={colors.primary} size={20} /> : null}
            </Pressable>
          ))}
        </ScrollView>
      </Sheet>

      <AddPersonSheet
        mention={addPersonFor}
        groupId={groupId}
        onClose={() => setAddPersonFor(null)}
        onAdded={() => {
          setAddPersonFor(null);
          if (groupId) void runParse(transcript, { groupId, keepFields: true });
        }}
      />
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Manual + receipt flow
// ---------------------------------------------------------------------------

function FormFlow({
  kind,
  groups,
  initialGroupId,
  myId,
  onSaved,
}: {
  kind: "manual" | "receipt";
  groups: Group[];
  initialGroupId: string | null;
  myId: string;
  onSaved: (groupId: string) => void;
}) {
  const router = useRouter();
  const [groupId, setGroupId] = useState<string | null>(initialGroupId);
  useEffect(() => {
    if (!groupId && initialGroupId) setGroupId(initialGroupId);
  }, [initialGroupId]);

  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("general");
  const [participantsAll, setParticipantsAll] = useState(true);
  const [participants, setParticipants] = useState<Set<string>>(new Set());
  const [payerId, setPayerId] = useState(myId);
  const [groupSheet, setGroupSheet] = useState(false);
  const [payerSheet, setPayerSheet] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState<{ reviewMessage?: string | null } | null>(null);

  const groupDetailQuery = useQuery({
    queryKey: ["group", groupId],
    queryFn: () => groupsApi.detail(groupId!),
    enabled: !!groupId,
  });
  const members = (groupDetailQuery.data?.members ?? []).filter((m) => m.status === "ACTIVE");
  const memberIds = members.map((m) => m.id);
  const people = members.map((m) => ({ id: m.id, displayName: m.displayName }));
  const nameOf = (id: string) => (id === myId ? "You" : people.find((p) => p.id === id)?.displayName ?? "You");
  const selectedIds = participantsAll ? memberIds : [...participants].filter((id) => memberIds.includes(id));
  const amountNum = Number(amount.replace(/,/g, ""));
  const validAmount = Number.isFinite(amountNum) && amountNum > 0;
  const shares = useMemo(() => {
    const out: Record<string, number> = {};
    if (validAmount) equalShares(amountNum, selectedIds.length).forEach((v, i) => (out[selectedIds[i]] = v));
    return out;
  }, [validAmount, amountNum, selectedIds.join(",")]);

  const toggleParticipant = (id: string) => {
    const base = new Set(participantsAll ? memberIds : participants);
    if (base.has(id)) base.delete(id);
    else base.add(id);
    setParticipantsAll(false);
    setParticipants(base);
  };

  const createMutation = useMutation({
    mutationFn: (input: CreateExpenseInput) => expensesApi.create(input),
    onSuccess: (_d, input) => {
      onSaved(input.groupId);
      Alert.alert("Expense added", `${input.title} · ${formatINR(input.amount)}`, [
        { text: "Add another", onPress: () => { setTitle(""); setAmount(""); setScanned(null); } },
        { text: "View group", onPress: () => router.push(`/(tabs)/groups/${input.groupId}`) },
      ]);
    },
    onError: (err: any) => Alert.alert("Couldn't save", err?.response?.data?.error ?? "Please try again."),
  });

  const save = () => {
    if (!groupId || !validAmount || selectedIds.length === 0) return;
    createMutation.mutate({
      groupId,
      title: title.trim() || categoryMeta(category).label,
      amount: amountNum,
      category,
      splitMethod: "EQUAL",
      payers: [{ userId: payerId || myId, amountPaid: amountNum }],
      participants: selectedIds.map((userId) => ({ userId })),
      source: kind === "receipt" ? "RECEIPT_OCR" : "MANUAL",
    });
  };

  const scan = async (source: "camera" | "gallery") => {
    if (!groupId) {
      setGroupSheet(true);
      return;
    }
    const permission =
      source === "camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission needed", `Allow ${source === "camera" ? "camera" : "photo"} access in Settings to scan a receipt.`);
      return;
    }
    const picked =
      source === "camera"
        ? await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: true })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.7, allowsEditing: true });
    if (picked.canceled || !picked.assets?.[0]) return;

    setScanning(true);
    setScanned(null);
    try {
      const formData = new FormData();
      formData.append("image", { uri: picked.assets[0].uri, name: "receipt.jpg", type: "image/jpeg" } as unknown as Blob);
      formData.append("groupId", groupId);
      const { data } = await api.post("/receipts/scan", formData, {
        headers: { "Content-Type": "multipart/form-data" },
        transformRequest: (d) => d,
        timeout: 90000,
      });
      setScanned(data);
      setTitle(data.merchant ?? "");
      setAmount(data.amount ? String(data.amount) : "");
      setCategory(normalizeCategory(data.category));
    } catch (err: any) {
      Alert.alert("Couldn't read that receipt", err?.response?.data?.error ?? "Try a clearer photo, or type the expense.");
    } finally {
      setScanning(false);
    }
  };

  const showForm = kind === "manual" || !!scanned;
  const groupName = groups.find((g) => g.id === groupId)?.name ?? "Choose group";

  return (
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      {kind === "receipt" && !scanned ? (
        <View>
          <Text style={styles.bigTitle}>Scan a bill</Text>
          <Text style={[styles.muted, { marginTop: 4 }]}>I'll read the merchant and total. You can fix anything before saving.</Text>
          <View style={{ flexDirection: "row", gap: spacing.md, marginTop: spacing.lg }}>
            <ScanTile icon={Camera} label="Take photo" onPress={() => scan("camera")} disabled={scanning} />
            <ScanTile icon={ImageIcon} label="From gallery" onPress={() => scan("gallery")} disabled={scanning} />
          </View>
          {scanning ? (
            <View style={{ alignItems: "center", marginTop: spacing.xl }}>
              <ActivityIndicator color={colors.primary} size="large" />
              <Text style={[styles.muted, { marginTop: spacing.sm }]}>Reading your receipt…</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {scanned?.reviewMessage ? (
        <View style={[styles.errorCard, { backgroundColor: colors.warningSoft, borderColor: "#FDE68A", marginBottom: spacing.md }]}>
          <AlertCircle color="#B45309" size={18} />
          <Text style={[styles.errorText, { color: "#92400E" }]}>{scanned.reviewMessage}</Text>
        </View>
      ) : null}

      {showForm ? (
        <>
          <Card>
            <Pressable style={styles.groupRow} onPress={() => setGroupSheet(true)} accessibilityLabel="Change group">
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>GROUP</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
                  <Text style={styles.groupName} numberOfLines={1}>{groupName}</Text>
                  <ChevronDown color={colors.textSecondary} size={18} />
                </View>
              </View>
            </Pressable>
            <View style={styles.amountRow}>
              <Text style={styles.amountCurrency}>₹</Text>
              <TextInput
                style={styles.amountInput}
                value={amount}
                onChangeText={(t) => setAmount(t.replace(/[^0-9.]/g, ""))}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={colors.textMuted}
                autoFocus={kind === "manual"}
                accessibilityLabel="Amount"
              />
            </View>
            <TextInput
              style={styles.titleInput}
              value={title}
              onChangeText={setTitle}
              placeholder={kind === "receipt" ? "Merchant" : "What was it for?"}
              placeholderTextColor={colors.textMuted}
            />
            <CategoryPicker value={category} onChange={setCategory} />
          </Card>

          <Card style={{ marginTop: spacing.md }}>
            <Pressable style={styles.paidByRow} onPress={() => setPayerSheet(true)} disabled={people.length === 0}>
              <Text style={styles.label}>PAID BY</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 6 }}>
                <Avatar name={nameOf(payerId)} size={26} />
                <Text style={styles.paidByName}>{nameOf(payerId)}</Text>
                <ChevronDown color={colors.textSecondary} size={16} />
              </View>
            </Pressable>
            <View style={styles.splitHeader}>
              <Text style={styles.label}>
                SPLIT EQUALLY · {selectedIds.length} {selectedIds.length === 1 ? "PERSON" : "PEOPLE"}
              </Text>
              {!participantsAll ? (
                <Pressable onPress={() => setParticipantsAll(true)} hitSlop={8}>
                  <Text style={styles.linkText}>Everyone</Text>
                </Pressable>
              ) : null}
            </View>
            {groupDetailQuery.isLoading ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.md }} />
            ) : (
              <ParticipantList people={people} selected={new Set(selectedIds)} shares={shares} myId={myId} onToggle={toggleParticipant} />
            )}
          </Card>

          <Button
            label={!validAmount ? "Enter an amount" : selectedIds.length === 0 ? "Pick who's splitting" : `Save ${formatINR(amountNum)}`}
            icon={Check}
            onPress={save}
            loading={createMutation.isPending}
            disabled={!groupId || !validAmount || selectedIds.length === 0}
            style={{ marginTop: spacing.lg }}
          />
          {kind === "receipt" ? (
            <Button label="Scan another" icon={Camera} variant="ghost" onPress={() => setScanned(null)} style={{ marginTop: spacing.xs }} />
          ) : null}
        </>
      ) : null}

      <GroupPickerSheet
        visible={groupSheet}
        groups={groups}
        selectedId={groupId}
        onClose={() => setGroupSheet(false)}
        onSelect={(gid) => {
          setGroupSheet(false);
          setGroupId(gid);
          setParticipantsAll(true);
          setPayerId(myId);
        }}
      />
      <Sheet visible={payerSheet} onClose={() => setPayerSheet(false)} title="Who paid?">
        <ScrollView style={{ maxHeight: 420 }}>
          {people.map((p) => (
            <Pressable key={p.id} style={styles.pickRow} onPress={() => { setPayerId(p.id); setPayerSheet(false); }}>
              <Avatar name={p.displayName} size={34} />
              <Text style={styles.pickRowText}>{p.id === myId ? "You" : p.displayName}</Text>
              {payerId === p.id ? <Check color={colors.primary} size={20} /> : null}
            </Pressable>
          ))}
        </ScrollView>
      </Sheet>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function VoiceOrb({ state, level, onPress }: { state: "idle" | "listening" | "busy"; level: number; onPress?: () => void }) {
  const levelAnim = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(levelAnim, { toValue: state === "listening" ? level : 0, useNativeDriver: true, speed: 30, bounciness: 2 }).start();
  }, [level, state, levelAnim]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [breathe]);

  useEffect(() => {
    if (state !== "busy") return;
    spin.setValue(0);
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 1100, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [state, spin]);

  const outerScale = state === "listening"
    ? levelAnim.interpolate({ inputRange: [0, 1], outputRange: [1.05, 1.5] })
    : breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });
  const innerScale = state === "listening"
    ? levelAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.22] })
    : breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] });
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const tint = state === "listening" ? colors.negative : colors.primary;

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={state === "listening" ? "Stop recording" : "Start recording"}
      style={styles.orbWrap}
    >
      <Animated.View style={[styles.orbRing, { backgroundColor: tint + "14", transform: [{ scale: outerScale }] }]} />
      <Animated.View style={[styles.orbRingInner, { backgroundColor: tint + "26", transform: [{ scale: innerScale }] }]} />
      <View style={[styles.orb, { backgroundColor: tint, shadowColor: tint }]}>
        {state === "busy" ? (
          <Animated.View style={{ transform: [{ rotate }] }}>
            <View style={styles.spinner} />
          </Animated.View>
        ) : state === "listening" ? (
          <Square color={colors.onDark} size={30} fill={colors.onDark} />
        ) : (
          <Mic color={colors.onDark} size={38} strokeWidth={2.2} />
        )}
      </View>
    </Pressable>
  );
}

function CategoryPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingTop: spacing.md }}>
      {CATEGORIES.map((c) => {
        const active = normalizeCategory(value) === c.id;
        return (
          <Pressable
            key={c.id}
            onPress={() => onChange(c.id)}
            style={[styles.catChip, active && { backgroundColor: c.bg, borderColor: c.color }]}
            accessibilityState={{ selected: active }}
          >
            <c.icon color={active ? c.color : colors.textMuted} size={15} strokeWidth={2.4} />
            <Text style={[styles.catChipText, active && { color: c.color }]}>{c.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function ParticipantList({
  people,
  selected,
  shares,
  myId,
  onToggle,
  onEditShare,
}: {
  people: { id: string; displayName: string }[];
  selected: Set<string>;
  shares: Record<string, number>;
  myId: string;
  onToggle: (id: string) => void;
  /** When provided, selected people's amounts are editable (switches to a custom-amount split). */
  onEditShare?: (id: string, value: number) => void;
}) {
  if (people.length === 0) return <Text style={styles.muted}>No members found in this group.</Text>;
  return (
    <View style={{ marginTop: spacing.xs }}>
      {people.map((p) => {
        const on = selected.has(p.id);
        return (
          <Pressable key={p.id} onPress={() => onToggle(p.id)} style={styles.personRow} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
            <Avatar name={p.displayName} size={34} />
            <Text style={[styles.personName, !on && { color: colors.textMuted }]} numberOfLines={1}>
              {p.id === myId ? "You" : p.displayName}
            </Text>
            {on && onEditShare ? (
              <ShareInput key={`${p.id}:${shares[p.id] ?? 0}`} value={shares[p.id] ?? 0} onCommit={(v) => onEditShare(p.id, v)} />
            ) : (
              <Text style={[styles.personShare, !on && { color: colors.textMuted }]}>{on && shares[p.id] !== undefined ? formatINR(shares[p.id]) : "—"}</Text>
            )}
            <View style={[styles.checkbox, on && styles.checkboxOn]}>{on ? <Check color={colors.onDark} size={14} strokeWidth={3} /> : null}</View>
          </Pressable>
        );
      })}
    </View>
  );
}

function ShareInput({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  const commit = () => {
    const v = Number(text.replace(/,/g, ""));
    if (Number.isFinite(v) && v >= 0 && Math.round(v * 100) !== Math.round(value * 100)) onCommit(Math.round(v * 100) / 100);
    else setText(String(value));
  };
  return (
    <View style={styles.shareInputWrap}>
      <Text style={styles.shareInputCurrency}>₹</Text>
      <TextInput
        style={styles.shareInput}
        value={text}
        onChangeText={(t) => setText(t.replace(/[^0-9.]/g, ""))}
        onEndEditing={commit}
        onSubmitEditing={commit}
        keyboardType="decimal-pad"
        selectTextOnFocus
        accessibilityLabel="Share amount"
      />
    </View>
  );
}

function GroupPickerSheet({
  visible,
  groups,
  selectedId,
  suggestedId,
  onClose,
  onSelect,
}: {
  visible: boolean;
  groups: Group[];
  selectedId: string | null;
  suggestedId?: string;
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  return (
    <Sheet visible={visible} onClose={onClose} title="Which group?">
      <ScrollView style={{ maxHeight: 440 }}>
        {groups.map((g) => (
          <Pressable key={g.id} style={styles.pickRow} onPress={() => onSelect(g.id)}>
            <View style={styles.groupIcon}>
              <Users color={colors.primary} size={18} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.pickRowText} numberOfLines={1}>{g.name}</Text>
              {g.id === suggestedId ? <Text style={styles.suggestedText}>Suggested</Text> : null}
            </View>
            {selectedId === g.id ? <Check color={colors.primary} size={20} /> : null}
          </Pressable>
        ))}
      </ScrollView>
    </Sheet>
  );
}

function AddPersonSheet({
  mention,
  groupId,
  onClose,
  onAdded,
}: {
  mention: string | null;
  groupId: string | null;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (mention) {
      setName(mention);
      setPhone("");
      setEmail("");
    }
  }, [mention]);

  const submit = async () => {
    if (!phone.trim() && !email.trim()) {
      Alert.alert("Phone or email needed", "It keeps two people with the same name from getting mixed up.");
      return;
    }
    setBusy(true);
    try {
      await contactsApi.addPerson({ displayName: name.trim() || mention || "", phone: phone.trim() || undefined, email: email.trim() || undefined });
      if (groupId && email.trim()) await groupsApi.addMember(groupId, email.trim()).catch(() => {});
      onAdded();
    } catch (err: any) {
      Alert.alert("Couldn't add person", err?.response?.data?.error ?? "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      visible={!!mention}
      onClose={onClose}
      title={`Add ${mention ?? ""}`}
      subtitle="A phone number or email identifies them — names alone can clash. If they already use Speak2Split, adding their email puts them in this group."
    >
      <TextInput style={styles.sheetInput} placeholder="Full name" placeholderTextColor={colors.textMuted} value={name} onChangeText={setName} />
      <TextInput style={styles.sheetInput} placeholder="Phone" placeholderTextColor={colors.textMuted} keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
      <TextInput
        style={styles.sheetInput}
        placeholder="Email"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <Button label="Add person" onPress={submit} loading={busy} style={{ marginTop: spacing.lg }} />
    </Sheet>
  );
}

function ScanTile({ icon: Icon, label, onPress, disabled }: { icon: any; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.scanTile, pressed && { opacity: 0.8 }, disabled && { opacity: 0.5 }]}>
      <View style={styles.scanTileIcon}>
        <Icon color={colors.primary} size={26} />
      </View>
      <Text style={styles.scanTileText}>{label}</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  body: { padding: spacing.lg, paddingTop: spacing.md, paddingBottom: 140 },

  segment: {
    flexDirection: "row",
    marginHorizontal: spacing.lg,
    backgroundColor: colors.cardSecondary,
    borderRadius: radius.pill,
    padding: 4,
  },
  segmentItem: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: radius.pill },
  segmentItemActive: { backgroundColor: colors.card, ...shadows.sm },
  segmentText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.textMuted },
  segmentTextActive: { color: colors.primary, fontFamily: fonts.bold },

  orbWrap: { width: 200, height: 200, alignItems: "center", justifyContent: "center", marginTop: spacing.md },
  orbRing: { position: "absolute", width: 190, height: 190, borderRadius: 95 },
  orbRingInner: { position: "absolute", width: 146, height: 146, borderRadius: 73 },
  orb: {
    width: 108,
    height: 108,
    borderRadius: 54,
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  spinner: { width: 40, height: 40, borderRadius: 20, borderWidth: 4, borderColor: "rgba(255,255,255,0.35)", borderTopColor: colors.onDark },
  orbTitle: { fontFamily: fonts.extrabold, fontSize: 24, color: colors.textPrimary, marginTop: spacing.md, letterSpacing: -0.5 },
  orbSubtitle: { fontFamily: fonts.medium, fontSize: 14, color: colors.textSecondary, marginTop: 6, textAlign: "center" },

  transcriptBubble: {
    alignSelf: "stretch",
    marginTop: spacing.lg,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.md,
    borderTopLeftRadius: 6,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.primaryMuted,
  },
  transcriptText: { fontFamily: fonts.medium, fontSize: 15, color: colors.primaryDeep, lineHeight: 22 },
  transcriptEdit: { fontFamily: fonts.bold, fontSize: 12, color: colors.primary, marginTop: 6 },

  errorCard: {
    alignSelf: "stretch",
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "flex-start",
    marginTop: spacing.lg,
    backgroundColor: colors.negativeSoft,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.coralMuted,
  },
  errorText: { flex: 1, fontFamily: fonts.medium, fontSize: 14, color: colors.negativeDark, lineHeight: 20 },

  label: { fontFamily: fonts.bold, fontSize: 11, color: colors.textMuted, letterSpacing: 0.8 },
  exampleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  exampleText: { flex: 1, fontFamily: fonts.medium, fontSize: 14, color: colors.textSecondary },
  typeRow: { alignSelf: "stretch", flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  typeInput: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: 14,
    fontFamily: fonts.medium,
    fontSize: 15,
    color: colors.textPrimary,
  },
  sendButton: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },

  groupRow: { paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  groupName: { fontFamily: fonts.bold, fontSize: 17, color: colors.textPrimary, flexShrink: 1 },
  inferenceText: { fontFamily: fonts.medium, fontSize: 12, color: colors.positiveDark, marginTop: 4 },

  amountRow: { flexDirection: "row", alignItems: "center", marginTop: spacing.md },
  amountCurrency: { fontFamily: fonts.bold, fontSize: 32, color: colors.textMuted, marginRight: 4 },
  amountInput: { flex: 1, fontFamily: fonts.extrabold, fontSize: 40, color: colors.textPrimary, paddingVertical: 4, letterSpacing: -1 },
  titleInput: {
    fontFamily: fonts.semibold,
    fontSize: 17,
    color: colors.textPrimary,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  catChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  catChipText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.textSecondary },

  attentionCard: { marginTop: spacing.md },
  attentionWarn: { backgroundColor: "#FFFBEB", borderColor: "#FDE68A" },
  attentionInfo: { backgroundColor: colors.cardTinted },
  attentionTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.textPrimary },
  attentionBody: { fontFamily: fonts.regular, fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },

  paidByRow: { paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  paidByName: { fontFamily: fonts.bold, fontSize: 15, color: colors.textPrimary, flexShrink: 1 },
  splitHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.md },
  linkText: { fontFamily: fonts.bold, fontSize: 13, color: colors.primary },
  splitWarn: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "flex-start",
    backgroundColor: colors.warningSoft,
    borderRadius: radius.sm,
    padding: spacing.sm + 2,
    marginTop: spacing.sm,
  },
  splitWarnText: { flex: 1, fontFamily: fonts.medium, fontSize: 13, color: "#92400E", lineHeight: 18, marginTop: 4 },
  splitNote: { fontFamily: fonts.medium, fontSize: 12, color: colors.textSecondary, marginTop: spacing.sm, lineHeight: 17 },
  shareInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xs,
    paddingHorizontal: 8,
    minWidth: 92,
    backgroundColor: colors.cardTinted,
  },
  shareInputCurrency: { fontFamily: fonts.bold, fontSize: 14, color: colors.textMuted },
  shareInput: { flex: 1, fontFamily: fonts.bold, fontSize: 15, color: colors.textPrimary, paddingVertical: 6, paddingHorizontal: 4, textAlign: "right" },

  personRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: 10 },
  personName: { flex: 1, fontFamily: fonts.semibold, fontSize: 15, color: colors.textPrimary },
  personShare: { fontFamily: fonts.bold, fontSize: 15, color: colors.textPrimary },
  checkbox: { width: 24, height: 24, borderRadius: 8, borderWidth: 2, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },

  pickRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  pickRowText: { flex: 1, fontFamily: fonts.semibold, fontSize: 16, color: colors.textPrimary },
  groupIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.primaryLight, alignItems: "center", justifyContent: "center" },
  suggestedText: { fontFamily: fonts.bold, fontSize: 11, color: colors.positiveDark, marginTop: 2 },
  sheetInput: {
    marginTop: spacing.sm,
    backgroundColor: colors.cardTinted,
    borderRadius: radius.sm + 2,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    fontFamily: fonts.medium,
    fontSize: 15,
    color: colors.textPrimary,
  },

  successBadge: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.positive,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
    ...shadows.md,
  },
  successAmount: { fontFamily: fonts.extrabold, fontSize: 36, color: colors.textPrimary, letterSpacing: -1 },
  bigTitle: { fontFamily: fonts.bold, fontSize: 20, color: colors.textPrimary, textAlign: "center", letterSpacing: -0.3 },
  muted: { fontFamily: fonts.regular, fontSize: 14, color: colors.textSecondary, lineHeight: 20 },
  mutedCenter: { fontFamily: fonts.regular, fontSize: 14, color: colors.textSecondary, textAlign: "center", lineHeight: 20 },
  noGroupIcon: { width: 60, height: 60, borderRadius: 20, backgroundColor: colors.primaryLight, alignItems: "center", justifyContent: "center", marginBottom: spacing.md },

  scanTile: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.lg,
    alignItems: "center",
    ...shadows.sm,
  },
  scanTileIcon: { width: 56, height: 56, borderRadius: 18, backgroundColor: colors.primaryLight, alignItems: "center", justifyContent: "center" },
  scanTileText: { fontFamily: fonts.bold, fontSize: 15, color: colors.textPrimary, marginTop: spacing.sm },
});

