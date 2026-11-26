import { getAutomaticInspectionRemark } from "../screens/inspectionRemark";

test("keeps inspection unverified until every item is decided", () => {
  expect(getAutomaticInspectionRemark([])).toBe("Unverified");
  expect(
    getAutomaticInspectionRemark([
      { status: "fail" },
      { status: "pending" },
    ]),
  ).toBe("Unverified");
});

test("sends a completed inspection for repair when any item fails", () => {
  expect(
    getAutomaticInspectionRemark([
      { status: "fail" },
      { status: "pass" },
      { status: "pass" },
      { status: "pass" },
    ]),
  ).toBe("For Repair");
});

test("verifies an inspection when every item passes", () => {
  expect(
    getAutomaticInspectionRemark([
      { status: "pass" },
      { status: "pass" },
    ]),
  ).toBe("Verified");
});
