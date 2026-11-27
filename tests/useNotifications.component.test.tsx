import { act, render, waitFor } from "@testing-library/react-native";
import { useEffect } from "react";
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationInboxPage,
} from "../services/NotificationService";
import { useNotifications } from "../services/useNotifications";

jest.mock("../services/NotificationService", () => ({
  getNotifications: jest.fn(),
  markAllNotificationsRead: jest.fn(),
  markNotificationRead: jest.fn(),
}));

const mockedGetNotifications = jest.mocked(getNotifications);
const mockedMarkNotificationRead = jest.mocked(markNotificationRead);
const mockedMarkAllNotificationsRead = jest.mocked(markAllNotificationsRead);
let currentState: ReturnType<typeof useNotifications> | null = null;

function NotificationsHookHarness({ userId }: { userId: string }) {
  const state = useNotifications(userId);
  useEffect(() => {
    currentState = state;
  }, [state]);
  return null;
}

function getCurrentState() {
  if (!currentState) throw new Error("The notification hook has not rendered.");
  return currentState;
}

function notification(id: string) {
  return {
    id,
    source: "general" as const,
    kind: "FUEL_ANOMALY" as const,
    category: "FUEL" as const,
    title: "Fuel efficiency anomaly",
    message: "A fuel anomaly needs review.",
    createdAt: "2026-11-28T01:00:00.000Z",
    readAt: null,
    actionTarget: { type: "FUEL_MANAGEMENT", id },
  };
}

function page(id: string): NotificationInboxPage {
  return {
    items: [notification(id)],
    nextCursor: null,
    counts: { total: 1, unread: 1 },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

beforeEach(() => {
  jest.clearAllMocks();
  currentState = null;
  mockedMarkAllNotificationsRead.mockResolvedValue(undefined);
});

test("hides the previous account inbox immediately and ignores its stale response", async () => {
  const firstUserPage = deferred<NotificationInboxPage>();
  const secondUserPage = deferred<NotificationInboxPage>();
  mockedGetNotifications
    .mockReturnValueOnce(firstUserPage.promise)
    .mockReturnValueOnce(secondUserPage.promise);

  const view = await render(<NotificationsHookHarness userId="user-a" />);
  await waitFor(() => expect(mockedGetNotifications).toHaveBeenCalledTimes(1));

  await act(async () => view.rerender(<NotificationsHookHarness userId="user-b" />));
  expect(getCurrentState().notifications).toEqual([]);
  expect(getCurrentState().unreadCount).toBe(0);
  await waitFor(() => expect(mockedGetNotifications).toHaveBeenCalledTimes(2));

  await act(async () => firstUserPage.resolve(page("user-a-notification")));
  expect(getCurrentState().notifications).toEqual([]);

  await act(async () => secondUserPage.resolve(page("user-b-notification")));
  expect(getCurrentState().notifications.map((item) => item.id)).toEqual([
    "user-b-notification",
  ]);
});

test("keeps a failed mark-read retryable and clears the error after retry succeeds", async () => {
  const item = notification("notification-1");
  mockedGetNotifications.mockResolvedValue(page(item.id));
  mockedMarkNotificationRead
    .mockRejectedValueOnce(new Error("Read update failed"))
    .mockResolvedValueOnce(true);

  await render(<NotificationsHookHarness userId="user-a" />);
  await waitFor(() => expect(getCurrentState().notifications).toHaveLength(1));

  await act(async () => getCurrentState().markRead(item));
  expect(getCurrentState().error).toContain("Unable to mark notification as read");
  expect(getCurrentState().notifications[0].readAt).toBeNull();
  expect(getCurrentState().unreadCount).toBe(1);

  await act(async () => getCurrentState().markRead(item));
  expect(getCurrentState().error).toBeNull();
  expect(getCurrentState().notifications[0].readAt).not.toBeNull();
  expect(getCurrentState().unreadCount).toBe(0);
  expect(mockedMarkNotificationRead).toHaveBeenCalledTimes(2);
});
