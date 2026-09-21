import { resolveName, resolveNames, normalizeName, ResolvionCandidate } from "../src/resolution/name-resolver";

function candidate(overrides: Partial<ResolvionCandidate>): ResolvionCandidate {
  return {
    contactId: overrides.contactId ?? "c1",
    displayName: "Test Person",
    firstName: "Test",
    lastName: "Person",
    source: "BROADER_CONTACT",
    isCurrentGroupMember: false,
    isRecentInGroup: false,
    frequencyScore: 0,
    aliases: [],
    ...overrides,
  };
}

describe("name resolver", () => {
  it("resolves unambiguously when only one match exists in the group", () => {
    const pool = [
      candidate({
        contactId: "vanshika-agarwal",
        displayName: "Vanshika Agarwal",
        firstName: "Vanshika",
        lastName: "Agarwal",
        isCurrentGroupMember: true,
      }),
    ];

    const result = resolveName("Vanshika", pool);
    expect(result.status).toBe("RESOLVED");
    if (result.status === "RESOLVED") {
      expect(result.candidate.contactId).toBe("vanshika-agarwal");
      expect(result.confidence).toBeGreaterThan(0.72);
    }
  });

  it("asks for clarification when two group members share a first name — the exact spec scenario", () => {
    const pool = [
      candidate({
        contactId: "vanshika-agarwal",
        displayName: "Vanshika Agarwal",
        firstName: "Vanshika",
        lastName: "Agarwal",
        isCurrentGroupMember: true,
      }),
      candidate({
        contactId: "vanshika-pal",
        displayName: "Vanshika Pal",
        firstName: "Vanshika",
        lastName: "Pal",
        isCurrentGroupMember: true,
      }),
      candidate({
        contactId: "ishika-diwari",
        displayName: "Ishika Diwari",
        firstName: "Ishika",
        lastName: "Diwari",
        isCurrentGroupMember: true,
      }),
    ];

    const result = resolveName("Vanshika", pool);
    expect(result.status).toBe("AMBIGUOUS");
    if (result.status === "AMBIGUOUS") {
      const names = result.candidates.map((c) => c.candidate.displayName).sort();
      expect(names).toEqual(["Vanshika Agarwal", "Vanshika Pal"]);
      expect(result.promptMessage).toContain("Vanshika Agarwal");
      expect(result.promptMessage).toContain("Vanshika Pal");
      // Ishika must not leak into the Vanshika disambiguation prompt.
      expect(result.promptMessage).not.toContain("Ishika");
    }
  });

  it("resolves distinct names in the same utterance independently, batching all ambiguities together", () => {
    const pool = [
      candidate({ contactId: "vanshika-agarwal", displayName: "Vanshika Agarwal", firstName: "Vanshika", isCurrentGroupMember: true }),
      candidate({ contactId: "vanshika-pal", displayName: "Vanshika Pal", firstName: "Vanshika", isCurrentGroupMember: true }),
      candidate({ contactId: "ishika-thakkar", displayName: "Ishika Thakkar", firstName: "Ishika", isCurrentGroupMember: true }),
      candidate({ contactId: "ishika-diwari", displayName: "Ishika Diwari", firstName: "Ishika", isCurrentGroupMember: false, source: "BROADER_CONTACT" }),
    ];

    const results = resolveNames(["Vanshika", "Ishika"], pool);
    expect(results["Vanshika"].status).toBe("AMBIGUOUS");
    // Ishika Diwari is only a broader contact (not in group) so the in-group
    // Ishika Thakkar should win outright without a prompt.
    expect(results["Ishika"].status).toBe("RESOLVED");
  });

  it("gives group members priority over identically-named non-members (per resolution priority order)", () => {
    const pool = [
      candidate({ contactId: "in-group", displayName: "Rahul Mehta", firstName: "Rahul", isCurrentGroupMember: true, frequencyScore: 2 }),
      candidate({ contactId: "not-in-group", displayName: "Rahul Sharma", firstName: "Rahul", isCurrentGroupMember: false, frequencyScore: 50, source: "FREQUENT_CONTACT" }),
    ];

    const result = resolveName("Rahul", pool);
    // Group members are the top resolution tier: the frequent-contact Rahul
    // never even enters consideration once a group-member Rahul is found,
    // so this resolves automatically rather than asking to disambiguate.
    expect(result.status).toBe("RESOLVED");
    if (result.status === "RESOLVED") {
      expect(result.candidate.contactId).toBe("in-group");
    }
  });

  it("still disambiguates when two candidates within the SAME tier share a name", () => {
    const pool = [
      candidate({ contactId: "rahul-mehta", displayName: "Rahul Mehta", firstName: "Rahul", isCurrentGroupMember: false, frequencyScore: 10 }),
      candidate({ contactId: "rahul-sharma", displayName: "Rahul Sharma", firstName: "Rahul", isCurrentGroupMember: false, frequencyScore: 8 }),
    ];
    const result = resolveName("Rahul", pool);
    expect(result.status).toBe("AMBIGUOUS");
  });

  it("absorbs minor spelling / speech-to-text variation", () => {
    const pool = [candidate({ contactId: "a", displayName: "Vanshika Agarwal", firstName: "Vanshika", isCurrentGroupMember: true })];
    const result = resolveName("Vanshikaa", pool); // extra letter, as STT might produce
    expect(result.status).toBe("RESOLVED");
  });

  it("resolves via nickname/alias", () => {
    const pool = [
      candidate({
        contactId: "a",
        displayName: "Vanshika Agarwal",
        firstName: "Vanshika",
        isCurrentGroupMember: true,
        aliases: ["van", "vanshika a"],
      }),
    ];
    const result = resolveName("Van", pool);
    expect(result.status).toBe("RESOLVED");
  });

  it("returns NOT_FOUND for a name with no meaningful match", () => {
    const pool = [candidate({ contactId: "a", displayName: "Vanshika Agarwal", firstName: "Vanshika" })];
    const result = resolveName("Zzzqqrx", pool);
    expect(result.status).toBe("NOT_FOUND");
  });

  it("normalizes names for comparison (case, punctuation, diacritics)", () => {
    expect(normalizeName("Vanshika-Agarwal!")).toBe("vanshikaagarwal");
    expect(normalizeName("  Ishika   Diwari ")).toBe("ishika diwari");
  });
});
