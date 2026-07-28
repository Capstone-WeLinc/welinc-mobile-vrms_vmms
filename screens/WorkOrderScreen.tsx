import { useState } from "react";
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

import type { AuthenticatedUser, MobileAccessRole } from "../services/AuthService";

type WorkOrderStatus = "Pending" | "In Progress" | "Overdue" | "Completed";
type StepKey = 1 | 2 | 3;

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
  scheduleDetails: ScheduleDetail[];
  executionItems: ExecutionItem[];
  partsUsedItems: PartsUsedItem[];
  inspectionItems: InspectionItem[];
  chiefMechanic: string;
  inspectorRemarks: string;
  inspectionResultsPending: number;
  approvalStatus: "Pending verification" | "Approved" | "Rejected";
};

const initialWorkOrders: WorkOrder[] = [
  {
    id: "1",
    number: "WO-B7A8E877",
    plate: "LVR 8146",
    maintenanceType: "General Inspection",
    mechanic: "Danilo Sebastian",
    dateCreated: "2026-07-04",
    status: "Pending",
    summary: "General vehicle inspection and maintenance schedule review.",
    details: [
      "Vehicle: LVR 8146",
      "Garage: Pulilan",
      "Service Window: 09:00 - 12:00",
      "Priority: Medium",
    ],
    template: "General Inspection",
    scheduleDetails: [
      { label: "WORK ORDER NO.", value: "WO-B7A8E877" },
      { label: "ACCOUNT TYPE", value: "IN_HOUSE" },
      { label: "VEHICLE", value: "LVR 8146" },
      { label: "ODOMETER READING (KM)", value: "164700" },
      { label: "CHECKLIST TEMPLATE", value: "General Inspection" },
      { label: "SCHEDULE TRIGGER", value: "Time" },
      { label: "ASSIGNED MECHANIC", value: "Danilo Sebastian" },
      { label: "INTERVAL TYPE", value: "MONTHLY" },
      { label: "DATE CREATED", value: "2026-07-04" },
      { label: "START REFERENCE DATE", value: "2026-08-06" },
    ],
    executionItems: [
      {
        id: "e1",
        label: "Check all fluid levels",
        status: "pending",
        note: "",
      },
      {
        id: "e2",
        label: "Inspect underchassis for leaks or damage",
        status: "pending",
        note: "",
      },
      {
        id: "e3",
        label: "Test exterior and interior lights",
        status: "pending",
        note: "",
      },
      {
        id: "e4",
        label: "Inspect wiper blades and mirrors",
        status: "pending",
        note: "",
      },
      {
        id: "e5",
        label: "Confirm tools, jack, and safety kit are complete",
        status: "pending",
        note: "",
      },
    ],
    partsUsedItems: [
      {
        id: "p1",
        label: "Check all fluid levels",
        partsUsed: "Not applicable",
        materialCost: "0.00",
      },
      {
        id: "p2",
        label: "Inspect underchassis for leaks or damage",
        partsUsed: "Not applicable",
        materialCost: "0.00",
      },
      {
        id: "p3",
        label: "Test exterior and interior lights",
        partsUsed: "Not applicable",
        materialCost: "0.00",
      },
      {
        id: "p4",
        label: "Inspect wiper blades and mirrors",
        partsUsed: "Not applicable",
        materialCost: "0.00",
      },
      {
        id: "p5",
        label: "Confirm tools, jack, and safety kit are complete",
        partsUsed: "Not applicable",
        materialCost: "0.00",
      },
    ],
    inspectionItems: [
      {
        id: "i1",
        label: "Check all fluid levels",
        status: "pending",
        note: "",
      },
      {
        id: "i2",
        label: "Inspect underchassis for leaks or damage",
        status: "pending",
        note: "",
      },
      {
        id: "i3",
        label: "Test exterior and interior lights",
        status: "pending",
        note: "",
      },
      {
        id: "i4",
        label: "Inspect wiper blades and mirrors",
        status: "pending",
        note: "",
      },
      {
        id: "i5",
        label: "Confirm tools, jack, and safety kit are complete",
        status: "pending",
        note: "",
      },
    ],
    chiefMechanic: "",
    inspectorRemarks: "",
    inspectionResultsPending: 5,
    approvalStatus: "Pending verification",
  },
  {
    id: "2",
    number: "WO-D6D46868",
    plate: "TGD 908",
    maintenanceType: "General Inspection",
    mechanic: "Generoso Ramos",
    dateCreated: "2026-07-04",
    status: "In Progress",
    summary: "Vehicle inspection for maintenance compliance.",
    details: [
      "Vehicle: TGD 908",
      "Garage: Manila",
      "Service Window: 13:00 - 15:00",
      "Priority: Medium",
    ],
    template: "General Inspection",
    scheduleDetails: [
      { label: "WORK ORDER NO.", value: "WO-D6D46868" },
      { label: "ACCOUNT TYPE", value: "IN_HOUSE" },
      { label: "VEHICLE", value: "TGD 908" },
      { label: "ODOMETER READING (KM)", value: "145200" },
      { label: "CHECKLIST TEMPLATE", value: "General Inspection" },
      { label: "SCHEDULE TRIGGER", value: "Time" },
      { label: "ASSIGNED MECHANIC", value: "Generoso Ramos" },
      { label: "INTERVAL TYPE", value: "MONTHLY" },
      { label: "DATE CREATED", value: "2026-07-04" },
      { label: "START REFERENCE DATE", value: "2026-08-06" },
    ],
    executionItems: [
      {
        id: "e6",
        label: "Check all fluid levels",
        status: "checked",
        note: "Completed",
      },
      {
        id: "e7",
        label: "Inspect underchassis for leaks or damage",
        status: "pending",
        note: "",
      },
    ],
    partsUsedItems: [
      {
        id: "p6",
        label: "Check all fluid levels",
        partsUsed: "Not applicable",
        materialCost: "0.00",
      },
      {
        id: "p7",
        label: "Inspect underchassis for leaks or damage",
        partsUsed: "Not applicable",
        materialCost: "0.00",
      },
    ],
    inspectionItems: [
      {
        id: "i6",
        label: "Fluid level check",
        status: "pass",
        note: "All levels OK",
      },
      { id: "i7", label: "Body condition", status: "pending", note: "" },
    ],
    chiefMechanic: "",
    inspectorRemarks: "",
    inspectionResultsPending: 1,
    approvalStatus: "Pending verification",
  },
];

