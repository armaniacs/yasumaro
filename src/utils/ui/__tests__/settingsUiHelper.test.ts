// @vitest-environment jsdom

const mockChrome = {
    storage: { local: { get: vi.fn(), set: vi.fn() } },
    i18n: { getMessage: vi.fn((key: string) => key) }
};
(globalThis as any).chrome = mockChrome;

import {
    showStatus,
    loadSettingsToInputs,
    extractSettingsFromInputs
} from '../settingsUiHelper.js';

function setupDOM(): void {
    document.body.innerHTML = `
        <div id="form">
        <div id="status-message"></div>
        <input type="text" id="obsidian_port" data-storage-key="obsidian_port" />
        <input type="text" id="obsidian_protocol" data-storage-key="obsidian_protocol" />
        <input type="password" id="obsidian_api_key" data-storage-key="obsidian_api_key" />
        <input type="password" id="gemini_api_key" data-storage-key="gemini_api_key" />
        <input type="password" id="openai_api_key" data-storage-key="openai_api_key" />
        <input type="password" id="openai_2_api_key" data-storage-key="openai_2_api_key" />
        <input type="checkbox" id="ublock_format_enabled" data-storage-key="ublock_format_enabled" />
        <input type="checkbox" id="simple_format_enabled" data-storage-key="simple_format_enabled" />
        <input type="number" id="min_visit_duration" data-storage-key="min_visit_duration" />
        <textarea id="obsidian_daily_path" data-storage-key="obsidian_daily_path"></textarea>
        <select id="ai_provider" data-storage-key="ai_provider">
            <option value="gemini">Gemini</option>
            <option value="openai">OpenAI</option>
        </select>
        </div>
    `;
}

const form = (): HTMLElement => document.getElementById('form')!;

