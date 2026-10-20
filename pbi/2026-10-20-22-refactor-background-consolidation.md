# PBI 22: background 内同形複製の共通化

## ユーザーストーリー
メンテナーとして、background 内の同形複製が 1 実装になった状態がほしい、なぜなら initialize/reload・catch・fallback シーケンスの複製は片側修正の温床になるから。

## 変更点の概要
background 内の 4 つの同形複製を 1 実装へ共通化する。出力・戻り契約は不変。

## 現状と問題
- src/background/rateLimiter.ts（initialize と reload が同形の読み取り + 初期化シーケンス）
- src/background/ai/providers/RemoteAIService.ts（catch ブロック ×2 同形）
- src/offscreen/sqliteEngineHost.ts（fallback 突入シーケンス ×2 同形）
- src/utils/ublockMatcher.ts（インデックス構築ループ ×4 同形）
- pause ゲート: src/background/recordingAdmission.ts:83-87 と src/background/recordingTriggerManager.ts:123-127（同形ゲート ×2）
- テスト: 各モジュールのテストが動作を検証

## 変更の理由
[DRY] 同形シーケンスの複製は初期化順序・ゲート条件の片側修正リスク。

## 提案コード（骨子）
- rateLimiter: loadState() ヘルパーへ集約（initialize/reload は共有）
- RemoteAIService: 1 catch ヘルパーへ
- sqliteEngineHost: 1 fallback 突入ヘルパーへ
- pause ゲート: 1 述語を共有

## BDD受け入れシナリオ
Scenario: initialize/reload の等価性
  Given 既存のレート制限状態
  When 共通化後の initialize と reload を呼ぶ
  Then 状態遷移と戻り値は変更前と同一である

Scenario: pause ゲートの等価性
  Given 録画一時停止条件
  When 共通述語を通す
  Then 許可/拒否判定は変更前と同一である

## 見積もり
1 pt（RICE: 12 = Reach 6 × Impact 2 × Confidence 1.0 ÷ Effort 1.0 人日）

## DoD
- [ ] 4 つの複製が 1 実装経由になる
- [ ] 既存テスト全通過
- [ ] npm run validate 通過
