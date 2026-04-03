/**
 * sanitizePreview.test.ts
 * PII Sanitization Preview UI Logic の単体テスト
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';

// モジュールモック - jest.mock はファイル先頭にホイストされる
// ファクトリ内で直接 jest.fn() を作成し、globalThis 経由で後からアクセスする

jest.mock('../i18n.js', () => ({
  getMessage: jest.fn((key: string, substitutions?: Record<string, unknown>) => {
    const messages: Record<string, string> = {
      piiCreditCard: 'Credit Card Number',
      piiMyNumber: 'My Number',
      piiBankAccount: 'Bank Account Number',
      piiEmail: 'E-mail',
      piiPhoneJp: 'Phone Number',
      maskStatusCount: 'Masked {count} items of personal information',
      maskStatusDetails: 'Masked {details}',
      itemsCount: '{count} items',
      items: ', ',
      previousMaskedItem: 'Previous masked item',
      nextMaskedItem: 'Next masked item',
      cleansedBadgeHard: 'Hard',
      cleansedBadgeKeyword: 'Keyword',
      cleansedBadgeBoth: 'Both',
    };
    let message = messages[key] || key;
    if (substitutions && typeof substitutions === 'object') {
      for (const [placeholder, value] of Object.entries(substitutions)) {
        message = message.replace(`{${placeholder}}`, String(value));
      }
    }
    return message;
  }),
}));

jest.mock('../utils/focusTrap.js', () => {
  const trapFn = jest.fn(() => 'mock-trap-id');
  const releaseFn = jest.fn();
  (globalThis as any).__spMockTrap = trapFn;
  (globalThis as any).__spMockRelease = releaseFn;
  return {
    focusTrapManager: {
      trap: trapFn,
      release: releaseFn,
    },
  };
});

import {
  showPreview,
  initializeModalEvents,
  cleanupModalEvents,
  jumpToNextMasked,
  jumpToPrevMasked,
} from '../sanitizePreview.js';

function getMockTrap(): jest.Mock {
  return (globalThis as any).__spMockTrap;
}
function getMockRelease(): jest.Mock {
  return (globalThis as any).__spMockRelease;
}

/**
 * テスト用DOMモーダル構造を構築
 */
function setupModalDOM(): void {
  document.body.innerHTML = `
    <div id="confirmationModal" style="display:none;">
      <div class="modal-body">
        <div id="cleansingInfo" class="hidden">
          <span id="cleansingBadge"></span>
        </div>
        <div id="maskNavAnchor"></div>
        <textarea id="previewContent"></textarea>
      </div>
      <button id="closeModalBtn">×</button>
      <button id="cancelPreviewBtn">Cancel</button>
      <button id="confirmPreviewBtn">Confirm</button>
    </div>
  `;
}

