export const dashboardWorkOrderStatuses = [
  "Pending",
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

export function matchesWorkOrderDashboardFilter(
  order: {
    status: string;
    mechanicSubmitted: boolean;
    assignedMechanicId: string | null;
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
          "In Progress",
          "Overdue",
          "Cancelled",
        ].includes(order.status) &&
        !order.mechanicSubmitted
      );
    case "In Progress":
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
