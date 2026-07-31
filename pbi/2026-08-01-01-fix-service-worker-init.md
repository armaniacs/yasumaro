# PBI: Service Worker の init() を実際に呼び出す

## ユーザーストーリー
開発者として、Service Worker 起動時にアラーム・マイグレーション・マスターパスワードタイムアウトが確実に実行されるようにしたい。なぜなら、これらが動かないとデータパージ、保留書込リトライ、セッションタイムアウトが永久に停止し、ユーザーのデータ整合性とセキュリティを損なうから。

## ビジネス価値
- 日次パージが実行され、SQLite/ストレージが無制限成長しない
- オフラインキューの5分間リトライが動作し、書込漏れが減る
- マスターパスワードの自動ロックが機能する

## BDD受け入れシナリオ

```gherkin
Scenario: Service Worker 起動時に init() が呼ばれる
  Given 拡張機能がインストールされている
  When Service Worker が起動する
  Then chrome.alarms.create('yasumaro-daily-purge') が実行される
  And chrome.alarms.create('yasumaro-offline-network-retry') が実行される
  And initializeSessionAlarms() が実行される

Scenario: アラームリスナーが登録されたアラームに反応する
  Given init() が呼ばれている
  When 'yasumaro-daily-purge' アラームが発火する
  Then handleDailyPurgeAlarm() が実行される
```

## 受け入れ基準
- [ ] `entrypoints/background/index.ts` から `init()` が呼ばれる
- [ ] `chrome.alarms.create` が2つとも実行される（テストで検証）
- [ ] `initializeSessionAlarms()` が実行される
- [ ] `runMigration()` / `migrationService.run()` が起動時に実行される
- [ ] Service Worker 再起動後もアラームが再登録される

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- Service Worker 起動後、dev-tools の Application > Alarms に2つのアラームが登録されていること

### 統合テスト
- `entrypoints/background/index.ts` の `main()` が `init()` を呼び出すこと

### 単体テスト
- `service-worker.test.ts` で `init()` を実際に呼び出し、各種モックが呼ばれることを検証
- アラーム名の存在チェック
- 二重 `init()` 呼び出しが安全であること（冪等性）

## 実装アプローチ
- **Outside-In**: entrypoint から呼び出しを追加し、テストを Red→Green
- **Red-Green-Refactor**: まず `main()` が `init()` を呼ばないテストを書き、失敗を確認してから実装
- **リファクタリング**: `init()` 内の fire-and-forget Promise を適切に catch する

## 見積もり
2pt

## 技術的考慮事項
- 依存関係: `entrypoints/background/index.ts` → `src/background/service-worker.ts`
- SW 再起動ごとに `init()` が呼ばれるため、冪等性が必要
- alarm listeners はすでにモジュールレベルで登録済み

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "init()" entrypoints/background/
grep -rn "chrome.alarms.create" src/background/service-worker.ts
```

### 実装手順
1. `entrypoints/background/index.ts` を `import()` から named import + `init()` 呼び出しに変更
2. テストを追加: `service-worker.test.ts` で `init()` 実行後のアラーム登録を検証
3. alarm handler の fire-and-forget を `void` + catch で安全にする

### 落とし穴
- テスト内 `typeof init === 'function'` は呼び出しを検証しないため注意
- `init()` を二重に呼ぶと alarm が重複登録される可能性がある（Chrome は同名 alarm を上書きするが、念のため確認）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] リファクタリング完了
