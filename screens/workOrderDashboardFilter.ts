export const dashboardWorkOrderStatuses = [
  "Pending",
  "Due",
  "In Progress",
  "Overdue",
  "Awaiting Review",
  "Completed",
  "Returned",
] as const;

export type DashboardWorkOrderStatus =
  (typeof dashboardWorkOrderStatuses)[number];

export type DashboardWorkOrderFilter = {
  status: DashboardWorkOrderStatus;
  mechanicId: string | null;
  mechanicName: string | null;
};

export function wasInProgressBeforeOverdue(workOrderProgress?: string | null): boolean {
  if (!workOrderProgress) return false;
  try {
    const progress: unknown = JSON.parse(workOrderProgress);
    return (
      typeof progress === "object" &&
      progress !== null &&
      !Array.isArray(progress) &&
      "overdueFromStatus" in progress &&
      progress.overdueFromStatus === "IN_PROGRESS"
    );
  } catch {
    return false;
  }
}

export function matchesWorkOrderDashboardFilter(
  order: {
    status: string;
    mechanicSubmitted: boolean;
    assignedMechanicId: string | null;
    workOrderProgress?: string | null;
  },
  statusFilter: string | null,
  mechanicFilterId: string | null,
): boolean {
  if (mechanicFilterId && order.assignedMechanicId !== mechanicFilterId) {
    return false;
  }

  if (!statusFilter) return true;

  switch (statusFilter) {
    case "Pending":
      return (
        ![
          "Completed",
          "Rejected",
          "For Repair",
          "Done",
          "For Verification",
          "Due",
          "In Progress",
          "Overdue",
          "Cancelled",
        ].includes(order.status) &&
        !order.mechanicSubmitted
      );
    case "In Progress":
      return (
        order.status === statusFilter ||
        (order.status === "Overdue" &&
          wasInProgressBeforeOverdue(order.workOrderProgress))
      );
    case "Due":
    case "Overdue":
    case "Completed":
      return order.status === statusFilter;
    case "Awaiting Review":
      return (
        !["Completed", "Rejected", "For Repair"].includes(order.status) &&
        (order.status === "Done" ||
          order.status === "For Verification" ||
          order.mechanicSubmitted)
      );
    case "Returned":
      return order.status === "Rejected" || order.status === "For Repair";
    default:
      return order.status === statusFilter;
  }
}
