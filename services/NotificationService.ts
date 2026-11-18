import { create as createAxios } from "axios";
import { API_BASE_URL, AuthService } from "./AuthService";
import { installMobileAuthRefresh } from "./mobileAuthRefresh";

export interface MaintenanceNotification {
  id: string;
  scheduleId?: string;
  kind: "CREATED" | "DUE" | "OVERDUE" | "ODOMETER_BUFFER" | "FUEL_ANOMALY" | "ESCALATION" | "CRITICAL_ESCALATION";
  message: string;
  createdAt: string;
  readAt: string | null;
  source: "maintenance" | "general";
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

export async function getNotifications(): Promise<MaintenanceNotification[]> {
  const [maintenanceResponse, generalResponse] = await Promise.all([
    api.get<(Omit<MaintenanceNotification, "source"> & { scheduleId: string })[]>("/maintenance-schedules/notifications"),
    api.get<{ id: string; title: string; message: string; type: string; isRead: boolean; createdAt: string; maintenanceScheduleId?: string | null }[]>("/notifications"),
  ]);
  const maintenance = maintenanceResponse.data.map((item) => ({ ...item, source: "maintenance" as const }));
  const general = generalResponse.data.flatMap((item) => {
    const kind: MaintenanceNotification["kind"] | null = /fuel.*anomaly|anomaly.*fuel/i.test(item.title)
      ? "FUEL_ANOMALY"
      : item.title === "Critical maintenance escalation"
        ? "CRITICAL_ESCALATION"
        : /maintenance overdue/i.test(item.title)
          ? "ESCALATION"
          : null;
    if (!kind) return [];
    return [{
      id: item.id,
      scheduleId: item.maintenanceScheduleId ?? undefined,
      kind,
      message: `${item.title}: ${item.message}`,
      createdAt: item.createdAt,
      readAt: item.isRead ? item.createdAt : null,
      source: "general" as const,
    }];
  });
  return [...maintenance, ...general].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function markNotificationRead(id: string, source: MaintenanceNotification["source"]): Promise<void> {
  if (source === "maintenance") {
    await api.patch(`/maintenance-schedules/notifications/${encodeURIComponent(id)}/read`);
    return;
  }
  await api.patch(`/notifications/${encodeURIComponent(id)}/read`);
}

export async function getFuelAnomalyApprovals(): Promise<FuelAnomalyApproval[]> {
  const response = await api.get<FuelAnomalyApproval[]>("/fuel/anomalies");
  return response.data;
}

export async function acknowledgeFuelAnomaly(id: string, remark?: string): Promise<void> {
  await api.post(`/fuel/anomalies/${encodeURIComponent(id)}/acknowledge`, { remark });
}
