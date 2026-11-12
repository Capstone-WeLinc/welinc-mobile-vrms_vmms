export type MobileAccessRole = "mechanic" | "chiefMechanic" | "none";

export function getMobileAccessRole(
  roles: Array<{ role: string; system: string }> | undefined,
): MobileAccessRole {
  const vmmsRoles = (roles ?? []).flatMap((assignment) => {
    if (
      typeof assignment?.role !== "string" ||
      typeof assignment.system !== "string" ||
      assignment.system.trim().toUpperCase() !== "VMMS"
    ) {
      return [];
    }
    return [assignment.role.trim().toLowerCase()];
  });

  if (vmmsRoles.some((value) => value.includes("chief"))) {
    return "chiefMechanic";
  }

  if (vmmsRoles.some((value) => value.includes("mechanic"))) {
    return "mechanic";
  }

  return "none";
}
