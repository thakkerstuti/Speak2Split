import { matchContactSignal, matchContactSignals, normalizePhone, normalizeEmail } from "../src/resolution/contact-matching";

describe("contact matching — duplicate identity safety", () => {
  it("normalizes phone numbers so +91/0-prefix formatting differences still match", () => {
    expect(normalizePhone("+91 98765 43210")).toBe("9876543210");
    expect(normalizePhone("098765-43210")).toBe("9876543210");
    expect(normalizePhone("9876543210")).toBe("9876543210");
  });

  it("normalizes email case/whitespace", () => {
    expect(normalizeEmail("  Vanshika@Example.com ")).toBe("vanshika@example.com");
  });

  // Case: Two contacts with identical names (Vanshika Agarwal, Vanshika Pal already exist)
  it("never guesses between two same-named contacts when the new signal has no identifier", () => {
    const decision = matchContactSignal(
      { displayName: "Vanshika" },
      [
        { contactId: "c1", displayName: "Vanshika Agarwal" },
        { contactId: "c2", displayName: "Vanshika Pal" },
      ],
      []
    );
    expect(decision.action).toBe("SKIP_INSUFFICIENT_IDENTITY");
  });

  // Case: contact matching by phone number links to the SAME identity, no duplicate
  it("links a synced contact to an existing contact by phone number instead of duplicating", () => {
    const decision = matchContactSignal(
      { displayName: "Vanshika Agarwal", phones: ["+91 98765 43210"] },
      [{ contactId: "c1", displayName: "Vanshika Agarwal", normalizedPhone: "9876543210" }],
      []
    );
    expect(decision).toEqual({ action: "LINK_EXISTING_CONTACT", contactId: "c1", reason: "PHONE_MATCH" });
  });

  // Case: contact matching by email
  it("links a synced contact to an existing contact by email", () => {
    const decision = matchContactSignal(
      { displayName: "Ishika D", emails: ["Ishika.Diwari@Gmail.com"] },
      [{ contactId: "c2", displayName: "Ishika Diwari", normalizedEmail: "ishika.diwari@gmail.com" }],
      []
    );
    expect(decision).toEqual({ action: "LINK_EXISTING_CONTACT", contactId: "c2", reason: "EMAIL_MATCH" });
  });

  // Case: contact linked to an existing Speak2Split user (phone matches a real user, not just a contact record)
  it("prefers linking to an existing Speak2Split USER over creating a new contact when phone matches a registered user", () => {
    const decision = matchContactSignal(
      { displayName: "Vanshika Agarwal", phones: ["9876543210"] },
      [],
      [{ userId: "u1", normalizedPhone: "9876543210" }]
    );
    expect(decision).toEqual({ action: "LINK_TO_USER", userId: "u1", reason: "PHONE_MATCH" });
  });

  // Case: same person, changed display name — must NOT create a new person
  it("still links by phone even when the display name has changed", () => {
    const decision = matchContactSignal(
      { displayName: "Vani (renamed)", phones: ["9876543210"] },
      [{ contactId: "c1", displayName: "Vanshika Agarwal", normalizedPhone: "9876543210" }],
      []
    );
    expect(decision).toEqual({ action: "LINK_EXISTING_CONTACT", contactId: "c1", reason: "PHONE_MATCH" });
  });

  // Case: genuinely new person with a real identifier — safe to create
  it("creates a new contact only when there is no match AND a real identifier is present", () => {
    const decision = matchContactSignal({ displayName: "Rahul Mehta", phones: ["9000000000"] }, [], []);
    expect(decision).toEqual({ action: "CREATE_NEW_CONTACT", reason: "NO_MATCH_HAS_IDENTIFIER" });
  });

  // Case: no phone or email at all — must never fabricate an identity from a bare name
  it("refuses to create an identity from name alone, even with zero existing contacts", () => {
    const decision = matchContactSignal({ displayName: "Some New Person" }, [], []);
    expect(decision.action).toBe("SKIP_INSUFFICIENT_IDENTITY");
  });

  it("batch-processes a full contact sync, mixing links, creates, and skips", () => {
    const results = matchContactSignals(
      [
        { displayName: "Vanshika Agarwal", phones: ["9876543210"] }, // matches existing contact
        { displayName: "Totally New", phones: ["9000000001"] }, // creates
        { displayName: "No Identifier Person" }, // skips
      ],
      [{ contactId: "c1", displayName: "Vanshika Agarwal", normalizedPhone: "9876543210" }],
      []
    );
    expect(results[0].decision.action).toBe("LINK_EXISTING_CONTACT");
    expect(results[1].decision.action).toBe("CREATE_NEW_CONTACT");
    expect(results[2].decision.action).toBe("SKIP_INSUFFICIENT_IDENTITY");
  });
});
