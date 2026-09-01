import { getMessage } from '../../utils/i18n.js';
import { PROVIDER_CATALOG } from '../../background/ai/providerCatalog.js';
import { providerIdsInOrder, renderProviderSettings } from '../aiProviderCatalogView.js';

export interface BProviderAccordionView {
  container: HTMLElement;
  destroy(): void;
}

/**
 * B layout: one `<details>` accordion per provider. The settings body is built
 * from the catalog (renderProviderSettings sets `body.id = "<id>Settings"`), so
 * this view owns its DOM rather than borrowing static divs.
 */
export function createBProviderAccordionView(container: HTMLElement): BProviderAccordionView {
  container.innerHTML = '';
  const created: HTMLElement[] = [];

  for (const id of providerIdsInOrder()) {
    const details = document.createElement('details');
    details.className = 'b-provider-details';
    details.dataset.provider = `${id}Settings`;

    const summary = document.createElement('summary');
    summary.className = 'b-provider-summary';
    const entry = PROVIDER_CATALOG.get(id);
    summary.textContent = (entry && getMessage(entry.labelI18nKey)) || entry?.label || id;

    const body = document.createElement('div');
    renderProviderSettings(body, id);
    body.style.display = 'block';

    details.append(summary, body);
    if (id === 'gemini') details.open = true;
    container.appendChild(details);
    created.push(details);
  }

  return {
    container,
    destroy() {
      created.forEach((d) => d.remove());
      container.innerHTML = '';
    },
  };
}
