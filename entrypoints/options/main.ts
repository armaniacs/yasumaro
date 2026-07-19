/**
 * Options/Dashboard entry point - imports from src/dashboard/
 */
import { applyI18n, setHtmlLangAndDir } from '../../src/utils/i18n-dom.js';
import '../../src/dashboard/dashboard.js';
import '../../src/dashboard/main.js';

setHtmlLangAndDir();
applyI18n();