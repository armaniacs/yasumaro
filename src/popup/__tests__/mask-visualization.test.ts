// @vitest-environment jsdom
/**
 * Masked Information Visualization Test
 * UF-401: マスク情報の可視化機能
 */


import * as sanitizePreview from '../sanitizePreview.js';
import { vi } from 'vitest';
import type { MaskedItem } from '../../messaging/types.js';

// The suites build the modal DOM in beforeEach, so the ids the assertions read
// are present; assert non-null once here instead of at every lookup.
function $el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`test DOM missing #${id}`);
  return node as T;
}

/**
 * M21: confirmationModal is now a native <dialog>. jsdom doesn't implement
 * showModal()/close(), and this suite builds the DOM as a plain <div> in
 * many places, so polyfill the two methods sanitizePreview.ts calls
 * (close() must also fire a real 'close' event, since sanitizePreview.ts
 * listens for it to resolve on ESC-triggered dismissal).
 */
function polyfillDialogMethods(): void {
  const modal = document.getElementById('confirmationModal') as any;
  if (!modal) return;
  modal.showModal = function () { this.open = true; };
  modal.close = function () {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
}

describe('Masked Information Visualization - プレビュー画面のマスク表示', () => {
  // 【修正】: beforeEach/afterEach を追加して jsdom 環境で DOM 要素を作成する
  // 【理由】: showPreview 関数が必要とする DOM 要素を jsdom で提供するため
  beforeEach(() => {
    // showPreview が期待する DOM 要素を作成
    document.body.innerHTML = `
      <div id="confirmationModal" style="display: none;">
        <div class="modal-body">
          <textarea id="previewContent"></textarea>
          <div id="maskStatusMessage"></div>
        </div>
        <button id="closeModalBtn">閉じる</button>
        <button id="cancelPreviewBtn">キャンセル</button>
        <button id="confirmPreviewBtn">確定</button>
      </div>
    `;
    polyfillDialogMethods();
  });

  afterEach(() => {
    // DOM をクリーンアップ
    document.body.innerHTML = '';
  });

  describe('正常系 - マスク件数表示', () => {
    test('TC-MV-001: renders a single masked-item count correctly', () => {
      const content = "連絡先は[MASKED:email]example.comです。";
      const maskedItems = [
        { type: "email", original: "test@example.com" }
      ];
      const maskedCount = 1;

      sanitizePreview.showPreview(content, maskedItems, maskedCount);

      const modal = document.getElementById('confirmationModal');
      const statusMessage = $el('maskStatusMessage');

      expect(statusMessage.textContent).toBe("Masked E-mail1 item");
      expect((modal as HTMLDialogElement).open).toBe(true);
    });

    test('TC-MV-002: renders multiple masked-item counts correctly', () => {
      const content = "お支払いは口座[MASKED:bankAccount]で問い合わせ:[MASKED:phoneJp]";
      const maskedItems = [
        { type: "bankAccount", original: "1234567890" },
        { type: "phoneJp", original: "03-1234-5678" }
      ];
      const maskedCount = 2;

      sanitizePreview.showPreview(content, maskedItems, maskedCount);

      const statusMessage = $el('maskStatusMessage');

      expect(statusMessage.textContent).toBe("Masked Bank Account Number1 item, Phone Number1 item");
    });
  });

  describe('正常系 - ハイライト表示', () => {
    test('TC-MV-003: renders masked spans as plain text', () => {
      const content = "メールアドレスは[MASKED:email]test@example.comです";
      const maskedItems = [{ type: "email", original: "test@example.com" }];
      const maskedCount = 1;

      sanitizePreview.showPreview(content, maskedItems, maskedCount);

      const previewContent = $el<HTMLTextAreaElement>('previewContent');

      expect(previewContent.value).toContain("[MASKED:email]");
      expect(previewContent.value).not.toContain("<span");
    });

    test('TC-MV-004: renders the navigation UI', () => {
      const content = "連絡先:[MASKED:email]xxx@example.com";
      const maskedItems = [{ type: "email", original: "xxx@example.com" }];
      const maskedCount = 1;

      sanitizePreview.showPreview(content, maskedItems, maskedCount);

      const nav = $el('maskNav');
      expect(nav).not.toBeNull();
      expect(nav.style.display).toBe('flex');
    });
  });

  describe('正常系 - 互換性', () => {
    test('TC-MV-005: keeps single-argument showPreview call compatibility', () => {
      const content = "名前: 田中太郎\nメール: [MASKED:email]tanaka@example.com";

      expect(() => {
        sanitizePreview.showPreview(content);
      }).not.toThrow();

      const modal = document.getElementById('confirmationModal');
      expect((modal as HTMLDialogElement).open).toBe(true);
    });

    test('TC-MV-006: identifies multiple distinct PII types correctly', () => {
      const content = "カード[MASKED:creditCard]、口座[MASKED:bankAccount]";
      const maskedItems = [
        { type: "creditCard", original: "1234-5678-9012-3456" },
        { type: "bankAccount", original: "01234567" }
      ];
      const maskedCount = 2;

      sanitizePreview.showPreview(content, maskedItems, maskedCount);

      const previewContent = $el<HTMLTextAreaElement>('previewContent');
      expect(previewContent.value).toContain('[MASKED:creditCard]');
      expect(previewContent.value).toContain('[MASKED:bankAccount]');

      const counter = $el('maskNavCounter');
      expect(counter.textContent).toBe('1/2');
    });

    test('TC-MV-007: identifies the myNumber PII type correctly', () => {
      const content = "番号: [MASKED:myNumber]";
      const maskedItems = [
        { type: "myNumber", original: "123456789012" }
      ];
      const maskedCount = 1;

      sanitizePreview.showPreview(content, maskedItems, maskedCount);

      const statusMessage = $el('maskStatusMessage');
      expect(statusMessage.textContent).toContain('My Number');
    });
  });

  describe('異常系 - エラーハンドリング', () => {
    test('TC-MV-101: handles null maskedItems', () => {
      const content = "連絡先[MASKED:email]xxx@example.com";
      const maskedCount = 1;

      expect(() => {
        sanitizePreview.showPreview(content, null, maskedCount);
      }).not.toThrow();

      const modal = document.getElementById('confirmationModal');
      expect((modal as HTMLDialogElement).open).toBe(true);
    });

    test('TC-MV-102: handles malformed maskedItems', () => {
      const content = "連絡先: 090-1234-5678";
      const maskedCount = 1;

      expect(() => {
        sanitizePreview.showPreview(
          content,
          "invalid format" as unknown as (string | MaskedItem)[],
          maskedCount,
        );
      }).not.toThrow();

      const modal = document.getElementById('confirmationModal');
      expect((modal as HTMLDialogElement).open).toBe(true);
    });

    test('TC-MV-103: handles regex special characters', () => {
      const content = "価格: ￥[MASKED:price]1,000円 (税込)";
      const maskedItems = [{ type: "price", original: "1,000" }];
      const maskedCount = 1;

      expect(() => {
        sanitizePreview.showPreview(content, maskedItems, maskedCount);
      }).not.toThrow();

      const modal = document.getElementById('confirmationModal');
      expect((modal as HTMLDialogElement).open).toBe(true);
    });
  });

  describe('境界値 - 入力検証', () => {
    test('TC-MV-201: handles a zero masked-item count', () => {
      const content = "まったく個人情報が含まれないテキストです。";
      const maskedItems: MaskedItem[] = [];
      const maskedCount = 0;

      sanitizePreview.showPreview(content, maskedItems, maskedCount);

      const modal = document.getElementById('confirmationModal');
      const statusMessage = $el('maskStatusMessage');

      expect(statusMessage.textContent).toBe("");
      expect(statusMessage.style.display).toBe("none");
      expect((modal as HTMLDialogElement).open).toBe(true);
    });

    test('TC-MV-202: handles an extreme masked-item count (100+)', () => {
      const maskedItems = Array.from({ length: 100 }, (_, i) => ({
        type: "email",
        original: `x${i + 1}@example.com`
      }));

      const startTime = Date.now();
      sanitizePreview.showPreview("[MASKED:email]x1@example.com", maskedItems, 100);
      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(100);

      const statusMessage = $el('maskStatusMessage');
      expect(statusMessage.textContent).toBe("Masked E-mail100 items");
    });

    test('TC-MV-203: handles empty-string content', () => {
      const content = "";
      const maskedItems: MaskedItem[] = [];
      const maskedCount = 0;

      expect(() => {
        sanitizePreview.showPreview(content, maskedItems, maskedCount);
      }).not.toThrow();

      const modal = document.getElementById('confirmationModal');
      const statusMessage = $el('maskStatusMessage');

      expect((modal as HTMLDialogElement).open).toBe(true);
      expect(statusMessage.textContent).toBe("");
      expect(statusMessage.style.display).toBe("none");
    });
  });

  describe('境界値 - ステータスメッセージ要素の確認', () => {
    test('creates the maskStatusMessage element', () => {
      const content = "テスト";
      sanitizePreview.showPreview(content, [], 0);

      const element = $el('maskStatusMessage');
      expect(element).toBeTruthy();
    });
  });

  describe('ナビゲーション機能', () => {
    beforeEach(() => {
      document.body.innerHTML = `
        <div id="confirmationModal" style="display: none;">
          <div class="modal-body">
            <textarea id="previewContent"></textarea>
          </div>
          <button id="closeModalBtn">閉じる</button>
          <button id="cancelPreviewBtn">キャンセル</button>
          <button id="confirmPreviewBtn">確定</button>
        </div>
      `;
      polyfillDialogMethods();
    });

    test('jumps to the next masked span', () => {
      const content = "連絡先:[MASKED:email]x1@example.com 問い合わせ:[MASKED:email]x2@example.com";
      const maskedItems = [
        { type: "email", original: "x1@example.com" },
        { type: "email", original: "x2@example.com" }
      ];
      const maskedCount = 2;

      sanitizePreview.showPreview(content, maskedItems, maskedCount);

      // 次のマスク箇所へ
      sanitizePreview.jumpToNextMasked();
      const counter = $el('maskNavCounter');
      expect(counter.textContent).toBe('2/2');

      // ループして最初に戻る
      sanitizePreview.jumpToNextMasked();
      expect(counter.textContent).toBe('1/2');
    });

    test('jumps to the previous masked span', () => {
      const content = "連絡先:[MASKED:email]x1@example.com 問い合わせ:[MASKED:email]x2@example.com";
      const maskedItems = [
        { type: "email", original: "x1@example.com" },
        { type: "email", original: "x2@example.com" }
      ];
      const maskedCount = 2;

      sanitizePreview.showPreview(content, maskedItems, maskedCount);
      const counter = $el('maskNavCounter');

      // 最初は1/2
      expect(counter.textContent).toBe('1/2');

      // 前のマスク箇所へ（ループして最後に戻る）
      sanitizePreview.jumpToPrevMasked();
      expect(counter.textContent).toBe('2/2');
    });

    test('skips navigation when no masked span exists', () => {
      const content = "まったく個人情報が含まれないテキストです。";
      const maskedItems: MaskedItem[] = [];
      const maskedCount = 0;

      sanitizePreview.showPreview(content, maskedItems, maskedCount);

      // エラーを投げないことを確認
      expect(() => {
        sanitizePreview.jumpToNextMasked();
        sanitizePreview.jumpToPrevMasked();
      }).not.toThrow();
    });
  });

  describe('モーダルが存在しない場合', () => {
    test('resolves confirmed automatically when the modal is missing', async () => {
      document.body.innerHTML = '';
      const content = "テストコンテンツ";
      const maskedItems: MaskedItem[] = [];
      const maskedCount = 0;

      const result = await sanitizePreview.showPreview(content, maskedItems, maskedCount);

      expect(result).toEqual({ confirmed: true, content });
    });
  });

  describe('maskStatusMessageの動的作成', () => {
    test('creates maskStatusMessage dynamically when missing', () => {
      document.body.innerHTML = `
        <div id="confirmationModal" style="display: none;">
          <div class="modal-body">
            <textarea id="previewContent"></textarea>
          </div>
          <button id="closeModalBtn">閉じる</button>
          <button id="cancelPreviewBtn">キャンセル</button>
          <button id="confirmPreviewBtn">確定</button>
        </div>
      `;
      polyfillDialogMethods();

      const content = "連絡先:[MASKED:email]xxx@example.com";
      const maskedItems = [{ type: "email", original: "xxx@example.com" }];
      const maskedCount = 1;

      sanitizePreview.showPreview(content, maskedItems, maskedCount);

      const maskStatusMessage = $el('maskStatusMessage');
      expect(maskStatusMessage).toBeDefined();
      expect(maskStatusMessage.className).toBe('mask-status-message');
      expect(maskStatusMessage.textContent).toBe('Masked E-mail1 item');
    });
  });

  describe('cleansingInfo表示', () => {
    beforeEach(() => {
      document.body.innerHTML = `
        <div id="confirmationModal" style="display: none;">
          <div class="modal-body">
            <textarea id="previewContent"></textarea>
            <div id="cleansingInfo" class="hidden">
              <span id="cleansingBadge"></span>
            </div>
          </div>
          <button id="closeModalBtn">閉じる</button>
          <button id="cancelPreviewBtn">キャンセル</button>
          <button id="confirmPreviewBtn">確定</button>
        </div>
      `;
      polyfillDialogMethods();
    });

    test('keeps cleansingInfo hidden when cleansedReason=none', () => {
      sanitizePreview.showPreview('test', [], 0, 'none');

      const cleansingInfo = $el('cleansingInfo');
      expect(cleansingInfo.classList.contains('hidden')).toBe(true);
    });

    test('shows cleansingInfo when cleansedReason=hard', () => {
      sanitizePreview.showPreview('test', [], 0, 'hard');

      const cleansingInfo = $el('cleansingInfo');
      const badge = $el('cleansingBadge');
      expect(cleansingInfo.classList.contains('hidden')).toBe(false);
      expect(badge.textContent).toContain('Hard');
    });

    test('renders the correct badge when cleansedReason=keyword', () => {
      sanitizePreview.showPreview('test', [], 0, 'keyword');

      const badge = $el('cleansingBadge');
      expect(badge.textContent).toContain('Keyword');
    });

    test('renders the correct badge when cleansedReason=both', () => {
      sanitizePreview.showPreview('test', [], 0, 'both');

      const badge = $el('cleansingBadge');
      expect(badge.textContent).toContain('Both');
    });

    test('appends stats to the badge when cleanseStats is present', () => {
      const cleanseStats = {
        hardStripRemoved: 3,
        keywordStripRemoved: 2,
        totalRemoved: 5
      };

      sanitizePreview.showPreview('test', [], 0, 'hard', cleanseStats);

      const badge = $el('cleansingBadge');
      expect(badge.textContent).toContain('Hard: 3');
      expect(badge.textContent).toContain('Keyword: 2');
    });

    test('keeps cleansingInfo hidden when cleansedReason is undefined', () => {
      sanitizePreview.showPreview('test', [], 0, undefined);

      const cleansingInfo = $el('cleansingInfo');
      expect(cleansingInfo.classList.contains('hidden')).toBe(true);
    });

    test('throws nothing when the cleansingInfo element is missing', () => {
      document.body.innerHTML = `
        <div id="confirmationModal" style="display: none;">
          <div class="modal-body">
            <textarea id="previewContent"></textarea>
          </div>
          <button id="closeModalBtn"></button>
          <button id="cancelPreviewBtn"></button>
          <button id="confirmPreviewBtn"></button>
        </div>
      `;
      polyfillDialogMethods();

      expect(() => {
        sanitizePreview.showPreview('test', [], 0, 'hard');
      }).not.toThrow();
    });
  });

  describe('initializeModalEvents', () => {
    test('throws nothing when button elements are missing', () => {
      document.body.innerHTML = `
        <div id="confirmationModal">
          <div class="modal-body"></div>
        </div>
      `;

      expect(() => {
        sanitizePreview.initializeModalEvents();
      }).not.toThrow();
    });

    test('throws nothing when ResizeObserver is undefined', () => {
      document.body.innerHTML = `
        <div id="confirmationModal">
          <div class="modal-body">
            <textarea id="previewContent"></textarea>
          </div>
          <button id="closeModalBtn"></button>
          <button id="cancelPreviewBtn"></button>
          <button id="confirmPreviewBtn"></button>
        </div>
      `;

      // ResizeObserverを未定義に設定
      const originalResizeObserver = global.ResizeObserver;
      Object.defineProperty(global, 'ResizeObserver', {
        value: undefined,
        writable: true,
      });

      try {
        expect(() => {
          sanitizePreview.initializeModalEvents();
        }).not.toThrow();
      } finally {
        // 元に戻す
        global.ResizeObserver = originalResizeObserver;
      }
    });

    // PERF-007テスト: ResizeObserverのクリーンアップを確認
    test('PERF-007: cleans up ResizeObserver across repeated initializeModalEvents calls', () => {
      document.body.innerHTML = `
        <div id="confirmationModal">
          <div class="modal-body">
            <textarea id="previewContent"></textarea>
          </div>
          <button id="closeModalBtn"></button>
          <button id="cancelPreviewBtn"></button>
          <button id="confirmPreviewBtn"></button>
        </div>
      `;

      // ResizeObserverのモックを作成して、disconnectが呼ばれることを確認
      let disconnectCallCount = 0;
      const mockObserver = {
        observe: vi.fn(),
        disconnect: vi.fn(() => {
          disconnectCallCount++;
        }),
      };

      let createCount = 0;
      const originalResizeObserver = global.ResizeObserver;
      global.ResizeObserver = vi.fn(function() {
        createCount++;
        return mockObserver;
      }) as unknown as typeof ResizeObserver;

      try {
        // 初期化を複数回呼び出す
        sanitizePreview.initializeModalEvents();
        expect(createCount).toBe(1);
        expect(disconnectCallCount).toBe(0);

        // 2回目の呼び出し（古いObserverがdisconnectされるはず）
        sanitizePreview.initializeModalEvents();
        expect(createCount).toBe(2);
        expect(disconnectCallCount).toBe(1);

        // 3回目の呼び出し
        sanitizePreview.initializeModalEvents();
        expect(createCount).toBe(3);
        expect(disconnectCallCount).toBe(2);
      } finally {
        global.ResizeObserver = originalResizeObserver;
      }
    });

    // PERF-007テスト: cleanupModalEvents関数の動作確認
    test('PERF-007: releases ResizeObserver in cleanupModalEvents', () => {
      document.body.innerHTML = `
        <div id="confirmationModal">
          <div class="modal-body">
            <textarea id="previewContent"></textarea>
          </div>
          <button id="closeModalBtn"></button>
          <button id="cancelPreviewBtn"></button>
          <button id="confirmPreviewBtn"></button>
        </div>
      `;

      const disconnectMock = vi.fn();
      const originalResizeObserver = global.ResizeObserver;
      global.ResizeObserver = vi.fn(function() {
        return {
          observe: vi.fn(),
          disconnect: disconnectMock,
        };
      }) as unknown as typeof ResizeObserver;

      try {
        // 初期化時にはdisconnectは呼ばれない
        sanitizePreview.initializeModalEvents();
        expect(disconnectMock).not.toHaveBeenCalled();

        // クリーンアップ時にdisconnectが呼ばれる
        sanitizePreview.cleanupModalEvents();
        expect(disconnectMock).toHaveBeenCalledTimes(1);

        // 2回目のクリーンアップでは何も起きない（既にnull）
        sanitizePreview.cleanupModalEvents();
        expect(disconnectMock).toHaveBeenCalledTimes(1);
      } finally {
        global.ResizeObserver = originalResizeObserver;
      }
    });
  });

  describe('handleAction - モーダル操作の結果', () => {
    beforeEach(() => {
      // 前テストのイベントリスナー状態をリセット
      sanitizePreview.cleanupModalEvents();
    });

    test('renders button elements after the modal opens', async () => {
      document.body.innerHTML = `
        <div id="confirmationModal" style="display: none;">
          <div class="modal-body">
            <textarea id="previewContent"></textarea>
          </div>
          <button id="closeModalBtn"></button>
          <button id="cancelPreviewBtn"></button>
          <button id="confirmPreviewBtn"></button>
        </div>
      `;
      polyfillDialogMethods();

      const content = "テストコンテンツ";

      // Promiseを待たずにモーダルの状態を確認
      const promise = sanitizePreview.showPreview(content, [], 0);

      const modal = document.getElementById('confirmationModal') as HTMLDialogElement;
      const confirmBtn = $el('confirmPreviewBtn');
      const cancelBtn = $el('cancelPreviewBtn');

      // モーダルが表示されていることを確認（M21: ネイティブdialogのopenプロパティ）
      expect(modal.open).toBe(true);

      // ボタン要素が存在することを確認
      expect(confirmBtn).toBeDefined();
      expect(cancelBtn).toBeDefined();

      // テスト完了、Promiseは解決されないがエラーは投げない
    });

    test('resolves confirmed=true on the confirm button', async () => {
      document.body.innerHTML = `
        <div id="confirmationModal" style="display: none;">
          <div class="modal-body">
            <textarea id="previewContent"></textarea>
          </div>
          <button id="closeModalBtn"></button>
          <button id="cancelPreviewBtn"></button>
          <button id="confirmPreviewBtn"></button>
        </div>
      `;
      polyfillDialogMethods();

      sanitizePreview.initializeModalEvents();
      const promise = sanitizePreview.showPreview('test content', [], 0);
      const confirmBtn = $el('confirmPreviewBtn');
      confirmBtn.click();

      const result = await promise;
      expect(result.confirmed).toBe(true);
      expect(result.content).toBe('test content');
    });

    test('resolves confirmed=false on the cancel button', async () => {
      document.body.innerHTML = `
        <div id="confirmationModal" style="display: none;">
          <div class="modal-body">
            <textarea id="previewContent">some content</textarea>
          </div>
          <button id="closeModalBtn"></button>
          <button id="cancelPreviewBtn"></button>
          <button id="confirmPreviewBtn"></button>
        </div>
      `;
      polyfillDialogMethods();

      sanitizePreview.initializeModalEvents();
      const promise = sanitizePreview.showPreview('test content', [], 0);
      const cancelBtn = $el('cancelPreviewBtn');
      cancelBtn.click();

      const result = await promise;
      expect(result.confirmed).toBe(false);
      expect(result.content).toBeNull();
    });

    test('resolves confirmed=false on the closeModal button', async () => {
      document.body.innerHTML = `
        <div id="confirmationModal" style="display: none;">
          <div class="modal-body">
            <textarea id="previewContent">some content</textarea>
          </div>
          <button id="closeModalBtn"></button>
          <button id="cancelPreviewBtn"></button>
          <button id="confirmPreviewBtn"></button>
        </div>
      `;
      polyfillDialogMethods();

      sanitizePreview.initializeModalEvents();
      const promise = sanitizePreview.showPreview('test content', [], 0);
      const closeBtn = $el('closeModalBtn');
      closeBtn.click();

      const result = await promise;
      expect(result.confirmed).toBe(false);
      expect(result.content).toBeNull();
    });

    test('does nothing in handleAction when resolvePromise is null', () => {
      document.body.innerHTML = `
        <div id="confirmationModal" style="display: none;">
          <div class="modal-body">
            <textarea id="previewContent"></textarea>
          </div>
          <button id="closeModalBtn"></button>
          <button id="cancelPreviewBtn"></button>
          <button id="confirmPreviewBtn"></button>
        </div>
      `;
      polyfillDialogMethods();

      sanitizePreview.initializeModalEvents();
      const cancelBtn = $el('cancelPreviewBtn');
      expect(() => cancelBtn.click()).not.toThrow();
    });
  });

  describe('setPreviewContent - 内部関数のカバレッジ', () => {
    test('does nothing when previewContent is null', () => {
      const content = "テスト";
      // previewContentがない状態でDOMをクリア
      document.body.innerHTML = `
        <div id="confirmationModal">
          <div class="modal-body"></div>
        </div>
      `;
      polyfillDialogMethods();

      expect(() => {
        sanitizePreview.showPreview(content, [], 0);
      }).not.toThrow();
    });

    test('does nothing when previewContent is undefined', () => {
      const content = "テスト";
      document.body.innerHTML = `
        <div id="confirmationModal" style="display: none;">
          <div class="modal-body"></div>
        </div>
      `;
      polyfillDialogMethods();

      expect(() => {
        sanitizePreview.showPreview(content, [], 0);
      }).not.toThrow();
    });
  });
});