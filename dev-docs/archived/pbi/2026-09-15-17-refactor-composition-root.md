# PBI: 合成ルートの二重化解消 — service-worker.ts を thin root に

## ステータス: ✅ 完了（2026-09-15）

## ユーザーストーリー

メンテナとして、新しい background 依存の追加手順が「manifest 1行 + token」に統一されていてほしい。なぜなら現在は compositionManifest の14エントリ外に7系統が service-worker.ts で直接合成されており、新規依存の追加手順が manifest 学習と SW root の動的 import 群学習の両方を要求するから。

## 優先度

- 順位: 1 / 本バッチ1件（arch-loop 第4ループ）
- RICEスコア: 7.0（Reach=7 / Impact=2 / Confidence=50% / Effort=1.0人週）
- 根拠: leverage と locality の両方を向上させるが、2600行の SW テストが現在の構造に密に結合しているため Confidence 50%。Firefox 分岐の扱いが最大の不確実性

## 背景（診断結果）

- `service-worker.ts` が manifest 外で少なくとも7系統を直接合成: `initializeSessionAlarms()`、`alarmRegistry.installAll()`、`localMarkdownIdleFlusher` 動的 import、`reviewSummaryAlarm` 動的 import、Firefox 分岐、`createDeferredMigrationRunner`、tab/lifecycle/notification/context-menu の手配線
- `compositionManifest.ts` の `messageRouter` factory が肥大（`updateConsentBadge` と `initExportScheduler` を動的 import closure で抱え込み）
- `ServiceTokens` と `CompositionEntry.key: string` が二重管理

## 実装ガイド

1. **`sessionAlarmService` を manifest に追加**: `key: 'sessionAlarmService'`
2. **`deferredMigrationRunner` を manifest に追加**: `key: 'deferredMigrationRunner'`
3. **`alarmRegistry` を manifest に追加**: `key: 'alarmRegistry'` — deps に sessionAlarmService / settingsReader / reviewSummaryGenerator を注入
4. **service-worker.ts を thin root に**: init() は `createBackgroundServices()` + `alarmRegistry.installAll()` + Chrome event listener 登録のみ
5. **Firefox 分岐は service-worker.ts に残す**（ビルド時条件分岐は DI の関心事ではない）

### 触ってはいけないもの

- handler export 関数群（`handleValidVisit` 等 — 2600行のテストが依存）
- `createBackgroundServices` の返却型（BackgroundServicesComposition）
- Chrome event listener 登録の構造（SW root の責務）

## BDD受け入れシナリオ

```gherkin
Scenario: 新規 background 依存の追加が manifest 1行で完結する
  Given compositionManifest が存在する
  When  新しい ServiceToken と factory を1行追加する
  Then  service-worker.ts の動的 import 群を学習せずに依存が解決される

Scenario: deferredMigrations が manifest 経由で解決される
  Given service-worker.ts が createDeferredMigrationRunner を直接 import していない
  When  init() が呼ばれる
  Then  manifest 経由で runner が解決され、マイグレーションが1回だけ実行される
```

## 受け入れ基準

- [ ] `sessionAlarmService` と `deferredMigrationRunner` が manifest エントリになっている
- [ ] `alarmRegistry` が manifest エントリになっている（deps 経由で sessionAlarmService を注入）
- [ ] `service-worker.ts` から alarm 系の直接 import が消えている（`sessionAlarmsManager.js` / `SessionAlarmService.js` / `reviewSummaryAlarm.js`）
- [ ] 既存の handler export 関数群とテストが green
- [ ] make clean test EXIT=0

## テスト戦略

- 既存: service-worker.test.ts（165 tests）+ alarmRegistry.test.ts が回帰網
- 単体: composition contract テスト（manifest の全 key が解決可能）

## 見積もり

3-5日

## Definition of Done

- [ ] 全BDDシナリオが完了している
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（manifest 先頭コメントに lifecycle 種別）
