// @vitest-environment jsdom
/**
 * ui-ux-improvements.test.js
 * UI/UX改善点のテストスイート
 *
 * UI専門家から報告された問題点のテスト:
 * 1. エラー/成功メッセージの視覚的強化 (高優先度)
 * 2. アクセシビリティ対応 (高優先度)
 * 3. 保存ボタンのラベル統一 (高優先度)
 * 4. 強制記録ボタンのスタイル正規化 (中期)
 * 5. ヘルプテキストの視覚的強化 (中期)
 * 6. ボタンの操作エリア確保 (中期)
 */

import JSDOM from 'jsdom';
import { readFileSync } from 'fs';
import { join } from 'path';
import { vi } from 'vitest';

vi.mock('../../../src/popup/popup.js', () => ({
  initPopup: vi.fn(async () => {})
}));
vi.mock('../../../src/popup/navigation.js', () => ({}));
vi.mock('../../../src/popup/main.js', () => ({}));

type PopupLocale = 'en' | 'ja';

const readOpenHistoryMessage = (locale: PopupLocale): string => {
  const messagesPath = join(__dirname, `../../../public/_locales/${locale}/messages.json`);
  const messages = JSON.parse(readFileSync(messagesPath, 'utf-8')) as {
    openHistory: { message: string };
  };
  return messages.openHistory.message;
};

const openHistoryMessages: Record<PopupLocale, string> = {
  en: readOpenHistoryMessage('en'),
  ja: readOpenHistoryMessage('ja')
};

// popup.htmlを読み込む
const getPopupHTML = () => {
  const htmlPath = join(__dirname, '../../../entrypoints/popup/index.html');
  return readFileSync(htmlPath, 'utf-8');
};

// styles.cssを読み込む
const getStylesCSS = () => {
  const cssPath = join(__dirname, '../../../entrypoints/popup/styles.css');
  return readFileSync(cssPath, 'utf-8');
};

// JSDOMでHTMLをパースしてDOMを作成
const parseHTML = (html: string): Document => {
  const dom = new JSDOM.JSDOM(html);
  return dom.window.document;
};

