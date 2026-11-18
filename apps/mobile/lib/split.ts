/**
 * Client-side split planning for the review screen.
 *
 * Contract: the per-person amounts returned by planSplit() are EXACTLY what
 * gets saved. Equal splits are submitted as EQUAL with participants in the
 * same order the preview used — the rounding below mirrors
 * packages/shared/src/engine/split-engine.ts (leftover paise go to the first
 * people) so the server computes identical shares. Every other split is
 * submitted as EXACT with the previewed amounts, so the server stores what
 * the user saw, to the paisa.
 *
 * Pure TypeScript (no React Native imports) so it can be parity-tested
 * against the server engine from the shared package's test suite.
 */

const toMinor = (amount: number) => Math.round(amount * 100);
const toMajor = (minor: number) => Math.round(minor) / 100;

/** Mirrors split-engine distributeEqually: leftover paise go to the first participants. */
export function distributeEquallyMinor(totalMinor: number, count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(totalMinor / count);
  let remainder = totalMinor - base * count;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(base + (remainder > 0 ? 1 : 0));
    if (remainder > 0) remainder--;
  }
  return out;
}

/** Mirrors split-engine allocateByWeight: largest-remainder method, sums exactly to totalMinor. */
export function allocateByWeightMinor(totalMinor: number, weights: number[]): number[] {
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (totalMinor * w) / weightSum);
  const floors = raw.map((s) => Math.floor(s));
  const remaining = totalMinor - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((s, idx) => ({ idx, rem: s - Math.floor(s) })).sort((a, b) => b.rem - a.rem);
  const out = [...floors];
  for (let i = 0; i < remaining; i++) out[order[i % order.length].idx] += 1;
  return out;
}

/** Equal shares in rupees, same rounding as the server. */
export function equalShares(total: number, n: number): number[] {
  if (!Number.isFinite(total) || n <= 0) return [];
  return distributeEquallyMinor(toMinor(total), n).map(toMajor);
}

export type SplitState =
  | { kind: "equal" }
  /** Proportional split (from "60/40" or "2 shares each"). Keys are userIds, or `mention:<name>` for people not matched yet. */
  | { kind: "weights"; method: "PERCENTAGE" | "SHARES"; weights: Record<string, number>; fromAi: boolean }
  /** Fixed rupee amounts per person. Keys as above. */
  | { kind: "amounts"; amounts: Record<string, number>; fromAi: boolean };

export type SplitProblem =
  | { type: "no-participants" }
  | { type: "invalid-amount" }
  | { type: "unassigned"; amount: number } // amounts mode: total - sum > 0
  | { type: "over"; amount: number } // amounts mode: sum - total > 0
  | { type: "percent-sum"; percent: number } // percentages don't add up to 100 and nobody was removed
  | { type: "missing-share"; ids: string[] } // selected people with no weight in a proportional split
  | { type: "negative" };

export interface SplitPlan {
  /** userId -> rupees. What the preview shows === what is saved. */
  shares: Record<string, number>;
  submitMethod: "EQUAL" | "EXACT";
  participants: { userId: string; exactAmount?: number }[];
  problem: SplitProblem | null;
  /** Keys in the original split that are not part of it any more (recalculated without them). */
  dropped: string[];
  label: string;
}

export function planSplit(total: number, selectedIds: string[], state: SplitState): SplitPlan {
  const validTotal = Number.isFinite(total) && total > 0;
  const totalMinor = validTotal ? toMinor(total) : 0;
  const shares: Record<string, number> = {};
  const base = { dropped: [] as string[] };

  const label =
    state.kind === "equal"
      ? "SPLIT EQUALLY"
      : state.kind === "weights"
      ? state.method === "PERCENTAGE"
        ? "SPLIT BY %"
        : "SPLIT BY SHARES"
      : state.fromAi
      ? "SPLIT BY AMOUNT"
      : "CUSTOM AMOUNTS";

  const finish = (problem: SplitProblem | null, submitMethod: "EQUAL" | "EXACT", dropped: string[] = []): SplitPlan => ({
    shares,
    submitMethod,
    participants: selectedIds.map((userId) => (submitMethod === "EQUAL" ? { userId } : { userId, exactAmount: shares[userId] ?? 0 })),
    problem,
    dropped,
    label,
  });

  if (selectedIds.length === 0) return { ...finish({ type: "no-participants" }, "EQUAL"), ...base };
  if (!validTotal) return { ...finish({ type: "invalid-amount" }, "EQUAL"), ...base };

  if (state.kind === "equal") {
    distributeEquallyMinor(totalMinor, selectedIds.length).forEach((m, i) => (shares[selectedIds[i]] = toMajor(m)));
    return finish(null, "EQUAL");
  }

  const selected = new Set(selectedIds);

  if (state.kind === "weights") {
    const dropped = Object.keys(state.weights).filter((k) => !selected.has(k) && state.weights[k] > 0);
    const missing = selectedIds.filter((id) => !(state.weights[id] > 0));
    if (missing.length) {
      selectedIds.forEach((id) => (shares[id] = 0));
      return finish({ type: "missing-share", ids: missing }, "EXACT", dropped);
    }
    const ws = selectedIds.map((id) => state.weights[id]);
    if (state.method === "PERCENTAGE" && dropped.length === 0) {
      const pct = ws.reduce((a, b) => a + b, 0);
      if (Math.abs(pct - 100) > 0.01) {
        allocateByWeightMinor(totalMinor, ws).forEach((m, i) => (shares[selectedIds[i]] = toMajor(m)));
        return finish({ type: "percent-sum", percent: Math.round(pct * 100) / 100 }, "EXACT", dropped);
      }
    }
    // Proportional — removing someone recalculates the rest in proportion.
    allocateByWeightMinor(totalMinor, ws).forEach((m, i) => (shares[selectedIds[i]] = toMajor(m)));
    return finish(null, "EXACT", dropped);
  }

  // Fixed amounts: never rescaled behind the user's back.
  const dropped = Object.keys(state.amounts).filter((k) => !selected.has(k) && (state.amounts[k] ?? 0) !== 0);
  let sumMinor = 0;
  let negative = false;
  for (const id of selectedIds) {
    const v = state.amounts[id] ?? 0;
    if (v < 0) negative = true;
    shares[id] = toMajor(toMinor(v));
    sumMinor += toMinor(v);
  }
  if (negative) return finish({ type: "negative" }, "EXACT", dropped);
  const diff = totalMinor - sumMinor;
  if (diff > 0) return finish({ type: "unassigned", amount: toMajor(diff) }, "EXACT", dropped);
  if (diff < 0) return finish({ type: "over", amount: toMajor(-diff) }, "EXACT", dropped);
  return finish(null, "EXACT", dropped);
}

/** Validates a multi-payer breakdown against the total (both in paise). */
export function payersMatchTotal(payers: { amountPaid: number }[], total: number): boolean {
  return payers.reduce((s, p) => s + toMinor(p.amountPaid), 0) === toMinor(total);
}
