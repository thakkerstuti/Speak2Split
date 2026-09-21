/**
 * Name Resolution Engine
 *
 * Resolves a raw name mention (e.g. "Vanshika", "van", speech-to-text
 * variants) extracted from natural language into a specific person,
 * scoped to the current user's context.
 *
 * Resolution priority (highest confidence first):
 *   1. Current group members
 *   2. Recently used participants in the current group
 *   3. Frequent contacts (globally, by frequencyScore)
 *   4. Broader contacts (fuzzy match across all contacts)
 *
 * Never silently resolves when there is meaningful ambiguity — instead
 * returns AMBIGUOUS with ranked candidates so the caller can ask
 * "Which Vanshika?" and show the real matching people.
 */

export interface ResolvionCandidate {
  contactId: string;
  userId?: string; // set if this contact maps to a registered user
  displayName: string;
  firstName: string;
  lastName?: string;
  source: "GROUP_MEMBER" | "RECENT_PARTICIPANT" | "FREQUENT_CONTACT" | "BROADER_CONTACT";
  isCurrentGroupMember: boolean;
  isRecentInGroup: boolean;
  frequencyScore: number;
  lastUsedAt?: Date;
  aliases: string[];
}

export type ResolutionOutcome =
  | { status: "RESOLVED"; candidate: ResolvionCandidate; confidence: number }
  | { status: "AMBIGUOUS"; candidates: ScoredCandidate[]; promptMessage: string }
  | { status: "NOT_FOUND"; rawInput: string };

export interface ScoredCandidate {
  candidate: ResolvionCandidate;
  score: number; // 0-1 confidence
}

const CONFIDENCE_RESOLVE_THRESHOLD = 0.72; // resolve automatically only above this
const AMBIGUITY_GAP_THRESHOLD = 0.15; // if top-2 scores are within this gap, treat as ambiguous

/**
 * Normalizes a name/alias for comparison: lowercase, strip diacritics,
 * collapse whitespace, drop punctuation.
 */
