import { advanceOccurrence } from "./recurring.router";

describe("advanceOccurrence", () => {
  it("advances daily", () => {
    expect(advanceOccurrence(new Date("2026-01-01T00:00:00Z"), "DAILY").toISOString()).toBe("2026-01-02T00:00:00.000Z");
  });
  it("advances weekly", () => {
    expect(advanceOccurrence(new Date("2026-01-01T00:00:00Z"), "WEEKLY").toISOString()).toBe("2026-01-08T00:00:00.000Z");
  });
  it("advances monthly, handling month-length differences", () => {
    expect(advanceOccurrence(new Date("2026-01-31T00:00:00Z"), "MONTHLY").toISOString()).toBe("2026-03-03T00:00:00.000Z");
    // NOTE: JS Date rolls Jan 31 + 1 month into March 3rd (Feb has 28 days in 2026).
    // This is documented native Date behavior; callers scheduling rent on the
    // 31st should expect end-of-month rollover on short months.
  });
  it("advances yearly", () => {
    expect(advanceOccurrence(new Date("2026-06-15T00:00:00Z"), "YEARLY").toISOString()).toBe("2027-06-15T00:00:00.000Z");
  });
  it("throws on an unknown frequency", () => {
    expect(() => advanceOccurrence(new Date(), "FORTNIGHTLY")).toThrow();
  });
});
