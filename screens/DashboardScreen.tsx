import { useCallback, useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
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

type MechanicWorkMetric = {
  label: DashboardWorkOrderStatus;
  value: number;
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

function getMechanicWorkMetrics(
  summary: MechanicPerformanceSummary,
  prioritizeReview = false,
): MechanicWorkMetric[] {
  const pending = { label: "Pending", value: summary.pending } satisfies MechanicWorkMetric;
  const due = { label: "Due", value: summary.due } satisfies MechanicWorkMetric;
  const inProgress = { label: "In Progress", value: summary.inProgress } satisfies MechanicWorkMetric;
  const overdue = { label: "Overdue", value: summary.overdue } satisfies MechanicWorkMetric;
  const awaitingReview = { label: "Awaiting Review", value: summary.awaitingReview } satisfies MechanicWorkMetric;
  const completed = { label: "Completed", value: summary.completed } satisfies MechanicWorkMetric;
  const returned = { label: "Returned", value: summary.returned } satisfies MechanicWorkMetric;

  return prioritizeReview
    ? [awaitingReview, overdue, inProgress, due, pending, returned, completed]
    : [pending, due, inProgress, overdue, awaitingReview, completed, returned];
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
  const [expandedMechanicId, setExpandedMechanicId] = useState<string | null>(null);
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
        <MobilePageHeader
          title="Dashboard"
          subtitle={isChiefMechanic
            ? "Your assigned mechanics."
            : "Your maintenance work and checklist progress."}
        />

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
            <Text style={styles.sectionTitle}>
              {isChiefMechanic ? "Assigned Mechanics" : "Work Order Overview"}
            </Text>
            <Text style={styles.performanceSubtitle}>
              {isChiefMechanic
                ? "Select a mechanic to view work-order and checklist details."
                : "Your work-order progress and checklist completion."}
            </Text>
            {isChiefMechanic ? (
              mechanicPerformance.length === 0 ? (
                <Text style={styles.emptyCard}>No mechanics are assigned to your schedules yet.</Text>
              ) : (
                <View style={styles.mechanicNameList}>
                  {mechanicPerformance.map((summary) => {
                    const isExpanded = expandedMechanicId === summary.key;
                    const checklistPercent = summary.checklistItemsTotal
                      ? Math.round(
                          (summary.checklistItemsDone / summary.checklistItemsTotal) * 100,
                        )
                      : 0;

                    return (
                      <View key={summary.key} style={styles.mechanicDropdown}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`${isExpanded ? "Hide" : "Show"} details for ${summary.mechanic}`}
                          accessibilityState={{ expanded: isExpanded }}
                          onPress={() =>
                            setExpandedMechanicId((current) =>
                              current === summary.key ? null : summary.key,
                            )
                          }
                          style={({ pressed }) => [
                            styles.mechanicNameRow,
                            pressed && styles.performanceMetricPressed,
                          ]}
                        >
                          <Text style={styles.mechanicName}>{summary.mechanic}</Text>
                          <Ionicons
                            name={isExpanded ? "chevron-up" : "chevron-down"}
                            size={18}
                            color="#1a1f6e"
                          />
                        </Pressable>
                        {isExpanded ? (
                          <View style={styles.mechanicDropdownDetails}>
                            <Text style={styles.performanceOrderCount}>
                              {summary.totalOrders} work orders
                            </Text>
                            <View style={styles.performanceChecklist}>
                              <View style={styles.performanceChecklistRow}>
                                <Text style={styles.mechanicDetailSectionTitle}>
                                  Checklist progress
                                </Text>
                                <Text style={styles.performanceChecklistValue}>
                                  {summary.checklistItemsTotal > 0
                                    ? `${summary.checklistItemsDone}/${summary.checklistItemsTotal} (${checklistPercent}%)`
                                    : "No checklist items"}
                                </Text>
                              </View>
                              {summary.checklistItemsTotal > 0 ? (
                                <View style={styles.performanceChecklistTrack}>
                                  <View
                                    style={[
                                      styles.performanceChecklistFill,
                                      { width: `${checklistPercent}%` },
                                    ]}
                                  />
                                </View>
                              ) : null}
                            </View>
                            <Text style={styles.mechanicDetailSectionTitle}>
                              Work order status
                            </Text>
                            <View style={styles.performanceMetrics}>
                              {getMechanicWorkMetrics(summary, true).map((metric) => {
                                const colors = getDashboardMetricColors(metric.label);
                                return (
                                  <Pressable
                                    key={metric.label}
                                    accessibilityRole="button"
                                    accessibilityLabel={`Open ${metric.label} work orders for ${summary.mechanic}, ${metric.value} total`}
                                    onPress={() => {
                                      setExpandedMechanicId(null);
                                      onOpenWorkOrders({
                                        status: metric.label,
                                        mechanicId: summary.key,
                                        mechanicName: summary.mechanic,
                                      });
                                    }}
                                    style={({ pressed }) => [
                                      styles.performanceMetric,
                                      styles.chiefPerformanceMetric,
                                      colors.container,
                                      pressed && styles.performanceMetricPressed,
                                    ]}
                                  >
                                    <Text
                                      style={[
                                        styles.performanceMetricValue,
                                        { color: colors.text },
                                      ]}
                                    >
                                      {metric.value}
                                    </Text>
                                    <Text
                                      style={[
                                        styles.performanceMetricLabel,
                                        { color: colors.text },
                                      ]}
                                    >
                                      {metric.label}
                                    </Text>
                                  </Pressable>
                                );
                              })}
                            </View>
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              )
            ) : (
              <>
                <MaintenanceStatusLegend />
                {mechanicPerformance.length === 0 ? (
                  <Text style={styles.emptyCard}>You have no assigned work orders yet.</Text>
                ) : mechanicPerformance.map((summary) => {
                    const checklistPercent = summary.checklistItemsTotal
                      ? Math.round((summary.checklistItemsDone / summary.checklistItemsTotal) * 100)
                      : 0;
                    const metrics = getMechanicWorkMetrics(summary);
                    return (
                      <View key={summary.key} style={styles.performanceCard}>
                        <View style={styles.performanceCardHeader}>
                          <Text style={styles.performanceOrderCount}>{summary.totalOrders} work orders</Text>
                        </View>
                        <View style={styles.performanceMetrics}>
                          {metrics.map((metric) => {
                            const colors = getDashboardMetricColors(metric.label);
                            return (
                              <Pressable
                                key={metric.label}
                                accessibilityRole="button"
                                accessibilityLabel={`Open ${metric.label} work orders, ${metric.value} total`}
                                onPress={() =>
                                  onOpenWorkOrders({
                                    status: metric.label,
                                    mechanicId: null,
                                    mechanicName: null,
                                  })
                                }
                                style={({ pressed }) => [
                                  styles.performanceMetric,
                                  colors.container,
                                  pressed && styles.performanceMetricPressed,
                                ]}
                              >
                                <Text style={[styles.performanceMetricValue, { color: colors.text }]}>
                                  {metric.value}
                                </Text>
                                <Text style={[styles.performanceMetricLabel, { color: colors.text }]}>
                                  {metric.label}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                        <View style={styles.performanceChecklist}>
                          <View style={styles.performanceChecklistRow}>
                            <Text style={styles.performanceMetricLabel}>Checklist progress</Text>
                            <Text style={styles.performanceChecklistValue}>
                              {summary.checklistItemsTotal > 0
                                ? `${summary.checklistItemsDone}/${summary.checklistItemsTotal} (${checklistPercent}%)`
                                : "No checklist items"}
                            </Text>
                          </View>
                          {summary.checklistItemsTotal > 0 ? (
                            <View style={styles.performanceChecklistTrack}>
                              <View
                                style={[
                                  styles.performanceChecklistFill,
                                  { width: `${checklistPercent}%` },
                                ]}
                              />
                            </View>
                          ) : null}
                        </View>
                      </View>
                    );
                  })}
              </>
            )}
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
  mechanicNameList: { gap: 8 },
  mechanicDropdown: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    overflow: "hidden",
  },
  mechanicNameRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
  },
  mechanicName: { flex: 1, color: "#0d0d0d", fontSize: 15, fontWeight: "700" },
  mechanicDropdownDetails: {
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    padding: 12,
    gap: 12,
  },
  mechanicDetailSectionTitle: { color: "#0d0d0d", fontSize: 14, fontWeight: "800" },
  emptyCard: { color: "#64748b", backgroundColor: "#ffffff", borderRadius: 12, padding: 12, fontSize: 12 },
  performanceCard: { backgroundColor: "#ffffff", borderRadius: 12, borderWidth: 1, borderColor: "#e2e8f0", padding: 12, gap: 10 },
  performanceCardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  performanceOrderCount: { color: "#64748b", fontSize: 11, fontWeight: "700" },
  performanceMetrics: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  performanceMetric: { width: "48%", backgroundColor: "#f8fafc", borderRadius: 8, padding: 8 },
  chiefPerformanceMetric: {
    minHeight: 48,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
  },
  performanceMetricPressed: { opacity: 0.72 },
  performanceMetricValue: { color: "#0f172a", fontWeight: "800", fontSize: 16 },
  performanceMetricLabel: { color: "#64748b", fontSize: 10, fontWeight: "700" },
  performanceChecklistRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  performanceChecklistValue: { color: "#1a1f6e", fontSize: 11, fontWeight: "800" },
  performanceChecklist: { gap: 6 },
  performanceChecklistTrack: { height: 6, borderRadius: 99, overflow: "hidden", backgroundColor: "#e2e8f0" },
  performanceChecklistFill: { height: "100%", borderRadius: 99, backgroundColor: "#1a1f6e" },
  sectionTitle: { fontSize: 18, fontWeight: "700", color: "#0d0d0d" },
});
