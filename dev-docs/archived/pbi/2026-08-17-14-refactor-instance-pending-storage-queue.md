# PBI: PendingChromeStorageQueue をインスタンス化する

## ユーザーストーリー
開発者として、`PendingChromeStorageQueue` がモジュールレベルのシングルトンとして作成されている状態を解消したい。なぜなら、import 時にアダプタとキューが作成されるため、テスト時にモックアダプタを注入できないから。

## ビジネス価値
- テスト時にモックアダプタを注入できるようになる
- キューの動作が独立してテストできる
- 本番とテストで異なるストレージバックエンドを注入できる柔軟性を得る

## BDD受け入れシナリオ

```gherkin
Scenario: 本番環境でのキュー操作
  Given ChromeStorageAdapter が注入されている
  When enqueuePendingWrite が呼ばれる
  Then キューが chrome.storage.local に書き込む

Scenario: テスト環境でのキュー操作
  Given InMemoryAdapter が注入されている
  When enqueuePendingWrite が呼ばれる
  Then キューがインメモリデータに書き込む
  And chrome.storage は使用しない

Scenario: メタデータパッチのマージ
  Given 同じ URL のパッチが2つキューされている
  When マージが実行される
  Then 1つのパッチにマージされる
  And タイムスタンプが最新のものが採用される
```

## 受け入れ基準
- [ ] ファクトリ関数がエクスポートされている
- [ ] モジュールレベルのシングルトンが削除されている
- [ ] テストが InMemoryAdapter を使用している
- [ ] `npm run validate` が通過している

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 既存のE2Eシナリオがパスすることを確認

### 統合テスト
- キューの永続化・リトライ動作の検証

### 単体テスト
- InMemoryAdapter を使用したキュー操作の単体テストを追加
- メタデータパッチのマージロジックのテストを追加

## 実装アプローチ
- **Outside-In**: ファクトリ関数を定義し、モジュールレベルのシングルトンを除去
- **Red-Green-Refactor**: 除去後に型エラーが発生する場合のみ修正

## 見積もり
2ポイント

## 技術的考慮事項
- 依存関係: なし（独立して実装可能）
- テスタビリティ: InMemoryAdapter により改善
- リスク: 低（ファクトリ関数の追加のみ）

## 実装者向け注記

### 現状コードの確認
```bash
# モジュールレベルのシングルトンを確認
grep -n "const adapter\|const queue" src/background/pendingChromeStorageQueue.ts
# enqueuePendingWrite の呼び出し箇所を確認
grep -rn "enqueuePendingWrite" src/ --include="*.ts" | grep -v test | grep -v __tests__
```

### 実装手順
1. ファクトリ関数 `createPendingChromeStorageQueue(adapter)` を定義
2. モジュールレベルの `adapter` と `queue` を削除
3. `enqueuePendingWrite` をファクトリ関数から作成されたキューを使用するよう修正
4. createBackgroundServices.ts でファクトリ関数を呼び出す
5. テストを InMemoryAdapter 使用に更新

### 落とし穴
- enqueuePendingWrite はメタデータパッチのマージロジックを持つ。ファクトリ関数でも同じロジックを維持すること
- 既存の callers が enqueuePendingWrite を直接呼んでいる。ファクトリ関数に変更するか、モジュールレベルのデフォルトインスタンスを維持するか判断すること

## Definition of Done
- [ ] ファクトリ関数がエクスポートされている
- [ ] モジュールレベルのシングルトンが削除されている
- [ ] テストが InMemoryAdapter を使用している
- [ ] 全テストがパスしている
- [ ] コードレビュー完了
