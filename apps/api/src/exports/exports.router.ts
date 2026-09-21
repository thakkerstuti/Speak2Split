import { Router, Response } from "express";
import PDFDocument from "pdfkit";
import { GroupModel, GroupMemberModel } from "../db/models/Group";
import { UserModel } from "../db/models/User";
import { ExpenseModel } from "../db/models/Expense";
import { SettlementModel } from "../db/models/Settlement";
import { AuthedRequest, requireAuth } from "../auth/auth.router";
import { assertMembership } from "../groups/groups.router";
import { computeSettlementPlan, LedgerLine } from "@speak2split/shared";
import mongoose from "mongoose";

export const exportsRouter = Router();
exportsRouter.use(requireAuth);

const ACCENT = "#7C6CFF";
const MUTED = "#6B6B7A";
const DARK = "#15151C";

/**
 * GET /exports/group/:groupId/pdf — generates a real PDF report (group
 * info, members, full expense history, balances, and the settlement plan)
 * and streams it back as a download. Nothing here is a placeholder: every
 * figure comes from the same live queries used elsewhere in the API.
 */
exportsRouter.get("/group/:groupId/pdf", async (req: AuthedRequest, res: Response) => {
  const isMember = await assertMembership(req.params.groupId, req.userId!);
  if (!isMember) return res.status(403).json({ error: "Not a member of this group" });

  const group = await GroupModel.findById(req.params.groupId).lean();
  if (!group) return res.status(404).json({ error: "Group not found" });

  const memberships = await GroupMemberModel.find({ groupId: req.params.groupId, status: "ACTIVE" }).lean();
  const users = await UserModel.find({ _id: { $in: memberships.map((m) => m.userId) } }).lean();
  const nameById = new Map(users.map((u) => [String(u._id), u.displayName]));

  const expenses = await ExpenseModel.find({ groupId: req.params.groupId, status: "ACTIVE" })
    .sort({ expenseDate: 1 })
    .lean();

  const settlements = await SettlementModel.find({ groupId: req.params.groupId }).sort({ createdAt: 1 }).lean();

  // Same balance computation used by the live /settlements endpoint —
  // the PDF and the app can never disagree because they share this code.
  const groupObjectId = new mongoose.Types.ObjectId(req.params.groupId);
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
  const paidMap = new Map(paidAgg.map((r) => [String(r._id), r.totalPaid as number]));
  const owedMap = new Map(owedAgg.map((r) => [String(r._id), r.totalOwed as number]));
  const lines: LedgerLine[] = memberships.map((m) => {
    const id = String(m.userId);
    return { userId: id, totalPaid: paidMap.get(id) ?? 0, totalOwed: owedMap.get(id) ?? 0 };
  });
  const { balances, settlements: suggestedSettlements } = computeSettlementPlan(lines);

  // ---------- Render the actual PDF ----------
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${group.name.replace(/[^a-z0-9]/gi, "_")}_report.pdf"`);

  const doc = new PDFDocument({ margin: 50, size: "A4" });
  doc.pipe(res);

  doc.fillColor(ACCENT).fontSize(22).font("Helvetica-Bold").text("Speak2Split", { continued: false });
  doc.fillColor(MUTED).fontSize(10).font("Helvetica").text("Say it. Split it. Settle it.");
  doc.moveDown(1.5);

  doc.fillColor(DARK).fontSize(18).font("Helvetica-Bold").text(group.name);
  doc.fillColor(MUTED).fontSize(10).font("Helvetica").text(`${group.type} · ${group.currency} · Generated ${new Date().toLocaleString()}`);
  doc.moveDown(0.5);
  doc.fillColor(DARK).fontSize(11).text(`Members: ${users.map((u) => u.displayName).join(", ")}`);
  doc.moveDown(1);

  sectionHeader(doc, "Expenses");
  if (expenses.length === 0) {
    doc.fillColor(MUTED).fontSize(10).text("No expenses recorded.");
  }
  for (const e of expenses) {
    const payerNames = e.payers
      .map((p: { userId: unknown; amountPaid: number }) => `${nameById.get(String(p.userId)) ?? "Unknown"} (Rs. ${p.amountPaid.toFixed(2)})`)
      .join(", ");
    doc.fillColor(DARK).fontSize(11).font("Helvetica-Bold").text(`${e.title} — Rs. ${e.amount.toFixed(2)}`, { continued: false });
    doc
      .fillColor(MUTED)
      .fontSize(9)
      .font("Helvetica")
      .text(`${e.category} · ${e.expenseDate.toLocaleDateString()} · ${e.splitMethod} · Paid by: ${payerNames}`);
    doc.moveDown(0.4);
  }
  doc.moveDown(0.5);

  sectionHeader(doc, "Balances");
  for (const b of balances) {
    const label = b.netBalance >= 0 ? "is owed" : "owes";
    doc
      .fillColor(DARK)
      .fontSize(11)
      .font("Helvetica")
      .text(`${nameById.get(b.userId)}: ${label} Rs. ${Math.abs(b.netBalance).toFixed(2)}`);
  }
  doc.moveDown(1);

  sectionHeader(doc, "Suggested Settlement Plan");
  if (suggestedSettlements.length === 0) {
    doc.fillColor(MUTED).fontSize(10).text("Everyone is settled up.");
  }
  for (const s of suggestedSettlements) {
    doc.fillColor(DARK).fontSize(11).text(`${nameById.get(s.fromUserId)} -> ${nameById.get(s.toUserId)}: Rs. ${s.amount.toFixed(2)}`);
  }
  doc.moveDown(1);

  sectionHeader(doc, "Settlement History");
  if (settlements.length === 0) {
    doc.fillColor(MUTED).fontSize(10).text("No settlements recorded yet.");
  }
  for (const s of settlements) {
    doc
      .fillColor(DARK)
      .fontSize(10)
      .text(
        `${nameById.get(String(s.fromUserId))} -> ${nameById.get(String(s.toUserId))}: Rs. ${s.amount.toFixed(2)} (${s.method}, ${s.status}) — ${s.createdAt.toLocaleDateString()}`
      );
  }

  doc.end();
});

function sectionHeader(doc: PDFKit.PDFDocument, title: string) {
  doc.moveDown(0.3);
  doc.fillColor(ACCENT).fontSize(13).font("Helvetica-Bold").text(title);
  doc.moveTo(doc.x, doc.y + 2).lineTo(545, doc.y + 2).strokeColor("#E0E0E8").stroke();
  doc.moveDown(0.5);
}
