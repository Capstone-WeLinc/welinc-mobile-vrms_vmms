export interface WorkOrderPdfData {
  number: string;
  plate: string;
  maintenanceType: string;
  maintenanceClass: string;
  status: string;
  mechanic: string;
  template: string;
  dateCreated: string;
  startDate: string | null;
  serviceOdometerReading: number | null;
  summary: string;
  scheduleDetails: readonly { label: string; value: string }[];
  maintenanceRemarks: string;
  rejectionRemarks: string;
  executionItems: readonly {
    id: string;
    label: string;
    status: "checked" | "changed" | "notChecked" | "pending";
    note: string;
  }[];
  partDetails: Record<string, {
    partsUsed?: string;
    quantity?: string;
    materialCost?: string;
    attachments?: readonly { name: string }[];
  }>;
}

const escapedCharacters: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#39;",
};

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => escapedCharacters[character]);

const displayValue = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined || String(value).trim() === "") {
    return "Not recorded";
  }
  return String(value);
};

const executionStatusLabels: Record<
  WorkOrderPdfData["executionItems"][number]["status"],
  string
> = {
  checked: "Checked",
  changed: "Changed",
  notChecked: "Not checked",
  pending: "Pending",
};

function renderRows(rows: readonly (readonly [string, string])[]): string {
  return rows
    .map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join("");
}

export function buildWorkOrderPdfHtml(
  workOrder: WorkOrderPdfData,
  generatedAt = new Date(),
): string {
  const scheduleLabels = new Set(
    workOrder.scheduleDetails.map((detail) => detail.label.toLowerCase()),
  );
  const detailRows: [string, string][] = workOrder.scheduleDetails.map(
    (detail): [string, string] => [detail.label, detail.value],
  );
  const additionalRows: [string, string][] = [
    ["Work Order No.", workOrder.number],
    ["Vehicle", workOrder.plate],
    ["Maintenance Type", workOrder.maintenanceType],
    ["Maintenance Class", workOrder.maintenanceClass],
    ["Status", workOrder.status],
    ["Assigned Mechanic", workOrder.mechanic],
    ["Checklist Template", workOrder.template],
    ["Date Created", workOrder.dateCreated],
    ["Scheduled Start Date", workOrder.startDate ?? "Not scheduled"],
    [
      "Odometer at Time of Service (km)",
      displayValue(workOrder.serviceOdometerReading),
    ],
  ];
  additionalRows.forEach(([label, value]) => {
    if (!scheduleLabels.has(label.toLowerCase())) detailRows.push([label, value]);
  });

  const partRows = workOrder.executionItems
    .filter((item) => item.status === "changed")
    .flatMap((item) => {
      const details = workOrder.partDetails[item.id];
      if (!details || (!details.partsUsed?.trim() && !details.attachments?.length)) {
        return [];
      }
      const attachments = details.attachments?.map((attachment) => attachment.name).join(", ");
      return [
        `<tr class="keep-together"><td>${escapeHtml(item.label)}</td>` +
          `<td>${escapeHtml(displayValue(details.partsUsed))}</td>` +
          `<td>${escapeHtml(displayValue(details.quantity))}</td>` +
          `<td>${escapeHtml(details.materialCost ? `PHP ${details.materialCost}` : "Not recorded")}</td>` +
          `<td>${escapeHtml(displayValue(attachments))}</td></tr>`,
      ];
    })
    .join("");

  const executionRows = workOrder.executionItems
    .map((item) => (
      `<tr class="keep-together"><td>${escapeHtml(item.label)}</td>` +
      `<td>${escapeHtml(executionStatusLabels[item.status])}</td>` +
      `<td class="notes">${escapeHtml(displayValue(item.note))}</td></tr>`
    ))
    .join("");
  const generatedLabel = generatedAt.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
  });

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      @page { size: A4; margin: 18mm 15mm; }
      body { color: #1e293b; font: 10.5pt/1.45 Arial, sans-serif; }
      header { border-bottom: 2px solid #d4a93f; margin-bottom: 22px; padding-bottom: 12px; }
      .brand { color: #1a1f6e; font-size: 10pt; font-weight: 700; letter-spacing: 1px; }
      h1 { color: #1a1f6e; font-size: 22pt; margin: 8px 0 2px; }
      .generated { color: #64748b; font-size: 9pt; margin: 0; }
      h2 { border-bottom: 1px solid #cbd5e1; color: #1a1f6e; font-size: 16pt; margin: 0 0 14px; padding-bottom: 7px; }
      h3 { color: #1a1f6e; font-size: 12pt; margin: 18px 0 8px; }
      table { border-collapse: collapse; margin: 0 0 18px; width: 100%; }
      th, td { border-bottom: 1px solid #e2e8f0; padding: 7px 8px; text-align: left; vertical-align: top; }
      th { color: #475569; font-size: 9pt; font-weight: 700; width: 32%; }
      td { overflow-wrap: anywhere; }
      thead th { background: #f1f5f9; color: #334155; }
      .notes { white-space: pre-wrap; }
      .keep-together { break-inside: avoid; page-break-inside: avoid; }
      .empty { color: #64748b; font-style: italic; }
      .remarks { background: #f8fafc; border-radius: 6px; padding: 10px 12px; white-space: pre-wrap; }
      #execution { break-before: page; page-break-before: always; }
    </style>
  </head>
  <body>
    <header>
      <div class="brand">WELINC VMMS</div>
      <h1>Work Order ${escapeHtml(displayValue(workOrder.number))}</h1>
      <p class="generated">Generated ${escapeHtml(generatedLabel)}</p>
    </header>
    <section id="details">
      <h2>Details</h2>
      <table><tbody>${renderRows(detailRows)}</tbody></table>
      <h3>Work summary</h3>
      <p>${escapeHtml(displayValue(workOrder.summary))}</p>
      ${workOrder.rejectionRemarks.trim()
        ? `<h3>Chief Mechanic remarks</h3><div class="remarks">${escapeHtml(workOrder.rejectionRemarks)}</div>`
        : ""}
      ${workOrder.maintenanceRemarks.trim()
        ? `<h3>Mechanic maintenance remarks</h3><div class="remarks">${escapeHtml(workOrder.maintenanceRemarks)}</div>`
        : ""}
      <h3>Parts used</h3>
      ${partRows
        ? `<table><thead><tr><th>Checklist item</th><th>Part</th><th>Quantity</th><th>Material cost</th><th>Attachments</th></tr></thead><tbody>${partRows}</tbody></table>`
        : '<p class="empty">No parts recorded for this work order.</p>'}
    </section>
    <section id="execution">
      <h2>Execution</h2>
      ${executionRows
        ? `<table><thead><tr><th>Checklist item</th><th>Status</th><th>Notes</th></tr></thead><tbody>${executionRows}</tbody></table>`
        : '<p class="empty">No checklist items are available for this work order.</p>'}
      <h3>Maintenance work remarks</h3>
      <div class="remarks">${escapeHtml(displayValue(workOrder.maintenanceRemarks))}</div>
    </section>
  </body>
</html>`;
}
