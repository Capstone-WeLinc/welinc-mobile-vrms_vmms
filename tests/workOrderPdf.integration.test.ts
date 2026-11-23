import { buildWorkOrderPdfHtml, type WorkOrderPdfData } from "../screens/workOrderPdf";

const workOrder: WorkOrderPdfData = {
  number: "WO-2026-0042",
  plate: "ABC-123",
  maintenanceType: "Engine tune-up",
  maintenanceClass: "PREVENTIVE",
  status: "In Progress",
  mechanic: "Juan Dela Cruz",
  template: "Engine Tune-up",
  dateCreated: "Nov 23, 2026",
  startDate: "Nov 24, 2026",
  serviceOdometerReading: 128400,
  summary: "Engine inspection and service",
  scheduleDetails: [{ label: "Priority", value: "High" }],
  maintenanceRemarks: "Replaced worn belt",
  rejectionRemarks: "",
  executionItems: [{
    id: "belt",
    label: "Inspect belt <assembly>",
    status: "changed",
    note: "Replace & verify",
  }],
  partDetails: {
    belt: {
      partsUsed: "Drive belt",
      quantity: "1",
      materialCost: "450.00",
      attachments: [{ name: "belt-photo.jpg" }],
    },
  },
};

test("exports Details and Execution sections with checklist and part data", () => {
  const html = buildWorkOrderPdfHtml(workOrder, new Date("2026-11-23T10:00:00.000Z"));

  expect(html).toContain('<section id="details">');
  expect(html).toContain('<section id="execution">');
  expect(html).toContain("WO-2026-0042");
  expect(html).toContain("Drive belt");
  expect(html).toContain("Inspect belt &lt;assembly&gt;");
  expect(html).toContain("Replace &amp; verify");
  expect(html).toContain("Replaced worn belt");
});

test("renders an empty checklist state when there are no execution items", () => {
  const html = buildWorkOrderPdfHtml({
    ...workOrder,
    executionItems: [],
    partDetails: {},
  });

  expect(html).toContain("No checklist items are available for this work order.");
});
