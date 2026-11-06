/** Return the persisted work order number without synthesizing one from the schedule ID. */
export function getPersistedWorkOrderNumber(value: string | null | undefined): string {
  return value?.trim() || "N/A";
}
