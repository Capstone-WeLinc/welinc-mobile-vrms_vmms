const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  getPendingCriticalFuelApprovals,
  shouldShowFuelAnomalyApprovalPanel,
} = require("../services/fuelAnomalyApprovalVisibility.ts");

const anomalies = [
  { id: "pending-critical", status: "OPEN", severity: "CRITICAL", acknowledgedAt: null },
  { id: "acknowledged-critical", status: "OPEN", severity: "CRITICAL", acknowledgedAt: "2026-11-10T00:00:00.000Z" },
  { id: "open-escalated", status: "OPEN", severity: "ESCALATED", acknowledgedAt: null },
  { id: "resolved-critical", status: "RESOLVED", severity: "CRITICAL", acknowledgedAt: null },
];

test("shows the critical fuel approval panel only to the Chief Mechanic", () => {
  assert.equal(shouldShowFuelAnomalyApprovalPanel("chiefMechanic"), true);
  assert.equal(shouldShowFuelAnomalyApprovalPanel("mechanic"), false);
});

test("Chief Mechanic sees only unacknowledged open critical anomalies", () => {
  assert.deepEqual(
    getPendingCriticalFuelApprovals("chiefMechanic", anomalies).map((item) => item.id),
    ["pending-critical"],
  );
});

test("Mechanic receives no fuel anomaly approvals", () => {
  assert.deepEqual(getPendingCriticalFuelApprovals("mechanic", anomalies), []);
});