export function normalizeName(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Absolute edit-distance based fuzzy match, used to absorb minor spelling
 * variations and speech-to-text noise (e.g. "Vanshikaa" vs "Vanshika").
 * We deliberately use an ABSOLUTE distance threshold rather than a ratio:
 * a ratio-based score can make genuinely different short names (e.g.
 * "Vanshika" vs "Ishika") look deceptively similar. Real typos/STT noise
 * are almost always 1-2 character edits regardless of name length.
 */
function fuzzyMatchScore(a: string, b: string): number {
  if (a === b) return 1;
  const dist = levenshtein(a, b);
  const minLen = Math.min(a.length, b.length);
  if (minLen < 3) return 0; // too short to fuzzy-match reliably
  if (dist === 1) return 0.88;
  if (dist === 2 && minLen >= 5) return 0.75;
  return 0;
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

/**
 * Pure text-match score against a single candidate: similarity against
 * display name, first name, and known aliases. Deliberately excludes any
 * contextual/tier signal — tiering is handled separately in resolveName so
 * that "current group member" strictly shadows lower tiers, matching the
 * documented resolution priority, rather than being one weighted factor
 * among several that can be out-voted by a stronger text match elsewhere.
 */
function textMatchScore(rawInput: string, candidate: ResolvionCandidate): number {
  const normInput = normalizeName(rawInput);

  const textTargets = [
    candidate.firstName,
    candidate.displayName,
    ...(candidate.lastName ? [`${candidate.firstName} ${candidate.lastName}`] : []),
    ...candidate.aliases,
  ].map(normalizeName);

  let bestTextScore = 0;
  for (const target of textTargets) {
    // Minimum viable-length guard: don't let a 1-2 char alias match everything.
    if (normInput.length < 2 || target.length < 2) continue;

    if (target === normInput) {
      bestTextScore = Math.max(bestTextScore, 1);
      continue;
    }
    // Prefix match covers first-name-only mentions and short nicknames
    // ("Van" -> "Vanshika"), but only when the shorter string is a genuine
    // prefix of reasonable length, not a 1-letter coincidence.
    if (
      (target.startsWith(normInput) && normInput.length >= 2) ||
      (normInput.startsWith(target) && target.length >= 2)
    ) {
      bestTextScore = Math.max(bestTextScore, 0.9);
      continue;
    }
    bestTextScore = Math.max(bestTextScore, fuzzyMatchScore(normInput, target));
  }

  return bestTextScore;
}

/**
 * Derives the resolution tier directly from the candidate's contextual
 * flags rather than trusting a separately-set `source` label — the two
 * could otherwise drift out of sync if a caller populates one but not the
 * other. Lower number = higher priority, matching the documented order:
 * group members > recently used in this group > frequent contacts > everyone else.
 */
function tierOf(candidate: ResolvionCandidate): number {
  if (candidate.isCurrentGroupMember) return 0;
  if (candidate.isRecentInGroup) return 1;
  if (candidate.frequencyScore > 0) return 2;
  return 3;
}

const MIN_MATCH_SCORE = 0.5; // below this, a candidate is not a real match at all

/**
 * Main resolution entrypoint. `candidatePool` should already be scoped to
 * the resolution priority order described above (group members first,
 * recent participants next, frequent contacts, then broader contacts) —
 * upstream repository code is responsible for assembling this pool from
 * Postgres, tagging each candidate's `source`; this function is pure and
 * DB-free so it is fully unit-testable.
 *
 * Tiering rule: we find the highest-priority tier that contains at least
 * one textual match, and resolve/disambiguate *within that tier only*.
 * A lower tier never gets to outrank or dilute a higher-tier match — e.g.
 * an exact-name match against someone outside the group never competes
 * with an exact-name match against someone actually in the group.
 */
export function resolveName(rawInput: string, candidatePool: ResolvionCandidate[]): ResolutionOutcome {
  if (candidatePool.length === 0) {
    return { status: "NOT_FOUND", rawInput };
  }

  const allScored: ScoredCandidate[] = candidatePool
    .map((candidate) => ({ candidate, score: textMatchScore(rawInput, candidate) }))
    .filter((s) => s.score >= MIN_MATCH_SCORE);

  if (allScored.length === 0) {
    return { status: "NOT_FOUND", rawInput };
  }

  // Pick the highest-priority tier that has at least one match.
  const bestTier = Math.min(...allScored.map((s) => tierOf(s.candidate)));
  const tierMatches = allScored.filter((s) => tierOf(s.candidate) === bestTier);

  const scored = tierMatches.sort((a, b) => b.score - a.score);
  const top = scored[0];
  const second = scored[1];

  const isAmbiguous =
    scored.length > 1 && second.score >= MIN_MATCH_SCORE && top.score - second.score < AMBIGUITY_GAP_THRESHOLD;

  if (top.score >= CONFIDENCE_RESOLVE_THRESHOLD && !isAmbiguous) {
    return { status: "RESOLVED", candidate: top.candidate, confidence: top.score };
  }

  if (isAmbiguous) {
    const relevantCandidates = scored.slice(0, 5);
    const names = relevantCandidates.map((s) => s.candidate.displayName);
    const promptMessage = `Which ${rawInput}? ${names.join(", ")}`;
    return { status: "AMBIGUOUS", candidates: relevantCandidates, promptMessage };
  }

  // Single match but below the auto-resolve confidence bar — confirm rather
  // than silently commit, but we still know who we mean.
  if (scored.length === 1 && top.score >= MIN_MATCH_SCORE) {
    return {
      status: "AMBIGUOUS",
      candidates: scored,
      promptMessage: `Did you mean ${top.candidate.displayName}?`,
    };
  }

  return { status: "NOT_FOUND", rawInput };
}

/**
 * Batch-resolve every name mention extracted from an utterance in one pass,
 * returning a per-name outcome map so the caller can build a single
 * confirmation UI covering all ambiguities at once rather than asking
 * one-at-a-time.
 */
export function resolveNames(
  rawInputs: string[],
  candidatePool: ResolvionCandidate[]
): Record<string, ResolutionOutcome> {
  const results: Record<string, ResolutionOutcome> = {};
  for (const raw of rawInputs) {
    results[raw] = resolveName(raw, candidatePool);
  }
  return results;
}
