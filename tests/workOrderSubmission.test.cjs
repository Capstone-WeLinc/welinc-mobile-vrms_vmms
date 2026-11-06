const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  getChangedExecutionItems,
  getChangedPartsSubmissionError,
  getChecklistSubmissionError,
  mergeUploadedAttachments,
  normalizePartDetailEntries,
  normalizePartDetails,
} = require('../screens/workOrderSubmission.ts');
const { getPersistedWorkOrderNumber } = require('../screens/workOrderId.ts');

test('displays the persisted work order number without deriving it from the schedule ID', () => {
  const number = 'WO-20261001-000042';
  assert.equal(getPersistedWorkOrderNumber(number), number);
  assert.equal(getPersistedWorkOrderNumber(null), 'N/A');
});

test('normalizes absent or invalid parts data to an empty map', () => {
  assert.deepEqual(normalizePartDetails(undefined), {});
  assert.deepEqual(normalizePartDetails(null), {});
  assert.deepEqual(normalizePartDetails([]), {});
  assert.deepEqual(normalizePartDetails({ oil: { partsUsed: 'Filter' } }), {
    oil: { partsUsed: 'Filter' },
  });
});

test('normalizes legacy part entries without attachments before the screen renders', () => {
  assert.deepEqual(normalizePartDetailEntries({
    oil: { partsUsed: 'Oil filter', quantity: '1', materialCost: '250' },
    invalid: null,
  }), {
    oil: {
      partsUsed: 'Oil filter',
      quantity: '1',
      materialCost: '250',
      attachments: [],
      attachmentName: '',
    },
    invalid: {
      partsUsed: '',
      quantity: '',
      materialCost: '',
      attachments: [],
      attachmentName: '',
    },
  });
});

test('parts details are limited to checklist items marked Changed', () => {
  const items = [
    { id: 'oil', status: 'checked' },
    { id: 'brakes', status: 'changed' },
    { id: 'tires', status: 'notChecked' },
  ];
  assert.deepEqual(getChangedExecutionItems(items), [items[1]]);
  assert.deepEqual(getChangedExecutionItems(items.filter((item) => item.status !== 'changed')), []);
});

test('normalizes stored attachment metadata required for protected viewing', () => {
  assert.deepEqual(normalizePartDetailEntries({ brakes: {
    attachments: [{ id: 'file-id', name: 'brakes.pdf', sizeMb: 0.8, contentType: 'application/pdf', storageName: 'file-id.pdf' }],
  } }).brakes.attachments, [{
    id: 'file-id', name: 'brakes.pdf', sizeMb: 0.8, contentType: 'application/pdf', storageName: 'file-id.pdf',
  }]);
});

test('re-uploading a legacy filename replaces the non-viewable placeholder', () => {
  const merged = mergeUploadedAttachments([
    { id: 'legacy', name: '1000013845.jpg', sizeMb: 0 },
    { id: 'other', name: 'other.jpg', sizeMb: 0 },
  ], { id: 'stored', name: '1000013845.jpg', sizeMb: 1, storageName: 'stored.jpg' });
  assert.deepEqual(merged.map(({ name }) => name), ['other.jpg', '1000013845.jpg']);
  assert.equal(merged[1].storageName, 'stored.jpg');
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
