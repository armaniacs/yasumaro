import { type StaticFormPanel } from '../types.js';
import { getSettings } from '../../../utils/storage.js';
import { initCustomPromptManager } from '../../../popup/customPromptManager.js';

export function createPromptSettingsPanel(): StaticFormPanel {
  return {
    id: 'panel-prompt',
    category: 'static-form',
    async mount(_container) {
      const settings = await getSettings();
      initCustomPromptManager(settings);
    },
    async refresh() {},
  };
}