interface WorkOrderScreenProps {
  accessRole: MobileAccessRole;
  user: AuthenticatedUser;
}

export function WorkOrderScreen({ accessRole, user }: WorkOrderScreenProps) {
  const [workOrders, setWorkOrders] = useState(initialWorkOrders);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState<StepKey>(1);
  const [showChiefMechanicOptions, setShowChiefMechanicOptions] = useState(false);

  const chiefMechanicOptions = ["Ariel Santos", "Ramon Cruz", "Lorenzo Reyes"];
  const currentUserName = user.name.trim().toLowerCase();

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

  const updateChiefMechanic = (orderId: string, name: string) => {
    setWorkOrders((current) =>
      current.map((order) =>
        order.id === orderId ? { ...order, chiefMechanic: name } : order,
      ),
    );
  };

  const updateInspectorRemarks = (orderId: string, remarks: string) => {
    setWorkOrders((current) =>
      current.map((order) =>
        order.id === orderId ? { ...order, inspectorRemarks: remarks } : order,
      ),
    );
  };

  const calculateMaterialCost = (orderId: string): string => {
    const order = workOrders.find((o) => o.id === orderId);
    if (!order) return "0.00";
    const total = order.partsUsedItems.reduce((sum, item) => {
      const cost = parseFloat(item.materialCost) || 0;
      return sum + cost;
    }, 0);
    return total.toFixed(2);
  };

  const openOrder = (orderId: string) => {
    setSelectedOrderId(orderId);
    setActiveStep(1);
    setShowChiefMechanicOptions(false);
  };

  const isMechanicRole = accessRole === "mechanic";
  const isChiefMechanicRole = accessRole === "chiefMechanic";
  const canViewExecutionChecklist = isMechanicRole;
  const canViewInspectionChecklist = isChiefMechanicRole;

  const visibleSteps = [
    { step: 1, label: "Details" },
    ...(canViewExecutionChecklist ? [{ step: 2, label: "Execution" }] : []),
    ...(canViewInspectionChecklist
      ? [
          {
            step: canViewExecutionChecklist ? 3 : 2,
            label: "Inspection",
          },
        ]
      : []),
  ];

  const exportPDF = () => {
    if (selectedOrder) {
      Alert.alert("Export PDF", `Exporting ${selectedOrder.number} to PDF...`);
    }
  };

  const handleCompleteOrder = () => {
    if (!selectedOrder) return;

    if (isMechanicRole && !selectedOrder.chiefMechanic.trim()) {
      Alert.alert(
        "Chief Mechanic Required",
        "Select an available chief mechanic before completing execution.",
      );
      return;
    }

    Alert.alert("Work Order Completed", `${selectedOrder.number} marked as complete`);
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
              key={item.step}
              style={[
                styles.stepButton,
                activeStep === item.step && styles.stepButtonActive,
              ]}
              onPress={() => setActiveStep(item.step as StepKey)}
            >
              <Text
                style={[
                  styles.stepButtonText,
                  activeStep === item.step && styles.stepButtonTextActive,
                ]}
              >
                {item.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <ScrollView contentContainerStyle={styles.detailContent}>
          {/* Step 1: Schedule Details & Execution */}
          {activeStep === 1 && (
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
              </View>

            </>
          )}

          {/* Step 2: Role-specific checklist */}
          {activeStep === 2 && canViewExecutionChecklist && (
            <View style={styles.detailCard}>
              <Text style={styles.sectionTitle}>Execution Checklist</Text>
              <Text style={styles.sectionText}>
                Mechanics must select Checked, Changed, or Not Checked for each
                execution item before completing execution.
              </Text>
              {selectedOrder.executionItems.map((item) => (
                <View key={item.id} style={styles.checklistItemCard}>
                  <Text style={styles.checklistItemLabel}>{item.label}</Text>
                  <View style={styles.checklistItemStatus}>
                    <Text style={styles.statusLabel}>NO PART CHANGE RECORDED</Text>
                  </View>
                  <View style={styles.pillButtonRow}>
                    {[
                      { key: "checked", label: "Checked", color: "#e0e7ff" },
                      { key: "changed", label: "Changed", color: "#fef3c7" },
                      {
                        key: "notChecked",
                        label: "Not Checked",
                        color: "#f3f4f6",
                      },
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
              ))}

              <View style={styles.chiefMechanicSection}>
                <Text style={styles.sectionTitle}>Chief Mechanic</Text>
                <Text style={styles.sectionText}>
                  Assign a chief mechanic before completing execution.
                </Text>
                <View style={styles.dropdownSection}>
                  <Text style={styles.dropdownLabel}>Select Chief Mechanic</Text>
                  <TouchableOpacity
                    style={styles.dropdownButton}
                    onPress={() => setShowChiefMechanicOptions((value) => !value)}
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
                          <Text style={styles.dropdownOptionText}>{option}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
              </View>
            </View>
          )}

          {(activeStep === 2 || activeStep === 3) && canViewInspectionChecklist && (!canViewExecutionChecklist || activeStep === 3) && (
            <View style={styles.detailCard}>
              <View style={styles.inspectionHeader}>
                <Text style={styles.sectionTitle}>Inspection Checklist</Text>
                <View style={styles.reviewBadge}>
                  <Text style={styles.reviewBadgeText}>Review</Text>
                </View>
              </View>
              <Text style={styles.sectionText}>
                Review inspection results and remarks in read-only mode.
              </Text>

              {selectedOrder.inspectionItems.map((item) => (
                <View key={item.id} style={styles.inspectionItemCard}>
                  <Text style={styles.inspectionItemLabel}>{item.label}</Text>
                  <View style={styles.inspectionPillRow}>
                    <TouchableOpacity
                      style={[
                        styles.inspectionPillButton,
                        item.status === "pass" && styles.inspectionPillPass,
                      ]}
                      onPress={() =>
                        updateInspectionStatus(
                          selectedOrder.id,
                          item.id,
                          "pass",
                        )
                      }
                    >
                      <Text
                        style={[
                          styles.inspectionPillText,
                          item.status === "pass" &&
                            styles.inspectionPillTextActive,
                        ]}
                      >
                        PASS
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.inspectionPillButton,
                        item.status === "fail" && styles.inspectionPillFail,
                      ]}
                      onPress={() =>
                        updateInspectionStatus(
                          selectedOrder.id,
                          item.id,
                          "fail",
                        )
                      }
                    >
                      <Text
                        style={[
                          styles.inspectionPillText,
                          item.status === "fail" &&
                            styles.inspectionPillTextActive,
                        ]}
                      >
                        FAIL
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <TextInput
                    style={styles.noteInput}
                    placeholder="Add inspection note"
                    placeholderTextColor="#94a3b8"
                    value={item.note}
                    onChangeText={(text) =>
                      updateInspectionNote(selectedOrder.id, item.id, text)
                    }
                  />
                </View>
              ))}

              {/* Inspector Remarks */}
              <View style={styles.remarksSection}>
                <Text style={styles.remarksLabel}>INSPECTOR REMARKS</Text>
                <TextInput
                  style={styles.remarksInput}
                  placeholder="Add inspection remarks"
                  placeholderTextColor="#94a3b8"
                  value={selectedOrder.inspectorRemarks}
                  onChangeText={(text) =>
                    updateInspectorRemarks(selectedOrder.id, text)
                  }
                  multiline
                  numberOfLines={4}
                />
              </View>

              {/* Inspection Results & Approval */}
              <View style={styles.resultsRow}>
                <View style={styles.resultsCard}>
                  <Text style={styles.resultsLabel}>INSPECTION RESULTS</Text>
                  <Text style={styles.resultsValue}>
                    {selectedOrder.inspectionResultsPending} item(s) pending
                  </Text>
                </View>
                <View style={styles.resultsCard}>
                  <Text style={styles.resultsLabel}>
                    APPROVAL / VERIFICATION
                  </Text>
                  <Text style={styles.resultsValue}>
                    {selectedOrder.approvalStatus}
                  </Text>
                </View>
              </View>
            </View>
          )}
        </ScrollView>

        {/* Bottom Navigation */}
        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={styles.bottomButtonSecondary}
            onPress={() =>
              setActiveStep((step) => (step > 1 ? ((step - 1) as StepKey) : 1))
            }
          >
            <Text style={styles.bottomButtonSecondaryText}>Previous</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.bottomButtonPrimary}
            onPress={() => {
              const maxStep = visibleSteps[visibleSteps.length - 1].step as StepKey;
              setActiveStep((step) =>
                step < maxStep ? ((step + 1) as StepKey) : maxStep,
              );
            }}
          >
            <Text style={styles.bottomButtonPrimaryText}>Next</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.bottomButtonPrimary}
            onPress={() => handleCompleteOrder()}
            disabled={isMechanicRole && !selectedOrder.chiefMechanic.trim()}
          >
            <Text style={styles.bottomButtonPrimaryText}>Mark Complete</Text>
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
              : "Complete your assigned execution checklist tasks"}
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
        {filteredOrders.length === 0 ? (
          <View style={styles.emptyStateCard}>
            <Text style={styles.emptyStateTitle}>No assigned work orders</Text>
            <Text style={styles.emptyStateText}>
              {accessRole === "mechanic"
                ? "No execution work orders are assigned to you right now."
                : "No inspection work orders are assigned to you right now."}
            </Text>
          </View>
        ) : null}
        {filteredOrders.map((order) => (
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
              <Text style={styles.cardValue}>{order.maintenanceType}</Text>
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
  title: { fontSize: 22, fontWeight: "700", color: "#0d0d0d" },
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
  orderNumber: { fontSize: 16, fontWeight: "700", color: "#1a1f6e" },
  statusBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  statusPending: { backgroundColor: "#fef2f2" },
  statusInProgress: { backgroundColor: "#e0f2fe" },
  statusOverdue: { backgroundColor: "#fef3c7" },
  statusCompleted: { backgroundColor: "#dcfce7" },
  statusBadgeText: { fontSize: 11, fontWeight: "700", color: "#0d0d0d" },
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
    padding: 16,
    gap: 12,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: "#0d0d0d" },
  sectionText: { color: "#64748b", fontSize: 13 },

  /* Schedule Details */
  scheduleGrid: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  scheduleItem: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  scheduleLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#64748b",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  scheduleValue: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0d0d0d",
  },

  /* Execution Checklist */
  checklistItemCard: {
    backgroundColor: "#f8fafc",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 12,
    gap: 10,
    marginBottom: 12,
  },
  checklistItemLabel: {
    fontSize: 14,
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
  partsItemCard: {
    backgroundColor: "#f8fafc",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 12,
    gap: 10,
    marginBottom: 12,
  },
  partsItemTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0d0d0d",
  },
  partsLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#64748b",
    textTransform: "uppercase",
    marginBottom: 4,
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
