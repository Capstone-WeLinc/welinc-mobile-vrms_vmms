import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import Svg, { Circle, Path } from "react-native-svg";

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

type PartsUsedItem = {
  id: string;
  label: string;
  partsUsed: string;
  materialCost: string;
};

type ScheduleDetail = {
  label: string;
  value: string;
};

type AttachmentItem = {
  id: string;
  name: string;
  sizeMb: number;
};

type PartDetailEntry = {
  partsUsed: string;
  quantity: string;
  materialCost: string;
  attachments: AttachmentItem[];
  attachmentName: string;
  attachmentSizeMb: string;
};

type WorkOrder = {
  id: string;
  number: string;
  plate: string;
  maintenanceType: string;
  mechanic: string;
  dateCreated: string;
  status: WorkOrderStatus;
  summary: string;
  details: string[];
  template: string;
  checklistTemplateId: string | null;
  scheduleDetails: ScheduleDetail[];
  executionItems: ExecutionItem[];
  partsUsedItems: PartsUsedItem[];
  partDetails: Record<string, PartDetailEntry>;
  inspectionItems: InspectionItem[];
  chiefMechanic: string;
  inspectorRemarks: string;
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
    | "chiefMechanic"
    | "inspectorRemarks"
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
      partDetails:
        parsed.partDetails && typeof parsed.partDetails === "object"
          ? parsed.partDetails
          : undefined,
      inspectionItems: Array.isArray(parsed.inspectionItems)
        ? parsed.inspectionItems
        : [],
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
      mechanicSubmitted: parsed.mechanicSubmitted === true,
      status: parsed.workflowStatus,
    };
  } catch {
    return {};
  }
};

