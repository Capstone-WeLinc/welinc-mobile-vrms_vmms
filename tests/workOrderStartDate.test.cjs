const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isWorkOrderStartDateReached } = require('../screens/workOrderStartDate.ts');

test('blocks starting before the scheduled date and allows the scheduled day or later', () => {
  const now = new Date('2026-10-01T04:00:00.000Z');
  assert.equal(isWorkOrderStartDateReached('2026-10-02', now), false);
  assert.equal(isWorkOrderStartDateReached('2026-10-01', now), true);
  assert.equal(isWorkOrderStartDateReached('2026-09-30', now), true);
});

test('blocks missing or malformed scheduled dates', () => {
  const now = new Date('2026-10-01T04:00:00.000Z');
  assert.equal(isWorkOrderStartDateReached(null, now), false);
  assert.equal(isWorkOrderStartDateReached('2026-10-1', now), false);
});

test('uses the Philippine calendar day around UTC midnight', () => {
  const beforePhilippineMidnight = new Date('2026-09-30T15:59:59.000Z');
  assert.equal(isWorkOrderStartDateReached('2026-10-01', beforePhilippineMidnight), false);
  assert.equal(isWorkOrderStartDateReached('2026-10-01', new Date('2026-09-30T16:00:00.000Z')), true);
});
