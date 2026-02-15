/**
 * AIプロバイダー UI 表示制御モジュール
 * AIプロバイダーの選択に応じて、各プロバイダー設定パネルの表示/非表示を切り替える
 */

/**
 * AIプロバイダー項目
 */
export interface AIProviderElements {
    select: HTMLSelectElement;
    geminiSettings: HTMLElement;
    openaiSettings: HTMLElement;
    openai2Settings: HTMLElement;
}

/**
 * AIプロバイダー UI 表示を更新
 * @param {AIProviderElements} elements - DOM要素
 */
export function updateAIProviderVisibility(elements: AIProviderElements): void {
    const provider = elements.select.value;
    elements.geminiSettings.style.display = 'none';
    elements.openaiSettings.style.display = 'none';
    elements.openai2Settings.style.display = 'none';

    if (provider === 'gemini') {
        elements.geminiSettings.style.display = 'block';
    } else if (provider === 'openai') {
        elements.openaiSettings.style.display = 'block';
    } else if (provider === 'openai2') {
        elements.openai2Settings.style.display = 'block';
    }
}

/**
 * AIプロバイダー選択時に表示を切り替えるイベントリスナーを設定
 * @param {AIProviderElements} elements - DOM要素
 */
export function setupAIProviderChangeListener(elements: AIProviderElements): void {
    elements.select.addEventListener('change', () => {
        updateAIProviderVisibility(elements);
    });
}