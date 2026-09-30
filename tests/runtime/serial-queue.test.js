import assert from 'node:assert/strict';
import test from 'node:test';

import { createSerialQueue } from '../../extension/shared/runtime/serial-queue.js';

test('serial queue preserves enqueue order across asynchronous tasks', async () => {
  const enqueue = createSerialQueue();
  const execution = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const first = enqueue(async () => {
    execution.push('first:start');
    await firstGate;
    execution.push('first:end');
    return 'first result';
  });
  const second = enqueue(() => {
    execution.push('second');
    return 'second result';
  });

  await Promise.resolve();
  assert.deepEqual(execution, ['first:start']);

  releaseFirst();
  assert.deepEqual(await Promise.all([first, second]), ['first result', 'second result']);
  assert.deepEqual(execution, ['first:start', 'first:end', 'second']);
});

test('a rejected task does not prevent later tasks from running', async () => {
  const enqueue = createSerialQueue();
  const failure = new Error('task failed');
  const execution = [];

  const rejected = enqueue(() => {
    execution.push('failed');
    throw failure;
  });
  const recovered = enqueue(() => {
    execution.push('recovered');
    return 'done';
  });

  await assert.rejects(rejected, failure);
  assert.equal(await recovered, 'done');
  assert.deepEqual(execution, ['failed', 'recovered']);
});
