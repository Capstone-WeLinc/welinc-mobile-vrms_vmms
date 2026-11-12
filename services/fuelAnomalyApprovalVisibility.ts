export type FuelApprovalAccessRole = "chiefMechanic" | "mechanic";

type FuelApprovalCandidate = {
  status: string;
  severity: string;
  acknowledgedAt: string | null;
};

export function shouldShowFuelAnomalyApprovalPanel(role: FuelApprovalAccessRole): boolean {
  return role === "chiefMechanic";
}

export function getPendingCriticalFuelApprovals<T extends FuelApprovalCandidate>(
  role: FuelApprovalAccessRole,
  anomalies: T[],
): T[] {
  if (!shouldShowFuelAnomalyApprovalPanel(role)) return [];
  return anomalies.filter((item) => item.status === "OPEN" && item.severity === "CRITICAL" && !item.acknowledgedAt);
}
