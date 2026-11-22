import { useCallback, useEffect, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { getMaintenanceSchedules } from "../database/database";
import type { MaintenanceSchedule } from "../database/tables";
import type { AuthenticatedUser } from "../services/AuthService";
import { SyncService, type SyncResult } from "../services/SyncService";
import { MobilePageHeader } from "../components/MobilePageHeader";
import { MaintenanceStatusLegend } from "../components/MaintenanceStatusLegend";
import type {
  DashboardWorkOrderFilter,
  DashboardWorkOrderStatus,
} from "./workOrderDashboardFilter";
import { workOrderStatusColors, workOrderStatusTextColors } from "./workOrderStatusColors";

type MechanicPerformanceSummary = {
  key: string;
  mechanic: string;
  totalOrders: number;
  pending: number;
  due: number;
  inProgress: number;
  overdue: number;
  awaitingReview: number;
  completed: number;
  returned: number;
  checklistItemsDone: number;
  checklistItemsTotal: number;
};

function getScheduleWorkflowStatus(schedule: MaintenanceSchedule, progress: Record<string, unknown>): string {
  switch (schedule.status) {
    case "PENDING": return "Pending";
    case "DUE": return "Due";
    case "OVERDUE": return "Overdue";
    case "COMPLETED": return "Completed";
    case "CANCELLED": return "Cancelled";
  }
  if (typeof progress.workflowStatus === "string") return progress.workflowStatus;
  switch (schedule.status) {
    case "DONE": return "Done";
    case "IN_PROGRESS": return "In Progress";
    default: return "Pending";
  }
}

function getDashboardMetricColors(status: DashboardWorkOrderStatus) {
  switch (status) {
    case "Pending": return { container: workOrderStatusColors.pending, text: workOrderStatusTextColors.pending };
    case "Due": return { container: workOrderStatusColors.due, text: workOrderStatusTextColors.due };
    case "In Progress": return { container: workOrderStatusColors.inProgress, text: workOrderStatusTextColors.inProgress };
    case "Overdue": return { container: workOrderStatusColors.overdue, text: workOrderStatusTextColors.overdue };
    case "Awaiting Review": return { container: workOrderStatusColors.verification, text: workOrderStatusTextColors.verification };
    case "Completed": return { container: workOrderStatusColors.completed, text: workOrderStatusTextColors.completed };
    case "Returned": return { container: workOrderStatusColors.rejected, text: workOrderStatusTextColors.rejected };
    default: return { container: workOrderStatusColors.pending, text: workOrderStatusTextColors.pending };
  }
}

function summarizeMechanicWork(schedules: MaintenanceSchedule[]): MechanicPerformanceSummary[] {
  const summaries = new Map<string, MechanicPerformanceSummary>();
  schedules
    .filter((schedule) => schedule.assignedMechanicId && schedule.status !== "CANCELLED")
    .forEach((schedule) => {
      let progress: Record<string, unknown> = {};
      try {
        progress = schedule.workOrderProgress ? JSON.parse(schedule.workOrderProgress) as Record<string, unknown> : {};
      } catch {
        progress = {};
      }
      const key = schedule.assignedMechanicId!;
      const summary = summaries.get(key) ?? {
        key,
        mechanic: schedule.assignedMechanic || "Assigned Mechanic",
        totalOrders: 0,
        pending: 0,
        due: 0,
        inProgress: 0,
        overdue: 0,
        awaitingReview: 0,
        completed: 0,
        returned: 0,
        checklistItemsDone: 0,
        checklistItemsTotal: 0,
      };
      const status = getScheduleWorkflowStatus(schedule, progress);
      const items = Array.isArray(progress.executionItems) ? progress.executionItems as { status?: unknown }[] : [];
      summary.totalOrders += 1;
      summary.checklistItemsTotal += items.length;
      summary.checklistItemsDone += items.filter((item) => item.status === "checked" || item.status === "changed").length;
      if (status === "Completed") summary.completed += 1;
      else if (status === "Rejected" || status === "For Repair") summary.returned += 1;
      else if (status === "Done" || status === "For Verification" || progress.mechanicSubmitted === true) summary.awaitingReview += 1;
      else if (status === "In Progress") summary.inProgress += 1;
      else if (status === "Due") summary.due += 1;
      else if (status === "Overdue") summary.overdue += 1;
      else if (status !== "Cancelled") summary.pending += 1;
      summaries.set(key, summary);
    });
  return Array.from(summaries.values()).sort((left, right) => left.mechanic.localeCompare(right.mechanic));
}

interface DashboardScreenProps {
  user: AuthenticatedUser;
  syncService: SyncService;
  onLogout: () => Promise<void>;
  onLoadingChange?: (loading: boolean) => void;
  onOpenWorkOrders: (filter: DashboardWorkOrderFilter) => void;
}

export function DashboardScreen({
  user,
  syncService,
  onLogout,
  onLoadingChange,
  onOpenWorkOrders,
}: DashboardScreenProps) {
  const [schedules, setSchedules] = useState<MaintenanceSchedule[]>([]);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<
    "starting" | "online" | "offline" | "error"
  >("starting");
  const [error, setError] = useState<string | null>(null);
  const role = user.roles.find((item) => item.system === "VMMS")?.role;
  const accessRole = role === "CHIEF_MECHANIC" ? "chiefMechanic" : "mechanic";
  const isChiefMechanic = accessRole === "chiefMechanic";
  const canViewPerformance = isChiefMechanic || accessRole === "mechanic";
  const mechanicPerformance = canViewPerformance ? summarizeMechanicWork(schedules) : [];

  const loadCache = useCallback(async () => {
    const cachedSchedules = await getMaintenanceSchedules();
    setSchedules(cachedSchedules.filter((schedule) => {
      if (accessRole === "chiefMechanic") return schedule.chiefMechanicId === user.id;
      if (accessRole === "mechanic") return schedule.assignedMechanicId === user.id;
      return false;
    }));
  }, [accessRole, user.id]);

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
    // Show cached data immediately while the sync request runs.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={pullRefreshing}
          onRefresh={() => void synchronize(true)}
          colors={["#1a1f6e", "#d4a93f"]}
          tintColor="#1a1f6e"
          progressBackgroundColor="#ffffff"
        />
      }
    >
      <View style={styles.header}>
        <MobilePageHeader title="Dashboard" subtitle="Maintenance overview" />

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

        {canViewPerformance ? (
            <View style={styles.performanceSection}>
              <Text style={styles.sectionTitle}>{isChiefMechanic ? "Mechanic Performance" : "Work Order Overview"}</Text>
              <Text style={styles.performanceSubtitle}>
                {isChiefMechanic
                  ? "Progress for Mechanics assigned to your schedules."
                  : "Your work-order progress and checklist completion."}
              </Text>
              <MaintenanceStatusLegend />
              {mechanicPerformance.length === 0 ? (
                <Text style={styles.emptyCard}>
                  {isChiefMechanic ? "No assigned Mechanic work is available yet." : "You have no assigned work orders yet."}
                </Text>
              ) : mechanicPerformance.map((summary) => {
                const checklistPercent = summary.checklistItemsTotal
                  ? Math.round((summary.checklistItemsDone / summary.checklistItemsTotal) * 100)
                  : 0;
                return (
                  <View key={summary.key} style={styles.performanceCard}>
                    <View style={styles.performanceCardHeader}>
                      {isChiefMechanic ? <Text style={styles.performanceMechanicName}>{summary.mechanic}</Text> : null}
                      <Text style={styles.performanceOrderCount}>{summary.totalOrders} work orders</Text>
                    </View>
                    <View style={styles.performanceMetrics}>
                      {([
                        { label: "Pending", value: summary.pending },
                        { label: "Due", value: summary.due },
                        { label: "In Progress", value: summary.inProgress },
                        { label: "Overdue", value: summary.overdue },
                        { label: "Awaiting Review", value: summary.awaitingReview },
                        { label: "Completed", value: summary.completed },
                        { label: "Returned", value: summary.returned },
                      ] as { label: DashboardWorkOrderStatus; value: number }[]).map((metric) => (
                        <Pressable
                          key={metric.label}
                          accessibilityRole="button"
                          accessibilityLabel={`Open ${metric.label} work orders, ${metric.value} total`}
                          onPress={() =>
                            onOpenWorkOrders({
                              status: metric.label,
                              mechanicId: isChiefMechanic ? summary.key : null,
                              mechanicName: isChiefMechanic ? summary.mechanic : null,
                            })
                          }
                          style={({ pressed }) => [
                            styles.performanceMetric,
                            getDashboardMetricColors(metric.label).container,
                            pressed && styles.performanceMetricPressed,
                          ]}
                        >
                          <Text style={[styles.performanceMetricValue, { color: getDashboardMetricColors(metric.label).text }]}>{metric.value}</Text>
                          <Text style={[styles.performanceMetricLabel, { color: getDashboardMetricColors(metric.label).text }]}>{metric.label}</Text>
                        </Pressable>
                      ))}
                    </View>
                    <View style={styles.performanceChecklistRow}>
                      <Text style={styles.performanceMetricLabel}>Checklist items complete</Text>
                      <Text style={styles.performanceChecklistValue}>
                        {summary.checklistItemsDone}/{summary.checklistItemsTotal} ({checklistPercent}%)
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
        ) : null}
      </View>
    </ScrollView>
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
  performanceSection: { gap: 10 },
  performanceSubtitle: { color: "#64748b", fontSize: 12, lineHeight: 17 },
  emptyCard: { color: "#64748b", backgroundColor: "#ffffff", borderRadius: 12, padding: 12, fontSize: 12 },
  performanceCard: { backgroundColor: "#ffffff", borderRadius: 12, borderWidth: 1, borderColor: "#e2e8f0", padding: 12, gap: 10 },
  performanceCardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  performanceMechanicName: { color: "#1a1f6e", fontWeight: "800", fontSize: 14, flex: 1 },
  performanceOrderCount: { color: "#64748b", fontSize: 11, fontWeight: "700" },
  performanceMetrics: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  performanceMetric: { width: "48%", backgroundColor: "#f8fafc", borderRadius: 8, padding: 8 },
  performanceMetricPressed: { opacity: 0.72 },
  performanceMetricValue: { color: "#0f172a", fontWeight: "800", fontSize: 16 },
  performanceMetricLabel: { color: "#64748b", fontSize: 10, fontWeight: "700" },
  performanceChecklistRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  performanceChecklistValue: { color: "#1a1f6e", fontSize: 11, fontWeight: "800" },
  sectionTitle: { fontSize: 18, fontWeight: "700", color: "#0d0d0d" },
});
