const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatWorkOrderDate, resolveCreatedDate } = require('../services/workOrderDates.ts');

test('uses the API calendar date instead of the mobile sync timestamp', () => {
  assert.equal(
    resolveCreatedDate('2026-10-01', '2026-09-30T15:30:00.000Z', '2026-10-02T00:00:00.000Z'),
    '2026-10-01',
  );
});

test('formats date-only values without timezone rollover', () => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try {
    assert.equal(formatWorkOrderDate('2026-10-01'), 'Oct 1, 2026');
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

test('uses a valid created timestamp if the server did not send a calendar date', () => {
  assert.equal(
    resolveCreatedDate(null, '2026-09-30T15:30:00.000Z', '2026-10-02T00:00:00.000Z'),
    '2026-09-30T15:30:00.000Z',
  );
});
