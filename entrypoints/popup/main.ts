/**
 * Popup entrypoint for WXT
 * Imports all original popup scripts to maintain v5.1.4+ behavior
 */

import './styles.css';
import { applyI18n, setHtmlLangAndDir, translatePageTitle } from '../../src/utils/i18n-dom.js';
import '../../src/popup/navigation';
import '../../src/popup/main';
import '../../src/popup/popup';
import '../../src/popup/domainFilter';

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setHtmlLangAndDir();
    applyI18n();
    translatePageTitle('popupTitle');
  });
} else {
  setHtmlLangAndDir();
  applyI18n();
  translatePageTitle('popupTitle');
}
