const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isAwaitingChiefReview } = require('../screens/workOrderReview.ts');
const { submittedReviewState } = require('../screens/workOrderReview.ts');

test('database DONE admits submitted work when JSON submission flags are absent or stale', () => {
  const order = { chiefMechanicId: 'chief', status: 'Pending', mechanicSubmitted: false, ...submittedReviewState('DONE') };
  assert.equal(isAwaitingChiefReview(order, 'chief'), true);
  assert.equal(isAwaitingChiefReview(order, 'another-chief'), false);
  assert.deepEqual(submittedReviewState('IN_PROGRESS'), {});
});

test('review queue follows submission, rejection, rework and resubmission', () => {
  const order = { chiefMechanicId: 'chief', status: 'Pending', mechanicSubmitted: false };
  for (const status of ['Pending', 'In Progress', 'Rejected']) {
    assert.equal(isAwaitingChiefReview({ ...order, status }, 'chief'), false);
  }
  assert.equal(isAwaitingChiefReview({ ...order, status: 'Done', mechanicSubmitted: true }, 'chief'), true);
  assert.equal(isAwaitingChiefReview({ ...order, status: 'For Verification', mechanicSubmitted: true }, 'chief'), true);
  assert.equal(isAwaitingChiefReview({ ...order, status: 'Done', mechanicSubmitted: true }, 'other-chief'), false);
});

test('stale submission flags cannot admit unsubmitted or already reviewed work', () => {
  for (const status of ['Pending', 'In Progress', 'Rejected', 'For Repair', 'Completed', 'Cancelled', 'Overdue']) {
    assert.equal(isAwaitingChiefReview({ chiefMechanicId: 'chief', status, mechanicSubmitted: true }, 'chief'), false);
  }
  assert.equal(isAwaitingChiefReview({ chiefMechanicId: 'chief', status: 'Done', mechanicSubmitted: false }, 'chief'), false);
});
