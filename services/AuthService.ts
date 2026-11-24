import { create as createAxios, isAxiosError, type AxiosInstance } from "axios";
import * as SecureStore from "expo-secure-store";
import {
  ACCESS_TOKEN_KEY,
  REFRESH_TOKEN_KEY,
  USER_KEY,
  installMobileAuthRefresh,
  MOBILE_CLIENT_ID,
  refreshAccessToken,
} from "./mobileAuthRefresh";
import { Platform } from "react-native";

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
  roles: { role: string; system: string }[];
}

export type MobileAccessRole = "mechanic" | "chiefMechanic";

export interface MobileUserSummary {
  id: string;
  name: string;
  roles: { role: string; system: string }[];
  temporaryRoles?: string[];
}

export interface MobileRepairReferral {
  id: string;
  status: "QUEUED" | "SENT" | "FAILED" | "ACCEPTED" | "REJECTED" | "CANCELLED";
  repairTicketId: string | null;
  repairTicketNumber: string | null;
  repairStatus: string | null;
  outsideShopName: string | null;
  outcomeReason: string | null;
  lastErrorCode: string | null;
  createdAt?: string;
}

export interface MaintenanceScheduleExtensionRequest {
  id: string;
  actorName: string;
  requestedDueDate: string;
  reason: string;
  reviewStatus: "PENDING" | "APPROVED" | "REJECTED";
  reviewedByName: string | null;
  reviewReason: string | null;
  requestedAt: string;
  reviewedAt: string | null;
}

export interface MaintenanceScheduleExtensionHistory {
  currentTargetDueDate: string | null;
  requests: MaintenanceScheduleExtensionRequest[];
}

export interface CreatedMaintenanceScheduleExtension
  extends Omit<MaintenanceScheduleExtensionRequest, "reviewedByName" | "reviewReason" | "reviewedAt"> {
  scheduleId: string;
}

interface BackendUserSummary {
  id?: unknown;
  userId?: unknown;
  name?: unknown;
  role?: unknown;
  roles?: unknown;
  temporaryRoles?: unknown;
  status?: unknown;
}

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthenticatedUser;
}

export type EmailVerificationChallenge = {
  status: "EMAIL_VERIFICATION_REQUIRED";
  challengeId: string;
  email: string;
  resendAfter: string;
};
type MobileLoginResponse = LoginResponse | EmailVerificationChallenge;

export class AuthService {
  private readonly api: AxiosInstance;

  constructor(apiBaseUrl: string = API_BASE_URL) {
    this.api = createAxios({
      baseURL: apiBaseUrl,
      timeout: 15_000,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });
    installMobileAuthRefresh(this.api, apiBaseUrl);
  }

  async login(email: string, password: string): Promise<AuthenticatedUser | EmailVerificationChallenge> {
    try {
      const response = await this.api.post<MobileLoginResponse>("/auth/mobile/login", {
        email: email.trim().toLowerCase(),
        password,
        clientId: MOBILE_CLIENT_ID,
        deviceName: `${Platform.OS} device`,
      });
      if ("challengeId" in response.data) return response.data;
      await this.storeMobileSession(response.data);
      return response.data.user;
    } catch (error) {
      console.error("[Auth] Login failed", error);
      throw new Error(getAuthErrorMessage(error));
    }
  }

  async verifyEmail(challengeId: string, code: string): Promise<AuthenticatedUser> {
    try {
      const response = await this.api.post<LoginResponse>("/auth/mobile/login/verify-email", {
        challengeId,
        code,
        clientId: MOBILE_CLIENT_ID,
        deviceName: `${Platform.OS} device`,
      });
      await this.storeMobileSession(response.data);
      return response.data.user;
    } catch (error) {
      throw new Error(getAuthErrorMessage(error));
    }
  }

  async resendEmailCode(challengeId: string): Promise<void> {
    try {
      await this.api.post("/auth/mobile/login/verify-email/resend", { challengeId });
    } catch (error) {
      throw new Error(getAuthErrorMessage(error));
    }
  }

  async requestPasswordReset(email: string): Promise<void> {
    try {
      await this.api.post("/auth/forgot-password", {
        email: email.trim().toLowerCase(),
      });
    } catch (error) {
      throw new Error(
        getAuthErrorMessage(error, "Unable to request a password reset.", "Password reset request"),
      );
    }
  }

  async verifyPasswordResetCode(email: string, otp: string): Promise<void> {
    try {
      await this.api.post("/auth/verify-otp", {
        email: email.trim().toLowerCase(),
        otp: otp.trim(),
      });
    } catch (error) {
      throw new Error(
        getAuthErrorMessage(error, "Unable to verify the reset code.", "Code verification"),
      );
    }
  }

