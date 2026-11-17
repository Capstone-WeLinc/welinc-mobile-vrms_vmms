import { useCallback, useEffect, useRef, useState } from "react";
import { workOrderStatusColors, workOrderStatusTextColor } from "./workOrderStatusColors";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { acknowledgeFuelAnomaly, getFuelAnomalyApprovals, type FuelAnomalyApproval, type MaintenanceNotification } from "../services/NotificationService";
import { MobilePageHeader } from "../components/MobilePageHeader";
import { getPendingCriticalFuelApprovals, shouldShowFuelAnomalyApprovalPanel } from "../services/fuelAnomalyApprovalVisibility";

// Due and odometer reminders correspond to pending work orders in the mobile list.
const notificationColors = {
  CREATED: workOrderStatusColors.pending,
  DUE: workOrderStatusColors.pending,
  OVERDUE: workOrderStatusColors.overdue,
  ODOMETER_BUFFER: workOrderStatusColors.pending,
  FUEL_ANOMALY: workOrderStatusColors.overdue,
};

const labels = { CREATED: "New assignment", DUE: "Due", OVERDUE: "Overdue", ODOMETER_BUFFER: "Odometer reminder", FUEL_ANOMALY: "Fuel anomaly" };

export function NotificationsScreen({ notifications, loading, error, onRefresh, onOpen, onLoadingChange, accessRole }: {
  notifications: MaintenanceNotification[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void | Promise<void>;
  onOpen: (notification: MaintenanceNotification) => void;
  onLoadingChange?: (loading: boolean) => void;
  accessRole: "chiefMechanic" | "mechanic";
}) {
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [fuelAnomalies, setFuelAnomalies] = useState<FuelAnomalyApproval[]>([]);
  const [fuelLoading, setFuelLoading] = useState(false);
  const [fuelError, setFuelError] = useState<string | null>(null);
  const fuelRequestId = useRef(0);
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [acknowledging, setAcknowledging] = useState<Record<string, boolean>>({});
  const pendingFuelApprovals = getPendingCriticalFuelApprovals(accessRole, fuelAnomalies);

  const refreshFuelAnomalies = useCallback(async () => {
    const requestId = ++fuelRequestId.current;
    if (!shouldShowFuelAnomalyApprovalPanel(accessRole)) {
      setFuelLoading(false);
      return;
    }
    setFuelLoading(true);
    try {
      const anomalies = await getFuelAnomalyApprovals();
      if (requestId !== fuelRequestId.current) return;
      setFuelAnomalies(anomalies);
      setFuelError(null);
    } catch (requestError) {
      if (requestId !== fuelRequestId.current) return;
      setFuelError(requestError instanceof Error ? requestError.message : "Unable to load fuel approvals.");
    } finally {
      if (requestId === fuelRequestId.current) setFuelLoading(false);
    }
  }, [accessRole]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refreshFuelAnomalies(); }, [refreshFuelAnomalies]);

  const acknowledge = async (anomalyId: string) => {
    setAcknowledging((current) => ({ ...current, [anomalyId]: true }));
    setFuelError(null);
    try {
      await acknowledgeFuelAnomaly(anomalyId, remarks[anomalyId]?.trim() || undefined);
      setRemarks((current) => ({ ...current, [anomalyId]: "" }));
      await refreshFuelAnomalies();
      await onRefresh();
    } catch (requestError) {
      setFuelError(requestError instanceof Error ? requestError.message : "Unable to acknowledge this fuel anomaly.");
    } finally {
      setAcknowledging((current) => {
        const next = { ...current };
        delete next[anomalyId];
        return next;
      });
    }
  };

  const handlePullRefresh = async () => {
    if (pullRefreshing) return;
    setPullRefreshing(true);
    onLoadingChange?.(true);
    try {
      await onRefresh();
      await refreshFuelAnomalies();
    } finally {
      setPullRefreshing(false);
      onLoadingChange?.(false);
    }
  };
  useEffect(() => {
    onLoadingChange?.(loading);
    return () => onLoadingChange?.(false);
  }, [loading, onLoadingChange]);
  return (
    <ScrollView testID="notifications-scroll-view" contentContainerStyle={styles.container} refreshControl={<RefreshControl refreshing={pullRefreshing} onRefresh={() => { void handlePullRefresh().catch(() => undefined); }} colors={["#1a1f6e", "#d4a93f"]} tintColor="#1a1f6e" progressBackgroundColor="#ffffff" />}>
      <MobilePageHeader title="Notifications" subtitle="Maintenance updates and alerts" />
      {shouldShowFuelAnomalyApprovalPanel(accessRole) ? (
        <View style={styles.approvalSection}>
          <Text style={styles.sectionTitle}>Critical Fuel Anomalies</Text>
          <Text style={styles.sectionDescription}>Review and acknowledge open fuel anomalies that have reached the 7-day critical stage.</Text>
          {fuelLoading ? <ActivityIndicator accessible accessibilityLabel="Loading fuel approvals" accessibilityRole="progressbar" color="#1a1f6e" /> : null}
          {fuelError ? <Text accessibilityRole="alert" style={styles.error}>{fuelError}</Text> : null}
          {!fuelLoading && !fuelError && pendingFuelApprovals.length === 0 ? <Text style={styles.emptyApproval}>No critical fuel approvals pending.</Text> : null}
          {pendingFuelApprovals.map((item) => (
            <View key={item.id} style={styles.approvalCard}>
              <Text style={styles.approvalTitle}>{item.vehicle.plateNumber} - Critical fuel anomaly</Text>
              <Text style={styles.approvalDetail}>{item.efficiency.toFixed(1)} km/L vs. {item.rollingAverage.toFixed(1)} km/L rolling average</Text>
              <Text style={styles.approvalDetail}>{item.note?.trim() || "Operations has not added a resolution note."}</Text>
              <TextInput value={remarks[item.id] ?? ""} onChangeText={(value) => setRemarks((current) => ({ ...current, [item.id]: value }))} placeholder="Optional acknowledgment remark" style={styles.remarkInput} multiline />
              <TouchableOpacity accessibilityRole="button" onPress={() => void acknowledge(item.id)} disabled={Boolean(acknowledging[item.id])} style={[styles.ackButton, acknowledging[item.id] && styles.disabledButton]}>
                <Text style={styles.ackButtonText}>{acknowledging[item.id] ? "Saving..." : "Acknowledge anomaly"}</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ) : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {!loading && !error && !notifications.length ? <Text>No notifications yet.</Text> : null}
      {notifications.map((item) => (
        <TouchableOpacity key={`${item.source}-${item.id}`} style={[styles.card, notificationColors[item.kind]]} accessibilityRole="button" accessibilityLabel={`${item.readAt ? "Read" : "Unread"}. ${item.message}${item.source === "maintenance" ? ". Open work order." : ". Mark as read."}`} onPress={() => onOpen(item)}>
          <View style={styles.row}>
            <Text style={styles.label}>{labels[item.kind]}</Text>
            {!item.readAt ? <Text style={styles.label}>New</Text> : null}
          </View>
          <Text style={styles.message}>{item.message}</Text>
          <Text style={styles.date}>{new Date(item.createdAt).toLocaleString()}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 12, flexGrow: 1 },
  card: { padding: 16, borderRadius: 12, backgroundColor: "#fff", borderWidth: 1, borderColor: "#dedede" },

  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  label: { fontWeight: "700", color: workOrderStatusTextColor },
  message: { color: "#292929", lineHeight: 22 },
  date: { color: "#666", fontSize: 12, marginTop: 10 },
  error: { color: "#a32121" },
  approvalSection: { gap: 10, padding: 16, borderRadius: 12, borderWidth: 1, borderColor: "#e2b552", backgroundColor: "#fffaf0" },
  sectionTitle: { color: "#1a1f6e", fontSize: 17, fontWeight: "700" },
  sectionDescription: { color: "#555", lineHeight: 20 },
  emptyApproval: { color: "#555", fontSize: 13 },
  approvalCard: { gap: 8, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: "#e1c477", backgroundColor: "#fff" },
  approvalTitle: { color: "#8c1d18", fontWeight: "700" },
  approvalDetail: { color: "#333", lineHeight: 20 },
  remarkInput: { minHeight: 44, borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 10, textAlignVertical: "top" },
  ackButton: { alignItems: "center", paddingVertical: 11, borderRadius: 8, backgroundColor: "#1a1f6e" },
  ackButtonText: { color: "#fff", fontWeight: "700" },
  disabledButton: { opacity: 0.6 },
});
