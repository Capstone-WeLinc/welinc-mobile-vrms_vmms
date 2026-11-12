const { test } = require("node:test");
const assert = require("node:assert/strict");
const { getMobileAccessRole } = require("../services/mobileAccessRole.ts");

test("recognizes VMMS mechanic and chief mechanic roles", () => {
  assert.equal(getMobileAccessRole([{ role: "MECHANIC", system: "VMMS" }]), "mechanic");
  assert.equal(getMobileAccessRole([{ role: "CHIEF_MECHANIC", system: "VMMS" }]), "chiefMechanic");
});

test("does not grant mobile VMMS access from another system role", () => {
  assert.equal(getMobileAccessRole([{ role: "MECHANIC", system: "VRMS" }]), "none");
  assert.equal(getMobileAccessRole([{ role: "CHIEF_MECHANIC", system: "BMS" }]), "none");
});

test("ignores malformed and non-VMMS role assignments", () => {
  assert.equal(getMobileAccessRole([null, { role: "ADMIN", system: "VMMS" }]), "none");
  assert.equal(getMobileAccessRole(undefined), "none");
});
