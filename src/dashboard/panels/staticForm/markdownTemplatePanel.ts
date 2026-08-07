import { type StaticFormPanel } from '../types.js';
import { getSettings } from '../../../utils/storage.js';
import { initMarkdownTemplateManager } from '../../markdownTemplateManager.js';

export function createMarkdownTemplatePanel(): StaticFormPanel {
  return {
    id: 'panel-markdown-template',
    category: 'static-form',
    async mount(_container) {
      const settings = await getSettings();
      initMarkdownTemplateManager(settings);
    },
    async refresh() {},
  };
}
