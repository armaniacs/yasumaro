# PBI: ServiceContainer を型安全化し PerUrlMutex と残り7件の登録を完了する

## ユーザーストーリー
開発者として、ServiceContainer の register/resolve が文字列 typo で壊れないようにしたい、なぜなら `createBackgroundServices` は 12モジュールから依存される god node で、1文字の typo が全バックグラウンド機能を停止させるから。併せて PerUrlMutex の static 漏れと残り7件の手動 new を解消し、テスト隔離を完全なものにしたい

## 優先度
- 順位: 5 / 9
- RICEスコア: 21.0（Reach=7 / Impact=2 / Confidence=75% / Effort=0.50w）
- 根拠: god node の債務で影響大だが Effort も大きい。中盤に配置し Wave1 の High 群が落ち着いてから集中して取り組む。依存なしだがハブを触るため単独で実行。

## ビジネス価値
- DI の typo がコンパイル時に検出され、リファクタ時の 3型同時更新事故を 0 にできる
- テスト間の mutex 漏れがなくなり、flaky test を 30% 削減できる

## BDD受け入れシナリオ

```gherkin
Scenario: typo がコンパイルエラーになる
  Given ServiceTokens に存在しないキー "recodingPipeline" を resolve しようとする
  When `npm run type-check` を実行する
  Then 型エラーが発生し、実行前に検出できる

Scenario: PerUrlMutex がテスト間で漏れない
  Given テストAで PerUrlMutexMap を使った記録が走る
  When テストBを開始する
  Then 前テストの mutex 状態が残っておらず、独立して実行できる

Scenario: 後半7件が container 経由で差し替え可能
  Given container.override("sqliteClient", fake) した
  When createBackgroundServices(container) を呼ぶ
  Then recordingPipeline / dashboardSqliteHandler が fake を参照する
```

## 受け入れ基準
- [x] `ServiceContainer` が `ServiceTokens` const またはブランド型で `register<T>(token, factory)` が型付けされている
- [x] `PerUrlMutexMap` が static ではなく container 管理のインスタンスになっている（または static を deprecated としてラップ）
- [x] `createBackgroundServices.ts` の後半7件（reviewSummaryGenerator/recordingPipeline/pendingWriteQueue/dashboardSqliteHandler/autoSavedBadgeTabs/messageRouter+派生）が `container.register(singleton:true)` に移行
- [x] `_CoreServicesSubsetCheck` が全フィールドをカバーするか `BackgroundServices` が `ReturnType` で自動導出

## テスト戦略

### 統合テスト
- container.override 後の recordingPipeline が fake sqliteClient を使うことの結合テスト

### 単体テスト
- ServiceContainer の型テスト（存在しないトークンで type-error）
- PerUrlMutexMap の隔離テスト（2つの container で map が別インスタンス）

## 見積もり
5pt

## 技術的考慮事項
- 依存関係: なし。ただし 01-04 とファイルが重なるため rebase 時にコンフリクトしやすい。Wave2 で単独実行を推奨
- テスタビリティ: override 機構を維持し、既存の `backgroundComposition.test.ts` が PASS することを担保

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "ServiceContainer\|register.*singleton" src/background/serviceContainer.ts src/background/createBackgroundServices.ts
grep -rn "PerUrlMutexMap\|sharedMutexes" src/background/pipeline/perUrlMutex.ts
```

### 実装手順
1. `serviceContainer.ts` に `ServiceTokens = { sqliteClient: "sqliteClient", ... } as const` を定義し `register<K extends keyof ServiceTokens>` に変更
2. `PerUrlMutexMap` を `container.register("perUrlMutexMap", () => new PerUrlMutexMap(), {singleton:true})` に移し、static アクセスをインスタンス委譲に
3. `createBackgroundServices.ts` の後半7件を register に移行し、既存テストの override が効くことを確認

### 落とし穴
- static map を単に削除すると既存の `PerUrlMutexMap.getSharedMap()` 呼び出しが壊れる。互換 shim を残し deprecated 警告を出す
- string-key を一括置換すると 20箇所の修正になる。codemod で一括置換し、type-check で漏れを検出する

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] 8394 tests が PASS し、flaky が再現しない
- [x] コードレビュー完了（System Architect 観点の再確認）
- [x] ドキュメント更新済み（dev-docs/LAYERS.md の DI 章）
