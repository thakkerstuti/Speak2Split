/**
 * Guarantees the mobile review screen previews EXACTLY what the server will
 * store. apps/mobile/lib/split.ts is loaded at runtime (not imported) so the
 * shared package's tsc build never pulls mobile code into its output.
 */
import path from "path";
import { calculateSplit } from "../src/engine/split-engine";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mobile = require(path.join(__dirname, "../../../apps/mobile/lib/split")) as {
  planSplit: (total: number, ids: string[], state: any) => any;
  equalShares: (total: number, n: number) => number[];
  payersMatchTotal: (payers: { amountPaid: number }[], total: number) => boolean;
};
const { planSplit, equalShares, payersMatchTotal } = mobile;

// Deterministic pseudo-random generator so failures are reproducible.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const ids = (n: number) => Array.from({ length: n }, (_, i) => `u${i}`);
const payer = (total: number) => [{ userId: "u0", amountPaid: total }];
const serverShares = (r: ReturnType<typeof calculateSplit>) => r.participants.map((p) => p.shareAmount);

describe("mobile split preview matches the server split engine", () => {
  const rand = rng(42);
  const totals = () => Math.round((1 + rand() * 50000) * 100) / 100;

  it("EQUAL: same per-person paise, same order (2,000 random cases)", () => {
    for (let i = 0; i < 2000; i++) {
      const total = totals();
      const people = ids(1 + Math.floor(rand() * 9));
      const plan = planSplit(total, people, { kind: "equal" });
      expect(plan.problem).toBeNull();
      expect(plan.submitMethod).toBe("EQUAL");
      expect(plan.participants).toEqual(people.map((userId) => ({ userId })));
      const server = calculateSplit(total, "EQUAL", payer(total), plan.participants);
      expect(people.map((id) => plan.shares[id])).toEqual(serverShares(server));
      expect(equalShares(total, people.length)).toEqual(serverShares(server));
    }
  });

  it("SHARES / PERCENTAGE: previewed amounts equal what the server computes for the same weights (2,000 cases)", () => {
    for (let i = 0; i < 2000; i++) {
      const total = totals();
      const people = ids(2 + Math.floor(rand() * 6));
      const units = people.map(() => 1 + Math.floor(rand() * 5));
      const weights = Object.fromEntries(people.map((id, k) => [id, units[k]]));
      const plan = planSplit(total, people, { kind: "weights", method: "SHARES", weights, fromAi: true });
      expect(plan.problem).toBeNull();
      const serverByShares = calculateSplit(
        total,
        "SHARES",
        payer(total),
        people.map((userId, k) => ({ userId, shareUnits: units[k] }))
      );
      expect(people.map((id) => plan.shares[id])).toEqual(serverShares(serverByShares));

      // And what we actually submit (EXACT with those amounts) is stored unchanged.
      expect(plan.submitMethod).toBe("EXACT");
      const stored = calculateSplit(total, "EXACT", payer(total), plan.participants);
      expect(serverShares(stored)).toEqual(people.map((id) => plan.shares[id]));
    }
  });

  it("PERCENTAGE that sums to 100 matches the server's PERCENTAGE split", () => {
    const plan = planSplit(1000, ["a", "b", "c"], { kind: "weights", method: "PERCENTAGE", weights: { a: 50, b: 30, c: 20 }, fromAi: true });
    const server = calculateSplit(1000, "PERCENTAGE", [{ userId: "a", amountPaid: 1000 }], [
      { userId: "a", percentage: 50 },
      { userId: "b", percentage: 30 },
      { userId: "c", percentage: 20 },
    ]);
    expect([plan.shares.a, plan.shares.b, plan.shares.c]).toEqual(serverShares(server));
    expect(plan.label).toBe("SPLIT BY %");
  });
});

