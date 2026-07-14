import { type StaticFormPanel } from '../types.js';
import { CSPSettings } from '../../cspSettings.js';

export function createCspSettingsPanel(): StaticFormPanel {
  return {
    id: 'panel-csp',
    category: 'static-form',
    async mount(_container) {
      await CSPSettings.loadCSPSettings();
    },
    async refresh() {
      await CSPSettings.loadCSPSettings();
    },
  };
}
