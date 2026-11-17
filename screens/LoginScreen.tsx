import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { AuthService, type AuthenticatedUser, type EmailVerificationChallenge } from "../services/AuthService";

interface LoginScreenProps {
  authService: AuthService;
  onAuthenticated: (user: AuthenticatedUser) => void;
  onBack: () => void;
  onForgotPassword: () => void;
}

const welincLogo = require("../assets/welinc_logo.jpg");
const movingTrucks = require("../assets/trucks_moving.gif");

export function LoginScreen({ authService, onAuthenticated, onBack, onForgotPassword }: LoginScreenProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [challenge, setChallenge] = useState<EmailVerificationChallenge | null>(null);
  const [verificationCode, setVerificationCode] = useState("");

  const login = async () => {
    if (!email.trim() || !password) {
      setError("Enter your email address and password.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await authService.login(email, password);
      if ("challengeId" in result) {
        setChallenge(result);
      } else {
        onAuthenticated(result);
      }
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Unable to sign in.");
    } finally {
      setLoading(false);
    }
  };

  const verifyEmail = async () => {
    if (!challenge || verificationCode.trim().length !== 6) {
      setError("Enter the 6 digit code sent to your email.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      onAuthenticated(await authService.verifyEmail(challenge.challengeId, verificationCode.trim()));
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : "Unable to verify the email.");
    } finally {
      setLoading(false);
    }
  };

  const resendCode = async () => {
    if (!challenge) return;
    setLoading(true);
    setError(null);
    try {
      await authService.resendEmailCode(challenge.challengeId);
    } catch (resendError) {
      setError(resendError instanceof Error ? resendError.message : "Unable to resend the code.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.screen}>
      <Image
        accessibilityLabel="WeLinc delivery trucks"
        source={movingTrucks}
        style={styles.trucksBackground}
        resizeMode="cover"
      />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.keyboardAvoidingView}>
        <View style={styles.cardArea}>
          <View style={styles.card}>
          <TouchableOpacity
            accessibilityLabel="Back to splash screen"
            accessibilityRole="button"
            disabled={loading}
            onPress={onBack}
            style={styles.backButton}
          >
            <Text style={styles.backButtonText}>{"< Back"}</Text>
          </TouchableOpacity>

          <View style={styles.logoTile}>
            <Image source={welincLogo} style={styles.logo} resizeMode="cover" />
          </View>

          <Text style={styles.title}>{challenge ? "Verify your email" : "Sign In"}</Text>
          <Text style={styles.subtitle}>{challenge ? `Enter the 6 digit code sent to ${challenge.email}.` : "Enter your credentials to access your workspace"}</Text>

          {challenge ? (
            <>
              <Text style={styles.label}>Verification code</Text>
              <TextInput
                autoCapitalize="none"
                editable={!loading}
                keyboardType="number-pad"
                maxLength={6}
                onChangeText={setVerificationCode}
                onSubmitEditing={() => void verifyEmail()}
                placeholder="000000"
                placeholderTextColor="#64708d"
                style={styles.input}
                value={verificationCode}
              />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Pressable disabled={loading} onPress={() => void verifyEmail()} style={({ pressed }) => [styles.button, (pressed || loading) && styles.buttonPressed]}>
                {loading ? <ActivityIndicator color="#101958" /> : <Text style={styles.buttonText}>Verify and Sign In</Text>}
              </Pressable>
              <TouchableOpacity disabled={loading} onPress={() => void resendCode()} style={{ marginTop: 14, alignItems: "center" }}>
                <Text style={styles.backButtonText}>Resend code</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
          <Text style={styles.label}>Email Address <Text style={styles.required}>*</Text></Text>
          <TextInput
            autoCapitalize="none"
            autoComplete="email"
            editable={!loading}
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholder="vmms.admin@welinc.com"
            placeholderTextColor="#64708d"
            style={styles.input}
            value={email}
          />

          <View style={styles.passwordLabelRow}>
            <Text style={styles.label}>Password <Text style={styles.required}>*</Text></Text>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={onForgotPassword}
              style={styles.forgotPasswordButton}
            >
              <Text style={styles.forgotPassword}>Forgot password?</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.passwordRow}>
            <TextInput
              autoCapitalize="none"
              autoComplete="password"
              editable={!loading}
              onChangeText={setPassword}
              onSubmitEditing={() => void login()}
              placeholder="Enter your password"
              placeholderTextColor="#64708d"
              secureTextEntry={!showPassword}
              style={[styles.input, styles.passwordInput]}
              value={password}
            />
            <TouchableOpacity
              accessibilityHint={showPassword ? "Hides the password" : "Shows the password"}
              accessibilityLabel={showPassword ? "Hide password" : "Show password"}
              accessibilityRole="button"
              disabled={loading}
              onPress={() => setShowPassword((value) => !value)}
              style={styles.eyeButton}
            >
              <View style={styles.eyeOutline}>
                <View style={styles.eyePupil} />
                {!showPassword ? <View style={styles.eyeSlash} /> : null}
              </View>
            </TouchableOpacity>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable disabled={loading} onPress={() => void login()} style={({ pressed }) => [styles.button, (pressed || loading) && styles.buttonPressed]}>
            {loading ? <ActivityIndicator color="#101958" /> : <Text style={styles.buttonText}>Sign In</Text>}
          </Pressable>
            </>
          )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, position: "relative", backgroundColor: "#ffffff" },
  keyboardAvoidingView: { flex: 1, paddingHorizontal: 24 },
  cardArea: { flex: 1, justifyContent: "center" },
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
  logoTile: { alignSelf: "center", width: 56, height: 56, borderRadius: 16, overflow: "hidden", backgroundColor: "#f4c400", borderWidth: 2, borderColor: "#f4c400", marginBottom: 16 },
  logo: { width: "100%", height: "100%", transform: [{ scale: 1.55 }] },
  title: { color: "#ffffff", fontSize: 24, lineHeight: 29, fontWeight: "900", letterSpacing: -0.45 },
  subtitle: { color: "#aeb5d2", fontSize: 14, lineHeight: 20, marginTop: 3, marginBottom: 18 },
  label: { color: "#d9dcec", fontSize: 14, fontWeight: "700", marginBottom: 8 },
  required: { color: "#f4c400" },
  input: { height: 46, borderRadius: 12, backgroundColor: "#eaf0ff", color: "#14192d", paddingHorizontal: 15, fontSize: 14, marginBottom: 14 },
  passwordLabelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  forgotPasswordButton: { paddingVertical: 6 },
  forgotPassword: { color: "#f4c400", fontSize: 12, fontWeight: "600", marginBottom: 8 },
  passwordRow: { flexDirection: "row", alignItems: "center" },
  passwordInput: { flex: 1, paddingRight: 54 },
  eyeButton: { position: "absolute", right: 10, top: 8, minWidth: 40, minHeight: 40, alignItems: "center", justifyContent: "center" },
  eyeOutline: { width: 20, height: 13, borderWidth: 1.5, borderColor: "#cdd5ec", borderRadius: 12, alignItems: "center", justifyContent: "center" },
  eyePupil: { width: 5, height: 5, borderRadius: 5, backgroundColor: "#cdd5ec" },
  eyeSlash: { position: "absolute", width: 24, height: 1.5, backgroundColor: "#cdd5ec", transform: [{ rotate: "-45deg" }] },
  button: { borderRadius: 12, minHeight: 52, alignItems: "center", justifyContent: "center", backgroundColor: "#f4c400", shadowColor: "#f4c400", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.26, shadowRadius: 10, elevation: 5 },
  buttonPressed: { opacity: 0.72 },
  buttonText: { color: "#101958", fontSize: 16, fontWeight: "900" },
  error: { color: "#fecaca", fontSize: 14, lineHeight: 20, marginTop: -12, marginBottom: 16 },
  trucksBackground: { position: "absolute", left: 0, right: 0, bottom: 0, width: "100%", height: 170 },
});
