/**
 * Memoizes an asynchronous initializer by runtime binding for one isolate.
 * Concurrent callers receive the exact same Promise. A rejection evicts only
 * that failed attempt so a later request can repair transient startup errors.
 *
 * @template {object} Binding
 * @param {(binding: Binding) => Promise<void>} initialize
 * @returns {(binding: Binding) => Promise<void>}
 */
export function createPerBindingInitializer(initialize) {
  const initialized = new WeakMap();

  return function ensureInitialized(binding) {
    const existing = initialized.get(binding);
    if (existing) return existing;

    const pending = Promise.resolve().then(() => initialize(binding));
    initialized.set(binding, pending);
    void pending.catch(() => {
      if (initialized.get(binding) === pending) initialized.delete(binding);
    });
    return pending;
  };
}
