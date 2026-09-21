import { Router, Response } from "express";
import { z } from "zod";
import { ContactModel } from "../db/models/Contact";
import { UserModel } from "../db/models/User";
import { AuthedRequest, requireAuth } from "../auth/auth.router";
import {
  matchContactSignals,
  matchContactSignal,
  normalizePhone,
  normalizeEmail,
  ExistingContact,
  ExistingUser,
} from "@speak2split/shared";

export const contactsRouter = Router();
contactsRouter.use(requireAuth);

async function loadExistingIdentities(ownerUserId: string): Promise<{ contacts: ExistingContact[]; users: ExistingUser[] }> {
  const [contacts, users] = await Promise.all([
    ContactModel.find({ ownerUserId }).lean(),
    UserModel.find({}).select("email normalizedPhone").lean(),
  ]);

  return {
    contacts: contacts.map((c) => ({
      contactId: String(c._id),
      targetUserId: c.targetUserId ? String(c.targetUserId) : undefined,
      displayName: c.displayName,
      normalizedPhone: c.normalizedPhone ?? undefined,
      normalizedEmail: c.normalizedEmail ?? undefined,
    })),
    users: users.map((u) => ({
      userId: String(u._id),
      normalizedPhone: u.normalizedPhone ?? undefined,
      normalizedEmail: u.email ? normalizeEmail(u.email) : undefined,
    })),
  };
}

/** GET /contacts — this user's known people (for the "People" screen and manual expense participant picker). */
contactsRouter.get("/", async (req: AuthedRequest, res: Response) => {
  const contacts = await ContactModel.find({ ownerUserId: req.userId })
    .sort({ frequencyScore: -1, displayName: 1 })
    .lean();
  return res.json(contacts.map((c) => ({ ...c, id: String(c._id), _id: undefined })));
});

const manualAddSchema = z
  .object({
    displayName: z.string().min(1),
    phone: z.string().optional(),
    email: z.string().email().optional(),
  })
  .refine((v) => v.phone || v.email, {
    message: "A phone number or email is required to add a person — this prevents creating an unidentifiable duplicate.",
  });

/**
 * POST /contacts — the "Add person" flow triggered when name resolution
 * returns NOT_FOUND. Deliberately REQUIRES phone or email; a bare display
 * name is rejected at the schema level before it ever reaches matching
 * logic, per the critical no-name-only-identity rule.
 */
contactsRouter.post("/", async (req: AuthedRequest, res: Response) => {
  const parsed = manualAddSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
  const { displayName, phone, email } = parsed.data;

  const { contacts, users } = await loadExistingIdentities(req.userId!);
  const decision = matchContactSignal(
    { displayName, phones: phone ? [phone] : [], emails: email ? [email] : [] },
    contacts,
    users
  );

  if (decision.action === "LINK_TO_USER") {
    const existing = await ContactModel.findOne({ ownerUserId: req.userId, targetUserId: decision.userId });
    if (existing) {
      return res.json({ contactId: String(existing._id), linked: "EXISTING_CONTACT_FOR_USER" });
    }
    const created = await insertContact(req.userId!, displayName, phone, email, decision.userId, "MANUAL");
    return res.status(201).json({ contactId: String(created._id), linked: "SPEAK2SPLIT_USER" });
  }

  if (decision.action === "LINK_EXISTING_CONTACT") {
    return res.json({ contactId: decision.contactId, linked: "EXISTING_CONTACT", note: "Already have this person." });
  }

  const created = await insertContact(req.userId!, displayName, phone, email, undefined, "MANUAL");
  return res.status(201).json({ contactId: String(created._id), linked: "NEW" });
});

async function insertContact(
  ownerUserId: string,
  displayName: string,
  phone: string | undefined,
  email: string | undefined,
  targetUserId: string | undefined,
  source: string
) {
  const [firstName, ...rest] = displayName.trim().split(/\s+/);
  return ContactModel.create({
    ownerUserId,
    targetUserId,
    displayName,
    firstName,
    lastName: rest.length ? rest.join(" ") : undefined,
    phone,
    email,
    normalizedPhone: phone ? normalizePhone(phone) : undefined,
    normalizedEmail: email ? normalizeEmail(email) : undefined,
    source,
  });
}

const syncSchema = z.object({
  contacts: z
    .array(
      z.object({
        displayName: z.string().min(1),
        phones: z.array(z.string()).default([]),
        emails: z.array(z.string()).default([]),
      })
    )
    .max(2000),
});

/**
 * POST /contacts/sync — bulk import from the device address book. Every
 * incoming row is matched via the same tested logic used for manual add:
 * existing user > existing contact > create (only with a real identifier)
 * > skip.
 */
contactsRouter.post("/sync", async (req: AuthedRequest, res: Response) => {
  const parsed = syncSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });

  const { contacts: existingContacts, users } = await loadExistingIdentities(req.userId!);
  const matches = matchContactSignals(parsed.data.contacts, existingContacts, users);

  const summary = { linkedToUser: 0, linkedToContact: 0, created: 0, skipped: 0 };

  for (const { signal, decision } of matches) {
    if (decision.action === "LINK_TO_USER") {
      const existing = await ContactModel.findOne({ ownerUserId: req.userId, targetUserId: decision.userId });
      if (!existing) {
        await insertContact(req.userId!, signal.displayName, signal.phones?.[0], signal.emails?.[0], decision.userId, "DEVICE_CONTACT_SYNC");
      }
      summary.linkedToUser++;
    } else if (decision.action === "LINK_EXISTING_CONTACT") {
      summary.linkedToContact++;
    } else if (decision.action === "CREATE_NEW_CONTACT") {
      await insertContact(req.userId!, signal.displayName, signal.phones?.[0], signal.emails?.[0], undefined, "DEVICE_CONTACT_SYNC");
      summary.created++;
    } else {
      summary.skipped++;
    }
  }

  return res.json({ summary, totalProcessed: parsed.data.contacts.length });
});
