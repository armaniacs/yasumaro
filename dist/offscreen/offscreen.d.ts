/**
 * offscreen.ts
 * Handles interactions with the Chrome Prompt API (window.ai) in an offscreen document.
 */
interface AICapabilities {
    available: 'readily' | 'after-download' | 'no';
}
interface AISession {
    prompt(text: string): Promise<string>;
    destroy(): void;
}
interface AILanguageModel {
    capabilities(): Promise<AICapabilities>;
    create(options?: {
        systemPrompt?: string;
    }): Promise<AISession>;
}
interface AI {
    languageModel: AILanguageModel;
}
declare global {
    interface Window {
        ai?: AI;
    }
    var ai: AI | undefined;
}
export {};
//# sourceMappingURL=offscreen.d.ts.map