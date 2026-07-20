import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
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
        <Text style={styles.subtitle}>Sign in to synchronize maintenance data.</Text>

        <Text style={styles.label}>Email</Text>
        <TextInput
          autoCapitalize="none"
          autoComplete="email"
          editable={!loading}
          keyboardType="email-address"
          onChangeText={setEmail}
          placeholder="name@example.com"
          style={styles.input}
          value={email}
        />

        <Text style={styles.label}>Password</Text>
        <TextInput
          autoCapitalize="none"
          autoComplete="password"
          editable={!loading}
          onChangeText={setPassword}
          onSubmitEditing={() => void login()}
          placeholder="Password"
          secureTextEntry
          style={styles.input}
          value={password}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          disabled={loading}
          onPress={() => void login()}
          style={({ pressed }) => [styles.button, (pressed || loading) && styles.buttonDisabled]}
        >
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign in</Text>}
        </Pressable>

        <Text style={styles.endpoint}>Backend: {API_BASE_URL}</Text>
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
  button: { marginTop: 14, borderRadius: 10, padding: 14, alignItems: 'center', backgroundColor: '#1d4ed8' },
  buttonDisabled: { opacity: 0.65 },
  buttonText: { color: '#fff', fontWeight: '700' },
  error: { color: '#b91c1c', marginTop: 8 },
  endpoint: { color: '#94a3b8', fontSize: 11, marginTop: 12, textAlign: 'center' },
});
