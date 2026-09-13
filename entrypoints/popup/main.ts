/**
 * Popup entrypoint for WXT
 * Imports all original popup scripts to maintain v5.1.4+ behavior
 */

import './styles.css';
import { applyI18n, setHtmlLangAndDir, translatePageTitle } from '../../src/utils/i18n-dom.js';
import { initPopup } from '../../src/popup/popup.js';
import '../../src/popup/navigation';
import '../../src/popup/main';

// PBI 2026-09-11-04 (round 7): single entry point — applyI18n first, then the
// popup's own initialization (navigation / consent / pending dialogs /
// onboarding). popup.ts no longer auto-runs at import time.
async function bootstrap(): Promise<void> {
  setHtmlLangAndDir();
  applyI18n();
  translatePageTitle('popupTitle');
  await initPopup();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    void bootstrap();
  });
} else {
  void bootstrap();
}
