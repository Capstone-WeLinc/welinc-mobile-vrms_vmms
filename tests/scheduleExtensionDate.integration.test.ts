import { isLaterDateOnly, isValidDateOnly } from "../screens/scheduleExtensionDate";

test("validates calendar dates including leap years", () => {
  expect(isValidDateOnly("2028-02-29")).toBe(true);
  expect(isValidDateOnly("2026-02-29")).toBe(false);
  expect(isValidDateOnly("2026-04-31")).toBe(false);
  expect(isValidDateOnly("2026-4-01")).toBe(false);
});

test("requires a valid proposal strictly after the current target date", () => {
  expect(isLaterDateOnly("2026-06-02", "2026-06-01")).toBe(true);
  expect(isLaterDateOnly("2026-06-01", "2026-06-01")).toBe(false);
  expect(isLaterDateOnly("2026-02-31", "2026-06-01")).toBe(false);
  expect(isLaterDateOnly("2026-07-01", null)).toBe(false);
});
