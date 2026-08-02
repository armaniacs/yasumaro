/**
 * builtInAiDiagnosticsService.ts
 * Dashboard-side built-in AI (Prompt API) availability check + download trigger.
 * Calls self.LanguageModel directly from the Options page context — no Service
 * Worker relay, so download progress events can be reflected in the DOM as they fire.
 */

// Importing builtInAIClient.js pulls in its `declare global { var LanguageModel }`
// augmentation, so globalThis.LanguageModel (including the `monitor` create() option)
// is typed here without redeclaring it.
import type { BuiltInAIAvailability } from '../background/builtInAIClient.js';
import { getBrowserName, getBuiltInAIFlagGuidance, type BuiltInAIFlagGuidance } from '../utils/browserSupport.js';

export interface BuiltInAiDiagnosticsResult {
  status: BuiltInAIAvailability;
  guidance: BuiltInAIFlagGuidance | null;
}

function guidanceForCurrentBrowser(): BuiltInAIFlagGuidance | null {
  return getBuiltInAIFlagGuidance(getBrowserName());
}

/**
 * Check whether the on-device Prompt API is available in this browser,
 * regardless of the user's configured AI provider.
 */
export async function checkBuiltInAiAvailability(): Promise<BuiltInAiDiagnosticsResult> {
  const languageModel = globalThis.LanguageModel;
  if (!languageModel) {
    return { status: 'unavailable', guidance: guidanceForCurrentBrowser() };
  }

  try {
    const status = await languageModel.availability();
    return {
      status,
      guidance: status === 'unavailable' ? guidanceForCurrentBrowser() : null,
    };
  } catch {
    return { status: 'unavailable', guidance: guidanceForCurrentBrowser() };
  }
}

/**
 * Trigger the on-device model download (LanguageModel.create()) and report
 * progress via onProgress(percent) as downloadprogress events fire.
 * Resolves with the availability status after the download attempt completes.
 */
export async function startBuiltInAiDownload(
  onProgress: (percent: number) => void
): Promise<BuiltInAiDiagnosticsResult> {
  const languageModel = globalThis.LanguageModel;
  if (!languageModel) {
    return { status: 'unavailable', guidance: guidanceForCurrentBrowser() };
  }

  try {
    const session = await languageModel.create({
      monitor(monitor) {
        monitor.addEventListener('downloadprogress', (event) => {
          onProgress(Math.round(event.loaded * 100));
        });
      },
    });
    session.destroy();
  } catch {
    return { status: 'unavailable', guidance: guidanceForCurrentBrowser() };
  }

  return checkBuiltInAiAvailability();
}
