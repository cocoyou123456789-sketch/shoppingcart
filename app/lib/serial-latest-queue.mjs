// @ts-check

/**
 * Runs at most one task at a time and coalesces waiting work to the latest
 * value. Returning false from the worker stops the drain and drops queued
 * work, leaving the caller free to retry explicitly.
 *
 * @template T
 * @param {(task: T) => Promise<boolean | void>} worker
 */
export function createSerialLatestQueue(worker) {
  /** @type {T | null} */
  let pending = null;
  let running = false;
  /** @type {Promise<void> | null} */
  let drainPromise = null;

  async function drain() {
    try {
      while (pending !== null) {
        const task = pending;
        pending = null;
        const shouldContinue = await worker(task);
        if (shouldContinue === false) {
          pending = null;
          break;
        }
      }
    } finally {
      running = false;
      drainPromise = null;
    }
  }

  return {
    /** @param {T} task */
    enqueue(task) {
      pending = task;
      if (!running) {
        running = true;
        drainPromise = drain();
      }
      return /** @type {Promise<void>} */ (drainPromise);
    },
    clear() {
      pending = null;
    },
    get running() {
      return running;
    },
    get pending() {
      return pending !== null;
    },
  };
}
