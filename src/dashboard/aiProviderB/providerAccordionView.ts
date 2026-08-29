import { getMessage } from '../../utils/i18n.js';

const PROVIDER_DETAILS: { id: string; labelKey: string; fallback: string }[] = [
  { id: 'geminiSettings', labelKey: 'googleGemini', fallback: 'Google Gemini' },
  { id: 'openaiSettings', labelKey: 'openaiCompatible', fallback: 'OpenAI Compatible (Groq, etc.)' },
  { id: 'openai2Settings', labelKey: 'openaiCompatible2', fallback: 'OpenAI Compatible 2' },
  { id: 'lm-studioSettings', labelKey: 'lmStudio', fallback: 'LM Studio' },
  { id: 'ollamaSettings', labelKey: 'ollama', fallback: 'Ollama' },
  { id: 'openai-compatibleSettings', labelKey: 'openaiCompatibleModelsDev', fallback: 'OpenAI Compatible (Models.dev)' },
  { id: 'built-in-aiSettings', labelKey: 'builtInAi', fallback: 'Built-in AI' },
];

export interface BProviderAccordionView {
  container: HTMLElement;
  destroy(): void;
}

export function createBProviderAccordionView(container: HTMLElement): BProviderAccordionView {
  container.innerHTML = '';
  const createdDetails: HTMLElement[] = [];
  const originalParents = new Map<string, HTMLElement>();

  PROVIDER_DETAILS.forEach(({ id, labelKey, fallback }) => {
    const settingsDiv = document.getElementById(id) as HTMLElement | null;
    if (!settingsDiv) return;
    if (!originalParents.has(id) && settingsDiv.parentElement) {
      originalParents.set(id, settingsDiv.parentElement);
    }
    const details = document.createElement('details');
    details.className = 'b-provider-details';
    details.dataset.provider = id;
    const summary = document.createElement('summary');
    summary.className = 'b-provider-summary';
    summary.textContent = getMessage(labelKey) || fallback;
    details.appendChild(summary);
    details.appendChild(settingsDiv);
    // デフォルトでGeminiは開く、他は閉じる
    if (id === 'geminiSettings') details.open = true;
    container.appendChild(details);
    createdDetails.push(details);
  });

  return {
    container,
    destroy() {
      createdDetails.forEach(details => {
        const settingsDiv = details.querySelector<HTMLElement>('[id$="Settings"]');
        if (!settingsDiv) return;
        const parent = originalParents.get(settingsDiv.id);
        if (parent) parent.appendChild(settingsDiv);
      });
      container.innerHTML = '';
    },
  };
}
