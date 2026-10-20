# PBI 05: 設定読み取り 3 段ラッダーの共通化（aiUsageTracker）

## ユーザーストーリー
メンテナーとして、blob → legacy トップレベル → SettingsRepository の読み取りラッダーが 1 実装に集約された状態がほしい、なぜならラッダーが複製されると書き手と読み手の解けが月次トークン会計・レート制限ウィンドウの silently リセットとして顕在化するから。

## 変更点の概要
aiUsageTracker 内に 2 重複する 3 段ラッダーを 1 ヘルパーへ共通化する。ラッダーの挙動（blob 値があれば blob、なければ legacy トップレベル、なければ SettingsRepository）は変更しない。

## 現状と問題
- src/utils/aiUsageTracker.ts:64-111（getRateLimitMax）と :296-341（getMaxMonthlyTokens）がほぼ同形のラッダーを複製
- getMaxMonthlyTokens 側（:312）には文字列数値のパースがあるが getRateLimitMax 側にはない（片側だけの硬化が複製によって届かない実例）
- 呼び出し元: checkRateLimit / checkHardLimit / checkUsageWarning（同ファイル内 4 箇所）
- テスト: src/utils/__tests__/aiUsageTracker.test.ts（617 行、stateful モック）

## 変更の理由
[DRY] 同一ラッダーの複製は過去 2 回の書き手/読み手不整合修正（blob 側の mismatch fix）の温床。ヘルパー化で 1 箇所の修正が 2 関数へ届く。

## 提案コード（骨子）
async function readNumberSetting(key: string, legacyKey: string, fallback: number): Promise<number> {
  // blob 値 → legacy トップレベル → SettingsRepository の順で読み、文字列は数値化して返す
}

## BDD受け入れシナリオ
Scenario: blob 値が優先される
  Given blob と legacy トップレベルの両方に値がある
  When getRateLimitMax を呼ぶ
  Then blob 値が返る（変更前と同一）

Scenario: 文字列数値は両関数で数値化される
  Given legacy トップレベルに文字列の "100" がある
  When getRateLimitMax と getMaxMonthlyTokens を呼ぶ
  Then 両方とも数値 100 が返る（複製の片側だけだった硬化が両側に届く）

## 見積もり
2 pt（RICE: 48 = Reach 8 × Impact 3 × Confidence 1.0 ÷ Effort 0.5 人日）

## DoD
- [ ] 2 関数が共通ヘルパーを使い、ラッダー複製が消える
- [ ] 既存テスト（aiUsageTracker.test.ts）全通過
- [ ] npm run validate 通過
