/**
 * Options/Dashboard entry point - imports from src/dashboard/
 */
import { applyI18n, setHtmlLangAndDir, translatePageTitle } from '../../src/utils/i18n-dom.js';
// Single bootstrap: src/dashboard/main.ts owns panel registration and calls
// into dashboard.ts itself, so importing dashboard.js here would only risk
// running page initialization before the panel registry exists.
import '../../src/dashboard/main.js';

setHtmlLangAndDir();
applyI18n();
translatePageTitle('dashboardTitle');