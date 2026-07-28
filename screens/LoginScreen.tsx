import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { API_BASE_URL, AuthService, type AuthenticatedUser } from '../services/AuthService';

interface LoginScreenProps {
  authService: AuthService;
  onAuthenticated: (user: AuthenticatedUser) => void;
}

export function LoginScreen({ authService, onAuthenticated }: LoginScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const login = async () => {
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      onAuthenticated(await authService.login(email, password));
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Unable to sign in.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <View style={styles.card}>
        <Text style={styles.title}>VMMS Mobile</Text>
        <Text style={styles.subtitle}>Sign in to your account</Text>
        <Text style={styles.label}>Email</Text>
        <TextInput
          autoCapitalize="none"
          autoComplete="email"
          editable={!loading}
          keyboardType="email-address"
          onChangeText={setEmail}
          placeholder="vmms.name@welinc.com"
          style={styles.input}
          value={email}
        />

        <Text style={styles.label}>Password</Text>
        <View style={styles.passwordRow}>
          <TextInput
            autoCapitalize="none"
            autoComplete="password"
            editable={!loading}
            onChangeText={setPassword}
            onSubmitEditing={() => void login()}
            placeholder="Password"
            secureTextEntry={!showPassword}
            style={[styles.input, styles.passwordInput]}
            value={password}
          />
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => setShowPassword((value) => !value)}
            style={styles.passwordToggle}
          >
            <Text style={styles.passwordToggleText}>{showPassword ? 'Hide' : 'Show'}</Text>
          </TouchableOpacity>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          disabled={loading}
          onPress={() => void login()}
          style={({ pressed }) => [styles.button, (pressed || loading) && styles.buttonDisabled]}
        >
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign in</Text>}
        </Pressable>

      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#eef2f7' },
  card: { borderRadius: 16, backgroundColor: '#fff', padding: 24, gap: 8, elevation: 3 },
  title: { fontSize: 28, fontWeight: '700', color: '#172554' },
  subtitle: { color: '#64748b', marginBottom: 16 },
  label: { color: '#334155', fontWeight: '600', marginTop: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#fff',
  },
  passwordRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  passwordInput: { flex: 1 },
  passwordToggle: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#f8fafc',
  },
  passwordToggleText: { color: '#1d4ed8', fontWeight: '700' },
  button: { marginTop: 14, borderRadius: 10, padding: 14, alignItems: 'center', backgroundColor: '#1d4ed8' },
  buttonDisabled: { opacity: 0.65 },
  buttonText: { color: '#fff', fontWeight: '700' },
  error: { color: '#b91c1c', marginTop: 8 },
  endpoint: { color: '#94a3b8', fontSize: 11, marginTop: 12, textAlign: 'center' },
});
