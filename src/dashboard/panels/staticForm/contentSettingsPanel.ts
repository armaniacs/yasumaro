import { type StaticFormPanel } from '../types.js';
import { getSettings } from '../../../utils/storage.js';
import { init as initContentSettings, loadContentSettings } from '../../../popup/contentSettings.js';

export function createContentSettingsPanel(): StaticFormPanel {
  return {
    id: 'panel-content',
    category: 'static-form',
    async mount(_container) {
      initContentSettings();
    },
    async refresh() {
      await loadContentSettings();
    },
  };
}
