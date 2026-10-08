import { workOrderStatusColors, workOrderStatusTextColor } from "./workOrderStatusColors";
import {
  getChangedExecutionItems,
  getChangedPartsSubmissionError,
  getChecklistSubmissionError,
  mergeUploadedAttachments,
  normalizePartDetailEntries,
  type PartDetailEntry,
} from "./workOrderSubmission";
import { isWorkOrderStartDateReached } from "./workOrderStartDate";
import { getPersistedWorkOrderNumber } from "./workOrderId";
import { isAwaitingChiefReview, submittedReviewState } from "./workOrderReview";
import { formatWorkOrderDate as formatReadableDate } from "../services/workOrderDates";
import { MobilePageHeader } from "../components/MobilePageHeader";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import Svg, { Circle, Path } from "react-native-svg";

import type { SyncService } from "../services/SyncService";
import type {
  AuthenticatedUser,
  MobileAccessRole,
} from "../services/AuthService";
import { API_BASE_URL, AuthService } from "../services/AuthService";
import {
  WorkOrderAnalyticsService,
  type WorkOrderRecommendationsResponse,
} from "../services/WorkOrderAnalyticsService";
import { getDatabase } from "../database/database";
import { ChecklistRepository } from "../repositories/ChecklistRepository";
import { MaintenanceRepository } from "../repositories/MaintenanceRepository";
import { VehicleRepository } from "../repositories/VehicleRepository";
import type { ChecklistItem, MaintenanceSchedule } from "../database/tables";

type WorkOrderStatus =
  | "Pending"
  | "In Progress"
  | "For Verification"
  | "Overdue"
  | "Completed"
  | "Done"
  | "Rejected"
  | "For Repair";
type StepKey = "details" | "execution" | "parts" | "inspection";

type ExecutionItem = {
  id: string;
  label: string;
  status: "checked" | "changed" | "notChecked" | "pending";
  note: string;
};

type InspectionItem = {
  id: string;
  label: string;
  status: "pass" | "fail" | "pending";
  note: string;
};

type InspectionRemark = "Verified" | "Rejected" | "For Repair" | "Unverified";

type ScheduleDetail = {
  label: string;
  value: string;
};

type WorkOrder = {
  id: string;
  number: string;
  plate: string;
  maintenanceType: string;
  mechanic: string;
  assignedMechanicId: string | null;
  chiefMechanicId: string | null;
  dateCreated: string;
  createdAtTimestamp: number;
  startDate: string | null;
  status: WorkOrderStatus;
  priority: "HIGH" | "MEDIUM" | "LOW";
  summary: string;
  details: string[];
  template: string;
  checklistTemplateId: string | null;
  scheduleDetails: ScheduleDetail[];
  executionItems: ExecutionItem[];
  partDetails: Record<string, PartDetailEntry>;
  inspectionItems: InspectionItem[];
  maintenanceRemarks: string;
  chiefMechanic: string;
  inspectorRemarks: string;
  rejectionRemarks: string;
  inspectionResultsPending: number;
  approvalStatus: InspectionRemark;
  mechanicSubmitted: boolean;
  workOrderProgress: string | null;
};

type PersistedWorkOrderProgress = Omit<
  Pick<
    WorkOrder,
    | "executionItems"
    | "partDetails"
    | "inspectionItems"
    | "maintenanceRemarks"
    | "chiefMechanic"
    | "inspectorRemarks"
    | "rejectionRemarks"
    | "approvalStatus"
  >,
  "approvalStatus"
> & {
  mechanicSubmitted?: boolean;
  workflowStatus?: WorkOrderStatus;
  approvalStatus?: InspectionRemark | "Incomplete" | "Unverified Remarks";
};

const parseWorkOrderProgress = (
  value: string | null,
  executionItems: ExecutionItem[],
): Partial<WorkOrder> => {
  if (!value) return {};

  try {
    const parsed = JSON.parse(value) as Partial<PersistedWorkOrderProgress>;
    return {
      executionItems: Array.isArray(parsed.executionItems)
        ? parsed.executionItems
        : executionItems,
      partDetails: normalizePartDetailEntries(parsed.partDetails),
      inspectionItems: Array.isArray(parsed.inspectionItems)
        ? parsed.inspectionItems
        : [],
      maintenanceRemarks:
        typeof parsed.maintenanceRemarks === "string"
          ? parsed.maintenanceRemarks
          : "",
      chiefMechanic:
        typeof parsed.chiefMechanic === "string" ? parsed.chiefMechanic : "",
      inspectorRemarks:
        typeof parsed.inspectorRemarks === "string"
          ? parsed.inspectorRemarks
          : "",
      approvalStatus:
        parsed.approvalStatus === "Verified" ||
        parsed.approvalStatus === "Rejected" ||
        parsed.approvalStatus === "Incomplete" ||
        parsed.approvalStatus === "For Repair" ||
        parsed.approvalStatus === "Unverified" ||
        parsed.approvalStatus === "Unverified Remarks"
          ? parsed.approvalStatus === "Incomplete"
            ? "Rejected"
            : parsed.approvalStatus === "Unverified Remarks"
              ? "Unverified"
              : parsed.approvalStatus
          : "Unverified",
      rejectionRemarks:
        typeof parsed.rejectionRemarks === "string"
          ? parsed.rejectionRemarks
          : parsed.workflowStatus === "Rejected" && typeof parsed.inspectorRemarks === "string"
            ? parsed.inspectorRemarks
            : "",
      mechanicSubmitted: parsed.mechanicSubmitted === true,
      status: parsed.workflowStatus,
    };
  } catch {
    return {};
  }
};

const formatDisplayValue = (
  value: string | number | null | undefined,
  field: "date" | "text" = "text",
): string => {
  if (value === null || value === undefined || value === "") {
    return "N/A";
  }

  if (field === "date") {
    return formatReadableDate(String(value));
  }

  if (typeof value === "number") {
    return String(value);
  }

  return String(value);
};

const formatScheduleField = (
  field: keyof Pick<
    MaintenanceSchedule,
    | "id"
    | "vehicleId"
    | "title"
    | "createdAt"
    | "startDate"
    | "accountType"
    | "odometerReading"
    | "triggerType"
    | "intervalKm"
    | "bufferDistanceKm"
    | "startingReferenceReadingKm"
    | "startReferenceDate"
  >,
  value: MaintenanceSchedule[keyof MaintenanceSchedule],
): string => {
  if (field === "createdAt" || field === "startDate" || field === "startReferenceDate") {
    return formatDisplayValue(value as string | null | undefined, "date");
  }

  if (field === "accountType") {
    const accountTypeValue = value as string | null | undefined;
    if (!accountTypeValue) return "N/A";
    if (accountTypeValue === "IN_HOUSE") return "In House";
    if (accountTypeValue === "OUTSOURCED") return "Outsourced";
    return String(accountTypeValue);
  }

  if (field === "triggerType") {
    const triggerValue = value as string | null | undefined;
    if (!triggerValue) return "N/A";
    if (triggerValue === "MANUAL") return "Manual";
    if (triggerValue === "ODOMETER") return "Odometer";
    if (triggerValue === "TIME") return "Time";
    return String(triggerValue);
  }

  if (value === null || value === undefined || value === "") {
    return "N/A";
  }

  return String(value);
};

const createDefaultPartDetailEntry = (): PartDetailEntry => ({
  partsUsed: "",
  quantity: "",
  materialCost: "",
  attachments: [],
  attachmentName: "",
});

const buildExecutionItems = (
  templateItems: ChecklistItem[],
): ExecutionItem[] => {
  if (templateItems.length === 0) {
    return [];
  }

  return templateItems
    .slice()
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
    .map((item) => ({
      id: item.id,
      label: item.text,
      status: "pending",
      note: "",
    }));
};

const reconcileExecutionItems = (
  assignedItems: ExecutionItem[],
  savedItems?: ExecutionItem[],
): ExecutionItem[] => {
  if (!savedItems) return assignedItems;
  const savedById = new Map(savedItems.map((item) => [item.id, item]));
  return assignedItems.map((item) => {
    const saved = savedById.get(item.id);
    if (!saved) return item;
    return {
      ...item,
      status:
        saved.status === "checked" || saved.status === "changed" ||
        saved.status === "notChecked" || saved.status === "pending"
          ? saved.status
          : "pending",
      note: typeof saved.note === "string" ? saved.note : "",
    };
  });
};

const buildInspectionItems = (
  executionItems: ExecutionItem[],
): InspectionItem[] =>
  executionItems.map((item) => ({
    id: item.id,
    label: item.label,
    status: "pending",
    note: "",
  }));

const reconcileInspectionItems = (
  executionItems: ExecutionItem[],
  savedItems?: InspectionItem[],
): InspectionItem[] => {
  if (!savedItems?.length) return buildInspectionItems(executionItems);
  const savedById = new Map(savedItems.map((item) => [item.id, item]));
  return executionItems.map((item) => {
    const saved = savedById.get(item.id);
    return {
      id: item.id,
      label: item.label,
      status:
        saved?.status === "pass" || saved?.status === "fail"
          ? saved.status
          : "pending",
      note: typeof saved?.note === "string" ? saved.note : "",
    };
  });
};

const getAutomaticInspectionRemark = (
  inspectionItems: InspectionItem[],
): InspectionRemark => {
  if (
    inspectionItems.length === 0 ||
    inspectionItems.some((item) => item.status === "pending")
  ) {
    return "Unverified";
  }

  const failCount = inspectionItems.filter(
    (item) => item.status === "fail",
  ).length;
  const passCount = inspectionItems.filter(
    (item) => item.status === "pass",
  ).length;

  if (failCount > passCount) return "For Repair";
  if (failCount > 0) return "Rejected";
  return "Verified";
};

const resolveChecklistTemplate = async (
  checklistRepo: ChecklistRepository,
  templateId: string | null,
  fallbackName: string | null,
): Promise<{
  templateId: string | null;
  templateName: string;
  templateItems: ChecklistItem[];
}> => {
  const trimmedTemplateId = templateId?.trim() || null;

  if (trimmedTemplateId) {
    const checklistTemplate =
      await checklistRepo.getTemplateById(trimmedTemplateId);

    if (checklistTemplate) {
      return {
        templateId: trimmedTemplateId,
        templateName: checklistTemplate.type,
        templateItems:
          await checklistRepo.getItemsByTemplateId(trimmedTemplateId),
      };
    }
  }

  const trimmedFallbackName = fallbackName?.trim() || null;

  if (trimmedFallbackName) {
    const checklistTemplate =
      await checklistRepo.getTemplateByType(trimmedFallbackName);

    if (checklistTemplate) {
      return {
        templateId: checklistTemplate.id,
        templateName: checklistTemplate.type,
        templateItems: await checklistRepo.getItemsByTemplateId(
          checklistTemplate.id,
        ),
      };
    }
  }

  return {
    templateId: null,
    templateName: "No checklist template",
    templateItems: [],
  };
};

