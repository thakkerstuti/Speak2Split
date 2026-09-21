import { Router, Response } from "express";
import { z } from "zod";
import { GroupMemberModel } from "../db/models/Group";
import { UserModel } from "../db/models/User";
import { ContactModel } from "../db/models/Contact";
import { ExpenseModel } from "../db/models/Expense";
import { AuthedRequest, requireAuth } from "../auth/auth.router";
import { assertMembership } from "../groups/groups.router";
import { objectId } from "../validation";
import { resolveNames, ResolvionCandidate } from "@speak2split/shared";

export const resolutionRouter = Router();
resolutionRouter.use(requireAuth);

const resolveSchema = z.object({
  groupId: objectId,
  mentions: z.array(z.string().min(1)).min(1),
});

/**
 * Builds the candidate pool for a user resolving names inside a specific
 * group, in exactly the priority order the resolver expects:
 * current group members > recently-used-in-this-group > frequent contacts >
 * every other contact this user knows.
 */
export async function buildCandidatePoolForGroup(ownerUserId: string, groupId: string): Promise<ResolvionCandidate[]> {
  const memberships = await GroupMemberModel.find({ groupId, status: "ACTIVE" }).lean();
  const groupMemberUserIds = memberships.map((m) => String(m.userId)).filter((id) => id !== ownerUserId);

  const [groupUsers, ownerContacts, recentParticipants] = await Promise.all([
    UserModel.find({ _id: { $in: groupMemberUserIds } }).lean(),
    ContactModel.find({ ownerUserId }).lean(),
    // "Recent in this group" = participated in an expense here in the last 30 days.
    ExpenseModel.find({
      groupId,
      createdAt: { $gt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    })
      .select("participants.userId")
      .lean(),
  ]);

  const recentUserIds = new Set(
    recentParticipants.flatMap((e) => e.participants.map((p: { userId: unknown }) => String(p.userId)))
  );
  const contactByTargetUser = new Map(
    ownerContacts.filter((c) => c.targetUserId).map((c) => [String(c.targetUserId), c])
  );

  const candidates: ResolvionCandidate[] = [];

  for (const user of groupUsers) {
    const contact = contactByTargetUser.get(String(user._id));
    candidates.push({
      contactId: String(user._id), // group members are addressed by their user id directly
      userId: String(user._id),
      displayName: user.displayName,
      firstName: user.firstName ?? user.displayName.split(" ")[0],
      lastName: user.lastName ?? undefined,
      source: "GROUP_MEMBER",
      isCurrentGroupMember: true,
      isRecentInGroup: recentUserIds.has(String(user._id)),
      frequencyScore: contact?.frequencyScore ?? 0,
      aliases: contact?.aliases ?? [],
    });
  }

  const groupMemberSet = new Set(groupMemberUserIds);
  for (const contact of ownerContacts) {
    const targetUserId = contact.targetUserId ? String(contact.targetUserId) : undefined;
    if (targetUserId && groupMemberSet.has(targetUserId)) continue; // already added above

    candidates.push({
      contactId: String(contact._id),
      userId: targetUserId,
      displayName: contact.displayName,
      firstName: contact.firstName,
      lastName: contact.lastName ?? undefined,
      source: contact.frequencyScore > 0 ? "FREQUENT_CONTACT" : "BROADER_CONTACT",
      isCurrentGroupMember: false,
      isRecentInGroup: false,
      frequencyScore: contact.frequencyScore,
      aliases: contact.aliases ?? [],
    });
  }

  return candidates;
}

resolutionRouter.post("/", async (req: AuthedRequest, res: Response) => {
  const parsed = resolveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
  const { groupId, mentions } = parsed.data;

  const isMember = await assertMembership(groupId, req.userId!);
  if (!isMember) return res.status(403).json({ error: "Not a member of this group" });

  const selfAliases = new Set(["me", "i", "myself"]);
  const toResolve = mentions.filter((m) => !selfAliases.has(m.toLowerCase()));

  const pool = await buildCandidatePoolForGroup(req.userId!, groupId);
  const outcomes = resolveNames(toResolve, pool);

  const response: Record<string, unknown> = {};
  for (const mention of mentions) {
    if (selfAliases.has(mention.toLowerCase())) {
      response[mention] = { status: "RESOLVED", userId: req.userId, displayName: "You", confidence: 1 };
      continue;
    }
    const outcome = outcomes[mention];
    if (outcome.status === "RESOLVED") {
      response[mention] = {
        status: "RESOLVED",
        userId: outcome.candidate.userId,
        contactId: outcome.candidate.contactId,
        displayName: outcome.candidate.displayName,
        confidence: outcome.confidence,
      };
    } else if (outcome.status === "AMBIGUOUS") {
      response[mention] = {
        status: "AMBIGUOUS",
        promptMessage: outcome.promptMessage,
        candidates: outcome.candidates.map((c) => ({
          contactId: c.candidate.contactId,
          userId: c.candidate.userId,
          displayName: c.candidate.displayName,
          score: c.score,
        })),
      };
    } else {
      response[mention] = { status: "NOT_FOUND" };
    }
  }

  return res.json(response);
});
