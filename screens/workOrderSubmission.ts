export function normalizePartDetails<T>(value: unknown): Record<string, T> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, T>;
}

export function getChangedExecutionItems<T extends { status: string }>(
  items: readonly T[],
): T[] {
  return items.filter((item) => item.status === "changed");
}

export function mergeUploadedAttachments<T extends { name: string; storageName?: string }>(
  existing: readonly T[],
  uploaded: T,
): T[] {
  return [
    ...existing.filter((file) => file.storageName || file.name.toLowerCase() !== uploaded.name.toLowerCase()),
    uploaded,
  ];
}

export interface PartDetailEntry {
  partsUsed: string;
  quantity: string;
  materialCost: string;
  attachments: { id: string; name: string; sizeMb: number; contentType?: string; storageName?: string }[];
  attachmentName: string;
}

const asText = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

export function normalizePartDetailEntries(value: unknown): Record<string, PartDetailEntry> {
  const entries = normalizePartDetails<Record<string, unknown>>(value);
  return Object.fromEntries(Object.entries(entries).map(([key, raw]) => {
    const entry = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const attachments = Array.isArray(entry.attachments)
      ? entry.attachments.flatMap((attachment, index) => {
          if (!attachment || typeof attachment !== "object" || Array.isArray(attachment)) return [];
          const item = attachment as Record<string, unknown>;
          const size = Number(item.sizeMb);
          return [{
            id: asText(item.id) || `${key}-attachment-${index}`,
            name: asText(item.name),
            sizeMb: Number.isFinite(size) && size >= 0 ? size : 0,
            ...(typeof item.contentType === "string" ? { contentType: item.contentType } : {}),
            ...(typeof item.storageName === "string" ? { storageName: item.storageName } : {}),
          }];
        })
      : [];
    return [key, {
      partsUsed: asText(entry.partsUsed),
      quantity: asText(entry.quantity),
      materialCost: asText(entry.materialCost),
      attachments,
      attachmentName: asText(entry.attachmentName),
    }];
  }));
}

export function getChecklistSubmissionError(
  items: readonly { label: string; status: string }[],
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
  items: readonly { id: string; label: string; status: string }[],
  partDetails: Record<string, {
    partsUsed?: string;
    quantity?: string;
    materialCost?: string;
    attachments?: readonly unknown[];
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
