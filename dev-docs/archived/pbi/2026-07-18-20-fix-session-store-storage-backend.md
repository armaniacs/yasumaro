# PBI: SessionStoreのバックエンドをchrome.storage.sessionに変更

## ユーザーストーリー
開発チームとして、セッションスコープのデータが適切なストレージバックエンドに保存されてほしい、なぜなら現状は `chrome.storage.local` を使っており、5MBクォータを消費して設定データやURLキャッシュと競合するから

## ビジネス価値
- `chrome.storage.local` の5MBクォータをセッションデータで圧迫しない
- `chrome.storage.session`（クォータ非カウント、ブラウザ終了時に自動クリア）というセッションデータに適切な特性を活用

## 実装者向け注記（フェーズ0の既実装確認結果）

Read で確認済み:
- `src/background/sessionStore.ts:19-21` — `sw:` プレフィクスのキーを `chrome.storage.local` に保存
- 親レポートの対処案: `SessionStore` のバックエンドを `chrome.storage.session` に変更。容量制限（~1MB）に注意
- **旧データ移行の考慮が必要**: side-effects.md M9判定で「`chrome.storage.session`の容量制限、offscreenからのアクセス設定、旧データ移行が必要」と明記されている

```bash
# 実装前の必須調査コマンド
sed -n '1,50p' src/background/sessionStore.ts
grep -rn "sessionStore\|SessionStore" src/background/*.ts --include="*.ts" | grep -v __tests__
grep -n "chrome.storage.session" src/offscreen/*.ts 2>&1
```

**offscreenアクセス設定の確認が必須**: `chrome.storage.session` はデフォルトでoffscreen documentからアクセスできない設定（`setAccessLevel`が必要な場合がある）ため、offscreen側からSessionStoreを参照する箇所がないか確認すること。

## BDD受け入れシナリオ

```gherkin
Scenario: セッションデータがchrome.storage.sessionに保存される
  Given SessionStoreを使用してデータを保存する
  When ブラウザを再起動する
  Then セッションデータは自動的にクリアされている（chrome.storage.sessionの特性）

Scenario: 既存のchrome.storage.local内の旧セッションデータが移行される
  Given 拡張機能アップデート前にchrome.storage.localへ保存された "sw:" プレフィクスのデータが存在する
  When 拡張機能が起動する
  Then 旧データがchrome.storage.sessionへ移行される（または安全に無視される設計になっている）
  And chrome.storage.local側の旧データは適切にクリーンアップされる

Scenario: 容量制限内でセッションデータが正常動作する
  Given chrome.storage.sessionの容量制限（約1MB）
  When 通常利用範囲のセッションデータを保存する
  Then 容量超過エラーが発生しない
```

## 受け入れ基準
- [x] `SessionStore` のバックエンドを `chrome.storage.local` から `chrome.storage.session` に変更
- [x] offscreen documentからのアクセスが必要な場合、`chrome.storage.session.setAccessLevel()` を適切に設定
  - 確認結果: `SessionStore` は Service Worker 内のみで使用され、offscreen からの参照はないため `setAccessLevel` は不要
- [x] 既存の `chrome.storage.local` 内の `sw:` プレフィクスデータに対する移行またはクリーンアップ処理を実装
- [x] 容量制限（~1MB）を超えるデータ量が想定されないことを確認、または超過時のフォールバックを用意
  - クォータ超過時はリトライせず、メモリ内にデータを保持するフォールバックを実装

## テスト戦略（t_wadaスタイル）

### E2E（最小限）
- 実機Chromeでブラウザ再起動後にセッションデータがクリアされることを確認（自動テスト困難なため手動確認）

### 統合テスト
- `SessionStore` の read/write が `chrome.storage.session` 経由で行われることを検証
- 旧 `chrome.storage.local` データの移行ロジックが正しく動作することを検証

### 単体テスト
- `SessionStore` クラスの各メソッド（get/set/remove等）が `chrome.storage.session` APIを呼び出すことをモックで検証
- 容量超過時の挙動（エラーハンドリング）を検証

## 実装アプローチ
- **Outside-In**: 統合テスト（SessionStoreの読み書きがstorage.session経由であること）をRedで書き、実装を変更してGreenにする
- 移行ロジックは既存の `migrationService.ts` のパターン（フラグベースの一回限り実行）を踏襲する

## 見積もり
3pt（半日〜1日。offscreenアクセス設定の調査、旧データ移行、容量制限の検証を含むため中規模）

## 技術的考慮事項
- 依存関係: offscreen documentからのアクセスパターン調査が前提
- テスタビリティ: `chrome.storage.session` のモックがテスト環境に必要（既存のjest.setup.tsのchrome APIモックを拡張）
- 非機能要件: 容量制限（~1MB）、offscreenからのアクセス設定

## 落とし穴
- `chrome.storage.session` はデフォルトでは拡張機能のトラステッドコンテキスト（Service Worker、Popup等）からのみアクセス可能で、offscreen documentからは `chrome.storage.session.setAccessLevel({accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS'})` の明示的な設定が必要になる場合がある
- 旧データ移行を省略すると、アップデート後にユーザーの `chrome.storage.local` に残留した `sw:` データがゴミとして残り続ける

## Definition of Done
- [x] `SessionStore` が `chrome.storage.session` を使用するよう変更されている
- [x] 旧データ移行/クリーンアップが実装されている
- [x] 単体・統合テストが追加されパスする
- [ ] 実機Chromeでセッションクリア動作を確認
- [ ] コードレビュー完了
