// @vitest-environment jsdom
/**
 * sanitizePreview.test.ts
 * PII Sanitization Preview UI Logic の単体テスト
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';

// モジュールモック - jest.mock はファイル先頭にホイストされる
// ファクトリ内で直接 vi.fn() を作成し、globalThis 経由で後からアクセスする

vi.mock('../../utils/i18n.js', () => ({
  getMessage: vi.fn((key: string, substitutions?: Record<string, unknown>) => {
    const messages: Record<string, string> = {
      piiCreditCard: 'Credit Card Number',
      piiMyNumber: 'My Number',
      piiBankAccount: 'Bank Account Number',
      piiEmail: 'E-mail',
      piiPhoneJp: 'Phone Number',
      maskStatusCount: 'Masked {count} items of personal information',
      maskStatusCount_one: 'Masked 1 item of personal information',
      maskStatusCount_other: 'Masked {count} items of personal information',
      maskStatusDetails: 'Masked {details}',
      itemsCount: '{count} items',
      itemsCount_one: '1 item',
      itemsCount_other: '{count} items',
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

import {
  showPreview,
  initializeModalEvents,
  cleanupModalEvents,
  jumpToNextMasked,
  jumpToPrevMasked,
} from '../sanitizePreview.js';
import { focusTrapManager, getFocusableElements } from '../../utils/ui/focusTrap.js';

/**
 * テスト用DOMモーダル構造を構築（M21: <dialog>要素ベース）
 * jsdomはHTMLDialogElement.showModal/closeを実装していないため、
 * privatePageDialog.test.tsと同じパターンでポリフィルする。
 * close()はネイティブに'close'イベントを発火するため、ポリフィルでも
 * 明示的にdispatchEventする（sanitizePreview.tsのcloseリスナーが依存する）。
 */
function setupModalDOM(): void {
  document.body.innerHTML = `
    <dialog id="confirmationModal">
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
    </dialog>
  `;

  const dialog = document.getElementById('confirmationModal') as any;
  if (dialog) {
    dialog.showModal = function () {
      this.open = true;
    };
    dialog.close = function () {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    };
  }
}

