import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { getMaintenanceSchedules, getVehicles } from '../database/database';
import type { MaintenanceSchedule, Vehicle } from '../database/tables';
import type { AuthenticatedUser } from '../services/AuthService';
import { SyncService, type SyncResult } from '../services/SyncService';

interface DashboardScreenProps {
  user: AuthenticatedUser;
  syncService: SyncService;
  onLogout: () => Promise<void>;
}

export function DashboardScreen({ user, syncService, onLogout }: DashboardScreenProps) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [schedules, setSchedules] = useState<MaintenanceSchedule[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<'starting' | 'online' | 'offline' | 'error'>('starting');
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
      setSyncState(result.status === 'offline' ? 'offline' : 'online');
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
      setSyncState('error');
      setError(syncError instanceof Error ? syncError.message : 'Synchronization failed.');
      await loadCache();
    } finally {
      setRefreshing(false);
    }
  }, [applySyncResult, loadCache, syncService]);

  useEffect(() => {
    void loadCache();
    const unsubscribeSync = syncService.subscribe((result) => void applySyncResult(result));
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
        syncState === 'starting' ? <ActivityIndicator /> : <Text style={styles.empty}>No cached vehicles.</Text>
      }
      ListHeaderComponent={
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <View>
              <Text style={styles.title}>Vehicle Maintenance</Text>
              <Text style={styles.subtitle}>Signed in as {user.name}</Text>
            </View>
            <Pressable onPress={() => void onLogout()}><Text style={styles.logout}>Log out</Text></Pressable>
          </View>

          <View style={[styles.status, syncState === 'error' && styles.statusError]}>
            <Text style={styles.statusText}>
              {syncState === 'online'
                ? 'Online — synchronized'
                : syncState === 'offline'
                  ? 'Offline — showing SQLite cache'
                  : syncState === 'error'
                    ? 'Sync failed — showing last good cache'
                    : 'Checking connection…'}
            </Text>
            {lastSync ? <Text style={styles.timestamp}>Last sync: {new Date(lastSync).toLocaleString()}</Text> : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>

          <View style={styles.metrics}>
            <Metric label="Vehicles" value={vehicles.length} />
            <Metric label="Schedules" value={schedules.length} />
          </View>
          <Text style={styles.sectionTitle}>Cached vehicles</Text>
        </View>
      }
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void synchronize()} />}
      renderItem={({ item }) => (
        <View style={styles.vehicleCard}>
          <View>
            <Text style={styles.plate}>{item.plateNumber}</Text>
            <Text style={styles.model}>{item.vehicleModel}</Text>
          </View>
          <View style={styles.vehicleRight}>
            <Text style={styles.vehicleStatus}>{item.status.replaceAll('_', ' ')}</Text>
            <Text style={styles.odometer}>{item.odometerReading.toLocaleString()} km</Text>
          </View>
        </View>
      )}
    />
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  content: { padding: 18, paddingBottom: 40, backgroundColor: '#f8fafc', flexGrow: 1 },
  header: { gap: 16 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  title: { fontSize: 24, fontWeight: '700', color: '#172554' },
  subtitle: { color: '#64748b', marginTop: 2 },
  logout: { color: '#1d4ed8', fontWeight: '600', padding: 6 },
  status: { padding: 14, borderRadius: 10, backgroundColor: '#dbeafe' },
  statusError: { backgroundColor: '#fee2e2' },
  statusText: { color: '#1e3a8a', fontWeight: '600' },
  timestamp: { color: '#64748b', fontSize: 12, marginTop: 4 },
  error: { color: '#b91c1c', fontSize: 12, marginTop: 4 },
  metrics: { flexDirection: 'row', gap: 12 },
  metric: { flex: 1, padding: 16, borderRadius: 12, backgroundColor: '#fff', elevation: 1 },
  metricValue: { fontSize: 24, fontWeight: '700', color: '#172554' },
  metricLabel: { color: '#64748b' },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#1e293b' },
  vehicleCard: {
    marginTop: 10,
    borderRadius: 12,
    padding: 15,
    backgroundColor: '#fff',
    flexDirection: 'row',
    justifyContent: 'space-between',
    elevation: 1,
  },
  plate: { fontSize: 17, fontWeight: '700', color: '#1e293b' },
  model: { color: '#64748b', marginTop: 2 },
  vehicleRight: { alignItems: 'flex-end' },
  vehicleStatus: { color: '#0369a1', fontSize: 12, fontWeight: '600' },
  odometer: { color: '#64748b', marginTop: 5 },
  empty: { color: '#64748b', textAlign: 'center', marginTop: 30 },
});