describe("planSplit behaviour", () => {
  it("removing someone from a proportional split recalculates the rest and reports who was dropped", () => {
    const state = { kind: "weights", method: "PERCENTAGE", weights: { a: 50, b: 30, c: 20 }, fromAi: true };
    const plan = planSplit(1000, ["a", "b"], state);
    expect(plan.problem).toBeNull();
    expect(plan.shares).toEqual({ a: 625, b: 375 }); // 50:30 of 1000
    expect(plan.dropped).toEqual(["c"]);
    expect(calculateSplit(1000, "EXACT", payer(1000), plan.participants).participants.map((p) => p.shareAmount)).toEqual([625, 375]);
  });

  it("a spoken person who isn't matched yet is reported as dropped, not silently re-split", () => {
    const plan = planSplit(900, ["me"], { kind: "weights", method: "SHARES", weights: { me: 1, "mention:Priya": 2 }, fromAi: true });
    expect(plan.dropped).toEqual(["mention:Priya"]);
    expect(plan.shares).toEqual({ me: 900 });
  });

  it("fixed amounts are never rescaled: removing someone or changing the total requires the user to adjust", () => {
    const amounts = { a: 700, b: 300 };
    const removed = planSplit(1000, ["a"], { kind: "amounts", amounts, fromAi: true });
    expect(removed.problem).toEqual({ type: "unassigned", amount: 300 });
    expect(removed.shares).toEqual({ a: 700 });

    const totalUp = planSplit(1200, ["a", "b"], { kind: "amounts", amounts, fromAi: true });
    expect(totalUp.problem).toEqual({ type: "unassigned", amount: 200 });

    const totalDown = planSplit(900, ["a", "b"], { kind: "amounts", amounts, fromAi: true });
    expect(totalDown.problem).toEqual({ type: "over", amount: 100 });

    const ok = planSplit(1000, ["a", "b"], { kind: "amounts", amounts, fromAi: true });
    expect(ok.problem).toBeNull();
    expect(ok.participants).toEqual([
      { userId: "a", exactAmount: 700 },
      { userId: "b", exactAmount: 300 },
    ]);
  });

  it("percentages that don't add up to 100 (nobody removed) are flagged, not guessed", () => {
    const plan = planSplit(1000, ["a", "b"], { kind: "weights", method: "PERCENTAGE", weights: { a: 60, b: 30 }, fromAi: true });
    expect(plan.problem).toEqual({ type: "percent-sum", percent: 90 });
  });

  it("a selected person without a share in a proportional split is flagged", () => {
    const plan = planSplit(1000, ["a", "b", "c"], { kind: "weights", method: "SHARES", weights: { a: 1, b: 1 }, fromAi: true });
    expect(plan.problem).toEqual({ type: "missing-share", ids: ["c"] });
  });

  it("flags missing participants / invalid totals", () => {
    expect(planSplit(1000, [], { kind: "equal" }).problem).toEqual({ type: "no-participants" });
    expect(planSplit(NaN, ["a"], { kind: "equal" }).problem).toEqual({ type: "invalid-amount" });
    expect(planSplit(0, ["a"], { kind: "equal" }).problem).toEqual({ type: "invalid-amount" });
  });

  it("labels reflect the split actually being saved", () => {
    expect(planSplit(10, ["a"], { kind: "equal" }).label).toBe("SPLIT EQUALLY");
    expect(planSplit(10, ["a"], { kind: "weights", method: "SHARES", weights: { a: 1 }, fromAi: true }).label).toBe("SPLIT BY SHARES");
    expect(planSplit(10, ["a"], { kind: "amounts", amounts: { a: 10 }, fromAi: true }).label).toBe("SPLIT BY AMOUNT");
    expect(planSplit(10, ["a"], { kind: "amounts", amounts: { a: 10 }, fromAi: false }).label).toBe("CUSTOM AMOUNTS");
  });

  it("payersMatchTotal compares in paise", () => {
    expect(payersMatchTotal([{ amountPaid: 0.1 }, { amountPaid: 0.2 }], 0.3)).toBe(true);
    expect(payersMatchTotal([{ amountPaid: 500 }, { amountPaid: 400 }], 1000)).toBe(false);
  });
});
