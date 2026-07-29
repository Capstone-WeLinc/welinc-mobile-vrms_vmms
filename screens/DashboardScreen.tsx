import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { getMaintenanceSchedules, getVehicles } from "../database/database";
import type { MaintenanceSchedule, Vehicle } from "../database/tables";
import type { AuthenticatedUser } from "../services/AuthService";
import { SyncService, type SyncResult } from "../services/SyncService";

interface DashboardScreenProps {
  user: AuthenticatedUser;
  syncService: SyncService;
  onLogout: () => Promise<void>;
}

export function DashboardScreen({
  user,
  syncService,
  onLogout,
}: DashboardScreenProps) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [schedules, setSchedules] = useState<MaintenanceSchedule[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<
    "starting" | "online" | "offline" | "error"
  >("starting");
  const [error, setError] = useState<string | null>(null);

  const loadCache = useCallback(async () => {
    const [cachedVehicles, cachedSchedules] = await Promise.all([
      getVehicles(),
      getMaintenanceSchedules(),
    ]);
    setVehicles(cachedVehicles);
    setSchedules(cachedSchedules);
  }, []);

  const applySyncResult = useCallback(
    async (result: SyncResult) => {
      setSyncState(result.status === "offline" ? "offline" : "online");
      setLastSync(result.synchronizedAt);
      setError(null);
      await loadCache();
    },
    [loadCache],
  );

  const synchronize = useCallback(async () => {
    setRefreshing(true);
    try {
      await applySyncResult(await syncService.sync());
    } catch (syncError) {
      setSyncState("error");
      setError(
        syncError instanceof Error
          ? syncError.message
          : "Synchronization failed.",
      );
      await loadCache();
    } finally {
      setRefreshing(false);
    }
  }, [applySyncResult, loadCache, syncService]);

  useEffect(() => {
    void loadCache();
    const unsubscribeSync = syncService.subscribe(
      (result) => void applySyncResult(result),
    );
    const stopAutoSync = syncService.startAutoSync();
    void synchronize();
    return () => {
      unsubscribeSync();
      stopAutoSync();
    };
  }, [applySyncResult, loadCache, syncService, synchronize]);

  return (
    <FlatList
      contentContainerStyle={styles.content}
      data={vehicles}
      keyExtractor={(vehicle) => vehicle.id}
      ListEmptyComponent={
        syncState === "starting" ? (
          <ActivityIndicator />
        ) : (
          <Text style={styles.empty}>No cached vehicles.</Text>
        )
      }
      ListHeaderComponent={
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <View>
              <Text style={styles.title}>Vehicle Maintenance</Text>
              <Text style={styles.subtitle}>Signed in as {user.name}</Text>
            </View>
            <Pressable onPress={() => void onLogout()}>
              <Text style={styles.logout}>Log out</Text>
            </Pressable>
          </View>

          <View
            style={[styles.status, syncState === "error" && styles.statusError]}
          >
            <Text style={styles.statusText}>
              {syncState === "online"
                ? "Online — synchronized"
                : syncState === "offline"
                  ? "Offline — showing SQLite cache"
                  : syncState === "error"
                    ? "Sync failed — showing last good cache"
                    : "Checking connection…"}
            </Text>
            {lastSync ? (
              <Text style={styles.timestamp}>
                Last sync: {new Date(lastSync).toLocaleString()}
              </Text>
            ) : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>

          <View style={styles.metrics}>
            <Metric label="Vehicles" value={vehicles.length} />
            <Metric label="Schedules" value={schedules.length} />
          </View>
          <Text style={styles.sectionTitle}>Cached vehicles</Text>
        </View>
      }
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void synchronize()}
        />
      }
      renderItem={({ item }) => (
        <View style={styles.vehicleCard}>
          <View>
            <Text style={styles.plate}>{item.plateNumber}</Text>
            <Text style={styles.model}>{item.model}</Text>
          </View>
          <View style={styles.vehicleRight}>
            <Text style={styles.vehicleStatus}>
              {item.status.replaceAll("_", " ")}
            </Text>
            <Text style={styles.odometer}>
              {item.odometer.toLocaleString()} km
            </Text>
          </View>
        </View>
      )}
    />
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 18,
    paddingBottom: 40,
    backgroundColor: "#f1f5f9",
    flexGrow: 1,
  },
  header: { gap: 16 },
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  title: { fontSize: 24, fontWeight: "700", color: "#0d0d0d" },
  subtitle: { color: "#64748b", marginTop: 2 },
  logout: { color: "#1a1f6e", fontWeight: "600", padding: 6 },
  status: {
    padding: 14,
    borderRadius: 10,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  statusError: { backgroundColor: "#fef2f2" },
  statusText: { color: "#0d0d0d", fontWeight: "600" },
  timestamp: { color: "#64748b", fontSize: 12, marginTop: 4 },
  error: { color: "#ef4444", fontSize: 12, marginTop: 4 },
  metrics: { flexDirection: "row", gap: 12 },
  metric: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  metricValue: { fontSize: 24, fontWeight: "700", color: "#1a1f6e" },
  metricLabel: { color: "#64748b" },
  sectionTitle: { fontSize: 18, fontWeight: "700", color: "#0d0d0d" },
  vehicleCard: {
    marginTop: 10,
    borderRadius: 12,
    padding: 15,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    flexDirection: "row",
    justifyContent: "space-between",
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  plate: { fontSize: 17, fontWeight: "700", color: "#0d0d0d" },
  model: { color: "#64748b", marginTop: 2 },
  vehicleRight: { alignItems: "flex-end" },
  vehicleStatus: { color: "#1a1f6e", fontSize: 12, fontWeight: "600" },
  odometer: { color: "#64748b", marginTop: 5 },
  empty: { color: "#64748b", textAlign: "center", marginTop: 30 },
});
