import { Router, Response } from "express";
import { z } from "zod";
import { ShoppingListModel } from "../db/models/ShoppingList";
import { UserModel } from "../db/models/User";
import { AuthedRequest, requireAuth } from "../auth/auth.router";
import { assertMembership } from "../groups/groups.router";
import { objectId } from "../validation";
import { broadcastToGroup } from "../realtime/socket";

export const shoppingRouter = Router();
shoppingRouter.use(requireAuth);

async function withAssigneeNames(list: any) {
  const userIds = [...new Set(list.items.flatMap((i: any) => [i.assignedToId, i.addedById].filter(Boolean).map(String)))];
  const users = await UserModel.find({ _id: { $in: userIds } }).lean();
  const nameById = new Map(users.map((u) => [String(u._id), u.displayName]));
  return {
    ...list,
    items: list.items.map((i: any) => ({
      ...i,
      assignedToName: i.assignedToId ? nameById.get(String(i.assignedToId)) : undefined,
      addedByName: nameById.get(String(i.addedById)),
    })),
  };
}

/** GET /shopping/group/:groupId — the group's shopping list(s) with items. */
shoppingRouter.get("/group/:groupId", async (req: AuthedRequest, res: Response) => {
  const isMember = await assertMembership(req.params.groupId, req.userId!);
  if (!isMember) return res.status(403).json({ error: "Not a member of this group" });

  let list = await ShoppingListModel.findOne({ groupId: req.params.groupId, archivedAt: { $exists: false } });

  // Auto-create the group's default list on first access.
  if (!list) {
    list = await ShoppingListModel.create({ groupId: req.params.groupId, name: "Shopping List", items: [] });
  }

  const listJson = list.toJSON();
  listJson.items.sort((a: any, b: any) => Number(a.isCompleted) - Number(b.isCompleted));
  return res.json([await withAssigneeNames(listJson)]);
});

const addItemSchema = z.object({
  listId: objectId,
  name: z.string().min(1),
  quantity: z.string().optional(),
  estimatedPrice: z.number().optional(),
  assignedToId: objectId.optional(),
});

shoppingRouter.post("/items", async (req: AuthedRequest, res: Response) => {
  const parsed = addItemSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
  const { listId, name, quantity, estimatedPrice, assignedToId } = parsed.data;

  const list = await ShoppingListModel.findById(listId);
  if (!list) return res.status(404).json({ error: "List not found" });
  const groupId = String(list.groupId);

  const isMember = await assertMembership(groupId, req.userId!);
  if (!isMember) return res.status(403).json({ error: "Not a member of this group" });

  if (assignedToId) {
    const assigneeIsMember = await assertMembership(groupId, assignedToId);
    if (!assigneeIsMember) return res.status(400).json({ error: "Assigned person is not a member of this group" });
  }

  list.items.push({
    name,
    quantity,
    estimatedPrice,
    assignedToId: assignedToId as any,
    addedById: req.userId as any,
    isCompleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any);
  await list.save();
  const newItem = list.items[list.items.length - 1];

  broadcastToGroup(groupId, "shopping_item_updated", { action: "added", item: newItem.toJSON() });
  return res.status(201).json(newItem.toJSON());
});

const updateItemSchema = z.object({
  name: z.string().min(1).optional(),
  quantity: z.string().optional(),
  estimatedPrice: z.number().optional(),
  assignedToId: objectId.nullable().optional(),
  isCompleted: z.boolean().optional(),
});

async function findListByItemId(itemId: string) {
  return ShoppingListModel.findOne({ "items._id": itemId });
}

shoppingRouter.patch("/items/:id", async (req: AuthedRequest, res: Response) => {
  const parsed = updateItemSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });

  const list = await findListByItemId(req.params.id);
  if (!list) return res.status(404).json({ error: "Item not found" });
  const groupId = String(list.groupId);

  const isMember = await assertMembership(groupId, req.userId!);
  if (!isMember) return res.status(403).json({ error: "Not a member of this group" });

  const item = list.items.id(req.params.id);
  if (!item) return res.status(404).json({ error: "Item not found" });

  const fields = parsed.data;
  if (fields.name !== undefined) item.name = fields.name;
  if (fields.quantity !== undefined) item.quantity = fields.quantity;
  if (fields.estimatedPrice !== undefined) item.estimatedPrice = fields.estimatedPrice;
  if (fields.assignedToId !== undefined) item.assignedToId = fields.assignedToId as any;
  if (fields.isCompleted !== undefined) {
    item.isCompleted = fields.isCompleted;
    item.completedAt = fields.isCompleted ? new Date() : undefined;
  }
  item.updatedAt = new Date();
  await list.save();

  broadcastToGroup(groupId, "shopping_item_updated", { action: "updated", item: item.toJSON() });
  return res.json(item.toJSON());
});

shoppingRouter.delete("/items/:id", async (req: AuthedRequest, res: Response) => {
  const list = await findListByItemId(req.params.id);
  if (!list) return res.status(404).json({ error: "Item not found" });
  const groupId = String(list.groupId);

  const isMember = await assertMembership(groupId, req.userId!);
  if (!isMember) return res.status(403).json({ error: "Not a member of this group" });

  list.items.id(req.params.id)?.deleteOne();
  await list.save();

  broadcastToGroup(groupId, "shopping_item_updated", { action: "deleted", itemId: req.params.id });
  return res.json({ ok: true });
});
