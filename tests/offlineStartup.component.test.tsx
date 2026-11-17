import { act, render } from "@testing-library/react-native";

const mockSync = jest.fn().mockResolvedValue({
  status: "offline",
  synchronizedAt: null,
  vehicles: 0,
  maintenanceSchedules: 0,
  checklistTemplates: 0,
  checklistItems: 0,
});
const mockForceRefreshFromBackend = jest.fn();
const mockRestoreSession = jest.fn();
const mockInitializeDatabase = jest.fn();
const mockClearDatabase = jest.fn();

jest.mock("../services/SyncService", () => ({
  SyncService: jest.fn(() => ({
    sync: mockSync,
    forceRefreshFromBackend: mockForceRefreshFromBackend,
    stopAutoSync: jest.fn(),
  })),
}));

jest.mock("../services/AuthService", () => ({
  API_BASE_URL: "http://localhost:3000",
  AuthService: jest.fn(() => ({
    restoreSession: mockRestoreSession,
    getAccessToken: jest.fn(),
  })),
}));

jest.mock("../database/database", () => ({
  initializeDatabase: mockInitializeDatabase,
  clearDatabase: mockClearDatabase,
}));

jest.mock("../services/useNotifications", () => ({
  useNotifications: () => ({}),
}));

jest.mock("../screens/SplashScreen", () => ({
  SplashScreen: () => null,
}));

// Load App after its startup dependencies have been mocked.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const App = require("../App").default;

beforeEach(() => {
  jest.clearAllMocks();
  mockInitializeDatabase.mockResolvedValue({});
  mockRestoreSession.mockResolvedValue({
    id: "mechanic-1",
    name: "Test Mechanic",
    email: "mechanic@example.test",
    contact: null,
    profilePicture: null,
    roles: [{ system: "VMMS", role: "MECHANIC" }],
  });
  mockSync.mockResolvedValue({
    status: "offline",
    synchronizedAt: null,
    vehicles: 0,
    maintenanceSchedules: 0,
    checklistTemplates: 0,
    checklistItems: 0,
  });
});

test("restores the offline session without refreshing or clearing the cached database", async () => {
  await act(async () => {
    render(<App />);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(mockSync).not.toHaveBeenCalled();
  expect(mockForceRefreshFromBackend).not.toHaveBeenCalled();
  expect(mockClearDatabase).not.toHaveBeenCalled();
});
