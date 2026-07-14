import { type StaticFormPanel } from '../types.js';
import { initTagsPanel } from '../../tagsPanel.js';

export function createTagsSettingsPanel(): StaticFormPanel {
  return {
    id: 'panel-tags',
    category: 'static-form',
    async mount(_container) {
      await initTagsPanel();
    },
    async refresh() {},
  };
}
