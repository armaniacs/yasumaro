// @vitest-environment jsdom
/**
 * UF-403 ローディングスピナー機能のテスト
 *
 * Refactorフェーズ: 本ファイルではモジュール化されたspinner.jsからimportした関数の動作を検証します。
 * showSpinner()、hideSpinner()関数によるDOM操作を単体でテストします。
 */


import { vi } from 'vitest';

// Mock i18n before importing spinner.js
vi.mock('../i18n.js', () => ({
  getMessage: vi.fn((key, substitutions) => {
    if (key === 'processing') return '処理中...';
    if (key === 'countdownNumber' && substitutions?.count !== undefined) return `${substitutions.count}...`;
    if (key === 'autoClosing') return '自動閉じる';
    return key;
  })
}));

import { showSpinner, hideSpinner } from '../spinner.js';

describe('ローディングスピナー制御', () => {
  // 【テストグループの目的】: showSpinner、hideSpinner関数の動作を検証
  // 【テスト内容】: スピナー表示、非表示、テキスト更新機能をテスト

  beforeEach(() => {
    // 【テスト前準備】: 各テスト実行前にテスト環境を初期化
    // 【環境初期化】: DOMをスピナー要素を含む状態にする
    document.body.innerHTML = `
      <div id="loadingSpinner" class="spinner-container" style="display: none;">
        <svg class="spinner" viewBox="0 0 50 50">
          <circle
            class="spinner-path"
            cx="25" cy="25" r="20"
            fill="none"
            stroke="#4CAF50"
            stroke-width="4"
            stroke-linecap="round"
          />
        </svg>
        <span class="spinner-text"></span>
      </div>
    `;

    // Clear all mocks before each test
    vi.clearAllMocks();

    // 【モックキャプチャ】: console.warnの出力をキャプチャするモックを設定
    // @ts-expect-error - vi.fn() type narrowing issue
  
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    // 【テスト後処理】: console.warnのモックをリセット
    vi.restoreAllMocks();
  });

  test('showSpinner()呼び出しでスピナー要素が表示される', () => {
    // 【テスト目的】: showSpinner関数の基本動作を確認
    // 【テスト内容】: showSpinner()呼び出しによりスピナー要素のdisplayがflexに変更されることをテスト
    // 【期待される動作】: スピナーが表示状態になり、テキストが設定されること
    // 🟢 要件定義（loading-spinner-requirements.md 186-196行目）に基づき仕様が明確

    const spinner = document.getElementById('loadingSpinner');
    expect(spinner.style.display).toBe('none'); // 【前提条件確認】: 初期状態で非表示

    // 【実際の処理実行】: showSpinner関数を呼び出し
    // 【処理内容】: スピナーを表示状態にし、テキストを設定する
    showSpinner('処理中...');

    // 【結果検証】: DOM操作の結果を確認
    expect(spinner.style.display).toBe('flex'); // 【確認内容】: displayがflexに変更されたこと
    expect(spinner.querySelector('.spinner-text').textContent).toBe('処理中...'); // 【確認内容】: テキストが設定されたこと
  });

  test('showSpinner()でテキスト引数を渡して表示テキストを更新できる', () => {
    // 【テスト目的】: テキスト更新機能の確認
    // 【テスト内容】: 引数によるテキスト更新をテスト
    // 【期待される動作】: 指定したテキストが正しく表示されること
    // 🟢 要件定義（7.3節 API仕様）に基づき仕様が明確

    const spinner = document.getElementById('loadingSpinner');

    // 【実際の処理実行】: テキスト引数を指定して呼び出し
    // 【処理内容】: コンテンツ取得中を表すテキストを設定
    showSpinner('コンテンツ取得中...');

    // 【結果検証】: 正しい引数で呼ばれたことを確認
    expect(spinner.style.display).toBe('flex'); // 【確認内容】: スピナーが表示状態であること
    expect(spinner.querySelector('.spinner-text').textContent).toBe('コンテンツ取得中...'); // 【確認内容】: 正しいテキストが設定されたこと
  });

  test('showSpinner()引数省略時はデフォルトテキストが表示される', () => {
    // 【テスト目的】: デフォルト引数の動作確認
    // 【テスト内容】: 引数を省略した場合の動作をテスト
    // 【期待される動作】: デフォルト引数 '処理中...' が使用されること
    // 🟢 要件定義（191行目）でデフォルト値が仕様として定義

    // 【実際の処理実行】: 引数なしで呼び出し
    // 【処理内容】: デフォルト引数 '処理中...' が使用される
    showSpinner();

    const spinner = document.getElementById('loadingSpinner');
    expect(spinner.style.display).toBe('flex'); // 【確認内容】: スピナーが表示状態であること
    expect(spinner.querySelector('.spinner-text').textContent).toBe('処理中...'); // 【確認内容】: デフォルトテキストが表示されたこと
  });

  test('hideSpinner()呼び出しでスピナー要素が非表示になる', () => {
    // 【テスト目的】: hideSpinner関数の基本動作を確認
    // 【テスト内容】: displayプロパティがnoneに変更されることをテスト
    // 【期待される動作】: スピナーが非表示状態になること
    // 🟢 要件定義（201-204行目）に基づき仕様が明確

    const spinner = document.getElementById('loadingSpinner');
    spinner.style.display = 'flex'; // 【テストデータ準備】: 表示状態に設定

    expect(spinner.style.display).toBe('flex'); // 【前提条件確認】: 初期状態で表示中

    // 【実際の処理実行】: hideSpinner関数を呼び出し
    // 【処理内容】: スピナーを非表示状態にする
    hideSpinner();

    // 【結果検証】: DOM操作の結果を確認
    expect(spinner.style.display).toBe('none'); // 【確認内容】: displayがnoneに変更されたこと
  });

  test('showSpinner - DOM要素が存在しない場合は警告を出力する', () => {
    // 【テスト目的】: DOM要素が見つからない場合の挙動を確認
    // 【エラーケースの概要】: document.getElementByIdがnullを返すケース
    // 【エラー処理の重要性】: DOM構成エラーを検知することを確認
    // 🟡 要件定義にDOM要素存在チェックの明示なし、実装時に追加

    // 【テストデータ準備】: DOMからloadingSpinner要素を削除
    document.body.innerHTML = '';

    // 【実際の処理実行】: 要素がない状態でshowSpinnerを呼び出し
    expect(() => {
      showSpinner('処理中...');
    }).not.toThrow(); // 【確認内容】: 例外がスローされないこと（エラーハンドリング済み）

    // 【結果検証】: console.warnが呼ばれたことを確認
    expect(console.warn).toHaveBeenCalledWith('loadingSpinner element not found'); // 【確認内容】: 適切な警告メッセージが出力されたこと
  });

  test('hideSpinner - DOM要素が存在しない場合は警告を出力する', () => {
    // 【テスト目的】: DOM要素が見つからない場合の挙動を確認
    // 【エラーケースの概要】: document.getElementByIdがnullを返すケース
    // 【エラー処理の重要性】: DOM構成エラーを検知
    // 🟡 要件定義にDOM要素存在チェックの明示なし、実装時に追加

    // 【テストデータ準備】: DOMからloadingSpinner要素を削除
    document.body.innerHTML = '';

    // 【実際の処理実行】: 要素がない状態でhideSpinnerを呼び出し
    expect(() => {
      hideSpinner();
    }).not.toThrow(); // 【確認内容】: 例外がスローされないこと（エラーハンドリング済み）

    // 【結果検証】: console.warnが呼ばれたことを確認
    expect(console.warn).toHaveBeenCalledWith('loadingSpinner element not found'); // 【確認内容】: 適切な警告メッセージが出力されたこと
  });

  test('showSpinnerを複数回呼び出した場合の挙動', () => {
    // 【テスト目的】: 複数回呼び出しの動作を確認
    // 【テスト内容】: 連続して関数を呼び出した場合の挙動を確認
    // 【期待される動作】: 最新のテキストが設定されること
    // 🟢 関数呼び出しの正規挙動確認

    const spinner = document.getElementById('loadingSpinner');

    // 【実際の処理実行】: 連続して呼び出し
    showSpinner('処理中...');
    expect(spinner.querySelector('.spinner-text').textContent).toBe('処理中...');

    showSpinner('コンテンツ取得中...');
    expect(spinner.querySelector('.spinner-text').textContent).toBe('コンテンツ取得中...');

    showSpinner('保存中...');
    expect(spinner.querySelector('.spinner-text').textContent).toBe('保存中...');

    // 【結果検証】: 最後の呼び出しの状態が維持されていること
    expect(spinner.style.display).toBe('flex'); // 【確認内容】: スピナーが表示状態であること
    expect(spinner.querySelector('.spinner-text').textContent).toBe('保存中...'); // 【確認内容】: 最新のテキストが設定されていること
  });

  test('showSpinnerとhideSpinnerの組み合わせ動作', () => {
    // 【テスト目的】: 表示と非表示の組み合わせ動作を確認
    // 【テスト内容】: showSpinnerとhideSpinnerを連続して呼び出す動作をテスト
    // 【期待される動作】: 各操作が正しく反映されること
    // 🟢 正常なフローにおける関数呼び出し順序確認

    const spinner = document.getElementById('loadingSpinner');

    // 【テスト前】: 初期状態を確認
    expect(spinner.style.display).toBe('none'); // 【確認内容】: 非表示状態であること

    // 【実際の処理実行】: 表示と非表示を繰り返す
    showSpinner('処理中...');
    expect(spinner.style.display).toBe('flex'); // 【確認内容】: 1回目: 表示状態になったこと
    expect(spinner.querySelector('.spinner-text').textContent).toBe('処理中...');

    hideSpinner();
    expect(spinner.style.display).toBe('none'); // 【確認内容】: 非表示状態になったこと

    showSpinner('コンテンツ取得中...');
    expect(spinner.style.display).toBe('flex'); // 【確認内容】: 2回目: 再表示されたこと
    expect(spinner.querySelector('.spinner-text').textContent).toBe('コンテンツ取得中...');

    hideSpinner();
    expect(spinner.style.display).toBe('none'); // 【確認内容】: 最終的に非表示状態であること
  });
});