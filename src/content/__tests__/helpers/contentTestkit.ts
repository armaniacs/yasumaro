/**
 * contentTestkit.ts
 * Test seam for the extractor module singleton.
 *
 * Moved from extractor.ts getPageStateForTesting (PBI-14 test-support
 * relocation). The PageState singleton itself stays in extractor.ts (the
 * facade functions under test close over it); only the test-only accessor
 * lives here. Production code must not import this module.
 */

import { kernel } from '../../extractor.js';
import type { PageState } from '../../pageState.js';

export function getPageStateForTesting(): PageState {
    return kernel.pageState as PageState;
}
