import { Router, Response } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { GroupModel, GroupMemberModel } from "../db/models/Group";
import { UserModel } from "../db/models/User";
import { ContactModel } from "../db/models/Contact";
import { ActivityEventModel } from "../db/models/ActivityEvent";
import { AuthedRequest, requireAuth } from "../auth/auth.router";

export const groupsRouter = Router();
groupsRouter.use(requireAuth);

const createGroupSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["FLAT", "TRIP", "FAMILY", "FRIENDS", "COUPLE", "EVENT", "CUSTOM"]).default("CUSTOM"),
  currency: z.string().default("INR"),
});

groupsRouter.post("/", async (req: AuthedRequest, res: Response) => {
  const parsed = createGroupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
  const { name, type, currency } = parsed.data;

  // Group + owner-membership are two documents that must appear together —
  // a transaction here requires MongoDB running as a replica set (the
  // default on Atlas; a local single-node mongod needs `rs.initiate()`
  // once — see ENVIRONMENT.md).
  const session = await mongoose.startSession();
  try {
    let group;
    await session.withTransaction(async () => {
      const created = await GroupModel.create([{ name, type, currency, createdById: req.userId }], { session });
      group = created[0];
      await GroupMemberModel.create(
        [{ groupId: group._id, userId: req.userId, role: "OWNER", status: "ACTIVE" }],
        { session }
      );
    });
    return res.status(201).json(group);
  } finally {
    await session.endSession();
  }
});

groupsRouter.get("/", async (req: AuthedRequest, res: Response) => {
  const memberships = await GroupMemberModel.find({ userId: req.userId, status: "ACTIVE" }).lean();
  const groupIds = memberships.map((m) => m.groupId);
  const groups = await GroupModel.find({ _id: { $in: groupIds }, archivedAt: { $exists: false } })
    .sort({ createdAt: -1 })
    .lean();
  return res.json(groups.map((g) => ({ ...g, id: String(g._id), _id: undefined })));
});

groupsRouter.get("/:groupId", async (req: AuthedRequest, res: Response) => {
  const isMember = await assertMembership(req.params.groupId, req.userId!);
  if (!isMember) return res.status(403).json({ error: "Not a member of this group" });

  const group = await GroupModel.findById(req.params.groupId);
  if (!group) return res.status(404).json({ error: "Group not found" });

  const memberships = await GroupMemberModel.find({
    groupId: req.params.groupId,
    status: { $ne: "REMOVED" },
  }).lean();
  const users = await UserModel.find({ _id: { $in: memberships.map((m) => m.userId) } }).lean();
  const userById = new Map(users.map((u) => [String(u._id), u]));

  const members = memberships.map((m) => {
    const u = userById.get(String(m.userId));
    return {
      id: String(m.userId),
      displayName: u?.displayName,
      email: u?.email,
      role: m.role,
      status: m.status,
    };
  });

  return res.json({ ...group.toJSON(), members });
});

const addMemberSchema = z.object({ email: z.string().email() });

groupsRouter.post("/:groupId/members", async (req: AuthedRequest, res: Response) => {
  const isMember = await assertMembership(req.params.groupId, req.userId!);
  if (!isMember) return res.status(403).json({ error: "Not a member of this group" });

  const parsed = addMemberSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });

  const newMember = await UserModel.findOne({ email: parsed.data.email.toLowerCase() });
  if (!newMember) {
    return res.status(404).json({
      error: "No Speak2Split account found for this email yet. Send them an invite link instead.",
    });
  }

  await GroupMemberModel.findOneAndUpdate(
    { groupId: req.params.groupId, userId: newMember._id },
    { $set: { status: "ACTIVE" }, $setOnInsert: { role: "MEMBER" } },
    { upsert: true }
  );

  // Upsert a contact record for the inviter so name resolution can find
  // this person by name in future natural-language expense statements.
  const existingContact = await ContactModel.findOne({ ownerUserId: req.userId, targetUserId: newMember._id });
  if (!existingContact) {
    await ContactModel.create({
      ownerUserId: req.userId,
      targetUserId: newMember._id,
      displayName: newMember.displayName,
      firstName: newMember.firstName ?? newMember.displayName.split(" ")[0],
    });
  }

  await ActivityEventModel.create({
    groupId: req.params.groupId,
    actorId: req.userId,
    type: "member_joined",
    metadata: { newMemberId: String(newMember._id) },
  });

  return res.status(201).json({ id: String(newMember._id), displayName: newMember.displayName });
});

export async function assertMembership(groupId: string, userId: string): Promise<boolean> {
  if (!mongoose.isValidObjectId(groupId)) return false;
  const membership = await GroupMemberModel.findOne({ groupId, userId, status: "ACTIVE" });
  return !!membership;
}
