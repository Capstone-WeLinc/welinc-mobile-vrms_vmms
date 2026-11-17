export type PrioritizedWorkOrder = {
  id: string;
  number: string;
  status: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  startDate: string | null;
  createdAtTimestamp: number;
};

const priorityRank: Record<PrioritizedWorkOrder["priority"], number> = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2,
};

function dateRank(value: string | null): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
}

function timestampRank(value: number): number {
  return Number.isFinite(value) && value > 0
    ? value
    : Number.POSITIVE_INFINITY;
}

function compareNumbers(left: number, right: number): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function sortWorkOrdersForQueue<T extends PrioritizedWorkOrder>(
  workOrders: readonly T[],
): T[] {
  return [...workOrders].sort((left, right) =>
    Number(right.status === "Overdue") - Number(left.status === "Overdue") ||
    priorityRank[left.priority] - priorityRank[right.priority] ||
    compareNumbers(dateRank(left.startDate), dateRank(right.startDate)) ||
    compareNumbers(
      timestampRank(left.createdAtTimestamp),
      timestampRank(right.createdAtTimestamp),
    ) ||
    left.number.localeCompare(right.number, undefined, { numeric: true }) ||
    left.id.localeCompare(right.id),
  );
}
