/**
 * aiProviderLabels.ts
 * AIプロバイダ識別子からユーザー向け表示ラベルへのマップ（単一ソース）。
 * popup と background の両方から import する。このモジュールは依存を持たない
 * 純粋な定数であり、AIClient 等の重い依存を巻き込まない。
 */

export const PROVIDER_LABELS: Record<string, string> = {
    gemini: 'Google Gemini',
    openai: 'OpenAI Compatible',
    openai2: 'OpenAI Compatible 2',
    'lm-studio': 'LM Studio',
    ollama: 'Ollama',
    'openai-compatible': 'OpenAI Compatible',
    'built-in-ai': 'Built-in AI',
};
