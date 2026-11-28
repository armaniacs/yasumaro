# PBI: src/background/ フラット 67 ファイルのクラスタ再編 (recording / scheduling / queue)

## ユーザーストーリー
保守担当者として、src/background/ 直下の 67 ファイルを機能クラスタごとのサブディレクトリに再編したい、なぜなら「フラットか、サブディレクトリか」の基準が機能ごとに不統一で、録画機能が 3 箇所に分散し、セッション/アラームクラスタ 12 ファイルがすべてフラット、queue/ 配下に 1 ファイルのみの不整合があり、新規モジュールの置き場所の判断が暗黙知に依存し、「録画系を 1 機能で横断する変更」の影響範囲特定コストが増大しているから (holistic レビュー テーマ 1、影響度: 中 | 難易度: 中)。

## ユーザーへの背景 (レビュー報告書: テーマ 1、実測)
- 録画機能 3 分散: `pipeline/` (2,439 行、RecordingOrchestrator.ts 424 行)、`handlers/recordingHandlers.ts` (418 行)、フラット (recordingAdmission.ts 117 行、recordingCache.ts 304 行、recordingPause.ts 185 行、recordingPauseGate.ts 19 行、recordingTriggerManager.ts 174 行、recordingValidator.ts 97 行)
- セッション/アラーム 12 ファイル全フラット: SessionAlarmService.ts (226)、sessionAlarmsManager.ts (28 シム)、sessionStore.ts (752)、alarmRegistry.ts (300)、standingAlarmGuard.ts (25)、dailyPurgeHandler.ts (179)、digestBatchAlarm.ts (248)、digestBatchCheckpointStore.ts (172)、digestBatchJob.ts、sessionReminderAlarms.ts (186)、sessionReminderClick.ts (216)、sessionReminderCandidates.ts (125)
- キュー混在: `queue/payload.ts` 1 ファイルのみ sub-dir、persistentRetryQueue.ts (506)、pendingChromeStorageQueue.ts (195)、pendingSqliteQueue.ts (184)、pendingPatchPolicy.ts (141)、queueStorageAdapter.ts (58)、retryPendingWrites.ts (53)、offlineNetworkQueue.ts (274)、offlineQueueProcessor.ts (214) はフラット
- 命名スタイル不統一: SessionAlarmService.ts (PascalCase 本体) + sessionAlarmsManager.ts (シム) ― rateLimiter.ts → utils/RateLimitService.ts と同型シムパターン

## ビジネス価値
- 新規モジュールの置き場所判断を規約化し、機能横断変更の影響範囲特定コストを下げる
- 測定方法: ls の見た目と凝集度が一致し、record/scheduling/queue 各クラスタがサブディレクトリに集約されていること

## BDD受け入れシナリオ

```gherkin
Scenario: 録画系モジュールが recording/ に集約される
  Given recordingAdmission/recordingCache/recordingPause/recordingPauseGate/recordingTriggerManager/recordingValidator が src/background/ 直下にある
  When git mv で src/background/recording/ に移動する
  Then import パスが更新され、validate (wire-table / workerTypeSync / parity pin) が緑である

Scenario: セッション/アラーム系が scheduling/ に集約される
  Given セッション/アラーム 12 ファイルが src/background/ 直下にある
  When git mv で src/background/scheduling/ に移動する
  Then import パスが更新され、既存テストが緑である
```

## 受け入れ基準
- [ ] recordingAdmission/recordingCache/recordingPause/recordingPauseGate/recordingTriggerManager/recordingValidator が src/background/recording/ に移動している (pipeline/ と handlers/recordingHandlers.ts は現位置維持)
- [ ] alarmRegistry/sessionAlarmsManager/SessionAlarmService/standingAlarmGuard/dailyPurgeHandler/digestBatch*/sessionReminder* が src/background/scheduling/ に移動している
- [ ] queue/payload.ts と persistentRetryQueue/pending*/offline* が src/background/queue/ に集約されている
- [ ] 全 import パスが更新され、type-check / validate が緑
- [ ] SessionAlarmService シムの Sunset 判断が台帳に記録されている (非公開化 + シム統一 or シム廃止)
- [ ] `npm run validate` + `npm run build` が通る

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし (移動のみ)

### 統合テスト
- wire-table / workerTypeSync / parity pin (移動を検知する機械的ゲート)

### 単体テスト
- 既存テスト群 (import 更新のみ、無変更で緑)

## 見積もり
M (5 SP、要チームでの見積もり)

## 技術的考慮事項
- 出所: plans/2026-11-28-0145-holistic-review-1128a.md テーマ 1、ロードマップ 4 位 (独立 PR 推奨)
- 外部挙動: 完全に不変 (git mv + import 更新のみ。wire-table 系の pin テストが検知網)
- 依存関係: なし (ADR 2026-09-17 module-singleton-policy のファサード注入はモジュールパス非依存)
- 独立 PR 推奨 (レビュー報告書): ファイル数が多いため

## 実装者向け注記

### 現状コードの確認
(着手前に必ず実行すること)
```bash
ls src/background/*.ts | wc -l
ls src/background/queue/ src/background/pipeline/ src/background/handlers/
grep -rn "from '../queue/payload" src --include="*.ts" | head -4
```

### 実装手順
1. scheduling/ (12 ファイル) → queue/ (8 ファイル) → recording/ (6 ファイル) の順で git mv + import 更新
2. 各クラスタ移動後に type-check + validate:json を回す (3 ステップ)
3. SessionAlarmService シムの Sunset 判断を台帳に記録

### 落とし穴
- service-worker.ts の import 一覧が最大の消費者 (全部更新)
- sessionAlarmsManager.ts / rateLimiter.ts のシムパターンは実体の移動とシムの維持を混同しない (PBI 03 スコープでシム統一も検討)
- git 操作禁止 → この PBI は git mv 主体のため**例外**: 実装者が git mv と import 更新のみ実施し、commit は統合側にする (指示に明記)
- 実時間待ち禁止

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす (統合)
- [ ] コードレビュー完了
- [ ] リファクタリング完了 (グリーン後)
- [ ] ロールバック手段: git mv の逆 (1 コミット)
- [ ] ドキュメント更新の要否判定: dev-docs/ARCHITECTURE_MAP.md のファイルツリーが実在パスと一致しなくなるため、ARCHITECTURE_MAP 更新が必要 (本 PBI 内で対応)
