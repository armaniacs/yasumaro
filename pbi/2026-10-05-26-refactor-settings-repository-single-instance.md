# PBI: コンポジションルートの外に残る直接生成・モジュールシングルトン（自前の ADR 方針と不一致）

## ユーザーストーリー

SW の composition を保守する開発者として、ルート外の直接生成を manifest 経由に寄せたい。`SettingsRepository` が 2 インスタンス存在し `clearSettingsCache` が片方にしか効かないうえ、自前の「新規 SW 依存は manifest 経由にすべし」という方針に反しているから。

## 優先度

- 順位: 18/32
- RICE: 4.0（R5 / I2 / C0.8 / E2）
- 根拠: 設定キャッシュの読み取りはほぼ全ハンドラに関わる。純 RICE では上位だが `compositionManifest.ts` を NN22 と共有するため NN22 の後に実行する（逸脱 2）
- 依存: NN22

## 背景（file:line 現状）

- SettingsRepository A: `src/utils/storage/SettingsRepository.ts:280` の module singleton（`observe()` 登録対象）
- SettingsRepository B: `src/background/compositionManifest.ts:112` の `new SettingsRepository(...)` を container に登録
- A を直接使う側: `compositionManifest.ts:216, :241, :243`（clearSettingsCache）、`src/background/handlers/dashboardSqlite/deps.ts:234, :236`
- B を使う側: `compositionManifest.ts:204`（`settingsReader` → `alarmRegistry.ts:87-88` の `installReviewSummary`）。container resolve はこの 1 箇所のみ
- 影響: `clearSettingsCache` は片方のキャッシュしか消さない。container 側 epoch は `observe()` 未登録なので設定変更で進まず、TTL 1 秒でのみ失効する
- 直接生成: `src/background/handlers/dashboardSqlite/deps.ts:237-240` が append 毎に `new ObsidianClient()`（manifest には `obsidian` singleton が在る）。`:112` は `settingsRepository` 直参照
- module singleton: `src/background/pendingSqliteQueue.ts:47-54`、`src/background/offlineNetworkQueue.ts:36-46, :159`。`offlineNetworkQueue.ts:154-158` 自身が「新規 SW 依存は manifest 経由にすべし」と書いているのに違反し、テストが InMemoryAdapter を差し込めずキューが実 storage を触る

## BDD受け入れシナリオ

```gherkin
Scenario: 設定キャッシュのクリアが両読み手に効く
  Given 同一インスタンス化された settingsRepository
  When clearSettingsCache を呼ぶ
  Then container 側の reader（alarmRegistry の installReviewSummary 経路）にも効く

Scenario: キューにテスト用注入ができる
  Given setQueueForTesting を持つ facade
  When InMemoryAdapter を差し込む
  Then キューが実 storage を触らずにテストできる

Scenario: ObsidianClient の生成が manifest 経由になる
  Given deps.ts の append 経路
  When 実行する
  Then 毎回 new せず manifest の obsidian singleton を使う
```

## 受け入れ基準

- [x] `'settingsRepository'` エントリの factory が `() => settingsRepository`（module singleton を返す）に変わり、container とモジュールが同一インスタンスになっている
- [x] `pendingSqliteQueue` / `offlineNetworkQueue` に `setQueueForTesting()`（`pendingChromeStorageQueue.ts:134-136` と同じ形）が追加され、manifest の `onReady` で注入されている
- [x] `deps.ts:237-240` の append 毎 `new ObsidianClient()` が manifest 経由になっている
- [x] 既存の try/catch は変更不要な範囲で維持されている
- [x] NN22 の `compositionManifest.ts` / `dashboardSqliteWiring.ts` 変更と競合しない形になっている
- [ ] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- 単体: 同一インスタンス性のテスト、queue 注入後のテスト
- 実時間待ちは使わない（AGENTS.md / TEST_RULE 準拠）

## 見積もり

2 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: `src/background/compositionManifest.ts`（settingsRepository の同一インスタンス化 + queue entry 新設 + onReady 注入 + dashboardSqliteHandler への obsidian 注入）、`src/background/pendingSqliteQueue.ts` / `src/background/offlineNetworkQueue.ts`（factory + facade + setQueueForTesting。`sharedOfflineNetworkQueue` を let 化）、`src/background/handlers/dashboardSqlite/deps.ts`（setter 注入の singleton 経由化）、新規 `src/background/__tests__/nn26-manifest-singletons.test.ts`（pin 8 件）
- ゲート: 新規 8 + 既存 81 + 隣接 42 tests green / type-check PASS / lint 0 errors
