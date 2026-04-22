// @vitest-environment jsdom
/**
 * settingsUiHelper.test.ts
 * settingsUiHelper.ts の単体テスト
 *
 * jsdom 環境で実行（jest.config.cjs で testEnvironment: 'jsdom'）
 */

// chrome API モック
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
        <div id="status-message"></div>
        <input type="text" id="obsidian_port" />
        <input type="text" id="obsidian_protocol" />
        <input type="password" id="obsidian_api_key" />
        <input type="password" id="gemini_api_key" />
        <input type="password" id="openai_api_key" />
        <input type="password" id="openai_2_api_key" />
        <input type="checkbox" id="ublock_format_enabled" />
        <input type="checkbox" id="simple_format_enabled" />
        <input type="number" id="min_visit_duration" />
        <textarea id="obsidian_daily_path"></textarea>
        <select id="ai_provider">
            <option value="gemini">Gemini</option>
            <option value="openai">OpenAI</option>
        </select>
    `;
}

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
            loadSettingsToInputs({ obsidian_port: '27123', obsidian_protocol: 'http' }, {
                obsidian_port: document.getElementById('obsidian_port'),
                obsidian_protocol: document.getElementById('obsidian_protocol')
            });

            expect((document.getElementById('obsidian_port') as HTMLInputElement).value).toBe('27123');
            expect((document.getElementById('obsidian_protocol') as HTMLInputElement).value).toBe('http');
        });

        test('チェックボックスの checked を設定する', () => {
            loadSettingsToInputs({ ublock_format_enabled: true, simple_format_enabled: false }, {
                ublock_format_enabled: document.getElementById('ublock_format_enabled'),
                simple_format_enabled: document.getElementById('simple_format_enabled')
            });

            expect((document.getElementById('ublock_format_enabled') as HTMLInputElement).checked).toBe(true);
            expect((document.getElementById('simple_format_enabled') as HTMLInputElement).checked).toBe(false);
        });

        test('APIキーが設定済みの場合はプレースホルダーを表示', () => {
            loadSettingsToInputs({ obsidian_api_key: 'secret_key_123' }, {
                obsidian_api_key: document.getElementById('obsidian_api_key')
            });

            const apiKeyInput = document.getElementById('obsidian_api_key') as HTMLInputElement;
            expect(apiKeyInput.placeholder).toBe('●●●●●●●● (Already set)');
            expect(apiKeyInput.value).toBe('');
        });

        test('APIキーが空の場合はプレースホルダーを設定しない', () => {
            loadSettingsToInputs({ obsidian_api_key: '' }, {
                obsidian_api_key: document.getElementById('obsidian_api_key')
            });

            expect((document.getElementById('obsidian_api_key') as HTMLInputElement).placeholder).toBe('');
        });

        test('select 要素に値をロードする', () => {
            loadSettingsToInputs({ ai_provider: 'openai' }, {
                ai_provider: document.getElementById('ai_provider')
            });

            expect((document.getElementById('ai_provider') as HTMLSelectElement).value).toBe('openai');
        });

        test('textarea に値をロードする', () => {
            loadSettingsToInputs({ obsidian_daily_path: 'Daily/{{date:YYYY-MM-DD}}' }, {
                obsidian_daily_path: document.getElementById('obsidian_daily_path')
            });

            expect((document.getElementById('obsidian_daily_path') as HTMLTextAreaElement).value).toBe('Daily/{{date:YYYY-MM-DD}}');
        });

        test('null の element はスキップする', () => {
            expect(() => loadSettingsToInputs({ obsidian_port: '27123' }, { obsidian_port: null })).not.toThrow();
        });

        test('設定値が undefined の場合は何もしない', () => {
            loadSettingsToInputs({}, { obsidian_port: document.getElementById('obsidian_port') });
            expect((document.getElementById('obsidian_port') as HTMLInputElement).value).toBe('');
        });

        test('設定値が null の場合は何もしない', () => {
            loadSettingsToInputs({ obsidian_port: null }, { obsidian_port: document.getElementById('obsidian_port') });
            expect((document.getElementById('obsidian_port') as HTMLInputElement).value).toBe('');
        });
    });

    describe('extractSettingsFromInputs', () => {
        test('テキスト入力から値を抽出する', () => {
            (document.getElementById('obsidian_port') as HTMLInputElement).value = '27123';

            const settings = extractSettingsFromInputs({ obsidian_port: document.getElementById('obsidian_port') });
            expect(settings.obsidian_port).toBe('27123');
        });

        test('number 入力は parseInt される', () => {
            const numInput = document.getElementById('min_visit_duration') as HTMLInputElement;
            numInput.type = 'number';
            numInput.value = '30';

            const settings = extractSettingsFromInputs({ min_visit_duration: document.getElementById('min_visit_duration') });
            expect(settings.min_visit_duration).toBe(30);
        });

        test('checkbox は checked を抽出する', () => {
            const checkbox = document.getElementById('ublock_format_enabled') as HTMLInputElement;
            checkbox.type = 'checkbox';
            checkbox.checked = true;

            const settings = extractSettingsFromInputs({ ublock_format_enabled: document.getElementById('ublock_format_enabled') });
            expect(settings.ublock_format_enabled).toBe(true);
        });

        test('checkbox の unchecked は false を返す', () => {
            const checkbox = document.getElementById('simple_format_enabled') as HTMLInputElement;
            checkbox.type = 'checkbox';
            checkbox.checked = false;

            const settings = extractSettingsFromInputs({ simple_format_enabled: document.getElementById('simple_format_enabled') });
            expect(settings.simple_format_enabled).toBe(false);
        });

        test('APIキー空欄はスキップする', () => {
            (document.getElementById('obsidian_api_key') as HTMLInputElement).value = '';

            const settings = extractSettingsFromInputs({ obsidian_api_key: document.getElementById('obsidian_api_key') });
            expect(settings.obsidian_api_key).toBeUndefined();
        });

        test('APIキーに入力がある場合は含まれる', () => {
            (document.getElementById('gemini_api_key') as HTMLInputElement).value = 'new_key_123';

            const settings = extractSettingsFromInputs({ gemini_api_key: document.getElementById('gemini_api_key') });
            expect(settings.gemini_api_key).toBe('new_key_123');
        });

        test('null の element はスキップする', () => {
            const settings = extractSettingsFromInputs({ obsidian_port: null });
            expect(settings.obsidian_port).toBeUndefined();
        });

        test('文字列値は trim される', () => {
            (document.getElementById('obsidian_port') as HTMLInputElement).value = '  27123  ';

            const settings = extractSettingsFromInputs({ obsidian_port: document.getElementById('obsidian_port') });
            expect(settings.obsidian_port).toBe('27123');
        });

        test('複数フィールドを同時に抽出できる', () => {
            (document.getElementById('obsidian_port') as HTMLInputElement).value = '27123';
            (document.getElementById('obsidian_protocol') as HTMLInputElement).value = 'https';
            const checkbox = document.getElementById('ublock_format_enabled') as HTMLInputElement;
            checkbox.type = 'checkbox';
            checkbox.checked = true;

            const settings = extractSettingsFromInputs({
                obsidian_port: document.getElementById('obsidian_port'),
                obsidian_protocol: document.getElementById('obsidian_protocol'),
                ublock_format_enabled: document.getElementById('ublock_format_enabled')
            });
            expect(settings.obsidian_port).toBe('27123');
            expect(settings.obsidian_protocol).toBe('https');
            expect(settings.ublock_format_enabled).toBe(true);
        });
    });
});
