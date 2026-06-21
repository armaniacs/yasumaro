/**
 * Vitest configuration — project root
 *
 * Re-exports testDir/vitest.config.ts so that Vitest auto-discovery
 * finds the config without requiring --config on every invocation.
 */
export { default } from './testDir/vitest.config';
