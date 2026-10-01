export function normalizePartDetails<T>(value: unknown): Record<string, T> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, T>;
}

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

export function getChangedPartsSubmissionError(
  items: ReadonlyArray<{ id: string; label: string; status: string }>,
  partDetails: Record<string, {
    partsUsed?: string;
    quantity?: string;
    materialCost?: string;
    attachments?: ReadonlyArray<unknown>;
  }>,
): string | null {
  const incomplete = items.filter((item) => {
    if (item.status !== "changed") return false;
    const entry = partDetails[item.id];
    const quantity = Number(entry?.quantity);
    const cost = Number(entry?.materialCost);
    return !entry?.partsUsed?.trim() || !Number.isFinite(quantity) || quantity <= 0 ||
      !entry?.materialCost?.trim() || !Number.isFinite(cost) || cost < 0 || !entry.attachments?.length;
  });
  if (!incomplete.length) return null;
  return `Record the parts, quantity, cost, and an attachment for each changed item:\n${incomplete.map((item) => `- ${item.label}`).join("\n")}`;
}