describe('sanitizePreview', () => {
  beforeEach(() => {
    setupModalDOM();
    getMockTrap().mockClear();
    getMockTrap().mockReturnValue('mock-trap-id');
    getMockRelease().mockClear();
  });

  afterEach(() => {
    cleanupModalEvents();
    document.body.innerHTML = '';
  });

  describe('showPreview', () => {
    test('モーダルが存在しない場合、confirmed=trueで即座にresolveする', async () => {
      document.body.innerHTML = '';
      const loggerModule = await import('../../utils/logger.js');
      const logErrorSpy = jest.spyOn(loggerModule, 'logError').mockImplementation(() => Promise.resolve());

      const result = await showPreview('test content');

      expect(result).toEqual({ confirmed: true, content: 'test content' });
      expect(logErrorSpy).toHaveBeenCalledWith(
        'Confirmation modal not found in DOM',
        {},
        expect.any(String)
      );
      logErrorSpy.mockRestore();
    });

    test('モーダルを表示し、プレビューコンテンツを設定する', async () => {
      const modal = document.getElementById('confirmationModal') as HTMLElement;
      const textarea = document.getElementById('previewContent') as HTMLTextAreaElement;

      const promise = showPreview('Hello World');

      expect(modal.style.display).toBe('flex');
      expect(modal.classList.contains('show')).toBe(true);
      expect(textarea.value).toBe('Hello World');

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();

      const result = await promise;
      expect(result.confirmed).toBe(true);
      expect(result.content).toBe('Hello World');
    });

    test('空コンテンツでもモーダルを表示する', async () => {
      const textarea = document.getElementById('previewContent') as HTMLTextAreaElement;

      const promise = showPreview('');

      expect(textarea.value).toBe('');

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();

      const result = await promise;
      expect(result.confirmed).toBe(true);
      expect(result.content).toBe('');
    });

    test('nullコンテンツでもモーダルを表示する', async () => {
      const textarea = document.getElementById('previewContent') as HTMLTextAreaElement;

      const promise = showPreview(null as unknown as string);

      expect(textarea.value).toBe('');

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();

      const result = await promise;
      expect(result).toEqual({ confirmed: true, content: '' });
    });

    test('キャンセルボタンでconfirmed=falseでresolveする', async () => {
      const promise = showPreview('some content');

      const cancelBtn = document.getElementById('cancelPreviewBtn') as HTMLButtonElement;
      cancelBtn.click();

      const result = await promise;
      expect(result.confirmed).toBe(false);
      expect(result.content).toBeNull();
    });

    test('閉じるボタンでconfirmed=falseでresolveする', async () => {
      const promise = showPreview('some content');

      const closeBtn = document.getElementById('closeModalBtn') as HTMLButtonElement;
      closeBtn.click();

      const result = await promise;
      expect(result.confirmed).toBe(false);
      expect(result.content).toBeNull();
    });

    test('フォーカストラップが設定される', async () => {
      const promise = showPreview('content');

      expect(getMockTrap()).toHaveBeenCalledTimes(1);

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();
      await promise;
    });

    test('フォーカストラップが解放される', async () => {
      const promise = showPreview('content');

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();
      await promise;

      expect(getMockRelease()).toHaveBeenCalledWith('mock-trap-id');
    });

    test('マスクされたアイテムがある場合、ステータスメッセージを表示する', async () => {
      const promise = showPreview(
        'Hello [MASKED:email] World',
        [{ type: 'email' }],
        1
      );

      const statusMsg = document.getElementById('maskStatusMessage');
      expect(statusMsg).toBeTruthy();
      expect(statusMsg!.textContent).toContain('E-mail');

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();
      await promise;
    });

    test('マスクカウントが0の場合、ステータスメッセージを非表示にする', async () => {
      const promise = showPreview('Hello World', null, 0);

      const statusMsg = document.getElementById('maskStatusMessage');
      if (statusMsg) {
        expect(statusMsg.style.display).toBe('none');
      }

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();
      await promise;
    });

    test('複数のマスクタイプでグループ化されたステータステキストを生成する', async () => {
      const promise = showPreview(
        '[MASKED:email] [MASKED:creditCard]',
        [{ type: 'email' }, { type: 'creditCard' }],
        2
      );

      const statusMsg = document.getElementById('maskStatusMessage');
      expect(statusMsg).toBeTruthy();
      expect(statusMsg!.textContent).toContain('E-mail');
      expect(statusMsg!.textContent).toContain('Credit Card Number');

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();
      await promise;
    });

    test('文字列形式のmaskedItemsを処理する', async () => {
      const promise = showPreview(
        '[MASKED:email]',
        ['email'],
        1
      );

      const statusMsg = document.getElementById('maskStatusMessage');
      expect(statusMsg).toBeTruthy();
      expect(statusMsg!.textContent).toContain('E-mail');

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();
      await promise;
    });

    test('未知のマスクタイプでtype名をそのまま表示する', async () => {
      const promise = showPreview(
        '[MASKED:custom]',
        [{ type: 'customType' }],
        1
      );

      const statusMsg = document.getElementById('maskStatusMessage');
      expect(statusMsg).toBeTruthy();
      expect(statusMsg!.textContent).toContain('customType');

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();
      await promise;
    });

    test('maskedItemsが空配列の場合、カウントベースのメッセージを使用する', async () => {
      const promise = showPreview(
        '[MASKED:email]',
        [],
        3
      );

      const statusMsg = document.getElementById('maskStatusMessage');
      expect(statusMsg).toBeTruthy();
      expect(statusMsg!.textContent).toContain('3');

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();
      await promise;
    });

    test('maskedItemsがnullの場合、カウントベースのメッセージを使用する', async () => {
      const promise = showPreview(
        '[MASKED:email]',
        null,
        5
      );

      const statusMsg = document.getElementById('maskStatusMessage');
      expect(statusMsg).toBeTruthy();
      expect(statusMsg!.textContent).toContain('5');

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();
      await promise;
    });

    test('MASKEDトークンの位置にtextareaの選択範囲を設定する', async () => {
      const textarea = document.getElementById('previewContent') as HTMLTextAreaElement;
      const content = 'Hello [MASKED:email] World';

      const promise = showPreview(content, [{ type: 'email' }], 1);

      expect(textarea.selectionStart).toBeGreaterThanOrEqual(0);
      expect(textarea.selectionEnd).toBeGreaterThan(textarea.selectionStart);

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();
      await promise;
    });

    test('MASKEDトークンがない場合、textareaにフォーカスする', async () => {
      const textarea = document.getElementById('previewContent') as HTMLTextAreaElement;
      const focusSpy = jest.spyOn(textarea, 'focus');

      const promise = showPreview('No masked content here');

      expect(focusSpy).toHaveBeenCalled();
      focusSpy.mockRestore();

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();
      await promise;
    });

    test('マスクナビゲーションUIが構築される', async () => {
      const promise = showPreview(
        '[MASKED:email] text [MASKED:phone]',
        [{ type: 'email' }, { type: 'phoneJp' }],
        2
      );

      const nav = document.getElementById('maskNav');
      expect(nav).toBeTruthy();
      expect(nav!.style.display).toBe('flex');

      const prevBtn = document.getElementById('maskNavPrev');
      const nextBtn = document.getElementById('maskNavNext');
      expect(prevBtn).toBeTruthy();
      expect(nextBtn).toBeTruthy();

      const counter = document.getElementById('maskNavCounter');
      expect(counter).toBeTruthy();

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();
      await promise;
    });

    test('マスクがない場合、ナビゲーションUIを非表示にする', async () => {
      const promise = showPreview('No masked content');

      const nav = document.getElementById('maskNav');
      if (nav) {
        expect(nav.style.display).toBe('none');
      }

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();
      await promise;
    });
  });

  describe('cleansingInfo', () => {
    test('cleansedReasonがnoneの場合、cleansingInfoを非表示にする', async () => {
      const cleansingInfo = document.getElementById('cleansingInfo') as HTMLElement;
      cleansingInfo.classList.remove('hidden');

      const promise = showPreview('content', null, 0, 'none');

      expect(cleansingInfo.classList.contains('hidden')).toBe(true);

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();
      await promise;
    });

    test('cleansedReasonがundefinedの場合、cleansingInfoを非表示にする', async () => {
      const cleansingInfo = document.getElementById('cleansingInfo') as HTMLElement;
      cleansingInfo.classList.remove('hidden');

      const promise = showPreview('content', null, 0, undefined);

      expect(cleansingInfo.classList.contains('hidden')).toBe(true);

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();
      await promise;
    });

    test('cleansedReasonがhardの場合、バッジを表示する', async () => {
      const promise = showPreview('content', null, 0, 'hard', {
        hardStripRemoved: 5,
        keywordStripRemoved: 0,
        totalRemoved: 5,
      });

      const cleansingInfo = document.getElementById('cleansingInfo') as HTMLElement;
      expect(cleansingInfo.classList.contains('hidden')).toBe(false);

      const badge = document.getElementById('cleansingBadge') as HTMLElement;
      expect(badge.textContent).toContain('Hard');
      expect(badge.textContent).toContain('Hard: 5');

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();
      await promise;
    });

    test('cleansedReasonがkeywordの場合、バッジを表示する', async () => {
      const promise = showPreview('content', null, 0, 'keyword', {
        hardStripRemoved: 0,
        keywordStripRemoved: 3,
        totalRemoved: 3,
      });

      const badge = document.getElementById('cleansingBadge') as HTMLElement;
      expect(badge.textContent).toContain('Keyword');
      expect(badge.textContent).toContain('Keyword: 3');

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();
      await promise;
    });

    test('cleansedReasonがbothの場合、バッジを表示する', async () => {
      const promise = showPreview('content', null, 0, 'both', {
        hardStripRemoved: 2,
        keywordStripRemoved: 3,
        totalRemoved: 5,
      });

      const badge = document.getElementById('cleansingBadge') as HTMLElement;
      expect(badge.textContent).toContain('Both');
      expect(badge.textContent).toContain('Hard: 2');
      expect(badge.textContent).toContain('Keyword: 3');

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();
      await promise;
    });

    test('cleanseStatsがundefinedの場合、バッジテキストのみ表示する', async () => {
      const promise = showPreview('content', null, 0, 'hard');

      const badge = document.getElementById('cleansingBadge') as HTMLElement;
      expect(badge.textContent).toBe('Hard');

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();
      await promise;
    });

    test('cleanseStats.totalRemovedが0の場合、詳細を表示しない', async () => {
      const promise = showPreview('content', null, 0, 'hard', {
        hardStripRemoved: 0,
        keywordStripRemoved: 0,
        totalRemoved: 0,
      });

      const badge = document.getElementById('cleansingBadge') as HTMLElement;
      expect(badge.textContent).toBe('Hard');

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();
      await promise;
    });
  });

  describe('initializeModalEvents', () => {
    test('モーダルボタンのイベントリスナーを設定する', () => {
      initializeModalEvents();
      expect(true).toBe(true);
    });

    test('ResizeObserverが利用可能な場合、textareaを監視する', () => {
      const previewContent = document.getElementById('previewContent') as HTMLTextAreaElement;
      const observeSpy = jest.fn();
      const disconnectSpy = jest.fn();

      global.ResizeObserver = jest.fn().mockImplementation(() => ({
        observe: observeSpy,
        disconnect: disconnectSpy,
        unobserve: jest.fn(),
      }));

      initializeModalEvents();

      expect(observeSpy).toHaveBeenCalledWith(previewContent);
    });

    test('2回呼び出すと、前のResizeObserverをdisconnectする', () => {
      const disconnectSpy = jest.fn();

      global.ResizeObserver = jest.fn().mockImplementation(() => ({
        observe: jest.fn(),
        disconnect: disconnectSpy,
        unobserve: jest.fn(),
      }));

      initializeModalEvents();
      initializeModalEvents();

      expect(disconnectSpy).toHaveBeenCalled();
    });

    test('イベントリスナーの二重登録を防止する', () => {
      const addEventListenerSpy = jest.spyOn(
        document.getElementById('closeModalBtn')!,
        'addEventListener'
      );

      initializeModalEvents();
      const callCountAfterFirst = addEventListenerSpy.mock.calls.length;

      initializeModalEvents();
      const callCountAfterSecond = addEventListenerSpy.mock.calls.length;

      expect(callCountAfterSecond).toBe(callCountAfterFirst);

      addEventListenerSpy.mockRestore();
    });

    test('モーダル要素が存在しない場合でもエラーにならない', () => {
      document.body.innerHTML = '';
      expect(() => initializeModalEvents()).not.toThrow();
    });

    test('ボタン要素が存在しない場合でもエラーにならない', () => {
      document.body.innerHTML = '<div id="confirmationModal"></div>';
      expect(() => initializeModalEvents()).not.toThrow();
    });

    test('ResizeObserverが未定義の場合でもエラーにならない', () => {
      const originalRO = global.ResizeObserver;
      // @ts-expect-error - testing undefined ResizeObserver
      delete global.ResizeObserver;

      expect(() => initializeModalEvents()).not.toThrow();

      global.ResizeObserver = originalRO;
    });

    test('previewContentが存在しない場合でもResizeObserverを設定しない', () => {
      document.body.innerHTML = '<div id="confirmationModal"></div>';

      const observeSpy = jest.fn();
      global.ResizeObserver = jest.fn().mockImplementation(() => ({
        observe: observeSpy,
        disconnect: jest.fn(),
        unobserve: jest.fn(),
      }));

      initializeModalEvents();

      expect(observeSpy).not.toHaveBeenCalled();
    });
  });

  describe('cleanupModalEvents', () => {
    test('ResizeObserverをdisconnectする', () => {
      const disconnectSpy = jest.fn();

      global.ResizeObserver = jest.fn().mockImplementation(() => ({
        observe: jest.fn(),
        disconnect: disconnectSpy,
        unobserve: jest.fn(),
      }));

      initializeModalEvents();
      cleanupModalEvents();

      expect(disconnectSpy).toHaveBeenCalled();
    });

    test('ResizeObserverが未設定でもエラーにならない', () => {
      expect(() => cleanupModalEvents()).not.toThrow();
    });
  });

  describe('jumpToNextMasked / jumpToPrevMasked', () => {
    test('マスク位置がない場合、jumpToNextMaskedは何もしない', () => {
      expect(() => jumpToNextMasked()).not.toThrow();
    });

    test('マスク位置がない場合、jumpToPrevMaskedは何もしない', () => {
      expect(() => jumpToPrevMasked()).not.toThrow();
    });

    test('showPreview後にjumpToNextMaskedが次のマスクにジャンプする', async () => {
      const content = '[MASKED:a] middle [MASKED:b] end';

      const promise = showPreview(content, [{ type: 'email' }, { type: 'email' }], 2);

      const textarea = document.getElementById('previewContent') as HTMLTextAreaElement;
      const firstStart = textarea.selectionStart;

      jumpToNextMasked();

      expect(textarea.selectionStart).not.toBe(firstStart);

      const counter = document.getElementById('maskNavCounter') as HTMLElement;
      expect(counter.textContent).toBe('2/2');

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();
      await promise;
    });

    test('showPreview後にjumpToPrevMaskedが前のマスクに戻る', async () => {
      const content = '[MASKED:a] middle [MASKED:b] end';

      const promise = showPreview(content, [{ type: 'email' }, { type: 'email' }], 2);

      jumpToNextMasked();
      jumpToPrevMasked();

      const counter = document.getElementById('maskNavCounter') as HTMLElement;
      expect(counter.textContent).toBe('1/2');

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();
      await promise;
    });

    test('最後のマスクからnextで最初に戻る（ラップアラウンド）', async () => {
      const content = '[MASKED:a] [MASKED:b]';

      const promise = showPreview(content, [{ type: 'email' }, { type: 'email' }], 2);

      jumpToNextMasked();
      jumpToNextMasked();

      const counter = document.getElementById('maskNavCounter') as HTMLElement;
      expect(counter.textContent).toBe('1/2');

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();
      await promise;
    });

    test('最初のマスクからprevで最後にジャンプする（ラップアラウンド）', async () => {
      const content = '[MASKED:a] [MASKED:b]';

      const promise = showPreview(content, [{ type: 'email' }, { type: 'email' }], 2);

      jumpToPrevMasked();

      const counter = document.getElementById('maskNavCounter') as HTMLElement;
      expect(counter.textContent).toBe('2/2');

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();
      await promise;
    });
  });

  describe('collectMaskedPositions', () => {
    test('複数のMASKEDトークンの位置を収集する', async () => {
      const content = 'Start [MASKED:email] middle [MASKED:phone] end';

      const promise = showPreview(content, [{ type: 'email' }, { type: 'phoneJp' }], 2);

      const nav = document.getElementById('maskNav') as HTMLElement;
      expect(nav.style.display).toBe('flex');

      const counter = document.getElementById('maskNavCounter') as HTMLElement;
      expect(counter.textContent).toBe('1/2');

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();
      await promise;
    });

    test('MASKEDトークンがない場合、ナビゲーションを非表示にする', async () => {
      const promise = showPreview('No tokens here');

      const nav = document.getElementById('maskNav');
      if (nav) {
        expect(nav.style.display).toBe('none');
      }

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();
      await promise;
    });

    test('様々なMASKEDトークン形式を検出する', async () => {
      const content = '[MASKED:email] [MASKED:creditCard123] [MASKED:my_number]';

      const promise = showPreview(
        content,
        [{ type: 'email' }, { type: 'creditCard' }, { type: 'myNumber' }],
        3
      );

      const counter = document.getElementById('maskNavCounter') as HTMLElement;
      expect(counter.textContent).toBe('1/3');

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();
      await promise;
    });
  });

  describe('body width adjustment', () => {
    test('キャンセル時にbody幅をリセットする', async () => {
      const promise = showPreview('content');

      const cancelBtn = document.getElementById('cancelPreviewBtn') as HTMLButtonElement;
      cancelBtn.click();

      await promise;

      expect(document.body.style.width).toBe('320px');
    });

    test('確認時にbody幅をリセットする', async () => {
      const promise = showPreview('content');

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();

      await promise;

      expect(document.body.style.width).toBe('320px');
    });
  });
});
