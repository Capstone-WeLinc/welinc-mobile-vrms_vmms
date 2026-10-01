import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from "axios";
import * as SecureStore from "expo-secure-store";

export const ACCESS_TOKEN_KEY = "vmms_access_token";
export const REFRESH_TOKEN_KEY = "vmms_refresh_token";
export const USER_KEY = "vmms_authenticated_user";

type RefreshableRequest = InternalAxiosRequestConfig & { _vmmsRefreshRetried?: boolean };

let refreshInFlight: Promise<string> | null = null;

async function refreshAccessToken(apiBaseUrl: string): Promise<string> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
      if (!refreshToken) throw new Error("Your session has expired. Please log in again.");
      const response = await axios.post<{ accessToken: string; refreshToken: string }>(
        `${apiBaseUrl.replace(/\/$/, "")}/auth/refresh`,
        { refreshToken },
        { headers: { "X-VMMS-Client": "mobile", "Content-Type": "application/json" } },
      );
      if (!response.data.accessToken || !response.data.refreshToken) {
        throw new Error("The backend returned an invalid refreshed session.");
      }
      await Promise.all([
        SecureStore.setItemAsync(ACCESS_TOKEN_KEY, response.data.accessToken),
        SecureStore.setItemAsync(REFRESH_TOKEN_KEY, response.data.refreshToken),
      ]);
      return response.data.accessToken;
    })().finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

export function installMobileAuthRefresh(api: AxiosInstance, apiBaseUrl: string) {
  api.interceptors.response.use(
    (response) => response,
    async (error: unknown) => {
      if (!axios.isAxiosError(error)) return Promise.reject(error);
      const config = error.config as RefreshableRequest | undefined;
      const isAuthRoute = config?.url?.includes("/auth/login") || config?.url?.includes("/auth/refresh");
      if (error.response?.status !== 401 || !config || config._vmmsRefreshRetried || isAuthRoute) {
        return Promise.reject(error);
      }

      config._vmmsRefreshRetried = true;
      try {
        const accessToken = await refreshAccessToken(apiBaseUrl);
        config.headers.Authorization = `Bearer ${accessToken}`;
        if (config.url?.includes("/auth/logout")) {
          const latestRefreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
          config.data = JSON.stringify({ refreshToken: latestRefreshToken });
        }
        return await api.request(config);
      } catch (refreshError) {
        await Promise.all([
          SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
          SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
          SecureStore.deleteItemAsync(USER_KEY),
        ]).catch(() => undefined);
        return Promise.reject(refreshError);
      }
    },
  );
}
