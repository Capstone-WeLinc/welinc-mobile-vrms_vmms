export type InspectionRemark = "Verified" | "Rejected" | "For Repair" | "Unverified";

type InspectionStatus = "pass" | "fail" | "pending";

export const getAutomaticInspectionRemark = (
  inspectionItems: readonly { status: InspectionStatus }[],
): InspectionRemark => {
  if (
    inspectionItems.length === 0 ||
    inspectionItems.some((item) => item.status === "pending")
  ) {
    return "Unverified";
  }

  if (inspectionItems.some((item) => item.status === "fail")) {
    return "For Repair";
  }
  return "Verified";
};
