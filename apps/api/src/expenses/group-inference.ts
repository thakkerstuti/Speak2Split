/**
 * Group inference for voice/text expense entry.
 *
 * When the user speaks an expense without picking a group first, we score
 * every group they belong to and pick the most likely one. Pure function —
 * no DB access — so the ranking rules are unit-testable.
 *
 * Signals (strongest first):
 *   1. The group's name is spoken ("…for the Goa trip").
 *   2. People mentioned in the sentence resolve to members of that group.
 *   3. Recency: the group the user was most recently active in.
 */

export interface GroupSignal {
  groupId: string;
  groupName: string;
  /** Mentions that resolved (unambiguously) to a current member of this group. */
  memberMatches: number;
  /** Mentions that were ambiguous but at least one candidate is a member of this group. */
  ambiguousMemberMatches: number;
  /** Most recent activity (expense created) in this group, epoch ms; null if none. */
  lastActivityAt: number | null;
}

export interface RankedGroup {
  groupId: string;
  groupName: string;
  score: number;
}

export interface GroupInference {
  ranked: RankedGroup[];
  confidence: "high" | "medium" | "low";
  reason: string;
}

// Words too generic to identify a specific group on their own.
const GENERIC_GROUP_WORDS = new Set([
  "the", "and", "for", "our", "my", "group", "trip", "flat", "home", "house", "family", "friends",
  "team", "gang", "squad", "event", "couple", "custom", "expenses", "split",
]);

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function wordIn(text: string, word: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${escapeRegex(word)}([^a-z0-9]|$)`, "i").test(text);
}

/** 10 = full group name spoken, 6 = a distinctive word of it spoken, 0 = not mentioned. */
export function groupNameMentionScore(utterance: string, groupName: string): number {
  const text = utterance.toLowerCase();
  const name = groupName.trim().toLowerCase();
  if (name.length >= 3 && wordIn(text, name)) return 10;
  const tokens = name.split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !GENERIC_GROUP_WORDS.has(t));
  return tokens.some((t) => wordIn(text, t)) ? 6 : 0;
}

export function rankGroups(utterance: string, signals: GroupSignal[], now: number = Date.now()): GroupInference {
  if (signals.length === 0) return { ranked: [], confidence: "low", reason: "" };

  const scored = signals.map((s) => {
    const nameScore = groupNameMentionScore(utterance, s.groupName);
    const daysSince = s.lastActivityAt ? Math.max(0, (now - s.lastActivityAt) / 86_400_000) : 365;
    const recency = 1 / (1 + daysSince); // (0, 1] — only ever a tie-breaker
    return {
      signal: s,
      nameScore,
      score: nameScore + s.memberMatches * 3 + s.ambiguousMemberMatches * 1 + recency,
    };
  });
  scored.sort((a, b) => b.score - a.score);

  const top = scored[0];
  const second = scored[1];
  const ranked = scored.map((x) => ({ groupId: x.signal.groupId, groupName: x.signal.groupName, score: x.score }));

  if (signals.length === 1) {
    return { ranked, confidence: "high", reason: "Your only group" };
  }

  const margin = top.score - (second?.score ?? 0);
  let reason: string;
  if (top.nameScore > 0) reason = `You mentioned "${top.signal.groupName}"`;
  else if (top.signal.memberMatches > 0)
    reason = top.signal.memberMatches === 1 ? "The person you mentioned is in this group" : "The people you mentioned are in this group";
  else reason = "Your most recently active group";

  const strongSignal = top.nameScore > 0 || top.signal.memberMatches > 0;
  const confidence: GroupInference["confidence"] =
    strongSignal && margin >= 2 ? "high" : strongSignal && margin > 0.5 ? "medium" : "low";

  return { ranked, confidence, reason };
}
