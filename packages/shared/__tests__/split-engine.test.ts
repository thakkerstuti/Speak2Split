import { calculateSplit, SplitValidationError } from "../src/engine/split-engine";

describe("split engine", () => {
  it("splits equally, distributing remainder pennies deterministically", () => {
    const result = calculateSplit(
      100,
      "EQUAL",
      [{ userId: "u1", amountPaid: 100 }],
      [{ userId: "u1" }, { userId: "u2" }, { userId: "u3" }]
    );
    const amounts = result.participants.map((p) => p.shareAmount);
    expect(amounts.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 2);
    // 100 / 3 = 33.33, 33.33, 33.34
    expect(amounts.sort()).toEqual([33.33, 33.33, 33.34]);
  });

  it("supports multi-payer expenses (Vanshika paid 1000, I paid 1500 for hotel)", () => {
    const result = calculateSplit(
      2500,
      "EQUAL",
      [
        { userId: "me", amountPaid: 1500 },
        { userId: "vanshika", amountPaid: 1000 },
      ],
      [{ userId: "me" }, { userId: "vanshika" }]
    );
    expect(result.payers.reduce((s, p) => s + p.amountPaid, 0)).toBe(2500);
    expect(result.participants.map((p) => p.shareAmount)).toEqual([1250, 1250]);
  });

  it("rejects payer amounts that don't sum to the total (never trusts client totals)", () => {
    expect(() =>
      calculateSplit(1000, "EQUAL", [{ userId: "u1", amountPaid: 900 }], [{ userId: "u1" }, { userId: "u2" }])
    ).toThrow(SplitValidationError);
  });

  it("supports exact split and rejects mismatched exact shares", () => {
    const ok = calculateSplit(
      2400,
      "EXACT",
      [{ userId: "me", amountPaid: 2400 }],
      [
        { userId: "me", exactAmount: 800 },
        { userId: "vanshika", exactAmount: 800 },
        { userId: "ishika", exactAmount: 800 },
      ]
    );
    expect(ok.participants.map((p) => p.shareAmount)).toEqual([800, 800, 800]);

    expect(() =>
      calculateSplit(
        2400,
        "EXACT",
        [{ userId: "me", amountPaid: 2400 }],
        [
          { userId: "me", exactAmount: 800 },
          { userId: "vanshika", exactAmount: 700 },
        ]
      )
    ).toThrow(SplitValidationError);
  });

  it("supports percentage split with largest-remainder rounding summing exactly to total", () => {
    const result = calculateSplit(
      1000,
      "PERCENTAGE",
      [{ userId: "u1", amountPaid: 1000 }],
      [
        { userId: "a", percentage: 33.33 },
        { userId: "b", percentage: 33.33 },
        { userId: "c", percentage: 33.34 },
      ]
    );
    const sum = result.participants.reduce((s, p) => s + p.shareAmount, 0);
    expect(sum).toBeCloseTo(1000, 2);
  });

  it("supports shares split (e.g. 2 shares vs 1 share)", () => {
    const result = calculateSplit(
      3000,
      "SHARES",
      [{ userId: "u1", amountPaid: 3000 }],
      [
        { userId: "a", shareUnits: 2 },
        { userId: "b", shareUnits: 1 },
      ]
    );
    expect(result.participants.find((p) => p.userId === "a")!.shareAmount).toBe(2000);
    expect(result.participants.find((p) => p.userId === "b")!.shareAmount).toBe(1000);
  });

  it("rejects a zero or negative amount", () => {
    expect(() => calculateSplit(0, "EQUAL", [{ userId: "u1", amountPaid: 0 }], [{ userId: "u1" }])).toThrow(
      SplitValidationError
    );
  });
});