describe('sanitizePreview', () => {
  beforeEach(() => {
    setupModalDOM();
  });

  afterEach(() => {
    cleanupModalEvents();
    document.body.innerHTML = '';
  });

  describe('showPreview', () => {
    test('resolves immediately with confirmed=true when modal is missing', async () => {
      document.body.innerHTML = '';
      const loggerModule = await import('../../utils/logger.js');
      const logErrorSpy = vi.spyOn(loggerModule, 'logError').mockImplementation(() => Promise.resolve());

      const result = await showPreview('test content');

      expect(result).toEqual({ confirmed: true, content: 'test content' });
      expect(logErrorSpy).toHaveBeenCalledWith(
        'Confirmation modal not found in DOM',
        {},
        expect.any(String)
      );
      logErrorSpy.mockRestore();
    });

    test('shows modal and sets preview content', async () => {
      const modal = document.getElementById('confirmationModal') as HTMLDialogElement;
      const textarea = document.getElementById('previewContent') as HTMLTextAreaElement;

      const promise = showPreview('Hello World');

      expect(modal.open).toBe(true);
      expect(textarea.value).toBe('Hello World');

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();

      const result = await promise;
      expect(result.confirmed).toBe(true);
      expect(result.content).toBe('Hello World');
    });

    test('shows modal with empty content', async () => {
      const textarea = document.getElementById('previewContent') as HTMLTextAreaElement;

      const promise = showPreview('');

      expect(textarea.value).toBe('');

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();

      const result = await promise;
      expect(result.confirmed).toBe(true);
      expect(result.content).toBe('');
    });

    test('shows modal with null content', async () => {
      const textarea = document.getElementById('previewContent') as HTMLTextAreaElement;

      const promise = showPreview(null as unknown as string);

      expect(textarea.value).toBe('');

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();

      const result = await promise;
      expect(result).toEqual({ confirmed: true, content: '' });
    });

    test('resolves with confirmed=false on cancel button', async () => {
      const promise = showPreview('some content');

      const cancelBtn = document.getElementById('cancelPreviewBtn') as HTMLButtonElement;
      cancelBtn.click();

      const result = await promise;
      expect(result.confirmed).toBe(false);
      expect(result.content).toBeNull();
    });

    test('resolves with confirmed=false on close button', async () => {
      const promise = showPreview('some content');

      const closeBtn = document.getElementById('closeModalBtn') as HTMLButtonElement;
      closeBtn.click();

      const result = await promise;
      expect(result.confirmed).toBe(false);
      expect(result.content).toBeNull();
    });

    test('calls showModal (M21: native dialog owns focus trap and ESC handling)', async () => {
      const modal = document.getElementById('confirmationModal') as HTMLDialogElement;
      const showModalSpy = vi.spyOn(modal, 'showModal');

      const promise = showPreview('content');

      expect(showModalSpy).toHaveBeenCalledTimes(1);

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();
      await promise;
    });

    test('resolves with confirmed=false on native dialog close (ESC path)', async () => {
      const modal = document.getElementById('confirmationModal') as HTMLDialogElement;

      const promise = showPreview('content');

      // Simulate the browser's native ESC-triggered close (fires 'close' without our buttons)
      modal.close();

      const result = await promise;
      expect(result.confirmed).toBe(false);
      expect(result.content).toBeNull();
    });

    test('shows status message when masked items exist', async () => {
      const promise = showPreview(
        'Hello [MASKED:email] World',
        [{ type: 'email' }] as unknown as Parameters<typeof showPreview>[1],
        1
      );

      const statusMsg = document.getElementById('maskStatusMessage');
      expect(statusMsg).toBeTruthy();
      expect(statusMsg!.textContent).toContain('E-mail');

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();
      await promise;
    });

    test('hides status message when mask count is 0', async () => {
      const promise = showPreview('Hello World', null, 0);

      const statusMsg = document.getElementById('maskStatusMessage');
      if (statusMsg) {
        expect(statusMsg.style.display).toBe('none');
      }

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();
      await promise;
    });

    test('groups multiple mask types into status text', async () => {
      const promise = showPreview(
        '[MASKED:email] [MASKED:creditCard]',
        [{ type: 'email' }, { type: 'creditCard' }] as unknown as Parameters<typeof showPreview>[1],
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

    test('handles string-form maskedItems', async () => {
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

    test('displays raw type name for unknown mask types', async () => {
      const promise = showPreview(
        '[MASKED:custom]',
        [{ type: 'customType' }] as unknown as Parameters<typeof showPreview>[1],
        1
      );

      const statusMsg = document.getElementById('maskStatusMessage');
      expect(statusMsg).toBeTruthy();
      expect(statusMsg!.textContent).toContain('customType');

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();
      await promise;
    });

    test('uses count-based message when maskedItems is empty', async () => {
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

    test('uses count-based message when maskedItems is null', async () => {
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

    test('selects textarea range at MASKED token position', async () => {
      const textarea = document.getElementById('previewContent') as HTMLTextAreaElement;
      const content = 'Hello [MASKED:email] World';

      const promise = showPreview(content, [{ type: 'email' }] as unknown as Parameters<typeof showPreview>[1], 1);

      expect(textarea.selectionStart).toBeGreaterThanOrEqual(0);
      expect(textarea.selectionEnd).toBeGreaterThan(textarea.selectionStart);

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();
      await promise;
    });

    test('focuses textarea when no MASKED token exists', async () => {
      const textarea = document.getElementById('previewContent') as HTMLTextAreaElement;
      const focusSpy = vi.spyOn(textarea, 'focus');

      const promise = showPreview('No masked content here');

      expect(focusSpy).toHaveBeenCalled();
      focusSpy.mockRestore();

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();
      await promise;
    });

    test('builds mask navigation UI', async () => {
      const promise = showPreview(
        '[MASKED:email] text [MASKED:phone]',
        [{ type: 'email' }, { type: 'phoneJp' }] as unknown as Parameters<typeof showPreview>[1],
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

    test('hides navigation UI when no masks exist', async () => {
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
    test('hides cleansingInfo when cleansedReason is none', async () => {
      const cleansingInfo = document.getElementById('cleansingInfo') as HTMLElement;
      cleansingInfo.classList.remove('hidden');

      const promise = showPreview('content', null, 0, 'none');

      expect(cleansingInfo.classList.contains('hidden')).toBe(true);

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();
      await promise;
    });

    test('hides cleansingInfo when cleansedReason is undefined', async () => {
      const cleansingInfo = document.getElementById('cleansingInfo') as HTMLElement;
      cleansingInfo.classList.remove('hidden');

      const promise = showPreview('content', null, 0, undefined);

      expect(cleansingInfo.classList.contains('hidden')).toBe(true);

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();
      await promise;
    });

    test('shows badge when cleansedReason is hard', async () => {
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

    test('shows badge when cleansedReason is keyword', async () => {
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

    test('shows badge when cleansedReason is both', async () => {
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

    test('shows badge text only when cleanseStats is undefined', async () => {
      const promise = showPreview('content', null, 0, 'hard');

      const badge = document.getElementById('cleansingBadge') as HTMLElement;
      expect(badge.textContent).toBe('Hard');

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();
      await promise;
    });

    test('omits details when cleanseStats.totalRemoved is 0', async () => {
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
    test('wires modal buttons so confirm click resolves the preview', async () => {
      // initializeModalEvents attaches the confirm/cancel/close listeners;
      // a confirm click must resolve the pending showPreview promise.
      const promise = showPreview('wired content');
      initializeModalEvents();
      (document.getElementById('confirmPreviewBtn') as HTMLButtonElement).click();
      const result = await promise;
      expect(result).toEqual({ confirmed: true, content: 'wired content' });
    });

    test('observes textarea when ResizeObserver is available', () => {
      const previewContent = document.getElementById('previewContent') as HTMLTextAreaElement;
      const observeSpy = vi.fn();
      const disconnectSpy = vi.fn();

      global.ResizeObserver = vi.fn().mockImplementation(function () {
        return {
          observe: observeSpy,
          disconnect: disconnectSpy,
          unobserve: vi.fn(),
        };
      });

      initializeModalEvents();

      expect(observeSpy).toHaveBeenCalledWith(previewContent);
    });

    test('disconnects previous ResizeObserver on second call', () => {
      const disconnectSpy = vi.fn();

      global.ResizeObserver = vi.fn().mockImplementation(function () {
        return {
          observe: vi.fn(),
          disconnect: disconnectSpy,
          unobserve: vi.fn(),
        };
      });

      initializeModalEvents();
      initializeModalEvents();

      expect(disconnectSpy).toHaveBeenCalled();
    });

    test('prevents duplicate event listener registration', () => {
      const addEventListenerSpy = vi.spyOn(
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

    test('does not throw when modal element is missing', () => {
      document.body.innerHTML = '';
      expect(() => initializeModalEvents()).not.toThrow();
    });

    test('does not throw when button elements are missing', () => {
      document.body.innerHTML = '<div id="confirmationModal"></div>';
      expect(() => initializeModalEvents()).not.toThrow();
    });

    test('does not throw when ResizeObserver is undefined', () => {
      const originalRO = global.ResizeObserver;
      // @ts-expect-error - testing undefined ResizeObserver
      delete global.ResizeObserver;

      expect(() => initializeModalEvents()).not.toThrow();

      global.ResizeObserver = originalRO;
    });

    test('skips ResizeObserver setup when previewContent is missing', () => {
      document.body.innerHTML = '<div id="confirmationModal"></div>';

      const observeSpy = vi.fn();
      global.ResizeObserver = vi.fn().mockImplementation(function () {
        return {
          observe: observeSpy,
          disconnect: vi.fn(),
          unobserve: vi.fn(),
        };
      });

      initializeModalEvents();

      expect(observeSpy).not.toHaveBeenCalled();
    });

    test('ResizeObserver callback leaves body width unchanged while modal is closed', () => {
      let resizeCallback: (() => void) | undefined;
      global.ResizeObserver = vi.fn().mockImplementation(function (cb: () => void) {
        resizeCallback = cb;
        return {
          observe: vi.fn(),
          disconnect: vi.fn(),
          unobserve: vi.fn(),
        };
      });

      document.body.style.width = '360px';
      initializeModalEvents();

      const modal = document.getElementById('confirmationModal') as HTMLDialogElement;
      expect(modal.open).toBeFalsy();

      resizeCallback?.();

      expect(document.body.style.width).toBe('360px');
    });

    test('ResizeObserver callback syncs body width while modal is open', () => {
      let resizeCallback: (() => void) | undefined;
      global.ResizeObserver = vi.fn().mockImplementation(function (cb: () => void) {
        resizeCallback = cb;
        return {
          observe: vi.fn(),
          disconnect: vi.fn(),
          unobserve: vi.fn(),
        };
      });

      document.body.style.width = '360px';
      initializeModalEvents();

      const modal = document.getElementById('confirmationModal') as HTMLDialogElement;
      modal.showModal();

      resizeCallback?.();

      expect(document.body.style.width).not.toBe('360px');
    });
  });

  describe('cleanupModalEvents', () => {
    test('disconnects ResizeObserver', () => {
      const disconnectSpy = vi.fn();

      global.ResizeObserver = vi.fn().mockImplementation(function () {
        return {
          observe: vi.fn(),
          disconnect: disconnectSpy,
          unobserve: vi.fn(),
        };
      });

      initializeModalEvents();
      cleanupModalEvents();

      expect(disconnectSpy).toHaveBeenCalled();
    });

    test('does not throw when ResizeObserver is not set', () => {
      expect(() => cleanupModalEvents()).not.toThrow();
    });
  });

  describe('jumpToNextMasked / jumpToPrevMasked', () => {
    test('jumpToNextMasked does nothing without mask positions', () => {
      expect(() => jumpToNextMasked()).not.toThrow();
    });

    test('jumpToPrevMasked does nothing without mask positions', () => {
      expect(() => jumpToPrevMasked()).not.toThrow();
    });

    test('jumpToNextMasked jumps to next mask after showPreview', async () => {
      const content = '[MASKED:a] middle [MASKED:b] end';

      const promise = showPreview(content, [{ type: 'email' }, { type: 'email' }] as unknown as Parameters<typeof showPreview>[1], 2);

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

    test('jumpToPrevMasked returns to previous mask after showPreview', async () => {
      const content = '[MASKED:a] middle [MASKED:b] end';

      const promise = showPreview(content, [{ type: 'email' }, { type: 'email' }] as unknown as Parameters<typeof showPreview>[1], 2);

      jumpToNextMasked();
      jumpToPrevMasked();

      const counter = document.getElementById('maskNavCounter') as HTMLElement;
      expect(counter.textContent).toBe('1/2');

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();
      await promise;
    });

    test('wraps to first mask on next from last mask', async () => {
      const content = '[MASKED:a] [MASKED:b]';

      const promise = showPreview(content, [{ type: 'email' }, { type: 'email' }] as unknown as Parameters<typeof showPreview>[1], 2);

      jumpToNextMasked();
      jumpToNextMasked();

      const counter = document.getElementById('maskNavCounter') as HTMLElement;
      expect(counter.textContent).toBe('1/2');

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();
      await promise;
    });

    test('jumps to last mask on prev from first mask', async () => {
      const content = '[MASKED:a] [MASKED:b]';

      const promise = showPreview(content, [{ type: 'email' }, { type: 'email' }] as unknown as Parameters<typeof showPreview>[1], 2);

      jumpToPrevMasked();

      const counter = document.getElementById('maskNavCounter') as HTMLElement;
      expect(counter.textContent).toBe('2/2');

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();
      await promise;
    });
  });

  describe('collectMaskedPositions', () => {
    test('collects positions of multiple MASKED tokens', async () => {
      const content = 'Start [MASKED:email] middle [MASKED:phone] end';

      const promise = showPreview(content, [{ type: 'email' }, { type: 'phoneJp' }] as unknown as Parameters<typeof showPreview>[1], 2);

      const nav = document.getElementById('maskNav') as HTMLElement;
      expect(nav.style.display).toBe('flex');

      const counter = document.getElementById('maskNavCounter') as HTMLElement;
      expect(counter.textContent).toBe('1/2');

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();
      await promise;
    });

    test('hides navigation when no MASKED token exists', async () => {
      const promise = showPreview('No tokens here');

      const nav = document.getElementById('maskNav');
      if (nav) {
        expect(nav.style.display).toBe('none');
      }

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();
      await promise;
    });

    test('detects various MASKED token formats', async () => {
      const content = '[MASKED:email] [MASKED:creditCard123] [MASKED:my_number]';

      const promise = showPreview(
        content,
        [{ type: 'email' }, { type: 'creditCard' }, { type: 'myNumber' }] as unknown as Parameters<typeof showPreview>[1],
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
    test('resets body width on cancel', async () => {
      const promise = showPreview('content');

      const cancelBtn = document.getElementById('cancelPreviewBtn') as HTMLButtonElement;
      cancelBtn.click();

      await promise;

      expect(document.body.style.width).toBe('320px');
    });

    test('resets body width on confirm', async () => {
      const promise = showPreview('content');

      const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
      confirmBtn.click();

      await promise;

      expect(document.body.style.width).toBe('320px');
    });
  });

  describe('focusTrap wiring (PBI-25)', () => {
    afterEach(() => {
      focusTrapManager.releaseAll();
    });

    function trapCountFor(modal: HTMLElement): number {
      return [...focusTrapManager.handlers.values()].filter((h) => h.element === modal).length;
    }

    test('traps on showPreview and releases on confirm', async () => {
      const trapSpy = vi.spyOn(focusTrapManager, 'trap');
      const releaseSpy = vi.spyOn(focusTrapManager, 'release');
      try {
        const promise = showPreview('Hello World');

        const modal = document.getElementById('confirmationModal') as HTMLDialogElement;
        expect(trapSpy).toHaveBeenCalledTimes(1);
        expect(trapSpy).toHaveBeenCalledWith(modal, expect.any(Function));
        expect(trapCountFor(modal)).toBe(1);

        (document.getElementById('confirmPreviewBtn') as HTMLButtonElement).click();
        const result = await promise;
        expect(result.confirmed).toBe(true);
        expect(releaseSpy).toHaveBeenCalled();
        expect(trapCountFor(modal)).toBe(0);
      } finally {
        trapSpy.mockRestore();
        releaseSpy.mockRestore();
      }
    });

    test('releases on cancel button', async () => {
      const releaseSpy = vi.spyOn(focusTrapManager, 'release');
      try {
        const promise = showPreview('some content');
        const modal = document.getElementById('confirmationModal') as HTMLDialogElement;
        expect(trapCountFor(modal)).toBe(1);

        (document.getElementById('cancelPreviewBtn') as HTMLButtonElement).click();
        const result = await promise;
        expect(result.confirmed).toBe(false);
        expect(releaseSpy).toHaveBeenCalled();
        expect(trapCountFor(modal)).toBe(0);
      } finally {
        releaseSpy.mockRestore();
      }
    });

    test('releases on native close (Escape path) and resolves confirmed=false', async () => {
      const releaseSpy = vi.spyOn(focusTrapManager, 'release');
      try {
        const promise = showPreview('some content');
        const modal = document.getElementById('confirmationModal') as HTMLDialogElement;
        expect(trapCountFor(modal)).toBe(1);

        modal.close();
        const result = await promise;
        expect(result).toEqual({ confirmed: false, content: null });
        expect(releaseSpy).toHaveBeenCalled();
        expect(trapCountFor(modal)).toBe(0);
      } finally {
        releaseSpy.mockRestore();
      }
    });

    test('avoids double trap on consecutive showPreview', async () => {
      const trapSpy = vi.spyOn(focusTrapManager, 'trap');
      const releaseSpy = vi.spyOn(focusTrapManager, 'release');
      try {
        const first = showPreview('first');
        // 内部で reject される superseded promise の未処理警告を抑止
        first.catch(() => {});
        const second = showPreview('second');

        const modal = document.getElementById('confirmationModal') as HTMLDialogElement;
        expect(trapSpy).toHaveBeenCalledTimes(2);
        // 2回目の trap 前に1回目のトラップが解放されている
        expect(releaseSpy).toHaveBeenCalled();
        expect(trapCountFor(modal)).toBe(1);

        (document.getElementById('confirmPreviewBtn') as HTMLButtonElement).click();
        const result = await second;
        expect(result.confirmed).toBe(true);
        expect(trapCountFor(modal)).toBe(0);
      } finally {
        trapSpy.mockRestore();
        releaseSpy.mockRestore();
      }
    });

    test('cycles Tab movement inside dialog', async () => {
      const promise = showPreview('Hello World');
      const modal = document.getElementById('confirmationModal') as HTMLElement;
      const focusables = getFocusableElements(modal);
      expect(focusables.length).toBeGreaterThan(1);
      const first = focusables[0] as HTMLElement;
      const last = focusables[focusables.length - 1] as HTMLElement;

      last.focus();
      last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      expect(document.activeElement).toBe(first);

      first.focus();
      first.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })
      );
      expect(document.activeElement).toBe(last);

      (document.getElementById('confirmPreviewBtn') as HTMLButtonElement).click();
      await promise;
    });

    test('restores focus to opener element on close', async () => {
      const opener = document.createElement('button');
      opener.id = 'opener';
      opener.textContent = 'opener';
      document.body.appendChild(opener);
      opener.focus();
      expect(document.activeElement).toBe(opener);

      const promise = showPreview('Hello World');
      expect(document.activeElement).not.toBe(opener);

      (document.getElementById('confirmPreviewBtn') as HTMLButtonElement).click();
      await promise;
      expect(document.activeElement).toBe(opener);
    });
  });
});
