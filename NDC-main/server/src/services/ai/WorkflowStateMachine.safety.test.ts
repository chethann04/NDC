import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkflowStateMachine } from './WorkflowStateMachine';

test('explicitly prohibited due creation is detected and never treated as ADD_DUE', () => {
  const prohibitedRequests = [
    'Prepare ₹500 for a damaged library book for 4XX23CS051, but do not add any due.',
    'Do not actually add a due of ₹420 for 4XX23CS901.',
    'Make no due entry for this student.',
    'Refrain from creating any charge for the damaged equipment.',
    'I want ₹420 recorded, but do not charge the student.'
  ];

  for (const request of prohibitedRequests) {
    assert.equal(
      WorkflowStateMachine.hasExplicitAddDueProhibition(request),
      true,
      `Expected prohibition to be detected: ${request}`
    );
    assert.equal(
      WorkflowStateMachine.hasAddDueSignal(request),
      false,
      `A prohibited request must not produce an ADD_DUE signal: ${request}`
    );
    assert.equal(
      WorkflowStateMachine.analyzeHistory([{ role: 'user', content: request }]).intent,
      'CONTRADICTORY',
      `A prohibited request must route to clarification: ${request}`
    );
  }
});

test('ordinary positive due requests still produce an ADD_DUE signal', () => {
  const positiveRequests = [
    'Add ₹500 due for 4MC24CS051 for a damaged library book.',
    'Record a fine of ₹420 for a lost laboratory manual.',
    'Please charge ₹300 for damaged equipment.'
  ];

  for (const request of positiveRequests) {
    assert.equal(
      WorkflowStateMachine.hasExplicitAddDueProhibition(request),
      false,
      `A positive request must not be classified as prohibited: ${request}`
    );
    assert.equal(
      WorkflowStateMachine.hasAddDueSignal(request),
      true,
      `Expected ADD_DUE signal: ${request}`
    );
  }
});

test('missing USN remains an information-missing state rather than a fabricated identifier', () => {
  const result = WorkflowStateMachine.analyzeHistory([
    { role: 'user', content: 'Add ₹800 due for a damaged library book.' }
  ]);

  assert.equal(result.intent, 'MARK_DUE');
  assert.equal(result.usn, null);
  assert.equal(result.amount, 800);
});
