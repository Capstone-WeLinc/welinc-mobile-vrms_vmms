export function isAwaitingChiefReview(order: {
  chiefMechanicId: string | null;
  mechanicSubmitted: boolean;
  status: string;
}, chiefId: string): boolean {
  return order.chiefMechanicId === chiefId && order.mechanicSubmitted &&
    (order.status === 'Done' || order.status === 'For Verification');
}

export function canOpenWorkOrder(
  order: { assignedMechanicId: string | null; chiefMechanicId: string | null },
  accessRole: "mechanic" | "chiefMechanic",
  userId: string,
): boolean {
  return accessRole === "mechanic"
    ? order.assignedMechanicId === userId
    : order.chiefMechanicId === userId;
}

export function submittedReviewState(status: string) {
  return status === 'DONE' ? { status: 'Done' as const, mechanicSubmitted: true } : {};
}
