let testOverride: boolean | null = null;

/**
 * Enables client-side stale-while-revalidate caching in production/browser runs
 * while keeping unit tests isolated unless explicitly enabled via override.
 */
export function isClientCacheEnabled(): boolean {
  if (testOverride !== null) return testOverride;
  return typeof process === 'undefined' || (!process.env?.VITEST && process.env?.NODE_ENV !== 'test');
}

/** Test hook to deterministically enable or disable client SWR caches in unit tests. */
export function setClientCacheOverrideForTest(enabled: boolean | null): void {
  testOverride = enabled;
}
