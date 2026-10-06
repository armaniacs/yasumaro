/**
 * Popup entrypoint for WXT
 * Imports all original popup scripts to maintain v5.1.4+ behavior
 */

import './styles.css';
import { applyI18n, setHtmlLangAndDir, translatePageTitle } from '../../src/utils/i18n-dom.js';
import { getMessage } from '../../src/utils/i18n.js';
import { initMainScreen } from '../../src/popup/main.js';
import { initPopup } from '../../src/popup/popup.js';

// PBI 2026-09-11-04 (round 7): single entry point — applyI18n first, then the
// popup's own initialization (main screen + navigation / consent / pending
// dialogs / onboarding). PBI 2026-10-05-31: no side-effect imports —
// initMainScreen and initPopup are called explicitly once below.
async function bootstrap(): Promise<void> {
  setHtmlLangAndDir();
  applyI18n();
  const historyButton = document.getElementById('historyBtn');
  if (historyButton) {
    historyButton.title = getMessage('openHistory');
  }
  translatePageTitle('popupTitle');
  await initMainScreen();
  await initPopup();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    void bootstrap();
  });
} else {
  void bootstrap();
}
