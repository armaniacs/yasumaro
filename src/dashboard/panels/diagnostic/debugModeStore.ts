/**
 * debugModeStore — thin persistence port for the dashboard debug mode flag.
 * Centralizes the 'debugMode' storage key so neither the collector nor the
 * panel imports chrome.storage directly.
 */

const DEBUG_MODE_KEY = 'debugMode';

export async function getDebugMode(): Promise<boolean> {
  const result = await chrome.storage.local.get(DEBUG_MODE_KEY) as Record<string, unknown>;
  return Boolean(result[DEBUG_MODE_KEY]);
}

export async function setDebugMode(value: boolean): Promise<void> {
  await chrome.storage.local.set({ [DEBUG_MODE_KEY]: value });
}
