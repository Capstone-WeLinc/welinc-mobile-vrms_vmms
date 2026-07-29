import { useState, useEffect } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Alert,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";

import type {
  AuthenticatedUser,
  MobileAccessRole,
} from "../services/AuthService";
import { getDatabase } from "../database/database";
import { ChecklistRepository } from "../repositories/ChecklistRepository";
import { MaintenanceRepository } from "../repositories/MaintenanceRepository";
import type { ChecklistItem, MaintenanceSchedule } from "../database/tables";

type WorkOrderStatus = "Pending" | "In Progress" | "Overdue" | "Completed";
type StepKey = "details" | "execution" | "parts";

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
  approvalStatus: "Pending verification" | "Approved" | "Rejected";
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

interface WorkOrderScreenProps {
  accessRole: MobileAccessRole;
  user: AuthenticatedUser;
}

export function WorkOrderScreen({ accessRole, user }: WorkOrderScreenProps) {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState<StepKey>("details");
  const [showChiefMechanicOptions, setShowChiefMechanicOptions] =
    useState(false);

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

            return {
              id: schedule.id,
              number: formatWorkOrderNumber(schedule.id),
              plate: "", // Would need vehicle lookup to populate
              maintenanceType: schedule.title,
              mechanic: schedule.assignedMechanic || "Unassigned",
              dateCreated: formatReadableDate(schedule.createdAt),
              status:
                schedule.status === "PENDING"
                  ? "Pending"
                  : schedule.status === "DUE"
                    ? "Pending"
                    : schedule.status === "IN_PROGRESS"
                      ? "In Progress"
                      : schedule.status === "COMPLETED"
                        ? "Completed"
                        : "Overdue",
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
              executionItems,
              partsUsedItems: [
                {
                  id: "p1",
                  label: schedule.title,
                  partsUsed: "Not applicable",
                  materialCost: "0.00",
                },
              ],
              partDetails,
              inspectionItems: [],
              chiefMechanic: "",
              inspectorRemarks: "",
              inspectionResultsPending: 0,
              approvalStatus: "Pending verification",
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
              executionItems,
              partDetails,
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

  const chiefMechanicOptions = ["Ariel Santos", "Ramon Cruz", "Lorenzo Reyes"];
  const currentUserName = user.name.trim().toLowerCase();
  const currentUserDisplayName = user.name.trim();

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
        order.chiefMechanic.trim().toLowerCase() === currentUserName
      );
    }

    return matchesQuery;
  });

  const selectedOrder =
    workOrders.find((order) => order.id === selectedOrderId) ?? null;

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
    setWorkOrders((current) =>
      current.map((order) => {
        if (order.id !== orderId) return order;
        return {
          ...order,
          executionItems: order.executionItems.map((item) =>
            item.id === itemId ? { ...item, status } : item,
          ),
        };
      }),
    );
  };

  const updateExecutionNote = (
    orderId: string,
    itemId: string,
    note: string,
  ) => {
    setWorkOrders((current) =>
      current.map((order) => {
        if (order.id !== orderId) return order;
        return {
          ...order,
          executionItems: order.executionItems.map((item) =>
            item.id === itemId ? { ...item, note } : item,
          ),
        };
      }),
    );
  };

  const updateChiefMechanic = (orderId: string, name: string) => {
    setWorkOrders((current) =>
      current.map((order) =>
        order.id === orderId ? { ...order, chiefMechanic: name } : order,
      ),
    );
  };

  const updateInspectionStatus = (
    orderId: string,
    itemId: string,
    status: InspectionItem["status"],
  ) => {
    setWorkOrders((current) =>
      current.map((order) => {
        if (order.id !== orderId) return order;
        return {
          ...order,
          inspectionItems: order.inspectionItems.map((item) =>
            item.id === itemId ? { ...item, status } : item,
          ),
        };
      }),
    );
  };

  const updateInspectionNote = (
    orderId: string,
    itemId: string,
    note: string,
  ) => {
    setWorkOrders((current) =>
      current.map((order) => {
        if (order.id !== orderId) return order;
        return {
          ...order,
          inspectionItems: order.inspectionItems.map((item) =>
            item.id === itemId ? { ...item, note } : item,
          ),
        };
      }),
    );
  };

  const updateInspectorRemarks = (orderId: string, remarks: string) => {
    setWorkOrders((current) =>
      current.map((order) =>
        order.id === orderId ? { ...order, inspectorRemarks: remarks } : order,
      ),
    );
  };

  const updatePartDetailField = (
    orderId: string,
    itemId: string,
    field: keyof PartDetailEntry,
    value: string,
  ) => {
    setWorkOrders((current) =>
      current.map((order) => {
        if (order.id !== orderId) return order;
        return {
          ...order,
          partDetails: {
            ...order.partDetails,
            [itemId]: {
              ...order.partDetails[itemId],
              [field]: value,
            },
          },
        };
      }),
    );
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
              if (existingOrder.id !== orderId) return existingOrder;
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
              if (existingOrder.id !== orderId) return existingOrder;
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
              if (existingOrder.id !== orderId) return existingOrder;
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
    { key: "execution" as StepKey, label: "Execution" },
    { key: "parts" as StepKey, label: "Parts, Cost & Photos" },
  ];

  const exportPDF = () => {
    if (selectedOrder) {
      Alert.alert("Export PDF", `Exporting ${selectedOrder.number} to PDF...`);
    }
  };

  const handleCompleteOrder = () => {
    if (!selectedOrder) return;

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

    Alert.alert(
      "Work Order Completed",
      `${selectedOrder.number} marked as complete`,
    );
    setSelectedOrderId(null);
  };

  const statusStyle = (status: WorkOrderStatus) => {
    switch (status) {
      case "Completed":
        return styles.statusCompleted;
      case "In Progress":
        return styles.statusInProgress;
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

  if (selectedOrder) {
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
                      {chiefMechanicOptions.map((option) => (
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
                      {chiefMechanicOptions.map((option) => (
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
            style={styles.bottomButtonPrimary}
            onPress={() => handleCompleteOrder()}
            disabled={
              !(
                selectedOrder.executionItems.length > 0 &&
                selectedOrder.executionItems.every(
                  (item) => item.status !== "pending",
                ) &&
                selectedOrder.executionItems
                  .filter((item) => item.status === "changed")
                  .every((item) => {
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
                  }) &&
                selectedOrder.chiefMechanic.trim().length > 0
              )
            }
          >
            <Text style={styles.bottomButtonPrimaryText}>Mark as Complete</Text>
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
          <Text style={styles.filterButtonText}>⊙</Text>
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
  orderNumber: { fontSize: 16, fontWeight: "800", color: "#1a1f6e" },
  statusBadge: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1.5,
  },
  statusPending: { backgroundColor: "#f8f8ff", borderColor: "#d9d6ef" },
  statusInProgress: { backgroundColor: "#dbeafe", borderColor: "#7dd3fc" },
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
  },
});
