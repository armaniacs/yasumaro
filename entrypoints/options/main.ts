/**
 * Options/Dashboard entry point - imports from src/dashboard/
 */
import { applyI18n, setHtmlLangAndDir, translatePageTitle } from '../../src/utils/i18n-dom.js';
import '../../src/dashboard/dashboard.js';
import '../../src/dashboard/main.js';

setHtmlLangAndDir();
applyI18n();
translatePageTitle('dashboardTitle');