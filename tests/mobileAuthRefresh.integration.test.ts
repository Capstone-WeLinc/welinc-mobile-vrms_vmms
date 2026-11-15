const mockSecureStore = {
  getItemAsync: jest.fn().mockResolvedValue("expired-session-refresh-token"),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
};
const mockAxiosPost = jest.fn();
const mockIsAxiosError = jest.fn();
let mockRejectedResponseHandler: ((error: unknown) => Promise<unknown>) | undefined;

jest.mock("axios", () => ({
  __esModule: true,
  default: {
    post: mockAxiosPost,
    isAxiosError: mockIsAxiosError,
  },
}));

jest.mock("expo-secure-store", () => mockSecureStore);

const { installMobileAuthRefresh } = require("../services/mobileAuthRefresh");

beforeEach(() => {
  mockSecureStore.getItemAsync.mockReset().mockResolvedValue("expired-session-refresh-token");
  mockSecureStore.setItemAsync.mockReset().mockResolvedValue(undefined);
  mockSecureStore.deleteItemAsync.mockReset().mockResolvedValue(undefined);
  mockAxiosPost.mockReset();
  mockIsAxiosError.mockReset();
  mockRejectedResponseHandler = undefined;
});

test("refreshes an expired mobile access token and retries the original request", async () => {
  mockAxiosPost.mockResolvedValue({
    data: { access_token: "refreshed-access-token", refresh_token: "rotated-refresh-token" },
  });
  mockIsAxiosError.mockReturnValue(true);
  const mockApi = {
    interceptors: {
      request: { use: jest.fn() },
      response: {
        use: jest.fn((_onSuccess, onError) => { mockRejectedResponseHandler = onError; }),
      },
    },
    request: jest.fn().mockResolvedValue({ data: [{ id: "approval-1" }] }),
  };
  installMobileAuthRefresh(mockApi as any, "https://vmms.example.test/api/");

  const requestConfig: any = {
    url: "/fuel/anomalies",
    headers: { Authorization: "Bearer expired-access-token" },
  };
  const refreshedResponse = await mockRejectedResponseHandler!({
    config: requestConfig,
    response: { status: 401 },
  });

  expect(mockSecureStore.getItemAsync).toHaveBeenCalledWith("vmms_refresh_token");
  expect(mockAxiosPost).toHaveBeenCalledWith(
    "https://vmms.example.test/api/auth/token",
    "grant_type=refresh_token&refresh_token=expired-session-refresh-token&client_id=vmms-mobile&audience=VMMS",
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
  );
  expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith("vmms_access_token", "refreshed-access-token");
  expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith("vmms_refresh_token", "rotated-refresh-token");
  expect(requestConfig.headers.Authorization).toBe("Bearer refreshed-access-token");
  expect(requestConfig._vmmsRefreshRetried).toBe(true);
  expect(mockApi.request).toHaveBeenCalledWith(requestConfig);
  expect(refreshedResponse).toEqual({ data: [{ id: "approval-1" }] });
});

test("shares one token refresh across simultaneous expired-token requests", async () => {
  let finishTokenRefresh!: (response: { data: { access_token: string; refresh_token: string } }) => void;
  mockAxiosPost.mockImplementation(() => new Promise((resolve) => { finishTokenRefresh = resolve; }));
  mockIsAxiosError.mockReturnValue(true);
  const mockApi = {
    interceptors: {
      request: { use: jest.fn() },
      response: {
        use: jest.fn((_onSuccess, onError) => { mockRejectedResponseHandler = onError; }),
      },
    },
    request: jest.fn(async (config: any) => ({ data: { url: config.url } })),
  };
  installMobileAuthRefresh(mockApi as any, "https://vmms.example.test/api");
  const firstConfig: any = { url: "/fuel/anomalies", headers: {} };
  const secondConfig: any = { url: "/fuel/anomalies/other", headers: {} };

  const firstRetry = mockRejectedResponseHandler!({ config: firstConfig, response: { status: 401 } });
  const secondRetry = mockRejectedResponseHandler!({ config: secondConfig, response: { status: 401 } });
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(mockAxiosPost).toHaveBeenCalledTimes(1);
  expect(mockSecureStore.getItemAsync).toHaveBeenCalledTimes(1);
  finishTokenRefresh({ data: { access_token: "shared-access-token", refresh_token: "shared-refresh-token" } });
  const responses = await Promise.all([firstRetry, secondRetry]);

  expect(mockAxiosPost).toHaveBeenCalledTimes(1);
  expect(mockApi.request).toHaveBeenCalledTimes(2);
  expect(firstConfig.headers.Authorization).toBe("Bearer shared-access-token");
  expect(secondConfig.headers.Authorization).toBe("Bearer shared-access-token");
  expect(firstConfig._vmmsRefreshRetried).toBe(true);
  expect(secondConfig._vmmsRefreshRetried).toBe(true);
  expect(responses).toEqual([
    { data: { url: "/fuel/anomalies" } },
    { data: { url: "/fuel/anomalies/other" } },
  ]);
});

test("clears saved credentials and does not retry when refresh token is rejected", async () => {
  mockAxiosPost.mockRejectedValue(new Error("Refresh token is invalid."));
  mockIsAxiosError.mockReturnValue(true);
  const mockApi = {
    interceptors: {
      request: { use: jest.fn() },
      response: {
        use: jest.fn((_onSuccess, onError) => { mockRejectedResponseHandler = onError; }),
      },
    },
    request: jest.fn(),
  };
  installMobileAuthRefresh(mockApi as any, "https://vmms.example.test/api");

  await expect(mockRejectedResponseHandler!({
    config: { url: "/fuel/anomalies", headers: { Authorization: "Bearer expired-access-token" } },
    response: { status: 401 },
  })).rejects.toThrow("Refresh token is invalid.");

  expect(mockSecureStore.getItemAsync).toHaveBeenCalledWith("vmms_refresh_token");
  expect(mockAxiosPost).toHaveBeenCalledTimes(1);
  expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledTimes(3);
  expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith("vmms_access_token");
  expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith("vmms_refresh_token");
  expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith("vmms_authenticated_user");
  expect(mockApi.request).not.toHaveBeenCalled();
});

