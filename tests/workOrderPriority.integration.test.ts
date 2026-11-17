import { sortWorkOrdersForQueue } from "../screens/workOrderPriority";

function order(
  id: string,
  priority: "HIGH" | "MEDIUM" | "LOW",
  startDate: string | null,
  createdAtTimestamp: number,
  number = id,
  status = "Pending",
) {
  return { id, number, priority, startDate, createdAtTimestamp, status };
}

test("puts overdue work first, then sorts by priority and preserves the order after filtering", () => {
  const workOrders = [
    order("low-pending", "LOW", "2025-01-01", 1),
    order("medium-late-pending", "MEDIUM", "2025-03-01", 1),
    order("high-pending", "HIGH", "2025-01-01", 1),
    order("medium-early-pending", "MEDIUM", "2025-02-01", 1),
    order("low-overdue", "LOW", "2025-01-01", 1, "WO-5", "Overdue"),
    order("high-overdue", "HIGH", "2025-03-01", 1, "WO-6", "Overdue"),
    order("medium-overdue", "MEDIUM", "2025-02-01", 1, "WO-7", "Overdue"),
  ];

  expect(sortWorkOrdersForQueue(workOrders).map((item) => item.id)).toEqual([
    "high-overdue",
    "medium-overdue",
    "low-overdue",
    "high-pending",
    "medium-early-pending",
    "medium-late-pending",
    "low-pending",
  ]);
  expect(
    sortWorkOrdersForQueue(
      workOrders.filter((item) => item.priority === "MEDIUM"),
    ).map((item) => item.id),
  ).toEqual([
    "medium-overdue",
    "medium-early-pending",
    "medium-late-pending",
  ]);
  expect(
    sortWorkOrdersForQueue(
      workOrders.filter((item) => item.status === "Pending"),
    ).map((item) => item.id),
  ).toEqual([
    "high-pending",
    "medium-early-pending",
    "medium-late-pending",
    "low-pending",
  ]);
});

test("orders equal priorities by scheduled start, creation age, then work order number", () => {
  const workOrders = [
    order("latest-start", "HIGH", "2025-03-01", 1, "WO-1"),
    order("missing-start", "HIGH", null, 1, "WO-0"),
    order("newest-created", "HIGH", "2025-01-01", 30, "WO-2"),
    order("older-wo-10", "HIGH", "2025-01-01", 10, "WO-10"),
    order("older-wo-2", "HIGH", "2025-01-01", 10, "WO-2"),
  ];

  expect(sortWorkOrdersForQueue(workOrders).map((item) => item.id)).toEqual([
    "older-wo-2",
    "older-wo-10",
    "newest-created",
    "latest-start",
    "missing-start",
  ]);
});
