export function getChecklistSubmissionError(
  items: ReadonlyArray<{ label: string; status: string }>,
): string | null {
  if (items.length === 0) {
    return "No checklist items are available. Refresh the work order or ask Operations to assign a checklist.";
  }
  const incomplete = items.filter((item) =>
    item.status !== "checked" && item.status !== "changed",
  );
  if (incomplete.length === 0) return null;
  return `Complete every assigned checklist item before submitting:\n${incomplete.map((item) => `- ${item.label}`).join("\n")}`;
}
