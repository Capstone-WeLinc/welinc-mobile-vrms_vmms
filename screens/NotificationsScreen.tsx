import { useEffect, useState } from "react";
import { workOrderStatusColors, workOrderStatusTextColor } from "./workOrderStatusColors";
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { MaintenanceNotification } from "../services/NotificationService";
import { MobilePageHeader } from "../components/MobilePageHeader";

// Due and odometer reminders correspond to pending work orders in the mobile list.
const notificationColors = {
  CREATED: workOrderStatusColors.pending,
  DUE: workOrderStatusColors.pending,
  OVERDUE: workOrderStatusColors.overdue,
  ODOMETER_BUFFER: workOrderStatusColors.pending,
};

const labels = { CREATED: "New assignment", DUE: "Due", OVERDUE: "Overdue", ODOMETER_BUFFER: "Odometer reminder" };

export function NotificationsScreen({ notifications, loading, error, onRefresh, onOpen, onLoadingChange }: {
  notifications: MaintenanceNotification[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void | Promise<void>;
  onOpen: (notification: MaintenanceNotification) => void;
  onLoadingChange?: (loading: boolean) => void;
}) {
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const handlePullRefresh = async () => {
    if (pullRefreshing) return;
    setPullRefreshing(true);
    onLoadingChange?.(true);
    try {
      await onRefresh();
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
    <ScrollView contentContainerStyle={styles.container} refreshControl={<RefreshControl refreshing={pullRefreshing} onRefresh={() => void handlePullRefresh()} colors={["#1a1f6e", "#d4a93f"]} tintColor="#1a1f6e" progressBackgroundColor="#ffffff" />}>
      <MobilePageHeader title="Notifications" subtitle="Maintenance updates and alerts" />
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {!loading && !error && !notifications.length ? <Text>No notifications yet.</Text> : null}
      {notifications.map((item) => (
        <TouchableOpacity key={item.id} style={[styles.card, notificationColors[item.kind]]} accessibilityRole="button" accessibilityLabel={`${item.readAt ? "Read" : "Unread"}. ${item.message}. Open work order.`} onPress={() => onOpen(item)}>
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
});
