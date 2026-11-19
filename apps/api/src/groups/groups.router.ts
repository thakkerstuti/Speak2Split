import { Router, Response } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { GroupModel, GroupMemberModel } from "../db/models/Group";
import { UserModel } from "../db/models/User";
import { ContactModel } from "../db/models/Contact";
import { ActivityEventModel } from "../db/models/ActivityEvent";
import { AuthedRequest, requireAuth } from "../auth/auth.router";
import { isObjectIdString, objectId, validateObjectIdParams } from "../validation";

export const groupsRouter = Router();
groupsRouter.use(requireAuth);
validateObjectIdParams(groupsRouter, "groupId");

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
      email: u?.isGuest ? undefined : u?.email,
      isGuest: !!u?.isGuest,
      role: m.role,
      status: m.status,
    };
  });

  return res.json({ ...group.toJSON(), members });
});

// Add by email (any registered user), or by userId — the latter only for
// people the requester already knows (a contact of theirs, or someone they
// share another group with), which is what the voice flow uses when a
// mentioned contact isn't in the chosen group yet.
const addMemberSchema = z.union([
  z.object({ email: z.string().email() }),
  z.object({ userId: objectId }),
  z.object({ contactId: objectId }),
]);

/**
 * Adding one of your own contacts. If they use Speak2Split the contact is
 * already linked to their account; if not, a guest profile is created (no
 * login, no email, no phone matching) and linked to the contact so they can
 * share expenses and voice entries resolve them by name.
 */
async function userForContact(ownerUserId: string, contactId: string) {
  const contact = await ContactModel.findOne({ _id: contactId, ownerUserId });
  if (!contact) return null;
  if (contact.targetUserId) {
    const linked = await UserModel.findOne({ _id: contact.targetUserId, isActive: true });
    if (linked) return linked;
  }
  const displayName = contact.displayName?.trim() || "Guest";
  const guest = await UserModel.create({
    email: `guest-${new mongoose.Types.ObjectId().toHexString()}@guest.speak2split.internal`,
    displayName,
    firstName: contact.firstName ?? displayName.split(" ")[0],
    isGuest: true,
    isActive: true,
  });
  await ContactModel.updateOne({ _id: contact._id }, { $set: { targetUserId: guest._id } });
  return guest;
}

async function requesterKnowsUser(requesterId: string, targetUserId: string): Promise<boolean> {
  const contact = await ContactModel.exists({ ownerUserId: requesterId, targetUserId });
  if (contact) return true;
  const myGroups = await GroupMemberModel.find({ userId: requesterId, status: "ACTIVE" }).distinct("groupId");
  const shared = await GroupMemberModel.exists({ userId: targetUserId, status: "ACTIVE", groupId: { $in: myGroups } });
  return !!shared;
}

groupsRouter.post("/:groupId/members", async (req: AuthedRequest, res: Response) => {
  const isMember = await assertMembership(req.params.groupId, req.userId!);
  if (!isMember) return res.status(403).json({ error: "Not a member of this group" });

  const parsed = addMemberSchema.safeParse(req.body);
  if (!parsed.success) {
    const error =
      typeof req.body?.email === "string"
        ? "That doesn't look like an email address. Enter the email they signed up with (for example name@gmail.com)."
        : "Validation failed";
    return res.status(400).json({ error, details: parsed.error.flatten() });
  }

  let newMember;
  if ("email" in parsed.data) {
    newMember = await UserModel.findOne({ email: parsed.data.email.toLowerCase(), isActive: true });
    if (!newMember) {
      return res.status(404).json({
        error: "No Speak2Split account found for this email yet. Ask them to sign up first.",
      });
    }
  } else if ("contactId" in parsed.data) {
    newMember = await userForContact(req.userId!, parsed.data.contactId);
    if (!newMember) return res.status(404).json({ error: "Contact not found" });
  } else {
    if (!(await requesterKnowsUser(req.userId!, parsed.data.userId))) {
      return res.status(403).json({ error: "You can only add people from your contacts or groups by name." });
    }
    newMember = await UserModel.findOne({ _id: parsed.data.userId, isActive: true });
    if (!newMember) return res.status(404).json({ error: "User not found" });
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
  if (!isObjectIdString(groupId) || !isObjectIdString(userId)) return false;
  const membership = await GroupMemberModel.findOne({ groupId, userId, status: "ACTIVE" });
  return !!membership;
}