test("clears credentials without calling the refresh endpoint when no refresh token is stored", async () => {
  mockSecureStore.getItemAsync.mockResolvedValue(null);
  mockIsAxiosError.mockReturnValue(true);
  const mockApi = {
    interceptors: {
      request: { use: jest.fn() },
      response: {
        use: jest.fn((_onSuccess, onError) => { mockRejectedResponseHandler = onError; }),
      },
    },
    request: jest.fn(),
  };
  installMobileAuthRefresh(mockApi as any, "https://vmms.example.test/api");

  await expect(mockRejectedResponseHandler!({
    config: { url: "/fuel/anomalies", headers: {} },
    response: { status: 401 },
  })).rejects.toThrow("Your session has expired. Please sign in again.");

  expect(mockAxiosPost).not.toHaveBeenCalled();
  expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledTimes(3);
  expect(mockApi.request).not.toHaveBeenCalled();
});

test("clears credentials and skips retry when the backend returns malformed refreshed tokens", async () => {
  mockAxiosPost.mockResolvedValue({ data: { access_token: "access-token-without-rotation" } });
  mockIsAxiosError.mockReturnValue(true);
  const mockApi = {
    interceptors: {
      request: { use: jest.fn() },
      response: {
        use: jest.fn((_onSuccess, onError) => { mockRejectedResponseHandler = onError; }),
      },
    },
    request: jest.fn(),
  };
  installMobileAuthRefresh(mockApi as any, "https://vmms.example.test/api");

  await expect(mockRejectedResponseHandler!({
    config: { url: "/fuel/anomalies", headers: {} },
    response: { status: 401 },
  })).rejects.toThrow("The sign in service returned an invalid refreshed session.");

  expect(mockAxiosPost).toHaveBeenCalledTimes(1);
  expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledTimes(3);
  expect(mockApi.request).not.toHaveBeenCalled();
});

test("does not loop when the retried request also returns 401", async () => {
  mockAxiosPost.mockResolvedValue({
    data: { access_token: "refreshed-access-token", refresh_token: "rotated-refresh-token" },
  });
  mockIsAxiosError.mockReturnValue(true);
  const requestConfig: any = {
    url: "/fuel/anomalies",
    headers: { Authorization: "Bearer expired-access-token" },
  };
  const retryError = { config: requestConfig, response: { status: 401 } };
  const mockApi = {
    interceptors: {
      request: { use: jest.fn() },
      response: {
        use: jest.fn((_onSuccess, onError) => { mockRejectedResponseHandler = onError; }),
      },
    },
    request: jest.fn(() => mockRejectedResponseHandler!(retryError)),
  };
  installMobileAuthRefresh(mockApi as any, "https://vmms.example.test/api");

  await expect(mockRejectedResponseHandler!(retryError)).rejects.toBe(retryError);

  expect(requestConfig._vmmsRefreshRetried).toBe(true);
  expect(requestConfig.headers.Authorization).toBe("Bearer refreshed-access-token");
  expect(mockAxiosPost).toHaveBeenCalledTimes(1);
  expect(mockApi.request).toHaveBeenCalledTimes(1);
  expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledTimes(3);
});

test("does not refresh credentials for a non-401 response", async () => {
  mockIsAxiosError.mockReturnValue(true);
  const mockApi = {
    interceptors: {
      request: { use: jest.fn() },
      response: {
        use: jest.fn((_onSuccess, onError) => { mockRejectedResponseHandler = onError; }),
      },
    },
    request: jest.fn(),
  };
  installMobileAuthRefresh(mockApi as any, "https://vmms.example.test/api");
  const error = {
    config: { url: "/fuel/anomalies", headers: {} },
    response: { status: 403 },
  };

  await expect(mockRejectedResponseHandler!(error)).rejects.toBe(error);

  expect(mockSecureStore.getItemAsync).not.toHaveBeenCalled();
  expect(mockAxiosPost).not.toHaveBeenCalled();
  expect(mockSecureStore.deleteItemAsync).not.toHaveBeenCalled();
  expect(mockApi.request).not.toHaveBeenCalled();
});

test.each(["/auth/mobile/login", "/auth/token", "/auth/logout"])("does not recursively refresh a 401 from %s", async (url) => {
  mockIsAxiosError.mockReturnValue(true);
  const mockApi = {
    interceptors: {
      request: { use: jest.fn() },
      response: {
        use: jest.fn((_onSuccess, onError) => { mockRejectedResponseHandler = onError; }),
      },
    },
    request: jest.fn(),
  };
  installMobileAuthRefresh(mockApi as any, "https://vmms.example.test/api");
  const error = {
    config: { url, headers: {} },
    response: { status: 401 },
  };

  await expect(mockRejectedResponseHandler!(error)).rejects.toBe(error);

  expect(mockSecureStore.getItemAsync).not.toHaveBeenCalled();
  expect(mockAxiosPost).not.toHaveBeenCalled();
  expect(mockSecureStore.deleteItemAsync).not.toHaveBeenCalled();
  expect(mockApi.request).not.toHaveBeenCalled();
});




