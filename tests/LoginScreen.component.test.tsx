import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { ForgotPasswordScreen } from "../screens/ForgotPasswordScreen";
import { LoginScreen } from "../screens/LoginScreen";
import { AuthService } from "../services/AuthService";

test("requests a reset code, resets the password, and returns to sign-in", async () => {
  const authService = new AuthService("http://localhost:3000");
  const requestPasswordReset = jest
    .spyOn(authService, "requestPasswordReset")
    .mockResolvedValue(undefined);
  const verifyPasswordResetCode = jest
    .spyOn(authService, "verifyPasswordResetCode")
    .mockResolvedValue(undefined);
  const resetPassword = jest
    .spyOn(authService, "resetPassword")
    .mockResolvedValue(undefined);
  const onForgotPassword = jest.fn();
  const onBack = jest.fn();
  const view = await render(
    <LoginScreen
      authService={authService}
      onAuthenticated={jest.fn()}
      onBack={jest.fn()}
      onForgotPassword={onForgotPassword}
    />,
  );

  await fireEvent.press(view.getByRole("button", { name: "Forgot password?" }));
  expect(onForgotPassword).toHaveBeenCalledTimes(1);

  await view.rerender(
    <ForgotPasswordScreen authService={authService} onBack={onBack} />,
  );
  await fireEvent.changeText(
    view.getByPlaceholderText("you@welinc.com"),
    " user@example.com ",
  );
  await fireEvent.press(view.getByRole("button", { name: "Send code" }));

  await waitFor(() => {
    expect(requestPasswordReset).toHaveBeenCalledWith("user@example.com");
    expect(view.getByText("Check your email")).toBeTruthy();
  });

  await fireEvent.changeText(view.getByLabelText("6-digit reset code"), "123456");
  await fireEvent.press(view.getByRole("button", { name: "Verify" }));
  await waitFor(() => {
    expect(verifyPasswordResetCode).toHaveBeenCalledWith(
      "user@example.com",
      "123456",
    );
    expect(view.getByText("Set a new password")).toBeTruthy();
  });
  expect(
    view.getByPlaceholderText("At least 8 characters").props.secureTextEntry,
  ).toBe(true);
  await fireEvent.press(view.getByRole("button", { name: "Show password" }));
  expect(
    view.getByPlaceholderText("At least 8 characters").props.secureTextEntry,
  ).toBe(false);
  await fireEvent.press(view.getByRole("button", { name: "Hide password" }));
  expect(
    view.getByPlaceholderText("At least 8 characters").props.secureTextEntry,
  ).toBe(true);

  await fireEvent.changeText(
    view.getByPlaceholderText("At least 8 characters"),
    "NewPassword1!",
  );
  await fireEvent.changeText(
    view.getByPlaceholderText("Type it again"),
    "NewPassword1!",
  );
  await fireEvent.press(view.getByRole("button", { name: "Set password" }));

  await waitFor(() => {
    expect(resetPassword).toHaveBeenCalledWith({
      email: "user@example.com",
      otp: "123456",
      newPassword: "NewPassword1!",
    });
    expect(view.getByText("Password changed")).toBeTruthy();
  });

  await fireEvent.press(view.getByRole("button", { name: "Sign in" }));
  expect(onBack).toHaveBeenCalledTimes(1);
});

test("rejects a password that does not meet the auth policy", async () => {
  const authService = new AuthService("http://localhost:3000");
  const requestPasswordReset = jest
    .spyOn(authService, "requestPasswordReset")
    .mockResolvedValue(undefined);
  jest
    .spyOn(authService, "verifyPasswordResetCode")
    .mockResolvedValue(undefined);
  const resetPassword = jest
    .spyOn(authService, "resetPassword")
    .mockResolvedValue(undefined);
  const view = await render(
    <ForgotPasswordScreen authService={authService} onBack={jest.fn()} />,
  );

  await fireEvent.changeText(
    view.getByPlaceholderText("you@welinc.com"),
    "user@example.com",
  );
  await fireEvent.press(view.getByRole("button", { name: "Send code" }));
  await waitFor(() =>
    expect(requestPasswordReset).toHaveBeenCalledWith("user@example.com"),
  );

  await fireEvent.changeText(view.getByLabelText("6-digit reset code"), "123456");
  await fireEvent.press(view.getByRole("button", { name: "Verify" }));
  await waitFor(() => expect(view.getByText("Set a new password")).toBeTruthy());
  await fireEvent.changeText(
    view.getByPlaceholderText("At least 8 characters"),
    "weak",
  );
  await fireEvent.changeText(
    view.getByPlaceholderText("Type it again"),
    "weak",
  );
  await fireEvent.press(view.getByRole("button", { name: "Set password" }));

  expect(
    view.getByText(/Use at least 8 characters/),
  ).toBeTruthy();
  expect(resetPassword).not.toHaveBeenCalled();
});

test("validates the reset code format and rejects an invalid or expired code", async () => {
  const authService = new AuthService("http://localhost:3000");
  jest
    .spyOn(authService, "requestPasswordReset")
    .mockResolvedValue(undefined);
  const verifyPasswordResetCode = jest
    .spyOn(authService, "verifyPasswordResetCode")
    .mockRejectedValueOnce(new Error("Invalid or expired OTP"));
  const resetPassword = jest.spyOn(authService, "resetPassword");
  const view = await render(
    <ForgotPasswordScreen authService={authService} onBack={jest.fn()} />,
  );

  await fireEvent.changeText(
    view.getByPlaceholderText("you@welinc.com"),
    "user@example.com",
  );
  await fireEvent.press(view.getByRole("button", { name: "Send code" }));
  await waitFor(() =>
    expect(view.getByText("Check your email")).toBeTruthy(),
  );

  const codeInput = view.getByLabelText("6-digit reset code");
  await fireEvent.changeText(codeInput, "12x45");
  expect(codeInput.props.value).toBe("1245");
  expect(view.getByRole("button", { name: "Verify" }).props.accessibilityState.disabled).toBe(true);

  await fireEvent.changeText(codeInput, "123456");
  await fireEvent.press(view.getByRole("button", { name: "Verify" }));

  expect(
    await view.findByText("That code isn't right or has expired. Check it, or send a new one."),
  ).toBeTruthy();
  expect(verifyPasswordResetCode).toHaveBeenCalledWith(
    "user@example.com",
    "123456",
  );
  expect(resetPassword).not.toHaveBeenCalled();
  expect(view.getByLabelText("6-digit reset code").props.value).toBe("");
});
