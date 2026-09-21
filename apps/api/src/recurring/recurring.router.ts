import { Router, Response } from "express";
import { z } from "zod";
import { RecurringExpenseModel } from "../db/models/RecurringExpense";
import { AuthedRequest, requireAuth } from "../auth/auth.router";
import { assertMembership } from "../groups/groups.router";
import { objectId } from "../validation";
import { calculateSplit, SplitValidationError } from "@speak2split/shared";

export const recurringRouter = Router();
recurringRouter.use(requireAuth);

const createSchema = z.object({
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
  frequency: z.enum(["DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY", "YEARLY"]),
  startDate: z.string().datetime(),
  endDate: z.string().datetime().optional(),
});

/** Computes the next occurrence strictly after `from`, per the given frequency. Pure — no DB. */
export function advanceOccurrence(from: Date, frequency: string): Date {
  const next = new Date(from);
  switch (frequency) {
    case "DAILY":
      next.setDate(next.getDate() + 1);
      break;
    case "WEEKLY":
      next.setDate(next.getDate() + 7);
      break;
    case "BIWEEKLY":
      next.setDate(next.getDate() + 14);
      break;
    case "MONTHLY":
      next.setMonth(next.getMonth() + 1);
      break;
    case "YEARLY":
      next.setFullYear(next.getFullYear() + 1);
      break;
    default:
      throw new Error(`Unknown frequency: ${frequency}`);
  }
  return next;
}

recurringRouter.post("/", async (req: AuthedRequest, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
  const input = parsed.data;

  const isMember = await assertMembership(input.groupId, req.userId!);
  if (!isMember) return res.status(403).json({ error: "Not a member of this group" });

  // Validate the split configuration up front using the same engine that
  // will run at generation time, so a bad config is rejected at creation,
  // not silently when the scheduler tries to generate it.
  try {
    calculateSplit(input.amount, input.splitMethod, input.payers, input.participants);
  } catch (err) {
    if (err instanceof SplitValidationError) return res.status(422).json({ error: err.message, code: err.code });
    throw err;
  }

  const startDate = new Date(input.startDate);
  const recurring = await RecurringExpenseModel.create({
    groupId: input.groupId,
    title: input.title,
    amount: input.amount,
    currency: input.currency,
    category: input.category,
    splitMethod: input.splitMethod,
    payerConfig: input.payers,
    participantConfig: input.participants,
    frequency: input.frequency,
    startDate,
    endDate: input.endDate ? new Date(input.endDate) : undefined,
    nextOccurrence: startDate,
    createdById: req.userId,
  });

  return res.status(201).json(recurring.toJSON());
});

recurringRouter.get("/group/:groupId", async (req: AuthedRequest, res: Response) => {
  const isMember = await assertMembership(req.params.groupId, req.userId!);
  if (!isMember) return res.status(403).json({ error: "Not a member of this group" });

  const recurring = await RecurringExpenseModel.find({ groupId: req.params.groupId })
    .sort({ nextOccurrence: 1 })
    .lean();
  return res.json(recurring.map((r) => ({ ...r, id: String(r._id), _id: undefined })));
});

recurringRouter.post("/:id/pause", async (req: AuthedRequest, res: Response) => {
  const existing = await RecurringExpenseModel.findById(req.params.id);
  if (!existing) return res.status(404).json({ error: "Not found" });

  const isMember = await assertMembership(String(existing.groupId), req.userId!);
  if (!isMember) return res.status(403).json({ error: "Not a member of this group" });

  existing.isActive = false;
  await existing.save();
  return res.json(existing.toJSON());
});
