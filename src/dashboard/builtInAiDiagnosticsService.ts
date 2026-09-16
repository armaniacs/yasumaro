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
import {
  getBrowserName,
  getBuiltInAIFlagGuidance,
  getBuiltInAIDiskSpace,
  type BuiltInAIFlagGuidance,
  type BuiltInAIDiskSpace,
} from '../utils/browserSupport.js';

export interface BuiltInAiDiagnosticsResult {
  status: BuiltInAIAvailability;
  guidance: BuiltInAIFlagGuidance | null;
  /** Free-space reading when it explains an 'unavailable' status; null otherwise. */
  diskSpace: BuiltInAIDiskSpace | null;
}

function guidanceForCurrentBrowser(): BuiltInAIFlagGuidance | null {
  return getBuiltInAIFlagGuidance(getBrowserName());
}

/**
 * Describe an 'unavailable' status. Insufficient disk space takes precedence:
 * Chromium reports it as a bare 'unavailable', so surfacing only flag guidance
 * sends users to re-check a flag that is already enabled.
 */
async function explainUnavailable(): Promise<BuiltInAiDiagnosticsResult> {
  const diskSpace = await getBuiltInAIDiskSpace();
  if (diskSpace && !diskSpace.sufficient) {
    return { status: 'unavailable', guidance: null, diskSpace };
  }
  return { status: 'unavailable', guidance: guidanceForCurrentBrowser(), diskSpace: null };
}

/** create()に渡す出力言語指定と揃える。availability()判定とcreate()実行で異なる言語を指定すると結果が食い違うため定数化。 */
const EXPECTED_OUTPUTS: Array<{ type: 'text'; languages: string[] }> = [{ type: 'text', languages: ['ja'] }];

/**
 * Check whether the on-device Prompt API is available in this browser,
 * regardless of the user's configured AI provider.
 */
export async function checkBuiltInAiAvailability(): Promise<BuiltInAiDiagnosticsResult> {
  const languageModel = globalThis.LanguageModel;
  if (!languageModel) {
    return explainUnavailable();
  }

  try {
    const status = await languageModel.availability({ expectedOutputs: EXPECTED_OUTPUTS });
    if (status === 'unavailable') {
      return explainUnavailable();
    }
    return { status, guidance: null, diskSpace: null };
  } catch {
    return explainUnavailable();
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
    return explainUnavailable();
  }

  try {
    const session = await languageModel.create({
      monitor(monitor) {
        monitor.addEventListener('downloadprogress', (event) => {
          onProgress(Math.round(event.loaded * 100));
        });
      },
      expectedOutputs: EXPECTED_OUTPUTS,
    });
    session.destroy();
  } catch {
    return explainUnavailable();
  }

  return checkBuiltInAiAvailability();
}
