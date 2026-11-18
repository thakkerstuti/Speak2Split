import { Router, Response } from "express";
import { z } from "zod";
import { ExpenseModel } from "../db/models/Expense";
import { GroupModel, GroupMemberModel } from "../db/models/Group";
import { rankGroups, GroupSignal } from "./group-inference";
import { ContactModel } from "../db/models/Contact";
import { ActivityEventModel } from "../db/models/ActivityEvent";
import { AuthedRequest, requireAuth } from "../auth/auth.router";
import { assertMembership } from "../groups/groups.router";
import { objectId, validateObjectIdParams } from "../validation";
import { calculateSplit, SplitValidationError, parseExpenseUtterance, resolveNames } from "@speak2split/shared";
import { broadcastToGroup } from "../realtime/socket";
import { buildCandidatePoolForGroup } from "../resolution/resolution.router";
import { notifyGroupMembers } from "../notifications/notification.service";

export const expensesRouter = Router();
expensesRouter.use(requireAuth);
validateObjectIdParams(expensesRouter, "groupId");

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

  // Every payer and participant must ALREADY be an active member of the group.
  // Creating an expense never adds anyone to a group — membership changes only
  // happen through the explicit POST /groups/:groupId/members route.
  const activeMembers = await GroupMemberModel.find({ groupId: input.groupId, status: "ACTIVE" }).lean();
  const validMemberIds = new Set(activeMembers.map((m) => String(m.userId)));
  const allReferencedIds = [...input.payers.map((p) => p.userId), ...input.participants.map((p) => p.userId)];
  const invalidId = allReferencedIds.find((id) => !validMemberIds.has(id));
  if (invalidId) {
    return res.status(400).json({
      error: "Everyone who paid or is splitting must already be a member of this group.",
      code: "NOT_A_MEMBER",
      userId: invalidId,
    });
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
  // Optional: when omitted (voice-first entry), the group is inferred from
  // the sentence — spoken group name, mentioned people, then recency.
  groupId: objectId.optional(),
  utterance: z.string().min(1),
});

type Resolutions = ReturnType<typeof resolveNames>;

function toResolvedMentions(uniqueMentions: string[], resolutions: Resolutions) {
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
  return resolvedMentions;
}

const MAX_GROUPS_FOR_INFERENCE = 15;

/**
 * Voice/text natural-language entry point. Runs the two-stage pipeline the
 * spec requires as separate concerns: (1) NLP extraction of raw mentions
 * and amounts, (2) name resolution of those mentions scoped to a group.
 * If no groupId is supplied, the most likely group is inferred and returned
 * alongside the draft so the client can show (and let the user change) it.
 * This endpoint NEVER creates the expense itself; POST /expenses does that
 * once the person confirms (and any ambiguous names are resolved).
 */
