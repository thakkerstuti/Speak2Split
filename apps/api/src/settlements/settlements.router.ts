import { Router, Response } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { ExpenseModel } from "../db/models/Expense";
import { SettlementModel } from "../db/models/Settlement";
import { GroupMemberModel } from "../db/models/Group";
import { UserModel } from "../db/models/User";
import { AuthedRequest, requireAuth } from "../auth/auth.router";
import { assertMembership } from "../groups/groups.router";
import { objectId } from "../validation";
import { computeSettlementPlan, LedgerLine } from "@speak2split/shared";
import { broadcastToGroup } from "../realtime/socket";
import { notify } from "../notifications/notification.service";

export const settlementsRouter = Router();
settlementsRouter.use(requireAuth);

/** GET /settlements/group/:groupId/balances — live balances + minimized settlement plan */
settlementsRouter.get("/group/:groupId/balances", async (req: AuthedRequest, res: Response) => {
  const isMember = await assertMembership(req.params.groupId, req.userId!);
  if (!isMember) return res.status(403).json({ error: "Not a member of this group" });

  const groupObjectId = new mongoose.Types.ObjectId(req.params.groupId);

  // Aggregate total paid per user by unwinding the embedded payers array
  // across every active expense in this group.
  const paidAgg = await ExpenseModel.aggregate([
    { $match: { groupId: groupObjectId, status: "ACTIVE" } },
    { $unwind: "$payers" },
    { $group: { _id: "$payers.userId", totalPaid: { $sum: "$payers.amountPaid" } } },
  ]);
  const owedAgg = await ExpenseModel.aggregate([
    { $match: { groupId: groupObjectId, status: "ACTIVE" } },
    { $unwind: "$participants" },
    { $group: { _id: "$participants.userId", totalOwed: { $sum: "$participants.shareAmount" } } },
  ]);

  const completedSettlements = await SettlementModel.find({ groupId: req.params.groupId, status: "COMPLETED" }).lean();

  const members = await GroupMemberModel.find({ groupId: req.params.groupId, status: "ACTIVE" }).lean();
  const users = await UserModel.find({ _id: { $in: members.map((m) => m.userId) } }).lean();
  const nameById = new Map(users.map((u) => [String(u._id), u.displayName]));

  const paidMap = new Map(paidAgg.map((r) => [String(r._id), r.totalPaid as number]));
  const owedMap = new Map(owedAgg.map((r) => [String(r._id), r.totalOwed as number]));

  // Completed settlements move money directly between the two parties,
  // independent of the expense ledger — apply them as paid/owed adjustments.
  for (const s of completedSettlements) {
    const from = String(s.fromUserId);
    const to = String(s.toUserId);
    paidMap.set(from, (paidMap.get(from) ?? 0) + s.amount);
    owedMap.set(to, (owedMap.get(to) ?? 0) + s.amount);
  }

  const lines: LedgerLine[] = members.map((m) => {
    const id = String(m.userId);
    return { userId: id, totalPaid: paidMap.get(id) ?? 0, totalOwed: owedMap.get(id) ?? 0 };
  });

  const { balances, settlements } = computeSettlementPlan(lines);

  return res.json({
    balances: balances.map((b) => ({ ...b, displayName: nameById.get(b.userId) })),
    suggestedSettlements: settlements.map((s) => ({
      ...s,
      fromDisplayName: nameById.get(s.fromUserId),
      toDisplayName: nameById.get(s.toUserId),
    })),
  });
});

const createSettlementSchema = z.object({
  groupId: objectId,
  toUserId: objectId,
  amount: z.number().positive(),
  method: z.enum(["CASH", "UPI", "BANK_TRANSFER", "OTHER"]).default("CASH"),
  note: z.string().optional(),
});

settlementsRouter.post("/", async (req: AuthedRequest, res: Response) => {
  const parsed = createSettlementSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
  const { groupId, toUserId, amount, method, note } = parsed.data;

  const isMember = await assertMembership(groupId, req.userId!);
  if (!isMember) return res.status(403).json({ error: "Not a member of this group" });

  const settlement = await SettlementModel.create({
    groupId,
    fromUserId: req.userId,
    toUserId,
    amount,
    method,
    note,
    status: "PENDING",
  });

  broadcastToGroup(groupId, "settlement_created", settlement.toJSON());
  return res.status(201).json(settlement.toJSON());
});

settlementsRouter.post("/:settlementId/complete", async (req: AuthedRequest, res: Response) => {
  const settlement = await SettlementModel.findById(req.params.settlementId);
  if (!settlement) return res.status(404).json({ error: "Settlement not found" });

  const isMember = await assertMembership(String(settlement.groupId), req.userId!);
  if (!isMember) return res.status(403).json({ error: "Not a member of this group" });

  if (settlement.status !== "PENDING") {
    return res.status(409).json({ error: `Settlement is already ${settlement.status}` });
  }

  settlement.status = "COMPLETED";
  settlement.completedAt = new Date();
  await settlement.save();

  broadcastToGroup(String(settlement.groupId), "settlement_completed", settlement.toJSON());

  notify({
    userId: String(settlement.toUserId),
    groupId: String(settlement.groupId),
    type: "SETTLEMENT_COMPLETED",
    title: "Settlement received",
    body: `₹${settlement.amount.toFixed(2)} settlement marked complete`,
    data: { settlementId: String(settlement._id) },
  }).catch((err) => console.error("Failed to send settlement_completed notification:", err));

  return res.json(settlement.toJSON());
});