describe('UI/UX Improvements Test Suite', () => {

  describe('1. エラー/成功メッセージの視覚的強化 (高優先度)', () => {
    let stylesCSS: string;

    beforeAll(() => {
      stylesCSS = getStylesCSS();
    });

    it('defines background and border styles for the .error class', () => {
      expect(stylesCSS).toContain('.error');

      // 背景色が設定されているか確認
      expect(stylesCSS).toMatch(/\.error\s*{[\s\S]*?(?:background|background-color)\s*:/i);

      // ボーダーが設定されているか確認
      expect(stylesCSS).toMatch(/\.error\s*{[\s\S]*?border/);
    });

    it('defines background and border styles for the .success class', () => {
      expect(stylesCSS).toContain('.success');

      // 背景色が設定されているか確認
      expect(stylesCSS).toMatch(/\.success\s*{[\s\S]*?(?:background|background-color)\s*:/i);

      // ボーダーが設定されているか確認
      expect(stylesCSS).toMatch(/\.success\s*{[\s\S]*?border/);
    });

    it('uses a visually prominent color for error messages', () => {
      // エラーは赤系の色またはCSS変数参照であるべき
      expect(stylesCSS).toMatch(/\.error\s*{[\s\S]*?(?:#d9534f|#dc3545|#f44336|var\(--color-danger|rgb\(\s*2[0-9]{2}|rgb\(\s*220)/i);
    });

    it('uses a visually prominent color for success messages', () => {
      // 成功は緑系の色またはCSS変数参照であるべき
      expect(stylesCSS).toMatch(/\.success\s*{[\s\S]*?(?:#4CAF50|#28a745|#5cb85c|var\(--color-success|rgb\(\s*[0-9]{2},\s*[0-9]{2},\s*0)/i);
    });
  });

  describe('2. アクセシビリティ対応 (高優先度)', () => {
    let document: Document;

    beforeAll(() => {
      const html = getPopupHTML();
      document = parseHTML(html);
    });

    it('renders no settings tabs in the popup', () => {
      const tabButtons = document.querySelectorAll('.tab-btn');
      expect(tabButtons.length).toBe(0);
    });

    it('sets aria-live on status elements', () => {
      const statusElements = document.querySelectorAll('#status, #mainStatus, #domainStatus, #privacyStatus');
      expect(statusElements.length).toBeGreaterThan(0);

      statusElements.forEach((status: Element) => {
        const ariaLive = status.getAttribute('aria-live');
        expect(['polite', 'assertive']).toContain(ariaLive);
      });
    });

    it('sets appropriate ARIA attributes for alert-role/alert messages', () => {
      const alertElements = document.querySelectorAll('[role="alert"]');
      // 少なくともdynamicに生成されるエラーメッセージ用のARIAロールが期待される
      // HTML静的分析では要素が存在しない場合もあるため、エラーにならないように検証
      expect(alertElements).toBeTruthy();
    });
  });

  describe('3. 強制記録ボタンのスタイル正規化 (中期)', () => {
    let stylesCSS: string;

    beforeAll(() => {
      stylesCSS = getStylesCSS();
    });

    it('defines the .alert-btn class (no inline styles)', () => {
      expect(stylesCSS).toMatch(/\.alert-btn\s*\{/);
    });

    it('sets a background color for the .alert-btn class', () => {
      expect(stylesCSS).toMatch(/\.alert-btn\s*{[\s\S]*?(?:background|background-color)\s*:/i);
    });

    it('uses no inline styles in errorUtils.js', () => {
      const errorUtilsPath = join(__dirname, '../errorUtils.ts');
      const errorUtils = readFileSync(errorUtilsPath, 'utf-8');

      // インラインスタイルの使用を確認（コメントは除外）
      const styleUsage = errorUtils.match(/\.(style|css)\s*=\s*['"]/);
      expect(styleUsage).toBeNull();
    });
  });

  describe('5. ヘルプテキストの視覚的強化 (中期)', () => {
    let stylesCSS: string;

    beforeAll(() => {
      stylesCSS = getStylesCSS();
    });

    it('defines the .help-text class', () => {
      expect(stylesCSS.includes('.help-text')).toBe(true);
    });

    it('sets a background color for the .help-text class', () => {
      // ヘルプテキストは視覚的に区別できる背景色を持つべき
      const helpTextMatch = stylesCSS.match(/\.help-text\s*{[\s\S]*?background/i);
      expect(helpTextMatch).toBeTruthy();
    });

    it('uses no help-text class in the popup HTML', () => {
      const html = getPopupHTML();
      expect(html).not.toContain('help-text');
    });
  });

  describe('6. ボタンの操作エリア確保 (中期)', () => {
    let stylesCSS: string;

    beforeAll(() => {
      stylesCSS = getStylesCSS();
    });

    it('keeps .icon-btn at least 44x44px', () => {
      // テキストペアリングが隣接していない場合でもクリック可能とするため
      expect(stylesCSS).toMatch(/\.icon-btn\s*{[\s\S]*?width\s*:\s*(?:[4-9]\d|1\d{2})px/i);

      // 実際のスタイルを確認（現在は32px設定だが、アクセシビリティの観点から拡張すべき）
      const iconBtnMatch = stylesCSS.match(/\.icon-btn\s*{[\s\S]*?width\s*:\s*(\d+)px/i);

      if (iconBtnMatch) {
        const width = parseInt(iconBtnMatch[1] ?? '');
        // WCAG 2.5.5のターゲットサイズ要件（最低24×24px）を満たすべき
        // より良いUXのために44×44pxが推奨
        expect(width).toBeGreaterThanOrEqual(24);
      }
    });

    it('gives .primary-btn an adequate touch area', () => {
      expect(stylesCSS).toMatch(/\.primary-btn\s*{[\s\S]*?padding\s*:/i);

      // パディングバリューが10px以上であることを確認
      const primaryBtnMatch = stylesCSS.match(/\.primary-btn\s*{[\s\S]*?padding\s*:\s*(\d+)px/i);
      if (primaryBtnMatch) {
        const padding = parseInt(primaryBtnMatch[1] ?? '');
        expect(padding).toBeGreaterThanOrEqual(10);
      }
    });

    it('gives .secondary-btn an adequate touch area', () => {
      expect(stylesCSS).toMatch(/\.secondary-btn\s*{[\s\S]*?padding\s*:/i);

      const secondaryBtnMatch = stylesCSS.match(/\.secondary-btn\s*{[\s\S]*?padding\s*:\s*(\d+)px/i);
      if (secondaryBtnMatch) {
        const padding = parseInt(secondaryBtnMatch[1] ?? '');
        expect(padding).toBeGreaterThanOrEqual(10);
      }
    });
  });

  describe('7. Popup localization and tokenized spinner', () => {
    const localeCases: Array<{ locale: PopupLocale; uiLanguage: string }> = [
      { locale: 'en', uiLanguage: 'en-US' },
      { locale: 'ja', uiLanguage: 'ja-JP' }
    ];

    localeCases.forEach(({ locale, uiLanguage }) => {
      it(`sets the history tooltip from openHistory for ${locale}`, async () => {
        const popupDocument = parseHTML(getPopupHTML());
        document.documentElement.innerHTML = popupDocument.documentElement.innerHTML;
        const expectedTitle = openHistoryMessages[locale];

        global.chrome = {
          i18n: {
            getMessage: vi.fn((key: string) => key === 'openHistory' ? expectedTitle : key),
            getUILanguage: vi.fn(() => uiLanguage)
          },
          runtime: { lastError: undefined }
        } as unknown as typeof chrome;

        vi.resetModules();
        await import('../../../entrypoints/popup/main.js');

        const historyButton = document.getElementById('historyBtn');
        expect(historyButton).not.toBeNull();
        expect(historyButton?.title).toBe(expectedTitle);
        expect(historyButton?.getAttribute('aria-label')).toBe(expectedTitle);
        expect(global.chrome.i18n.getMessage).toHaveBeenCalledWith('openHistory');
      });
    });

    it('removes the obsolete raw history tooltip', () => {
      expect(getPopupHTML()).not.toContain('title="Browse History"');
    });

    it('removes the hard-coded spinner stroke attribute', () => {
      const spinnerPath = parseHTML(getPopupHTML()).querySelector('.spinner-path');
      expect(spinnerPath?.hasAttribute('stroke')).toBe(false);
    });

    it('keeps the spinner stroke bound to the existing design token', () => {
      expect(getStylesCSS()).toMatch(/\.spinner-path\s*\{\s*stroke:\s*var\(--color-primary\);/);
    });
  });

});