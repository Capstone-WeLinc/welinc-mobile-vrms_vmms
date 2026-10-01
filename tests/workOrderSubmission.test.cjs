const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  getChangedPartsSubmissionError,
  getChecklistSubmissionError,
  normalizePartDetails,
} = require('../screens/workOrderSubmission.ts');

test('normalizes absent or invalid parts data to an empty map', () => {
  assert.deepEqual(normalizePartDetails(undefined), {});
  assert.deepEqual(normalizePartDetails(null), {});
  assert.deepEqual(normalizePartDetails([]), {});
  assert.deepEqual(normalizePartDetails({ oil: { partsUsed: 'Filter' } }), {
    oil: { partsUsed: 'Filter' },
  });
});

test('lists every unfinished item, including Not Checked', () => {
  assert.equal(getChecklistSubmissionError([
    { label: 'Oil', status: 'checked' },
    { label: 'Brakes', status: 'notChecked' },
    { label: 'Tires', status: 'pending' },
    { label: 'Filter', status: 'changed' },
  ]), 'Complete every assigned checklist item before submitting:\n- Brakes\n- Tires');
});

test('allows a fully checked/changed checklist to reach server validation', () => {
  assert.equal(getChecklistSubmissionError([
    { label: 'Oil', status: 'checked' }, { label: 'Filter', status: 'changed' },
  ]), null);
});

test('empty and unknown-status checklists cannot pass local validation', () => {
  assert.match(getChecklistSubmissionError([]), /No checklist items/);
  assert.match(getChecklistSubmissionError([{ label: 'Brakes', status: 'unknown' }]), /- Brakes/);
});

test('changed checklist items require complete parts details and an attachment', () => {
  const items = [{ id: 'brakes', label: 'Brakes', status: 'changed' }];
  assert.match(getChangedPartsSubmissionError(items, {}), /Brakes/);
  assert.equal(getChangedPartsSubmissionError(items, {
    brakes: {
      partsUsed: 'Brake pads',
      quantity: '1',
      materialCost: '1200',
      attachments: [{ name: 'receipt.jpg' }],
    },
  }), null);
});

test('parts details are optional for checklist items not marked changed', () => {
  assert.equal(getChangedPartsSubmissionError([
    { id: 'oil', label: 'Oil', status: 'checked' },
  ], {}), null);
});
