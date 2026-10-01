import { useCallback, useEffect, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { getMaintenanceSchedules, getVehicles } from "../database/database";
import type { MaintenanceSchedule, Vehicle } from "../database/tables";
import { getMobileAccessRole, type AuthenticatedUser } from "../services/AuthService";
import { SyncService, type SyncResult } from "../services/SyncService";
import { MobilePageHeader } from "../components/MobilePageHeader";

interface DashboardScreenProps {
  user: AuthenticatedUser;
  syncService: SyncService;
  onLogout: () => Promise<void>;
  onLoadingChange?: (loading: boolean) => void;
}

export function DashboardScreen({
  user,
  syncService,
  onLogout,
  onLoadingChange,
}: DashboardScreenProps) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [schedules, setSchedules] = useState<MaintenanceSchedule[]>([]);
  const [pullRefreshing, setPullRefreshing] = useState(false);
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
    setSchedules(cachedSchedules.filter((schedule) => getMobileAccessRole(user.roles) === "chiefMechanic" ? schedule.chiefMechanicId === user.id : schedule.assignedMechanicId === user.id));
  }, [user.id, user.roles]);

  const applySyncResult = useCallback(
    async (result: SyncResult) => {
      setSyncState(result.status === "offline" ? "offline" : "online");
      setLastSync(result.synchronizedAt);
      setError(null);
      await loadCache();
    },
    [loadCache],
  );

  const synchronize = useCallback(async (fromPullToRefresh = false) => {
    onLoadingChange?.(true);
    if (fromPullToRefresh) setPullRefreshing(true);
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
      onLoadingChange?.(false);
      setPullRefreshing(false);
    }
  }, [applySyncResult, loadCache, onLoadingChange, syncService]);

  useEffect(() => {
    void loadCache();
    const unsubscribeSync = syncService.subscribe(
      (result) => void applySyncResult(result),
    );
    void synchronize();
    return () => {
      unsubscribeSync();
    };
  }, [applySyncResult, loadCache, syncService, synchronize]);

  return (
    <FlatList
      contentContainerStyle={styles.content}
      data={vehicles}
      keyExtractor={(vehicle) => vehicle.id}
      ListEmptyComponent={
        syncState === "starting" ? (
          <Text style={styles.empty}>Loading vehicle data…</Text>
        ) : (
          <Text style={styles.empty}>No cached vehicles.</Text>
        )
      }
      ListHeaderComponent={
        <View style={styles.header}>
          <MobilePageHeader title="Vehicle Maintenance" subtitle={`Signed in as ${user.name}`} />

          <View
            style={[styles.status, syncState === "error" && styles.statusError]}
          >
            <Text style={styles.statusText}>
              {syncState === "online"
                ? "Online"
                : syncState === "offline"
                  ? "Offline"
                  : syncState === "error"
                    ? "Sync failed"
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
          <Text style={styles.sectionTitle}>Vehicles</Text>
        </View>
      }
      refreshControl={
        <RefreshControl
          refreshing={pullRefreshing}
          onRefresh={() => void synchronize(true)}
          colors={["#1a1f6e", "#d4a93f"]}
          tintColor="#1a1f6e"
          progressBackgroundColor="#ffffff"
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
