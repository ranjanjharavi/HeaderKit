export function createSerialQueue() {
  let tail = Promise.resolve();

  return function enqueue(task) {
    const result = tail.then(task);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
}
