import axios from "axios";
import { API_BASE_URL, AuthService } from "./AuthService";

export interface MaintenanceNotification {
  id: string;
  scheduleId: string;
  kind: "CREATED" | "DUE" | "OVERDUE" | "ODOMETER_BUFFER";
  message: string;
  createdAt: string;
  readAt: string | null;
}

const api = axios.create({ baseURL: API_BASE_URL, timeout: 15000 });
api.interceptors.request.use(async (config) => {
  const token = await new AuthService(API_BASE_URL).getAccessToken();
  if (!token) throw new Error("Please log in again.");
  config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export async function getNotifications(): Promise<MaintenanceNotification[]> {
  const response = await api.get<MaintenanceNotification[]>("/maintenance-schedules/notifications");
  return response.data;
}

export async function markNotificationRead(id: string): Promise<void> {
  await api.patch(`/maintenance-schedules/notifications/${encodeURIComponent(id)}/read`);
}
