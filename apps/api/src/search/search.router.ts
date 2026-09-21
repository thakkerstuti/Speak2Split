import { Router, Response } from "express";
import { z } from "zod";
import { GroupModel, GroupMemberModel } from "../db/models/Group";
import { ExpenseModel } from "../db/models/Expense";
import { ContactModel } from "../db/models/Contact";
import { SettlementModel } from "../db/models/Settlement";
import { RecurringExpenseModel } from "../db/models/RecurringExpense";
import { UserModel } from "../db/models/User";
import { AuthedRequest, requireAuth } from "../auth/auth.router";
import { objectId } from "../validation";

export const searchRouter = Router();
searchRouter.use(requireAuth);

const searchSchema = z.object({
  q: z.string().min(1),
  groupId: objectId.optional(),
  minAmount: z.coerce.number().optional(),
  maxAmount: z.coerce.number().optional(),
  category: z.string().optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
});

/**
 * GET /search?q=...&groupId=...&minAmount=...&maxAmount=...&category=...&dateFrom=...&dateTo=...
 *
 * Searches across expenses, groups, people, settlements, and recurring
 * expenses, always scoped to groups the requesting user actually belongs
 * to — a search can never leak another group's data.
 */
searchRouter.get("/", async (req: AuthedRequest, res: Response) => {
  const parsed = searchSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
  const { q, groupId, minAmount, maxAmount, category, dateFrom, dateTo } = parsed.data;
  const regex = new RegExp(q, "i");

  const memberships = await GroupMemberModel.find({ userId: req.userId, status: "ACTIVE" }).lean();
  let myGroupIds = memberships.map((m) => String(m.groupId));
  if (groupId) {
    if (!myGroupIds.includes(groupId)) myGroupIds = []; // requested a group the user isn't in — return nothing for it
    else myGroupIds = [groupId];
  }

  const groups = await GroupModel.find({ _id: { $in: myGroupIds }, name: regex }).limit(20).lean();

  const expenseFilter: Record<string, unknown> = {
    groupId: { $in: myGroupIds },
    status: "ACTIVE",
    $or: [{ title: regex }, { category: regex }, { notes: regex }],
  };
  if (minAmount !== undefined || maxAmount !== undefined) {
    expenseFilter.amount = {
      ...(minAmount !== undefined ? { $gte: minAmount } : {}),
      ...(maxAmount !== undefined ? { $lte: maxAmount } : {}),
    };
  }
  if (category) expenseFilter.category = new RegExp(category, "i");
  if (dateFrom || dateTo) {
    expenseFilter.expenseDate = {
      ...(dateFrom ? { $gte: new Date(dateFrom) } : {}),
      ...(dateTo ? { $lte: new Date(dateTo) } : {}),
    };
  }
  const expenses = await ExpenseModel.find(expenseFilter).sort({ expenseDate: -1 }).limit(50).lean();
  const groupNameById = new Map(
    (await GroupModel.find({ _id: { $in: expenses.map((e) => e.groupId) } }).lean()).map((g) => [String(g._id), g.name])
  );

  const people = await ContactModel.find({ ownerUserId: req.userId, displayName: regex }).limit(20).lean();

  const settlements = await SettlementModel.find({
    groupId: { $in: myGroupIds },
    // Method match uses a plain equality-after-regex-test since `method`
    // is a small fixed enum; regex still works fine against the string value.
  })
    .limit(100) // pull a reasonable window, then filter by counterparty name below (needs a join we can't push to Mongo directly)
    .sort({ createdAt: -1 })
    .lean();
  const settlementUserIds = [...new Set(settlements.flatMap((s) => [String(s.fromUserId), String(s.toUserId)]))];
  const settlementUsers = new Map(
    (await UserModel.find({ _id: { $in: settlementUserIds } }).lean()).map((u) => [String(u._id), u.displayName])
  );
  const matchingSettlements = settlements
    .filter((s) => {
      const fromName = settlementUsers.get(String(s.fromUserId)) ?? "";
      const toName = settlementUsers.get(String(s.toUserId)) ?? "";
      return regex.test(fromName) || regex.test(toName) || regex.test(s.method);
    })
    .slice(0, 20);

  const recurringExpenses = await RecurringExpenseModel.find({ groupId: { $in: myGroupIds }, title: regex })
    .limit(20)
    .lean();

  return res.json({
    groups: groups.map((g) => ({ id: String(g._id), name: g.name, type: g.type })),
    expenses: expenses.map((e) => ({
      id: String(e._id),
      title: e.title,
      amount: e.amount,
      category: e.category,
      expense_date: e.expenseDate,
      group_id: String(e.groupId),
      group_name: groupNameById.get(String(e.groupId)),
    })),
    people: people.map((p) => ({
      id: String(p._id),
      display_name: p.displayName,
      phone: p.phone ?? null,
      email: p.email ?? null,
    })),
    settlements: matchingSettlements.map((s) => ({
      id: String(s._id),
      amount: s.amount,
      method: s.method,
      status: s.status,
      from_name: settlementUsers.get(String(s.fromUserId)),
      to_name: settlementUsers.get(String(s.toUserId)),
      group_id: String(s.groupId),
    })),
    recurringExpenses: recurringExpenses.map((r) => ({
      id: String(r._id),
      title: r.title,
      amount: r.amount,
      frequency: r.frequency,
      group_id: String(r.groupId),
    })),
  });
});
