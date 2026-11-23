import {
  buildNotificationSearchItems,
  buildWorkOrderSearchItems,
  filterGlobalSearchItems,
  getGlobalSearchDestination,
  type SearchableSchedule,
  type SearchableVehicle,
} from "../services/globalSearch";
import { canOpenWorkOrder } from "../screens/workOrderReview";

function schedule(overrides: Partial<SearchableSchedule> = {}): SearchableSchedule {
  return {
    id: "schedule-1",
    workOrderNumber: "WO-001",
    vehicleId: "vehicle-1",
    title: "Oil change",
    status: "DUE",
    priority: "HIGH",
    assignedMechanic: "Mechanic One",
    assignedMechanicId: "mechanic-1",
    chiefMechanicId: "chief-1",
    deletedAt: null,
    ...overrides,
  };
}

test("builds only role-visible work-order search items with associated vehicle details", () => {
  const schedules = [
    schedule(),
    schedule({
      id: "schedule-2",
      workOrderNumber: "WO-002",
      assignedMechanicId: "mechanic-2",
      chiefMechanicId: "chief-1",
    }),
    schedule({
      id: "schedule-3",
      workOrderNumber: "WO-003",
      chiefMechanicId: "chief-2",
    }),
    schedule({ id: "deleted", deletedAt: "2026-01-01T00:00:00.000Z" }),
  ];
  const vehicles: SearchableVehicle[] = [
    { id: "vehicle-1", plateNumber: "ABC-123", model: "Truck Model A" },
  ];

  const mechanicItems = buildWorkOrderSearchItems(
    schedules,
    vehicles,
    "mechanic-1",
    "mechanic",
  );
  const chiefItems = buildWorkOrderSearchItems(
    schedules,
    vehicles,
    "chief-1",
    "chiefMechanic",
  );

  expect(mechanicItems.map((item) => item.workOrderId)).toEqual([
    "schedule-1",
    "schedule-3",
  ]);
  expect(chiefItems.map((item) => item.workOrderId)).toEqual([
    "schedule-1",
    "schedule-2",
  ]);
  expect(mechanicItems[0].searchText).toContain("ABC-123");
  expect(mechanicItems[0].searchText).toContain("Truck Model A");
});

test("trims and case-folds searches across work orders and notifications", () => {
  const workOrders = buildWorkOrderSearchItems(
    [schedule()],
    [{ id: "vehicle-1", plateNumber: "ABC-123", model: "Truck Model A" }],
    "mechanic-1",
    "mechanic",
  );
  const notifications = buildNotificationSearchItems([
    {
      id: "notification-1",
      scheduleId: "schedule-1",
      kind: "OVERDUE",
      message: "Vehicle service is overdue",
      createdAt: "2026-01-01T00:00:00.000Z",
      readAt: null,
      source: "maintenance",
    },
  ]);

  expect(
    filterGlobalSearchItems([...workOrders, ...notifications], "  aBc-123  ").map(
      (item) => item.id,
    ),
  ).toEqual(["work-order:schedule-1"]);
  expect(
    filterGlobalSearchItems([...workOrders, ...notifications], "  OVERDUE ").map(
      (item) => item.id,
    ),
  ).toEqual(["notification:maintenance:notification-1"]);
  expect(filterGlobalSearchItems(workOrders, "   ")).toEqual([]);
  expect(
    filterGlobalSearchItems(notifications, "schedule-1"),
  ).toEqual([]);
});

test("routes search results through accessible existing workflows", () => {
  const [workOrder] = buildWorkOrderSearchItems(
    [schedule()],
    [],
    "mechanic-1",
    "mechanic",
  );
  const [scheduledNotification, generalNotification] = buildNotificationSearchItems([
    {
      id: "scheduled",
      scheduleId: "schedule-1",
      kind: "DUE",
      message: "A schedule is due",
      createdAt: "2026-01-01T00:00:00.000Z",
      readAt: null,
      source: "maintenance",
    },
    {
      id: "general",
      kind: "FUEL_ANOMALY",
      message: "Fuel anomaly requires review",
      createdAt: "2026-01-01T00:00:00.000Z",
      readAt: null,
      source: "general",
    },
  ]);

  expect(getGlobalSearchDestination(workOrder)).toEqual({
    screen: "work-orders",
    workOrderId: "schedule-1",
  });
  expect(getGlobalSearchDestination(scheduledNotification)).toEqual({
    screen: "work-orders",
    workOrderId: "schedule-1",
  });
  expect(getGlobalSearchDestination(generalNotification)).toEqual({
    screen: "notifications",
  });
});

test("deep links respect the same work-order visibility as each role's list", () => {
  const visibleSchedule = {
    assignedMechanicId: "mechanic-1",
    chiefMechanicId: "chief-1",
  };
  const otherSchedule = {
    assignedMechanicId: "mechanic-2",
    chiefMechanicId: "chief-2",
  };
  const chiefSupervisedSchedule = {
    assignedMechanicId: "mechanic-2",
    chiefMechanicId: "chief-1",
  };

  expect(canOpenWorkOrder(visibleSchedule, "mechanic", "mechanic-1")).toBe(true);
  expect(canOpenWorkOrder(visibleSchedule, "chiefMechanic", "chief-1")).toBe(true);
  expect(canOpenWorkOrder(chiefSupervisedSchedule, "mechanic", "mechanic-1")).toBe(false);
  expect(canOpenWorkOrder(chiefSupervisedSchedule, "chiefMechanic", "chief-1")).toBe(true);
  expect(canOpenWorkOrder(otherSchedule, "mechanic", "mechanic-1")).toBe(false);
  expect(canOpenWorkOrder(otherSchedule, "chiefMechanic", "chief-1")).toBe(false);
});
