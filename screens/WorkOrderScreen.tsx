import {
  workOrderStatusColors,
  workOrderStatusTextColors,
} from "./workOrderStatusColors";
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
import {
  canOpenWorkOrder,
  isAwaitingChiefReview,
  submittedReviewState,
} from "./workOrderReview";
import { sortWorkOrdersForQueue } from "./workOrderPriority";
import {
  dashboardWorkOrderStatuses,
  matchesWorkOrderDashboardFilter,
  wasInProgressBeforeOverdue,
  type DashboardWorkOrderFilter,
} from "./workOrderDashboardFilter";
import { formatWorkOrderDate as formatReadableDate } from "../services/workOrderDates";
import { MobilePageHeader } from "../components/MobilePageHeader";
import { MaintenanceStatusLegend } from "../components/MaintenanceStatusLegend";
import { isLaterDateOnly, isValidDateOnly } from "./scheduleExtensionDate";
import { buildWorkOrderPdfHtml } from "./workOrderPdf";
import {
  getAutomaticInspectionRemark,
  type InspectionRemark,
} from "./inspectionRemark";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
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
import * as Print from "expo-print";
import * as FileSystemLegacy from "expo-file-system/legacy";
import * as SecureStore from "expo-secure-store";
import { File, Paths } from "expo-file-system";
import Svg, { Path } from "react-native-svg";

import type { SyncService } from "../services/SyncService";
import type {
  AuthenticatedUser,
  CreatedMaintenanceScheduleExtension,
  MobileRepairReferral,
  MaintenanceScheduleExtensionHistory,
  MaintenanceScheduleExtensionRequest,
  MobileAccessRole,
} from "../services/AuthService";
import { API_BASE_URL, AuthService } from "../services/AuthService";
import { useSearchHistory } from "../services/useSearchHistory";
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
  | "Due"
  | "In Progress"
  | "For Verification"
  | "Overdue"
  | "Completed"
  | "Cancelled"
  | "Done"
  | "Rejected"
  | "For Repair";
type StepKey = "details" | "execution" | "parts" | "inspection";
type PdfExportModalState =
  | { status: "preparing" | "saving" | "cancelled" | "print" }
  | { status: "success" | "error"; message: string };

const WORK_ORDER_PDF_DIRECTORY_KEY = "vmms.work-order-pdf-directory";

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

type ScheduleDetail = {
  label: string;
  value: string;
};

type WorkOrder = {
  id: string;
  number: string;
  plate: string;
  maintenanceType: string;
  maintenanceClass: "REPAIR" | "PREVENTIVE" | "";
  serviceOdometerReading: number | null;
  mechanic: string;
  assignedMechanicId: string | null;
  chiefMechanicId: string | null;
  dateCreated: string;
  createdAtTimestamp: number;
  startDate: string | null;
  status: WorkOrderStatus;
  priority: "HIGH" | "MEDIUM" | "LOW";
  partsCost: number | null;
  laborCost: number | null;
  totalCost: number | null;
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
  repairReferral: MobileRepairReferral | null;
};

function isRepairReferralStatus(
  value: unknown,
): value is MobileRepairReferral["status"] {
  return (
    value === "QUEUED" ||
    value === "SENT" ||
    value === "FAILED" ||
    value === "ACCEPTED" ||
    value === "REJECTED" ||
    value === "CANCELLED"
  );
}

function parseRepairReferralSnapshot(
  value: string | null | undefined,
): MobileRepairReferral | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const referral = parsed as Record<string, unknown>;
    if (
      typeof referral.id !== "string" ||
      !isRepairReferralStatus(referral.status)
    ) {
      return null;
    }
    const nullableText = (field: unknown) =>
      typeof field === "string" ? field : null;
    return {
      id: referral.id,
      status: referral.status,
      repairTicketId: nullableText(referral.repairTicketId),
      repairTicketNumber: nullableText(referral.repairTicketNumber),
      repairStatus: nullableText(referral.repairStatus),
      outsideShopName: nullableText(referral.outsideShopName),
      outcomeReason: nullableText(referral.outcomeReason),
      lastErrorCode: nullableText(referral.lastErrorCode),
      ...(typeof referral.createdAt === "string"
        ? { createdAt: referral.createdAt }
        : {}),
    };
  } catch {
    return null;
  }
}

function repairReferralStatusLabel(
  status: MobileRepairReferral["status"],
): string {
  switch (status) {
    case "QUEUED":
      return "Waiting to send";
    case "SENT":
      return "Waiting for VRMS Admin";
    case "FAILED":
      return "Couldn't reach VRMS";
    case "ACCEPTED":
      return "Accepted by VRMS";
    case "REJECTED":
      return "Rejected by VRMS";
    case "CANCELLED":
      return "Cancelled by VRMS";
  }
}

function repairReferralSubmissionMessage(
  referral: MobileRepairReferral | null | undefined,
): string {
  if (!referral) {
    return "The review was saved. Referral status will appear after the work order syncs.";
  }
  switch (referral.status) {
    case "QUEUED":
      return "The referral is queued for delivery. VMMS will retry automatically.";
    case "SENT":
      return "The referral was delivered to VRMS and is waiting for their Admin to review it.";
    case "FAILED":
      return "VMMS couldn't reach VRMS. Ask a VMMS Admin to retry the referral.";
    case "ACCEPTED":
      return `VRMS accepted the referral${referral.repairTicketNumber ? ` as ${referral.repairTicketNumber}` : ""}.`;
    case "REJECTED":
      return `VRMS rejected the referral${referral.outcomeReason ? `: ${referral.outcomeReason}` : "."}`;
    case "CANCELLED":
      return `VRMS cancelled the referral${referral.outcomeReason ? `: ${referral.outcomeReason}` : "."}`;
  }
}

function formatRepairStatus(status: string): string {
  return status
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getApiErrorMessage(error: unknown, fallback: string): string {
  const response = typeof error === "object" && error !== null
    ? (error as { response?: { data?: { message?: unknown } } }).response
    : undefined;
  const message = response?.data?.message;
  if (Array.isArray(message)) {
    const messages = message.filter(
      (item): item is string => typeof item === "string",
    );
    if (messages.length) return messages.join("\n");
  }
  if (typeof message === "string" && message.trim()) return message;
  return error instanceof Error ? error.message : fallback;
}

function formatManilaTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-PH", { timeZone: "Asia/Manila" });
}

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
  maintenanceClass?: "REPAIR" | "PREVENTIVE" | "";
  laborCost?: number | null;
  serviceOdometerReading?: number | null;
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
      maintenanceClass: parsed.maintenanceClass === "REPAIR" || parsed.maintenanceClass === "PREVENTIVE"
        ? parsed.maintenanceClass
        : "",
      serviceOdometerReading: typeof parsed.serviceOdometerReading === "number" && Number.isInteger(parsed.serviceOdometerReading)
        ? parsed.serviceOdometerReading
        : undefined,
      laborCost: typeof parsed.laborCost === "number" && Number.isFinite(parsed.laborCost)
        ? parsed.laborCost
        : undefined,
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
  initialSelectedOrderId?: string | null;
  initialDashboardFilter?: DashboardWorkOrderFilter | null;
  onSelectedOrderChange?: (orderId: string | null) => void;
  syncService?: SyncService;
  onLoadingChange?: (loading: boolean) => void;
}

