import { type StaticFormPanel } from '../types.js';
import { getSettings, StorageKeys } from '../../../utils/storage.js';
import { init as initDomainFilter, loadDomainSettings } from '../../../popup/domainFilter.js';
import { initDomainFilterTagUI } from '../../domainFilterTagUI.js';

export function createDomainFilterPanel(): StaticFormPanel {
  return {
    id: 'panel-domain',
    category: 'static-form',
    async mount(_container) {
      initDomainFilter();
      await initDomainFilterTagUI();
    },
    async refresh() {
      await loadDomainSettings();
    },
  };
}
