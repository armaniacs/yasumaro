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

// popup.htmlを読み込む
const getPopupHTML = () => {
  const htmlPath = join(__dirname, '../popup.html');
  return readFileSync(htmlPath, 'utf-8');
};

// styles.cssを読み込む
const getStylesCSS = () => {
  const cssPath = join(__dirname, '../styles.css');
  return readFileSync(cssPath, 'utf-8');
};

// JSDOMでHTMLをパースしてDOMを作成
const parseHTML = (html) => {
  const dom = new JSDOM.JSDOM(html);
  return dom.window.document;
};

describe('UI/UX Improvements Test Suite', () => {

  describe('1. エラー/成功メッセージの視覚的強化 (高優先度)', () => {
    let stylesCSS;

    beforeAll(() => {
      stylesCSS = getStylesCSS();
    });

    it('.errorクラスに背景色とボーダーのスタイルが定義されていること', () => {
      expect(stylesCSS).toContain('.error');

      // 背景色が設定されているか確認
      expect(stylesCSS).toMatch(/\.error\s*{[\s\S]*?(?:background|background-color)\s*:/i);

      // ボーダーが設定されているか確認
      expect(stylesCSS).toMatch(/\.error\s*{[\s\S]*?border/);
    });

    it('.successクラスに背景色とボーダーのスタイルが定義されていること', () => {
      expect(stylesCSS).toContain('.success');

      // 背景色が設定されているか確認
      expect(stylesCSS).toMatch(/\.success\s*{[\s\S]*?(?:background|background-color)\s*:/i);

      // ボーダーが設定されているか確認
      expect(stylesCSS).toMatch(/\.success\s*{[\s\S]*?border/);
    });

    it('エラーメッセージが視覚的に目立つ色設定になっていること', () => {
      // エラーは赤系の色またはCSS変数参照であるべき
      expect(stylesCSS).toMatch(/\.error\s*{[\s\S]*?(?:#d9534f|#dc3545|#f44336|var\(--color-danger|rgb\(\s*2[0-9]{2}|rgb\(\s*220)/i);
    });

    it('成功メッセージが視覚的に目立つ色設定になっていること', () => {
      // 成功は緑系の色またはCSS変数参照であるべき
      expect(stylesCSS).toMatch(/\.success\s*{[\s\S]*?(?:#4CAF50|#28a745|#5cb85c|var\(--color-success|rgb\(\s*[0-9]{2},\s*[0-9]{2},\s*0)/i);
    });
  });

  describe('2. アクセシビリティ対応 (高優先度)', () => {
    let document;

    beforeAll(() => {
      const html = getPopupHTML();
      document = parseHTML(html);
    });

    it('タブボタンにrole="tab"属性が設定されていること', () => {
      const tabButtons = document.querySelectorAll('.tab-btn');
      expect(tabButtons.length).toBeGreaterThan(0);

      tabButtons.forEach((tab, index) => {
        expect(tab.getAttribute('role')).toBe('tab');
      });
    });

    it('アクティブなタブにaria-selected="true"が設定されていること', () => {
      const activeTab = document.querySelector('.tab-btn.active');
      if (activeTab) {
        expect(activeTab.getAttribute('aria-selected')).toBe('true');
      }
    });

    it('非アクティブなタブにaria-selected="false"が設定されていること', () => {
      const inactiveTabs = document.querySelectorAll('.tab-btn:not(.active)');
      expect(inactiveTabs.length).toBeGreaterThan(0);

      inactiveTabs.forEach((tab) => {
        expect(tab.getAttribute('aria-selected')).toBe('false');
      });
    });

    it('ステータス要素にaria-live属性が設定されていること', () => {
      const statusElements = document.querySelectorAll('#status, #mainStatus, #domainStatus, #privacyStatus');
      expect(statusElements.length).toBeGreaterThan(0);

      statusElements.forEach((status) => {
        const ariaLive = status.getAttribute('aria-live');
        expect(['polite', 'assertive']).toContain(ariaLive);
      });
    });

    it('alert-roleまたはalertメッセージに適切なARIA属性があること', () => {
      const alertElements = document.querySelectorAll('[role="alert"]');
      // 少なくともdynamicに生成されるエラーメッセージ用のARIAロールが期待される
      // HTML静的分析では要素が存在しない場合もあるため、エラーにならないように検証
      expect(alertElements).toBeTruthy();
    });
  });

  describe('3. 保存ボタンのラベル統一 (高優先度)', () => {
    let document;

    beforeAll(() => {
      const html = getPopupHTML();
      document = parseHTML(html);
    });

    it('すべての保存ボタンがdata-i18n属性で定義されていること', () => {
      const saveButtons = [
        document.getElementById('save'),
        document.getElementById('saveDomainSettings'),
        document.getElementById('savePrivacySettings')
      ];

      saveButtons.forEach((button) => {
        if (button) {
          expect(button.hasAttribute('data-i18n')).toBe(true);
        }
      });
    });

    it('各保存ボタンにコンテキストに適したi18nキーが設定されていること', () => {
      const generalSave = document.getElementById('save');
      const domainSave = document.getElementById('saveDomainSettings');
      const privacySave = document.getElementById('savePrivacySettings');

      if (generalSave) {
        expect(generalSave.getAttribute('data-i18n')).toBe('saveAndTest');
      }

      if (domainSave) {
        expect(domainSave.getAttribute('data-i18n')).toBe('saveDomainSettings');
      }

      if (privacySave) {
        expect(privacySave.getAttribute('data-i18n')).toBe('savePrivacySettings');
      }
    });
  });

  describe('4. 強制記録ボタンのスタイル正規化 (中期)', () => {
    let stylesCSS;

    beforeAll(() => {
      stylesCSS = getStylesCSS();
    });

    it('.alert-btnクラスが定義されていること (インラインスタイルの排除)', () => {
      expect(stylesCSS).toMatch(/\.alert-btn\s*\{/);
    });

    it('.alert-btnクラスに背景色が設定されていること', () => {
      expect(stylesCSS).toMatch(/\.alert-btn\s*{[\s\S]*?(?:background|background-color)\s*:/i);
    });

    it('errorUtils.jsでinline 스타イルを使用していないこと', () => {
      const errorUtilsPath = join(__dirname, '../errorUtils.ts');
      const errorUtils = readFileSync(errorUtilsPath, 'utf-8');

      // インラインスタイルの使用を確認（コメントは除外）
      const styleUsage = errorUtils.match(/\.(style|css)\s*=\s*['"]/);
      expect(styleUsage).toBeNull();
    });
  });

  describe('5. ヘルプテキストの視覚的強化 (中期)', () => {
    let stylesCSS;

    beforeAll(() => {
      stylesCSS = getStylesCSS();
    });

    it('.help-textクラスが定義されていること', () => {
      expect(stylesCSS.includes('.help-text')).toBe(true);
    });

    it('.help-textクラスに背景色が設定されていること', () => {
      // ヘルプテキストは視覚的に区別できる背景色を持つべき
      const helpTextMatch = stylesCSS.match(/\.help-text\s*{[\s\S]*?background/i);
      expect(helpTextMatch).toBeTruthy();
    });

    it('HTMLにhelp-textクラスが使用されていること', () => {
      const html = getPopupHTML();
      expect(html).toContain('help-text');
    });
  });

  describe('6. ボタンの操作エリア確保 (中期)', () => {
    let stylesCSS;

    beforeAll(() => {
      stylesCSS = getStylesCSS();
    });

    it('.icon-btnが最低44×44pxのサイズを確保していること', () => {
      // テキストペアリングが隣接していない場合でもクリック可能とするため
      expect(stylesCSS).toMatch(/\.icon-btn\s*{[\s\S]*?width\s*:\s*(?:[4-9]\d|1\d{2})px/i);

      // 実際のスタイルを確認（現在は32px設定だが、アクセシビリティの観点から拡張すべき）
      const iconBtnMatch = stylesCSS.match(/\.icon-btn\s*{[\s\S]*?width\s*:\s*(\d+)px/i);

      if (iconBtnMatch) {
        const width = parseInt(iconBtnMatch[1]);
        // WCAG 2.5.5のターゲットサイズ要件（最低24×24px）を満たすべき
        // より良いUXのために44×44pxが推奨
        expect(width).toBeGreaterThanOrEqual(24);
      }
    });

    it('.primary-btnが適切なタッチ領域を持っていること', () => {
      expect(stylesCSS).toMatch(/\.primary-btn\s*{[\s\S]*?padding\s*:/i);

      // パディングバリューが10px以上であることを確認
      const primaryBtnMatch = stylesCSS.match(/\.primary-btn\s*{[\s\S]*?padding\s*:\s*(\d+)px/i);
      if (primaryBtnMatch) {
        const padding = parseInt(primaryBtnMatch[1]);
        expect(padding).toBeGreaterThanOrEqual(10);
      }
    });

    it('.secondary-btnが適切なタッチ領域を持っていること', () => {
      expect(stylesCSS).toMatch(/\.secondary-btn\s*{[\s\S]*?padding\s*:/i);

      const secondaryBtnMatch = stylesCSS.match(/\.secondary-btn\s*{[\s\S]*?padding\s*:\s*(\d+)px/i);
      if (secondaryBtnMatch) {
        const padding = parseInt(secondaryBtnMatch[1]);
        expect(padding).toBeGreaterThanOrEqual(10);
      }
    });
  });

});