import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

export function runWithExecutionScope(scope, fn) {
  const safeScope = {
    profileId: String(scope?.profileId || 'operator'),
    allowPrivateUrls: scope?.allowPrivateUrls === true,
  };
  return storage.run(safeScope, fn);
}

export function getExecutionScope() {
  return storage.getStore() || {
    profileId: 'default',
    allowPrivateUrls: false,
  };
}
