import axios, { isAxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import * as SecureStore from 'expo-secure-store';

export const ACCESS_TOKEN_KEY = 'vmms_access_token';
export const REFRESH_TOKEN_KEY = 'vmms_refresh_token';
export const USER_KEY = 'vmms_authenticated_user';
export const MOBILE_CLIENT_ID = 'vmms-mobile';

type RefreshableRequest = InternalAxiosRequestConfig & { _vmmsRefreshRetried?: boolean };
type TokenAnswer = { access_token: string; refresh_token: string };
let refreshInFlight: Promise<string> | null = null;

export async function refreshAccessToken(apiBaseUrl: string): Promise<string> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
      if (!refreshToken) throw new Error('Your session has expired. Please sign in again.');
      const form = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: MOBILE_CLIENT_ID,
        audience: 'VMMS',
      });
      const response = await axios.post<TokenAnswer>(
        `${apiBaseUrl.replace(/\/$/, '')}/auth/token`,
        form.toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );
      if (!response.data.access_token || !response.data.refresh_token) {
        throw new Error('The sign in service returned an invalid refreshed session.');
      }
      await Promise.all([
        SecureStore.setItemAsync(ACCESS_TOKEN_KEY, response.data.access_token),
        SecureStore.setItemAsync(REFRESH_TOKEN_KEY, response.data.refresh_token),
      ]);
      return response.data.access_token;
    })().finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

function isAuthRoute(url?: string) {
  return Boolean(url && (
    url.includes('/auth/mobile/login') ||
    url.includes('/auth/token') ||
    url.includes('/auth/logout')
  ));
}

export function installMobileAuthRefresh(api: AxiosInstance, apiBaseUrl: string) {
  api.interceptors.request.use((config) => {
    const url = config.url ?? '';
    if (url.startsWith('/auth/') || url.startsWith('http://') || url.startsWith('https://')) {
      return config;
    }
    if (url.startsWith('/vmms/')) return config;
    if (url.startsWith('/analytics/')) {
      config.url = `/vmms/analytics${url.slice('/analytics'.length)}`;
    } else if (url.startsWith('/workorders')) {
      config.url = `/vmms/analytics${url}`;
    } else {
      config.url = `/vmms${url.startsWith('/') ? url : `/${url}`}`;
    }
    return config;
  });

  api.interceptors.response.use(
    (response) => response,
    async (error: unknown) => {
      if (!isAxiosError(error)) return Promise.reject(error);
      const config = error.config as RefreshableRequest | undefined;
      if (error.response?.status !== 401 || !config || config._vmmsRefreshRetried || isAuthRoute(config.url)) {
        return Promise.reject(error);
      }
      config._vmmsRefreshRetried = true;
      try {
        const accessToken = await refreshAccessToken(apiBaseUrl);
        config.headers.Authorization = `Bearer ${accessToken}`;
        if (config.url?.includes('/auth/logout')) {
          const latestRefreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
          config.data = JSON.stringify({ refreshToken: latestRefreshToken, clientId: MOBILE_CLIENT_ID });
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
