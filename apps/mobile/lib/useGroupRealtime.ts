import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getSocket } from "./realtime";

/**
 * Subscribes the current screen to real-time events for one group, and
 * invalidates the relevant TanStack Query caches so the UI refetches
 * automatically — no manual pull-to-refresh needed. Joins the group's
 * Socket.IO room on mount and leaves it on unmount, so switching between
 * groups never leaves stale room memberships accumulating on the socket.
 *
 * Duplicate-event protection: the server can occasionally redeliver an
 * event after a reconnect (e.g. socket.io's own at-least-once semantics
 * during a flaky connection); we dedupe by a short-lived seen-ids cache
 * keyed on event+id so a re-delivered event doesn't invalidate/refetch
 * twice in the same render cycle.
 */
export function useGroupRealtime(groupId: string | undefined) {
  const queryClient = useQueryClient();
  const seenEventIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!groupId) return;
    const socket = getSocket();
    if (!socket) return; // not authenticated / not connected yet — screens still work via normal fetch

    socket.emit("join_group", groupId);

    const onJoinGroupError = (payload: { groupId: string; error: string }) => {
      if (payload.groupId === groupId) {
        // eslint-disable-next-line no-console
        console.warn(`Real-time updates unavailable for this group: ${payload.error}`);
      }
    };
    socket.on("join_group_error", onJoinGroupError);

    const dedupe = (key: string, fn: () => void) => {
      if (seenEventIds.current.has(key)) return;
      seenEventIds.current.add(key);
      // Small cleanup window — we only need to dedupe bursts around a
      // reconnect, not remember every event ever seen for this session.
      setTimeout(() => seenEventIds.current.delete(key), 5000);
      fn();
    };

    const onExpenseAdded = (payload: { expenseId: string }) =>
      dedupe(`expense_added:${payload.expenseId}`, () => {
        queryClient.invalidateQueries({ queryKey: ["expenses", groupId] });
        queryClient.invalidateQueries({ queryKey: ["balances", groupId] });
      });

    const onExpenseUpdated = (payload: { expenseId: string }) =>
      dedupe(`expense_updated:${payload.expenseId}`, () => {
        queryClient.invalidateQueries({ queryKey: ["expenses", groupId] });
        queryClient.invalidateQueries({ queryKey: ["balances", groupId] });
      });

    const onExpenseDeleted = (payload: { expenseId: string }) =>
      dedupe(`expense_deleted:${payload.expenseId}`, () => {
        queryClient.invalidateQueries({ queryKey: ["expenses", groupId] });
        queryClient.invalidateQueries({ queryKey: ["balances", groupId] });
      });

    const onSettlementCreated = (payload: { id: string }) =>
      dedupe(`settlement_created:${payload.id}`, () => {
        queryClient.invalidateQueries({ queryKey: ["balances", groupId] });
      });

    const onSettlementCompleted = (payload: { id: string }) =>
      dedupe(`settlement_completed:${payload.id}`, () => {
        queryClient.invalidateQueries({ queryKey: ["balances", groupId] });
      });

    const onMemberJoined = () => {
      queryClient.invalidateQueries({ queryKey: ["group", groupId] });
    };

    const onGroupUpdated = () => {
      queryClient.invalidateQueries({ queryKey: ["group", groupId] });
    };

    const onRecurringCreated = (payload: { expenseId: string }) =>
      dedupe(`recurring_expense_created:${payload.expenseId}`, () => {
        queryClient.invalidateQueries({ queryKey: ["expenses", groupId] });
        queryClient.invalidateQueries({ queryKey: ["balances", groupId] });
        queryClient.invalidateQueries({ queryKey: ["recurring", groupId] });
      });

    const onShoppingItemUpdated = () => {
      queryClient.invalidateQueries({ queryKey: ["shopping", groupId] });
    };

    const onNotificationCreated = () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    };

    socket.on("expense_added", onExpenseAdded);
    socket.on("expense_updated", onExpenseUpdated);
    socket.on("expense_deleted", onExpenseDeleted);
    socket.on("settlement_created", onSettlementCreated);
    socket.on("settlement_completed", onSettlementCompleted);
    socket.on("member_joined", onMemberJoined);
    socket.on("group_updated", onGroupUpdated);
    socket.on("recurring_expense_created", onRecurringCreated);
    socket.on("shopping_item_updated", onShoppingItemUpdated);
    socket.on("notification_created", onNotificationCreated);

    return () => {
      socket.emit("leave_group", groupId);
      socket.off("join_group_error", onJoinGroupError);
      socket.off("expense_added", onExpenseAdded);
      socket.off("expense_updated", onExpenseUpdated);
      socket.off("expense_deleted", onExpenseDeleted);
      socket.off("settlement_created", onSettlementCreated);
      socket.off("settlement_completed", onSettlementCompleted);
      socket.off("member_joined", onMemberJoined);
      socket.off("group_updated", onGroupUpdated);
      socket.off("recurring_expense_created", onRecurringCreated);
      socket.off("shopping_item_updated", onShoppingItemUpdated);
      socket.off("notification_created", onNotificationCreated);
    };
  }, [groupId, queryClient]);
}