const formatReadableDate = (value: string | null | undefined): string => {
  if (!value) return "N/A";

  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return value;
  }

  return parsedDate.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const formatWorkOrderNumber = (value: string | null | undefined): string => {
  if (!value) return "N/A";

  const alphanumeric = value.match(/[A-Za-z0-9]/g)?.join("") ?? "";
  const compactValue = alphanumeric.slice(0, 8).toUpperCase();

  return compactValue ? `WO-${compactValue}` : "N/A";
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
  if (field === "createdAt" || field === "startReferenceDate") {
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
  attachmentSizeMb: "",
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

const buildInspectionItems = (
  executionItems: ExecutionItem[],
): InspectionItem[] =>
  executionItems.map((item) => ({
    id: item.id,
    label: item.label,
    status: "pending",
    note: "",
  }));

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
}

export function WorkOrderScreen({ accessRole, user }: WorkOrderScreenProps) {
  const fallbackChiefMechanicOptions = [
    "Ariel Santos",
    "Ramon Cruz",
    "Lorenzo Reyes",
  ];
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState<StepKey>("details");
  const [showChiefMechanicOptions, setShowChiefMechanicOptions] =
    useState(false);
  const [chiefMechanicOptions, setChiefMechanicOptions] = useState<string[]>(
    [],
  );

  const [aiAdvisoryLoading, setAiAdvisoryLoading] = useState(false);
  const [aiRecommendations, setAiRecommendations] =
    useState<WorkOrderRecommendationsResponse | null>(null);

  useEffect(() => {
    let mounted = true;
    void new AuthService(API_BASE_URL)
      .getChiefMechanics()
      .then((chiefMechanics) => {
        if (mounted) {
          setChiefMechanicOptions(
            chiefMechanics.length > 0
              ? chiefMechanics
                  .map((chiefMechanic) => chiefMechanic.name.trim())
                  .filter(Boolean)
              : fallbackChiefMechanicOptions,
          );
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadWorkOrders(): Promise<void> {
      try {
        const db = await getDatabase();
        const maintenanceRepo = new MaintenanceRepository(db);
        const checklistRepo = new ChecklistRepository(db);
        const schedules = await maintenanceRepo.getMaintenanceSchedules();

        if (!mounted) return;

        const converted: WorkOrder[] = await Promise.all(
          schedules.map(async (schedule) => {
            const resolvedTemplate = await resolveChecklistTemplate(
              checklistRepo,
              schedule.checklistTemplateId,
              schedule.title,
            );

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
            const savedExecutionItems =
              savedProgress.executionItems ?? executionItems;
            const savedInspectionItems = savedProgress.inspectionItems?.length
              ? savedProgress.inspectionItems
              : buildInspectionItems(savedExecutionItems);

            return {
              id: schedule.id,
              number: formatWorkOrderNumber(schedule.id),
              plate: "", // Would need vehicle lookup to populate
              maintenanceType: schedule.title,
              mechanic: schedule.assignedMechanic || "Unassigned",
              dateCreated: formatReadableDate(schedule.createdAt),
              status:
                savedProgress.status ??
                (schedule.status === "PENDING"
                  ? "Pending"
                  : schedule.status === "DUE"
                    ? "Pending"
                    : schedule.status === "IN_PROGRESS"
                      ? "In Progress"
                      : schedule.status === "COMPLETED"
                        ? "Done"
                        : "Overdue"),
              summary: `${schedule.title} - ${schedule.intervalType || "As needed"}`,
              details: [],
              template: resolvedTemplate.templateName,
              checklistTemplateId: resolvedTemplate.templateId,
              scheduleDetails: [
                {
                  label: "Work Order No.",
                  value: formatWorkOrderNumber(schedule.id),
                },
                {
                  label: "Vehicle",
                  value: formatScheduleField("vehicleId", schedule.vehicleId),
                },
                {
                  label: "Checklist Template",
                  value: resolvedTemplate.templateName,
                },
                {
                  label: "Date Created",
                  value: formatScheduleField("createdAt", schedule.createdAt),
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
              partsUsedItems: [
                {
                  id: "p1",
                  label: schedule.title,
                  partsUsed: "Not applicable",
                  materialCost: "0.00",
                },
              ],
              partDetails: savedProgress.partDetails ?? partDetails,
              inspectionItems: savedInspectionItems,
              chiefMechanic: savedProgress.chiefMechanic ?? "",
              inspectorRemarks: savedProgress.inspectorRemarks ?? "",
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
            };
          }),
        );

        setWorkOrders(converted);
      } catch (error) {
        console.error("[WorkOrderScreen] Failed to load work orders", error);
      } finally {
        setIsLoading(false);
      }
    }

    loadWorkOrders();
    return () => {
      mounted = false;
    };
  }, []);

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
          currentOrder.maintenanceType,
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

            const partDetails = executionItems.reduce<
              Record<string, PartDetailEntry>
            >(
              (accumulator, item) => ({
                ...accumulator,
                [item.id]:
                  order.partDetails[item.id] ?? createDefaultPartDetailEntry(),
              }),
              {},
            );

            return {
              ...order,
              executionItems: savedProgress.executionItems ?? executionItems,
              partDetails,
              inspectionItems: savedProgress.inspectionItems?.length
                ? savedProgress.inspectionItems
                : buildInspectionItems(
                    savedProgress.executionItems ?? executionItems,
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

  const selectedOrder =
    workOrders.find((order) => order.id === selectedOrderId) ?? null;

  useEffect(() => {
    setAiRecommendations(null);
    setAiAdvisoryLoading(false);
  }, [selectedOrderId]);

  const knownChiefMechanics = workOrders
    .map((order) => order.chiefMechanic.trim())
    .filter(Boolean);
  const availableChiefMechanics = Array.from(
    new Set([...chiefMechanicOptions, ...knownChiefMechanics]),
  );
  const currentUserName = user.name.trim().toLowerCase();
  const currentUserDisplayName = user.name.trim();

  const persistWorkOrder = (order: WorkOrder, status?: string) => {
    const progress = {
      executionItems: order.executionItems,
      partDetails: order.partDetails,
      inspectionItems: order.inspectionItems,
      chiefMechanic: order.chiefMechanic,
      inspectorRemarks: order.inspectorRemarks,
      approvalStatus: order.approvalStatus,
      mechanicSubmitted: order.mechanicSubmitted,
      workflowStatus: order.status,
    };
    const authService = new AuthService(API_BASE_URL);

    void Promise.all([
      getDatabase().then((db) =>
        new MaintenanceRepository(db).updateWorkOrderProgress(
          order.id,
          JSON.stringify(progress),
          status,
        ),
      ),
      authService.updateMaintenanceProgress(order.id, progress),
    ]).catch((error) =>
      console.error(
        "[WorkOrderScreen] Failed to save work order progress",
        error,
      ),
    );
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
        order.status === "Done") &&
      order.approvalStatus !== "Rejected"
    ) {
      return;
    }
    const updatedOrder = update(order);
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

  const filteredOrders = workOrders.filter((order) => {
    const query = searchQuery.toLowerCase();
    const matchesQuery =
      order.number.toLowerCase().includes(query) ||
      order.plate.toLowerCase().includes(query) ||
      order.maintenanceType.toLowerCase().includes(query) ||
      order.mechanic.toLowerCase().includes(query) ||
      order.chiefMechanic.toLowerCase().includes(query);

    if (accessRole === "mechanic") {
      return matchesQuery && order.mechanic.toLowerCase() === currentUserName;
    }

    if (accessRole === "chiefMechanic") {
      return (
        matchesQuery &&
        (order.mechanicSubmitted ||
          order.status === "Pending" ||
          order.status === "For Verification" ||
          order.status === "Done" ||
          order.status === "Rejected" ||
          order.status === "For Repair") &&
        order.chiefMechanic.trim().toLowerCase() === currentUserName
      );
    }

    return matchesQuery;
  });

  const groupedOrders = filteredOrders.reduce<Record<string, WorkOrder[]>>(
    (groups, order) => {
      const mechanicKey = order.mechanic.trim() || "Unassigned";
      groups[mechanicKey] = [...(groups[mechanicKey] ?? []), order];
      return groups;
    },
    {},
  );

  const groupedOrderEntries = Object.entries(groupedOrders).sort(
    ([leftName], [rightName]) => leftName.localeCompare(rightName),
  );

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

  const updateChiefMechanic = (orderId: string, name: string) => {
    updateWorkOrder(orderId, (order) => ({ ...order, chiefMechanic: name }));
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
        mechanicSubmitted:
          getAutomaticInspectionRemark(inspectionItems) !== "Rejected",
        status:
          getAutomaticInspectionRemark(inspectionItems) === "Verified"
            ? "Done"
            : "For Verification",
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

  const addAttachmentToItem = async (orderId: string, itemId: string) => {
    const order = workOrders.find((item) => item.id === orderId);
    if (!order) return;

    const currentEntry = order.partDetails[itemId] ?? {
      partsUsed: "",
      quantity: "",
      materialCost: "",
      attachments: [],
      attachmentName: "",
      attachmentSizeMb: "",
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
        mediaTypes: ImagePicker.MediaTypeOptions.All,
        allowsEditing: false,
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
        type: ["image/*", "application/pdf", "text/plain"],
        copyToCacheDirectory: true,
      });

      if ("canceled" in result && result.canceled) {
        return null;
      }

      return result;
    };

    Alert.alert("Add attachment", "Choose how you want to add the attachment", [
      {
        text: "Gallery",
        onPress: async () => {
          const result = await pickMedia();
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
          setWorkOrders((current) =>
            current.map((existingOrder) => {
              if (
                existingOrder.id !== orderId ||
                (isMechanicRole &&
                  (existingOrder.mechanicSubmitted ||
                    existingOrder.approvalStatus === "Verified" ||
                    existingOrder.status === "Done") &&
                  existingOrder.approvalStatus !== "Rejected")
              ) {
                return existingOrder;
              }
              return {
                ...existingOrder,
                partDetails: {
                  ...existingOrder.partDetails,
                  [itemId]: {
                    ...existingOrder.partDetails[itemId],
                    attachments: [
                      ...(existingOrder.partDetails[itemId]?.attachments ?? []),
                      {
                        id: `${itemId}-${Date.now()}`,
                        name: asset.fileName ?? "Gallery attachment",
                        sizeMb: Number(fileSizeMb.toFixed(2)),
                      },
                    ],
                    attachmentName: "",
                    attachmentSizeMb: "",
                  },
                },
              };
            }),
          );
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
          setWorkOrders((current) =>
            current.map((existingOrder) => {
              if (
                existingOrder.id !== orderId ||
                (isMechanicRole &&
                  (existingOrder.mechanicSubmitted ||
                    existingOrder.approvalStatus === "Verified" ||
                    existingOrder.status === "Done") &&
                  existingOrder.approvalStatus !== "Rejected")
              ) {
                return existingOrder;
              }
              return {
                ...existingOrder,
                partDetails: {
                  ...existingOrder.partDetails,
                  [itemId]: {
                    ...existingOrder.partDetails[itemId],
                    attachments: [
                      ...(existingOrder.partDetails[itemId]?.attachments ?? []),
                      {
                        id: `${itemId}-${Date.now()}`,
                        name: asset.fileName ?? "Camera photo",
                        sizeMb: Number(fileSizeMb.toFixed(2)),
                      },
                    ],
                    attachmentName: "",
                    attachmentSizeMb: "",
                  },
                },
              };
            }),
          );
        },
      },
      {
        text: "Files",
        onPress: async () => {
          const result = await pickFile();
          if (!result) return;
          const fileSizeMb = (result.assets?.[0]?.size ?? 0) / (1024 * 1024);
          if (fileSizeMb > 5) {
            Alert.alert(
              "Maximum size exceeded",
              "Each attachment must be 5 MB or less.",
            );
            return;
          }
          setWorkOrders((current) =>
            current.map((existingOrder) => {
              if (
                existingOrder.id !== orderId ||
                (isMechanicRole &&
                  (existingOrder.mechanicSubmitted ||
                    existingOrder.approvalStatus === "Verified" ||
                    existingOrder.status === "Done") &&
                  existingOrder.approvalStatus !== "Rejected")
              ) {
                return existingOrder;
              }
              return {
                ...existingOrder,
                partDetails: {
                  ...existingOrder.partDetails,
                  [itemId]: {
                    ...existingOrder.partDetails[itemId],
                    attachments: [
                      ...(existingOrder.partDetails[itemId]?.attachments ?? []),
                      {
                        id: `${itemId}-${Date.now()}`,
                        name: result.assets?.[0]?.name ?? "File attachment",
                        sizeMb: Number(fileSizeMb.toFixed(2)),
                      },
                    ],
                    attachmentName: "",
                    attachmentSizeMb: "",
                  },
                },
              };
            }),
          );
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const calculateMaterialCost = (orderId: string): string => {
    const order = workOrders.find((o) => o.id === orderId);
    if (!order) return "0.00";

    const total = order.executionItems.reduce((sum, item) => {
      if (item.status !== "changed") return sum;

      const cost = Number.parseFloat(
        order.partDetails[item.id]?.materialCost || "0",
      );
      return sum + (Number.isNaN(cost) ? 0 : cost);
    }, 0);

    return total.toFixed(2);
  };

  const openOrder = (orderId: string) => {
    setSelectedOrderId(orderId);
    setActiveStep("details");
    setShowChiefMechanicOptions(false);
  };

  const isMechanicRole = accessRole === "mechanic";
  const isChiefMechanicRole = accessRole === "chiefMechanic";
  const visibleSteps = [
    { key: "details" as StepKey, label: "Details" },
    ...(isMechanicRole
      ? [
          { key: "execution" as StepKey, label: "Execution" },
          { key: "parts" as StepKey, label: "Parts, Cost & Photos" },
        ]
      : [{ key: "inspection" as StepKey, label: "Inspection Checklist" }]),
  ];

  const exportPDF = () => {
    if (selectedOrder) {
      Alert.alert("Export PDF", `Exporting ${selectedOrder.number} to PDF...`);
    }
  };

  const handleCompleteOrder = () => {
    if (!selectedOrder) return;

    if (isChiefMechanicRole) {
      const hasInspectionResults =
        selectedOrder.inspectionItems.length > 0 &&
        selectedOrder.inspectionItems.every(
          (item) => item.status !== "pending",
        );

      if (!hasInspectionResults) {
        Alert.alert(
          "Inspection Incomplete",
          "Mark every inspection item as Pass or Fail before approving this work order.",
        );
        return;
      }

      if (
        selectedOrder.approvalStatus === "Verified" &&
        selectedOrder.inspectionItems.some((item) => item.status === "fail")
      ) {
        Alert.alert(
          "Inspection Cannot Be Verified",
          "A work order with failed inspection items is automatically Rejected.",
        );
        return;
      }

      const approved = selectedOrder.approvalStatus === "Verified";
      const updatedOrder = {
        ...selectedOrder,
        approvalStatus: approved
          ? ("Verified" as const)
          : selectedOrder.approvalStatus,
        mechanicSubmitted: selectedOrder.approvalStatus === "Rejected",
        status: approved ? ("Done" as const) : ("For Verification" as const),
      };
      setWorkOrders((current) =>
        current.map((order) =>
          order.id === updatedOrder.id ? updatedOrder : order,
        ),
      );
      persistWorkOrder(updatedOrder, approved ? "COMPLETED" : "IN_PROGRESS");
      Alert.alert(
        approved ? "Inspection Verified" : "Inspection Submitted",
        `${selectedOrder.number} ${approved ? "verified" : "returned to the mechanic"}.`,
      );
      setSelectedOrderId(null);
      return;
    }

    const hasExecutionStatuses =
      selectedOrder.executionItems.length > 0 &&
      selectedOrder.executionItems.every((item) => item.status !== "pending");

    const changedExecutionItems = selectedOrder.executionItems.filter(
      (item) => item.status === "changed",
    );

    const hasRequiredPartsDetails = changedExecutionItems.every((item) => {
      const partEntry = selectedOrder.partDetails[item.id] ?? {
        partsUsed: "",
        quantity: "",
        materialCost: "",
        attachments: [],
        attachmentName: "",
        attachmentSizeMb: "",
      };

      return (
        partEntry.partsUsed.trim().length > 0 &&
        partEntry.quantity.trim().length > 0 &&
        partEntry.materialCost.trim().length > 0 &&
        partEntry.attachments.length > 0
      );
    });

    const hasChiefMechanic = selectedOrder.chiefMechanic.trim().length > 0;

    if (
      selectedOrder.mechanicSubmitted &&
      selectedOrder.approvalStatus !== "Rejected"
    ) {
      Alert.alert(
        "Already Sent for Verification",
        "This work order is locked until the chief mechanic returns it as Rejected.",
      );
      return;
    }

    if (!hasExecutionStatuses) {
      Alert.alert(
        "Execution Incomplete",
        "Mark every checklist item as Checked, Changed, or Not Checked before completing the order.",
      );
      return;
    }

    if (changedExecutionItems.length > 0 && !hasRequiredPartsDetails) {
      Alert.alert(
        "Parts, Cost & Photo Details Required",
        "Fill in the required Parts, Cost, and Photo details for every Changed item before completing the order.",
      );
      return;
    }

    if (!hasChiefMechanic) {
      Alert.alert(
        "Chief Mechanic Required",
        "Select a chief mechanic before completing the order.",
      );
      return;
    }

    const submittedOrder = {
      ...selectedOrder,
      mechanicSubmitted: true,
      approvalStatus: "Unverified" as const,
      status: "Pending" as const,
    };
    setWorkOrders((current) =>
      current.map((order) =>
        order.id === submittedOrder.id ? submittedOrder : order,
      ),
    );
    persistWorkOrder(submittedOrder, "IN_PROGRESS");
    Alert.alert(
      "Sent for Inspection",
      `${selectedOrder.number} was sent to ${selectedOrder.chiefMechanic} for inspection.`,
    );
    setSelectedOrderId(null);
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
    if (!selectedOrder) return;

    const remark = getAutomaticInspectionRemark(selectedOrder.inspectionItems);
    if (remark === "Unverified") {
      if (isMechanicRole && !selectedOrder.mechanicSubmitted) {
        handleCompleteOrder();
      }
      return;
    }

    if (remark === "Verified") {
      const completedOrder = {
        ...selectedOrder,
        approvalStatus: "Verified" as const,
        mechanicSubmitted: true,
        status: "Done" as const,
      };
      setWorkOrders((current) =>
        current.map((order) =>
          order.id === completedOrder.id ? completedOrder : order,
        ),
      );
      persistWorkOrder(completedOrder, "COMPLETED");
      Alert.alert(
        "Inspection Completed",
        `${selectedOrder.number} is now Done.`,
      );
      setSelectedOrderId(null);
      return;
    }

    if (remark === "Rejected") {
      const rejectedOrder = {
        ...selectedOrder,
        approvalStatus: "Rejected" as const,
        mechanicSubmitted: false,
        status: "Rejected" as const,
      };
      setWorkOrders((current) =>
        current.map((order) =>
          order.id === rejectedOrder.id ? rejectedOrder : order,
        ),
      );
      persistWorkOrder(rejectedOrder, "IN_PROGRESS");
      Alert.alert(
        "Inspection Rejected",
        `${selectedOrder.number} was returned for correction.`,
      );
      setSelectedOrderId(null);
      return;
    }

    const repairOrder = {
      ...selectedOrder,
      approvalStatus: "For Repair" as const,
      mechanicSubmitted: true,
      status: "For Repair" as const,
    };
    setWorkOrders((current) =>
      current.map((order) =>
        order.id === repairOrder.id ? repairOrder : order,
      ),
    );
    persistWorkOrder(repairOrder, "IN_PROGRESS");
    Alert.alert(
      "Transferred to Repair",
      `${selectedOrder.number} was transferred to the repair system.`,
    );
    setSelectedOrderId(null);
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
    const mechanicOrderLocked =
      isMechanicRole &&
      (selectedOrder.mechanicSubmitted ||
        selectedOrder.approvalStatus === "Verified" ||
        selectedOrder.status === "Done") &&
      selectedOrder.approvalStatus !== "Rejected";
    const changedExecutionItems = selectedOrder.executionItems.filter(
      (item) => item.status === "changed",
    );
    return (
      <View style={styles.container}>
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

        <ScrollView contentContainerStyle={styles.detailContent}>
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
                      <Text style={styles.scheduleValue}>{detail.value}</Text>
                    </View>
                  ))}
                </View>

                {/* Parts Used Section */}
                <View style={styles.partsSection}>
                  <Text style={styles.sectionTitle}>
                    Parts Used, Cost, and Photos
                  </Text>
                  <Text style={styles.sectionText}>
                    Labor, materials, uploads, and supporting documentation for
                    this work order.
                  </Text>
                  {selectedOrder.partsUsedItems.length === 0 ? (
                    <Text style={styles.emptyPartsText}>
                      No parts recorded for this work order.
                    </Text>
                  ) : (
                    selectedOrder.partsUsedItems.map((item) => (
                      <View key={item.id} style={styles.partsItemCard}>
                        <Text style={styles.partsItemTitle}>{item.label}</Text>
                        <View style={styles.partsItemRow}>
                          <View style={styles.partsItemColumn}>
                            <Text style={styles.partsLabel}>Parts Used</Text>
                            <Text style={styles.partsValue}>
                              {item.partsUsed}
                            </Text>
                          </View>
                          <View style={styles.partsItemColumn}>
                            <Text style={styles.partsLabel}>Material Cost</Text>
                            <Text style={styles.partsValue}>
                              ₱{parseFloat(item.materialCost).toFixed(2)}
                            </Text>
                          </View>
                        </View>
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

              <View style={styles.chiefMechanicSection}>
                <Text style={styles.sectionTitle}>Chief Mechanic</Text>
                <Text style={styles.sectionText}>
                  Assign a chief mechanic before completing execution.
                </Text>
                <View style={styles.dropdownSection}>
                  <Text style={styles.dropdownLabel}>
                    Select Chief Mechanic
                  </Text>
                  <TouchableOpacity
                    style={styles.dropdownButton}
                    disabled={mechanicOrderLocked}
                    onPress={() =>
                      setShowChiefMechanicOptions((value) => !value)
                    }
                  >
                    <Text style={styles.dropdownButtonText}>
                      {selectedOrder.chiefMechanic || "Choose a chief mechanic"}
                    </Text>
                  </TouchableOpacity>
                  {showChiefMechanicOptions && (
                    <View style={styles.dropdownMenu}>
                      {availableChiefMechanics.map((option) => (
                        <TouchableOpacity
                          key={option}
                          style={styles.dropdownOption}
                          onPress={() => {
                            updateChiefMechanic(selectedOrder.id, option);
                            setShowChiefMechanicOptions(false);
                          }}
                        >
                          <Text style={styles.dropdownOptionText}>
                            {option}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
              </View>
            </View>
          )}

          {/* Step 3: Parts, Cost & Photos */}
          {activeStep === "parts" && (
            <View style={styles.detailCard}>
              <Text style={styles.sectionTitle}>Parts, Cost & Photos</Text>
              <Text style={styles.sectionText}>
                {changedExecutionItems.length > 0
                  ? `${changedExecutionItems.length} changed item${changedExecutionItems.length === 1 ? "" : "s"} will appear below.`
                  : "Each item marked as Changed will generate a parts entry below."}
              </Text>

              {changedExecutionItems.map((item) => {
                const partEntry = selectedOrder.partDetails[item.id] ?? {
                  partsUsed: "",
                  quantity: "",
                  materialCost: "",
                  attachments: [],
                  attachmentName: "",
                  attachmentSizeMb: "",
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
                    <TextInput
                      style={styles.partsInput}
                      editable={!mechanicOrderLocked}
                      value={partEntry.attachmentName}
                      onChangeText={(text) =>
                        updatePartDetailField(
                          selectedOrder.id,
                          item.id,
                          "attachmentName",
                          text,
                        )
                      }
                      placeholder="Attachment name"
                      placeholderTextColor="#94a3b8"
                    />
                    <TextInput
                      style={styles.partsInput}
                      editable={!mechanicOrderLocked}
                      value={partEntry.attachmentSizeMb}
                      keyboardType="numeric"
                      onChangeText={(text) =>
                        updatePartDetailField(
                          selectedOrder.id,
                          item.id,
                          "attachmentSizeMb",
                          text,
                        )
                      }
                      placeholder="Size in MB (max 5)"
                      placeholderTextColor="#94a3b8"
                    />
                    <TouchableOpacity
                      style={styles.uploadButton}
                      disabled={mechanicOrderLocked}
                      onPress={() =>
                        addAttachmentToItem(selectedOrder.id, item.id)
                      }
                    >
                      <Text style={styles.uploadButtonText}>
                        Add Attachment ({partEntry.attachments.length}/5)
                      </Text>
                    </TouchableOpacity>
                    {partEntry.attachments.length === 0 ? (
                      <Text style={styles.noFileText}>
                        No attachments added yet.
                      </Text>
                    ) : (
                      partEntry.attachments.map((attachment) => (
                        <View key={attachment.id} style={styles.partsItemRow}>
                          <Text style={styles.partsValue}>
                            • {attachment.name} ({attachment.sizeMb} MB)
                          </Text>
                        </View>
                      ))
                    )}
                  </View>
                );
              })}

              {changedExecutionItems.length === 0 && (
                <Text style={styles.emptyPartsText}>
                  No changed items yet. Mark an execution item as Changed to
                  populate this tab.
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

              <View style={styles.chiefMechanicSection}>
                <Text style={styles.sectionTitle}>Chief Mechanic Sign-off</Text>
                <Text style={styles.sectionText}>
                  Select the chief mechanic for final inspection.
                </Text>
                <View style={styles.dropdownSection}>
                  <Text style={styles.dropdownLabel}>
                    Select Chief Mechanic
                  </Text>
                  <TouchableOpacity
                    style={styles.dropdownButton}
                    disabled={mechanicOrderLocked}
                    onPress={() =>
                      setShowChiefMechanicOptions((value) => !value)
                    }
                  >
                    <Text style={styles.dropdownButtonText}>
                      {selectedOrder.chiefMechanic || "Choose a chief mechanic"}
                    </Text>
                  </TouchableOpacity>
                  {showChiefMechanicOptions && (
                    <View style={styles.dropdownMenu}>
                      {availableChiefMechanics.map((option) => (
                        <TouchableOpacity
                          key={option}
                          style={styles.dropdownOption}
                          onPress={() => {
                            updateChiefMechanic(selectedOrder.id, option);
                            setShowChiefMechanicOptions(false);
                          }}
                        >
                          <Text style={styles.dropdownOptionText}>
                            {option}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
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
              </View>
            </View>
          )}
        </ScrollView>

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
              getAutomaticInspectionRemark(selectedOrder.inspectionItems) ===
                "Unverified" && styles.inspectionActionDisabled,
            ]}
            onPress={handleInspectionAction}
            disabled={
              (isChiefMechanicRole &&
                getAutomaticInspectionRemark(selectedOrder.inspectionItems) ===
                  "Unverified") ||
              (isMechanicRole &&
                (mechanicOrderLocked ||
                  (selectedOrder.mechanicSubmitted &&
                    selectedOrder.approvalStatus !== "Rejected")))
            }
          >
            <Text style={styles.bottomButtonPrimaryText}>
              {getInspectionActionLabel(
                getAutomaticInspectionRemark(selectedOrder.inspectionItems),
              )}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerCard}>
        <View style={styles.headerTextBlock}>
          <Text style={styles.title}>WORK ORDERS</Text>
          <Text style={styles.subtitle}>
            {isChiefMechanicRole
              ? "Review and verify inspection checklists"
              : "Your assigned work orders grouped by mechanic"}
          </Text>
        </View>
      </View>

      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search vehicle, task, or mechanic…"
          placeholderTextColor="#94a3b8"
        />
        <TouchableOpacity style={styles.filterButton}>
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
            <Circle cx="11" cy="11" r="5.5" stroke="#D4A93F" strokeWidth={2} />
            <Path d="M16 16L21 21" stroke="#D4A93F" strokeWidth={2} strokeLinecap="round" />
          </Svg>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.listContent}>
        {isLoading ? (
          <View style={styles.emptyStateCard}>
            <Text style={styles.emptyStateTitle}>Loading work orders…</Text>
          </View>
        ) : groupedOrderEntries.length === 0 ? (
          <View style={styles.emptyStateCard}>
            <Text style={styles.emptyStateTitle}>No assigned work orders</Text>
            <Text style={styles.emptyStateText}>
              {accessRole === "mechanic"
                ? "No execution work orders are assigned to you right now."
                : "No inspection work orders are assigned to you right now."}
            </Text>
          </View>
        ) : (
          groupedOrderEntries.map(([mechanicName, orders]) => (
            <View key={mechanicName} style={styles.groupSection}>
              <View style={styles.groupHeader}>
                <Text style={styles.groupLabel}>Assigned Mechanic</Text>
                <Text style={styles.groupMechanicName}>
                  {accessRole === "mechanic"
                    ? currentUserDisplayName
                    : mechanicName}
                </Text>
                <Text style={styles.groupCount}>
                  {orders.length === 1
                    ? "1 work order"
                    : `${orders.length} work orders`}
                </Text>
              </View>

              {orders.map((order) => (
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
              ))}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f1f5f9", padding: 16 },
  headerCard: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  headerTextBlock: { gap: 4 },
  title: { fontSize: 24, fontWeight: "800", color: "#0d0d0d" },
  subtitle: { color: "#64748b", fontSize: 13 },
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
  statusPending: { backgroundColor: "#f8f8ff", borderColor: "#d9d6ef" },
  statusInProgress: { backgroundColor: "#dbeafe", borderColor: "#7dd3fc" },
  statusVerification: { backgroundColor: "#fef3c7", borderColor: "#f59e0b" },
  statusRejected: { backgroundColor: "#fee2e2", borderColor: "#fca5a5" },
  statusRepair: { backgroundColor: "#ffedd5", borderColor: "#fdba74" },
  statusOverdue: { backgroundColor: "#fef5e7", borderColor: "#fcd34d" },
  statusCompleted: { backgroundColor: "#dcfce7", borderColor: "#86efac" },
  statusBadgeText: { fontSize: 11, fontWeight: "700", color: "#1a1f6e" },
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
