import { type StaticFormPanel } from '../types.js';
import { init as initTrustSettings, loadTrustSettings } from '../../../popup/trustSettings.js';

export function createTrustSettingsPanel(): StaticFormPanel {
  return {
    id: 'panel-trust',
    category: 'static-form',
    async mount(_container) {
      initTrustSettings();
      await loadTrustSettings();
    },
    async refresh() {
      await loadTrustSettings();
    },
  };
}
