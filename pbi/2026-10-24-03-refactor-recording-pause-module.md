# PBI: 一時停止概念の深いmodule化

## ユーザーストーリー

保守担当者として、一時停止の知識を1 moduleに集めたい。なぜなら単一概念の理解に5 module横断が必要で、seamが2つに割れているから。

## 優先度

- 順位: 03 / 全8件
- RICE スコア: 7.5（Reach = 7 / Impact = 2 / Confidence = 0.8 / Effort = 1.5人日）
- 根拠: deadline意味論・上限変更の集中。Confidence 0.8 は集約粒度の設計判断残り。

## ビジネス価値

呼び側は「止まっているか」1問だけ学べばよくなり、上限・fail-open変更が1 moduleで完結する。

## BDD受け入れシナリオ

```gherkin
Scenario: 一時停止が単一interfaceで動く
  Given 停止期限がある
  When 判定・停止・再開する
  Then 変更前と同一に動作する

Scenario: 上限変更が1箇所で済む
  Given 上限を変えたい
  When moduleを変える
  Then badge・alarmを含む全体に反映される
```

## 受け入れ基準

- [x] gate predicate・PauseStorage・preset検証・badge連携が単一interfaceの背後に集まる
- [x] factory 3件が薄い配線に留まり独自検証を持たない
- [x] 既存テスト全緑

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし

### 統合テスト
- 一時停止フローテスト維持

### 単体テスト
- 深いmoduleのtable（deadline・上限・fail-open）

## 実装アプローチ

- **Outside-In**: 単一interfaceの失敗テストを先に書き、赤を確認してから集約する

## 見積もり

1.5pt（🟡中）

## 技術的考慮事項

- 依存関係: なし
- 非機能要件: deadline意味論・fail-open・上限値不変

## 変更点の概要

`recordingPause.ts` を深いmoduleに育て、gate・検証・badge連携を集約する。

## 現状と問題（file:line 付き）

- `src/background/recordingPause.ts:27-78` ― predicate・seam・schedule/clear
- `src/background/recordingPauseGate.ts:15-18` ― read＋比較を再記述するwrapper（全19行）
- `src/background/handlers/pauseHandlers.ts:30-68` ― factory 3件
- `src/background/badgePolicy.ts:52-80` ― countdown表示・write点
- `src/background/alarmRegistry.ts:117,127` ― 配線
- 呼出し2箇所（recordingTriggerManager・recordingAdmission）

## 変更の理由（depth・locality）

単一概念のlocality喪失。深いmoduleで取り戻す。

## 提案コード（骨子のみ）

```typescript
// 例: pause(deadlineMinutes) / resume() / isPaused(now) の単一interface。
// factoryは委譲のみ。badge/alarm連携はmodule内に吸収する。
```

## 実装者向け注記

### 現状コードの確認

```bash
grep -rn "recordingPause\|isPaused\|PAUSE_MAX_MINUTES" src/background/ --include='*.ts' | grep -v __tests__ | head -20
```

### 落とし穴

- fail-open方針を変えない（gateの既存テストが緑のままであること）
- alarmとの二重配線driftを起こさない

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] 既存テスト全通過 + tableテスト新規通過
- [x] コードレビュー完了
- [ ] `npm run validate` 通過
- [x] ドキュメント更新済み
