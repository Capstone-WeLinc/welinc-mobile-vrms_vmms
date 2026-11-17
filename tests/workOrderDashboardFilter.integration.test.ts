import { matchesWorkOrderDashboardFilter } from "../screens/workOrderDashboardFilter";

function order(
  status: string,
  mechanicSubmitted = false,
  assignedMechanicId: string | null = "mechanic-1",
) {
  return { status, mechanicSubmitted, assignedMechanicId };
}

test("matches the dashboard pending and review status groups", () => {
  expect(matchesWorkOrderDashboardFilter(order("Pending"), "Pending", null)).toBe(true);
  expect(matchesWorkOrderDashboardFilter(order("Cancelled"), "Pending", null)).toBe(false);
  expect(matchesWorkOrderDashboardFilter(order("Done"), "Awaiting Review", null)).toBe(true);
  expect(matchesWorkOrderDashboardFilter(order("In Progress", true), "Awaiting Review", null)).toBe(true);
  expect(matchesWorkOrderDashboardFilter(order("Rejected", true), "Awaiting Review", null)).toBe(false);
});

test("matches returned work and scopes chief dashboard filters to the selected mechanic", () => {
  expect(matchesWorkOrderDashboardFilter(order("Rejected"), "Returned", null)).toBe(true);
  expect(matchesWorkOrderDashboardFilter(order("For Repair"), "Returned", null)).toBe(true);
  expect(
    matchesWorkOrderDashboardFilter(order("Overdue", false, "mechanic-1"), "Overdue", "mechanic-1"),
  ).toBe(true);
  expect(
    matchesWorkOrderDashboardFilter(order("Overdue", false, "mechanic-2"), "Overdue", "mechanic-1"),
  ).toBe(false);
});