describe('settingsUiHelper', () => {

    beforeEach(() => {
        setupDOM();
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    describe('showStatus', () => {
        test('success メッセージを表示する', () => {
            vi.useFakeTimers();
            showStatus('status-message', 'Saved!', 'success');

            const el = document.getElementById('status-message');
            expect(el?.textContent).toBe('Saved!');
            expect(el?.className).toBe('success');
        });

        test('error メッセージを表示する', () => {
            vi.useFakeTimers();
            showStatus('status-message', 'Error!', 'error');

            const el = document.getElementById('status-message');
            expect(el?.textContent).toBe('Error!');
            expect(el?.className).toBe('error');
        });

        test('success メッセージは3秒後にクリアされる', () => {
            vi.useFakeTimers();
            showStatus('status-message', 'Saved!', 'success');

            vi.advanceTimersByTime(3000);

            const el = document.getElementById('status-message');
            expect(el?.textContent).toBe('');
            expect(el?.className).toBe('');
        });

        test('error メッセージは5秒後にクリアされる', () => {
            vi.useFakeTimers();
            showStatus('status-message', 'Error!', 'error');

            vi.advanceTimersByTime(4999);
            expect(document.getElementById('status-message')?.textContent).toBe('Error!');

            vi.advanceTimersByTime(1);
            expect(document.getElementById('status-message')?.textContent).toBe('');
            expect(document.getElementById('status-message')?.className).toBe('');
        });

        test('存在しない要素IDの場合は何もしない', () => {
            expect(() => showStatus('nonexistent', 'msg', 'success')).not.toThrow();
        });
    });

    describe('loadSettingsToInputs', () => {
        test('テキスト入力に設定値をロードする', () => {
            loadSettingsToInputs(form(), { obsidian_port: '27123', obsidian_protocol: 'http' });

            expect((document.getElementById('obsidian_port') as HTMLInputElement).value).toBe('27123');
            expect((document.getElementById('obsidian_protocol') as HTMLInputElement).value).toBe('http');
        });

        test('チェックボックスの checked を設定する', () => {
            loadSettingsToInputs(form(), { ublock_format_enabled: true, simple_format_enabled: false });

            expect((document.getElementById('ublock_format_enabled') as HTMLInputElement).checked).toBe(true);
            expect((document.getElementById('simple_format_enabled') as HTMLInputElement).checked).toBe(false);
        });

        test('APIキーが設定済みの場合はプレースホルダーを表示', () => {
            loadSettingsToInputs(form(), { obsidian_api_key: 'secret_key_123' });

            const apiKeyInput = document.getElementById('obsidian_api_key') as HTMLInputElement;
            expect(apiKeyInput.placeholder).toBe('\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf (Already set)');
            expect(apiKeyInput.value).toBe('');
        });

        test('APIキーが空の場合はプレースホルダーを設定しない', () => {
            loadSettingsToInputs(form(), { obsidian_api_key: '' });

            expect((document.getElementById('obsidian_api_key') as HTMLInputElement).placeholder).toBe('');
        });

        test('select 要素に値をロードする', () => {
            loadSettingsToInputs(form(), { ai_provider: 'openai' });

            expect((document.getElementById('ai_provider') as HTMLSelectElement).value).toBe('openai');
        });

        test('textarea に値をロードする', () => {
            loadSettingsToInputs(form(), { obsidian_daily_path: 'Daily/{{date:YYYY-MM-DD}}' });

            expect((document.getElementById('obsidian_daily_path') as HTMLTextAreaElement).value).toBe('Daily/{{date:YYYY-MM-DD}}');
        });

        test('null の container でもエラーにならない', () => {
            expect(() => loadSettingsToInputs(document.createElement('div'), { obsidian_port: '27123' })).not.toThrow();
        });

        test('設定値が undefined の場合は何もしない', () => {
            loadSettingsToInputs(form(), {});
            expect((document.getElementById('obsidian_port') as HTMLInputElement).value).toBe('');
        });

        test('設定値が null の場合は何もしない', () => {
            loadSettingsToInputs(form(), { obsidian_port: null });
            expect((document.getElementById('obsidian_port') as HTMLInputElement).value).toBe('');
        });
    });

    describe('extractSettingsFromInputs', () => {
        test('テキスト入力から値を抽出する', () => {
            (document.getElementById('obsidian_port') as HTMLInputElement).value = '27123';

            const settings = extractSettingsFromInputs(form());
            expect(settings.obsidian_port).toBe('27123');
        });

        test('number 入力は Number に変換される', () => {
            const numInput = document.getElementById('min_visit_duration') as HTMLInputElement;
            numInput.type = 'number';
            numInput.value = '30';

            const settings = extractSettingsFromInputs(form());
            expect(settings.min_visit_duration).toBe(30);
        });

        test('checkbox は checked を抽出する', () => {
            const checkbox = document.getElementById('ublock_format_enabled') as HTMLInputElement;
            checkbox.type = 'checkbox';
            checkbox.checked = true;

            const settings = extractSettingsFromInputs(form());
            expect(settings.ublock_format_enabled).toBe(true);
        });

        test('checkbox の unchecked は false を返す', () => {
            const checkbox = document.getElementById('simple_format_enabled') as HTMLInputElement;
            checkbox.type = 'checkbox';
            checkbox.checked = false;

            const settings = extractSettingsFromInputs(form());
            expect(settings.simple_format_enabled).toBe(false);
        });

        test('APIキー空欄はスキップする', () => {
            (document.getElementById('obsidian_api_key') as HTMLInputElement).value = '';

            const settings = extractSettingsFromInputs(form());
            expect(settings.obsidian_api_key).toBeUndefined();
        });

        test('APIキーに入力がある場合は含まれる', () => {
            (document.getElementById('gemini_api_key') as HTMLInputElement).value = 'new_key_123';

            const settings = extractSettingsFromInputs(form());
            expect(settings.gemini_api_key).toBe('new_key_123');
        });

        test('container に data-storage-key がない要素があっても動作する', () => {
            const el = document.createElement('input');
            el.id = 'no-key';
            el.value = 'ignored';
            document.getElementById('form')!.appendChild(el);

            const settings = extractSettingsFromInputs(form());
            expect(Object.keys(settings)).not.toContain('no-key');
        });

        test('文字列値は trim される', () => {
            (document.getElementById('obsidian_port') as HTMLInputElement).value = '  27123  ';

            const settings = extractSettingsFromInputs(form());
            expect(settings.obsidian_port).toBe('27123');
        });

        test('複数フィールドを同時に抽出できる', () => {
            (document.getElementById('obsidian_port') as HTMLInputElement).value = '27123';
            (document.getElementById('obsidian_protocol') as HTMLInputElement).value = 'https';
            const checkbox = document.getElementById('ublock_format_enabled') as HTMLInputElement;
            checkbox.type = 'checkbox';
            checkbox.checked = true;

            const settings = extractSettingsFromInputs(form());
            expect(settings.obsidian_port).toBe('27123');
            expect(settings.obsidian_protocol).toBe('https');
            expect(settings.ublock_format_enabled).toBe(true);
        });
    });
});
