import axios, { type AxiosInstance } from "axios";
import * as SecureStore from "expo-secure-store";
import {
  ACCESS_TOKEN_KEY,
  REFRESH_TOKEN_KEY,
  USER_KEY,
  installMobileAuthRefresh,
} from "./mobileAuthRefresh";
import { getMobileAccessRole } from "./mobileAccessRole";
export { getMobileAccessRole } from "./mobileAccessRole";

const DEFAULT_API_BASE_URL = "http://localhost:3000";

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL?.trim().replace(/\/$/, "") ||
  DEFAULT_API_BASE_URL;

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  contact: string | null;
  profilePicture: string | null;
  roles: Array<{ role: string; system: string }>;
}

export interface MobileUserSummary {
  id: string;
  name: string;
  roles: Array<{ role: string; system: string }>;
}

interface BackendUserSummary {
  id?: unknown;
  name?: unknown;
  role?: unknown;
  rawRoles?: unknown;
  status?: unknown;
}

export type { MobileAccessRole } from "./mobileAccessRole";

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthenticatedUser;
}

export class AuthService {
  private readonly api: AxiosInstance;

  constructor(apiBaseUrl: string = API_BASE_URL) {
    this.api = axios.create({
      baseURL: apiBaseUrl,
      timeout: 15_000,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-VMMS-Client": "mobile",
      },
    });
    installMobileAuthRefresh(this.api, apiBaseUrl);
  }

  async login(email: string, password: string): Promise<AuthenticatedUser> {
    try {
      const response = await this.api.post<LoginResponse>("/auth/login", {
        email: email.trim().toLowerCase(),
        password,
      });
      const { accessToken, refreshToken, user } = response.data;
      if (!accessToken || !refreshToken || !isAuthenticatedUser(user)) {
        throw new Error("The backend returned an invalid login response");
      }

      if (getMobileAccessRole(user.roles) === "none") {
        await this.clearSession();
        throw new Error(
          "Only mechanics and chief mechanics can use this mobile version.",
        );
      }

      await Promise.all([
        SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken),
        SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken),
        SecureStore.setItemAsync(USER_KEY, JSON.stringify(user)),
      ]);
      return user;
    } catch (error) {
      console.error("[Auth] Login failed", error);
      throw new Error(getAuthErrorMessage(error));
    }
  }

  /**
   * Restore an existing session. If the server is unreachable, retain the stored
   * user so already-synchronized data remains available offline.
   */
  async restoreSession(): Promise<AuthenticatedUser | null> {
    const [token, userJson] = await Promise.all([
      this.getAccessToken(),
      SecureStore.getItemAsync(USER_KEY),
    ]);
    if (!token || !userJson) return null;

    let storedUser: AuthenticatedUser;
    try {
      const parsed: unknown = JSON.parse(userJson);
      if (!isAuthenticatedUser(parsed)) throw new Error("Invalid stored user");
      storedUser = parsed;
    } catch {
      await this.clearSession();
      return null;
    }

    if (getMobileAccessRole(storedUser.roles) === "none") {
      await this.clearSession();
      return null;
    }

    try {
      const response = await this.api.get<AuthenticatedUser>("/auth/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!isAuthenticatedUser(response.data))
        throw new Error("Invalid profile response");
      if (getMobileAccessRole(response.data.roles) === "none") {
        await this.clearSession();
        return null;
      }
      await SecureStore.setItemAsync(USER_KEY, JSON.stringify(response.data));
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        if (error.response.status === 401 || error.response.status === 403) {
          await this.clearSession();
          return null;
        }
      }
      console.info("[Auth] Backend unavailable; restoring the offline session");
      return storedUser;
    }
  }

  getAccessToken(): Promise<string | null> {
    return SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
  }

  async recordLogout(): Promise<void> {
    const [token, refreshToken, userJson] = await Promise.all([
      this.getAccessToken(),
      SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
      SecureStore.getItemAsync(USER_KEY),
    ]);
    if (!token || !userJson) return;
    try {
      await this.api.post(
        "/auth/logout",
        { refreshToken },
        { headers: { Authorization: `Bearer ${token}` } },
      );
    } catch (error) {
      console.warn("[Auth] Unable to record logout activity", error);
    }
  }

  async updateOwnProfile(
    profile: Pick<AuthenticatedUser, "name" | "email" | "contact">,
  ): Promise<AuthenticatedUser> {
    const token = await this.getAccessToken();
    if (!token) throw new Error("Your session has expired. Please log in again.");

    const response = await this.api.patch<AuthenticatedUser>(
      "/auth/profile",
      profile,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!isAuthenticatedUser(response.data)) {
      throw new Error("The backend returned an invalid profile response");
    }

    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(response.data));
    return response.data;
  }

  async changeOwnPassword(input: {
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
  }): Promise<void> {
    const token = await this.getAccessToken();
    if (!token) throw new Error("Please log in again.");
    await this.api.patch("/auth/profile/password", input, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  async getChiefMechanics(): Promise<MobileUserSummary[]> {
    const token = await this.getAccessToken();
    if (!token) return [];

    try {
      const response = await this.api.get<unknown>("/users", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const users = Array.isArray(response.data)
        ? response.data
        : typeof response.data === "object" &&
            response.data !== null &&
            "users" in response.data
          ? (response.data as { users?: unknown }).users
          : [];

      return (Array.isArray(users) ? users : [])
        .map(toMobileUserSummary)
        .filter(
          (candidate): candidate is MobileUserSummary => candidate !== null,
        )
        .filter(
          (candidate) =>
            getMobileAccessRole(candidate.roles) === "chiefMechanic",
        );
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        return [];
      }
      console.warn("[Auth] Chief mechanic account lookup failed", error);
      return [];
    }
  }

  async updateMaintenanceProgress(
    scheduleId: string,
    progress: Record<string, unknown>,
  ): Promise<{ status: string; workOrderProgress: Record<string, unknown> }> {
    const token = await this.getAccessToken();
    if (!token) throw new Error("Please log in again.");
    const response = await this.api.patch(
      `/maintenance-schedules/${scheduleId}/progress`, progress,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    return response.data;
  }

  async uploadMaintenanceAttachment(
    scheduleId: string,
    itemId: string,
    file: { uri: string; name: string; type: string },
  ): Promise<{ id: string; name: string; sizeMb: number; contentType: string; storageName: string }> {
    const token = await this.getAccessToken();
    if (!token) throw new Error("Please log in again.");
    const body = new FormData();
    body.append("itemId", itemId);
    body.append("file", file as unknown as Blob);
    const response = await this.api.post(
      `/maintenance-schedules/${scheduleId}/attachments`,
      body,
      { headers: { Authorization: `Bearer ${token}`, "Content-Type": "multipart/form-data" } },
    );
    return response.data;
  }

  async deleteMaintenanceAttachment(scheduleId: string, attachmentId: string): Promise<void> {
    const token = await this.getAccessToken();
    if (!token) throw new Error("Please log in again.");
    await this.api.delete(
      `/maintenance-schedules/${scheduleId}/attachments/${attachmentId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
  }

  async downloadMaintenanceAttachment(
    scheduleId: string,
    attachmentId: string,
  ): Promise<Uint8Array> {
    const token = await this.getAccessToken();
    if (!token) throw new Error("Please log in again.");
    const response = await this.api.get<ArrayBuffer>(
      `/maintenance-schedules/${scheduleId}/attachments/${attachmentId}`,
      {
        responseType: "arraybuffer",
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    return new Uint8Array(response.data);
  }

  async clearSession(): Promise<void> {
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
      SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
      SecureStore.deleteItemAsync(USER_KEY),
    ]);
  }

}

function isAuthenticatedUser(value: unknown): value is AuthenticatedUser {
  if (typeof value !== "object" || value === null) return false;
  const user = value as Partial<AuthenticatedUser>;
  return (
    typeof user.id === "string" &&
    typeof user.name === "string" &&
    typeof user.email === "string" &&
    Array.isArray(user.roles)
  );
}

function toMobileUserSummary(value: unknown): MobileUserSummary | null {
  if (typeof value !== "object" || value === null) return null;

  const candidate = value as BackendUserSummary;
  if (typeof candidate.id !== "string" || typeof candidate.name !== "string") {
    return null;
  }

  const rawRoles = Array.isArray(candidate.rawRoles)
    ? candidate.rawRoles
    : typeof candidate.role === "string"
      ? [{ role: candidate.role, system: "VMMS" }]
      : [];
  const roles = rawRoles
    .filter(
      (role): role is { role: string; system?: string } =>
        typeof role === "object" &&
        role !== null &&
        typeof (role as { role?: unknown }).role === "string",
    )
    .map((role) => ({
      role: role.role,
      system: typeof role.system === "string" ? role.system : "VMMS",
    }));

  return { id: candidate.id, name: candidate.name, roles };
}

function getAuthErrorMessage(error: unknown): string {
  if (!axios.isAxiosError(error)) {
    return error instanceof Error ? error.message : "Unable to sign in";
  }
  if (!error.response) {
    return error.code === "ECONNABORTED"
      ? "The backend request timed out."
      : `Cannot reach the backend at ${API_BASE_URL}.`;
  }

  const data: unknown = error.response.data;
  if (typeof data === "object" && data !== null && "message" in data) {
    const message = (data as { message?: unknown }).message;
    if (typeof message === "string") return message;
    if (Array.isArray(message))
      return message.filter((item) => typeof item === "string").join("\n");
  }
  return `Login failed with status ${error.response.status}.`;
}