  async resetPassword(input: {
    email: string;
    otp: string;
    newPassword: string;
  }): Promise<void> {
    try {
      await this.api.post("/auth/reset-password", {
        email: input.email.trim().toLowerCase(),
        otp: input.otp.trim(),
        newPassword: input.newPassword,
      });
    } catch (error) {
      throw new Error(
        getAuthErrorMessage(error, "Unable to reset the password.", "Password reset"),
      );
    }
  }

  private async storeMobileSession(answer: LoginResponse): Promise<void> {
    const { accessToken, refreshToken, user } = answer;
    if (!accessToken || !refreshToken || !isAuthenticatedUser(user)) {
        throw new Error("The backend returned an invalid login response");
    }
    await Promise.all([
        SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken),
        SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken),
        SecureStore.setItemAsync(USER_KEY, JSON.stringify(user)),
    ]);
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

    try {
      await refreshAccessToken(API_BASE_URL);
      return storedUser;
    } catch (error) {
      if (isAxiosError(error) && error.response) {
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
    const [refreshToken, userJson] = await Promise.all([
      SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
      SecureStore.getItemAsync(USER_KEY),
    ]);
    if (!refreshToken || !userJson) return;
    try {
      await this.api.post(
        "/auth/logout",
        { refreshToken, clientId: MOBILE_CLIENT_ID },
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
      const response = await this.api.get<unknown>("/mechanics", {
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
        .filter((candidate) => candidate.roles.some((role) =>
          role.system === "VMMS" && role.role === "CHIEF_MECHANIC" &&
          !(candidate as MobileUserSummary & { temporaryRoles?: string[] }).temporaryRoles?.includes(role.role)));
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 401) {
        return [];
      }
      console.warn("[Auth] Chief mechanic account lookup failed", error);
      return [];
    }
  }

  async updateMaintenanceProgress(
    scheduleId: string,
    progress: Record<string, unknown>,
  ): Promise<{
    status: string;
    workOrderProgress: Record<string, unknown>;
    repairReferral?: MobileRepairReferral | null;
  }> {
    const token = await this.getAccessToken();
    if (!token) throw new Error("Please log in again.");
    const response = await this.api.patch(
      `/maintenance-schedules/${scheduleId}/progress`, progress,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    return response.data;
  }

  async requestMaintenanceScheduleExtension(
    scheduleId: string,
    input: { requestedDueDate: string; reason: string },
  ): Promise<CreatedMaintenanceScheduleExtension> {
    const token = await this.getAccessToken();
    if (!token) throw new Error("Please log in again.");
    const response = await this.api.post<CreatedMaintenanceScheduleExtension>(
      `/maintenance-schedules/${encodeURIComponent(scheduleId)}/extensions`,
      { requestedDueDate: input.requestedDueDate, reason: input.reason.trim() },
      { headers: { Authorization: `Bearer ${token}` } },
    );
    return response.data;
  }

  async getMaintenanceScheduleExtensionHistory(
    scheduleId: string,
  ): Promise<MaintenanceScheduleExtensionHistory> {
    const token = await this.getAccessToken();
    if (!token) throw new Error("Please log in again.");
    const response = await this.api.get<MaintenanceScheduleExtensionHistory>(
      `/maintenance-schedules/${encodeURIComponent(scheduleId)}/extensions`,
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

  const rawRoles = Array.isArray(candidate.roles)
    ? candidate.roles
    : typeof candidate.role === "string" ? [candidate.role] : [];
  const roles = rawRoles.flatMap((item) => {
    if (typeof item === "string") return [{ role: item, system: "VMMS" }];
    if (typeof item !== "object" || item === null) return [];
    const role = item as { role?: unknown; system?: unknown };
    return typeof role.role === "string"
      ? [{ role: role.role, system: typeof role.system === "string" ? role.system : "VMMS" }]
      : [];
  });
  const temporaryRoles = Array.isArray(candidate.temporaryRoles)
    ? candidate.temporaryRoles.filter((role): role is string => typeof role === "string")
    : [];
  const id = typeof candidate.userId === "string" ? candidate.userId : candidate.id;
  return typeof id === "string" ? { id, name: candidate.name, roles, temporaryRoles } : null;
}

function getAuthErrorMessage(
  error: unknown,
  fallback = "Unable to sign in",
  operation = "Login",
): string {
  if (!isAxiosError(error)) {
    return error instanceof Error ? error.message : fallback;
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
  return `${operation} failed with status ${error.response.status}.`;
}
