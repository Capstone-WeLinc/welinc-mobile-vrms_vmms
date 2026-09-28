const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getChecklistSubmissionError } = require('../screens/workOrderSubmission.ts');

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
