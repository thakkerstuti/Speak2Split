import { computeSettlementPlan, minimizeSettlements, computeNetBalances } from "../src/engine/balance-engine";

describe("balance engine", () => {
  it("computes net balances from paid/owed totals", () => {
    const balances = computeNetBalances([
      { userId: "a", totalPaid: 1000, totalOwed: 0 },
      { userId: "b", totalPaid: 0, totalOwed: 600 },
      { userId: "c", totalPaid: 0, totalOwed: 400 },
    ]);
    expect(balances.find((b) => b.userId === "a")!.netBalance).toBe(1000);
    expect(balances.find((b) => b.userId === "b")!.netBalance).toBe(-600);
    expect(balances.find((b) => b.userId === "c")!.netBalance).toBe(-400);
  });

  it("matches the exact spec scenario: A owed 1000, B owes 600, C owes 400", () => {
    const { settlements } = computeSettlementPlan([
      { userId: "A", totalPaid: 1000, totalOwed: 0 },
      { userId: "B", totalPaid: 0, totalOwed: 600 },
      { userId: "C", totalPaid: 0, totalOwed: 400 },
    ]);
    expect(settlements).toEqual(
      expect.arrayContaining([
        { fromUserId: "B", toUserId: "A", amount: 600 },
        { fromUserId: "C", toUserId: "A", amount: 400 },
      ])
    );
    expect(settlements).toHaveLength(2);
  });

  it("minimizes total transaction count for a more complex group (4 people)", () => {
    // A paid 4000 total for a group of 4 splitting equally (1000 each).
    // B paid 0, C paid 0, D paid extra to offset.
    const settlements = minimizeSettlements([
      { userId: "A", totalPaid: 4000, totalOwed: 1000, netBalance: 3000 },
      { userId: "B", totalPaid: 0, totalOwed: 1000, netBalance: -1000 },
      { userId: "C", totalPaid: 0, totalOwed: 1000, netBalance: -1000 },
      { userId: "D", totalPaid: 0, totalOwed: 1000, netBalance: -1000 },
    ]);
    // Minimal plan: exactly 3 transactions (B, C, D each pay A once).
    expect(settlements).toHaveLength(3);
    const totalSettled = settlements.reduce((s, x) => s + x.amount, 0);
    expect(totalSettled).toBe(3000);
  });

  it("produces zero settlements when everyone is already even", () => {
    const settlements = minimizeSettlements([
      { userId: "a", totalPaid: 500, totalOwed: 500, netBalance: 0 },
      { userId: "b", totalPaid: 500, totalOwed: 500, netBalance: 0 },
    ]);
    expect(settlements).toHaveLength(0);
  });

  it("throws if the ledger does not balance (data integrity guard)", () => {
    expect(() =>
      minimizeSettlements([
        { userId: "a", totalPaid: 0, totalOwed: 0, netBalance: 100 },
        { userId: "b", totalPaid: 0, totalOwed: 0, netBalance: -50 },
      ])
    ).toThrow(/does not balance/);
  });
});
