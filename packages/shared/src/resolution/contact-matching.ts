/**
 * Contact Matching & Identity Resolution
 *
 * CRITICAL INVARIANT (see spec): a person's identity is NEVER their name.
 * Names are display labels only. Every person is identified by a stable
 * contactId (or userId once linked). This module decides, given a new
 * signal (a synced phone contact, or a manually-added person), whether it
 * refers to an EXISTING contact/user or requires a NEW identity — and it
 * NEVER creates a new identity from a bare name with no phone/email when a
 * name collision exists, because that is exactly how silent misattribution
 * happens.
 */

export interface ExistingContact {
  contactId: string;
  targetUserId?: string;
  displayName: string;
  normalizedPhone?: string;
  normalizedEmail?: string;
}

export interface ExistingUser {
  userId: string;
  normalizedPhone?: string;
  normalizedEmail?: string;
}

export interface IncomingContactSignal {
  displayName: string;
  phones?: string[];
  emails?: string[];
}

export type MatchDecision =
  | { action: "LINK_EXISTING_CONTACT"; contactId: string; reason: "PHONE_MATCH" | "EMAIL_MATCH" }
  | { action: "LINK_TO_USER"; userId: string; reason: "PHONE_MATCH" | "EMAIL_MATCH" }
  | { action: "CREATE_NEW_CONTACT"; reason: "NO_MATCH_HAS_IDENTIFIER" }
  | { action: "SKIP_INSUFFICIENT_IDENTITY"; reason: "NO_PHONE_OR_EMAIL_AND_NAME_AMBIGUOUS" | "NO_PHONE_OR_EMAIL" };

/** Normalizes a phone number for comparison: digits only, keep trailing 10 (or full with country code preserved if present). */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "");
  // Keep the last 10 digits as the comparison key — absorbs +91/0-prefix
  // formatting differences without conflating genuinely different numbers.
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Decides how to handle one incoming contact signal (e.g. one row from a
 * phone contact sync, or a manually-typed "add person" form) against the
 * owner's existing contacts and Speak2Split users.
 *
 * Priority: an existing linked Speak2Split user by phone/email always wins
 * (this is the same real person, possibly already a contact too — the
 * caller is expected to also check existingContacts for a contact record
 * pointing at that same userId and update it rather than duplicate it).
 * Then an existing contact by phone/email. Only if NEITHER matches, and the
 * signal carries a real phone or email, do we create a new identity. A
 * signal with only a name and no phone/email is never enough to create or
 * link an identity — that is the exact failure mode this module exists to
 * prevent.
 */
export function matchContactSignal(
  signal: IncomingContactSignal,
  existingContacts: ExistingContact[],
  existingUsers: ExistingUser[]
): MatchDecision {
  const normalizedPhones = (signal.phones ?? []).map(normalizePhone).filter((p) => p.length >= 7);
  const normalizedEmails = (signal.emails ?? []).map(normalizeEmail).filter((e) => e.includes("@"));

  const hasIdentifier = normalizedPhones.length > 0 || normalizedEmails.length > 0;

  if (!hasIdentifier) {
    return { action: "SKIP_INSUFFICIENT_IDENTITY", reason: "NO_PHONE_OR_EMAIL" };
  }

  // 1. Does this match an existing Speak2Split USER by phone/email?
  for (const user of existingUsers) {
    if (user.normalizedPhone && normalizedPhones.includes(user.normalizedPhone)) {
      return { action: "LINK_TO_USER", userId: user.userId, reason: "PHONE_MATCH" };
    }
    if (user.normalizedEmail && normalizedEmails.includes(user.normalizedEmail)) {
      return { action: "LINK_TO_USER", userId: user.userId, reason: "EMAIL_MATCH" };
    }
  }

  // 2. Does this match an existing CONTACT by phone/email?
  for (const contact of existingContacts) {
    if (contact.normalizedPhone && normalizedPhones.includes(contact.normalizedPhone)) {
      return { action: "LINK_EXISTING_CONTACT", contactId: contact.contactId, reason: "PHONE_MATCH" };
    }
    if (contact.normalizedEmail && normalizedEmails.includes(contact.normalizedEmail)) {
      return { action: "LINK_EXISTING_CONTACT", contactId: contact.contactId, reason: "EMAIL_MATCH" };
    }
  }

  // 3. No match anywhere, but we have a real identifier — safe to create.
  return { action: "CREATE_NEW_CONTACT", reason: "NO_MATCH_HAS_IDENTIFIER" };
}

/**
 * Batch version for a full contact-sync pass.
 */
export function matchContactSignals(
  signals: IncomingContactSignal[],
  existingContacts: ExistingContact[],
  existingUsers: ExistingUser[]
): { signal: IncomingContactSignal; decision: MatchDecision }[] {
  return signals.map((signal) => ({ signal, decision: matchContactSignal(signal, existingContacts, existingUsers) }));
}

/**
 * Used by the "unknown person" flow during expense creation: when the
 * name resolver returns NOT_FOUND, we must never silently fabricate a
 * person. This decides what the client should be offered.
 */
export interface UnresolvedNamePrompt {
  rawInput: string;
  offerAddPerson: true; // always true — never auto-create
  requiresPhoneOrEmail: true;
}

export function buildUnresolvedNamePrompt(rawInput: string): UnresolvedNamePrompt {
  return { rawInput, offerAddPerson: true, requiresPhoneOrEmail: true };
}
