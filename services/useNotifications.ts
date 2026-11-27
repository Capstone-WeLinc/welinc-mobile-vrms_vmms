import { useCallback, useEffect, useRef, useState } from "react";
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type MaintenanceNotification,
} from "./NotificationService";

export function useNotifications(userId: string | undefined) {
  const [notifications, setNotifications] = useState<MaintenanceNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [stateUserId, setStateUserId] = useState(userId);
  const currentUser = useRef(userId);
  const inFlight = useRef<string | null>(null);
  const requestSequence = useRef(0);
  const refresh = useCallback(async () => {
    if (!userId || inFlight.current) return;
    const requestId = `${userId}:refresh:${++requestSequence.current}`;
    inFlight.current = requestId;
    setLoading(true);
    try {
      const page = await getNotifications();
      if (currentUser.current !== userId) return;
      setNotifications(page.items);
      setNextCursor(page.nextCursor);
      setUnreadCount(page.counts.unread);
      setTotalCount(page.counts.total);
      setError(null);
    } catch {
      if (currentUser.current === userId) {
        setError("Unable to refresh notifications. Check your connection and pull down to retry.");
      }
    } finally {
      if (currentUser.current === userId) setLoading(false);
      if (inFlight.current === requestId) inFlight.current = null;
    }
  }, [userId]);
  const loadMore = useCallback(async () => {
    if (!userId || !nextCursor || inFlight.current) return;
    const requestId = `${userId}:more:${++requestSequence.current}`;
    inFlight.current = requestId;
    setLoadingMore(true);
    try {
      const page = await getNotifications(nextCursor);
      if (currentUser.current !== userId) return;
      setNotifications((current) => {
        const existing = new Set(current.map((item) => `${item.source}:${item.id}`));
        return [
          ...current,
          ...page.items.filter((item) => !existing.has(`${item.source}:${item.id}`)),
        ];
      });
      setNextCursor(page.nextCursor);
      setUnreadCount(page.counts.unread);
      setTotalCount(page.counts.total);
      setError(null);
    } catch {
      if (currentUser.current === userId) {
        setError("Unable to load older notifications. Please retry.");
      }
    } finally {
      if (currentUser.current === userId) setLoadingMore(false);
      if (inFlight.current === requestId) inFlight.current = null;
    }
  }, [nextCursor, userId]);
  useEffect(() => {
    const userChanged = currentUser.current !== userId;
    currentUser.current = userId;
    inFlight.current = null;
    if (userChanged) {
      setStateUserId(userId);
    }
    // Drop the previous user's notifications before loading the new user's data.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNotifications([]);
    setNextCursor(null);
    setUnreadCount(0);
    setTotalCount(0);
    setError(null);
    setLoading(false);
    setLoadingMore(false);
    if (!userId) return;
    void refresh();
    const interval = setInterval(() => { void refresh(); }, 30_000);
    return () => clearInterval(interval);
  }, [userId, refresh]);
  const markRead = async (notification: MaintenanceNotification) => {
    try {
      const updated = await markNotificationRead(notification.id, notification.source);
      if (currentUser.current === userId) {
        setError(null);
        setNotifications((items) =>
          items.map((item) =>
            item.id === notification.id && item.source === notification.source
              ? { ...item, readAt: item.readAt ?? new Date().toISOString() }
              : item,
          ),
        );
      }
      if (!notification.readAt && updated && currentUser.current === userId) {
        setUnreadCount((count) => Math.max(0, count - 1));
      }
    } catch {
      if (currentUser.current === userId) setError("Unable to mark notification as read. Please retry.");
    }
  };
  const markAllRead = async () => {
    try {
      await markAllNotificationsRead();
      if (currentUser.current !== userId) return;
      const readAt = new Date().toISOString();
      setNotifications((items) => items.map((item) => ({ ...item, readAt: item.readAt ?? readAt })));
      setUnreadCount(0);
      setError(null);
    } catch {
      if (currentUser.current === userId) setError("Unable to mark notifications as read. Please retry.");
    }
  };
  const hasCurrentUserData = stateUserId === userId;
  return {
    notifications: hasCurrentUserData ? notifications : [],
    loading: hasCurrentUserData ? loading : Boolean(userId),
    loadingMore: hasCurrentUserData && loadingMore,
    error: hasCurrentUserData ? error : null,
    refresh,
    loadMore,
    markRead,
    markAllRead,
    hasMore: hasCurrentUserData && nextCursor !== null,
    unreadCount: hasCurrentUserData ? unreadCount : 0,
    totalCount: hasCurrentUserData ? totalCount : 0,
  };
}
