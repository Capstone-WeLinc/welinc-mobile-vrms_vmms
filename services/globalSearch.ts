import type { MaintenanceNotification } from "./NotificationService";

export interface SearchableSchedule {
  id: string;
  workOrderNumber: string;
  vehicleId: string;
  title: string;
  status: string;
  priority: string;
  assignedMechanic: string | null;
  assignedMechanicId: string | null;
  chiefMechanicId: string | null;
  deletedAt: string | null;
}

export interface SearchableVehicle {
  id: string;
  plateNumber: string;
  model: string;
}

export interface WorkOrderSearchItem {
  id: string;
  kind: "work-order";
  title: string;
  detail: string;
  searchText: string;
  workOrderId: string;
}

export interface NotificationSearchItem {
  id: string;
  kind: "notification";
  title: string;
  detail: string;
  searchText: string;
  notification: MaintenanceNotification;
}

export type GlobalSearchItem = WorkOrderSearchItem | NotificationSearchItem;

export type GlobalSearchDestination =
  | { screen: "work-orders"; workOrderId: string }
  | { screen: "notifications" };

export function buildWorkOrderSearchItems(
  schedules: SearchableSchedule[],
  vehicles: SearchableVehicle[],
  userId: string,
  accessRole: "mechanic" | "chiefMechanic",
): WorkOrderSearchItem[] {
  const vehiclesById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));

  return schedules
    .filter((schedule) => {
      if (schedule.deletedAt !== null) return false;
      return accessRole === "mechanic"
        ? schedule.assignedMechanicId === userId
        : schedule.chiefMechanicId === userId;
    })
    .map((schedule) => {
      const vehicle = vehiclesById.get(schedule.vehicleId);
      const title = schedule.workOrderNumber || schedule.title;
      const detail = [
        schedule.title,
        vehicle?.plateNumber,
        schedule.status.replace(/_/g, " "),
      ]
        .filter((value): value is string => Boolean(value))
        .join(" · ");
      const searchText = [
        schedule.workOrderNumber,
        schedule.title,
        schedule.status,
        schedule.priority,
        schedule.assignedMechanic,
        vehicle?.plateNumber,
        vehicle?.model,
      ]
        .filter((value): value is string => Boolean(value))
        .join(" ");

      return {
        id: `work-order:${schedule.id}`,
        kind: "work-order",
        title,
        detail,
        searchText,
        workOrderId: schedule.id,
      };
    });
}

export function buildNotificationSearchItems(
  notifications: MaintenanceNotification[],
): NotificationSearchItem[] {
  return notifications.map((notification) => ({
    id: `notification:${notification.source}:${notification.id}`,
    kind: "notification",
    title: notification.message,
    detail: notification.kind.replace(/_/g, " "),
    searchText: [
      notification.message,
      notification.kind,
    ]
      .filter((value): value is string => Boolean(value))
      .join(" "),
    notification,
  }));
}

export function filterGlobalSearchItems(
  items: GlobalSearchItem[],
  query: string,
): GlobalSearchItem[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];

  return items.filter((item) =>
    item.searchText.toLowerCase().includes(normalizedQuery),
  );
}

export function getGlobalSearchDestination(
  item: GlobalSearchItem,
): GlobalSearchDestination {
  if (item.kind === "work-order") {
    return { screen: "work-orders", workOrderId: item.workOrderId };
  }

  return item.notification.scheduleId
    ? { screen: "work-orders", workOrderId: item.notification.scheduleId }
    : { screen: "notifications" };
}
