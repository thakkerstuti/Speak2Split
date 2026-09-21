import { Router, Response } from "express";
import { z } from "zod";
import { NotificationModel, NotificationPreferenceModel, NotificationDeviceModel } from "../db/models/Notification";
import { AuthedRequest, requireAuth } from "../auth/auth.router";

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get("/", async (req: AuthedRequest, res: Response) => {
  const notifications = await NotificationModel.find({ userId: req.userId })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  return res.json(notifications.map((n) => ({ ...n, id: String(n._id), _id: undefined })));
});

notificationsRouter.post("/:id/read", async (req: AuthedRequest, res: Response) => {
  const notification = await NotificationModel.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId },
    { $set: { readAt: new Date() } },
    { new: true }
  );
  if (!notification) return res.status(404).json({ error: "Notification not found" });
  return res.json({ id: String(notification._id), readAt: notification.readAt });
});

notificationsRouter.post("/read-all", async (req: AuthedRequest, res: Response) => {
  await NotificationModel.updateMany({ userId: req.userId, readAt: { $exists: false } }, { $set: { readAt: new Date() } });
  return res.json({ ok: true });
});

/** GET /notifications/preferences — returns effective settings, filling in defaults for anything unset. */
notificationsRouter.get("/preferences", async (req: AuthedRequest, res: Response) => {
  const prefs = await NotificationPreferenceModel.find({ userId: req.userId }).lean();
  return res.json(prefs.map((p) => ({ ...p, id: String(p._id), _id: undefined })));
});

const setPreferenceSchema = z.object({
  type: z.enum([
    "EXPENSE_ADDED", "EXPENSE_EDITED", "EXPENSE_DELETED", "PAYMENT_REMINDER", "SETTLEMENT_CREATED",
    "SETTLEMENT_COMPLETED", "GROUP_INVITATION", "MEMBER_JOINED", "RECURRING_EXPENSE_CREATED",
    "COMMENT_ADDED", "SHOPPING_ITEM_UPDATED", "OTHER",
  ]),
  channel: z.enum(["IN_APP", "PUSH", "EMAIL", "WHATSAPP"]),
  enabled: z.boolean(),
});

notificationsRouter.put("/preferences", async (req: AuthedRequest, res: Response) => {
  const parsed = setPreferenceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
  const { type, channel, enabled } = parsed.data;

  const pref = await NotificationPreferenceModel.findOneAndUpdate(
    { userId: req.userId, type, channel },
    { $set: { enabled } },
    { upsert: true, new: true }
  );
  return res.json(pref!.toJSON());
});

const registerDeviceSchema = z.object({
  expoPushToken: z.string().min(1),
  platform: z.enum(["ios", "android"]),
});

/** POST /notifications/devices — mobile app registers its Expo push token on launch. */
notificationsRouter.post("/devices", async (req: AuthedRequest, res: Response) => {
  const parsed = registerDeviceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });

  const device = await NotificationDeviceModel.findOneAndUpdate(
    { expoPushToken: parsed.data.expoPushToken },
    { $set: { userId: req.userId, platform: parsed.data.platform, lastSeenAt: new Date() } },
    { upsert: true, new: true }
  );
  return res.status(201).json(device!.toJSON());
});
