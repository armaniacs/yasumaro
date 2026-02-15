/**
 * Masked Information Visualization Test
 * UF-401: マスク情報の可視化機能
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import * as sanitizePreview from '../sanitizePreview.ts';

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
  });

  afterEach(() => {
    // DOM をクリーンアップ
    document.body.innerHTML = '';
  });

  describe('正常系 - マスク件数表示', () => {
    test('TC-MV-001: マスク件数1件が正しく表示される', () => {
      const content = "連絡先は[MASKED:email]example.comです。";
      const maskedItems = [
        { type: "email", original: "test@example.com" }
      ];
      const maskedCount = 1;

      sanitizePreview.showPreview(content, maskedItems, maskedCount);

      const modal = document.getElementById('confirmationModal');
      const statusMessage = document.getElementById('maskStatusMessage');

      expect(statusMessage.textContent).toBe("Masked E-mail1 items");
      expect(modal.style.display).toBe("flex");
    });

    test('TC-MV-002: マスク件数複数が正しく表示される', () => {
      const content = "お支払いは口座[MASKED:bankAccount]で問い合わせ:[MASKED:phoneJp]";
      const maskedItems = [
        { type: "bankAccount", original: "1234567890" },
        { type: "phoneJp", original: "03-1234-5678" }
      ];
      const maskedCount = 2;

      sanitizePreview.showPreview(content, maskedItems, maskedCount);

      const statusMessage = document.getElementById('maskStatusMessage');

      expect(statusMessage.textContent).toBe("Masked Bank Account Number1 items, Phone Number1 items");
    });
  });

  describe('正常系 - ハイライト表示', () => {
    test('TC-MV-003: マスク箇所がプレーンテキストとして表示される', () => {
      const content = "メールアドレスは[MASKED:email]test@example.comです";
      const maskedItems = [{ type: "email", original: "test@example.com" }];
      const maskedCount = 1;

      sanitizePreview.showPreview(content, maskedItems, maskedCount);

      const previewContent = document.getElementById('previewContent');

      expect(previewContent.value).toContain("[MASKED:email]");
      expect(previewContent.value).not.toContain("<span");
    });

    test('TC-MV-004: ナビゲーションUIが表示される', () => {
      const content = "連絡先:[MASKED:email]xxx@example.com";
      const maskedItems = [{ type: "email", original: "xxx@example.com" }];
      const maskedCount = 1;

      sanitizePreview.showPreview(content, maskedItems, maskedCount);

      const nav = document.getElementById('maskNav');
      expect(nav).not.toBeNull();
      expect(nav.style.display).toBe('flex');
    });
  });

  describe('正常系 - 互換性', () => {
    test('TC-MV-005: showPreviewの単一引数呼び出し互換性が維持されている', () => {
      const content = "名前: 田中太郎\nメール: [MASKED:email]tanaka@example.com";

      expect(() => {
        sanitizePreview.showPreview(content);
      }).not.toThrow();

      const modal = document.getElementById('confirmationModal');
      expect(modal.style.display).toBe("flex");
    });

    test('TC-MV-006: 複数の異なるPIIタイプが正しく識別される', () => {
      const content = "カード[MASKED:creditCard]、口座[MASKED:bankAccount]";
      const maskedItems = [
        { type: "creditCard", original: "1234-5678-9012-3456" },
        { type: "bankAccount", original: "01234567" }
      ];
      const maskedCount = 2;

      sanitizePreview.showPreview(content, maskedItems, maskedCount);

      const previewContent = document.getElementById('previewContent');
      expect(previewContent.value).toContain('[MASKED:creditCard]');
      expect(previewContent.value).toContain('[MASKED:bankAccount]');

      const counter = document.getElementById('maskNavCounter');
      expect(counter.textContent).toBe('1/2');
    });
  });

  describe('異常系 - エラーハンドリング', () => {
    test('TC-MV-101: maskedItemsがnullの場合の動作', () => {
      const content = "連絡先[MASKED:email]xxx@example.com";
      const maskedCount = 1;

      expect(() => {
        sanitizePreview.showPreview(content, null, maskedCount);
      }).not.toThrow();

      const modal = document.getElementById('confirmationModal');
      expect(modal.style.display).toBe("flex");
    });

    test('TC-MV-102: 不正なmaskedItems形式の場合の動作', () => {
      const content = "連絡先: 090-1234-5678";
      const maskedCount = 1;

      expect(() => {
        sanitizePreview.showPreview(content, "invalid format", maskedCount);
      }).not.toThrow();

      const modal = document.getElementById('confirmationModal');
      expect(modal.style.display).toBe("flex");
    });

    test('TC-MV-103: 正規表現特殊文字を含む場合', () => {
      const content = "価格: ￥[MASKED:price]1,000円 (税込)";
      const maskedItems = [{ type: "price", original: "1,000" }];
      const maskedCount = 1;

      expect(() => {
        sanitizePreview.showPreview(content, maskedItems, maskedCount);
      }).not.toThrow();

      const modal = document.getElementById('confirmationModal');
      expect(modal.style.display).toBe("flex");
    });
  });

  describe('境界値 - 入力検証', () => {
    test('TC-MV-201: マスク件数0件の場合', () => {
      const content = "まったく個人情報が含まれないテキストです。";
      const maskedItems = [];
      const maskedCount = 0;

      sanitizePreview.showPreview(content, maskedItems, maskedCount);

      const modal = document.getElementById('confirmationModal');
      const statusMessage = document.getElementById('maskStatusMessage');

      expect(statusMessage.textContent).toBe("");
      expect(statusMessage.style.display).toBe("none");
      expect(modal.style.display).toBe("flex");
    });

    test('TC-MV-202: 極端なマスク件数（100件以上）', () => {
      const maskedItems = Array.from({ length: 100 }, (_, i) => ({
        type: "email",
        original: `x${i + 1}@example.com`
      }));

      const startTime = Date.now();
      sanitizePreview.showPreview("[MASKED:email]x1@example.com", maskedItems, 100);
      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(100);

      const statusMessage = document.getElementById('maskStatusMessage');
      expect(statusMessage.textContent).toBe("Masked E-mail100 items");
    });

    test('TC-MV-203: 空文字のコンテンツ', () => {
      const content = "";
      const maskedItems = [];
      const maskedCount = 0;

      expect(() => {
        sanitizePreview.showPreview(content, maskedItems, maskedCount);
      }).not.toThrow();

      const modal = document.getElementById('confirmationModal');
      const statusMessage = document.getElementById('maskStatusMessage');

      expect(modal.style.display).toBe("flex");
      expect(statusMessage.textContent).toBe("");
      expect(statusMessage.style.display).toBe("none");
    });
  });

  describe('境界値 - ステータスメッセージ要素の確認', () => {
    test('maskStatusMessage要素が作成される', () => {
      const content = "テスト";
      sanitizePreview.showPreview(content, [], 0);

      const element = document.getElementById('maskStatusMessage');
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
    });

    test('次のマスク箇所へジャンプ', () => {
      const content = "連絡先:[MASKED:email]x1@example.com 問い合わせ:[MASKED:email]x2@example.com";
      const maskedItems = [
        { type: "email", original: "x1@example.com" },
        { type: "email", original: "x2@example.com" }
      ];
      const maskedCount = 2;

      sanitizePreview.showPreview(content, maskedItems, maskedCount);

      // 次のマスク箇所へ
      sanitizePreview.jumpToNextMasked();
      const counter = document.getElementById('maskNavCounter');
      expect(counter.textContent).toBe('2/2');

      // ループして最初に戻る
      sanitizePreview.jumpToNextMasked();
      expect(counter.textContent).toBe('1/2');
    });

    test('前のマスク箇所へジャンプ', () => {
      const content = "連絡先:[MASKED:email]x1@example.com 問い合わせ:[MASKED:email]x2@example.com";
      const maskedItems = [
        { type: "email", original: "x1@example.com" },
        { type: "email", original: "x2@example.com" }
      ];
      const maskedCount = 2;

      sanitizePreview.showPreview(content, maskedItems, maskedCount);
      const counter = document.getElementById('maskNavCounter');

      // 最初は1/2
      expect(counter.textContent).toBe('1/2');

      // 前のマスク箇所へ（ループして最後に戻る）
      sanitizePreview.jumpToPrevMasked();
      expect(counter.textContent).toBe('2/2');
    });

    test('マスク箇所がない場合はナビゲーションしない', () => {
      const content = "まったく個人情報が含まれないテキストです。";
      const maskedItems = [];
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
    test('モーダルがない場合は自動的にconfirmedを返す', async () => {
      document.body.innerHTML = '';
      const content = "テストコンテンツ";
      const maskedItems = [];
      const maskedCount = 0;

      const result = await sanitizePreview.showPreview(content, maskedItems, maskedCount);

      expect(result).toEqual({ confirmed: true, content });
    });
  });

  describe('maskStatusMessageの動的作成', () => {
    test('maskStatusMessageが存在しない場合は動的に作成される', () => {
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

      const content = "連絡先:[MASKED:email]xxx@example.com";
      const maskedItems = [{ type: "email", original: "xxx@example.com" }];
      const maskedCount = 1;

      sanitizePreview.showPreview(content, maskedItems, maskedCount);

      const maskStatusMessage = document.getElementById('maskStatusMessage');
      expect(maskStatusMessage).toBeDefined();
      expect(maskStatusMessage.className).toBe('mask-status-message');
      expect(maskStatusMessage.textContent).toBe('Masked E-mail1 items');
    });
  });

  describe('initializeModalEvents', () => {
    test('ボタン要素が存在しない場合でもエラーを投げない', () => {
      document.body.innerHTML = `
        <div id="confirmationModal">
          <div class="modal-body"></div>
        </div>
      `;

      expect(() => {
        sanitizePreview.initializeModalEvents();
      }).not.toThrow();
    });

    test('ResizeObserverが未定義の場合でもエラーを投げない', () => {
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
    test('PERF-007: initializeModalEventsを複数回呼んでもResizeObserverがクリーンアップされる', () => {
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
        observe: jest.fn(),
        disconnect: jest.fn(() => {
          disconnectCallCount++;
        }),
      };

      let createCount = 0;
      const originalResizeObserver = global.ResizeObserver;
      global.ResizeObserver = jest.fn((callback) => {
        createCount++;
        return mockObserver;
      });

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
    test('PERF-007: cleanupModalEventsでResizeObserverが解放される', () => {
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

      const disconnectMock = jest.fn();
      const originalResizeObserver = global.ResizeObserver;
      global.ResizeObserver = jest.fn(() => ({
        observe: jest.fn(),
        disconnect: disconnectMock,
      }));

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
    test('モーダル表示後にボタン要素が存在する', async () => {
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

      const content = "テストコンテンツ";

      // Promiseを待たずにモーダルの状態を確認
      const promise = sanitizePreview.showPreview(content, [], 0);

      const modal = document.getElementById('confirmationModal');
      const confirmBtn = document.getElementById('confirmPreviewBtn');
      const cancelBtn = document.getElementById('cancelPreviewBtn');

      // モーダルが表示されていることを確認
      expect(modal.style.display).toBe('flex');

      // ボタン要素が存在することを確認
      expect(confirmBtn).toBeDefined();
      expect(cancelBtn).toBeDefined();

      // テスト完了、Promiseは解決されないがエラーは投げない
    });
  });

  describe('setPreviewContent - 内部関数のカバレッジ', () => {
    test('previewContentがnullの場合は何もしない', () => {
      const content = "テスト";
      // previewContentがない状態でDOMをクリア
      document.body.innerHTML = `
        <div id="confirmationModal">
          <div class="modal-body"></div>
        </div>
      `;

      expect(() => {
        sanitizePreview.showPreview(content, [], 0);
      }).not.toThrow();
    });

    test('previewContentがundefinedの場合は何もしない', () => {
      const content = "テスト";
      document.body.innerHTML = `
        <div id="confirmationModal" style="display: none;">
          <div class="modal-body"></div>
        </div>
      `;

      expect(() => {
        sanitizePreview.showPreview(content, [], 0);
      }).not.toThrow();
    });
  });
});