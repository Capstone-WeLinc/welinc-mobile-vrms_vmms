const mockApiClient = {
  get: jest.fn(),
  post: jest.fn(),
  patch: jest.fn(),
  interceptors: {
    request: { use: jest.fn() },
    response: { use: jest.fn() },
  },
};
const mockAxiosCreate = jest.fn(() => mockApiClient);

jest.mock("axios", () => ({
  __esModule: true,
  create: mockAxiosCreate,
  default: { create: mockAxiosCreate },
}));

jest.mock("../services/AuthService", () => ({
  API_BASE_URL: "https://vmms.example.test/api",
  AuthService: jest.fn().mockImplementation(() => ({
    getAccessToken: jest.fn().mockResolvedValue("chief-mechanic-access-token"),
  })),
}));

jest.mock("../services/mobileAuthRefresh", () => ({
  installMobileAuthRefresh: jest.fn(),
}));

// Import after registering mocks so the service receives the mocked clients.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  acknowledgeFuelAnomaly,
  getFuelAnomalyApprovals,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} = require("../services/NotificationService");

const approval = {
  id: "8f47cbdb-ff72-4d71-a8e6-9f4e41926358",
  status: "OPEN",
  severity: "CRITICAL",
  efficiency: 2.4,
  rollingAverage: 6.8,
  note: "Operations reviewed the fuel entry.",
  acknowledgedAt: null,
  vehicle: { plateNumber: "NDG 5821" },
};

beforeEach(() => {
  mockApiClient.get.mockClear();
  mockApiClient.post.mockClear();
  mockApiClient.patch.mockClear();
});

test("uses the backend fuel approval contract to fetch and acknowledge as mobile Chief Mechanic", async () => {
  mockApiClient.get.mockResolvedValue({ data: [approval] });
  mockApiClient.post.mockResolvedValue({ data: { ...approval, acknowledgedAt: "2026-11-14T00:00:00.000Z" } });

  expect(await getFuelAnomalyApprovals()).toEqual([approval]);
  expect(mockAxiosCreate).toHaveBeenCalledWith(expect.objectContaining({
    baseURL: "https://vmms.example.test/api",
  }));
  expect(mockApiClient.get).toHaveBeenCalledWith("/fuel/anomalies");

  const requestInterceptor = mockApiClient.interceptors.request.use.mock.calls[0][0];
  const requestConfig = await requestInterceptor({ headers: {} });
  expect(requestConfig.headers.Authorization).toBe("Bearer chief-mechanic-access-token");

  await acknowledgeFuelAnomaly(approval.id, "Checked against the receipt.");
  expect(mockApiClient.post).toHaveBeenCalledWith(
    `/fuel/anomalies/${approval.id}/acknowledge`,
    { remark: "Checked against the receipt." },
  );
});

test("loads and updates the unified inbox contract", async () => {
  const inbox = {
    items: [
      {
        id: "notification-1",
        source: "general",
        category: "FUEL",
        title: "Fuel efficiency anomaly",
        message: "ABC-1234 needs review.",
        isRead: false,
        createdAt: "2026-11-28T01:00:00.000Z",
        actionTarget: { type: "FUEL_MANAGEMENT", id: "anomaly-1" },
      },
    ],
    nextCursor: "opaque-cursor",
    counts: { total: 34, unread: 2 },
  };
  mockApiClient.get.mockResolvedValue({ data: inbox });
  mockApiClient.patch
    .mockResolvedValueOnce({ data: { updated: 1 } })
    .mockResolvedValueOnce({ data: { updated: 3 } });

  const page = await getNotifications();

  expect(mockApiClient.get).toHaveBeenCalledWith("/notifications/inbox", {
    params: { limit: 30 },
  });
  expect(page.items[0]).toMatchObject({
    kind: "FUEL_ANOMALY",
    source: "general",
    category: "FUEL",
    readAt: null,
    actionTarget: { type: "FUEL_MANAGEMENT", id: "anomaly-1" },
  });
  expect(page.counts).toEqual({ total: 34, unread: 2 });
  expect(page.nextCursor).toBe("opaque-cursor");

  await expect(markNotificationRead("notification-1", "general")).resolves.toBe(true);
  expect(mockApiClient.patch).toHaveBeenNthCalledWith(
    1,
    "/notifications/inbox/general/notification-1/read",
  );
  await markAllNotificationsRead();
  expect(mockApiClient.patch).toHaveBeenNthCalledWith(
    2,
    "/notifications/inbox/read-all",
  );
});