export function WorkOrderScreen({ accessRole, user, initialOrderId, initialSelectedOrderId, initialDashboardFilter, onSelectedOrderChange, syncService, onLoadingChange }: WorkOrderScreenProps) {
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const localSaveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const syncWarningShown = useRef(false);
  const progressRevision = useRef(new Map<string, number>());
  const actionInFlight = useRef(false);
  const [savingAction, setSavingAction] = useState(false);
  const [isExportingPDF, setIsExportingPDF] = useState(false);
  const [pdfExportModal, setPdfExportModal] =
    useState<PdfExportModalState | null>(null);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const searchHistory = useSearchHistory(user.id, "work-orders");
  const [recentSearchesExpanded, setRecentSearchesExpanded] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [openFilterMenu, setOpenFilterMenu] = useState<"status" | "type" | "priority" | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(
    initialDashboardFilter?.status ?? null,
  );
  const [mechanicFilterId, setMechanicFilterId] = useState<string | null>(
    initialDashboardFilter?.mechanicId ?? null,
  );
  const [mechanicFilterName, setMechanicFilterName] = useState<string | null>(
    initialDashboardFilter?.mechanicName ?? null,
  );
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<string | null>(null);
  const [chiefQueueMode, setChiefQueueMode] = useState<"monitoring" | "review" | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(
    initialSelectedOrderId ?? initialOrderId ?? null,
  );
  const [activeStep, setActiveStep] = useState<StepKey>("details");
  const [checklistRequiredError, setChecklistRequiredError] = useState<string | null>(null);
  const detailScrollRef = useRef<ScrollView | null>(null);
  const detailViewportHeightRef = useRef(0);
  const executionDetailCardTopRef = useRef(0);
  const focusedExecutionCardLayoutRef = useRef<{ y: number; height: number } | null>(null);
  const executionCardLayoutsRef = useRef(new Map<string, { y: number; height: number }>());
  const maintenanceRemarksLayoutRef = useRef<{ y: number; height: number } | null>(null);
  const keyboardVisibleRef = useRef(false);
  const [detailViewportHeight, setDetailViewportHeight] = useState(0);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [extensionPanelOpen, setExtensionPanelOpen] = useState(false);
  const [extensionHistory, setExtensionHistory] =
    useState<MaintenanceScheduleExtensionHistory | null>(null);
  const [extensionHistoryLoading, setExtensionHistoryLoading] = useState(false);
  const [extensionHistoryError, setExtensionHistoryError] = useState<string | null>(null);
  const [extensionRequestedDueDate, setExtensionRequestedDueDate] = useState("");
  const [extensionReason, setExtensionReason] = useState("");
  const [extensionSubmitting, setExtensionSubmitting] = useState(false);
  const [extensionSuccessMessage, setExtensionSuccessMessage] = useState<string | null>(null);
  const [activePartSuggestionItemId, setActivePartSuggestionItemId] = useState<string | null>(null);
  const [previewAttachmentUri, setPreviewAttachmentUri] = useState<string | null>(null);
  const [aiAdvisoryLoading, setAiAdvisoryLoading] = useState(false);
  const [aiRecommendations, setAiRecommendations] =
    useState<WorkOrderRecommendationsResponse | null>(null);
  const extensionHistoryRequestId = useRef(0);

  const centerFocusedExecutionCard = useCallback(() => {
    const scroll = detailScrollRef.current;
    const layout = focusedExecutionCardLayoutRef.current;
    const viewportHeight = detailViewportHeightRef.current;
    if (!scroll || !layout || viewportHeight <= 0) return;

    scroll.scrollTo({
      y: Math.max(
        0,
        executionDetailCardTopRef.current + layout.y + (layout.height - viewportHeight) / 2,
      ),
      animated: true,
    });
  }, []);

  const focusExecutionCard = useCallback(
    (layout: { y: number; height: number } | null) => {
      focusedExecutionCardLayoutRef.current = layout;
      if (layout && keyboardVisibleRef.current) {
        requestAnimationFrame(() => centerFocusedExecutionCard());
      }
    },
    [centerFocusedExecutionCard],
  );

  useEffect(() => {
    const keyboardDidShow = Keyboard.addListener("keyboardDidShow", () => {
      keyboardVisibleRef.current = true;
      setKeyboardVisible(true);
      requestAnimationFrame(() => centerFocusedExecutionCard());
    });
    const keyboardDidHide = Keyboard.addListener("keyboardDidHide", () => {
      keyboardVisibleRef.current = false;
      focusedExecutionCardLayoutRef.current = null;
      setKeyboardVisible(false);
    });

    return () => {
      keyboardDidShow.remove();
      keyboardDidHide.remove();
    };
  }, [centerFocusedExecutionCard]);

  const resetExtensionPanel = () => {
    extensionHistoryRequestId.current += 1;
    setExtensionPanelOpen(false);
    setExtensionHistory(null);
    setExtensionHistoryLoading(false);
    setExtensionHistoryError(null);
    setExtensionRequestedDueDate("");
    setExtensionReason("");
    setExtensionSubmitting(false);
    setExtensionSuccessMessage(null);
  };

  const closeOrder = () => {
    resetExtensionPanel();
    setActivePartSuggestionItemId(null);
    setChecklistRequiredError(null);
    setSelectedOrderId(null);
    onSelectedOrderChange?.(null);
  };

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
              maintenanceClass: savedProgress.maintenanceClass ?? "",
              serviceOdometerReading: savedProgress.serviceOdometerReading ?? schedule.odometerReading,
              mechanic: schedule.assignedMechanic || "Unassigned",
              assignedMechanicId: schedule.assignedMechanicId,
              chiefMechanicId: schedule.chiefMechanicId,
              dateCreated: formatReadableDate(schedule.createdAt),
              createdAtTimestamp: Date.parse(schedule.createdAt) || 0,
              startDate: schedule.startDate,
              status: schedule.status === "PENDING"
                ? "Pending"
                : schedule.status === "DUE"
                  ? "Due"
                  : schedule.status === "OVERDUE"
                    ? "Overdue"
                    : schedule.status === "COMPLETED"
                      ? "Completed"
                      : schedule.status === "CANCELLED"
                        ? "Cancelled"
                        : savedProgress.status ?? "In Progress",
              priority: schedule.priority ?? "MEDIUM",
              partsCost: schedule.partsCost,
              laborCost: savedProgress.laborCost ?? schedule.laborCost,
              totalCost: schedule.totalCost,
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
              repairReferral: parseRepairReferralSnapshot(schedule.repairReferral),
              ...submittedReviewState(schedule.status),
            };
          }),
        );

        if (!mounted) return;
        setWorkOrders(converted);
        if (initialOrderId) {
          const target = converted.find(
            (order) =>
              order.id === initialOrderId &&
              canOpenWorkOrder(order, accessRole, user.id),
          );
          if (target) {
            setSelectedOrderId(target.id);
            onSelectedOrderChange?.(target.id);
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
  }, [initialOrderId, syncService, accessRole, user.id, reloadVersion, onLoadingChange, onSelectedOrderChange]);

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
    // The loader updates workOrders, so including it here would rerun the loader
    // after its own update. A new order selection triggers the required reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const partNameSuggestions = useMemo(() => {
    const names = new Set<string>();
    workOrders.forEach((order) => {
      if (order.id === selectedOrderId) return;
      Object.values(order.partDetails).forEach((entry) => {
        const name = entry.partsUsed.trim();
        if (name) names.add(name);
      });
    });
    return [...names].sort((left, right) => left.localeCompare(right));
  }, [selectedOrderId, workOrders]);

  useEffect(() => {
    // Clear recommendations as soon as the selected order changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAiRecommendations(null);
    setAiAdvisoryLoading(false);
  }, [selectedOrderId]);

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
      maintenanceClass: order.maintenanceClass,
      serviceOdometerReading: order.serviceOdometerReading,
      laborCost: order.laborCost,
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
      const repairReferralSnapshot =
        result.repairReferral === undefined
          ? undefined
          : result.repairReferral === null
            ? null
            : JSON.stringify(result.repairReferral);
      const db = await getDatabase();
      if (progressRevision.current.get(order.id) === revision) {
        await new MaintenanceRepository(db).updateWorkOrderProgress(
          order.id,
          JSON.stringify({ ...result.workOrderProgress, _syncPending: false }),
          result.status,
          repairReferralSnapshot,
        );
        if (result.repairReferral !== undefined) {
          setWorkOrders((current) =>
            current.map((item) =>
              item.id === order.id
                ? { ...item, repairReferral: result.repairReferral ?? null }
                : item,
            ),
          );
        }
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
        setActivePartSuggestionItemId(null);
        setActiveStep("execution");
        setChecklistRequiredError(error);
        return;
      }
    }
    if (action === "SUBMIT") {
      const partsError = getChangedPartsSubmissionError(
        selectedOrder.executionItems,
        selectedOrder.partDetails,
      );
      if (partsError) {
        setActivePartSuggestionItemId(null);
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
        repairReferral: result.repairReferral === undefined
          ? order.repairReferral
          : result.repairReferral,
      } : order));
      if (action === "REPAIR") {
        const referral = result.repairReferral;
        Alert.alert(
          referral?.status === "FAILED" ? "Couldn't reach VRMS" : "Repair referral updated",
          repairReferralSubmissionMessage(referral),
        );
      } else if (action !== "START") {
        Alert.alert(action === "SUBMIT" ? "Sent for Chief Mechanic Review" : "Review saved",
          action === "SUBMIT" ? "Your work is Done and awaiting chief mechanic approval." : action === "APPROVE" ? "Work order Completed." : "Work order returned for follow-up.");
      }
      if (action !== "START" && action !== "REPAIR") {
        closeOrder();
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

  const chiefSupervisedOrders = workOrders.filter((order) => order.chiefMechanicId === user.id);
  const chiefReviewOrders = chiefSupervisedOrders.filter((order) => isAwaitingChiefReview(order, user.id));
  const activeChiefQueueMode =
    chiefQueueMode ??
    (initialDashboardFilter
      ? initialDashboardFilter.status === "Awaiting Review" ? "review" : "monitoring"
      : chiefReviewOrders.length > 0 ? "review" : "monitoring");
  const visibleOrders = accessRole === "mechanic"
    ? workOrders.filter((order) => order.assignedMechanicId === user.id)
    : accessRole === "chiefMechanic"
      ? activeChiefQueueMode === "review" ? chiefReviewOrders : chiefSupervisedOrders
      : [];
  const statusOptions = [
    ...new Set([
      ...visibleOrders.map((order) => order.status),
      ...dashboardWorkOrderStatuses,
    ]),
  ].sort();
  const typeOptions = [...new Set(visibleOrders.map((order) => order.maintenanceType))].sort();
  const priorityOptions = ["HIGH", "MEDIUM", "LOW"];
  const filtersActive = Boolean(searchQuery.trim() || statusFilter || mechanicFilterId || typeFilter || priorityFilter);
  const clearFilters = () => {
    setSearchQuery("");
    setStatusFilter(null);
    setMechanicFilterId(null);
    setMechanicFilterName(null);
    setTypeFilter(null);
    setPriorityFilter(null);
  };
  const filteredOrders = sortWorkOrdersForQueue(
    visibleOrders.filter((order) => {
      const query = searchQuery.trim().toLowerCase();
      const matchesQuery =
        order.number.toLowerCase().includes(query) ||
        order.plate.toLowerCase().includes(query) ||
        order.maintenanceType.toLowerCase().includes(query) ||
        order.mechanic.toLowerCase().includes(query) ||
        order.chiefMechanic.toLowerCase().includes(query);

      return matchesQuery && matchesWorkOrderDashboardFilter(order, statusFilter, mechanicFilterId) &&
        (!typeFilter || order.maintenanceType === typeFilter) &&
        (!priorityFilter || order.priority === priorityFilter);
    }),
  );

  const ordersPerPage = 10;
  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / ordersPerPage));
  const pageOrders = filteredOrders.slice((currentPage - 1) * ordersPerPage, currentPage * ordersPerPage);
  const checklistProgress = (order: WorkOrder) => {
    const total = order.executionItems.length;
    const completed = order.executionItems.filter((item) => item.status === "checked" || item.status === "changed").length;
    return { completed, total, percent: total ? Math.round((completed / total) * 100) : 0 };
  };
  useEffect(() => {
    if (!selectedOrderId) return;
    detailScrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [activeStep, selectedOrderId]);

  useEffect(() => {
    // Reset pagination when filters change so results start on the first page.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrentPage(1);
  }, [searchQuery, statusFilter, mechanicFilterId, typeFilter, priorityFilter, accessRole, user.id]);

  useEffect(() => {
    // Clamp the page when filtering reduces the available page count.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  const updateMaintenanceClass = (orderId: string, maintenanceClass: WorkOrder["maintenanceClass"]) => {
    updateWorkOrder(orderId, (order) => ({ ...order, maintenanceClass }));
  };

  const updateLaborCost = (orderId: string, rawValue: string) => {
    const parsed = rawValue.trim() === "" ? null : Number(rawValue);
    updateWorkOrder(orderId, (order) => ({
      ...order,
      laborCost: parsed !== null && Number.isFinite(parsed) && parsed >= 0 ? parsed : null,
    }));
  };

  const updateServiceOdometer = (orderId: string, rawValue: string) => {
    const parsed = rawValue.trim() === "" ? null : Number(rawValue);
    updateWorkOrder(orderId, (order) => ({
      ...order,
      serviceOdometerReading: parsed !== null && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null,
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
      files: { uri: string; name: string; type: string; size?: number }[],
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

  const openOrder = (orderId: string) => {
    resetExtensionPanel();
    setActivePartSuggestionItemId(null);
    setSelectedOrderId(orderId);
    onSelectedOrderChange?.(orderId);
    setActiveStep("details");
  };

  const openSearchedOrder = async (orderId: string) => {
    const historySaved = await searchHistory.recordSearch(searchQuery);
    if (!historySaved) {
      Alert.alert(
        "Search history unavailable",
        "The work order will open, but this search could not be saved.",
      );
    }
    openOrder(orderId);
  };

  const isMechanicRole = accessRole === "mechanic";
  const isChiefMechanicRole = accessRole === "chiefMechanic";

  const loadExtensionHistory = async (scheduleId: string) => {
    const requestId = ++extensionHistoryRequestId.current;
    setExtensionHistoryLoading(true);
    setExtensionHistoryError(null);
    setExtensionSuccessMessage(null);
    try {
      const history = await new AuthService(API_BASE_URL)
        .getMaintenanceScheduleExtensionHistory(scheduleId);
      if (requestId === extensionHistoryRequestId.current) {
        setExtensionHistory(history);
      }
    } catch (error) {
      if (requestId === extensionHistoryRequestId.current) {
        setExtensionHistoryError(
          getApiErrorMessage(error, "Unable to load extension history."),
        );
      }
    } finally {
      if (requestId === extensionHistoryRequestId.current) {
        setExtensionHistoryLoading(false);
      }
    }
  };

  const toggleExtensionPanel = () => {
    if (extensionPanelOpen) {
      setExtensionPanelOpen(false);
      return;
    }
    setExtensionPanelOpen(true);
    if (selectedOrder && !extensionHistory && !extensionHistoryLoading) {
      void loadExtensionHistory(selectedOrder.id);
    }
  };

  const submitExtensionRequest = async () => {
    if (!selectedOrder || !extensionHistory) return;
    const requestedDueDate = extensionRequestedDueDate.trim();
    const reason = extensionReason.trim();
    if (!isLaterDateOnly(requestedDueDate, extensionHistory.currentTargetDueDate)) {
      setExtensionHistoryError("Enter a valid date later than the current target due date.");
      return;
    }
    if (!reason || reason.length > 2000) {
      setExtensionHistoryError("Enter a request reason of 1 to 2000 characters.");
      return;
    }
    if (
      extensionHistory.requests.length >= 2 ||
      extensionHistory.requests.some((request) => request.reviewStatus === "PENDING")
    ) {
      setExtensionHistoryError("This schedule has no extension requests available.");
      return;
    }

    const requestId = extensionHistoryRequestId.current;
    setExtensionSubmitting(true);
    setExtensionHistoryError(null);
    setExtensionSuccessMessage(null);
    try {
      const created: CreatedMaintenanceScheduleExtension =
        await new AuthService(API_BASE_URL).requestMaintenanceScheduleExtension(
          selectedOrder.id,
          { requestedDueDate, reason },
        );
      if (requestId !== extensionHistoryRequestId.current) return;
      const newRequest: MaintenanceScheduleExtensionRequest = {
        ...created,
        reviewedByName: null,
        reviewReason: null,
        reviewedAt: null,
      };
      setExtensionHistory((current) =>
        current
          ? { ...current, requests: [newRequest, ...current.requests] }
          : current,
      );
      setExtensionRequestedDueDate("");
      setExtensionReason("");
      setExtensionSuccessMessage("Request sent for Admin review.");
    } catch (error) {
      if (requestId === extensionHistoryRequestId.current) {
        setExtensionHistoryError(
          getApiErrorMessage(error, "Unable to submit the extension request."),
        );
      }
    } finally {
      if (requestId === extensionHistoryRequestId.current) {
        setExtensionSubmitting(false);
      }
    }
  };
  const canChiefReviewSelectedOrder = Boolean(isChiefMechanicRole && selectedOrder &&
    selectedOrder.chiefMechanicId === user.id && selectedOrder.mechanicSubmitted &&
    isAwaitingChiefReview(selectedOrder, user.id));
  const visibleSteps = [
    { key: "details" as StepKey, label: "Details" },
    ...(isMechanicRole
      ? [
          { key: "execution" as StepKey, label: "Execution" },
          ...(selectedOrder && getChangedExecutionItems(selectedOrder.executionItems).length > 0
            ? [{ key: "parts" as StepKey, label: "Parts, Cost & Photos" }]
            : []),
        ]
      : selectedOrder
        ? [
            { key: "execution" as StepKey, label: "Mechanic Progress" },
            ...(canChiefReviewSelectedOrder
              ? [{ key: "inspection" as StepKey, label: "Inspection Checklist" }]
              : []),
          ]
        : []),
  ];

  const exportPDF = async () => {
    if (!selectedOrder || isExportingPDF) return;
    setIsExportingPDF(true);
    setPdfExportModal({ status: "preparing" });
    try {
      const html = buildWorkOrderPdfHtml({
        number: selectedOrder.number,
        plate: selectedOrder.plate,
        maintenanceType: selectedOrder.maintenanceType,
        maintenanceClass: selectedOrder.maintenanceClass,
        status: selectedOrder.status,
        mechanic: selectedOrder.mechanic,
        template: selectedOrder.template,
        dateCreated: selectedOrder.dateCreated,
        startDate: selectedOrder.startDate
          ? formatReadableDate(selectedOrder.startDate)
          : null,
        serviceOdometerReading: selectedOrder.serviceOdometerReading,
        summary: selectedOrder.summary,
        scheduleDetails: selectedOrder.scheduleDetails,
        maintenanceRemarks: selectedOrder.maintenanceRemarks,
        rejectionRemarks: isMechanicRole ? selectedOrder.rejectionRemarks : "",
        executionItems: selectedOrder.executionItems,
        partDetails: selectedOrder.partDetails,
      });

      if (Platform.OS === "web") {
        await Print.printAsync({ html });
        setPdfExportModal({ status: "print" });
        return;
      }

      const { base64, uri: generatedPdfUri } = await Print.printToFileAsync({
        html,
        base64: true,
      });
      if (!base64) {
        throw new Error("The work-order PDF could not be read after it was generated.");
      }

      const safeOrderNumber =
        selectedOrder.number.replace(/[^a-z0-9_-]/gi, "-") || "export";
      const generatedPdfId = new File(generatedPdfUri).name.replace(
        /\.pdf$/i,
        "",
      );
      const fileName = `work-order-${safeOrderNumber}-${generatedPdfId}.pdf`;
      setPdfExportModal({ status: "saving" });

      if (Platform.OS === "android") {
        const storage = FileSystemLegacy.StorageAccessFramework;
        const saveToDirectory = async (directoryUri: string) => {
          const fileUri = await storage.createFileAsync(
            directoryUri,
            fileName.replace(/\.pdf$/i, ""),
            "application/pdf",
          );
          await storage.writeAsStringAsync(fileUri, base64, {
            encoding: FileSystemLegacy.EncodingType.Base64,
          });
        };

        let directoryUri = await SecureStore.getItemAsync(
          WORK_ORDER_PDF_DIRECTORY_KEY,
        );
        if (directoryUri) {
          try {
            await saveToDirectory(directoryUri);
          } catch (error) {
            console.warn(
              "[WorkOrderScreen] Saved PDF folder is no longer available; requesting access again",
              error,
            );
            await SecureStore.deleteItemAsync(WORK_ORDER_PDF_DIRECTORY_KEY);
            directoryUri = null;
          }
        }

        if (!directoryUri) {
          const permission =
            await storage.requestDirectoryPermissionsAsync(
              storage.getUriForDirectoryInRoot("Download"),
            );
          if (!permission.granted) {
              setPdfExportModal({ status: "cancelled" });
            return;
          }

          directoryUri = permission.directoryUri;
          await SecureStore.setItemAsync(
            WORK_ORDER_PDF_DIRECTORY_KEY,
            directoryUri,
          );
          await saveToDirectory(directoryUri);
        }
      } else {
        const savedPdf = new File(Paths.document, fileName);
        savedPdf.create({ intermediates: true });
        savedPdf.write(base64, { encoding: "base64" });
        if (!savedPdf.exists || savedPdf.size === 0) {
          throw new Error("The work-order PDF was not saved to device storage.");
        }
      }

      setPdfExportModal({
        status: "success",
        message:
          Platform.OS === "android"
            ? `Work order ${selectedOrder.number} was saved to the selected folder. Details and Execution are included.`
            : `Work order ${selectedOrder.number} was saved to this app's Documents folder, available in the Files app. Details and Execution are included.`,
      });
    } catch (error) {
      console.error("[WorkOrderScreen] Failed to export work-order PDF", error);
      setPdfExportModal({
        status: "error",
        message: getApiErrorMessage(
          error,
          "The work-order PDF could not be created. Please try again.",
        ),
      });
    } finally {
      setIsExportingPDF(false);
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
      case "Cancelled":
        return styles.statusCompleted;
      case "In Progress":
        return styles.statusInProgress;
      case "Due":
        return styles.statusDue;
      case "For Verification":
      case "Done":
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

  const statusTextColor = (status: WorkOrderStatus) => {
    switch (status) {
      case "Due":
        return workOrderStatusTextColors.due;
      case "In Progress":
        return workOrderStatusTextColors.inProgress;
      case "For Verification":
      case "Done":
        return workOrderStatusTextColors.verification;
      case "Rejected":
        return workOrderStatusTextColors.rejected;
      case "For Repair":
        return workOrderStatusTextColors.repair;
      case "Overdue":
        return workOrderStatusTextColors.overdue;
      case "Completed":
      case "Cancelled":
        return workOrderStatusTextColors.completed;
      default:
        return workOrderStatusTextColors.pending;
    }
  };

  const renderStatusBadge = (status: WorkOrderStatus) => (
    <View style={[styles.statusBadge, statusStyle(status)]}>
      <Text style={[styles.statusBadgeText, { color: statusTextColor(status) }]}>{status}</Text>
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
  ): { title: string; items: string[] }[] => {
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
    const canManuallyStart = ["Pending", "Due", "Overdue", "Rejected"].includes(selectedOrder.status) &&
      !selectedOrder.mechanicSubmitted;
    const startDateReached = isWorkOrderStartDateReached(selectedOrder.startDate);
    const mechanicOrderLocked =
      isMechanicRole &&
      (selectedOrder.status === "Cancelled" || (
        (selectedOrder.mechanicSubmitted ||
          selectedOrder.approvalStatus === "Verified" ||
          selectedOrder.status !== "In Progress") &&
        selectedOrder.approvalStatus !== "Rejected"
      ));
    const executionReadOnly = isChiefMechanicRole || mechanicOrderLocked;
    const recordedParts = getChangedExecutionItems(selectedOrder.executionItems).flatMap((item) => {
      const entry = selectedOrder.partDetails[item.id];
      return (typeof entry?.partsUsed === "string" && entry.partsUsed.trim()) || entry?.attachments?.length
        ? [{ item, entry }]
        : [];
    });
    const isAssignedMechanic =
      isMechanicRole && selectedOrder.assignedMechanicId === user.id;
    const canRequestExtension = isAssignedMechanic && (
      selectedOrder.status === "In Progress" ||
      (selectedOrder.status === "Overdue" &&
        wasInProgressBeforeOverdue(selectedOrder.workOrderProgress))
    );
    const hasPendingExtension = extensionHistory?.requests.some(
      (request) => request.reviewStatus === "PENDING",
    ) ?? false;
    const extensionLimitReached = (extensionHistory?.requests.length ?? 0) >= 2;
    const extensionDateValid = Boolean(
      extensionHistory?.currentTargetDueDate &&
        isLaterDateOnly(
          extensionRequestedDueDate.trim(),
          extensionHistory.currentTargetDueDate,
        ),
    );
    const canSubmitExtension = Boolean(
      canRequestExtension &&
        extensionHistory?.currentTargetDueDate &&
        !hasPendingExtension &&
        !extensionLimitReached &&
        extensionDateValid &&
        extensionReason.trim().length > 0 &&
        !extensionSubmitting,
    );
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <Modal
          visible={checklistRequiredError !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setChecklistRequiredError(null)}
        >
          <View style={styles.checklistRequiredBackdrop}>
            <View style={styles.checklistRequiredCard} accessibilityViewIsModal>
              <View style={styles.checklistRequiredHeader}>
                <View style={styles.checklistRequiredIcon}>
                  <Svg width={28} height={28} viewBox="0 0 24 24" fill="none">
                    <Path
                      d="M12 3.25 2.55 19.5h18.9L12 3.25Z"
                      stroke="#1a1f6e"
                      strokeWidth={1.8}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <Path
                      d="M12 9v4.25M12 16.25h.01"
                      stroke="#1a1f6e"
                      strokeWidth={1.8}
                      strokeLinecap="round"
                    />
                  </Svg>
                </View>
                <Text style={styles.checklistRequiredTitle} accessibilityRole="header">
                  Assigned checklist required
                </Text>
              </View>
              <ScrollView
                style={styles.checklistRequiredBody}
                contentContainerStyle={styles.checklistRequiredBodyContent}
                showsVerticalScrollIndicator
              >
                <Text style={styles.checklistRequiredMessage}>
                  {checklistRequiredError?.split("\n")[0]}
                </Text>
                {checklistRequiredError
                  ?.split("\n")
                  .slice(1)
                  .filter((line) => line.startsWith("- "))
                  .map((line, index) => (
                    <View key={`${index}-${line}`} style={styles.checklistRequiredItem}>
                      <View style={styles.checklistRequiredBullet} />
                      <Text style={styles.checklistRequiredItemText}>{line.slice(2)}</Text>
                    </View>
                  ))}
                <View style={styles.checklistRequiredGuidance}>
                  <Text style={styles.checklistRequiredGuidanceText}>
                    Ask Operations to assign or refresh the checklist before starting maintenance.
                  </Text>
                </View>
              </ScrollView>
              <TouchableOpacity
                style={styles.checklistRequiredButton}
                onPress={() => setChecklistRequiredError(null)}
                accessibilityRole="button"
                accessibilityLabel="Acknowledge assigned checklist requirement"
              >
                <Text style={styles.checklistRequiredButtonText}>Got it</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
        <Modal
          visible={pdfExportModal !== null}
          transparent
          animationType="fade"
          statusBarTranslucent
          onRequestClose={() => {
            if (!isExportingPDF) setPdfExportModal(null);
          }}
        >
          {pdfExportModal ? (
            <View style={styles.pdfExportBackdrop}>
              <View style={styles.pdfExportCard} accessibilityViewIsModal>
                <View
                  style={[
                    styles.pdfExportStatusIcon,
                    pdfExportModal.status === "success"
                      ? styles.pdfExportSuccessIcon
                      : pdfExportModal.status === "error"
                        ? styles.pdfExportErrorIcon
                        : pdfExportModal.status === "cancelled"
                          ? styles.pdfExportCancelledIcon
                          : styles.pdfExportInfoIcon,
                  ]}
                >
                  {pdfExportModal.status === "preparing" ||
                  pdfExportModal.status === "saving" ? (
                    <ActivityIndicator
                      size="large"
                      color="#1a1f6e"
                      accessibilityLabel={
                        pdfExportModal.status === "preparing"
                          ? "Preparing PDF"
                          : "Saving PDF"
                      }
                    />
                  ) : (
                    <Svg width={28} height={28} viewBox="0 0 24 24" fill="none">
                      <Path
                        d={
                          pdfExportModal.status === "success"
                            ? "m5 12.5 4.5 4.25L19 7"
                            : pdfExportModal.status === "error"
                              ? "M12 8v5m0 3h.01"
                              : pdfExportModal.status === "cancelled"
                                ? "m7 7 10 10M17 7 7 17"
                                : "M7 3h7l4 4v14H7zM14 3v5h5M9 13h6M9 16h6"
                        }
                        stroke={
                          pdfExportModal.status === "success"
                            ? "#16804a"
                            : pdfExportModal.status === "error"
                              ? "#b42318"
                              : pdfExportModal.status === "cancelled"
                                ? "#9a6700"
                                : "#1a1f6e"
                        }
                        strokeWidth={1.8}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </Svg>
                  )}
                </View>
                <Text style={styles.pdfExportTitle} accessibilityRole="header">
                  {pdfExportModal.status === "preparing"
                    ? "Preparing your PDF"
                    : pdfExportModal.status === "saving"
                      ? "Saving your PDF"
                      : pdfExportModal.status === "success"
                        ? "PDF downloaded"
                        : pdfExportModal.status === "cancelled"
                          ? "Download cancelled"
                          : pdfExportModal.status === "print"
                            ? "Print dialog opened"
                            : "PDF export failed"}
                </Text>
                <Text
                  style={styles.pdfExportMessage}
                  accessibilityLiveRegion={
                    isExportingPDF ? "polite" : "assertive"
                  }
                >
                  {pdfExportModal.status === "preparing"
                    ? "Combining work-order details and execution checklist."
                    : pdfExportModal.status === "saving"
                      ? "Saving the completed PDF to your device."
                      : pdfExportModal.status === "success" ||
                          pdfExportModal.status === "error"
                        ? pdfExportModal.message
                        : pdfExportModal.status === "cancelled"
                          ? "No PDF was saved. You can try again and choose a destination folder."
                          : "Choose Save as PDF in the print dialog to finish saving the work order."}
                </Text>
                {!isExportingPDF ? (
                  <TouchableOpacity
                    style={styles.pdfExportButton}
                    onPress={() => setPdfExportModal(null)}
                    accessibilityRole="button"
                    accessibilityLabel="Close PDF export message"
                  >
                    <Text style={styles.pdfExportButtonText}>Done</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          ) : null}
        </Modal>
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
            onPress={closeOrder}
          >
            <Text style={styles.backButtonText}>‹ Back to Assigned Orders</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.exportButton}
            onPress={() => void exportPDF()}
            disabled={isExportingPDF}
            accessibilityRole="button"
            accessibilityLabel="Export work order details and execution to PDF"
            accessibilityState={{ busy: isExportingPDF, disabled: isExportingPDF }}
          >
            <View style={styles.exportButtonContent}>
              {isExportingPDF ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                  <Path
                    d="M12 3v11m0 0 4-4m-4 4-4-4M5 17v3h14v-3"
                    stroke="#ffffff"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </Svg>
              )}
              <Text style={styles.exportButtonText}>
                {isExportingPDF ? "Preparing PDF..." : "Export to PDF"}
              </Text>
            </View>
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
              onPress={() => {
                setActivePartSuggestionItemId(null);
                setActiveStep(item.key);
              }}
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
          ref={detailScrollRef}
          style={styles.detailScroll}
          contentContainerStyle={[
            styles.detailContent,
            activeStep === "execution" &&
              keyboardVisible && {
                paddingBottom: Math.max(16, detailViewportHeight / 2),
              },
          ]}
          onLayout={(event) => {
            const height = event.nativeEvent.layout.height;
            detailViewportHeightRef.current = height;
            setDetailViewportHeight(height);
            if (keyboardVisibleRef.current && focusedExecutionCardLayoutRef.current) {
              requestAnimationFrame(() => centerFocusedExecutionCard());
            }
          }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          refreshControl={<RefreshControl refreshing={pullRefreshing} onRefresh={refreshWorkOrders} colors={["#1a1f6e", "#d4a93f"]} tintColor="#1a1f6e" progressBackgroundColor="#ffffff" />}
        >
          {/* Step 1: Details */}
          {activeStep === "details" && (
            <>
              {renderAiAdvisoryCard()}
              {/* Maintenance Schedule Details */}
              <View style={styles.detailCard}>
                <View style={styles.detailStatusRow}>
                  <Text style={styles.sectionTitle}>Maintenance Schedule Details</Text>
                  {renderStatusBadge(selectedOrder.status)}
                </View>
                <Text style={styles.sectionText}>
                  Details from the maintenance schedule.
                </Text>
                <View style={styles.remarksSection}>
                  <Text style={styles.remarksLabel}>Maintenance Type *</Text>
                  <Text style={styles.sectionText}>Classify this work as Repair or Preventive.</Text>
                  <View style={styles.pillButtonRow}>
                    {([
                      { value: "REPAIR" as const, label: "Repair" },
                      { value: "PREVENTIVE" as const, label: "Preventive" },
                    ]).map((option) => (
                      <TouchableOpacity
                        key={option.value}
                        disabled={!isMechanicRole || selectedOrder.mechanicSubmitted || mechanicOrderLocked}
                        style={[styles.pillButton, selectedOrder.maintenanceClass === option.value && { backgroundColor: "#1a1f6e" }]}
                        onPress={() => updateMaintenanceClass(selectedOrder.id, option.value)}
                      >
                        <Text style={[styles.pillButtonText, selectedOrder.maintenanceClass === option.value && styles.pillButtonTextActive]}>{option.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
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
                <View style={styles.remarksSection}>
                  <Text style={styles.remarksLabel}>Odometer at Time of Service (km) *</Text>
                  <TextInput
                    style={styles.partsInput}
                    editable={isMechanicRole && !selectedOrder.mechanicSubmitted && !mechanicOrderLocked}
                    keyboardType="number-pad"
                    placeholder="Enter current odometer reading"
                    placeholderTextColor="#94a3b8"
                    value={selectedOrder.serviceOdometerReading == null ? "" : String(selectedOrder.serviceOdometerReading)}
                    onChangeText={(text) => updateServiceOdometer(selectedOrder.id, text)}
                  />
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
                {selectedOrder.repairReferral ? (
                  <View
                    style={[
                      styles.remarksSection,
                      {
                        backgroundColor: "#f8fafc",
                        borderWidth: 1,
                        borderColor: "#e2e8f0",
                        borderRadius: 10,
                        paddingHorizontal: 12,
                      },
                    ]}
                  >
                    <Text style={styles.remarksLabel}>VRMS Repair Handoff</Text>
                    <Text style={styles.sectionText}>
                      Referral:{" "}
                      {repairReferralStatusLabel(selectedOrder.repairReferral.status)}
                    </Text>
                    {selectedOrder.repairReferral.repairTicketNumber ? (
                      <Text style={styles.sectionText}>
                        Repair ticket: {selectedOrder.repairReferral.repairTicketNumber}
                      </Text>
                    ) : null}
                    {selectedOrder.repairReferral.repairStatus ? (
                      <Text style={styles.sectionText}>
                        Repair status:{" "}
                        {formatRepairStatus(selectedOrder.repairReferral.repairStatus)}
                      </Text>
                    ) : null}
                    {selectedOrder.repairReferral.outsideShopName ? (
                      <Text style={styles.sectionText}>
                        Outside shop: {selectedOrder.repairReferral.outsideShopName}
                      </Text>
                    ) : null}
                    {selectedOrder.repairReferral.outcomeReason ? (
                      <Text style={styles.sectionText}>
                        {selectedOrder.repairReferral.status === "REJECTED"
                          ? "VRMS rejection reason"
                          : "VRMS update"}: {selectedOrder.repairReferral.outcomeReason}
                      </Text>
                    ) : null}
                  </View>
                ) : selectedOrder.approvalStatus === "For Repair" ? (
                  <View
                    style={[
                      styles.remarksSection,
                      {
                        backgroundColor: "#f8fafc",
                        borderWidth: 1,
                        borderColor: "#e2e8f0",
                        borderRadius: 10,
                        paddingHorizontal: 12,
                      },
                    ]}
                  >
                    <Text style={styles.remarksLabel}>VRMS Repair Handoff</Text>
                    <Text style={styles.sectionText}>
                      Referral status is not available yet. Refresh the work order after syncing.
                    </Text>
                  </View>
                ) : null}

                {isAssignedMechanic ? (
                  <View style={styles.extensionSection}>
                    <View style={styles.extensionHeader}>
                      <View style={styles.extensionHeading}>
                        <Text style={styles.sectionTitle}>Schedule extension</Text>
                        <Text style={styles.sectionText}>
                          Request a due-date change for Admin review and track decisions here.
                        </Text>
                      </View>
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityState={{ expanded: extensionPanelOpen }}
                        onPress={toggleExtensionPanel}
                        style={styles.extensionToggle}
                      >
                        <Text style={styles.extensionToggleText}>
                          {extensionPanelOpen ? "Hide history" : "Request / history"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                    {extensionPanelOpen ? (
                      <View style={styles.extensionContent}>
                        {extensionHistoryLoading ? (
                          <ActivityIndicator
                            accessible
                            accessibilityLabel="Loading schedule extension history"
                            accessibilityRole="progressbar"
                            color="#1a1f6e"
                          />
                        ) : null}
                        {extensionHistoryError ? (
                          <View style={styles.extensionErrorBlock}>
                            <Text accessibilityRole="alert" style={styles.extensionError}>
                              {extensionHistoryError}
                            </Text>
                            {!extensionHistory ? (
                              <TouchableOpacity
                                accessibilityRole="button"
                                onPress={() => void loadExtensionHistory(selectedOrder.id)}
                                style={styles.extensionRetry}
                              >
                                <Text style={styles.extensionRetryText}>Retry</Text>
                              </TouchableOpacity>
                            ) : null}
                          </View>
                        ) : null}
                        {extensionSuccessMessage ? (
                          <Text style={styles.extensionSuccess}>{extensionSuccessMessage}</Text>
                        ) : null}
                        {extensionHistory ? (
                          <>
                            <Text style={styles.extensionCurrentDate}>
                              Current target due date: {extensionHistory.currentTargetDueDate ?? "Not recorded"}
                            </Text>
                            <TouchableOpacity
                              accessibilityRole="button"
                              disabled={extensionHistoryLoading || extensionSubmitting}
                              onPress={() => void loadExtensionHistory(selectedOrder.id)}
                              style={styles.extensionRetry}
                            >
                              <Text style={styles.extensionRetryText}>Refresh extension history</Text>
                            </TouchableOpacity>
                            {canRequestExtension && !extensionHistory.currentTargetDueDate ? (
                              <Text style={styles.extensionHint}>
                                This schedule has no recorded target due date. Ask Operations to update the schedule before requesting an extension.
                              </Text>
                            ) : null}
                            {canRequestExtension &&
                            extensionHistory.currentTargetDueDate &&
                            !hasPendingExtension &&
                            !extensionLimitReached ? (
                              <View style={styles.extensionForm}>
                                <Text style={styles.remarksLabel}>Proposed target due date</Text>
                                <TextInput
                                  accessibilityLabel="Proposed target due date"
                                  style={styles.partsInput}
                                  value={extensionRequestedDueDate}
                                  onChangeText={(value) => {
                                    setExtensionRequestedDueDate(value);
                                    setExtensionHistoryError(null);
                                    setExtensionSuccessMessage(null);
                                  }}
                                  placeholder="YYYY-MM-DD"
                                  placeholderTextColor="#64748b"
                                  autoCapitalize="none"
                                  keyboardType="numbers-and-punctuation"
                                  maxLength={10}
                                />
                                {extensionRequestedDueDate.trim() &&
                                !isValidDateOnly(extensionRequestedDueDate.trim()) ? (
                                  <Text style={styles.extensionFieldError}>
                                    Enter a real date in YYYY-MM-DD format.
                                  </Text>
                                ) : extensionRequestedDueDate.trim() &&
                                  !extensionDateValid ? (
                                  <Text style={styles.extensionFieldError}>
                                    The proposed date must be later than {extensionHistory.currentTargetDueDate}.
                                  </Text>
                                ) : null}
                                <Text style={styles.remarksLabel}>Reason for extension</Text>
                                <TextInput
                                  accessibilityLabel="Reason for extension"
                                  style={styles.extensionReasonInput}
                                  value={extensionReason}
                                  onChangeText={(value) => {
                                    setExtensionReason(value);
                                    setExtensionHistoryError(null);
                                    setExtensionSuccessMessage(null);
                                  }}
                                  placeholder="Explain why the schedule needs more time"
                                  placeholderTextColor="#64748b"
                                  multiline
                                  maxLength={2000}
                                />
                                {!extensionReason.trim() ? (
                                  <Text style={styles.extensionFieldError}>
                                    A reason is required.
                                  </Text>
                                ) : null}
                                <Text style={styles.extensionHint}>
                                  {2 - extensionHistory.requests.length} request(s) remaining. A request does not change the due date until Admin approval.
                                </Text>
                                <TouchableOpacity
                                  accessibilityRole="button"
                                  accessibilityState={{ disabled: !canSubmitExtension }}
                                  disabled={!canSubmitExtension}
                                  onPress={() => void submitExtensionRequest()}
                                  style={[
                                    styles.extensionSubmit,
                                    !canSubmitExtension && styles.extensionSubmitDisabled,
                                  ]}
                                >
                                  <Text style={styles.extensionSubmitText}>
                                    {extensionSubmitting ? "Sending request..." : "Send extension request"}
                                  </Text>
                                </TouchableOpacity>
                              </View>
                            ) : null}
                            {canRequestExtension && hasPendingExtension ? (
                              <Text style={styles.extensionHint}>
                                An extension request is already awaiting Admin review.
                              </Text>
                            ) : null}
                            {canRequestExtension && extensionLimitReached ? (
                              <Text style={styles.extensionHint}>
                                This schedule has reached the two-request limit.
                              </Text>
                            ) : null}
                            {!canRequestExtension ? (
                              <Text style={styles.extensionHint}>
                                Requests are available while work is in progress. Overdue work must have been in progress before it became overdue.
                              </Text>
                            ) : null}
                            <View style={styles.extensionHistory}>
                              <Text style={styles.remarksLabel}>Request history</Text>
                              {extensionHistory.requests.length === 0 ? (
                                <Text style={styles.sectionText}>No extension requests yet.</Text>
                              ) : extensionHistory.requests.map((request) => (
                                <View key={request.id} style={styles.extensionHistoryItem}>
                                  <View style={styles.extensionHistoryHeader}>
                                    <Text style={styles.extensionHistoryStatus}>
                                      {request.reviewStatus}
                                    </Text>
                                    <Text style={styles.extensionHistoryDate}>
                                      {request.requestedDueDate}
                                    </Text>
                                  </View>
                                  <Text style={styles.extensionHistoryBody}>
                                    Requested {formatManilaTimestamp(request.requestedAt)} by {request.actorName}
                                  </Text>
                                  <Text style={styles.extensionHistoryBody}>{request.reason}</Text>
                                  {request.reviewedAt ? (
                                    <Text style={styles.extensionHistoryBody}>
                                      Reviewed {formatManilaTimestamp(request.reviewedAt)}
                                      {request.reviewedByName ? ` by ${request.reviewedByName}` : ""}
                                    </Text>
                                  ) : null}
                                  {request.reviewReason ? (
                                    <Text style={styles.extensionHistoryBody}>
                                      Review reason: {request.reviewReason}
                                    </Text>
                                  ) : null}
                                </View>
                              ))}
                            </View>
                          </>
                        ) : null}
                      </View>
                    ) : null}
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
            <View
              style={styles.detailCard}
              onLayout={(event) => {
                executionDetailCardTopRef.current = event.nativeEvent.layout.y;
                if (keyboardVisibleRef.current && focusedExecutionCardLayoutRef.current) {
                  requestAnimationFrame(() => centerFocusedExecutionCard());
                }
              }}
            >
              <Text style={styles.sectionTitle}>Execution Checklist</Text>
              <Text style={styles.sectionText}>
                {isChiefMechanicRole
                  ? "Read-only view of the Mechanic's checklist progress. Checked and Changed items count as complete."
                  : "Mark each item as Checked, Changed, or Not Checked and capture notes."}
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
                    <View
                      key={item.id}
                      style={styles.checklistItemCard}
                      onLayout={(event) => {
                        const { y, height } = event.nativeEvent.layout;
                        executionCardLayoutsRef.current.set(item.id, { y, height });
                      }}
                    >
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
                            disabled={executionReadOnly}
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
                        editable={!executionReadOnly}
                        placeholder="Add note"
                        placeholderTextColor="#94a3b8"
                        value={item.note}
                        onFocus={() =>
                          focusExecutionCard(executionCardLayoutsRef.current.get(item.id) ?? null)
                        }
                        onChangeText={(text) =>
                          updateExecutionNote(selectedOrder.id, item.id, text)
                        }
                      />
                    </View>
                  );
                })
              )}

              <View
                style={styles.remarksSection}
                onLayout={(event) => {
                  const { y, height } = event.nativeEvent.layout;
                  maintenanceRemarksLayoutRef.current = { y, height };
                }}
              >
                <Text style={styles.remarksLabel}>Maintenance Work Remarks</Text>
                <Text style={styles.sectionText}>Describe the maintenance work performed and any additional information about this activity.</Text>
                <TextInput
                  style={styles.remarksInput}
                  editable={!executionReadOnly}
                  placeholder="Describe the work performed"
                  placeholderTextColor="#94a3b8"
                  multiline
                  value={selectedOrder.maintenanceRemarks}
                  onFocus={() => focusExecutionCard(maintenanceRemarksLayoutRef.current)}
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
                Record parts used against changed checklist items. Existing names are suggested, but any new part name is allowed.
              </Text>
              <View style={styles.remarksSection}>
                <Text style={styles.remarksLabel}>Labor Cost (₱) *</Text>
                <TextInput
                  style={styles.partsInput}
                  editable={isMechanicRole && !selectedOrder.mechanicSubmitted && !mechanicOrderLocked}
                  keyboardType="decimal-pad"
                  placeholder="Enter labor cost"
                  placeholderTextColor="#94a3b8"
                  value={selectedOrder.laborCost == null ? "" : String(selectedOrder.laborCost)}
                  onChangeText={(text) => updateLaborCost(selectedOrder.id, text)}
                />
                <Text style={styles.sectionText}>
                  Total maintenance cost is computed from itemized parts and labor when submitted.
                </Text>
              </View>

              {getChangedExecutionItems(selectedOrder.executionItems).map((item) => {
                const partEntry = selectedOrder.partDetails[item.id] ?? {
                  partsUsed: "",
                  quantity: "",
                  materialCost: "",
                  attachments: [],
                  attachmentName: "",
                };
                const partsQuery = partEntry.partsUsed.trim().toLowerCase();
                const suggestions = partsQuery
                  ? partNameSuggestions
                    .filter((name) => name.toLowerCase().includes(partsQuery))
                    .slice(0, 5)
                  : [];

                return (
                  <View key={item.id} style={styles.partsItemCard}>
                    <Text style={styles.partsItemTitle}>{item.label}</Text>
                    <View style={styles.partsItemRow}>
                      <View style={styles.partsItemColumn}>
                        <Text style={styles.partsLabel}>Parts Used</Text>
                        <TextInput
                          accessibilityLabel={`Parts used for ${item.label}`}
                          style={styles.partsInput}
                          editable={!executionReadOnly}
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
                          onFocus={() => setActivePartSuggestionItemId(item.id)}
                        />
                              {activePartSuggestionItemId === item.id &&
                              !executionReadOnly &&
                              partsQuery ? (
                                <View style={styles.partsSuggestions}>
                                  {suggestions.length ? suggestions.map((name) => (
                                    <Pressable
                                      key={name}
                                      accessibilityRole="button"
                                      accessibilityLabel={`Use part name ${name}`}
                                      onPress={() => {
                                        updatePartDetailField(
                                          selectedOrder.id,
                                          item.id,
                                          "partsUsed",
                                          name,
                                        );
                                        setActivePartSuggestionItemId(null);
                                      }}
                                      style={styles.partsSuggestion}
                                    >
                                      <Text style={styles.partsSuggestionText}>{name}</Text>
                                    </Pressable>
                                  )) : (
                                    <Text style={styles.partsSuggestionEmpty}>
                                      No matching prior names. You can enter a new part name.
                                    </Text>
                                  )}
                                </View>
                              ) : null}
                      </View>
                      <View style={styles.partsItemColumn}>
                        <Text style={styles.partsLabel}>
                          Number of Materials Used
                        </Text>
                        <TextInput
                          style={styles.partsInput}
                          editable={!executionReadOnly}
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
                          onFocus={() => setActivePartSuggestionItemId(null)}
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
                          editable={!executionReadOnly}
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
                          onFocus={() => setActivePartSuggestionItemId(null)}
                          placeholder="0.00"
                          placeholderTextColor="#94a3b8"
                        />
                      </View>
                    </View>
                    <Text style={styles.partsLabel}>Photos / Attachments</Text>
                    <TouchableOpacity
                      style={styles.uploadButton}
                      disabled={executionReadOnly}
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

            </View>
          )}

          {/* Chief mechanic inspection */}
          {activeStep === "inspection" && isChiefMechanicRole && (
            <View style={styles.detailCard}>
              <Text style={styles.sectionTitle}>Inspection Checklist</Text>
              <Text style={styles.sectionText}>
                Verify the execution submitted by {selectedOrder.mechanic}.
              </Text>
              {canChiefReviewSelectedOrder ? (
                <View style={styles.costSummaryRow} accessibilityLabel="Maintenance cost summary">
                  {[
                    { label: "Parts Cost", value: selectedOrder.partsCost },
                    { label: "Labor Cost", value: selectedOrder.laborCost },
                    { label: "Total Maintenance Cost", value: selectedOrder.totalCost },
                  ].map((cost) => (
                    <View key={cost.label} style={styles.costCard}>
                      <Text style={styles.costLabel}>{cost.label}</Text>
                      <Text style={styles.costValue}>
                        {cost.value == null ? "Not recorded" : `₱${cost.value.toFixed(2)}`}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
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
              setActivePartSuggestionItemId(null);
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
              setActivePartSuggestionItemId(null);
              setActiveStep(nextStep.key);
            }}
          >
            <Text style={styles.bottomButtonPrimaryText}>Next</Text>
          </TouchableOpacity>
          {(!isChiefMechanicRole || (canChiefReviewSelectedOrder && activeStep === "inspection")) ? <TouchableOpacity
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
                if (["Pending", "Due", "Overdue", "Rejected"].includes(selectedOrder.status) && !selectedOrder.mechanicSubmitted) void performWorkflowAction("START");
                else handleCompleteOrder();
              } else handleInspectionAction();
            }}
            disabled={savingAction || selectedOrder.status === "Completed" || selectedOrder.status === "Cancelled" ||
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
                    : ["Pending", "Due", "Overdue", "Rejected"].includes(selectedOrder.status)
                      ? "Start Work"
                      : "Mark Done & Submit"
                : getInspectionActionLabel(getAutomaticInspectionRemark(selectedOrder.inspectionItems))}
            </Text>
          </TouchableOpacity>
          : null}
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <ScrollView
      style={styles.listPageScroll}
      contentContainerStyle={styles.listPageContent}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
      refreshControl={<RefreshControl refreshing={pullRefreshing} onRefresh={refreshWorkOrders} colors={["#1a1f6e", "#d4a93f"]} tintColor="#1a1f6e" progressBackgroundColor="#ffffff" />}
    >
      <View style={styles.pageHeader}>
        <MobilePageHeader
          title="Work Orders"
          subtitle={isChiefMechanicRole
            ? "Review mechanic submissions and monitor supervised work"
            : "Your assigned work orders grouped by mechanic"}
        />
      </View>
      {!isChiefMechanicRole ? <MaintenanceStatusLegend /> : null}

      {isChiefMechanicRole ? (
        <View style={styles.chiefQueueToggle}>
          <TouchableOpacity
            style={[styles.chiefQueueTab, activeChiefQueueMode === "review" && styles.chiefQueueTabActive]}
            onPress={() => { setChiefQueueMode("review"); setCurrentPage(1); }}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeChiefQueueMode === "review" }}
            accessibilityLabel={`Needs review, ${chiefReviewOrders.length} submissions`}
          >
            <Text style={[styles.chiefQueueTabText, activeChiefQueueMode === "review" && styles.chiefQueueTabTextActive]}>
              Needs review ({chiefReviewOrders.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.chiefQueueTab, activeChiefQueueMode === "monitoring" && styles.chiefQueueTabActive]}
            onPress={() => { setChiefQueueMode("monitoring"); setCurrentPage(1); }}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeChiefQueueMode === "monitoring" }}
            accessibilityLabel={`All supervised, ${chiefSupervisedOrders.length} work orders`}
          >
            <Text style={[styles.chiefQueueTabText, activeChiefQueueMode === "monitoring" && styles.chiefQueueTabTextActive]}>
              All supervised ({chiefSupervisedOrders.length})
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={styles.searchRow}>
        <View style={styles.searchInputWrap}>
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={() => void searchHistory.recordSearch(searchQuery)}
            accessibilityLabel="Search work orders by number, plate, task, or mechanic"
            autoCapitalize="none"
            placeholder="Search vehicle, task, or mechanic…"
            placeholderTextColor="#94a3b8"
            returnKeyType="search"
          />
          {searchQuery ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Clear work order search text"
              onPress={() => setSearchQuery("")}
              style={styles.searchClearButton}
            >
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                <Path
                  d="m6 6 12 12M18 6 6 18"
                  stroke="#64748b"
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              </Svg>
            </TouchableOpacity>
          ) : null}
        </View>
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
          {statusFilter || mechanicFilterId || typeFilter || priorityFilter ? <View style={styles.activeFilterDot} /> : null}
        </TouchableOpacity>
      </View>

      {searchHistory.error ? (
        <Text accessibilityRole="alert" style={styles.searchHistoryError}>
          {searchHistory.error}
        </Text>
      ) : null}
      {!searchQuery.trim() ? (
        <View style={styles.searchHistorySection}>
          <View style={styles.searchHistoryHeader}>
            {isChiefMechanicRole ? (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={recentSearchesExpanded ? "Hide recent searches" : "Show recent searches"}
                accessibilityState={{ expanded: recentSearchesExpanded }}
                onPress={() => setRecentSearchesExpanded((expanded) => !expanded)}
                style={styles.searchHistoryExpandButton}
              >
                <Text style={styles.searchHistoryHeading}>Recent searches</Text>
                <Text style={styles.searchHistoryExpandText}>
                  {recentSearchesExpanded ? "Hide" : "Show"}
                </Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.searchHistoryHeading}>Recent searches</Text>
            )}
            {(!isChiefMechanicRole || recentSearchesExpanded) && searchHistory.items.length > 0 ? (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Clear work order search history"
                onPress={() => void searchHistory.clearHistory()}
                style={styles.searchHistoryClear}
              >
                <Text style={styles.searchHistoryClearText}>Clear</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {(!isChiefMechanicRole || recentSearchesExpanded) ? (
            searchHistory.loading ? (
              <Text style={styles.searchHistoryStatus}>Loading recent searches…</Text>
            ) : searchHistory.error ? null : searchHistory.items.length > 0 ? (
              searchHistory.items.map((query, index) => (
                <TouchableOpacity
                  key={`${query}-${index}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Search work orders for ${query}`}
                  onPress={() => setSearchQuery(query)}
                  style={styles.searchHistoryItem}
                >
                  <Text numberOfLines={1} style={styles.searchHistoryText}>
                    {query}
                  </Text>
                </TouchableOpacity>
              ))
            ) : (
              <Text style={styles.searchHistoryStatus}>No recent searches yet.</Text>
            )
          ) : null}
        </View>
      ) : null}

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
      {mechanicFilterName ? (
        <Text style={styles.sectionText}>Mechanic: {mechanicFilterName}</Text>
      ) : null}
      <View style={styles.searchRow}>
        <Text style={styles.sectionText}>
          {isChiefMechanicRole && activeChiefQueueMode === "review"
            ? `${filteredOrders.length} submissions to review`
            : isChiefMechanicRole
              ? `${filteredOrders.length} of ${visibleOrders.length} supervised work orders`
              : `${filteredOrders.length} of ${visibleOrders.length} work orders`}
        </Text>
        {filtersActive && <TouchableOpacity onPress={clearFilters} accessibilityRole="button"><Text style={{ color: "#1a1f6e", fontWeight: "700" }}>Clear filters</Text></TouchableOpacity>}
      </View>

      <View style={styles.listContent}>
        {isLoading ? (
          <View style={styles.emptyStateCard}>
            <Text style={styles.emptyStateTitle}>Loading work orders…</Text>
          </View>
        ) : filteredOrders.length === 0 ? (
          <View style={styles.emptyStateCard}>
            <Text style={styles.emptyStateTitle}>
              {filtersActive
                ? "No matching work orders"
                : isChiefMechanicRole
                  ? activeChiefQueueMode === "review"
                    ? "You're all caught up"
                    : "No supervised work orders yet"
                  : "No assigned work orders"}
            </Text>
            <Text style={styles.emptyStateText}>
              {filtersActive
                ? "Try a different search or clear the filters."
                : accessRole === "mechanic"
                  ? "No execution work orders are assigned to you right now."
                  : activeChiefQueueMode === "review"
                    ? "New mechanic submissions that need your review will appear here."
                    : "Work orders assigned to you for supervision will appear here."}
            </Text>
          </View>
        ) : (
          pageOrders.map((order) => {
            const progress = checklistProgress(order);
            const needsChiefReview =
              isChiefMechanicRole && activeChiefQueueMode === "review";

            return (
                <Pressable
                  key={order.id}
                  style={[styles.orderCard, isChiefMechanicRole && styles.chiefOrderCard]}
                  onPress={() => void openSearchedOrder(order.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`${needsChiefReview ? "Review" : "Open"} work order ${order.number} for ${order.plate}`}
                >
                  <View style={styles.orderCardHeader}>
                    <Text style={styles.orderNumber}>{order.number}</Text>
                    {needsChiefReview ? (
                      <View style={styles.chiefReviewBadge}>
                        <Text style={styles.chiefReviewBadgeText}>Needs review</Text>
                      </View>
                    ) : renderStatusBadge(order.status)}
                  </View>
                  {isChiefMechanicRole ? (
                    <View style={styles.chiefCardBody}>
                      <View style={styles.chiefVehicleRow}>
                        <Text style={styles.chiefPlate} numberOfLines={1}>{order.plate}</Text>
                        {renderPriorityBadge(order.priority)}
                      </View>
                      <Text style={styles.chiefMetadata} numberOfLines={2}>
                        {order.maintenanceType} · {order.mechanic}
                      </Text>
                      <View style={styles.chiefChecklist}>
                        <View style={styles.chiefChecklistHeader}>
                          <Text style={styles.chiefChecklistLabel}>Mechanic checklist</Text>
                          {progress.total > 0 ? (
                            <Text style={styles.progressPercent}>
                              {progress.percent}% · {progress.completed}/{progress.total}
                            </Text>
                          ) : null}
                        </View>
                        {progress.total > 0 ? (
                          <View style={styles.progressTrack}>
                            <View style={[styles.progressFill, { width: `${progress.percent}%` }]} />
                          </View>
                        ) : (
                          <Text style={styles.chiefChecklistUnavailable}>
                            No checklist items configured
                          </Text>
                        )}
                      </View>
                      <View style={styles.chiefOrderFooter}>
                        <Text style={styles.chiefDateCreated}>Created {order.dateCreated}</Text>
                        <View style={styles.chiefCardAction}>
                          <Text style={styles.chiefCardActionText}>
                            {needsChiefReview ? "Review submission" : "View progress"}
                          </Text>
                          <Text style={styles.cardArrow}>›</Text>
                        </View>
                      </View>
                    </View>
                  ) : (
                    <>
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
                    </>
                  )}
                </Pressable>
            );
          })
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
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chiefQueueToggle: { flexDirection: "row", backgroundColor: "#e2e8f0", borderRadius: 12, padding: 4, gap: 4, marginBottom: 12 },
  chiefQueueTab: { flex: 1, minHeight: 44, paddingHorizontal: 8, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  chiefQueueTabActive: { backgroundColor: "#ffffff", shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  chiefQueueTabText: { color: "#475569", fontSize: 11, fontWeight: "700", textAlign: "center" },
  chiefQueueTabTextActive: { color: "#1a1f6e" },
  chiefOrderCard: { padding: 12, gap: 8 },
  chiefCardBody: { gap: 8 },
  chiefVehicleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  chiefPlate: { flex: 1, minWidth: 0, color: "#0d0d0d", fontSize: 16, fontWeight: "800" },
  chiefMetadata: { color: "#475569", fontSize: 13, fontWeight: "600" },
  chiefChecklist: { gap: 6 },
  chiefChecklistHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  chiefChecklistLabel: { color: "#64748b", fontSize: 11, fontWeight: "700" },
  chiefChecklistUnavailable: { color: "#64748b", fontSize: 11 },
  chiefOrderFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    paddingTop: 8,
    marginTop: 2,
  },
  chiefDateCreated: { flex: 1, color: "#64748b", fontSize: 11 },
  chiefCardAction: { flexDirection: "row", alignItems: "center", gap: 2 },
  chiefCardActionText: { color: "#1a1f6e", fontSize: 12, fontWeight: "700" },
  progressPercent: { color: "#1a1f6e", fontSize: 12, fontWeight: "800" },
  progressTrack: { height: 7, marginTop: 7, borderRadius: 99, overflow: "hidden", backgroundColor: "#e2e8f0" },
  progressFill: { height: "100%", borderRadius: 99, backgroundColor: "#1a1f6e" },
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
  listPageScroll: { flex: 1, backgroundColor: "#f1f5f9" },
  listPageContent: { flexGrow: 1, padding: 16, paddingBottom: 24 },
  detailScroll: { flex: 1, minHeight: 0 },
  pageHeader: {
    marginBottom: 12,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  searchInputWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    backgroundColor: "#ffffff",
    paddingLeft: 14,
  },
  prioritySortHint: { color: "#64748b", fontSize: 12, marginTop: -8, marginBottom: 8 },
  searchInput: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 0,
    paddingVertical: 12,
    color: "#0d0d0d",
    fontSize: 14,
  },
  searchClearButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  searchHistorySection: {
    marginTop: -4,
    marginBottom: 12,
  },
  searchHistoryHeader: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  searchHistoryExpandButton: {
    flex: 1,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  searchHistoryHeading: {
    color: "#334155",
    fontSize: 13,
    fontWeight: "700",
  },
  searchHistoryExpandText: { color: "#1a1f6e", fontSize: 12, fontWeight: "700" },
  searchHistoryClear: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  searchHistoryClearText: {
    color: "#1a1f6e",
    fontSize: 13,
    fontWeight: "700",
  },
  searchHistoryItem: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  searchHistoryText: {
    color: "#334155",
    fontSize: 14,
  },
  searchHistoryStatus: {
    color: "#64748b",
    fontSize: 13,
    paddingVertical: 8,
  },
  searchHistoryError: {
    color: "#a32121",
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 8,
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
  statusDue: workOrderStatusColors.due,
  statusInProgress: workOrderStatusColors.inProgress,
  statusVerification: workOrderStatusColors.verification,
  statusRejected: workOrderStatusColors.rejected,
  statusRepair: workOrderStatusColors.repair,
  statusOverdue: workOrderStatusColors.overdue,
  statusCompleted: workOrderStatusColors.completed,
  statusBadgeText: { fontSize: 11, fontWeight: "700" },
  chiefReviewBadge: { backgroundColor: "#fef3c7", borderColor: "#fcd34d", borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  chiefReviewBadgeText: { color: "#92400e", fontSize: 11, fontWeight: "700" },
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
    marginBottom: 6,
    paddingVertical: 4,
  },
  backButton: { minHeight: 44, justifyContent: "center" },
  backButtonText: { color: "#1a1f6e", fontWeight: "700", fontSize: 13 },
  exportButton: {
    minHeight: 44,
    paddingHorizontal: 8,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#1a1f6e",
    borderRadius: 8,
  },
  exportButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  exportButtonText: { color: "#ffffff", fontWeight: "700", fontSize: 11 },

  templateBanner: {
    backgroundColor: "#f5f3ff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#ddd6fe",
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 8,
  },
  templateBannerText: {
    color: "#4c1d95",
    fontWeight: "700",
    fontSize: 12,
  },

  stepBar: {
    flexDirection: "row",
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 2,
    gap: 4,
    marginBottom: 8,
  },
  stepButton: {
    flex: 1,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 8,
    paddingHorizontal: 4,
  },
  stepButtonActive: { backgroundColor: "#1a1f6e" },
  stepButtonText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#64748b",
    textAlign: "center",
  },
  stepButtonTextActive: { color: "#ffffff" },
  detailContent: { paddingBottom: 16, gap: 12 },
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
  detailStatusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  sectionTitle: { fontSize: 18, fontWeight: "800", color: "#0d0d0d" },
  sectionText: { color: "#64748b", fontSize: 13, marginTop: 2 },
  extensionSection: {
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    paddingTop: 14,
    marginTop: 4,
    gap: 12,
  },
  extensionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  extensionHeading: { flex: 1, gap: 2 },
  extensionToggle: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: "#eff6ff",
  },
  extensionToggleText: { color: "#1d4ed8", fontSize: 12, fontWeight: "700" },
  extensionContent: { gap: 10 },
  extensionForm: { gap: 8 },
  extensionReasonInput: {
    minHeight: 84,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: "#ffffff",
    color: "#0d0d0d",
    fontSize: 13,
    textAlignVertical: "top",
  },
  extensionCurrentDate: { color: "#334155", fontSize: 13, fontWeight: "700" },
  extensionHint: { color: "#475569", fontSize: 12, lineHeight: 18 },
  extensionFieldError: { color: "#991b1b", fontSize: 12 },
  extensionErrorBlock: { gap: 6 },
  extensionError: { color: "#991b1b", fontSize: 13 },
  extensionSuccess: { color: "#065f46", fontSize: 13, fontWeight: "700" },
  extensionRetry: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center" },
  extensionRetryText: { color: "#1d4ed8", fontWeight: "700" },
  extensionSubmit: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: "#1a1f6e",
    paddingHorizontal: 12,
  },
  extensionSubmitDisabled: { opacity: 0.55 },
  extensionSubmitText: { color: "#ffffff", fontWeight: "700" },
  extensionHistory: { gap: 8, marginTop: 4 },
  extensionHistoryItem: {
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    paddingTop: 10,
    gap: 4,
  },
  extensionHistoryHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  extensionHistoryStatus: { color: "#334155", fontSize: 12, fontWeight: "800" },
  extensionHistoryDate: { color: "#0f172a", fontSize: 12, fontWeight: "700" },
  extensionHistoryBody: { color: "#475569", fontSize: 12, lineHeight: 17 },

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
  checklistRequiredBackdrop: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    backgroundColor: "rgba(12, 17, 47, 0.66)",
  },
  checklistRequiredCard: {
    width: "100%",
    maxWidth: 420,
    maxHeight: "88%",
    padding: 22,
    borderRadius: 22,
    backgroundColor: "#ffffff",
    shadowColor: "#0c112f",
    shadowOpacity: 0.24,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 18,
  },
  checklistRequiredHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginBottom: 14,
  },
  checklistRequiredIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff6df",
  },
  checklistRequiredTitle: {
    flex: 1,
    color: "#1a1f6e",
    fontSize: 19,
    fontWeight: "800",
    lineHeight: 25,
  },
  checklistRequiredBody: {
    maxHeight: 360,
    flexGrow: 0,
    flexShrink: 1,
  },
  checklistRequiredBodyContent: {
    gap: 12,
    paddingBottom: 4,
  },
  checklistRequiredMessage: {
    color: "#334155",
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 22,
  },
  checklistRequiredItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingHorizontal: 2,
  },
  checklistRequiredBullet: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginTop: 7,
    backgroundColor: "#d4a93f",
  },
  checklistRequiredItemText: {
    flex: 1,
    color: "#475569",
    fontSize: 14,
    lineHeight: 20,
  },
  checklistRequiredGuidance: {
    marginTop: 4,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#f1f5f9",
  },
  checklistRequiredGuidanceText: {
    color: "#334155",
    fontSize: 13,
    lineHeight: 19,
  },
  checklistRequiredButton: {
    minHeight: 50,
    marginTop: 18,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1a1f6e",
    shadowColor: "#1a1f6e",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  checklistRequiredButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "800",
  },
  pdfExportBackdrop: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    backgroundColor: "rgba(12, 17, 47, 0.66)",
  },
  pdfExportCard: {
    width: "100%",
    maxWidth: 380,
    padding: 26,
    borderRadius: 22,
    alignItems: "center",
    backgroundColor: "#ffffff",
    shadowColor: "#0c112f",
    shadowOpacity: 0.24,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 18,
  },
  pdfExportStatusIcon: {
    width: 58,
    height: 58,
    marginBottom: 18,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  pdfExportSuccessIcon: {
    backgroundColor: "#e8f7ed",
  },
  pdfExportErrorIcon: {
    backgroundColor: "#fff0ef",
  },
  pdfExportCancelledIcon: {
    backgroundColor: "#fff6df",
  },
  pdfExportInfoIcon: {
    backgroundColor: "#eef2ff",
  },
  pdfExportTitle: {
    color: "#1a1f6e",
    fontSize: 24,
    fontWeight: "800",
    lineHeight: 31,
    textAlign: "center",
  },
  pdfExportMessage: {
    marginTop: 8,
    color: "#334155",
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  pdfExportButton: {
    width: "100%",
    minHeight: 50,
    marginTop: 22,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1a1f6e",
    shadowColor: "#1a1f6e",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  pdfExportButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "800",
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
  partsSuggestions: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    backgroundColor: "#ffffff",
    overflow: "hidden",
  },
  partsSuggestion: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  partsSuggestionText: { color: "#1e293b", fontSize: 13 },
  partsSuggestionEmpty: { color: "#475569", fontSize: 12, padding: 10 },
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
    flexDirection: "row",
    gap: 8,
    backgroundColor: "#ffffff",
    borderRadius: 14,
    padding: 8,
    marginTop: 8,
    flexShrink: 0,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  startDateNotice: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    marginTop: 8,
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
