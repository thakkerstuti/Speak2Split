import { rankGroups, groupNameMentionScore, GroupSignal } from "./group-inference";

const NOW = Date.UTC(2026, 10, 18);
const DAY = 86_400_000;

const g = (over: Partial<GroupSignal> & { groupId: string; groupName: string }): GroupSignal => ({
  memberMatches: 0,
  ambiguousMemberMatches: 0,
  lastActivityAt: null,
  ...over,
});

describe("groupNameMentionScore", () => {
  it("scores a full group-name mention highest", () => {
    expect(groupNameMentionScore("paid 900 for cab on the goa trip", "Goa Trip")).toBe(10);
  });
  it("scores a distinctive word of the name", () => {
    expect(groupNameMentionScore("spent 400 on snacks in goa", "Goa Trip 2026")).toBe(6);
  });
  it("ignores generic words like 'flat' or 'trip' on their own", () => {
    expect(groupNameMentionScore("paid the flat electricity bill", "Flat")).toBe(10); // whole name spoken
    expect(groupNameMentionScore("paid the electricity bill for the trip", "Manali Trip")).toBe(0);
  });
  it("does not match inside other words", () => {
    expect(groupNameMentionScore("bought a goat", "Goa")).toBe(0);
  });
});

describe("rankGroups", () => {
  it("returns high confidence when the user has a single group", () => {
    const r = rankGroups("dinner 500", [g({ groupId: "a", groupName: "Flatmates" })], NOW);
    expect(r.ranked[0].groupId).toBe("a");
    expect(r.confidence).toBe("high");
  });

  it("prefers the group whose members were mentioned", () => {
    const r = rankGroups(
      "dinner 1200 with Rahul and Aisha",
      [
        g({ groupId: "recent", groupName: "Office", lastActivityAt: NOW - 1 * DAY }),
        g({ groupId: "friends", groupName: "College", memberMatches: 2, lastActivityAt: NOW - 30 * DAY }),
      ],
      NOW
    );
    expect(r.ranked[0].groupId).toBe("friends");
    expect(r.confidence).toBe("high");
    expect(r.reason).toMatch(/people you mentioned/);
  });

  it("a spoken group name beats member matches elsewhere", () => {
    const r = rankGroups(
      "paid 3000 for the hotel on the goa trip with Rahul",
      [
        g({ groupId: "goa", groupName: "Goa Trip" }),
        g({ groupId: "office", groupName: "Office", memberMatches: 1 }),
      ],
      NOW
    );
    expect(r.ranked[0].groupId).toBe("goa");
    expect(r.reason).toBe('You mentioned "Goa Trip"');
  });

  it("falls back to the most recently active group with low confidence", () => {
    const r = rankGroups(
      "paid 250 for coffee",
      [
        g({ groupId: "old", groupName: "Old", lastActivityAt: NOW - 60 * DAY }),
        g({ groupId: "new", groupName: "New", lastActivityAt: NOW - 1 * DAY }),
      ],
      NOW
    );
    expect(r.ranked[0].groupId).toBe("new");
    expect(r.confidence).toBe("low");
    expect(r.reason).toBe("Your most recently active group");
  });

  it("is only medium/low confident when two groups match equally well", () => {
    const r = rankGroups(
      "lunch with Rahul",
      [
        g({ groupId: "a", groupName: "A", memberMatches: 1, lastActivityAt: NOW - 2 * DAY }),
        g({ groupId: "b", groupName: "B", memberMatches: 1, lastActivityAt: NOW - 3 * DAY }),
      ],
      NOW
    );
    expect(r.confidence).not.toBe("high");
  });
});
