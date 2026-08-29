import { StorageKeys } from '../utils/storage/types.js';
import type { SettingsRepository } from '../utils/storage/SettingsRepository.js';
import { getMessage } from '../utils/i18n.js';

export type AiProviderLayout = 'a' | 'b';

export async function resolveInitialLayout(repo: SettingsRepository): Promise<AiProviderLayout> {
  // Check raw storage without defaults to respect "already saved" vs default 'a'
  const port = repo.getPort();
  const rawResult = await port.get(['settings']);
  const rawSettings = (rawResult['settings'] as Record<string, unknown>) || {};
  const rawStored = rawSettings[StorageKeys.AI_PROVIDER_LAYOUT] as AiProviderLayout | undefined;
  if (rawStored === 'a' || rawStored === 'b') return rawStored;
  // Legacy scattered path: check direct key as well
  const scattered = await port.get([StorageKeys.AI_PROVIDER_LAYOUT]);
  const scatteredStored = scattered[StorageKeys.AI_PROVIDER_LAYOUT] as AiProviderLayout | undefined;
  if (scatteredStored === 'a' || scatteredStored === 'b') return scatteredStored;

  const all = (await repo.getAll()) as Record<string, unknown>;
  const completed = all[StorageKeys.ONBOARDING_WIZARD_COMPLETED] as boolean | undefined;
  const list = all[StorageKeys.AI_PROVIDER_PRIORITY_LIST] as unknown[] | undefined;
  const isNewUser = !completed && (!list || list.length === 0);
  const layout: AiProviderLayout = isNewUser ? 'b' : 'a';
  await repo.set(StorageKeys.AI_PROVIDER_LAYOUT, layout);
  return layout;
}

export function createLayoutToggle(
  current: AiProviderLayout,
  onChange: (next: AiProviderLayout) => void,
): HTMLElement {
  const group = document.createElement('div');
  group.className = 'ai-layout-toggle';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', getMessage('aiProviderLayoutToggleLabel') || 'AI provider layout');

  const btnA = document.createElement('button');
  btnA.type = 'button';
  btnA.className = 'ai-layout-toggle-btn';
  btnA.textContent = getMessage('aiProviderLayoutA') || 'A Unified';
  btnA.setAttribute('aria-pressed', String(current === 'a'));
  if (current === 'a') btnA.classList.add('active');

  const btnB = document.createElement('button');
  btnB.type = 'button';
  btnB.className = 'ai-layout-toggle-btn';
  btnB.textContent = getMessage('aiProviderLayoutB') || 'B Separated';
  btnB.setAttribute('aria-pressed', String(current === 'b'));
  if (current === 'b') btnB.classList.add('active');

  const setActive = (next: AiProviderLayout) => {
    btnA.setAttribute('aria-pressed', String(next === 'a'));
    btnB.setAttribute('aria-pressed', String(next === 'b'));
    btnA.classList.toggle('active', next === 'a');
    btnB.classList.toggle('active', next === 'b');
  };

  btnA.addEventListener('click', () => {
    if (btnA.getAttribute('aria-pressed') === 'true') return;
    setActive('a');
    onChange('a');
  });
  btnB.addEventListener('click', () => {
    if (btnB.getAttribute('aria-pressed') === 'true') return;
    setActive('b');
    onChange('b');
  });

  group.append(btnA, btnB);
  return group;
}

export function mountLayoutToggle(
  headerTitleEl: HTMLElement,
  current: AiProviderLayout,
  onChange: (next: AiProviderLayout) => void,
): void {
  // 既存のトグルがあれば除去（二重マウント防止）
  headerTitleEl.parentElement?.querySelector('.ai-layout-toggle')?.remove();
  const toggle = createLayoutToggle(current, onChange);
  headerTitleEl.insertAdjacentElement('afterend', toggle);
}
