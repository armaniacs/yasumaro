# PBI: RecordingPipeline + createBackgroundServices の concentration failure を修正

## ユーザーストーリー
開発者として、`createBackgroundServices` の shallow coordinator を削減し、`RecordingPipeline` の cache/seam を整理したい。なぜなら composition root が全 dependency password を知っており、cache が多重定義（closure + `RecordingCacheInstance`）されているから。

## 優先度
- 順位: 06 / 全候補数 7
- RICEスコア: 3.0（Reach=5 / Impact=1.5 / Confidence=80% / Effort=2人週）
- 根拠: PBI-01（SettingsRepository shim）完了後に着手。中 effort。

## BDD受け入れシナリオ

Scenario: RecordingPipelineDeps が純粋 interface になる
  Given `RecordingPipeline` constructor が 7 つの dependency を受け取る
  And そのうち 3 つが `() => Promise` closure である
  When `RecordingPipelineDeps` interface を純粋に定義し closure を除去する
  Then constructor は具象 dependency のみを受け取る
  And テストは dependency をモックして pipeline を検証できる

Scenario: createBackgroundServices が messageRouter + recordingPipeline のみを公開する
  Given `createBackgroundServices` が 216 行の shallow coordinator である
  When public 出力を `messageRouter` + `recordingPipeline` に限定する
  Then `service-worker.ts` は全 dependency password を知る必要がない
  And cache は `RecordingCacheInstance` に一元化される

## 受け入れ基準
- [ ] `RecordingPipelineDeps` interface が純粋に定義されている
- [ ] `PerUrlMutexMap` の static mutable singleton compat が削除されている
- [ ] `createBackgroundServices` が `messageRouter` + `recordingPipeline` のみを公開する
- [ ] cache が `RecordingCacheInstance` に一元化されている
- [ ] 既存の recording/pipeline テストが PASS する
- [ ] `npm run test` が PASS する

## テスト戦略
- **統合**: `RecordingPipeline.execute()` が全 step を正しく実行することを検証
- **単体**: 各 `PipelineStep` の pure function テスト
- **契約**: `createBackgroundServices` の出力が `MessageRouterDeps` + `RecordingPipeline` のみであることを型テストで検証

## 見積もり
2 ストーリーポイント（中 — 2 人週程度）

## 技術的考慮事項
- **依存**: PBI-01（SettingsRepository shim 廃止）に依存
- **テスタビリティ**: `RecordingPipelineDeps` が pure interface になることで、テストは dependency をモックして pipeline を検証可能
- **非機能要件**: composition root の複雑度低減。

## 実装者向け注記

### 現状コードの確認
```bash
grep -n "PerUrlMutexMap" src/background/pipeline/RecordingPipeline.ts
grep -n "static" src/background/pipeline/RecordingPipeline.ts
grep -n "createBackgroundServices" src/background/createBackgroundServices.ts | head -20
```

### 実装手順
1. `RecordingPipelineDeps` interface を `src/background/pipeline/types.ts` に定義
2. `RecordingPipeline` constructor を deps interface に変更
3. `PerUrlMutexMap` の static compat を削除（または major version で削除）
4. `createBackgroundServices` の public 出力を `messageRouter` + `recordingPipeline` に限定
5. cache 多重定義を `RecordingCacheInstance` に一元化
6. テストを新しい構造に移行

### 落とし穴
- `PerUrlMutexMap` の static compat は legacy テストが依存している可能性がある。削除前に全呼び出し元を確認する。

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] リファクタリング完了
- [ ] ドキュメント更新済み