expensesRouter.post("/parse", async (req: AuthedRequest, res: Response) => {
  try {
    const parsed = parseSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    const { groupId: requestedGroupId, utterance } = parsed.data;
    const userId = req.userId!;

    if (requestedGroupId) {
      const isMember = await assertMembership(requestedGroupId, userId);
      if (!isMember) return res.status(403).json({ error: "Not a member of this group" });
    }

    let draft;
    try {
      draft = await parseExpenseUtterance(utterance);
    } catch (err) {
      return res.status(422).json({ error: `Could not understand that expense: ${(err as Error).message}` });
    }

    const selfAliases = new Set(["me", "i", "myself"]);
    const allMentions = [...draft.payerMentions.map((p) => p.mention), ...draft.participantMentions].filter(
      (m) => !selfAliases.has(m.toLowerCase())
    );
    const uniqueMentions = [...new Set(allMentions)];

    // ---- Explicit group: unchanged behaviour ----
    if (requestedGroupId) {
      const candidatePool = await buildCandidatePoolForGroup(userId, requestedGroupId);
      const resolvedMentions = toResolvedMentions(uniqueMentions, resolveNames(uniqueMentions, candidatePool));
      const needsDisambiguation = Object.values(resolvedMentions).some((r: any) => r.status !== "RESOLVED");
      const group = await GroupModel.findById(requestedGroupId).lean();
      return res.json({
        draft,
        resolvedMentions,
        needsDisambiguation,
        groupId: requestedGroupId,
        groupName: group?.name,
        groupInference: { inferred: false, confidence: "high", reason: "Selected group", alternatives: [] },
      });
    }

    // ---- No group: infer it ----
    const memberships = await GroupMemberModel.find({ userId, status: "ACTIVE" }).lean();
    const groups = await GroupModel.find({
      _id: { $in: memberships.map((m) => m.groupId) },
      archivedAt: { $exists: false },
    }).lean();
    if (groups.length === 0) {
      return res.status(422).json({
        error: "Create a group first — expenses are always split inside a group.",
        code: "NO_GROUPS",
      });
    }

    const activity = await ExpenseModel.aggregate([
      { $match: { groupId: { $in: groups.map((g) => g._id) }, status: "ACTIVE" } },
      { $group: { _id: "$groupId", last: { $max: "$createdAt" } } },
    ]);
    const lastActivity = new Map(activity.map((a) => [String(a._id), new Date(a.last).getTime()]));
    const lastActivityOf = (g: (typeof groups)[number]) =>
      lastActivity.get(String(g._id)) ?? (g.createdAt ? new Date(g.createdAt).getTime() : null);

    const candidateGroups = [...groups]
      .sort((a, b) => (lastActivityOf(b) ?? 0) - (lastActivityOf(a) ?? 0))
      .slice(0, MAX_GROUPS_FOR_INFERENCE);

    const perGroup = await Promise.all(
      candidateGroups.map(async (g) => {
        const gid = String(g._id);
        const resolutions = uniqueMentions.length
          ? resolveNames(uniqueMentions, await buildCandidatePoolForGroup(userId, gid))
          : ({} as Resolutions);
        let memberMatches = 0;
        let ambiguousMemberMatches = 0;
        for (const m of uniqueMentions) {
          const o = resolutions[m];
          if (o?.status === "RESOLVED" && o.candidate.isCurrentGroupMember) memberMatches++;
          else if (o?.status === "AMBIGUOUS" && o.candidates.some((c) => c.candidate.isCurrentGroupMember)) ambiguousMemberMatches++;
        }
        const signal: GroupSignal = {
          groupId: gid,
          groupName: g.name,
          memberMatches,
          ambiguousMemberMatches,
          lastActivityAt: lastActivityOf(g),
        };
        return { signal, resolutions };
      })
    );

    const inference = rankGroups(utterance, perGroup.map((p) => p.signal));
    const best = inference.ranked[0];
    const chosen = perGroup.find((p) => p.signal.groupId === best.groupId)!;
    const resolvedMentions = toResolvedMentions(uniqueMentions, chosen.resolutions);
    const needsDisambiguation = Object.values(resolvedMentions).some((r: any) => r.status !== "RESOLVED");

    return res.json({
      draft,
      resolvedMentions,
      needsDisambiguation,
      groupId: best.groupId,
      groupName: best.groupName,
      groupInference: {
        inferred: true,
        confidence: inference.confidence,
        reason: inference.reason,
        alternatives: inference.ranked.slice(1, 4).map((r) => ({ groupId: r.groupId, groupName: r.groupName })),
      },
    });
  } catch (err) {
    console.error("Error in /expenses/parse:", err);
    return res.status(500).json({ error: "Couldn't process that expense. Please try again." });
  }
});

expensesRouter.get("/group/:groupId", async (req: AuthedRequest, res: Response) => {
  const isMember = await assertMembership(req.params.groupId, req.userId!);
  if (!isMember) return res.status(403).json({ error: "Not a member of this group" });

  const expenses = await ExpenseModel.find({ groupId: req.params.groupId, status: "ACTIVE" })
    .sort({ expenseDate: -1 })
    .lean();

  return res.json(expenses.map((e) => ({ ...e, id: String(e._id), _id: undefined })));
});
