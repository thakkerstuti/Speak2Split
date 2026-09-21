import { Router, Response } from "express";
import { z } from "zod";
import { ExpenseTemplateModel } from "../db/models/ExpenseTemplate";
import { GroupMemberModel } from "../db/models/Group";
import { UserModel } from "../db/models/User";
import { AuthedRequest, requireAuth } from "../auth/auth.router";
import { assertMembership } from "../groups/groups.router";
import { objectId } from "../validation";

export const templatesRouter = Router();
templatesRouter.use(requireAuth);

const createTemplateSchema = z.object({
  groupId: objectId.optional(),
  name: z.string().min(1),
  title: z.string().min(1),
  defaultAmount: z.number().positive().optional(),
  category: z.string().default("general"),
  splitMethod: z.enum(["EQUAL", "EXACT", "PERCENTAGE", "SHARES"]).default("EQUAL"),
  icon: z.string().optional(),
});

templatesRouter.post("/", async (req: AuthedRequest, res: Response) => {
  const parsed = createTemplateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
  const input = parsed.data;

  if (input.groupId) {
    const isMember = await assertMembership(input.groupId, req.userId!);
    if (!isMember) return res.status(403).json({ error: "Not a member of this group" });
  }

  const template = await ExpenseTemplateModel.create({
    groupId: input.groupId,
    ownerId: req.userId,
    name: input.name,
    title: input.title,
    defaultAmount: input.defaultAmount,
    category: input.category,
    splitMethod: input.splitMethod,
    icon: input.icon,
  });
  return res.status(201).json(template.toJSON());
});

templatesRouter.get("/", async (req: AuthedRequest, res: Response) => {
  const groupId = typeof req.query.groupId === "string" ? req.query.groupId : undefined;
  if (groupId) {
    const isMember = await assertMembership(groupId, req.userId!);
    if (!isMember) return res.status(403).json({ error: "Not a member of this group" });
  }

  const templates = await ExpenseTemplateModel.find({
    $or: [{ ownerId: req.userId }, ...(groupId ? [{ groupId }] : [])],
  })
    .sort({ name: 1 })
    .lean();
  return res.json(templates.map((t) => ({ ...t, id: String(t._id), _id: undefined })));
});

const updateTemplateSchema = createTemplateSchema.partial();

templatesRouter.patch("/:id", async (req: AuthedRequest, res: Response) => {
  const existing = await ExpenseTemplateModel.findById(req.params.id);
  if (!existing) return res.status(404).json({ error: "Template not found" });
  if (String(existing.ownerId) !== req.userId) return res.status(403).json({ error: "Not your template" });

  const parsed = updateTemplateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });

  Object.assign(existing, parsed.data);
  await existing.save();
  return res.json(existing.toJSON());
});

templatesRouter.delete("/:id", async (req: AuthedRequest, res: Response) => {
  const existing = await ExpenseTemplateModel.findById(req.params.id);
  if (!existing) return res.status(404).json({ error: "Template not found" });
  if (String(existing.ownerId) !== req.userId) return res.status(403).json({ error: "Not your template" });

  await existing.deleteOne();
  return res.json({ ok: true });
});

/**
 * GET /templates/:id/resolve?groupId=... — the "use template" step.
 * Deliberately does NOT store or reuse stale participant IDs from when the
 * template was created; it re-resolves the CURRENT group's active members
 * fresh every time. Returns a pre-filled draft — never creates the expense.
 */
templatesRouter.get("/:id/resolve", async (req: AuthedRequest, res: Response) => {
  const groupId = typeof req.query.groupId === "string" ? req.query.groupId : undefined;
  if (!groupId) return res.status(400).json({ error: "groupId query parameter is required" });

  const isMember = await assertMembership(groupId, req.userId!);
  if (!isMember) return res.status(403).json({ error: "Not a member of this group" });

  const template = await ExpenseTemplateModel.findById(req.params.id);
  if (!template) return res.status(404).json({ error: "Template not found" });

  if (String(template.ownerId) !== req.userId && String(template.groupId) !== groupId) {
    return res.status(403).json({ error: "This template does not belong to you or this group" });
  }

  const members = await GroupMemberModel.find({ groupId, status: "ACTIVE" }).lean();
  const users = await UserModel.find({ _id: { $in: members.map((m) => m.userId) } }).lean();

  return res.json({
    title: template.title,
    amount: template.defaultAmount,
    category: template.category,
    splitMethod: template.splitMethod,
    suggestedParticipants: users.map((u) => ({ userId: String(u._id), displayName: u.displayName })),
  });
});
