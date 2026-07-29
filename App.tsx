import { StatusBar } from "expo-status-bar";
import * as SQLite from "expo-sqlite";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { clearDatabase, initializeDatabase } from "./database/database";
import { DATABASE_NAME } from "./database/tables";
import { DashboardScreen } from "./screens/DashboardScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { WorkOrderScreen } from "./screens/WorkOrderScreen";
import {
  API_BASE_URL,
  AuthService,
  getMobileAccessRole,
  type AuthenticatedUser,
} from "./services/AuthService";
import { SyncService } from "./services/SyncService";

const authService = new AuthService(API_BASE_URL);
const welinc = require("./assets/welinc_logo.jpg");

const syncService = new SyncService({
  apiBaseUrl: API_BASE_URL,
  getAccessToken: () => authService.getAccessToken(),
  onUnauthorized: () => authService.clearSession(),
});

export default function App() {
  const [startupStatus, setStartupStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [startupError, setStartupError] = useState<string | null>(null);
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [activeScreen, setActiveScreen] = useState<"dashboard" | "work-orders">(
    "dashboard",
  );

  useEffect(() => {
    let mounted = true;
    Promise.all([initializeDatabase(), authService.restoreSession()])
      .then(async ([, restoredUser]) => {
        if (!mounted) return;

        if (restoredUser) {
          try {
            await syncService.forceRefreshFromBackend();
          } catch (error) {
            console.warn("[App] Forced backend refresh failed", error);
          }
        }

        setUser(restoredUser);
        setStartupStatus("ready");
      })
      .catch((error) => {
        console.error("[App] Startup failed", error);
        if (mounted) {
          setStartupStatus("error");
          setStartupError(
            error instanceof Error ? error.message : String(error),
          );
        }
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
      setActiveScreen("dashboard");
    }
  };

  const navigateTo = (screen: "dashboard" | "work-orders") => {
    setActiveScreen(screen);
  };

  const renderContent = () => {
    if (startupStatus === "loading") {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="large" />
          <Text style={styles.message}>Preparing offline storage…</Text>
        </View>
      );
    }

    if (startupStatus === "error") {
      return (
        <View style={styles.centered}>
          <Text style={styles.error}>
            Unable to initialize offline storage.
          </Text>
          {startupError ? (
            <Text style={styles.errorDetails}>{startupError}</Text>
          ) : null}
        </View>
      );
    }

    if (!user) {
      return (
        <LoginScreen authService={authService} onAuthenticated={setUser} />
      );
    }

    const accessRole = getMobileAccessRole(user.roles);
    if (accessRole === "none") {
      return (
        <View style={styles.centered}>
          <Text style={styles.error}>
            Only mechanics and chief mechanics can use this mobile version.
          </Text>
          <TouchableOpacity
            style={styles.logoutButton}
            onPress={() => void logout()}
          >
            <Text style={styles.logoutButtonText}>Log out</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={styles.shell}>
        <View style={styles.header}>
          <View style={styles.headerTitleBlock}>
            <Image source={welinc} style={styles.logo} resizeMode="contain" />
            <View style={styles.headerTextBlock}>
              <Text style={styles.title}>VMMS</Text>
              <Text style={styles.userName}>
                {user.name} •{" "}
                {accessRole === "chiefMechanic" ? "Chief Mechanic" : "Mechanic"}
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={styles.logoutButton}
            onPress={() => void logout()}
          >
            <Text style={styles.logoutButtonText}>Log out</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[
              styles.tabButton,
              activeScreen === "dashboard" && styles.tabButtonActive,
            ]}
            onPress={() => navigateTo("dashboard")}
          >
            <Text
              style={[
                styles.tabButtonText,
                activeScreen === "dashboard" && styles.tabButtonTextActive,
              ]}
            >
              Dashboard
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.tabButton,
              activeScreen === "work-orders" && styles.tabButtonActive,
            ]}
            onPress={() => navigateTo("work-orders")}
          >
            <Text
              style={[
                styles.tabButtonText,
                activeScreen === "work-orders" && styles.tabButtonTextActive,
              ]}
            >
              Work Order
            </Text>
          </TouchableOpacity>
        </View>

        {activeScreen === "dashboard" ? (
          <DashboardScreen
            user={user}
            syncService={syncService}
            onLogout={logout}
          />
        ) : (
          <WorkOrderScreen accessRole={accessRole} user={user} />
        )}
      </View>
    );
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>{renderContent()}</SafeAreaView>
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#f1f5f9" },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#f1f5f9",
  },
  message: { marginTop: 12, color: "#64748b" },
  error: { color: "#ef4444", textAlign: "center" },
  errorDetails: { marginTop: 8, color: "#9b1c1c", textAlign: "center" },
  shell: { flex: 1, backgroundColor: "#f1f5f9" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 12,
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  headerTitleBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  logo: { width: 32, height: 32 },
  headerTextBlock: { flex: 1 },
  title: { fontSize: 24, fontWeight: "800", color: "#1a1f6e" },
  userName: { fontSize: 13, color: "#64748b", marginTop: 2 },
  logoutButton: {
    backgroundColor: "#ef4444",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  logoutButtonText: { color: "#fff", fontWeight: "700" },
  tabBar: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  tabButton: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: 999,
    marginHorizontal: 4,
  },
  tabButtonActive: { backgroundColor: "#1a1f6e" },
  tabButtonText: { fontSize: 14, fontWeight: "700", color: "#64748b" },
  tabButtonTextActive: { color: "#ffffff" },
});
