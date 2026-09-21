import { Router, Response } from "express";
import { z } from "zod";
import { ExpenseModel } from "../db/models/Expense";
import { GroupMemberModel } from "../db/models/Group";
import { ContactModel } from "../db/models/Contact";
import { ActivityEventModel } from "../db/models/ActivityEvent";
import { AuthedRequest, requireAuth } from "../auth/auth.router";
import { assertMembership } from "../groups/groups.router";
import { objectId } from "../validation";
import { calculateSplit, SplitValidationError, parseExpenseUtterance, resolveNames } from "@speak2split/shared";
import { broadcastToGroup } from "../realtime/socket";
import { buildCandidatePoolForGroup } from "../resolution/resolution.router";
import { notifyGroupMembers } from "../notifications/notification.service";

export const expensesRouter = Router();
expensesRouter.use(requireAuth);

const createExpenseSchema = z.object({
  groupId: objectId,
  title: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().default("INR"),
  category: z.string().default("general"),
  splitMethod: z.enum(["EQUAL", "EXACT", "PERCENTAGE", "SHARES"]).default("EQUAL"),
  payers: z.array(z.object({ userId: objectId, amountPaid: z.number() })).min(1),
  participants: z
    .array(
      z.object({
        userId: objectId,
        exactAmount: z.number().optional(),
        percentage: z.number().optional(),
        shareUnits: z.number().optional(),
      })
    )
    .min(1),
  notes: z.string().optional(),
  expenseDate: z.string().datetime().optional(),
  source: z.enum(["MANUAL", "VOICE", "RECEIPT_OCR", "RECURRING", "TEMPLATE"]).default("MANUAL"),
  aiRawInput: z.string().optional(),
  aiConfidence: z.number().optional(),
});

expensesRouter.post("/", async (req: AuthedRequest, res: Response) => {
  const parsed = createExpenseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
  const input = parsed.data;

  const isMember = await assertMembership(input.groupId, req.userId!);
  if (!isMember) return res.status(403).json({ error: "Not a member of this group" });

  // Every participant/payer must actually belong to the group — never trust
  // client-provided user IDs blindly.
  const activeMembers = await GroupMemberModel.find({ groupId: input.groupId, status: "ACTIVE" }).lean();
  const validMemberIds = new Set(activeMembers.map((m) => String(m.userId)));
  const allReferencedIds = [...input.payers.map((p) => p.userId), ...input.participants.map((p) => p.userId)];
  const invalidId = allReferencedIds.find((id) => !validMemberIds.has(id));
  if (invalidId) {
    return res.status(400).json({ error: `User ${invalidId} is not an active member of this group` });
  }

  // Server-side split calculation — this is the ONLY place split math happens.
  let split;
  try {
    split = calculateSplit(input.amount, input.splitMethod, input.payers, input.participants);
  } catch (err) {
    if (err instanceof SplitValidationError) {
      return res.status(422).json({ error: err.message, code: err.code });
    }
    throw err;
  }

  // Unlike the previous Postgres version, payers and participants are
  // embedded directly in the Expense document — a single insert is
  // already atomic, so no multi-statement transaction is needed here at all.
  const expense = await ExpenseModel.create({
    groupId: input.groupId,
    title: input.title,
    amount: input.amount,
    currency: input.currency,
    category: input.category,
    splitMethod: input.splitMethod,
    source: input.source,
    expenseDate: input.expenseDate ? new Date(input.expenseDate) : new Date(),
    notes: input.notes,
    createdById: req.userId,
    aiRawInput: input.aiRawInput,
    aiConfidence: input.aiConfidence,
    payers: split.payers,
    participants: split.participants,
  });

  // Bump frequency score for contacts used, powering future name resolution.
  await ContactModel.updateMany(
    { ownerUserId: req.userId, targetUserId: { $in: [...new Set(allReferencedIds)] } },
    { $inc: { frequencyScore: 1 }, $set: { lastUsedAt: new Date() } }
  );

  await ActivityEventModel.create({
    groupId: input.groupId,
    actorId: req.userId,
    expenseId: expense._id,
    type: "expense_added",
    metadata: { title: expense.title, amount: expense.amount },
  });

  broadcastToGroup(input.groupId, "expense_added", { expenseId: String(expense._id), title: expense.title, amount: expense.amount });

  notifyGroupMembers(
    input.groupId,
    req.userId!,
    "EXPENSE_ADDED",
    "New expense added",
    `${expense.title} — ₹${expense.amount.toFixed(2)}`,
    { expenseId: String(expense._id) }
  ).catch((err) => console.error("Failed to send expense_added notifications:", err));

  return res.status(201).json(expense.toJSON());
});

const parseSchema = z.object({
  groupId: objectId,
  utterance: z.string().min(1),
});

/**
 * Voice/text natural-language entry point. Runs the two-stage pipeline the
 * spec requires as separate concerns: (1) NLP extraction of raw mentions
 * and amounts, (2) name resolution of those mentions scoped to this group.
 * Returns a draft for the client to render as a confirmation/edit screen —
 * this endpoint NEVER creates the expense itself; POST /expenses does that
 * once the person confirms (and any ambiguous names are resolved).
 */
expensesRouter.post("/parse", async (req: AuthedRequest, res: Response) => {
  const parsed = parseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
  const { groupId, utterance } = parsed.data;

  const isMember = await assertMembership(groupId, req.userId!);
  if (!isMember) return res.status(403).json({ error: "Not a member of this group" });

  let draft;
  try {
    draft = await parseExpenseUtterance(utterance);
  } catch (err) {
    return res.status(422).json({ error: `Could not understand that expense: ${(err as Error).message}` });
  }

  const selfAliases = new Set(["me", "i", "myself"]);
  const allMentions = [
    ...draft.payerMentions.map((p) => p.mention),
    ...draft.participantMentions,
  ].filter((m) => !selfAliases.has(m.toLowerCase()));
  const uniqueMentions = [...new Set(allMentions)];

  const candidatePool = await buildCandidatePoolForGroup(req.userId!, groupId);
  const resolutions = resolveNames(uniqueMentions, candidatePool);

  const resolvedMentions: Record<string, unknown> = {};
  for (const mention of uniqueMentions) {
    const outcome = resolutions[mention];
    if (outcome.status === "RESOLVED") {
      resolvedMentions[mention] = { status: "RESOLVED", userId: outcome.candidate.userId, displayName: outcome.candidate.displayName };
    } else if (outcome.status === "AMBIGUOUS") {
      resolvedMentions[mention] = {
        status: "AMBIGUOUS",
        promptMessage: outcome.promptMessage,
        candidates: outcome.candidates.map((c) => ({ userId: c.candidate.userId, displayName: c.candidate.displayName })),
      };
    } else {
      resolvedMentions[mention] = { status: "NOT_FOUND" };
    }
  }

  const needsDisambiguation = Object.values(resolvedMentions).some((r: any) => r.status !== "RESOLVED");

  return res.json({ draft, resolvedMentions, needsDisambiguation });
});

expensesRouter.get("/group/:groupId", async (req: AuthedRequest, res: Response) => {
  const isMember = await assertMembership(req.params.groupId, req.userId!);
  if (!isMember) return res.status(403).json({ error: "Not a member of this group" });

  const expenses = await ExpenseModel.find({ groupId: req.params.groupId, status: "ACTIVE" })
    .sort({ expenseDate: -1 })
    .lean();

  return res.json(expenses.map((e) => ({ ...e, id: String(e._id), _id: undefined })));
});
