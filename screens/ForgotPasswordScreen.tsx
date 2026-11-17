import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { AuthService } from "../services/AuthService";

interface ForgotPasswordScreenProps {
  authService: AuthService;
  onBack: () => void;
}

type RecoveryStep = "request" | "verify" | "newPassword" | "complete";

const CODE_LENGTH = 6;
const RESEND_SECONDS = 60;
const welincLogo = require("../assets/welinc_logo.jpg");
const movingTrucks = require("../assets/trucks_moving.gif");
const PASSWORD_REQUIREMENTS =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

function isInvalidResetCode(error: unknown): boolean {
  return error instanceof Error && /invalid or expired otp/i.test(error.message);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function ForgotPasswordScreen({ authService, onBack }: ForgotPasswordScreenProps) {
  const [step, setStep] = useState<RecoveryStep>("request");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendWait, setResendWait] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const codeInputRef = useRef<TextInput>(null);
  const cleanEmail = email.trim().toLowerCase();

  useEffect(() => {
    if (resendWait <= 0) return;
    const timer = setTimeout(() => setResendWait((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendWait]);

  useEffect(() => {
    if (step === "verify" && !loading && error) {
      codeInputRef.current?.focus();
    }
  }, [step, loading, error]);

  const requestResetCode = async () => {
    if (loading) return;
    if (!cleanEmail || !cleanEmail.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }

    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      await authService.requestPasswordReset(cleanEmail);
      setOtp("");
      setStep("verify");
      setResendWait(RESEND_SECONDS);
    } catch (requestError) {
      setError(errorMessage(requestError, "We couldn't send the code. Check your connection and try again."));
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async () => {
    if (loading || otp.length !== CODE_LENGTH) return;
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      await authService.verifyPasswordResetCode(cleanEmail, otp);
      setStep("newPassword");
    } catch (verifyError) {
      if (isInvalidResetCode(verifyError)) {
        setError("That code isn't right or has expired. Check it, or send a new one.");
        setOtp("");
      } else {
        setError(errorMessage(verifyError, "We couldn't check the code. Check your connection and try again."));
      }
    } finally {
      setLoading(false);
    }
  };

  const resendCode = async () => {
    if (resending || loading || resendWait > 0) return;
    setError(null);
    setMessage(null);
    setResending(true);
    try {
      await authService.requestPasswordReset(cleanEmail);
      setOtp("");
      setResendWait(RESEND_SECONDS);
      setMessage("We sent a new code. The old one no longer works.");
    } catch (resendError) {
      setError(errorMessage(resendError, "We couldn't send the code. Check your connection and try again."));
    } finally {
      setResending(false);
    }
  };

  const resetPassword = async () => {
    if (loading) return;
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("The two passwords are different.");
      return;
    }
    if (!PASSWORD_REQUIREMENTS.test(newPassword)) {
      setError(
        "Use at least 8 characters, with an uppercase letter, a lowercase letter, a number, and a special character.",
      );
      return;
    }

    setLoading(true);
    try {
      await authService.resetPassword({
        email: cleanEmail,
        otp,
        newPassword,
      });
      setStep("complete");
    } catch (resetError) {
      if (isInvalidResetCode(resetError)) {
        setOtp("");
        setStep("verify");
        setError("That code expired. Send a new one, then set your password.");
      } else {
        setError(errorMessage(resetError, "We couldn't change your password. Check your connection and try again."));
      }
    } finally {
      setLoading(false);
    }
  };

  const changeEmail = () => {
    setStep("request");
    setOtp("");
    setError(null);
    setMessage(null);
    setResendWait(0);
  };

  const renderError = error ? (
    <View accessibilityRole="alert" style={styles.errorNotice}>
      <Text style={styles.errorText}>{error}</Text>
    </View>
  ) : null;

  return (
    <View style={styles.screen}>
      <Image
        accessibilityLabel="WeLinc delivery trucks"
        source={movingTrucks}
        style={styles.trucksBackground}
        resizeMode="cover"
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.keyboardAvoidingView}
      >
        <ScrollView
          contentContainerStyle={styles.cardArea}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.card}>
            <TouchableOpacity
              accessibilityLabel="Back to sign in"
              accessibilityRole="button"
              disabled={loading}
              onPress={onBack}
              style={styles.backButton}
            >
              <Text style={styles.backButtonText}>{"< Back to Sign In"}</Text>
            </TouchableOpacity>

            <View style={styles.logoTile}>
              <Image source={welincLogo} style={styles.logo} resizeMode="cover" />
            </View>

            {step === "request" ? (
              <>
                <Text style={styles.title}>Reset your password</Text>
                <Text style={styles.subtitle}>
                  Enter your email and we will send you a 6 digit code.
                </Text>
                {renderError}
                <Text style={styles.label}>Email</Text>
                <TextInput
                  autoCapitalize="none"
                  autoComplete="email"
                  editable={!loading}
                  keyboardType="email-address"
                  onChangeText={setEmail}
                  onSubmitEditing={() => void requestResetCode()}
                  placeholder="you@welinc.com"
                  placeholderTextColor="#64708d"
                  returnKeyType="send"
                  style={styles.input}
                  value={email}
                />
                <Pressable
                  accessibilityRole="button"
                  disabled={loading}
                  onPress={() => void requestResetCode()}
                  style={({ pressed }) => [
                    styles.button,
                    (pressed || loading) && styles.buttonPressed,
                  ]}
                >
                  {loading ? (
                    <ActivityIndicator color="#101958" />
                  ) : (
                    <Text style={styles.buttonText}>Send code</Text>
                  )}
                </Pressable>
              </>
            ) : null}

            {step === "verify" ? (
              <>
                <Text style={styles.title}>Check your email</Text>
                <Text style={styles.subtitle}>
                  If <Text style={styles.strongText}>{cleanEmail}</Text> has a
                  WeLinc account, we sent it a 6 digit code.
                </Text>
                {message ? (
                  <View style={styles.successNotice}>
                    <Text style={styles.successText}>{message}</Text>
                  </View>
                ) : null}
                {renderError}
                <Text style={styles.label}>Code</Text>
                <View style={styles.codeInputWrap}>
                  <View pointerEvents="none" style={styles.codeSlots}>
                    {Array.from({ length: CODE_LENGTH }, (_, index) => (
                      <View
                        key={index}
                        style={[
                          styles.codeSlot,
                          index === Math.min(otp.length, CODE_LENGTH - 1) &&
                            styles.codeSlotActive,
                        ]}
                      >
                        <Text style={styles.codeSlotText}>{otp[index] ?? ""}</Text>
                      </View>
                    ))}
                  </View>
                  <TextInput
                    ref={codeInputRef}
                    accessibilityLabel="6-digit reset code"
                    autoCapitalize="none"
                    autoComplete="one-time-code"
                    autoFocus
                    editable={!loading}
                    keyboardType="number-pad"
                    maxLength={CODE_LENGTH}
                    onChangeText={(value) => setOtp(value.replace(/\D/g, "").slice(0, CODE_LENGTH))}
                    onSubmitEditing={() => void verifyCode()}
                    selectionColor="#e8b800"
                    style={styles.codeInput}
                    textContentType="oneTimeCode"
                    value={otp}
                  />
                </View>
                <Pressable
                  accessibilityRole="button"
                  disabled={loading || otp.length !== CODE_LENGTH}
                  onPress={() => void verifyCode()}
                  style={({ pressed }) => [
                    styles.button,
                    (pressed || loading || otp.length !== CODE_LENGTH) &&
                      styles.buttonPressed,
                  ]}
                >
                  {loading ? (
                    <ActivityIndicator color="#101958" />
                  ) : (
                    <Text style={styles.buttonText}>Verify</Text>
                  )}
                </Pressable>
                <View style={styles.secondaryActions}>
                  <TouchableOpacity
                    accessibilityRole="button"
                    disabled={resendWait > 0 || resending || loading}
                    onPress={() => void resendCode()}
                    style={styles.secondaryButton}
                  >
                    <Text
                      style={[
                        styles.highlightLink,
                        (resendWait > 0 || resending) && styles.disabledLink,
                      ]}
                    >
                      {resendWait > 0
                        ? `Resend code in ${resendWait} s`
                        : resending
                          ? "Sending"
                          : "Resend code"}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    accessibilityRole="button"
                    disabled={loading}
                    onPress={changeEmail}
                    style={styles.secondaryButton}
                  >
                    <Text style={styles.secondaryLink}>Use a different email</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : null}

            {step === "newPassword" ? (
              <>
                <Text style={styles.title}>Set a new password</Text>
                <Text style={styles.subtitle}>
                  For <Text style={styles.highlightText}>{cleanEmail}</Text>.
                </Text>
                {renderError}
                <Text style={styles.label}>New password</Text>
                <View style={styles.passwordInputWrap}>
                  <TextInput
                    autoCapitalize="none"
                    autoComplete="new-password"
                    editable={!loading}
                    onChangeText={setNewPassword}
                    placeholder="At least 8 characters"
                    placeholderTextColor="#64708d"
                    secureTextEntry={!showNewPassword}
                    style={[styles.input, styles.passwordInput]}
                    value={newPassword}
                  />
                  <TouchableOpacity
                    accessibilityHint={showNewPassword ? "Hides the password" : "Shows the password"}
                    accessibilityLabel={showNewPassword ? "Hide password" : "Show password"}
                    accessibilityRole="button"
                    disabled={loading}
                    onPress={() => setShowNewPassword((shown) => !shown)}
                    style={styles.eyeButton}
                  >
                    <View style={styles.eyeOutline}>
                      <View style={styles.eyePupil} />
                      {!showNewPassword ? <View style={styles.eyeSlash} /> : null}
                    </View>
                  </TouchableOpacity>
                </View>
                <Text style={styles.passwordHint}>
                  At least 8 characters, with an uppercase letter, a lowercase
                  letter, a number and a special character.
                </Text>
                <Text style={styles.label}>Confirm password</Text>
                <View style={styles.passwordInputWrap}>
                  <TextInput
                    autoCapitalize="none"
                    autoComplete="new-password"
                    editable={!loading}
                    onChangeText={setConfirmPassword}
                    onSubmitEditing={() => void resetPassword()}
                    placeholder="Type it again"
                    placeholderTextColor="#64708d"
                    returnKeyType="done"
                    secureTextEntry={!showConfirmPassword}
                    style={[styles.input, styles.passwordInput]}
                    value={confirmPassword}
                  />
                  <TouchableOpacity
                    accessibilityHint={
                      showConfirmPassword
                        ? "Hides the confirmation password"
                        : "Shows the confirmation password"
                    }
                    accessibilityLabel={
                      showConfirmPassword
                        ? "Hide confirmation password"
                        : "Show confirmation password"
                    }
                    accessibilityRole="button"
                    disabled={loading}
                    onPress={() => setShowConfirmPassword((shown) => !shown)}
                    style={styles.eyeButton}
                  >
                    <View style={styles.eyeOutline}>
                      <View style={styles.eyePupil} />
                      {!showConfirmPassword ? <View style={styles.eyeSlash} /> : null}
                    </View>
                  </TouchableOpacity>
                </View>
                <Pressable
                  accessibilityRole="button"
                  disabled={loading}
                  onPress={() => void resetPassword()}
                  style={({ pressed }) => [
                    styles.button,
                    (pressed || loading) && styles.buttonPressed,
                  ]}
                >
                  {loading ? (
                    <ActivityIndicator color="#101958" />
                  ) : (
                    <Text style={styles.buttonText}>Set password</Text>
                  )}
                </Pressable>
              </>
            ) : null}

            {step === "complete" ? (
              <View style={styles.completeContent}>
                <Text style={styles.title}>Password changed</Text>
                <Text style={styles.subtitle}>
                  Sign in with your new password.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={onBack}
                  style={({ pressed }) => [
                    styles.button,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <Text style={styles.buttonText}>Sign in</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, position: "relative", backgroundColor: "#ffffff" },
  keyboardAvoidingView: { flex: 1 },
  cardArea: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 24,
  },
  card: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 400,
    borderWidth: 1,
    borderColor: "#30376c",
    borderRadius: 24,
    backgroundColor: "#171c52",
    padding: 24,
    shadowColor: "#02051e",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 10,
  },
  backButton: { alignSelf: "flex-start", marginBottom: 18, paddingVertical: 4, paddingRight: 8 },
  backButtonText: { color: "#f4c400", fontSize: 14, fontWeight: "700" },
  logoTile: {
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    width: 56,
    height: 56,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#f4c400",
    borderWidth: 2,
    borderColor: "#f4c400",
    marginBottom: 16,
  },
  logo: { width: "100%", height: "100%", transform: [{ scale: 1.55 }] },
  title: { color: "#ffffff", fontSize: 24, lineHeight: 29, fontWeight: "900", letterSpacing: -0.45 },
  subtitle: { color: "#aeb5d2", fontSize: 14, lineHeight: 20, marginTop: 3, marginBottom: 18 },
  strongText: { color: "#ffffff", fontWeight: "700" },
  highlightText: { color: "#f4c400" },
  label: { color: "#d9dcec", fontSize: 14, fontWeight: "700", marginBottom: 8 },
  input: {
    height: 46,
    borderRadius: 12,
    backgroundColor: "#eaf0ff",
    color: "#14192d",
    paddingHorizontal: 15,
    fontSize: 14,
    marginBottom: 14,
  },
  codeInputWrap: { height: 48, marginBottom: 14, justifyContent: "center" },
  codeSlots: { flexDirection: "row", justifyContent: "center", gap: 6 },
  codeSlot: {
    width: 40,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d4dced",
    backgroundColor: "#eaf0ff",
    alignItems: "center",
    justifyContent: "center",
  },
  codeSlotActive: {
    borderColor: "#f4c400",
  },
  codeSlotText: { color: "#14192d", fontSize: 20, fontWeight: "700" },
  codeInput: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    height: 48,
    color: "transparent",
    opacity: 0.02,
  },
  passwordInputWrap: { position: "relative" },
  passwordInput: { paddingRight: 54, marginBottom: 8 },
  eyeButton: {
    position: "absolute",
    right: 10,
    top: 8,
    minWidth: 40,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  eyeOutline: { width: 20, height: 13, borderWidth: 1.5, borderColor: "#cdd5ec", borderRadius: 12, alignItems: "center", justifyContent: "center" },
  eyePupil: { width: 5, height: 5, borderRadius: 5, backgroundColor: "#cdd5ec" },
  eyeSlash: { position: "absolute", width: 24, height: 1.5, backgroundColor: "#cdd5ec", transform: [{ rotate: "-45deg" }] },
  passwordHint: { color: "#aeb5d2", fontSize: 12, lineHeight: 18, marginBottom: 14 },
  button: {
    width: "100%",
    minHeight: 52,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f4c400",
    shadowColor: "#f4c400",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.26,
    shadowRadius: 10,
    elevation: 5,
  },
  buttonPressed: { opacity: 0.72 },
  buttonText: { color: "#101958", fontSize: 16, fontWeight: "900" },
  errorNotice: {
    borderWidth: 1,
    borderColor: "rgba(252,165,165,0.2)",
    borderRadius: 12,
    backgroundColor: "rgba(252,165,165,0.1)",
    padding: 14,
    marginBottom: 20,
  },
  errorText: { color: "#fca5a5", fontSize: 14, lineHeight: 20 },
  successNotice: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
    padding: 14,
    marginBottom: 20,
  },
  successText: { color: "rgba(255,255,255,0.7)", fontSize: 14, lineHeight: 20 },
  secondaryActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 16,
  },
  secondaryButton: { minHeight: 44, justifyContent: "center", paddingVertical: 8 },
  highlightLink: { color: "#e8b800", fontSize: 14, fontWeight: "600" },
  secondaryLink: { color: "rgba(255,255,255,0.6)", fontSize: 14 },
  disabledLink: { color: "rgba(255,255,255,0.4)" },
  completeContent: { alignItems: "flex-start" },
  trucksBackground: { position: "absolute", left: 0, right: 0, bottom: 0, width: "100%", height: 170 },
});
