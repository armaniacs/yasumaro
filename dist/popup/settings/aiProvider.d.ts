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
export declare function updateAIProviderVisibility(elements: AIProviderElements): void;
/**
 * AIプロバイダー選択時に表示を切り替えるイベントリスナーを設定
 * @param {AIProviderElements} elements - DOM要素
 */
export declare function setupAIProviderChangeListener(elements: AIProviderElements): void;
//# sourceMappingURL=aiProvider.d.ts.map