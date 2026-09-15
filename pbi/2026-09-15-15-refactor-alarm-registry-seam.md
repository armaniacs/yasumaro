# PBI: alarm 系3つの onAlarm seam 統合 — timed job 追加を1行に

## ステータス: ✅ 完了（2026-09-15）

## ユーザーストーリー

メンテナとして、timed job（alarm）の追加が alarmRegistry の1行で完結してほしい。なぜなら `chrome.alarms.onAlarm` のリスナー登録が3箇所に分散しており、SW の wake ごとに評価される多重登録は correctness リスク直結だから。

## 優先度

- 順位: 3 / 本バッチ4件中
- RICEスコア: 10.0（Reach=3 / Impact=2 / Confidence=80% / Effort=0.6人週）
- 根拠: correctness リスク直結。seam が既に `AlarmJobSpec`（alarmRegistry.ts:35-40）という良い形で存在し、2系統を adapter として寄せるだけで完成するため effort 対効果が最大（診断の最推奨）

## 背景（診断結果）

- `chrome.alarms.onAlarm` リスナー登録が3箇所に分散:
  1. `src/background/alarmRegistry.ts:94-113`（registry 系 — `AlarmJobSpec` テーブル・失敗政策均一）
  2. `src/background/SessionAlarmService.ts:55-77,189-200`（`startTimeoutChecker` + 独自 `setupAlarmListener`・冪等ガード独自実装 `alarmListenerSetUp`）
  3. `src/background/reviewSummaryAlarm.ts:21-50,55-70`（`initializeReviewSummaryAlarms` + 独自 listener・module-global `listenerSetUp`）
- 冪等な clear→create パターンの重複（SessionAlarmService:57-60 と reviewSummaryAlarm:36-47）
- 失敗政策の不統一（registry は均一 catch、review-summary は分岐内 catch）
- `alarmRegistry.ts:10-13` が自ら `Out of scope: SessionAlarmService ... review-summary alarms` と宣言し、alarm 登録テーブルが locality を放棄
- `sessionAlarmsManager.ts:12-28` は削除テストで複雑さが消える pass-through facade（deletion test 不合格）

## 実装ガイド

1. **`AlarmJobSpec` を拡張**（alarmRegistry.ts）:
   ```ts
   interface AlarmJobSpec {
     name: string;
     staticSchedule?: chrome.alarms.AlarmCreateInfo; // 欠番 = conditional
     install?: () => Promise<void>;  // review-summary の enabled 分岐、session の period 作成
     run: (deps: AlarmHandlerDeps) => Promise<void>;
   }
   ```
2. **2系統を adapter 化**: SessionAlarmService と reviewSummaryAlarm が AlarmJobSpec を提供する形に（内部 seam の AlarmPort/Clock/StoragePort 注入（SessionAlarmService.ts:35-40 の良い設計）は維持）
3. **service-worker.ts の薄化**: init() は `alarmRegistry.installAll()` の1呼び出しのみを知る
4. **削除**: `setupReviewSummaryAlarmListener` / `setupAlarmListener` / `sessionAlarmsManager` facade（deletion test 不合格）
5. **二重登録ガードは registry 内の Map + Set に一箇所化**

### 触ってはいけないもの

- SessionAlarmService の内部 seam（AlarmPort/Clock/StoragePort 注入 — 良い設計として維持）
- alarm の動作仕様（タイミング・頻度・データは不変）

## BDD受け入れシナリオ

```gherkin
Scenario: 新しい timed job が1行で追加できる
  Given AlarmJobSpec のテーブルが registry にある
  When  新しい spec を追加する
  Then  SW wake 時に自動登録・多重登録防止・統一失敗政策が適用される

Scenario: registry が alarm を単一 seam で処理する
  Given session timeout と review summary の両方の alarm が走る
  When  alarms.onAlarm が発火する
  Then  registry の handleAlarm 1箇所がディスパッチし、既存動作は不変
```

## 受け入れ基準

- [x] `chrome.alarms.onAlarm` リスナー登録が registry 1箇所のみになっている（session-timeout は `checkTimeout` を public 化し deps 経由で dispatch、review-summary は `run` 経由）
- [x] `setupReviewSummaryAlarmListener` / `setupAlarmListener` / `sessionAlarmsManager` facade が削除されている（SW init は直接 `SessionAlarmService` を生成）
- [x] 失敗政策が均一（registry の catch + addLog）になっている
- [x] session / review-summary の alarm 動作が不変（install hooks + handleAlarm テスト 7 passed + 全スイート green）

## テスト戦略

- 単体: registry の installAll / handleAlarm テスト（2系統の spec を追加）
- 既存: alarm 系テストの付け替え

## 見積もり

2-3日

## Definition of Done

- [ ] 全BDDシナリオが完了している
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（alarmRegistry 先頭コメント — "Out of scope" 宣言の解消）
