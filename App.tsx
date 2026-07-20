import { StatusBar } from 'expo-status-bar';
import { useDrizzleStudio } from 'expo-drizzle-studio-plugin';
import * as SQLite from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { clearDatabase, initializeDatabase } from './database/database';
import { DATABASE_NAME } from './database/tables';
import { DashboardScreen } from './screens/DashboardScreen';
import { LoginScreen } from './screens/LoginScreen';
import { API_BASE_URL, AuthService, type AuthenticatedUser } from './services/AuthService';
import { SyncService } from './services/SyncService';

const authService = new AuthService(API_BASE_URL);
const studioDatabase = SQLite.openDatabaseSync(DATABASE_NAME);
const syncService = new SyncService({
  apiBaseUrl: API_BASE_URL,
  getAccessToken: () => authService.getAccessToken(),
});

export default function App() {
  useDrizzleStudio(studioDatabase);

  const [startupStatus, setStartupStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [user, setUser] = useState<AuthenticatedUser | null>(null);

  useEffect(() => {
    let mounted = true;
    Promise.all([initializeDatabase(), authService.restoreSession()])
      .then(([, restoredUser]) => {
        if (!mounted) return;
        setUser(restoredUser);
        setStartupStatus('ready');
      })
      .catch((error) => {
        console.error('[App] Startup failed', error);
        if (mounted) setStartupStatus('error');
      });
    return () => {
      mounted = false;
      syncService.stopAutoSync();
    };
  }, []);

  const logout = async () => {
    syncService.stopAutoSync();
    try {
      await authService.clearSession();
      // Prevent one account from seeing another account's cached data.
      await clearDatabase();
    } finally {
      setUser(null);
    }
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        {startupStatus === 'loading' ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" />
            <Text style={styles.message}>Preparing offline storage…</Text>
          </View>
        ) : startupStatus === 'error' ? (
          <View style={styles.centered}>
            <Text style={styles.error}>Unable to initialize offline storage.</Text>
          </View>
        ) : user ? (
          <DashboardScreen user={user} syncService={syncService} onLogout={logout} />
        ) : (
          <LoginScreen authService={authService} onAuthenticated={setUser} />
        )}
      </SafeAreaView>
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f8fafc' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  message: { marginTop: 12, color: '#64748b' },
  error: { color: '#b91c1c', textAlign: 'center' },
});
