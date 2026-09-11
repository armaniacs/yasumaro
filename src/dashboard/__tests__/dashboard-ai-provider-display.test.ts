// @vitest-environment jsdom
/**
 * dashboard-ai-provider-display.test.ts
 * Tests for AI provider/model display in history entries
 *
 * 対象機能: 履歴エントリでのAIプロバイダー/モデル表示
 * - aiProvider が存在する場合に表示する
 * - aiModel が存在する場合は "プロバイダー / モデル" 形式で表示する
 * - aiProvider がない場合は表示しない
 */



/**
 * 履歴エントリのAIプロバイダー表示ロジックを抽出した純粋関数
 * dashboard.ts の renderHistoryEntry() 相当部分のテスト対象
 */
function renderAiProviderElement(
  container: HTMLElement,
  aiProvider: string | undefined,
  aiModel: string | undefined
): HTMLElement | null {
  if (aiProvider === undefined) return null;

  const el = document.createElement('div');
  el.className = 'history-entry-tokens';
  const parts = [aiProvider];
  if (aiModel) parts.push(aiModel);
  el.textContent = `AI: ${parts.join(' / ')}`;
  container.appendChild(el);
  return el;
}

describe('履歴エントリ: AIプロバイダー/モデル表示', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  test('appends an element when aiProvider is set', () => {
    renderAiProviderElement(container, 'openai', undefined);
    const el = container.querySelector('.history-entry-tokens');
    expect(el).not.toBeNull();
  });

  test('renders "AI: openai" when only aiProvider is set', () => {
    renderAiProviderElement(container, 'openai', undefined);
    const el = container.querySelector('.history-entry-tokens');
    expect(el?.textContent).toBe('AI: openai');
  });

  test('renders "AI: openai / gpt-4o" format when aiProvider and aiModel are set', () => {
    renderAiProviderElement(container, 'openai', 'gpt-4o');
    const el = container.querySelector('.history-entry-tokens');
    expect(el?.textContent).toBe('AI: openai / gpt-4o');
  });

  test('renders the lm-studio provider and model', () => {
    renderAiProviderElement(container, 'lm-studio', 'lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF');
    const el = container.querySelector('.history-entry-tokens');
    expect(el?.textContent).toBe('AI: lm-studio / lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF');
  });

  test('does not append an element when aiProvider is undefined', () => {
    renderAiProviderElement(container, undefined, undefined);
    const el = container.querySelector('.history-entry-tokens');
    expect(el).toBeNull();
  });

  test('returns null when aiProvider is undefined', () => {
    const result = renderAiProviderElement(container, undefined, 'some-model');
    expect(result).toBeNull();
  });

  test('renders only the provider when aiModel is an empty string', () => {
    renderAiProviderElement(container, 'gemini', '');
    const el = container.querySelector('.history-entry-tokens');
    expect(el?.textContent).toBe('AI: gemini');
  });

  test('uses history-entry-tokens as the element class', () => {
    const el = renderAiProviderElement(container, 'openai', 'gpt-3.5-turbo');
    expect(el?.className).toBe('history-entry-tokens');
  });
});
