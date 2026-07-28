import axios, { type AxiosInstance } from 'axios';
import * as SecureStore from 'expo-secure-store';

const ACCESS_TOKEN_KEY = 'vmms_access_token';
const USER_KEY = 'vmms_authenticated_user';

const DEFAULT_API_BASE_URL = 'http://localhost:3000';

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL?.trim().replace(/\/$/, '') ||
  DEFAULT_API_BASE_URL;

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  contact: string | null;
  profilePicture: string | null;
  roles: Array<{ role: string; system: string }>;
}

export type MobileAccessRole = 'mechanic' | 'chiefMechanic' | 'none';

export function getMobileAccessRole(
  roles: AuthenticatedUser['roles'] | undefined,
): MobileAccessRole {
  const normalizedRoles = (roles ?? []).map((role) => role.role.trim().toLowerCase());

  if (normalizedRoles.some((value) => value.includes('chief'))) {
    return 'chiefMechanic';
  }

  if (normalizedRoles.some((value) => value.includes('mechanic'))) {
    return 'mechanic';
  }

  return 'none';
}

interface LoginResponse {
  accessToken: string;
  user: AuthenticatedUser;
}

export class AuthService {
  private readonly api: AxiosInstance;

  constructor(apiBaseUrl: string = API_BASE_URL) {
    this.api = axios.create({
      baseURL: apiBaseUrl,
      timeout: 15_000,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    });
  }

  async login(email: string, password: string): Promise<AuthenticatedUser> {
    try {
      const response = await this.api.post<LoginResponse>('/auth/login', {
        email: email.trim().toLowerCase(),
        password,
      });
      const { accessToken, user } = response.data;
      if (!accessToken || !isAuthenticatedUser(user)) {
        throw new Error('The backend returned an invalid login response');
      }

      if (getMobileAccessRole(user.roles) === 'none') {
        await this.clearSession();
        throw new Error('Only mechanics and chief mechanics can use this mobile version.');
      }

      await Promise.all([
        SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken),
        SecureStore.setItemAsync(USER_KEY, JSON.stringify(user)),
      ]);
      return user;
    } catch (error) {
      console.error('[Auth] Login failed', error);
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
      if (!isAuthenticatedUser(parsed)) throw new Error('Invalid stored user');
      storedUser = parsed;
    } catch {
      await this.clearSession();
      return null;
    }

    if (getMobileAccessRole(storedUser.roles) === 'none') {
      await this.clearSession();
      return null;
    }

    try {
      const response = await this.api.get<AuthenticatedUser>('/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!isAuthenticatedUser(response.data)) throw new Error('Invalid profile response');
      if (getMobileAccessRole(response.data.roles) === 'none') {
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
      console.info('[Auth] Backend unavailable; restoring the offline session');
      return storedUser;
    }
  }

  getAccessToken(): Promise<string | null> {
    return SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
  }

  async clearSession(): Promise<void> {
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
      SecureStore.deleteItemAsync(USER_KEY),
    ]);
  }
}

function isAuthenticatedUser(value: unknown): value is AuthenticatedUser {
  if (typeof value !== 'object' || value === null) return false;
  const user = value as Partial<AuthenticatedUser>;
  return (
    typeof user.id === 'string' &&
    typeof user.name === 'string' &&
    typeof user.email === 'string' &&
    Array.isArray(user.roles)
  );
}

function getAuthErrorMessage(error: unknown): string {
  if (!axios.isAxiosError(error)) {
    return error instanceof Error ? error.message : 'Unable to sign in';
  }
  if (!error.response) {
    return error.code === 'ECONNABORTED'
      ? 'The backend request timed out.'
      : `Cannot reach the backend at ${API_BASE_URL}.`;
  }

  const data: unknown = error.response.data;
  if (typeof data === 'object' && data !== null && 'message' in data) {
    const message = (data as { message?: unknown }).message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.filter((item) => typeof item === 'string').join('\n');
  }
  return `Login failed with status ${error.response.status}.`;
}
