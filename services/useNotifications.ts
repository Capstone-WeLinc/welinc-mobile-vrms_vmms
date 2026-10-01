import { useCallback, useEffect, useRef, useState } from "react";
import { getNotifications, markNotificationRead, type MaintenanceNotification } from "./NotificationService";

export function useNotifications(userId: string | undefined) {
  const [notifications, setNotifications] = useState<MaintenanceNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentUser = useRef(userId);
  currentUser.current = userId;
  const inFlight = useRef<string | null>(null);
  const refresh = useCallback(async () => {
    if (!userId || inFlight.current === userId) return;
    inFlight.current = userId;
    setLoading(true);
    try {
      const items = await getNotifications();
      if (currentUser.current !== userId) return;
      setNotifications(items);
      setError(null);
    } catch {
      if (currentUser.current === userId) setError("Unable to refresh notifications. Check your connection and pull down to retry.");
    } finally {
      if (currentUser.current === userId) setLoading(false);
      if (inFlight.current === userId) inFlight.current = null;
    }
  }, [userId]);
  useEffect(() => {
    setNotifications([]);
    setError(null);
    setLoading(false);
    if (!userId) return;
    void refresh();
  }, [userId, refresh]);
  const markRead = async (id: string) => {
    try {
      await markNotificationRead(id);
      if (currentUser.current === userId) setNotifications((items) => items.map((item) => item.id === id ? { ...item, readAt: item.readAt ?? new Date().toISOString() } : item));
    } catch {
      if (currentUser.current === userId) setError("Unable to mark notification as read. Please retry.");
    }
  };
  return { notifications, loading, error, refresh, markRead, unreadCount: notifications.filter((item) => !item.readAt).length };
}