const parseAiExecutionSections = (text: string) => {
  if (!text) return [];

  const lines = text.split(/\r?\n/);
  const result: { title: string; items: string[] }[] = [];
  let current: { title: string; items: string[] } | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const isHeading =
      /^(?:\#+\s*|\*\*\d+[\.\)]|\d+[\.\)])\s*/.test(line) ||
      (line.endsWith(":") && line.length < 80 && !line.includes("•"));

    if (isHeading) {
      if (current && current.items.length > 0) {
        result.push(current);
      }
      const cleanTitle = line
        .replace(/^[#*\d\.\)\s]+/, "")
        .replace(/[:*]+$/, "")
        .trim();
      current = { title: cleanTitle || line, items: [] };
    } else if (current) {
      current.items.push(line.replace(/^[-*•]\s*/, ""));
    } else {
      current = {
        title: "Execution Advisory",
        items: [line.replace(/^[-*•]\s*/, "")],
      };
    }
  }

  if (current && current.items.length > 0) {
    result.push(current);
  }

  return result;
};

interface WorkOrderScreenProps {
  accessRole: MobileAccessRole;
  user: AuthenticatedUser;
  initialOrderId?: string | null;
  syncService?: SyncService;
  onLoadingChange?: (loading: boolean) => void;
}

export function WorkOrderScreen({ accessRole, user, initialOrderId, syncService, onLoadingChange }: WorkOrderScreenProps) {
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const localSaveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const syncWarningShown = useRef(false);
  const progressRevision = useRef(new Map<string, number>());
  const actionInFlight = useRef(false);
  const [savingAction, setSavingAction] = useState(false);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [openFilterMenu, setOpenFilterMenu] = useState<"status" | "type" | "priority" | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState<StepKey>("details");
  const [previewAttachmentUri, setPreviewAttachmentUri] = useState<string | null>(null);
  const [aiAdvisoryLoading, setAiAdvisoryLoading] = useState(false);
  const [aiRecommendations, setAiRecommendations] =
    useState<WorkOrderRecommendationsResponse | null>(null);

  const refreshWorkOrders = () => {
    if (isLoading || pullRefreshing) return;
    setPullRefreshing(true);
    onLoadingChange?.(true);
    const reloadFromCache = () => setReloadVersion((version) => version + 1);
    if (syncService) {
      void syncService.sync()
        .catch((error) => console.warn("[WorkOrderScreen] Pull-to-refresh sync failed", error))
        .finally(reloadFromCache);
    } else {
      reloadFromCache();
    }
  };

  useEffect(() => {
    onLoadingChange?.(isLoading);
    return () => onLoadingChange?.(false);
  }, [isLoading, onLoadingChange]);

  useEffect(() => {
    let mounted = true;

    async function loadWorkOrders(): Promise<void> {
      setIsLoading(true);
      try {
        if (syncService && reloadVersion === 0) {
          await syncService.sync();
        }
        if (!mounted) return;
        const db = await getDatabase();
        const maintenanceRepo = new MaintenanceRepository(db);
        const checklistRepo = new ChecklistRepository(db);
        const vehicleRepo = new VehicleRepository(db);
        const schedules = await maintenanceRepo.getMaintenanceSchedules();
        const vehicles = await vehicleRepo.getVehicles();
        const vehiclesById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));

        if (!mounted) return;

        const converted: WorkOrder[] = await Promise.all(
          schedules.map(async (schedule) => {
            const resolvedTemplate = await resolveChecklistTemplate(
              checklistRepo,
              schedule.checklistTemplateId,
              schedule.checklistTemplateId ? schedule.title : null,
            );
            const vehicle = vehiclesById.get(schedule.vehicleId);

            const executionItems: ExecutionItem[] = buildExecutionItems(
              resolvedTemplate.templateItems,
            );

            const partDetails = executionItems.reduce<
              Record<string, PartDetailEntry>
            >(
              (accumulator, item) => ({
                ...accumulator,
                [item.id]: createDefaultPartDetailEntry(),
              }),
              {},
            );
            const savedProgress = parseWorkOrderProgress(
              schedule.workOrderProgress,
              executionItems,
            );
            const savedExecutionItems = reconcileExecutionItems(
              executionItems,
              savedProgress.executionItems,
            );
            const savedInspectionItems = reconcileInspectionItems(
              savedExecutionItems,
              savedProgress.inspectionItems,
            );

            return {
              id: schedule.id,
              number: getPersistedWorkOrderNumber(schedule.workOrderNumber),
              plate: vehicle?.plateNumber ?? schedule.vehicleId,
              maintenanceType: schedule.title,
              mechanic: schedule.assignedMechanic || "Unassigned",
              assignedMechanicId: schedule.assignedMechanicId,
              chiefMechanicId: schedule.chiefMechanicId,
              dateCreated: formatReadableDate(schedule.createdAt),
              createdAtTimestamp: Date.parse(schedule.createdAt) || 0,
              startDate: schedule.startDate,
              status:
                savedProgress.status ??
                (schedule.status === "PENDING"
                  ? "Pending"
                  : schedule.status === "DUE"
                    ? "Pending"
                    : schedule.status === "IN_PROGRESS"
                      ? "In Progress"
                      : schedule.status === "COMPLETED"
                        ? "Completed"
                        : "Overdue"),
              priority: schedule.priority ?? "MEDIUM",
              summary: `${schedule.title} - ${schedule.intervalType || "As needed"}`,
              details: [],
              template: resolvedTemplate.templateName,
              checklistTemplateId: resolvedTemplate.templateId,
              scheduleDetails: [
                {
                  label: "Work Order No.",
                  value: getPersistedWorkOrderNumber(schedule.workOrderNumber),
                },
                {
                  label: "Vehicle",
                  value: vehicle
                    ? `${vehicle.plateNumber}${vehicle.model ? ` · ${vehicle.model}` : ""} (${schedule.vehicleId})`
                    : formatScheduleField("vehicleId", schedule.vehicleId),
                },
                {
                  label: "Checklist Template",
                  value: resolvedTemplate.templateName,
                },
                {
                  label: "Priority",
                  value: (schedule.priority ?? "MEDIUM").charAt(0) + (schedule.priority ?? "MEDIUM").slice(1).toLowerCase(),
                },
                {
                  label: "Date Created",
                  value: formatScheduleField("createdAt", schedule.createdAt),
                },
                {
                  label: "Scheduled Start Date",
                  value: formatScheduleField("startDate", schedule.startDate),
                },
                {
                  label: "Account Type",
                  value: formatScheduleField(
                    "accountType",
                    schedule.accountType,
                  ),
                },
                {
                  label: "Odometer Reading (km)",
                  value: formatScheduleField(
                    "odometerReading",
                    schedule.odometerReading,
                  ),
                },
                {
                  label: "Schedule Trigger",
                  value: formatScheduleField(
                    "triggerType",
                    schedule.triggerType,
                  ),
                },
                {
                  label: "Interval (km)",
                  value: formatScheduleField("intervalKm", schedule.intervalKm),
                },
                {
                  label: "Buffer Distance (km)",
                  value: formatScheduleField(
                    "bufferDistanceKm",
                    schedule.bufferDistanceKm,
                  ),
                },
                {
                  label: "Starting Reference Reading (km)",
                  value: formatScheduleField(
                    "startingReferenceReadingKm",
                    schedule.startingReferenceReadingKm,
                  ),
                },
                {
                  label: "Start Reference Date",
                  value: formatScheduleField(
                    "startReferenceDate",
                    schedule.startReferenceDate,
                  ),
                },
              ],
              executionItems: savedExecutionItems,
              partDetails: {
                ...partDetails,
                ...normalizePartDetailEntries(savedProgress.partDetails),
              },
              inspectionItems: savedInspectionItems,
              maintenanceRemarks: savedProgress.maintenanceRemarks ?? "",
              chiefMechanic: savedProgress.chiefMechanic ?? "",
              inspectorRemarks: savedProgress.inspectorRemarks ?? "",
              rejectionRemarks: savedProgress.rejectionRemarks ?? "",
              inspectionResultsPending: 0,
              approvalStatus:
                savedProgress.approvalStatus === "For Repair"
                  ? "For Repair"
                  : savedProgress.approvalStatus === "Rejected"
                    ? "Rejected"
                    : getAutomaticInspectionRemark(savedInspectionItems),
              mechanicSubmitted:
                savedProgress.mechanicSubmitted ??
                savedProgress.status === "For Verification",
              workOrderProgress: schedule.workOrderProgress,
              ...submittedReviewState(schedule.status),
            };
          }),
        );

        if (!mounted) return;
        setWorkOrders(converted);
        if (initialOrderId) {
          const target = converted.find((order) => order.id === initialOrderId &&
            (accessRole === "mechanic" ? order.assignedMechanicId === user.id :
              accessRole === "chiefMechanic" && isAwaitingChiefReview(order, user.id)));
          if (target) {
            setSelectedOrderId(target.id);
            setActiveStep("details");
          } else {
            Alert.alert("Work order unavailable", "This work order may have been removed, reassigned, or is not awaiting your review. Refresh your work orders and try again.");
          }
        }
      } catch (error) {
        console.error("[WorkOrderScreen] Failed to load work orders", error);
        if (mounted && initialOrderId) Alert.alert("Unable to open work order", "Check your connection and tap the notification again.");
      } finally {
        if (mounted) {
          setIsLoading(false);
          setPullRefreshing(false);
          onLoadingChange?.(false);
        }
      }
    }

    loadWorkOrders();
    return () => {
      mounted = false;
    };
  }, [initialOrderId, syncService, accessRole, user.id, reloadVersion]);

  useEffect(() => {
    if (accessRole !== "chiefMechanic" || !syncService) return;
    const unsubscribe = syncService.subscribe(() => {
      if (!selectedOrderId) setReloadVersion((version) => version + 1);
    });
    const timer = setInterval(() => {
      if (!selectedOrderId) void syncService.sync().catch((error) =>
        console.warn("[WorkOrderScreen] Review queue refresh failed", error));
    }, 30000);
    return () => { unsubscribe(); clearInterval(timer); };
  }, [accessRole, syncService, selectedOrderId]);

  useEffect(() => {
    if (!selectedOrderId) {
      return;
    }

    let mounted = true;

    async function loadExecutionItemsForSelectedOrder(): Promise<void> {
      try {
        const db = await getDatabase();
        const checklistRepo = new ChecklistRepository(db);
        const currentOrder = workOrders.find(
          (order) => order.id === selectedOrderId,
        );

        if (!currentOrder) {
          return;
        }

        const resolvedTemplate = await resolveChecklistTemplate(
          checklistRepo,
          currentOrder.checklistTemplateId,
          currentOrder.checklistTemplateId ? currentOrder.maintenanceType : null,
        );

        if (!mounted) {
          return;
        }

        const executionItems = buildExecutionItems(
          resolvedTemplate.templateItems,
        );
        const savedProgress = parseWorkOrderProgress(
          currentOrder.workOrderProgress,
          executionItems,
        );

        setWorkOrders((current) =>
          current.map((order) => {
            if (order.id !== selectedOrderId) {
              return order;
            }

            const savedPartDetails = normalizePartDetailEntries(order.partDetails);
            const partDetails = executionItems.reduce<
              Record<string, PartDetailEntry>
            >(
              (accumulator, item) => ({
                ...accumulator,
                [item.id]:
                  savedPartDetails[item.id] ?? createDefaultPartDetailEntry(),
              }),
              {},
            );

            return {
              ...order,
              executionItems: reconcileExecutionItems(
                executionItems,
                savedProgress.executionItems,
              ),
              partDetails,
              inspectionItems: reconcileInspectionItems(
                reconcileExecutionItems(executionItems, savedProgress.executionItems),
                savedProgress.inspectionItems,
              ),
              workOrderProgress: currentOrder.workOrderProgress,
            };
          }),
        );
      } catch (error) {
        console.error(
          "[WorkOrderScreen] Failed to load checklist items for selected work order",
          error,
        );
      }
    }

    loadExecutionItemsForSelectedOrder();

    return () => {
      mounted = false;
    };
  }, [selectedOrderId]);

  const loadAiAdvisory = useCallback(async (order: WorkOrder) => {
    setAiAdvisoryLoading(true);
    try {
      const analyticsService = new WorkOrderAnalyticsService();
      const result = await analyticsService.getWorkOrderRecommendations(
        order.id,
        order.maintenanceType,
        order.plate,
        order.executionItems.map((item) => ({ text: item.label })),
      );
      setAiRecommendations(result);
    } catch (err) {
      console.error("[WorkOrderScreen] Failed to load AI recommendations", err);
    } finally {
      setAiAdvisoryLoading(false);
    }
  }, []);

  const selectedOrderRecord =
    workOrders.find((order) => order.id === selectedOrderId) ?? null;
  // Older/offline work-order progress may not contain collections added in a
  // newer app version. Normalize at the selection boundary before rendering.
  const selectedOrder = selectedOrderRecord
    ? {
        ...selectedOrderRecord,
        executionItems: Array.isArray(selectedOrderRecord.executionItems)
          ? selectedOrderRecord.executionItems
          : [],
        partDetails: normalizePartDetailEntries(selectedOrderRecord.partDetails),
        inspectionItems: Array.isArray(selectedOrderRecord.inspectionItems)
          ? selectedOrderRecord.inspectionItems
          : [],
        scheduleDetails: Array.isArray(selectedOrderRecord.scheduleDetails)
          ? selectedOrderRecord.scheduleDetails
          : [],
      }
    : null;

  useEffect(() => {
    setAiRecommendations(null);
    setAiAdvisoryLoading(false);
  }, [selectedOrderId]);

  const currentUserName = user.name.trim().toLowerCase();

  const persistWorkOrder = (order: WorkOrder, _status?: string, action = "SAVE") => {
    const partDetails = normalizePartDetailEntries(order.partDetails);
    const partsCost = Object.values(partDetails).reduce((total, entry) => {
      if (typeof entry?.partsUsed !== "string" || !entry.partsUsed.trim()) return total;
      const cost = Number.parseFloat(entry.materialCost);
      return total + (Number.isFinite(cost) && cost >= 0 ? cost : 0);
    }, 0);
    const progress = {
      executionItems: Array.isArray(order.executionItems) ? order.executionItems : [], partDetails,
      inspectionItems: Array.isArray(order.inspectionItems) ? order.inspectionItems : [], chiefMechanic: order.chiefMechanic,
      maintenanceRemarks: order.maintenanceRemarks, inspectorRemarks: order.inspectorRemarks,
      rejectionRemarks: order.rejectionRemarks, approvalStatus: order.approvalStatus,
      mechanicSubmitted: order.mechanicSubmitted, workflowStatus: order.status, action,
      partsCost,
    };
    const revision = (progressRevision.current.get(order.id) ?? 0) + 1;
    progressRevision.current.set(order.id, revision);
    const pendingProgress = { ...progress, _syncPending: true, _localRevision: revision };
    const pendingProgressJson = JSON.stringify(pendingProgress);
    // Keep the in-memory work-order snapshot in step with its local save. The
    // checklist reload on re-entry reads this field to restore item statuses.
    setWorkOrders((current) =>
      current.map((item) =>
        item.id === order.id
          ? { ...item, workOrderProgress: pendingProgressJson }
          : item,
      ),
    );
    const localSave = localSaveQueue.current.catch(() => undefined).then(async () => {
      const db = await getDatabase();
      await new MaintenanceRepository(db).updateWorkOrderProgress(
        order.id,
        pendingProgressJson,
      );
    });
    localSaveQueue.current = localSave;
    const pending = saveQueue.current.catch(() => undefined).then(async () => {
      await localSave;
      const result = await new AuthService(API_BASE_URL).updateMaintenanceProgress(order.id, progress);
      const db = await getDatabase();
      if (progressRevision.current.get(order.id) === revision) {
        await new MaintenanceRepository(db).updateWorkOrderProgress(
          order.id,
          JSON.stringify({ ...result.workOrderProgress, _syncPending: false }),
          result.status,
        );
      }
      syncWarningShown.current = false;
      return result;
    });
    saveQueue.current = pending;
    if (action === "SAVE") void pending.catch(() => {
      if (syncWarningShown.current) return;
      syncWarningShown.current = true;
      Alert.alert("Saved on this device", "Your progress is stored locally and will sync when the connection is available.");
    });
    return pending;
  };

  const performWorkflowAction = async (action: string) => {
    if (!selectedOrder || actionInFlight.current) return;
    if (action === "START" && !isWorkOrderStartDateReached(selectedOrder.startDate)) {
      Alert.alert(
        "Work order not ready",
        selectedOrder.startDate
          ? `This work order can be started on ${formatReadableDate(selectedOrder.startDate)}.`
          : "This work order has no scheduled start date. Ask Operations to update its schedule.",
      );
      return;
    }
    if (action === "START" || action === "SUBMIT") {
      const error =
        action === "START"
          ? selectedOrder.executionItems.length === 0
            ? "No assigned checklist items are available. Refresh the work order or ask Operations to assign a checklist."
            : null
          : getChecklistSubmissionError(selectedOrder.executionItems);
      if (error) {
        setActiveStep("execution");
        Alert.alert(
          "Assigned checklist required",
          `${error}\n\nAsk Operations to assign or refresh the checklist before starting maintenance.`,
        );
        return;
      }
    }
    if (action === "SUBMIT") {
      const partsError = getChangedPartsSubmissionError(
        selectedOrder.executionItems,
        selectedOrder.partDetails,
      );
      if (partsError) {
        setActiveStep("parts");
        Alert.alert("Parts details incomplete", partsError);
        return;
      }
    }
    actionInFlight.current = true;
    setSavingAction(true);
    try {
      const result = await persistWorkOrder(selectedOrder, undefined, action);
      const saved = parseWorkOrderProgress(
        JSON.stringify(result.workOrderProgress),
        selectedOrder.executionItems,
      );
      setWorkOrders((orders) => orders.map((order) => order.id === selectedOrder.id ? {
        ...order, ...saved, status: saved.status ?? order.status,
        mechanicSubmitted: saved.mechanicSubmitted ?? order.mechanicSubmitted,
        approvalStatus: saved.approvalStatus ?? order.approvalStatus,
      } : order));
      if (action !== "START") {
        Alert.alert(action === "SUBMIT" ? "Sent for Chief Mechanic Review" : "Review saved",
          action === "SUBMIT" ? "Your work is Done and awaiting chief mechanic approval." : action === "APPROVE" ? "Work order Completed." : "Work order returned for follow-up.");
        setSelectedOrderId(null);
      }
    } catch (error) {
      const response = (error as { response?: { data?: { message?: string | string[] } } }).response;
      const message = response?.data?.message;
      Alert.alert("Status not updated", Array.isArray(message) ? message.join("\n") : message || "Check your connection, refresh the work order, and try again.");
    } finally {
      actionInFlight.current = false;
      setSavingAction(false);
    }
  };

  const updateWorkOrder = (
    orderId: string,
    update: (order: WorkOrder) => WorkOrder,
  ) => {
    const order = workOrders.find((item) => item.id === orderId);
    if (!order) return;
    if (
      accessRole === "mechanic" &&
      (order.mechanicSubmitted ||
        order.approvalStatus === "Verified" ||
        order.status === "Done" || order.status === "Completed") &&
      order.approvalStatus !== "Rejected"
    ) {
      return;
    }
    if (savingAction || (isMechanicRole && order.status !== "In Progress")) return;
    const normalizedOrder = {
      ...order,
      executionItems: Array.isArray(order.executionItems) ? order.executionItems : [],
      partDetails: normalizePartDetailEntries(order.partDetails),
      inspectionItems: Array.isArray(order.inspectionItems) ? order.inspectionItems : [],
      scheduleDetails: Array.isArray(order.scheduleDetails) ? order.scheduleDetails : [],
    };
    const updatedOrder = update(normalizedOrder);
    setWorkOrders((current) =>
      current.map((item) => (item.id === orderId ? updatedOrder : item)),
    );
    persistWorkOrder(
      updatedOrder,
      updatedOrder.status === "Done"
        ? "COMPLETED"
        : updatedOrder.status === "For Verification"
          ? "IN_PROGRESS"
          : undefined,
    );
  };

  const visibleOrders = workOrders.filter((order) => accessRole === "mechanic"
    ? order.assignedMechanicId === user.id
    : accessRole === "chiefMechanic" && isAwaitingChiefReview(order, user.id));
  const statusOptions = [...new Set(visibleOrders.map((order) => order.status))].sort();
  const typeOptions = [...new Set(visibleOrders.map((order) => order.maintenanceType))].sort();
  const priorityOptions = ["HIGH", "MEDIUM", "LOW"];
  const filtersActive = Boolean(searchQuery.trim() || statusFilter || typeFilter || priorityFilter);
  const clearFilters = () => { setSearchQuery(""); setStatusFilter(null); setTypeFilter(null); setPriorityFilter(null); };
  const filteredOrders = visibleOrders.filter((order) => {
    const query = searchQuery.trim().toLowerCase();
    const matchesQuery =
      order.number.toLowerCase().includes(query) ||
      order.plate.toLowerCase().includes(query) ||
      order.maintenanceType.toLowerCase().includes(query) ||
      order.mechanic.toLowerCase().includes(query) ||
      order.chiefMechanic.toLowerCase().includes(query);

    return matchesQuery && (!statusFilter || order.status === statusFilter) &&
      (!typeFilter || order.maintenanceType === typeFilter) &&
      (!priorityFilter || order.priority === priorityFilter);
  }).sort((left, right) =>
    right.createdAtTimestamp - left.createdAtTimestamp ||
    right.number.localeCompare(left.number, undefined, { numeric: true }),
  );

  const ordersPerPage = 10;
  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / ordersPerPage));
  const pageOrders = filteredOrders.slice((currentPage - 1) * ordersPerPage, currentPage * ordersPerPage);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter, typeFilter, priorityFilter, accessRole, user.id]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const updateExecutionStatus = (
    orderId: string,
    itemId: string,
    status: ExecutionItem["status"],
  ) => {
    updateWorkOrder(orderId, (order) => ({
      ...order,
      executionItems: order.executionItems.map((item) =>
        item.id === itemId ? { ...item, status } : item,
      ),
      inspectionItems: order.inspectionItems.length
        ? order.inspectionItems
        : buildInspectionItems(order.executionItems),
    }));
  };

  const updateExecutionNote = (
    orderId: string,
    itemId: string,
    note: string,
  ) => {
    updateWorkOrder(orderId, (order) => ({
      ...order,
      executionItems: order.executionItems.map((item) =>
        item.id === itemId ? { ...item, note } : item,
      ),
    }));
  };

  const updateInspectionStatus = (
    orderId: string,
    itemId: string,
    status: InspectionItem["status"],
  ) => {
    updateWorkOrder(orderId, (order) => {
      const inspectionItems = order.inspectionItems.map((item) =>
        item.id === itemId ? { ...item, status } : item,
      );
      return {
        ...order,
        inspectionItems,
        approvalStatus: getAutomaticInspectionRemark(inspectionItems),
      };
    });
  };

  const updateInspectionNote = (
    orderId: string,
    itemId: string,
    note: string,
  ) => {
    updateWorkOrder(orderId, (order) => ({
      ...order,
      inspectionItems: order.inspectionItems.map((item) =>
        item.id === itemId ? { ...item, note } : item,
      ),
    }));
  };

  const updateInspectorRemarks = (orderId: string, remarks: string) => {
    updateWorkOrder(orderId, (order) => ({
      ...order,
      inspectorRemarks: remarks,
    }));
  };

  const updateMaintenanceRemarks = (orderId: string, remarks: string) => {
    updateWorkOrder(orderId, (order) => ({
      ...order,
      maintenanceRemarks: remarks,
    }));
  };

  const updatePartDetailField = (
    orderId: string,
    itemId: string,
    field: keyof PartDetailEntry,
    value: string,
  ) => {
    updateWorkOrder(orderId, (order) => ({
      ...order,
      partDetails: {
        ...order.partDetails,
        [itemId]: {
          ...order.partDetails[itemId],
          [field]: value,
        },
      },
    }));
  };

  const appendAttachmentToItem = (
    orderId: string,
    itemId: string,
    attachment: PartDetailEntry["attachments"][number],
  ) => {
    updateWorkOrder(orderId, (order) => {
      const existing = normalizePartDetailEntries({ [itemId]: order.partDetails[itemId] })[itemId] ?? createDefaultPartDetailEntry();
      return {
        ...order,
        partDetails: {
          ...order.partDetails,
          [itemId]: {
            ...existing,
            attachments: mergeUploadedAttachments(existing.attachments, attachment),
            attachmentName: "",
          },
        },
      };
    });
  };

  const viewAttachment = async (orderId: string, attachment: PartDetailEntry["attachments"][number]) => {
    try {
      const auth = new AuthService(API_BASE_URL);
      const extension = attachment.name.match(/\.[a-z0-9]+$/i)?.[0] ?? "";
      const localFile = new File(Paths.cache, `${attachment.id}${extension}`);
      const fileBytes = await auth.downloadMaintenanceAttachment(orderId, attachment.id);
      localFile.create({ intermediates: true, overwrite: true });
      localFile.write(fileBytes);
      const isImage = attachment.contentType?.startsWith("image/") ||
        /\.(avif|gif|jpe?g|png|webp)$/i.test(attachment.name);
      if (isImage) {
        setPreviewAttachmentUri(localFile.uri);
        return;
      }
      // Android external viewers cannot access an app-private file:// URI.
      const openUri = Platform.OS === "android" ? localFile.contentUri : localFile.uri;
      await Linking.openURL(openUri);
    } catch (error) {
      Alert.alert("Attachment unavailable", error instanceof Error ? error.message : "Could not open this attachment.");
    }
  };

  const removeAttachment = async (orderId: string, itemId: string, attachmentId: string) => {
    try {
      await new AuthService(API_BASE_URL).deleteMaintenanceAttachment(orderId, attachmentId);
      const updatedOrder = workOrders.find((order) => order.id === orderId);
      if (!updatedOrder) return;
      const entry = normalizePartDetailEntries({ [itemId]: updatedOrder.partDetails[itemId] })[itemId] ?? createDefaultPartDetailEntry();
      const partDetails = {
        ...updatedOrder.partDetails,
        [itemId]: { ...entry, attachments: entry.attachments.filter((file) => file.id !== attachmentId) },
      };
      const progress = {
        executionItems: updatedOrder.executionItems,
        partDetails,
        inspectionItems: updatedOrder.inspectionItems,
        maintenanceRemarks: updatedOrder.maintenanceRemarks,
        chiefMechanic: updatedOrder.chiefMechanic,
        inspectorRemarks: updatedOrder.inspectorRemarks,
        rejectionRemarks: updatedOrder.rejectionRemarks,
        approvalStatus: updatedOrder.approvalStatus,
        mechanicSubmitted: updatedOrder.mechanicSubmitted,
        workflowStatus: updatedOrder.status,
      };
      setWorkOrders((orders) => orders.map((order) => order.id === orderId
        ? { ...order, partDetails, workOrderProgress: JSON.stringify(progress) }
        : order));
      const db = await getDatabase();
      await new MaintenanceRepository(db).updateWorkOrderProgress(orderId, JSON.stringify(progress));
    } catch (error) {
      Alert.alert("Could not delete attachment", error instanceof Error ? error.message : "Try again.");
    }
  };

  const addAttachmentToItem = async (orderId: string, itemId: string) => {
    const order = workOrders.find((item) => item.id === orderId);
    if (!order) return;

    const currentEntry = normalizePartDetailEntries({ [itemId]: order.partDetails[itemId] })[itemId] ?? {
      partsUsed: "",
      quantity: "",
      materialCost: "",
      attachments: [],
      attachmentName: "",
    };

    if (currentEntry.attachments.length >= 5) {
      Alert.alert(
        "Attachment limit reached",
        "You can add up to 5 attachments per item.",
      );
      return;
    }

    const pickMedia = async () => {
      const permissionResult =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permissionResult.granted) {
        Alert.alert(
          "Permission needed",
          "Please allow access to your photos to attach media.",
        );
        return null;
      }

      return ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        allowsMultipleSelection: true,
        selectionLimit: Math.max(1, 5 - currentEntry.attachments.length),
        quality: 0.8,
      });
    };

    const takePhoto = async () => {
      const permissionResult =
        await ImagePicker.requestCameraPermissionsAsync();
      if (!permissionResult.granted) {
        Alert.alert(
          "Permission needed",
          "Please allow access to your camera to take a photo.",
        );
        return null;
      }

      return ImagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: 0.8,
      });
    };

    const pickFile = async () => {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["image/jpeg", "image/png"],
        copyToCacheDirectory: true,
        multiple: true,
      });

      if ("canceled" in result && result.canceled) {
        return null;
      }

      return result;
    };

    const uploadFile = async (uri: string, name: string, type: string) => {
      try {
        await saveQueue.current.catch(() => undefined);
        const uploaded = await new AuthService(API_BASE_URL).uploadMaintenanceAttachment(
          orderId, itemId, { uri, name, type },
        );
        appendAttachmentToItem(orderId, itemId, uploaded);
      } catch (error) {
        Alert.alert("Attachment upload failed", error instanceof Error ? error.message : "Try again when online.");
      }
    };

    const uploadPickedFiles = async (
      files: Array<{ uri: string; name: string; type: string; size?: number }>,
    ) => {
      const remainingSlots = 5 - currentEntry.attachments.length;
      if (files.length > remainingSlots) {
        Alert.alert("Attachment limit reached", `Select up to ${remainingSlots} more file(s) for this item.`);
        return;
      }

      for (const file of files) {
        const extension = file.name.split(".").pop()?.toLowerCase();
        const mimeType = file.type.toLowerCase().split(";")[0].trim();
        const supportedMimeType = mimeType === "image/jpeg" || mimeType === "image/jpg"
          ? "image/jpeg"
          : mimeType === "image/png"
            ? "image/png"
            : null;
        const supportedExtension = extension === "jpg" || extension === "jpeg"
          ? "image/jpeg"
          : extension === "png"
            ? "image/png"
            : null;
        const normalizedType = supportedMimeType ?? (mimeType === "" || mimeType === "application/octet-stream" ? supportedExtension : null);
        if (!normalizedType) {
          Alert.alert("Unsupported file type", `${file.name} was skipped. Attachments must be JPG, JPEG, or PNG images.`);
          continue;
        }
        if (file.size !== undefined && file.size > 5 * 1024 * 1024) {
          Alert.alert("Maximum size exceeded", `${file.name} is larger than 5 MB and was skipped.`);
          continue;
        }
        await uploadFile(file.uri, file.name, normalizedType);
      }
    };

    Alert.alert("Add attachment", "Choose how you want to add the attachment", [
      {
        text: "Gallery",
        onPress: async () => {
          const result = await pickMedia();
          if (!result || result.canceled) return;
          await uploadPickedFiles((result.assets ?? []).map((asset, index) => ({
            uri: asset.uri,
            name: asset.fileName ?? `Gallery attachment ${index + 1}.jpg`,
            type: asset.mimeType ?? "image/jpeg",
            size: asset.fileSize,
          })));
        },
      },
      {
        text: "Take Photo",
        onPress: async () => {
          const result = await takePhoto();
          if (!result || result.canceled) return;
          const asset = result.assets?.[0];
          if (!asset) return;
          const fileSizeMb = (asset.fileSize ?? 0) / (1024 * 1024);
          if (fileSizeMb > 5) {
            Alert.alert(
              "Maximum size exceeded",
              "Each attachment must be 5 MB or less.",
            );
            return;
          }
          await uploadPickedFiles([{
            uri: asset.uri,
            name: asset.fileName ?? "Camera photo.jpg",
            type: asset.mimeType ?? "image/jpeg",
            size: asset.fileSize,
          }]);
        },
      },
      {
        text: "Files",
        onPress: async () => {
          const result = await pickFile();
          if (!result) return;
          await uploadPickedFiles((result.assets ?? []).map((asset) => ({
            uri: asset.uri,
            name: asset.name,
            type: asset.mimeType ?? "application/octet-stream",
            size: asset.size,
          })));
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const calculateMaterialCost = (orderId: string): string => {
    const order = workOrders.find((o) => o.id === orderId);
    if (!order) return "0.00";

    const changedItemIds = new Set(
      getChangedExecutionItems(order.executionItems).map((item) => item.id),
    );
    const total = Object.entries(normalizePartDetailEntries(order.partDetails)).reduce((sum, [itemId, entry]) => {
      if (!changedItemIds.has(itemId)) return sum;
      if (typeof entry?.partsUsed !== "string" || !entry.partsUsed.trim()) return sum;
      const cost = Number.parseFloat(entry.materialCost || "0");
      return sum + (Number.isNaN(cost) ? 0 : cost);
    }, 0);

    return total.toFixed(2);
  };

  const openOrder = (orderId: string) => {
    setSelectedOrderId(orderId);
    setActiveStep("details");
  };

  const isMechanicRole = accessRole === "mechanic";
  const isChiefMechanicRole = accessRole === "chiefMechanic";
  const visibleSteps = [
    { key: "details" as StepKey, label: "Details" },
    ...(isMechanicRole
      ? [
          { key: "execution" as StepKey, label: "Execution" },
          ...(selectedOrder && getChangedExecutionItems(selectedOrder.executionItems).length > 0
            ? [{ key: "parts" as StepKey, label: "Parts, Cost & Photos" }]
            : []),
        ]
      : [{ key: "inspection" as StepKey, label: "Inspection Checklist" }]),
  ];

  const exportPDF = () => {
    if (selectedOrder) {
      Alert.alert("Export PDF", `Exporting ${selectedOrder.number} to PDF...`);
    }
  };

  const handleCompleteOrder = () => {
    if (isMechanicRole) void performWorkflowAction("SUBMIT");
  };

  const getInspectionActionLabel = (remark: InspectionRemark): string => {
    switch (remark) {
      case "Verified":
        return "Mark as Completed";
      case "Rejected":
        return "Mark as Rejected";
      case "For Repair":
        return "Transfer to Repair";
      default:
        return "Mark as Completed";
    }
  };

  const handleInspectionAction = () => {
    if (!selectedOrder || !isChiefMechanicRole) return;
    const remark = getAutomaticInspectionRemark(selectedOrder.inspectionItems);
    if (remark === "Unverified") return;
    if (remark === "Rejected" && !selectedOrder.inspectorRemarks.trim()) {
      Alert.alert("Rejection remarks required", "Add remarks explaining the work that needs correction before returning it to the mechanic.");
      return;
    }
    void performWorkflowAction(remark === "Verified" ? "APPROVE" : remark === "Rejected" ? "REJECT" : "REPAIR");
  };

  const statusStyle = (status: WorkOrderStatus) => {
    switch (status) {
      case "Completed":
      case "Done":
        return styles.statusCompleted;
      case "In Progress":
        return styles.statusInProgress;
      case "For Verification":
        return styles.statusVerification;
      case "Rejected":
        return styles.statusRejected;
      case "For Repair":
        return styles.statusRepair;
      case "Overdue":
        return styles.statusOverdue;
      default:
        return styles.statusPending;
    }
  };

  const renderStatusBadge = (status: WorkOrderStatus) => (
    <View style={[styles.statusBadge, statusStyle(status)]}>
      <Text style={styles.statusBadgeText}>{status}</Text>
    </View>
  );

  const renderPriorityBadge = (priority: WorkOrder["priority"]) => {
    const label = priority.charAt(0) + priority.slice(1).toLowerCase();
    const badgeStyle = priority === "HIGH"
      ? styles.priorityHigh
      : priority === "LOW"
        ? styles.priorityLow
        : styles.priorityMedium;
    const textStyle = priority === "HIGH"
      ? styles.priorityHighText
      : priority === "LOW"
        ? styles.priorityLowText
        : styles.priorityMediumText;
    return (
      <View style={[styles.priorityBadge, badgeStyle]}>
        <Text style={[styles.priorityBadgeText, textStyle]}>{label}</Text>
      </View>
    );
  };

  const verificationMessage = (order: WorkOrder): string | null => {
    if (order.approvalStatus === "Rejected") {
      return "Rejected, execute or check your list again";
    }
    if (order.approvalStatus === "For Repair") {
      return "Already recommended in repair";
    }
    if (order.approvalStatus === "Unverified") {
      return "Pending Verification";
    }
    return null;
  };

  const inspectionDecisionLabel = (remark: InspectionRemark): string => {
    if (remark === "Verified") return "Approve Inspection";
    if (remark === "Rejected" || remark === "For Repair") {
      return "Disapproved Inspection";
    }
    return "";
  };

  const inspectionResultLabel = (remark: InspectionRemark): string => {
    const decision = inspectionDecisionLabel(remark);
    return decision ? `${remark} - ${decision}` : remark;
  };

  const ensureFourProcedureSections = (
    rawText: string | undefined,
    maintenanceType: string,
    executionItems: ExecutionItem[],
  ): Array<{ title: string; items: string[] }> => {
    const parsed = rawText ? parseAiExecutionSections(rawText) : [];
    if (parsed.length >= 2) {
      return parsed;
    }

    const itemNames =
      executionItems.map((i) => i.label).join(", ") || maintenanceType;

    return [
      {
        title: "SAFETY & PPE REQUIREMENTS",
        items: [
          `Put on safety glasses, heat-resistant mechanic gloves, and steel-toe boots before servicing ${maintenanceType}.`,
          `Ensure engine has cooled sufficiently to prevent severe burns before draining fluids or handling hot parts.`,
        ],
      },
      {
        title: "DIAGNOSTIC TOOLS & PARTS NEEDED",
        items: [
          `Gather floor jack, jack stands, oil filter wrench, drain pan, torque wrench, and diagnostic tools for ${maintenanceType}.`,
          `Obtain correct OEM-spec engine oil/fluids, new filter, and replacement crush washer.`,
        ],
      },
      {
        title: "ITEM EXECUTION INSTRUCTIONS",
        items: [
          `Safely elevate and support vehicle, then drain fluids and remove worn components relevant to ${itemNames}.`,
          `Install new parts/filters, refill to proper fluid capacity, and reset maintenance light via dash or OBD tool.`,
        ],
      },
      {
        title: "QUALITY CONTROL SIGN-OFF",
        items: [
          `Lower vehicle and run engine briefly, inspecting underneath for leaks around drain plug and filter.`,
          `Verify fluid level on dipstick, ensure zero diagnostic error codes, and confirm sign-off.`,
        ],
      },
    ];
  };

  const renderAiAdvisoryCard = () => {
    if (!selectedOrder) return null;

    if (!aiRecommendations && !aiAdvisoryLoading) {
      return (
        <View style={styles.aiWebPromptContainer}>
          <View style={styles.aiWebPromptBadge}>
            <Text style={styles.aiWebPromptIcon}>🧠</Text>
          </View>
          <View style={styles.aiWebPromptTextGroup}>
            <Text style={styles.aiWebPromptTitle}>
              AI Work Order Recommendations & Procedure
            </Text>
            <Text style={styles.aiWebPromptSubtext}>
              Tap below to analyze task requirements for{" "}
              <Text style={{ fontWeight: "700", color: "#0f172a" }}>
                {selectedOrder.maintenanceType}
              </Text>{" "}
              and generate AI execution procedures and technical suggestions.
            </Text>
          </View>
          <TouchableOpacity
            style={styles.aiWebGenerateButton}
            onPress={() => void loadAiAdvisory(selectedOrder)}
          >
            <Text style={styles.aiWebGenerateButtonText}>
              ✨ Generate AI Recommendations
            </Text>
          </TouchableOpacity>
        </View>
      );
    }

    const procedureCards = ensureFourProcedureSections(
      aiRecommendations?.aiRecommendations,
      selectedOrder.maintenanceType,
      selectedOrder.executionItems,
    );

    const checklistSteps =
      aiRecommendations?.checklist && aiRecommendations.checklist.length > 0
        ? aiRecommendations.checklist
        : selectedOrder.executionItems.length > 0
          ? selectedOrder.executionItems.map((item, idx) => ({
              stepNumber: idx + 1,
              title: item.label,
              description: `Follow OEM service guidelines to inspect, service, or test ${item.label}. Verify proper torque, cleanliness, and operation.`,
              priority: idx < 2 ? "HIGH" : idx < 4 ? "MEDIUM" : "NORMAL",
            }))
          : [
              {
                stepNumber: 1,
                title: "Pre-Work Safety & Visual Inspection",
                description:
                  "Inspect workspace, secure vehicle, check for leaks/damage around area.",
                priority: "HIGH",
              },
              {
                stepNumber: 2,
                title: "Component Disassembly & Inspection",
                description: `Access and inspect components relevant to ${selectedOrder.maintenanceType}.`,
                priority: "HIGH",
              },
              {
                stepNumber: 3,
                title: "Part Replacement / Fluid Service",
                description:
                  "Replace worn parts or fluids according to VMMS service manual standards.",
                priority: "HIGH",
              },
              {
                stepNumber: 4,
                title: "Torque & Fastener Verification",
                description:
                  "Verify all bolts, fittings, and clamps are torqued to OEM specifications.",
                priority: "MEDIUM",
              },
              {
                stepNumber: 5,
                title: "Post-Service Test & Diagnostics",
                description:
                  "Run engine/system test, verify zero leakage or error codes.",
                priority: "MEDIUM",
              },
              {
                stepNumber: 6,
                title: "Sign-off & Work Order Logging",
                description:
                  "Log completed tasks, parts used, and updated odometer reading.",
                priority: "LOW",
              },
            ];

    return (
      <View style={styles.aiWebCardContainer}>
        {/* Top Header Bar */}
        <View style={styles.aiWebHeaderBar}>
          <View style={styles.aiWebHeaderLeft}>
            <View style={styles.aiWebSparkleBadge}>
              <Text style={styles.aiWebSparkleIcon}>✨</Text>
            </View>
            <View style={styles.aiWebHeaderTextGroup}>
              <Text style={styles.aiWebTitle}>
                AI Execution Recommendations & Procedure
              </Text>
              <Text style={styles.aiWebSubtitle}>
                AI-driven technical procedure suggestions, required tools, and
                execution steps for {selectedOrder.maintenanceType}.
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.aiWebReGenerateButton}
            onPress={() => void loadAiAdvisory(selectedOrder)}
            disabled={aiAdvisoryLoading}
          >
            {aiAdvisoryLoading ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.aiWebReGenerateText}>
                ✨ Re-Generate Recommendations
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {aiAdvisoryLoading ? (
          <View style={styles.aiWebLoadingBlock}>
            <ActivityIndicator color="#1a1f6e" size="small" />
            <Text style={styles.aiWebLoadingText}>
              Analyzing vehicle diagnostics, checklist requirements, and
              technical procedures for {selectedOrder.maintenanceType}...
            </Text>
          </View>
        ) : (
          <View style={styles.aiWebBody}>
            {/* Step-by-Step Technical Execution Suggestions */}
            <View style={styles.aiWebSectionBlock}>
              <View style={styles.aiWebSectionHeaderRow}>
                <Text style={styles.aiWebSectionHeaderIcon}>⚡</Text>
                <Text style={styles.aiWebSectionHeaderTitle}>
                  STEP-BY-STEP EXECUTION SUGGESTIONS
                </Text>
              </View>
              <View style={styles.aiWebStepList}>
                {checklistSteps.map((step) => (
                  <View key={step.stepNumber} style={styles.aiWebStepCard}>
                    <View style={styles.aiWebStepLeft}>
                      <View style={styles.aiWebStepCircle}>
                        <Text style={styles.aiWebStepCircleText}>
                          {step.stepNumber}
                        </Text>
                      </View>
                      <View style={styles.aiWebStepContent}>
                        <Text style={styles.aiWebStepTitle}>
                          {step.title}
                        </Text>
                        <Text style={styles.aiWebStepDesc}>
                          {step.description}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.aiWebPriorityBadge}>
                      <Text style={styles.aiWebPriorityText}>
                        {step.priority || "NORMAL"}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>

            {/* 4 Procedure Cards (2x2 Grid / Stack) */}
            <View style={styles.aiWebGrid}>
              {procedureCards.map((sec, idx) => (
                <View key={idx} style={styles.aiWebGridCard}>
                  <View style={styles.aiWebGridCardHeader}>
                    <Text style={styles.aiWebGridCardIcon}>🔧</Text>
                    <Text style={styles.aiWebGridCardTitle}>{sec.title}</Text>
                  </View>
                  <View style={styles.aiWebGridCardBody}>
                    {sec.items.map((bullet, bulletIdx) => (
                      <View key={bulletIdx} style={styles.aiWebBulletRow}>
                        <Text style={styles.aiWebBulletDot}>•</Text>
                        <Text style={styles.aiWebBulletText}>{bullet}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}
      </View>
    );
  };

  if (selectedOrder) {
    const canManuallyStart = ["Pending", "Overdue", "Rejected"].includes(selectedOrder.status) &&
      !selectedOrder.mechanicSubmitted;
    const startDateReached = isWorkOrderStartDateReached(selectedOrder.startDate);
    const mechanicOrderLocked =
      isMechanicRole &&
      (selectedOrder.mechanicSubmitted ||
        selectedOrder.approvalStatus === "Verified" ||
        selectedOrder.status !== "In Progress") &&
      selectedOrder.approvalStatus !== "Rejected";
    const recordedParts = getChangedExecutionItems(selectedOrder.executionItems).flatMap((item) => {
      const entry = selectedOrder.partDetails[item.id];
      return (typeof entry?.partsUsed === "string" && entry.partsUsed.trim()) || entry?.attachments?.length
        ? [{ item, entry }]
        : [];
    });
    return (
      <View style={styles.container}>
        <Modal
          visible={previewAttachmentUri !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setPreviewAttachmentUri(null)}
        >
          <Pressable
            style={styles.attachmentPreviewBackdrop}
            onPress={() => setPreviewAttachmentUri(null)}
            accessibilityRole="button"
            accessibilityLabel="Close attachment preview"
          >
            {previewAttachmentUri ? (
              <View
                style={styles.attachmentPreviewImageFrame}
                onStartShouldSetResponder={() => true}
              >
                <Image
                  source={{ uri: previewAttachmentUri }}
                  style={styles.attachmentPreviewImage}
                  resizeMode="contain"
                  onError={() => {
                    setPreviewAttachmentUri(null);
                    Alert.alert("Attachment unavailable", "The image could not be decoded. Please upload it again.");
                  }}
                />
              </View>
            ) : null}
          </Pressable>
        </Modal>
        {/* Detail Header */}
        <View style={styles.detailHeaderBar}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => setSelectedOrderId(null)}
          >
            <Text style={styles.backButtonText}>‹ Back to Assigned Orders</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.exportButton} onPress={exportPDF}>
            <Text style={styles.exportButtonText}>📥 Export to PDF</Text>
          </TouchableOpacity>
        </View>

        {/* Template Banner */}
        <View style={styles.templateBanner}>
          <Text style={styles.templateBannerText}>
            ✓ USING TEMPLATE {selectedOrder.template}
          </Text>
        </View>

        {/* Step Bar */}
        <View style={styles.stepBar}>
          {visibleSteps.map((item) => (
            <TouchableOpacity
              key={item.key}
              style={[
                styles.stepButton,
                activeStep === item.key && styles.stepButtonActive,
              ]}
              onPress={() => setActiveStep(item.key)}
            >
              <Text
                style={[
                  styles.stepButtonText,
                  activeStep === item.key && styles.stepButtonTextActive,
                ]}
              >
                {item.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <ScrollView
          contentContainerStyle={styles.detailContent}
          refreshControl={<RefreshControl refreshing={pullRefreshing} onRefresh={refreshWorkOrders} colors={["#1a1f6e", "#d4a93f"]} tintColor="#1a1f6e" progressBackgroundColor="#ffffff" />}
        >
          {/* Step 1: Details */}
          {activeStep === "details" && (
            <>
              {renderAiAdvisoryCard()}
              {/* Maintenance Schedule Details */}
              <View style={styles.detailCard}>
                <Text style={styles.sectionTitle}>
                  Maintenance Schedule Details
                </Text>
                <Text style={styles.sectionText}>
                  Details from the maintenance schedule.
                </Text>
                <View style={styles.scheduleGrid}>
                  {selectedOrder.scheduleDetails.map((detail, idx) => (
                    <View key={idx} style={styles.scheduleItem}>
                      <Text style={styles.scheduleLabel}>{detail.label}</Text>
                      {detail.label === "Priority" ? renderPriorityBadge(selectedOrder.priority) : (
                        <Text style={styles.scheduleValue}>{detail.value}</Text>
                      )}
                    </View>
                  ))}
                </View>

                {isMechanicRole && selectedOrder.rejectionRemarks.trim() ? (
                  <View style={[styles.remarksSection, { backgroundColor: "#fff7ed", paddingHorizontal: 12, borderRadius: 10 }]}>
                    <Text style={[styles.remarksLabel, { color: "#9a3412" }]}>Chief Mechanic Rejection Remarks</Text>
                    <Text style={styles.sectionText}>{selectedOrder.rejectionRemarks}</Text>
                  </View>
                ) : null}
                {selectedOrder.maintenanceRemarks.trim() ? (
                  <View style={styles.remarksSection}>
                    <Text style={styles.remarksLabel}>Mechanic Maintenance Remarks</Text>
                    <Text style={styles.sectionText}>{selectedOrder.maintenanceRemarks}</Text>
                  </View>
                ) : null}

                {/* Parts Used Section */}
                <View style={styles.partsSection}>
                  <Text style={styles.sectionTitle}>
                    Parts Used, Cost, and Photos
                  </Text>
                  <Text style={styles.sectionText}>
                    Labor, materials, uploads, and supporting documentation for
                    this work order.
                  </Text>
                  {recordedParts.length === 0 ? (
                    <Text style={styles.emptyPartsText}>
                      No parts recorded for this work order.
                    </Text>
                  ) : (
                    recordedParts.map(({ item, entry }) => (
                      <View key={item.id} style={styles.partsItemCard}>
                        <Text style={styles.partsItemTitle}>{item.label}</Text>
                        <View style={styles.partsItemRow}>
                          <View style={styles.partsItemColumn}>
                            <Text style={styles.partsLabel}>Parts Used</Text>
                            <Text style={styles.partsValue}>
                              {entry.partsUsed}
                            </Text>
                          </View>
                          <View style={styles.partsItemColumn}>
                            <Text style={styles.partsLabel}>Quantity</Text>
                            <Text style={styles.partsValue}>
                              {entry.quantity || "N/A"}
                            </Text>
                          </View>
                          <View style={styles.partsItemColumn}>
                            <Text style={styles.partsLabel}>Material Cost</Text>
                            <Text style={styles.partsValue}>
                              ₱{Number.parseFloat(entry.materialCost || "0").toFixed(2)}
                            </Text>
                          </View>
                        </View>
                        {Array.isArray(entry.attachments) && entry.attachments.length > 0 ? (
                          <View style={styles.partsItemRow}>
                            {entry.attachments.map((file) => (
                              <View key={file.id} style={styles.attachmentActionRow}>
                                {file.storageName ? (
                                  <TouchableOpacity onPress={() => void viewAttachment(selectedOrder.id, file)}>
                                    <Text style={[styles.partsValue, styles.attachmentLink]}>View {file.name}</Text>
                                  </TouchableOpacity>
                                ) : (
                                  <Text style={styles.legacyAttachmentText}>Re-upload “{file.name}” to make it viewable.</Text>
                                )}
                                {isMechanicRole && selectedOrder.assignedMechanicId === user.id && file.storageName && (
                                  <TouchableOpacity onPress={() => void removeAttachment(selectedOrder.id, item.id, file.id)}>
                                    <Text style={styles.attachmentDelete}>Delete</Text>
                                  </TouchableOpacity>
                                )}
                              </View>
                            ))}
                          </View>
                        ) : null}
                      </View>
                    ))
                  )}
                </View>
              </View>
            </>
          )}

          {/* Step 2: Execution */}
          {activeStep === "execution" && (
            <View style={styles.detailCard}>
              <Text style={styles.sectionTitle}>Execution Checklist</Text>
              <Text style={styles.sectionText}>
                Mark each item as Checked, Changed, or Not Checked and capture
                notes.
              </Text>
              {selectedOrder.executionItems.length === 0 ? (
                <Text style={styles.emptyPartsText}>
                  No checklist items are available for this template yet.
                </Text>
              ) : (
                selectedOrder.executionItems.map((item) => {
                  const statusLabel =
                    item.status === "changed"
                      ? "PARTS CHANGE REQUIRED"
                      : item.status === "checked"
                        ? "CHECKED"
                        : item.status === "notChecked"
                          ? "NOT CHECKED"
                          : "PENDING";

                  return (
                    <View key={item.id} style={styles.checklistItemCard}>
                      <Text style={styles.checklistItemLabel}>
                        {item.label}
                      </Text>
                      <View style={styles.checklistItemStatus}>
                        <Text style={styles.statusLabel}>{statusLabel}</Text>
                      </View>
                      <View style={styles.pillButtonRow}>
                        {[
                          { key: "checked", label: "Checked" },
                          { key: "changed", label: "Changed" },
                          { key: "notChecked", label: "Not Checked" },
                        ].map((option) => (
                          <TouchableOpacity
                            key={option.key}
                            disabled={mechanicOrderLocked}
                            style={[
                              styles.pillButton,
                              item.status === option.key && {
                                backgroundColor: "#1a1f6e",
                              },
                            ]}
                            onPress={() =>
                              updateExecutionStatus(
                                selectedOrder.id,
                                item.id,
                                option.key as ExecutionItem["status"],
                              )
                            }
                          >
                            <Text
                              style={[
                                styles.pillButtonText,
                                item.status === option.key &&
                                  styles.pillButtonTextActive,
                              ]}
                            >
                              {option.label}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      <TextInput
                        style={styles.noteInput}
                        editable={!mechanicOrderLocked}
                        placeholder="Add note"
                        placeholderTextColor="#94a3b8"
                        value={item.note}
                        onChangeText={(text) =>
                          updateExecutionNote(selectedOrder.id, item.id, text)
                        }
                      />
                    </View>
                  );
                })
              )}

              <View style={styles.remarksSection}>
                <Text style={styles.remarksLabel}>Maintenance Work Remarks</Text>
                <Text style={styles.sectionText}>Describe the maintenance work performed and any additional information about this activity.</Text>
                <TextInput
                  style={styles.remarksInput}
                  editable={!mechanicOrderLocked}
                  placeholder="Describe the work performed"
                  placeholderTextColor="#94a3b8"
                  multiline
                  value={selectedOrder.maintenanceRemarks}
                  onChangeText={(text) => updateMaintenanceRemarks(selectedOrder.id, text)}
                />
              </View>

            </View>
          )}

          {/* Step 3: Parts, Cost & Photos */}
          {activeStep === "parts" && (
            <View style={styles.detailCard}>
              <Text style={styles.sectionTitle}>Parts, Cost & Photos</Text>
              <Text style={styles.sectionText}>
                Record any parts or materials used against the relevant checklist item. Parts, quantity, cost, and an attachment are required for items marked Changed.
              </Text>

              {getChangedExecutionItems(selectedOrder.executionItems).map((item) => {
                const partEntry = selectedOrder.partDetails[item.id] ?? {
                  partsUsed: "",
                  quantity: "",
                  materialCost: "",
                  attachments: [],
                  attachmentName: "",
                };

                return (
                  <View key={item.id} style={styles.partsItemCard}>
                    <Text style={styles.partsItemTitle}>{item.label}</Text>
                    <View style={styles.partsItemRow}>
                      <View style={styles.partsItemColumn}>
                        <Text style={styles.partsLabel}>Parts Used</Text>
                        <TextInput
                          style={styles.partsInput}
                          editable={!mechanicOrderLocked}
                          value={partEntry.partsUsed}
                          onChangeText={(text) =>
                            updatePartDetailField(
                              selectedOrder.id,
                              item.id,
                              "partsUsed",
                              text,
                            )
                          }
                          placeholder="Enter parts used"
                          placeholderTextColor="#94a3b8"
                        />
                      </View>
                      <View style={styles.partsItemColumn}>
                        <Text style={styles.partsLabel}>
                          Number of Materials Used
                        </Text>
                        <TextInput
                          style={styles.partsInput}
                          editable={!mechanicOrderLocked}
                          value={partEntry.quantity}
                          keyboardType="numeric"
                          onChangeText={(text) =>
                            updatePartDetailField(
                              selectedOrder.id,
                              item.id,
                              "quantity",
                              text,
                            )
                          }
                          placeholder="0"
                          placeholderTextColor="#94a3b8"
                        />
                      </View>
                    </View>
                    <View style={styles.partsItemRow}>
                      <View style={styles.partsItemColumn}>
                        <Text style={styles.partsLabel}>Material Cost</Text>
                        <TextInput
                          style={styles.partsInput}
                          editable={!mechanicOrderLocked}
                          value={partEntry.materialCost}
                          keyboardType="decimal-pad"
                          onChangeText={(text) =>
                            updatePartDetailField(
                              selectedOrder.id,
                              item.id,
                              "materialCost",
                              text,
                            )
                          }
                          placeholder="0.00"
                          placeholderTextColor="#94a3b8"
                        />
                      </View>
                    </View>
                    <Text style={styles.partsLabel}>Photos / Attachments</Text>
                    <TouchableOpacity
                      style={styles.uploadButton}
                      disabled={mechanicOrderLocked}
                      onPress={() =>
                        addAttachmentToItem(selectedOrder.id, item.id)
                      }
                    >
                      <Text style={styles.uploadButtonText}>
                        Add Attachments ({partEntry.attachments.length}/5)
                      </Text>
                    </TouchableOpacity>
                    {partEntry.attachments.length === 0 ? (
                      <Text style={styles.noFileText}>
                        No attachments added yet.
                      </Text>
                    ) : (
                      partEntry.attachments.map((attachment) => (
                        <View key={attachment.id} style={styles.partsItemRow}>
                          {attachment.storageName ? (
                            <TouchableOpacity onPress={() => void viewAttachment(selectedOrder.id, attachment)}>
                              <Text style={[styles.partsValue, styles.attachmentLink]}>
                                {attachment.name} ({attachment.sizeMb} MB) · View
                              </Text>
                            </TouchableOpacity>
                          ) : (
                            <Text style={styles.legacyAttachmentText}>Re-upload “{attachment.name}” to make it viewable.</Text>
                          )}
                          {isMechanicRole && selectedOrder.assignedMechanicId === user.id && attachment.storageName && !mechanicOrderLocked && (
                            <TouchableOpacity onPress={() => void removeAttachment(selectedOrder.id, item.id, attachment.id)}>
                              <Text style={styles.attachmentDelete}>Delete</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      ))
                    )}
                  </View>
                );
              })}

              {getChangedExecutionItems(selectedOrder.executionItems).length === 0 && (
                <Text style={styles.emptyPartsText}>
                  No checklist items are available for recording parts.
                </Text>
              )}

              <View style={styles.costSummaryRow}>
                <View style={styles.costCard}>
                  <Text style={styles.costLabel}>Total Cost</Text>
                  <Text style={styles.costValue}>
                    ₱{calculateMaterialCost(selectedOrder.id)}
                  </Text>
                </View>
              </View>

            </View>
          )}

          {/* Chief mechanic inspection */}
          {activeStep === "inspection" && isChiefMechanicRole && (
            <View style={styles.detailCard}>
              <Text style={styles.sectionTitle}>Inspection Checklist</Text>
              <Text style={styles.sectionText}>
                Verify the execution submitted by {selectedOrder.mechanic}.
              </Text>
              {selectedOrder.inspectionItems.map((item) => (
                <View key={item.id} style={styles.checklistItemCard}>
                  <Text style={styles.checklistItemLabel}>{item.label}</Text>
                  <View style={styles.pillButtonRow}>
                    {[
                      { key: "pass" as const, label: "Pass" },
                      { key: "fail" as const, label: "Fail" },
                    ].map((option) => (
                      <TouchableOpacity
                        key={option.key}
                        style={[
                          styles.pillButton,
                          item.status === option.key && {
                            backgroundColor:
                              option.key === "pass" ? "#15803d" : "#b91c1c",
                          },
                        ]}
                        onPress={() =>
                          updateInspectionStatus(
                            selectedOrder.id,
                            item.id,
                            option.key,
                          )
                        }
                      >
                        <Text
                          style={[
                            styles.pillButtonText,
                            item.status === option.key &&
                              styles.pillButtonTextActive,
                          ]}
                        >
                          {option.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TextInput
                    style={styles.noteInput}
                    placeholder="Add inspection remarks"
                    placeholderTextColor="#94a3b8"
                    value={item.note}
                    onChangeText={(text) =>
                      updateInspectionNote(selectedOrder.id, item.id, text)
                    }
                  />
                </View>
              ))}
              <View style={styles.chiefMechanicSection}>
                <Text style={styles.sectionTitle}>
                  Inspection Results Approval / Verification
                </Text>
                <View style={styles.inspectionStatusBanner}>
                  <Text style={styles.inspectionStatusLabel}>
                    Inspection Result
                  </Text>
                  <Text style={styles.inspectionStatusValue}>
                    {inspectionResultLabel(
                      getAutomaticInspectionRemark(
                        selectedOrder.inspectionItems,
                      ),
                    )}
                  </Text>
                </View>
                <Text style={styles.dropdownLabel}>Inspection Remarks</Text>
                <TextInput
                  style={styles.remarksInput}
                  placeholder="Add inspection remarks"
                  placeholderTextColor="#94a3b8"
                  multiline
                  value={selectedOrder.inspectorRemarks}
                  onChangeText={(text) =>
                    updateInspectorRemarks(selectedOrder.id, text)
                  }
                />
                {selectedOrder.rejectionRemarks.trim() ? (
                  <View style={styles.remarksSection}>
                    <Text style={styles.remarksLabel}>Previous Rejection Remarks</Text>
                    <Text style={styles.sectionText}>{selectedOrder.rejectionRemarks}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          )}
        </ScrollView>

        {isMechanicRole && canManuallyStart && !startDateReached ? (
          <View style={styles.startDateNotice}>
            <Text style={styles.startDateNoticeText}>
              Available to start {selectedOrder.startDate
                ? `on ${formatReadableDate(selectedOrder.startDate)}`
                : "after Operations sets a scheduled start date"}.
            </Text>
          </View>
        ) : null}

        {/* Bottom Navigation */}
        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={styles.bottomButtonSecondary}
            onPress={() => {
              const currentIndex = visibleSteps.findIndex(
                (step) => step.key === activeStep,
              );
              const previousStep = visibleSteps[Math.max(0, currentIndex - 1)];
              setActiveStep(previousStep.key);
            }}
          >
            <Text style={styles.bottomButtonSecondaryText}>Previous</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.bottomButtonPrimary}
            onPress={() => {
              const currentIndex = visibleSteps.findIndex(
                (step) => step.key === activeStep,
              );
              const nextStep =
                visibleSteps[
                  Math.min(visibleSteps.length - 1, currentIndex + 1)
                ];
              setActiveStep(nextStep.key);
            }}
          >
            <Text style={styles.bottomButtonPrimaryText}>Next</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.bottomButtonPrimary,
              styles.inspectionActionButton,
              (selectedOrder.status === "Completed" ||
                selectedOrder.approvalStatus === "Verified") &&
                styles.completedActionButton,
              isChiefMechanicRole && getAutomaticInspectionRemark(selectedOrder.inspectionItems) ===
                "Unverified" && styles.inspectionActionDisabled,
            ]}
            onPress={() => {
              if (isMechanicRole) {
                if (["Pending", "Overdue", "Rejected"].includes(selectedOrder.status) && !selectedOrder.mechanicSubmitted) void performWorkflowAction("START");
                else handleCompleteOrder();
              } else handleInspectionAction();
            }}
            disabled={savingAction || selectedOrder.status === "Completed" ||
              (isChiefMechanicRole && (!selectedOrder.mechanicSubmitted || getAutomaticInspectionRemark(selectedOrder.inspectionItems) === "Unverified")) ||
              (isMechanicRole && selectedOrder.mechanicSubmitted) ||
              (isMechanicRole && canManuallyStart && !startDateReached)}
          >
            <Text
              style={[
                styles.bottomButtonPrimaryText,
                (selectedOrder.status === "Completed" ||
                  selectedOrder.approvalStatus === "Verified") &&
                  styles.completedActionButtonText,
              ]}
            >
              {savingAction ? "Saving?" : isMechanicRole
                ? selectedOrder.status === "Completed" || selectedOrder.approvalStatus === "Verified"
                  ? "Completed"
                  : selectedOrder.mechanicSubmitted
                    ? "Awaiting Chief Review"
                    : ["Pending", "Overdue", "Rejected"].includes(selectedOrder.status)
                      ? "Start Work"
                      : "Mark Done & Submit"
                : getInspectionActionLabel(getAutomaticInspectionRemark(selectedOrder.inspectionItems))}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.pageHeader}>
        <MobilePageHeader
          title="Work Orders"
          subtitle={isChiefMechanicRole
            ? "Review and verify inspection checklists"
            : "Your assigned work orders grouped by mechanic"}
        />
      </View>

      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          accessibilityLabel="Search work orders by number, plate, task, or mechanic"
          autoCapitalize="none"
          placeholder="Search vehicle, task, or mechanic…"
          placeholderTextColor="#94a3b8"
        />
        <TouchableOpacity style={styles.filterButton} onPress={() => setShowFilters((value) => !value)}
          accessibilityRole="button" accessibilityLabel="Toggle work order filters" accessibilityState={{ expanded: showFilters }}>
          <Svg width={26} height={26} viewBox="0 0 24 24" fill="none" accessibilityLabel="Filter">
            <Path
              d="M3 4h18l-7 8.2v6.2l-4 2V12.2L3 4Z"
              stroke="#D4A93F"
              strokeWidth={2.3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
          {statusFilter || typeFilter || priorityFilter ? <View style={styles.activeFilterDot} /> : null}
        </TouchableOpacity>
      </View>

      {showFilters && (
        <View style={styles.filterPanel}>
          {[
            { key: "status" as const, label: "Status", options: statusOptions, selected: statusFilter, select: setStatusFilter },
            { key: "type" as const, label: "Maintenance Type", options: typeOptions, selected: typeFilter, select: setTypeFilter },
            { key: "priority" as const, label: "Priority", options: priorityOptions, selected: priorityFilter, select: setPriorityFilter },
          ].map((filter) => (
            <View key={filter.key} style={styles.filterMenuSection}>
              <View style={styles.filterMenuHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.remarksLabel}>{filter.label}</Text>
                  <Text style={styles.filterSelectedValue}>{filter.key === "priority" && filter.selected ? filter.selected.charAt(0) + filter.selected.slice(1).toLowerCase() : filter.selected ?? "All"}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => setOpenFilterMenu((current) => current === filter.key ? null : filter.key)}
                  accessibilityRole="button"
                  accessibilityLabel={`Choose ${filter.label.toLowerCase()}`}
                  accessibilityState={{ expanded: openFilterMenu === filter.key }}
                  style={styles.filterMenuButton}
                >
                  <Text style={styles.filterMenuButtonText}>•••</Text>
                </TouchableOpacity>
              </View>
              {openFilterMenu === filter.key && (
                <View style={styles.filterOptionsMenu}>
                  {[null, ...filter.options].map((option) => (
                    <TouchableOpacity
                      key={option ?? "all"}
                      onPress={() => { filter.select(option); setOpenFilterMenu(null); }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: filter.selected === option }}
                      style={styles.filterOption}
                    >
                      <Text style={[styles.filterOptionText, filter.selected === option && styles.filterOptionTextSelected]}>
                        {filter.key === "priority" && option ? option.charAt(0) + option.slice(1).toLowerCase() : option ?? "All"}
                      </Text>
                      {filter.selected === option ? <Text style={styles.filterOptionCheck}>✓</Text> : null}
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          ))}
        </View>
      )}
      <View style={styles.searchRow}>
        <Text style={styles.sectionText}>{filteredOrders.length} of {visibleOrders.length} work orders</Text>
        {filtersActive && <TouchableOpacity onPress={clearFilters} accessibilityRole="button"><Text style={{ color: "#1a1f6e", fontWeight: "700" }}>Clear filters</Text></TouchableOpacity>}
      </View>

      <ScrollView
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={pullRefreshing} onRefresh={refreshWorkOrders} colors={["#1a1f6e", "#d4a93f"]} tintColor="#1a1f6e" progressBackgroundColor="#ffffff" />}
      >
        {isLoading ? (
          <View style={styles.emptyStateCard}>
            <Text style={styles.emptyStateTitle}>Loading work orders…</Text>
          </View>
        ) : filteredOrders.length === 0 ? (
          <View style={styles.emptyStateCard}>
            <Text style={styles.emptyStateTitle}>{filtersActive ? "No matching work orders" : "No assigned work orders"}</Text>
            <Text style={styles.emptyStateText}>
              {filtersActive ? "Try a different search or clear the filters." : accessRole === "mechanic"
                ? "No execution work orders are assigned to you right now."
                : "No inspection work orders are assigned to you right now."}
            </Text>
          </View>
        ) : (
          pageOrders.map((order) => (
                <Pressable
                  key={order.id}
                  style={styles.orderCard}
                  onPress={() => openOrder(order.id)}
                >
                  <View style={styles.orderCardHeader}>
                    <Text style={styles.orderNumber}>{order.number}</Text>
                    {renderStatusBadge(order.status)}
                  </View>
                  <View style={styles.cardBody}>
                    <Text style={styles.cardValue} numberOfLines={1}>
                      <Text style={styles.cardBoldLabel}>{order.plate}</Text>
                    </Text>
                    <View style={styles.cardRow}>
                      <Text style={styles.cardLabel}>Maintenance Type</Text>
                    </View>
                    <Text style={styles.cardValue}>
                      {order.maintenanceType}
                    </Text>
                    <View style={styles.cardRow}>
                      <Text style={styles.cardLabel}>Priority</Text>
                    </View>
                    {renderPriorityBadge(order.priority)}
                    <View style={styles.cardRow}>
                      <Text style={styles.cardLabel}>Mechanic</Text>
                    </View>
                    <Text style={styles.cardValue}>{order.mechanic}</Text>
                    <View style={styles.cardRow}>
                      <Text style={styles.cardLabel}>Date Created</Text>
                    </View>
                    <Text style={styles.cardValue}>{order.dateCreated}</Text>
                  </View>
                  <View style={styles.orderCardFooter}>
                    <Text style={styles.cardHint}>Open details</Text>
                    <Text style={styles.cardArrow}>›</Text>
                  </View>
                </Pressable>
          ))
        )}
        {!isLoading && filteredOrders.length > 0 && totalPages > 1 ? (
          <View style={styles.pagination}>
            <TouchableOpacity
              style={[styles.pageButton, currentPage === 1 && styles.pageButtonDisabled]}
              disabled={currentPage === 1}
              onPress={() => setCurrentPage((page) => Math.max(1, page - 1))}
              accessibilityRole="button"
              accessibilityLabel="Previous page"
            >
              <Text style={styles.pageButtonText}>Previous</Text>
            </TouchableOpacity>
            <Text style={styles.pageIndicator}>Page {currentPage} of {totalPages}</Text>
            <TouchableOpacity
              style={[styles.pageButton, currentPage === totalPages && styles.pageButtonDisabled]}
              disabled={currentPage === totalPages}
              onPress={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
              accessibilityRole="button"
              accessibilityLabel="Next page"
            >
              <Text style={styles.pageButtonText}>Next</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  filterPanel: { padding: 12, backgroundColor: "#ffffff", borderRadius: 12, marginBottom: 12 },
  filterMenuSection: { marginBottom: 8 },
  filterMenuHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  filterSelectedValue: { color: "#1a1f6e", fontSize: 14, fontWeight: "600", marginTop: 3 },
  filterMenuButton: { minWidth: 44, minHeight: 44, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "#f1f5f9" },
  filterMenuButtonText: { color: "#1a1f6e", fontSize: 18, fontWeight: "800", letterSpacing: 1 },
  filterOptionsMenu: { marginTop: 6, borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, overflow: "hidden" },
  filterOption: { minHeight: 44, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#ffffff", borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  filterOptionText: { color: "#334155", fontSize: 14 },
  filterOptionTextSelected: { color: "#1a1f6e", fontWeight: "700" },
  filterOptionCheck: { color: "#1a1f6e", fontWeight: "800", fontSize: 16 },
  container: { flex: 1, backgroundColor: "#f1f5f9", padding: 16 },
  pageHeader: {
    marginBottom: 12,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#0d0d0d",
    fontSize: 14,
  },
  filterButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#1a1f6e",
  },
  filterButtonText: { color: "#ffffff", fontSize: 20, fontWeight: "700" },
  listContent: { paddingBottom: 20, gap: 12 },
  pagination: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8 },
  pageButton: { minHeight: 44, paddingHorizontal: 16, borderRadius: 10, backgroundColor: "#1a1f6e", alignItems: "center", justifyContent: "center" },
  pageButtonDisabled: { backgroundColor: "#94a3b8" },
  pageButtonText: { color: "#ffffff", fontWeight: "700" },
  pageIndicator: { color: "#475569", fontWeight: "600" },
  groupSection: { gap: 10 },
  groupHeader: {
    backgroundColor: "#ffffff",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 6,
    shadowColor: "#000",
    shadowOpacity: 0.02,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  groupLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "#94a3b8",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  groupMechanicName: {
    fontSize: 16,
    fontWeight: "800",
    color: "#1a1f6e",
  },
  groupCount: {
    fontSize: 12,
    fontWeight: "500",
    color: "#64748b",
  },
  orderCard: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 14,
    gap: 10,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  orderCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  verificationMessage: {
    color: "#92400e",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 8,
  },
  orderNumber: { fontSize: 16, fontWeight: "800", color: "#1a1f6e" },
  statusBadge: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1.5,
  },
  statusPending: workOrderStatusColors.pending,
  statusInProgress: workOrderStatusColors.inProgress,
  statusVerification: workOrderStatusColors.verification,
  statusRejected: workOrderStatusColors.rejected,
  statusRepair: workOrderStatusColors.repair,
  statusOverdue: workOrderStatusColors.overdue,
  statusCompleted: workOrderStatusColors.completed,
  statusBadgeText: { fontSize: 11, fontWeight: "700", color: workOrderStatusTextColor },
  priorityBadge: { alignSelf: "flex-start", borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
  priorityHigh: { backgroundColor: "#fee2e2", borderColor: "#fca5a5" },
  priorityMedium: { backgroundColor: "#fef3c7", borderColor: "#fcd34d" },
  priorityLow: { backgroundColor: "#d1fae5", borderColor: "#6ee7b7" },
  priorityBadgeText: { fontSize: 11, fontWeight: "800" },
  priorityHighText: { color: "#9f1239" },
  priorityMediumText: { color: "#92400e" },
  priorityLowText: { color: "#065f46" },
  cardBody: { gap: 4 },
  cardRow: { marginTop: 8 },
  cardBoldLabel: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0d0d0d",
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  cardValue: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0d0d0d",
  },
  orderCardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    paddingTop: 8,
    marginTop: 4,
  },
  emptyStateCard: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 20,
    alignItems: "center",
  },
  emptyStateTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0d0d0d",
    marginBottom: 6,
  },
  emptyStateText: {
    color: "#64748b",
    fontSize: 13,
    textAlign: "center",
  },
  cardHint: { color: "#64748b", fontSize: 12 },
  cardArrow: { color: "#1a1f6e", fontSize: 22, fontWeight: "700" },

  /* Detail View Styles */
  detailHeaderBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    paddingVertical: 8,
  },
  backButton: { minHeight: 44, justifyContent: "center" },
  backButtonText: { color: "#1a1f6e", fontWeight: "700", fontSize: 14 },
  exportButton: {
    minHeight: 44,
    paddingHorizontal: 12,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#1a1f6e",
    borderRadius: 10,
  },
  exportButtonText: { color: "#ffffff", fontWeight: "700", fontSize: 12 },

  templateBanner: {
    backgroundColor: "#f5f3ff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#ddd6fe",
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  templateBannerText: {
    color: "#4c1d95",
    fontWeight: "700",
    fontSize: 13,
  },

  stepBar: {
    flexDirection: "row",
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 4,
    gap: 6,
    marginBottom: 12,
  },
  stepButton: {
    flex: 1,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 10,
    paddingHorizontal: 6,
  },
  stepButtonActive: { backgroundColor: "#1a1f6e" },
  stepButtonText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#64748b",
    textAlign: "center",
  },
  stepButtonTextActive: { color: "#ffffff" },
  detailContent: { paddingBottom: 140, gap: 12 },
  detailCard: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 18,
    gap: 14,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  sectionTitle: { fontSize: 18, fontWeight: "800", color: "#0d0d0d" },
  sectionText: { color: "#64748b", fontSize: 13, marginTop: 2 },

  /* Schedule Details */
  scheduleGrid: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
  },
  scheduleItem: {
    flex: 1,
    minWidth: "48%",
    paddingBottom: 12,
  },
  scheduleLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "#94a3b8",
    textTransform: "uppercase",
    marginBottom: 6,
    letterSpacing: 0.6,
  },
  scheduleValue: {
    fontSize: 15,
    fontWeight: "600",
    color: "#0d0d0d",
  },

  /* Execution Checklist */
  checklistItemCard: {
    backgroundColor: "#f8fafc",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 14,
    gap: 11,
    marginBottom: 12,
  },
  checklistItemLabel: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0d0d0d",
  },
  checklistItemStatus: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: "#f1f5f9",
    borderRadius: 8,
  },
  statusLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748b",
  },
  pillButtonRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  pillButton: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#f8fafc",
    justifyContent: "center",
    alignItems: "center",
  },
  pillButtonText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#64748b",
  },
  pillButtonTextActive: { color: "#ffffff" },

  chiefMechanicSection: {
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    paddingTop: 12,
    marginTop: 8,
    gap: 8,
  },
  dropdownSection: {
    gap: 8,
    paddingTop: 4,
  },
  dropdownLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#64748b",
    textTransform: "uppercase",
  },
  dropdownButton: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#ffffff",
  },
  dropdownButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#0d0d0d",
  },
  dropdownMenu: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    backgroundColor: "#ffffff",
    overflow: "hidden",
  },
  dropdownOption: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  dropdownOptionText: {
    fontSize: 13,
    color: "#0d0d0d",
  },

  /* Parts & Photos */
  partsSection: {
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    paddingTop: 16,
    marginTop: 16,
    gap: 12,
  },
  emptyPartsText: {
    fontSize: 13,
    color: "#94a3b8",
    fontStyle: "italic",
  },
  partsItemCard: {
    backgroundColor: "#f8fafc",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 14,
    gap: 12,
    marginBottom: 12,
  },
  partsItemTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0d0d0d",
  },
  partsItemRow: {
    flexDirection: "row",
    gap: 12,
  },
  partsItemColumn: {
    flex: 1,
  },
  partsLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "#94a3b8",
    textTransform: "uppercase",
    marginBottom: 6,
    letterSpacing: 0.6,
  },
  partsValue: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0d0d0d",
  },
  attachmentLink: {
    color: "#1a1f6e",
    textDecorationLine: "underline",
  },
  activeFilterDot: {
    position: "absolute",
    width: 8,
    height: 8,
    borderRadius: 4,
    top: 7,
    right: 7,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#1a1f6e",
  },
  attachmentDelete: {
    color: "#b91c1c",
    fontSize: 13,
    fontWeight: "700",
  },
  legacyAttachmentText: {
    color: "#92400e",
    fontSize: 13,
    fontWeight: "600",
  },
  attachmentActionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  attachmentPreviewBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.94)",
    justifyContent: "center",
    alignItems: "center",
    padding: 28,
  },
  attachmentPreviewImageFrame: {
    width: "88%",
    height: "76%",
  },
  attachmentPreviewImage: {
    width: "100%",
    height: "85%",
  },
  partsInput: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: "#ffffff",
    color: "#0d0d0d",
    fontSize: 13,
  },
  uploadButton: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    backgroundColor: "#f1f5f9",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 4,
  },
  uploadButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748b",
  },
  noFileText: {
    fontSize: 12,
    color: "#cbd5e1",
    fontStyle: "italic",
  },
  costSummaryRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 8,
  },
  costCard: {
    flex: 1,
    backgroundColor: "#f8fafc",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  costLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "#64748b",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  costValue: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0d0d0d",
  },

  /* Inspection Checklist */
  inspectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  reviewBadge: {
    backgroundColor: "#fef3c7",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  reviewBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#b45309",
  },
  inspectionItemCard: {
    backgroundColor: "#f8fafc",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 12,
    gap: 10,
    marginBottom: 12,
  },
  inspectionItemLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0d0d0d",
  },
  inspectionPillRow: {
    flexDirection: "row",
    gap: 8,
  },
  inspectionPillButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#f8fafc",
    justifyContent: "center",
    alignItems: "center",
  },
  inspectionPillPass: {
    backgroundColor: "#dcfce7",
    borderColor: "#86efac",
  },
  inspectionPillFail: {
    backgroundColor: "#fee2e2",
    borderColor: "#fca5a5",
  },
  inspectionPillText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#64748b",
  },
  inspectionPillTextActive: { color: "#ffffff" },

  remarksSection: {
    gap: 8,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
  },
  remarksLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#64748b",
    textTransform: "uppercase",
  },
  remarksInput: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#ffffff",
    color: "#0d0d0d",
    fontSize: 13,
    textAlignVertical: "top",
  },
  inspectionStatusBanner: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#f8fafc",
    gap: 3,
  },
  inspectionStatusLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "#64748b",
    textTransform: "uppercase",
  },
  inspectionStatusValue: {
    fontSize: 15,
    fontWeight: "800",
    color: "#1a1f6e",
  },

  resultsRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 12,
  },
  resultsCard: {
    flex: 1,
    backgroundColor: "#f8fafc",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  resultsLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "#64748b",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  resultsValue: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0d0d0d",
  },

  noteInput: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: "#ffffff",
    color: "#0d0d0d",
    fontSize: 13,
  },

  bottomBar: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 12,
    flexDirection: "row",
    gap: 8,
    backgroundColor: "#ffffff",
    borderRadius: 14,
    padding: 8,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  startDateNotice: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 76,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "#fff7ed",
    borderWidth: 1,
    borderColor: "#fed7aa",
  },
  startDateNoticeText: { color: "#9a3412", fontSize: 12, fontWeight: "600" },
  bottomButtonSecondary: {
    flex: 1,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 10,
    backgroundColor: "#f1f5f9",
  },
  bottomButtonSecondaryText: {
    color: "#0d0d0d",
    fontWeight: "700",
    fontSize: 13,
  },
  bottomButtonPrimary: {
    flex: 1,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 10,
    backgroundColor: "#1a1f6e",
  },
  bottomButtonPrimaryText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 13,
    textAlign: "center",
  },
  inspectionActionButton: {
    flex: 1.35,
    paddingHorizontal: 8,
  },
  inspectionActionDisabled: {
    backgroundColor: "#94a3b8",
  },
  completedActionButton: {
    backgroundColor: "#e2e8f0",
    borderWidth: 1,
    borderColor: "#cbd5e1",
  },
  completedActionButtonText: {
    color: "#475569",
  },
  inspectionDecisionFooter: {
    flex: 1.25,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 10,
    paddingHorizontal: 6,
    backgroundColor: "#1a1f6e",
  },
  inspectionDecisionFooterText: {
    color: "#ffffff",
    fontWeight: "800",
    fontSize: 12,
    textAlign: "center",
  },

  /* AI Features Styles */
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  aiInsightsHeaderButton: {
    backgroundColor: "#1a1f6e",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  aiInsightsHeaderButtonText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "700",
  },
  aiCardContainer: {
    backgroundColor: "#f0fdf4",
    borderColor: "#bbf7d0",
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    gap: 10,
  },
  aiCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  aiCardTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: "#15803d",
  },
  aiRefreshButton: {
    backgroundColor: "#16a34a",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  aiRefreshButtonText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "700",
  },
  aiLoadingBlock: {
    paddingVertical: 14,
    alignItems: "center",
    gap: 8,
  },
  aiLoadingText: {
    fontSize: 12,
    color: "#166534",
    fontWeight: "600",
  },
  aiCardContent: {
    gap: 10,
  },
  aiAdvisoryText: {
    fontSize: 13,
    color: "#166534",
    lineHeight: 18,
    fontWeight: "500",
  },
  aiSectionsContainer: {
    gap: 8,
  },
  aiSectionCard: {
    backgroundColor: "#ffffff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#bbf7d0",
    padding: 10,
    gap: 4,
  },
  aiSectionTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: "#15803d",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  aiBulletRow: {
    flexDirection: "row",
    gap: 6,
    alignItems: "flex-start",
  },
  aiBulletDot: {
    fontSize: 14,
    color: "#16a34a",
    fontWeight: "700",
  },
  aiBulletText: {
    fontSize: 12,
    color: "#334155",
    lineHeight: 16,
    flex: 1,
  },
  aiChecklistSection: {
    marginTop: 8,
    paddingTop: 10,
    borderTopWidth: 1,
    borderColor: "#dcfce7",
    gap: 8,
  },
  aiChecklistHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  aiChecklistTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#15803d",
    flex: 1,
  },
  aiStepItem: {
    flexDirection: "row",
    gap: 8,
    backgroundColor: "#ffffff",
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#dcfce7",
  },
  aiStepNumber: {
    fontSize: 13,
    fontWeight: "800",
    color: "#15803d",
  },
  aiStepTextContainer: {
    flex: 1,
    gap: 2,
  },
  aiStepTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0f172a",
  },
  aiStepPriority: {
    fontSize: 11,
    fontWeight: "800",
    color: "#dc2626",
  },
  aiStepDesc: {
    fontSize: 12,
    color: "#475569",
    lineHeight: 16,
  },

  /* Screenshot-Matched Gemini AI UI Styles */
  aiWebCardContainer: {
    backgroundColor: "#ffffff",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    marginBottom: 16,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
  },
  aiWebHeaderBar: {
    backgroundColor: "#f8fafc",
    borderBottomWidth: 1,
    borderColor: "#f1f5f9",
    padding: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  aiWebHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
    minWidth: 220,
  },
  aiWebSparkleBadge: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: "#eff6ff",
    borderWidth: 1,
    borderColor: "#dbeafe",
    justifyContent: "center",
    alignItems: "center",
  },
  aiWebSparkleIcon: {
    fontSize: 18,
  },
  aiWebHeaderTextGroup: {
    flex: 1,
    gap: 2,
  },
  aiWebTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: "#0f172a",
  },
  aiWebSubtitle: {
    fontSize: 12,
    color: "#64748b",
    lineHeight: 16,
  },
  aiWebReGenerateButton: {
    backgroundColor: "#1a1f6e",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    shadowColor: "#1a1f6e",
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  aiWebReGenerateText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "700",
  },
  aiWebLoadingBlock: {
    padding: 24,
    alignItems: "center",
    gap: 10,
  },
  aiWebLoadingText: {
    fontSize: 13,
    color: "#475569",
    textAlign: "center",
    lineHeight: 18,
    fontWeight: "500",
  },
  aiWebBody: {
    padding: 16,
    gap: 16,
  },
  aiWebSectionBlock: {
    gap: 10,
  },
  aiWebSectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  aiWebSectionHeaderIcon: {
    fontSize: 14,
  },
  aiWebSectionHeaderTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: "#2563eb",
    letterSpacing: 0.5,
  },
  aiWebStepList: {
    gap: 10,
  },
  aiWebStepCard: {
    backgroundColor: "#f8fafc",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  aiWebStepLeft: {
    flexDirection: "row",
    gap: 12,
    flex: 1,
  },
  aiWebStepCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#dbeafe",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 1,
  },
  aiWebStepCircleText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#2563eb",
  },
  aiWebStepContent: {
    flex: 1,
    gap: 3,
  },
  aiWebStepTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0f172a",
  },
  aiWebStepDesc: {
    fontSize: 12,
    color: "#475569",
    lineHeight: 17,
  },
  aiWebPriorityBadge: {
    backgroundColor: "#dbeafe",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    alignSelf: "flex-start",
  },
  aiWebPriorityText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#1d4ed8",
    letterSpacing: 0.5,
  },
  aiWebGrid: {
    gap: 12,
  },
  aiWebGridCard: {
    backgroundColor: "#f0f9ff",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e0f2fe",
    padding: 14,
    gap: 8,
  },
  aiWebGridCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  aiWebGridCardIcon: {
    fontSize: 14,
  },
  aiWebGridCardTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: "#0284c7",
    letterSpacing: 0.5,
  },
  aiWebGridCardBody: {
    gap: 6,
  },
  aiWebBulletRow: {
    flexDirection: "row",
    gap: 6,
    alignItems: "flex-start",
  },
  aiWebBulletDot: {
    fontSize: 14,
    color: "#0284c7",
    fontWeight: "700",
  },
  aiWebBulletText: {
    fontSize: 12,
    color: "#334155",
    lineHeight: 17,
    flex: 1,
  },
  /* Manual Generate Prompt Styles */
  aiWebPromptContainer: {
    backgroundColor: "#ffffff",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 24,
    marginBottom: 16,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
  },
  aiWebPromptBadge: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: "#eff6ff",
    borderWidth: 1,
    borderColor: "#dbeafe",
    justifyContent: "center",
    alignItems: "center",
  },
  aiWebPromptIcon: {
    fontSize: 24,
  },
  aiWebPromptTextGroup: {
    alignItems: "center",
    gap: 4,
    maxWidth: 320,
  },
  aiWebPromptTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#0f172a",
    textAlign: "center",
  },
  aiWebPromptSubtext: {
    fontSize: 12,
    color: "#64748b",
    textAlign: "center",
    lineHeight: 18,
  },
  aiWebGenerateButton: {
    backgroundColor: "#1a1f6e",
    borderRadius: 14,
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginTop: 4,
    shadowColor: "#1a1f6e",
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  aiWebGenerateButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "700",
  },
});
