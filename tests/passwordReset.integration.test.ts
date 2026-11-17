const mockApiPost = jest.fn();
const mockIsAxiosError = jest.fn();
const mockApi = {
  post: mockApiPost,
  interceptors: {
    request: { use: jest.fn() },
    response: { use: jest.fn() },
  },
};

jest.mock("axios", () => ({
  __esModule: true,
  create: jest.fn(() => mockApi),
  isAxiosError: mockIsAxiosError,
  default: {
    post: jest.fn(),
    isAxiosError: mockIsAxiosError,
  },
}));

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

// Load after the axios and secure-store mocks are installed.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AuthService } = require("../services/AuthService");

beforeEach(() => {
  mockApiPost.mockReset().mockResolvedValue({ data: { message: "OK" } });
  mockIsAxiosError.mockReset().mockReturnValue(false);
});

test("sends a normalized email to request a reset code and submits the reset payload", async () => {
  const service = new AuthService("https://gateway.example.test");

  await service.requestPasswordReset("  User@Example.com ");
  expect(mockApiPost).toHaveBeenNthCalledWith(1, "/auth/forgot-password", {
    email: "user@example.com",
  });

  await service.verifyPasswordResetCode(" User@Example.com ", " 123456 ");
  expect(mockApiPost).toHaveBeenNthCalledWith(2, "/auth/verify-otp", {
    email: "user@example.com",
    otp: "123456",
  });

  await service.resetPassword({
    email: " User@Example.com ",
    otp: " 123456 ",
    newPassword: "NewPassword1!",
  });
  expect(mockApiPost).toHaveBeenNthCalledWith(3, "/auth/reset-password", {
    email: "user@example.com",
    otp: "123456",
    newPassword: "NewPassword1!",
  });
});

test("surfaces the backend error when requesting a reset code fails", async () => {
  const service = new AuthService("https://gateway.example.test");
  mockIsAxiosError.mockReturnValue(true);
  mockApiPost.mockRejectedValue({
    response: { status: 400, data: { message: "Invalid email address." } },
  });

  await expect(service.requestPasswordReset("not-an-email")).rejects.toThrow(
    "Invalid email address.",
  );
});

test("surfaces the invalid or expired code response from verification", async () => {
  const service = new AuthService("https://gateway.example.test");
  mockIsAxiosError.mockReturnValue(true);
  mockApiPost.mockRejectedValue({
    response: { status: 400, data: { message: "Invalid or expired OTP" } },
  });

  await expect(
    service.verifyPasswordResetCode("user@example.com", "123456"),
  ).rejects.toThrow("Invalid or expired OTP");
});
