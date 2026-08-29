// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { applyI18n, translatePageTitle, setHtmlLangAndDir } from '../i18n-dom.js';

describe('i18n-dom - branch coverage', () => {
  let origChrome: unknown;

  beforeEach(() => {
    origChrome = (globalThis as unknown as Record<string, unknown>).chrome;
    document.body.innerHTML = '';
    document.documentElement.lang = '';
    document.documentElement.dir = '';
    document.title = '';
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (origChrome === undefined) {
      delete (globalThis as unknown as Record<string, unknown>).chrome;
    } else {
      (globalThis as unknown as Record<string, unknown>).chrome = origChrome;
    }
    document.body.innerHTML = '';
  });

  function mockGetMessage(impl: (key: string, subs?: unknown) => string) {
    (globalThis as unknown as Record<string, unknown>).chrome = {
      i18n: {
        getMessage: vi.fn(impl),
        getUILanguage: vi.fn(() => 'en-US'),
      },
      runtime: { lastError: null },
    } as unknown;
  }

  describe('resolvePluralKey branches via applyI18n', () => {
    it('returns base key when args is null', () => {
      mockGetMessage((key) => (key === 'hello' ? 'Hello' : ''));
      const div = document.createElement('div');
      div.setAttribute('data-i18n', 'hello');
      document.body.appendChild(div);
      applyI18n();
      expect(div.textContent).toBe('Hello');
      expect((globalThis.chrome.i18n.getMessage as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('hello');
    });

    it('returns base key when args does not contain count', () => {
      mockGetMessage((key) => (key === 'greet' ? 'Hi {name}' : ''));
      const div = document.createElement('div');
      div.setAttribute('data-i18n', 'greet');
      div.setAttribute('data-i18n-args', '{"name":"Bob"}');
      document.body.appendChild(div);
      applyI18n();
      expect(div.textContent).toBe('Hi Bob');
    });

    it('returns base key when count is NaN', () => {
      mockGetMessage((key) => (key === 'cnt' ? 'Cnt {count}' : ''));
      const div = document.createElement('div');
      div.setAttribute('data-i18n', 'cnt');
      div.setAttribute('data-i18n-args', '{"count":"not-a-number"}');
      document.body.appendChild(div);
      applyI18n();
      // NaN path -> base key used, getMessage('cnt', args)
      expect(div.textContent).toBe('Cnt not-a-number');
    });

    it('uses plural suffix for en locale count=1 -> _one', () => {
      mockGetMessage((key) => {
        if (key === 'itemCount_one') return '1 item';
        if (key === 'itemCount_other') return '{count} items';
        return '';
      });
      (globalThis.chrome.i18n.getUILanguage as ReturnType<typeof vi.fn>).mockReturnValue('en-US');
      const div = document.createElement('div');
      div.setAttribute('data-i18n', 'itemCount');
      div.setAttribute('data-i18n-args', '{"count":1}');
      document.body.appendChild(div);
      applyI18n();
      expect(div.textContent).toBe('1 item');
    });

    it('uses plural suffix for en locale count=2 -> _other', () => {
      mockGetMessage((key) => {
        if (key === 'itemCount_one') return '1 item';
        if (key === 'itemCount_other') return '{count} items';
        return '';
      });
      (globalThis.chrome.i18n.getUILanguage as ReturnType<typeof vi.fn>).mockReturnValue('en-US');
      const div = document.createElement('div');
      div.setAttribute('data-i18n', 'itemCount');
      div.setAttribute('data-i18n-args', '{"count":2}');
      document.body.appendChild(div);
      applyI18n();
      expect(div.textContent).toBe('2 items');
    });

    it('falls back to base key for ja locale (no plural)', () => {
      mockGetMessage((key) => (key === 'itemCount' ? '{count}件' : ''));
      (globalThis.chrome.i18n.getUILanguage as ReturnType<typeof vi.fn>).mockReturnValue('ja-JP');
      const div = document.createElement('div');
      div.setAttribute('data-i18n', 'itemCount');
      div.setAttribute('data-i18n-args', '{"count":5}');
      document.body.appendChild(div);
      applyI18n();
      expect(div.textContent).toBe('5件');
    });

    it('count as numeric string is coerced via Number()', () => {
      mockGetMessage((key) => {
        if (key === 'n_one') return 'one';
        if (key === 'n_other') return 'other';
        return '';
      });
      (globalThis.chrome.i18n.getUILanguage as ReturnType<typeof vi.fn>).mockReturnValue('en');
      const div = document.createElement('div');
      div.setAttribute('data-i18n', 'n');
      div.setAttribute('data-i18n-args', '{"count":"1"}');
      document.body.appendChild(div);
      applyI18n();
      expect(div.textContent).toBe('one');
    });
  });

  describe('applyI18n - core branches', () => {
    it('preserves fallback text when translation is empty string (translatedText falsy guard)', () => {
      mockGetMessage(() => '');
      const div = document.createElement('div');
      div.setAttribute('data-i18n', 'missingKey');
      div.textContent = 'Fallback';
      document.body.appendChild(div);
      applyI18n();
      expect(div.textContent).toBe('Fallback');
    });

    it('skips element when data-i18n attribute is empty (key falsy guard)', () => {
      mockGetMessage(() => 'should not be called');
      const div = document.createElement('div');
      div.setAttribute('data-i18n', '');
      div.textContent = 'original';
      document.body.appendChild(div);
      applyI18n();
      expect(div.textContent).toBe('original');
    });

    it('handles malformed JSON in data-i18n-args gracefully (catch branch)', () => {
      mockGetMessage((key) => (key === 'hello' ? 'Hello' : ''));
      const div = document.createElement('div');
      div.setAttribute('data-i18n', 'hello');
      div.setAttribute('data-i18n-args', '{not-json}');
      document.body.appendChild(div);
      expect(() => applyI18n()).not.toThrow();
      expect(div.textContent).toBe('Hello');
    });

    it('sets placeholder for INPUT element via data-i18n', () => {
      mockGetMessage(() => 'Placeholder Text');
      const input = document.createElement('input');
      input.setAttribute('data-i18n', 'phKey');
      document.body.appendChild(input);
      applyI18n();
      expect(input.placeholder).toBe('Placeholder Text');
    });

    it('sets placeholder for TEXTAREA via data-i18n', () => {
      mockGetMessage(() => 'TA Placeholder');
      const ta = document.createElement('textarea');
      ta.setAttribute('data-i18n', 'taKey');
      document.body.appendChild(ta);
      applyI18n();
      expect(ta.placeholder).toBe('TA Placeholder');
    });

    it('sets title for IMG via data-i18n', () => {
      mockGetMessage(() => 'Img Title');
      const img = document.createElement('img');
      img.setAttribute('data-i18n', 'imgKey');
      document.body.appendChild(img);
      applyI18n();
      expect(img.title).toBe('Img Title');
    });

    it('sets textContent for generic element (div) via data-i18n', () => {
      mockGetMessage(() => 'Div Text');
      const div = document.createElement('div');
      div.setAttribute('data-i18n', 'divKey');
      document.body.appendChild(div);
      applyI18n();
      expect(div.textContent).toBe('Div Text');
    });

    it('does not overwrite element when translatedText is falsy for INPUT', () => {
      mockGetMessage(() => '');
      const input = document.createElement('input');
      input.setAttribute('data-i18n', 'missing');
      input.placeholder = 'keep-me';
      document.body.appendChild(input);
      applyI18n();
      expect(input.placeholder).toBe('keep-me');
    });

    it('handles Document root (element instanceof Document branch)', () => {
      mockGetMessage((key) => (key === 'hello' ? 'Hello Doc' : ''));
      const div = document.createElement('div');
      div.setAttribute('data-i18n', 'hello');
      document.body.appendChild(div);
      applyI18n(document);
      expect(div.textContent).toBe('Hello Doc');
    });

    it('handles HTMLElement root and scopes translation to that subtree', () => {
      mockGetMessage((k) => (k === 'inside' ? 'Inside' : ''));
      const container = document.createElement('div');
      const inside = document.createElement('span');
      inside.setAttribute('data-i18n', 'inside');
      const outside = document.createElement('span');
      outside.setAttribute('data-i18n', 'inside');
      outside.textContent = 'outside-original';
      container.appendChild(inside);
      document.body.appendChild(container);
      document.body.appendChild(outside);
      applyI18n(container);
      expect(inside.textContent).toBe('Inside');
      expect(outside.textContent).toBe('outside-original');
    });

    it('plural key uses JSON-parsed count even when translatedText missing -> preserves fallback', () => {
      mockGetMessage(() => '');
      const div = document.createElement('div');
      div.setAttribute('data-i18n', 'missingPlural');
      div.setAttribute('data-i18n-args', '{"count":1}');
      div.textContent = 'fallback';
      document.body.appendChild(div);
      applyI18n();
      expect(div.textContent).toBe('fallback');
    });
  });

  describe('applyI18n - placeholder, aria, options, labels, help', () => {
    it('translates data-i18n-input-placeholder (no args)', () => {
      mockGetMessage((k) => (k === 'ph' ? 'Enter name' : ''));
      const input = document.createElement('input');
      input.setAttribute('data-i18n-input-placeholder', 'ph');
      document.body.appendChild(input);
      applyI18n();
      expect(input.placeholder).toBe('Enter name');
    });

    it('translates data-i18n-input-placeholder with args and plural count', () => {
      mockGetMessage((k) => {
        if (k === 'cnt_one') return '1 item';
        if (k === 'cnt_other') return '{count} items';
        return '';
      });
      (globalThis.chrome.i18n.getUILanguage as ReturnType<typeof vi.fn>).mockReturnValue('en');
      const input = document.createElement('input');
      input.setAttribute('data-i18n-input-placeholder', 'cnt');
      input.setAttribute('data-i18n-args', '{"count":5}');
      document.body.appendChild(input);
      applyI18n();
      expect(input.placeholder).toBe('5 items');
    });

    it('skips placeholder element when key missing (falsy guard)', () => {
      mockGetMessage(() => 'should-not-appear');
      const input = document.createElement('input');
      input.setAttribute('data-i18n-input-placeholder', '');
      input.placeholder = 'keep';
      document.body.appendChild(input);
      applyI18n();
      expect(input.placeholder).toBe('keep');
    });

    it('placeholder element with invalid JSON args uses raw JSON.parse failure path', () => {
      mockGetMessage(() => 'ok');
      const input = document.createElement('input');
      input.setAttribute('data-i18n-input-placeholder', 'k');
      input.setAttribute('data-i18n-args', '{bad}');
      document.body.appendChild(input);
      expect(() => applyI18n()).toThrow(); // placeholder branch does JSON.parse without try-catch -> should throw
    });

    it('translates data-i18n-aria-label', () => {
      mockGetMessage((k) => (k === 'lbl' ? 'Close dialog' : ''));
      const btn = document.createElement('button');
      btn.setAttribute('data-i18n-aria-label', 'lbl');
      document.body.appendChild(btn);
      applyI18n();
      expect(btn.getAttribute('aria-label')).toBe('Close dialog');
    });

    it('skips aria-label element when key missing', () => {
      mockGetMessage(() => 'nope');
      const btn = document.createElement('button');
      btn.setAttribute('data-i18n-aria-label', '');
      document.body.appendChild(btn);
      applyI18n();
      expect(btn.getAttribute('aria-label')).toBeNull();
    });

    it('translateOptions: translates option[data-i18n-opt] inside select', () => {
      mockGetMessage((k) => (k === 'opt1' ? 'Option One' : ''));
      const select = document.createElement('select');
      const opt = document.createElement('option');
      opt.setAttribute('data-i18n-opt', 'opt1');
      opt.text = 'original';
      select.appendChild(opt);
      document.body.appendChild(select);
      applyI18n();
      expect(opt.text).toBe('Option One');
    });

    it('translateOptions: skips option when key empty (falsy guard)', () => {
      mockGetMessage(() => 'should-not');
      const select = document.createElement('select');
      const opt = document.createElement('option');
      opt.setAttribute('data-i18n-opt', '');
      opt.text = 'keep';
      select.appendChild(opt);
      document.body.appendChild(select);
      applyI18n();
      expect(opt.text).toBe('keep');
    });

    it('translateOptions: does not touch select with no matching options', () => {
      mockGetMessage(() => 'x');
      const select = document.createElement('select');
      const opt = document.createElement('option');
      opt.text = 'plain';
      select.appendChild(opt);
      document.body.appendChild(select);
      expect(() => applyI18n()).not.toThrow();
      expect(opt.text).toBe('plain');
    });

    it('translateButtonLabels: translates [data-i18n-label]', () => {
      mockGetMessage((k) => (k === 'btn' ? 'Click Me' : ''));
      const btn = document.createElement('button');
      btn.setAttribute('data-i18n-label', 'btn');
      document.body.appendChild(btn);
      applyI18n();
      expect(btn.textContent).toBe('Click Me');
    });

    it('translateButtonLabels: skips when key empty', () => {
      mockGetMessage(() => 'nope');
      const btn = document.createElement('button');
      btn.setAttribute('data-i18n-label', '');
      btn.textContent = 'stay';
      document.body.appendChild(btn);
      applyI18n();
      expect(btn.textContent).toBe('stay');
    });

    it('translateHelpText: translates .help-text[data-i18n]', () => {
      mockGetMessage((k) => (k === 'hlp' ? 'Help here' : ''));
      const div = document.createElement('div');
      div.className = 'help-text';
      div.setAttribute('data-i18n', 'hlp');
      document.body.appendChild(div);
      applyI18n();
      expect(div.textContent).toBe('Help here');
    });

    it('translateHelpText: skips .help-text without data-i18n key', () => {
      // No data-i18n, so not selected
      mockGetMessage(() => 'unused');
      const div = document.createElement('div');
      div.className = 'help-text';
      div.textContent = 'original help';
      document.body.appendChild(div);
      applyI18n();
      expect(div.textContent).toBe('original help');
    });

    it('translateHelpText: skips when key empty', () => {
      mockGetMessage(() => 'nope');
      const div = document.createElement('div');
      div.className = 'help-text';
      div.setAttribute('data-i18n', '');
      div.textContent = 'stay';
      document.body.appendChild(div);
      applyI18n();
      expect(div.textContent).toBe('stay');
    });
  });

  describe('translatePageTitle', () => {
    it('sets document.title from getMessage', () => {
      mockGetMessage((k) => (k === 'titleKey' ? 'My Title' : ''));
      translatePageTitle('titleKey');
      expect(document.title).toBe('My Title');
    });

    it('sets empty string when key missing', () => {
      mockGetMessage(() => '');
      translatePageTitle('missingTitle');
      expect(document.title).toBe('');
    });
  });

  describe('setHtmlLangAndDir', () => {
    it('sets ltr for en-US', () => {
      mockGetMessage(() => '');
      (globalThis.chrome.i18n.getUILanguage as ReturnType<typeof vi.fn>).mockReturnValue('en-US');
      setHtmlLangAndDir();
      expect(document.documentElement.lang).toBe('en-US');
      expect(document.documentElement.dir).toBe('ltr');
    });

    it('sets rtl for ar', () => {
      mockGetMessage(() => '');
      (globalThis.chrome.i18n.getUILanguage as ReturnType<typeof vi.fn>).mockReturnValue('ar');
      setHtmlLangAndDir();
      expect(document.documentElement.dir).toBe('rtl');
    });

    it('sets rtl for he (Hebrew)', () => {
      mockGetMessage(() => '');
      (globalThis.chrome.i18n.getUILanguage as ReturnType<typeof vi.fn>).mockReturnValue('he-IL');
      setHtmlLangAndDir();
      expect(document.documentElement.dir).toBe('rtl');
    });

    it('sets rtl for fa', () => {
      mockGetMessage(() => '');
      (globalThis.chrome.i18n.getUILanguage as ReturnType<typeof vi.fn>).mockReturnValue('fa');
      setHtmlLangAndDir();
      expect(document.documentElement.dir).toBe('rtl');
    });

    it('falls back to en-US / ltr when chrome undefined', () => {
      delete (globalThis as unknown as Record<string, unknown>).chrome;
      setHtmlLangAndDir();
      expect(document.documentElement.lang).toBe('en-US');
      expect(document.documentElement.dir).toBe('ltr');
    });

    it('handles locale case-insensitively (AR -> rtl)', () => {
      mockGetMessage(() => '');
      (globalThis.chrome.i18n.getUILanguage as ReturnType<typeof vi.fn>).mockReturnValue('AR-SA');
      setHtmlLangAndDir();
      expect(document.documentElement.dir).toBe('rtl');
    });
  });
});
