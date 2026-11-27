import { create as createAxios } from "axios";
import { API_BASE_URL, AuthService } from "./AuthService";
import { installMobileAuthRefresh } from "./mobileAuthRefresh";

export interface MaintenanceNotification {
  id: string;
  scheduleId?: string;
  kind:
    | "CREATED"
    | "DUE"
    | "OVERDUE"
    | "ODOMETER_BUFFER"
    | "FUEL_ANOMALY"
    | "ESCALATION"
    | "CRITICAL_ESCALATION"
    | "REPORT"
    | "GENERAL";
  message: string;
  title: string;
  createdAt: string;
  readAt: string | null;
  source: "maintenance" | "general";
  category: "MAINTENANCE" | "FUEL" | "REPORT" | "GENERAL";
  actionTarget: { type: string; id: string | null } | null;
}

export interface NotificationInboxPage {
  items: MaintenanceNotification[];
  nextCursor: string | null;
  counts: { total: number; unread: number };
}

export interface FuelAnomalyApproval {
  id: string;
  status: string;
  severity: string;
  efficiency: number;
  rollingAverage: number;
  note: string | null;
  acknowledgedAt: string | null;
  vehicle: { plateNumber: string };
}

const api = createAxios({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: {},
});
installMobileAuthRefresh(api, API_BASE_URL);
api.interceptors.request.use(async (config) => {
  const token = await new AuthService(API_BASE_URL).getAccessToken();
  if (!token) throw new Error("Please log in again.");
  config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export async function getNotifications(cursor?: string): Promise<NotificationInboxPage> {
  const response = await api.get<{
    items: {
      id: string;
      source: "general" | "maintenance";
      category: MaintenanceNotification["category"];
      title: string;
      message: string;
      isRead: boolean;
      createdAt: string;
      actionTarget: MaintenanceNotification["actionTarget"];
      scheduleId?: string;
    }[];
    nextCursor: string | null;
    counts: { total: number; unread: number };
  }>("/notifications/inbox", {
    params: { limit: 30, ...(cursor ? { cursor } : {}) },
  });
  return {
    ...response.data,
    items: response.data.items.map((item) => {
      const kind: MaintenanceNotification["kind"] =
        item.source === "maintenance"
          ? item.title === "New maintenance assignment"
            ? "CREATED"
            : item.title === "Maintenance overdue"
              ? "OVERDUE"
              : item.title === "Odometer reminder"
                ? "ODOMETER_BUFFER"
                : "DUE"
          : item.category === "FUEL"
            ? "FUEL_ANOMALY"
            : item.title === "Critical maintenance escalation"
              ? "CRITICAL_ESCALATION"
              : item.category === "MAINTENANCE"
                ? "ESCALATION"
                : item.category === "REPORT"
                  ? "REPORT"
                  : "GENERAL";
      return {
        ...item,
        kind,
        scheduleId:
          item.actionTarget?.type === "MAINTENANCE_SCHEDULE"
            ? item.actionTarget.id ?? undefined
            : item.scheduleId,
        readAt: item.isRead ? item.createdAt : null,
      };
    }),
  };
}

export async function markNotificationRead(
  id: string,
  source: MaintenanceNotification["source"],
): Promise<boolean> {
  const response = await api.patch<{ updated: number }>(
    `/notifications/inbox/${source}/${encodeURIComponent(id)}/read`,
  );
  return response.data.updated > 0;
}

export async function markAllNotificationsRead(): Promise<void> {
  await api.patch("/notifications/inbox/read-all");
}

export async function getFuelAnomalyApprovals(): Promise<FuelAnomalyApproval[]> {
  const response = await api.get<FuelAnomalyApproval[]>("/fuel/anomalies");
  return response.data;
}

export async function acknowledgeFuelAnomaly(id: string, remark?: string): Promise<void> {
  await api.post(`/fuel/anomalies/${encodeURIComponent(id)}/acknowledge`, { remark });
}
