import { NotificationModel, NotificationPreferenceModel, NotificationDeviceModel } from "../db/models/Notification";
import { GroupMemberModel } from "../db/models/Group";
import { UserModel } from "../db/models/User";
import { sendPushNotification, sendEmail, sendWhatsAppTemplate, NotConfiguredError } from "./channels";
import { broadcastToGroup } from "../realtime/socket";

export type NotificationType =
  | "EXPENSE_ADDED"
  | "EXPENSE_EDITED"
  | "EXPENSE_DELETED"
  | "PAYMENT_REMINDER"
  | "SETTLEMENT_CREATED"
  | "SETTLEMENT_COMPLETED"
  | "GROUP_INVITATION"
  | "MEMBER_JOINED"
  | "RECURRING_EXPENSE_CREATED"
  | "COMMENT_ADDED"
  | "SHOPPING_ITEM_UPDATED"
  | "OTHER";

export type NotificationChannel = "IN_APP" | "PUSH" | "EMAIL" | "WHATSAPP";

interface NotifyInput {
  userId: string;
  groupId?: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/**
 * Determines which channels are enabled for this user+type. Defaults to
 * IN_APP + PUSH enabled, EMAIL/WHATSAPP disabled, when the user has never
 * set a preference.
 */
async function resolveEnabledChannels(userId: string, type: NotificationType): Promise<Set<NotificationChannel>> {
  const prefs = await NotificationPreferenceModel.find({ userId, type }).lean();
  const explicit = new Map(prefs.map((p) => [p.channel, p.enabled]));

  const defaults: Record<NotificationChannel, boolean> = { IN_APP: true, PUSH: true, EMAIL: false, WHATSAPP: false };
  const enabled = new Set<NotificationChannel>();
  for (const channel of Object.keys(defaults) as NotificationChannel[]) {
    const isEnabled = explicit.has(channel) ? explicit.get(channel)! : defaults[channel];
    if (isEnabled) enabled.add(channel);
  }
  return enabled;
}

/**
 * Core orchestration entrypoint: create the notification record (with an
 * embedded, growing `deliveries` array — one push per attempted channel),
 * then attempt delivery through every channel the user has enabled for
 * this notification type.
 */
export async function notify(input: NotifyInput): Promise<{ notificationId: string }> {
  const notification = await NotificationModel.create({
    userId: input.userId,
    groupId: input.groupId,
    type: input.type,
    title: input.title,
    body: input.body,
    data: input.data,
    deliveries: [],
  });
  const notificationId = String(notification._id);

  const enabledChannels = await resolveEnabledChannels(input.userId, input.type);

  if (enabledChannels.has("IN_APP")) {
    await recordDelivery(notificationId, "IN_APP", "DELIVERED");
  }

  if (input.groupId) {
    broadcastToGroup(input.groupId, "notification_created", { notificationId, ...input });
  }

  if (enabledChannels.has("PUSH")) {
    const devices = await NotificationDeviceModel.find({ userId: input.userId }).lean();
    if (devices.length === 0) {
      await recordDelivery(notificationId, "PUSH", "SKIPPED_NOT_CONFIGURED", undefined, "No registered device for this user");
      await attemptFallback(input, notificationId, enabledChannels);
    } else {
      for (const device of devices) {
        try {
          const result = await sendPushNotification(device.expoPushToken, input.title, input.body, input.data);
          await recordDelivery(notificationId, "PUSH", "SENT", result.providerRef);
        } catch (err) {
          await recordDelivery(notificationId, "PUSH", "FAILED", undefined, (err as Error).message);
          await attemptFallback(input, notificationId, enabledChannels);
        }
      }
    }
  }

  if (enabledChannels.has("EMAIL") && !enabledChannels.has("PUSH")) {
    await deliverEmail(input, notificationId);
  }

  if (enabledChannels.has("WHATSAPP")) {
    await deliverWhatsApp(input, notificationId);
  }

  return { notificationId };
}

async function attemptFallback(input: NotifyInput, notificationId: string, enabledChannels: Set<NotificationChannel>) {
  if (enabledChannels.has("EMAIL")) {
    await deliverEmail(input, notificationId);
  }
}

async function deliverEmail(input: NotifyInput, notificationId: string) {
  const user = await UserModel.findById(input.userId).lean();
  if (!user?.email) {
    await recordDelivery(notificationId, "EMAIL", "SKIPPED_NOT_CONFIGURED", undefined, "User has no email on file");
    return;
  }
  try {
    const result = await sendEmail(user.email, input.title, `<p>${input.body}</p>`);
    await recordDelivery(notificationId, "EMAIL", "SENT", result.providerRef);
  } catch (err) {
    if (err instanceof NotConfiguredError) {
      await recordDelivery(notificationId, "EMAIL", "SKIPPED_NOT_CONFIGURED", undefined, err.message);
    } else {
      await recordDelivery(notificationId, "EMAIL", "FAILED", undefined, (err as Error).message);
    }
  }
}

async function deliverWhatsApp(input: NotifyInput, notificationId: string) {
  const user = await UserModel.findById(input.userId).lean();
  if (!user?.phone) {
    await recordDelivery(notificationId, "WHATSAPP", "SKIPPED_NOT_CONFIGURED", undefined, "User has no phone on file");
    return;
  }
  try {
    const result = await sendWhatsAppTemplate(user.phone, "speak2split_notification", "en", [input.title, input.body]);
    await recordDelivery(notificationId, "WHATSAPP", "SENT", result.providerRef);
  } catch (err) {
    if (err instanceof NotConfiguredError) {
      await recordDelivery(notificationId, "WHATSAPP", "SKIPPED_NOT_CONFIGURED", undefined, err.message);
    } else {
      await recordDelivery(notificationId, "WHATSAPP", "FAILED", undefined, (err as Error).message);
    }
  }
}

async function recordDelivery(
  notificationId: string,
  channel: NotificationChannel,
  status: "SENT" | "DELIVERED" | "FAILED" | "SKIPPED_PREFERENCE" | "SKIPPED_NOT_CONFIGURED",
  providerRef?: string,
  error?: string
) {
  await NotificationModel.updateOne(
    { _id: notificationId },
    {
      $push: {
        deliveries: {
          channel,
          status,
          providerRef,
          error,
          attemptedAt: new Date(),
          deliveredAt: status === "DELIVERED" || status === "SENT" ? new Date() : undefined,
        },
      },
    }
  );
}

/** Notify every ACTIVE member of a group except one (typically the actor). */
export async function notifyGroupMembers(
  groupId: string,
  excludeUserId: string,
  type: NotificationType,
  title: string,
  body: string,
  data?: Record<string, unknown>
) {
  const members = await GroupMemberModel.find({ groupId, status: "ACTIVE", userId: { $ne: excludeUserId } }).lean();
  await Promise.all(members.map((m) => notify({ userId: String(m.userId), groupId, type, title, body, data })));
}
