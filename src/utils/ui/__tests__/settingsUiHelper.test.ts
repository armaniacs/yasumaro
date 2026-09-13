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
        test('displays a success message', () => {
            vi.useFakeTimers();
            showStatus('status-message', 'Saved!', 'success');

            const el = document.getElementById('status-message');
            expect(el?.textContent).toBe('Saved!');
            expect(el?.className).toBe('success');
        });

        test('displays an error message', () => {
            vi.useFakeTimers();
            showStatus('status-message', 'Error!', 'error');

            const el = document.getElementById('status-message');
            expect(el?.textContent).toBe('Error!');
            expect(el?.className).toBe('error');
        });

        test('clears a success message after 3 seconds', () => {
            vi.useFakeTimers();
            showStatus('status-message', 'Saved!', 'success');

            vi.advanceTimersByTime(3000);

            const el = document.getElementById('status-message');
            expect(el?.textContent).toBe('');
            expect(el?.className).toBe('');
        });

        test('clears an error message after 5 seconds', () => {
            vi.useFakeTimers();
            showStatus('status-message', 'Error!', 'error');

            vi.advanceTimersByTime(4999);
            expect(document.getElementById('status-message')?.textContent).toBe('Error!');

            vi.advanceTimersByTime(1);
            expect(document.getElementById('status-message')?.textContent).toBe('');
            expect(document.getElementById('status-message')?.className).toBe('');
        });

        test('does nothing for a nonexistent element ID', () => {
            expect(() => showStatus('nonexistent', 'msg', 'success')).not.toThrow();
        });
    });

    describe('loadSettingsToInputs', () => {
        test('loads settings into text inputs', () => {
            loadSettingsToInputs(form(), { obsidian_port: '27123', obsidian_protocol: 'http' });

            expect((document.getElementById('obsidian_port') as HTMLInputElement).value).toBe('27123');
            expect((document.getElementById('obsidian_protocol') as HTMLInputElement).value).toBe('http');
        });

        test('sets checkbox checked state', () => {
            loadSettingsToInputs(form(), { ublock_format_enabled: true, simple_format_enabled: false });

            expect((document.getElementById('ublock_format_enabled') as HTMLInputElement).checked).toBe(true);
            expect((document.getElementById('simple_format_enabled') as HTMLInputElement).checked).toBe(false);
        });

        test('shows a placeholder when an API key is already set', () => {
            loadSettingsToInputs(form(), { obsidian_api_key: 'secret_key_123' });

            const apiKeyInput = document.getElementById('obsidian_api_key') as HTMLInputElement;
            expect(apiKeyInput.placeholder).toBe('\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf (Already set)');
            expect(apiKeyInput.value).toBe('');
        });

        test('sets no placeholder when the API key is empty', () => {
            loadSettingsToInputs(form(), { obsidian_api_key: '' });

            expect((document.getElementById('obsidian_api_key') as HTMLInputElement).placeholder).toBe('');
        });

        test('loads a value into a select element', () => {
            loadSettingsToInputs(form(), { ai_provider: 'openai' });

            expect((document.getElementById('ai_provider') as HTMLSelectElement).value).toBe('openai');
        });

        test('loads a value into a textarea', () => {
            loadSettingsToInputs(form(), { obsidian_daily_path: 'Daily/{{date:YYYY-MM-DD}}' });

            expect((document.getElementById('obsidian_daily_path') as HTMLTextAreaElement).value).toBe('Daily/{{date:YYYY-MM-DD}}');
        });

        test('does not throw for a null container', () => {
            expect(() => loadSettingsToInputs(document.createElement('div'), { obsidian_port: '27123' })).not.toThrow();
        });

        test('does nothing when a setting is undefined', () => {
            loadSettingsToInputs(form(), {});
            expect((document.getElementById('obsidian_port') as HTMLInputElement).value).toBe('');
        });

        test('does nothing when a setting is null', () => {
            loadSettingsToInputs(form(), { obsidian_port: null });
            expect((document.getElementById('obsidian_port') as HTMLInputElement).value).toBe('');
        });
    });

    describe('extractSettingsFromInputs', () => {
        test('extracts values from text inputs', () => {
            (document.getElementById('obsidian_port') as HTMLInputElement).value = '27123';

            const settings = extractSettingsFromInputs(form());
            expect(settings.obsidian_port).toBe('27123');
        });

        test('converts number inputs to Number', () => {
            const numInput = document.getElementById('min_visit_duration') as HTMLInputElement;
            numInput.type = 'number';
            numInput.value = '30';

            const settings = extractSettingsFromInputs(form());
            expect(settings.min_visit_duration).toBe(30);
        });

        test('extracts checkbox checked state', () => {
            const checkbox = document.getElementById('ublock_format_enabled') as HTMLInputElement;
            checkbox.type = 'checkbox';
            checkbox.checked = true;

            const settings = extractSettingsFromInputs(form());
            expect(settings.ublock_format_enabled).toBe(true);
        });

        test('returns false for an unchecked checkbox', () => {
            const checkbox = document.getElementById('simple_format_enabled') as HTMLInputElement;
            checkbox.type = 'checkbox';
            checkbox.checked = false;

            const settings = extractSettingsFromInputs(form());
            expect(settings.simple_format_enabled).toBe(false);
        });

        test('skips an empty API key', () => {
            (document.getElementById('obsidian_api_key') as HTMLInputElement).value = '';

            const settings = extractSettingsFromInputs(form());
            expect(settings.obsidian_api_key).toBeUndefined();
        });

        test('includes an API key when one is entered', () => {
            (document.getElementById('gemini_api_key') as HTMLInputElement).value = 'new_key_123';

            const settings = extractSettingsFromInputs(form());
            expect(settings.gemini_api_key).toBe('new_key_123');
        });

        test('works when the container has elements without data-storage-key', () => {
            const el = document.createElement('input');
            el.id = 'no-key';
            el.value = 'ignored';
            document.getElementById('form')!.appendChild(el);

            const settings = extractSettingsFromInputs(form());
            expect(Object.keys(settings)).not.toContain('no-key');
        });

        test('trims string values', () => {
            (document.getElementById('obsidian_port') as HTMLInputElement).value = '  27123  ';

            const settings = extractSettingsFromInputs(form());
            expect(settings.obsidian_port).toBe('27123');
        });

        test('extracts multiple fields at once', () => {
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
